// Server-side render → PNG bytes. Mirrors bin/pyr3-render.ts steps 2-7
// but loops in chunks so /api/render can stream SSE progress events,
// and accepts an AbortSignal so /api/cancel/:id can stop mid-render.

import { PNG } from 'pngjs';
import { deflateSync } from 'node:zlib';

import { createRenderer, computeDispatch, DEFAULT_FILTER_RADIUS, type Renderer } from '../../src/renderer';
import { type Genome } from '../../src/genome';
import { DEFAULT_WALKER_JITTER } from '../../src/chaos';
import { encodeExr } from '../../src/exr-encode';
import { encodePng16 } from '../../src/png16-encode';
import { readTextureTight, displayHalfToLinearExr, displayHalfToPng16 } from '../../src/gpu-readback';
import { AsyncMutex } from './async-mutex';

/** #334 — output format. png8/png16 are display-referred; exr is true linear. */
export type RenderFormat = 'png8' | 'png16' | 'exr';

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
  /** #334 — output format (default png8). */
  format?: RenderFormat;
  /** #334 — transparent background for png8/png16 (no effect on exr). */
  transparent?: boolean;
}

export interface RenderProgress {
  chunk: number;
  total: number;
  percent: number;
  samples: number;
}

// Server-side chunking exists purely for progress events + cooperative
// cancellation — there's no rAF to yield to. The browser uses tiny
// chunks for UI responsiveness; on the server, that wastes GPU
// throughput hard.
//
// CRITICAL: chunks must shrink `itersPerWalker`, NOT `walkers`. Each
// iterate() dispatch runs walkers in parallel on the GPU; the chaos
// kernel saturates at ~TARGET_WALKERS (1024). Shrinking walkers leaves
// most of the GPU idle — the bug behind #201's first perf miss (4K
// q=100 took 50s with 86-walker chunks vs 7s with full 1024-walker
// dispatches; the browser equivalent is ~13s).
const TARGET_PROGRESS_EVENTS = 4;

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
  format: GPUTextureFormat;
}

let cached: RendererBundle | null = null;

function makeBundle(
  device: GPUDevice,
  width: number,
  height: number,
  oversample: number,
  filterRadius: number,
  format: GPUTextureFormat,
): RendererBundle {
  const renderer = createRenderer(device, format, { width, height, oversample, filterRadius });
  const texture = device.createTexture({
    label: 'pyr3-serve.output',
    size: { width, height },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  return { renderer, texture, width, height, oversample, filterRadius, format };
}

function ensureRenderer(
  device: GPUDevice,
  width: number,
  height: number,
  oversample: number,
  filterRadius: number,
  format: GPUTextureFormat,
): RendererBundle {
  // #334 — the GPU target format is fixed at createRenderer time and cannot be
  // changed by resize(), so a format switch (png16 ⇄ png8/exr) rebuilds the
  // bundle. Format switches are rare (deliberate exports); dim-only changes
  // keep the warm renderer via resize().
  if (cached && cached.format !== format) {
    cached.renderer.destroy();
    cached.texture.destroy();
    cached = null;
  }
  if (!cached) {
    cached = makeBundle(device, width, height, oversample, filterRadius, format);
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

// #231 — serialize all renders. The cached renderer/texture/histogram is a
// single shared resource; two concurrent /api/render requests would interleave
// at the chunk-loop yields and corrupt each other. The mutex keeps the warm
// renderer (the reason it's cached) while guaranteeing one render at a time.
const renderMutex = new AsyncMutex();

/** Render a genome to a PNG byte array. Streams progress through
 *  `onProgress` between chunks. The PNG contains pixels only — the
 *  caller (client) injects the `pyr3` tEXt chunk so the metadata format
 *  stays a viewer/editor concern (spec § 3 PNG metadata side).
 *
 *  Serialized via `renderMutex` (#231): concurrent calls queue and run one at
 *  a time. A queued call whose client already disconnected aborts immediately
 *  when its turn arrives (the `abortSignal.aborted` check below). */
export function renderGenomeToPng(
  device: GPUDevice,
  spec: RenderRequestSpec,
  onProgress: (p: RenderProgress) => void,
  abortSignal: AbortSignal,
): Promise<Uint8Array> {
  return renderMutex.run(() => renderGenomeToPngInner(device, spec, onProgress, abortSignal));
}

async function renderGenomeToPngInner(
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
  const outFormat: RenderFormat = spec.format ?? 'png8';
  // png16 needs an rgba16float target; png8/exr use rgba8unorm (exr reads the
  // linear histogram, which is independent of the presented texture format).
  // png16 + exr render the display tonemap to rgba16float; png8 uses rgba8unorm.
  const gpuFormat: GPUTextureFormat =
    outFormat === 'png16' || outFormat === 'exr' ? 'rgba16float' : 'rgba8unorm';

  const { renderer, texture } = ensureRenderer(device, width, height, oversample, filterRadius, gpuFormat);

  const dispatch = computeDispatch(spec.quality, width, height);
  // Split work over a small number of chunks by reducing iters per
  // walker (NOT walker count). Each chunk runs the full
  // dispatch.dispatchWalkers (≈ TARGET_WALKERS) in parallel.
  const totalChunks = Math.max(1, Math.min(TARGET_PROGRESS_EVENTS, dispatch.dispatchIters));
  const itersPerChunk = Math.ceil(dispatch.dispatchIters / totalChunks);
  const walkers = dispatch.dispatchWalkers;
  const samplesPerChunk = walkers * itersPerChunk;
  const targetSamples = walkers * itersPerChunk * totalChunks;

  renderer.reset(genome);

  let samplesAccumulated = 0;
  for (let i = 0; i < totalChunks; i++) {
    if (abortSignal.aborted) throw new AbortedError();
    renderer.iterate({
      genome,
      seed: seedBase + i,
      walkers,
      itersPerWalker: itersPerChunk,
      walkerJitter,
    });
    samplesAccumulated += samplesPerChunk;
    // Drain once per chunk so cancel sees actual GPU progress and the
    // progress event reflects real wall-clock state. With only ~4
    // chunks the per-drain stall is negligible compared to the dispatch
    // work it gates.
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
    transparent: spec.transparent,
  });
  await device.queue.onSubmittedWorkDone();

  // Copy texture → buffer, 256-aligned row stride. png16 = 8 B/px (4×f16).
  const bytesPerPixel = gpuFormat === 'rgba16float' ? 8 : 4;
  const tight = await readTextureTight(device, texture, width, height, bytesPerPixel);

  if (outFormat === 'exr') {
    // #334 — store the LINEAR LIGHT of the display image so EXR viewers (which
    // apply sRGB on view) reproduce the editor look on open. See src/srgb.ts.
    // #388 NaN→0 guard lives inside displayHalfToLinearExr.
    const rgba = displayHalfToLinearExr(tight, width, height);
    return encodeExr({ width, height, rgba });
  }

  if (outFormat === 'png16') {
    const rgba16 = displayHalfToPng16(tight, width, height);
    return encodePng16({ width, height, rgba16 }, (b) => new Uint8Array(deflateSync(b)));
  }

  const png = new PNG({ width, height });
  png.data = Buffer.from(tight.buffer, tight.byteOffset, tight.byteLength);
  const pngBuf = PNG.sync.write(png);
  return new Uint8Array(pngBuf.buffer, pngBuf.byteOffset, pngBuf.byteLength);
}
