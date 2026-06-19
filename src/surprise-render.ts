// src/surprise-render.ts
//
// Production renderThumb for the Surprise Wall. Mirrors screensaver-ui.ts's
// shared-renderer thumbnail pattern (one Renderer for all cells) + edit-mount.ts's
// scratch-texture pixel readback, then runs the cull classifier. GPU-only — NOT
// unit-tested in vitest (full-kernel dispatch SIGABRTs the worker); verified in Chrome.

import { type Genome } from './genome';
import { createRenderer, DEFAULT_FILTER_RADIUS, type Renderer } from './renderer';
import { computeFitViewport } from './edit-fit-viewport';
import { classifyThumbnail } from './surprise-cull';
import { type ThumbResult } from './surprise-queue';

/** Thumbnail render edge (px). The mount's tile <canvas> backing store imports
 *  this so the readback ImageData matches the canvas dims exactly. */
export const THUMB_DIM = 320;
const DIM = THUMB_DIM;
const QUALITY = 256;      // samples/px — the wall drives iterate() directly, so
                          // the ESF ≤16 browser-preview cap doesn't apply here.
const WALKERS = 4096;

export interface GpuThumbRenderer {
  renderThumb: (genome: Genome) => Promise<ThumbResult>;
  destroy: () => void;
}

export function makeGpuRenderThumb(device: GPUDevice, format: GPUTextureFormat): GpuThumbRenderer {
  const renderer: Renderer = createRenderer(device, format, {
    width: DIM, height: DIM, oversample: 1, filterRadius: DEFAULT_FILTER_RADIUS,
  });
  const swapBR = format === 'bgra8unorm';
  const bytesPerRow = Math.ceil((DIM * 4) / 256) * 256;

  async function renderThumb(genome: Genome): Promise<ThumbResult> {
    // #361 — the genome was framed by generateRandomGenome for FIT_REF
    // (1920×1080, 16:9); rendering it untouched into the square tile keeps that
    // scale and zoom-crops the attractor. Re-fit to the square tile so the whole
    // flame frames inside it. Only the local render copy is reframed — the stored
    // genome keeps its authored framing for click-through to the editor/viewer.
    // The CPU oracle can throw on exotic variations (mirrors edit-seed's guard)
    // → fall back to the authored framing.
    let framed = genome;
    try {
      const fit = computeFitViewport(genome, DIM, DIM);
      if (fit) framed = { ...genome, scale: fit.scale, cx: fit.cx, cy: fit.cy };
    } catch { /* oracle blew up on an exotic variation → render authored framing */ }

    // 1. iterate the chaos game for this genome (screensaver pattern)
    const iters = Math.max(64, Math.ceil((QUALITY * DIM * DIM) / WALKERS));
    renderer.reset(framed);
    renderer.iterate({ genome: framed, seed: (Math.random() * 0xffffffff) >>> 0, walkers: WALKERS, itersPerWalker: iters });

    // 2. present into a scratch COPY_SRC texture (swap-chain textures are not readable)
    const tex = device.createTexture({
      size: { width: DIM, height: DIM }, format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    renderer.present({ genome: framed, outputView: tex.createView(), totalSamples: WALKERS * iters, forceDeOff: false });

    // 3. copy → mappable buffer → read RGBA (edit-mount.ts scratch-readback pattern)
    const buf = device.createBuffer({ size: bytesPerRow * DIM, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow, rowsPerImage: DIM }, { width: DIM, height: DIM });
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(buf.getMappedRange());
    const rgba = new Uint8ClampedArray(DIM * DIM * 4);
    for (let y = 0; y < DIM; y++) {
      for (let x = 0; x < DIM; x++) {
        const s = y * bytesPerRow + x * 4, d = (y * DIM + x) * 4;
        if (swapBR) { rgba[d] = padded[s + 2]!; rgba[d + 1] = padded[s + 1]!; rgba[d + 2] = padded[s]!; }
        else { rgba[d] = padded[s]!; rgba[d + 1] = padded[s + 1]!; rgba[d + 2] = padded[s + 2]!; }
        rgba[d + 3] = 255;
      }
    }
    buf.unmap(); buf.destroy(); tex.destroy();

    return { rgba, w: DIM, h: DIM, verdict: classifyThumbnail(rgba, DIM, DIM) };
  }

  return { renderThumb, destroy: () => renderer.destroy() };
}
