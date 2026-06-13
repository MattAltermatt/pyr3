// Per-frame renderer used by /api/animate. Mirrors the per-frame block in
// bin/pyr3-animate.ts (lines 171-257): interpolate → resize renderer/texture
// if dims changed → renderAnimationFrame → texture→buffer readback (256-row
// aligned) → tight pixel pack → PNG bytes + metadata injection.
//
// The CLI keeps its own copy because it owns its renderer/texture lifecycle
// and a top-level main() loop; this module exposes a stateful helper so the
// route can stream progress without the CLI's process-exit semantics.

import { PNG } from 'pngjs';

import { createRenderer, DEFAULT_FILTER_RADIUS, type Renderer } from '../../src/renderer';
import { type Animation } from '../../src/animation';
import { type Genome } from '../../src/genome';
import { type Timeline, timelineGenomeAt } from '../../src/timeline';
import { interpolate } from '../../src/interpolate';
import { renderAnimationFrame, renderTimelineFrame } from '../../src/animate-render';
import { DEFAULT_WALKER_JITTER } from '../../src/chaos';
import { injectPngTextChunk } from '../../src/png-text-chunk';
import { genomeToJson } from '../../src/serialize';

export interface AnimationFrameRequest {
  /** Frame time T — interpolate(animation, T) defines the visible genome. */
  time: number;
  walkerJitter?: number;
  /** Override seed for determinism; default Math.random. */
  seed?: number;
}

export interface AnimationFramePng {
  png: Uint8Array;
  width: number;
  height: number;
  /** The genome used to seed renderer.reset — written into the PNG's `pyr3`
   *  metadata chunk. Matches pyr3-animate behaviour. */
  centerGenome: Genome;
}

interface RendererBundle {
  renderer: Renderer;
  /** Double-buffered output textures (#214). submitFrame renders frame N into
   *  textures[N % 2] so frame N's texture→buffer readback can stay in flight
   *  while frame N+1 renders into the other slot. */
  textures: [GPUTexture, GPUTexture];
  width: number;
  height: number;
  oversample: number;
  filterRadius: number;
}

/** A frame whose GPU work (iterate → present → texture→buffer copy) has been
 *  submitted to the queue, with its readback `mapAsync` already in flight. The
 *  CPU-side pack + PNG encode happens later in `finishFrame`, so the GPU can be
 *  working on the next frame while this one's bytes are still being encoded. */
export interface InFlightFrame {
  readBuf: GPUBuffer;
  mapped: Promise<undefined>;
  width: number;
  height: number;
  bytesPerRow: number;
  unpaddedBytesPerRow: number;
  centerGenome: Genome;
}

/** Per-frame render strategy. Animation and timeline export differ at exactly
 *  two points — which genome is visible at time T, and which render fn paints
 *  it — so everything below (double-buffer, readback, PNG encode) is shared. */
export interface FrameSource {
  /** Genome visible at frame time T (drives dims, metadata, reset). */
  centerGenomeAt(time: number): Genome;
  /** Paint frame time T into `opts.outputView`. */
  renderInto(
    renderer: Renderer,
    time: number,
    opts: { outputView: GPUTextureView; walkerJitter: number; seed?: number },
  ): void;
}

export function animationFrameSource(animation: Animation): FrameSource {
  return {
    centerGenomeAt: (t) => interpolate(animation, t),
    renderInto: (renderer, t, opts) => renderAnimationFrame(renderer, animation, t, opts),
  };
}

export function timelineFrameSource(timeline: Timeline): FrameSource {
  return {
    centerGenomeAt: (t) => timelineGenomeAt(timeline, t),
    renderInto: (renderer, t, opts) => renderTimelineFrame(renderer, timeline, t, opts),
  };
}

/** Timeline export overrides — absolute `quality` (sets every clip's
 *  genome.quality, uniform across the whole video, unlike the animation path's
 *  qs *scale*) + `nsteps` (the timeline's ntemporal_samples; collapse to 1 to
 *  avoid the ESF 1000-sub-frame trap that createTimeline() inherits). No-op
 *  when both are undefined. */
export function applyTimelineExportOverrides(
  source: Timeline,
  overrides: { quality?: number; nsteps?: number },
): Timeline {
  const { quality, nsteps } = overrides;
  if (quality === undefined && nsteps === undefined) return source;
  return {
    ...source,
    ...(nsteps !== undefined ? { ntemporal_samples: nsteps } : {}),
    clips: quality === undefined
      ? source.clips
      : source.clips.map((c) => ({
          ...c,
          flame: { ...c.flame, genome: { ...c.flame.genome, quality } },
        })),
  };
}

/** Frame-sequence render context — holds the cached renderer/textures so a
 *  single `/api/animate` POST can iterate frames without paying per-frame
 *  createRenderer/createTexture costs when dims are stable across frames.
 *  Driven by a FrameSource so the same pipeline serves both `.flam3`
 *  animations and timelines. Caller must call `destroy()` when the request
 *  ends. */
export class FrameSequenceRenderContext {
  private bundle: RendererBundle | null = null;
  /** Monotonic frame counter selecting the double-buffer slot (parity). */
  private frameCounter = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly source: FrameSource,
  ) {}

  private makeOutputTexture(width: number, height: number): GPUTexture {
    return this.device.createTexture({
      label: 'pyr3-serve.animate.output',
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
  }

  private ensureBundle(width: number, height: number, oversample: number, filterRadius: number): RendererBundle {
    const format = 'rgba8unorm' as const;
    if (
      !this.bundle
      || this.bundle.width !== width
      || this.bundle.height !== height
      || this.bundle.oversample !== oversample
      || this.bundle.filterRadius !== filterRadius
    ) {
      this.bundle?.textures[0].destroy();
      this.bundle?.textures[1].destroy();
      this.bundle?.renderer.destroy();
      const renderer = createRenderer(this.device, format, { width, height, oversample, filterRadius });
      const textures: [GPUTexture, GPUTexture] = [
        this.makeOutputTexture(width, height),
        this.makeOutputTexture(width, height),
      ];
      this.bundle = { renderer, textures, width, height, oversample, filterRadius };
    }
    return this.bundle;
  }

  /** Phase 1 (#214): run a frame's GPU work and kick off the readback map,
   *  returning before the map resolves. The renderer is single + shared, so
   *  callers must `submitFrame` serially (the route does); but the returned
   *  handle can be `finishFrame`d while the NEXT frame's GPU work is already
   *  in flight. GPU queue ordering + the texture double-buffer keep frame N's
   *  copy and frame N+1's render from colliding. */
  submitFrame(req: AnimationFrameRequest): InFlightFrame {
    const centerGenome = this.source.centerGenomeAt(req.time);
    const width = centerGenome.size?.width ?? 1024;
    const height = centerGenome.size?.height ?? 1024;
    const oversample = Math.max(1, Math.floor(centerGenome.oversample ?? 1));
    const filterRadius = centerGenome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;
    const walkerJitter = req.walkerJitter ?? DEFAULT_WALKER_JITTER;

    const bundle = this.ensureBundle(width, height, oversample, filterRadius);
    const texture = bundle.textures[this.frameCounter % 2]!;
    this.frameCounter++;

    this.source.renderInto(bundle.renderer, req.time, {
      outputView: texture.createView(),
      walkerJitter,
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
    });

    const bytesPerPixel = 4;
    const unpaddedBytesPerRow = width * bytesPerPixel;
    const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
    const readBuf = this.device.createBuffer({
      label: 'pyr3-serve.animate.readback',
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder({ label: 'pyr3-serve.animate.encoder' });
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: readBuf, bytesPerRow, rowsPerImage: height },
      { width, height },
    );
    this.device.queue.submit([encoder.finish()]);
    const mapped = readBuf.mapAsync(GPUMapMode.READ);

    return { readBuf, mapped, width, height, bytesPerRow, unpaddedBytesPerRow, centerGenome };
  }

  /** Phase 2 (#214): await the in-flight frame's readback and do the CPU-side
   *  pack + PNG encode + metadata inject. Runs concurrently with the next
   *  frame's GPU work when the caller submits ahead. */
  async finishFrame(frame: InFlightFrame): Promise<AnimationFramePng> {
    const { readBuf, width, height, bytesPerRow, unpaddedBytesPerRow, centerGenome } = frame;
    await frame.mapped;
    const padded = new Uint8Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();
    readBuf.destroy();

    const tight = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const srcOff = y * bytesPerRow;
      const dstOff = y * unpaddedBytesPerRow;
      tight.set(padded.subarray(srcOff, srcOff + unpaddedBytesPerRow), dstOff);
    }

    const pngObj = new PNG({ width, height });
    pngObj.data = Buffer.from(tight.buffer, tight.byteOffset, tight.byteLength);
    const pngBuf = PNG.sync.write(pngObj);
    const metadataJson = JSON.stringify(genomeToJson(centerGenome));
    const png = injectPngTextChunk(
      new Uint8Array(pngBuf.buffer, pngBuf.byteOffset, pngBuf.byteLength),
      'pyr3',
      metadataJson,
    );

    return { png, width, height, centerGenome };
  }

  /** Render one frame end-to-end (submit + finish). Backward-compatible serial
   *  path; the pipelined route uses submitFrame/finishFrame directly. */
  renderFrame(req: AnimationFrameRequest): Promise<AnimationFramePng> {
    return this.finishFrame(this.submitFrame(req));
  }

  destroy(): void {
    this.bundle?.textures[0].destroy();
    this.bundle?.textures[1].destroy();
    this.bundle?.renderer.destroy();
    this.bundle = null;
  }
}

/** Apply qs/ss/ntemporal_samples/temporal_filter_width overrides to an
 *  Animation up-front. Matches pyr3-animate's pre-loop scaling — keyframe
 *  fields scale linearly through interp, so scaling each keyframe once at
 *  load is equivalent to per-frame scaling. */
export function applyExportOverrides(
  source: Animation,
  overrides: {
    qs?: number;
    ss?: number;
    nsteps?: number;
    blurWidth?: number;
  },
): Animation {
  const { qs = 1.0, ss = 1.0, nsteps, blurWidth } = overrides;
  if (qs === 1.0 && ss === 1.0 && nsteps === undefined && blurWidth === undefined) {
    return source;
  }
  return {
    ...source,
    ...(nsteps !== undefined ? { ntemporal_samples: nsteps } : {}),
    ...(blurWidth !== undefined ? { temporal_filter_width: blurWidth } : {}),
    keyframes: source.keyframes.map((k) => {
      let g: Genome = k;
      if (ss !== 1.0) {
        g = {
          ...g,
          scale: g.scale * ss,
          ...(g.size
            ? {
                size: {
                  width: Math.max(1, Math.round(g.size.width * ss)),
                  height: Math.max(1, Math.round(g.size.height * ss)),
                },
              }
            : {}),
        };
      }
      if (qs !== 1.0 && g.quality !== undefined) {
        g = { ...g, quality: g.quality * qs };
      }
      return g;
    }),
  };
}
