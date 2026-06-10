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
import { interpolate } from '../../src/interpolate';
import { renderAnimationFrame } from '../../src/animate-render';
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
  texture: GPUTexture;
  width: number;
  height: number;
  oversample: number;
  filterRadius: number;
}

/** Animation render context — holds the cached renderer/texture so a single
 *  `/api/animate` POST can iterate frames without paying per-frame
 *  createRenderer/createTexture costs when dims are stable across keyframes.
 *  Caller is responsible for calling `destroy()` when the request ends. */
export class AnimationRenderContext {
  private bundle: RendererBundle | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly animation: Animation,
  ) {}

  private ensureBundle(width: number, height: number, oversample: number, filterRadius: number): RendererBundle {
    const format = 'rgba8unorm' as const;
    if (
      !this.bundle
      || this.bundle.width !== width
      || this.bundle.height !== height
      || this.bundle.oversample !== oversample
      || this.bundle.filterRadius !== filterRadius
    ) {
      this.bundle?.texture.destroy();
      this.bundle?.renderer.destroy();
      const renderer = createRenderer(this.device, format, { width, height, oversample, filterRadius });
      const texture = this.device.createTexture({
        label: 'pyr3-serve.animate.output',
        size: { width, height },
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      this.bundle = { renderer, texture, width, height, oversample, filterRadius };
    }
    return this.bundle;
  }

  /** Render one frame of the animation and return PNG bytes (with the
   *  `pyr3` metadata chunk injected). Caller streams these to disk. */
  async renderFrame(req: AnimationFrameRequest): Promise<AnimationFramePng> {
    const centerGenome = interpolate(this.animation, req.time);
    const width = centerGenome.size?.width ?? 1024;
    const height = centerGenome.size?.height ?? 1024;
    const oversample = Math.max(1, Math.floor(centerGenome.oversample ?? 1));
    const filterRadius = centerGenome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;
    const walkerJitter = req.walkerJitter ?? DEFAULT_WALKER_JITTER;

    const bundle = this.ensureBundle(width, height, oversample, filterRadius);

    renderAnimationFrame(bundle.renderer, this.animation, req.time, {
      outputView: bundle.texture.createView(),
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
      { texture: bundle.texture },
      { buffer: readBuf, bytesPerRow, rowsPerImage: height },
      { width, height },
    );
    this.device.queue.submit([encoder.finish()]);
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

  destroy(): void {
    this.bundle?.texture.destroy();
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
