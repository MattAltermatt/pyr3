// Server-side render → PNG bytes. Mirrors bin/pyr3-render.ts steps 2-7
// but loops in chunks so /api/render can stream SSE progress events,
// and accepts an AbortSignal so /api/cancel/:id can stop mid-render.

import { PNG } from 'pngjs';

import { createRenderer, computeDispatch, DEFAULT_FILTER_RADIUS, type Renderer } from '../../src/renderer';
import { type Genome } from '../../src/genome';
import { DEFAULT_WALKER_JITTER } from '../../src/chaos';

export interface RenderRequestSpec {
  genome: Genome;
  /** Output dimensions. Renderer is resized to these on every request. */
  width: number;
  height: number;
  /** Target samples-per-pixel — `genome.quality` rounded. */
  quality: number;
  oversample?: number;
  walkerJitter?: number;
  /** Override seed for determinism (parity tests, replay). */
  seed?: number;
}

export interface RenderProgress {
  chunk: number;
  total: number;
  percent: number;
  samples: number;
}

const SAMPLES_PER_CHUNK = 4_000_000;

export class AbortedError extends Error {
  constructor() {
    super('render aborted');
    this.name = 'AbortedError';
  }
}

interface RendererBundle {
  renderer: Renderer;
  texture: GPUTexture;
  width: number;
  height: number;
  oversample: number;
  filterRadius: number;
}

let cached: RendererBundle | null = null;

function ensureRenderer(
  device: GPUDevice,
  width: number,
  height: number,
  oversample: number,
  filterRadius: number,
): RendererBundle {
  const format = 'rgba8unorm' as const;
  if (!cached) {
    const renderer = createRenderer(device, format, { width, height, oversample, filterRadius });
    const texture = device.createTexture({
      label: 'pyr3-serve.output',
      size: { width, height },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    cached = { renderer, texture, width, height, oversample, filterRadius };
    return cached;
  }
  // Re-resize the renderer if any dim changes; re-create the texture if w/h shift.
  if (
    cached.width !== width
    || cached.height !== height
    || cached.oversample !== oversample
    || cached.filterRadius !== filterRadius
  ) {
    cached.renderer.resize({ width, height, oversample, filterRadius });
    if (cached.width !== width || cached.height !== height) {
      cached.texture.destroy();
      cached.texture = device.createTexture({
        label: 'pyr3-serve.output',
        size: { width, height },
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
    }
    cached.width = width;
    cached.height = height;
    cached.oversample = oversample;
    cached.filterRadius = filterRadius;
  }
  return cached;
}

/** Render a genome to a PNG byte array. Streams progress through
 *  `onProgress` between chunks. The PNG contains pixels only — the
 *  caller (client) injects the `pyr3` tEXt chunk so the metadata format
 *  stays a viewer/editor concern (spec § 3 PNG metadata side). */
export async function renderGenomeToPng(
  device: GPUDevice,
  spec: RenderRequestSpec,
  onProgress: (p: RenderProgress) => void,
  abortSignal: AbortSignal,
): Promise<Uint8Array> {
  if (abortSignal.aborted) throw new AbortedError();

  const { genome } = spec;
  const width = spec.width;
  const height = spec.height;
  const oversample = Math.max(1, Math.floor(spec.oversample ?? genome.oversample ?? 1));
  const filterRadius = genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;
  const walkerJitter = spec.walkerJitter ?? DEFAULT_WALKER_JITTER;
  const seedBase = spec.seed ?? ((Math.random() * 0xffffffff) >>> 0);

  const { renderer, texture } = ensureRenderer(device, width, height, oversample, filterRadius);

  const targetSamples = Math.round(spec.quality * width * height);
  const dispatch = computeDispatch(spec.quality, width, height);
  // Re-shape per-chunk dispatch so each chunk lands roughly SAMPLES_PER_CHUNK
  // samples — yields cooperative cancellation between Dawn submits.
  const walkersPerChunk = Math.max(1, Math.min(dispatch.dispatchWalkers, Math.ceil(SAMPLES_PER_CHUNK / dispatch.dispatchIters)));
  const itersPerChunk = dispatch.dispatchIters;
  const samplesPerChunk = walkersPerChunk * itersPerChunk;
  const totalChunks = Math.max(1, Math.ceil(targetSamples / samplesPerChunk));

  renderer.reset(genome);

  let samplesAccumulated = 0;
  for (let i = 0; i < totalChunks; i++) {
    if (abortSignal.aborted) throw new AbortedError();
    renderer.iterate({
      genome,
      seed: seedBase + i,
      walkers: walkersPerChunk,
      itersPerWalker: itersPerChunk,
      walkerJitter,
    });
    samplesAccumulated += samplesPerChunk;
    // Drain the queue between chunks so cancel sees real GPU progress
    // (not just an unbounded backlog of submits) and the progress event
    // reflects actual wall-clock state.
    await device.queue.onSubmittedWorkDone();
    onProgress({
      chunk: i + 1,
      total: totalChunks,
      percent: Math.min(1, (i + 1) / totalChunks),
      samples: samplesAccumulated,
    });
  }

  if (abortSignal.aborted) throw new AbortedError();

  renderer.present({
    genome,
    outputView: texture.createView(),
    totalSamples: targetSamples,
  });
  await device.queue.onSubmittedWorkDone();

  // Copy texture → buffer, 256-aligned row stride.
  const bytesPerPixel = 4;
  const unpaddedBytesPerRow = width * bytesPerPixel;
  const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
  const readBufSize = bytesPerRow * height;
  const readBuf = device.createBuffer({
    label: 'pyr3-serve.readback',
    size: readBufSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: 'pyr3-serve.encoder' });
  encoder.copyTextureToBuffer(
    { texture },
    { buffer: readBuf, bytesPerRow, rowsPerImage: height },
    { width, height },
  );
  device.queue.submit([encoder.finish()]);

  await readBuf.mapAsync(GPUMapMode.READ);
  const padded = new Uint8Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  readBuf.destroy();

  const tight = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcOff = y * bytesPerRow;
    const dstOff = y * unpaddedBytesPerRow;
    tight.set(padded.subarray(srcOff, srcOff + unpaddedBytesPerRow), dstOff);
  }

  const png = new PNG({ width, height });
  png.data = Buffer.from(tight.buffer, tight.byteOffset, tight.byteLength);
  const pngBuf = PNG.sync.write(png);
  return new Uint8Array(pngBuf.buffer, pngBuf.byteOffset, pngBuf.byteLength);
}
