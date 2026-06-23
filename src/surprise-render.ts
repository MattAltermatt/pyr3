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
// samples/px for the wall's discovery thumbnails. Lowered 256 → 96 (#surprise-v2
// perf): a 320px preview reads fine at 96, and the wall renders many candidates
// (incl. culled ones) serially — full quality lives in the editor you click through
// to. ~2.7× faster per thumbnail. The ESF ≤16 browser-preview cap doesn't apply.
const QUALITY = 96;
// #surprise-v2 cull pre-pass: most generated candidates are degenerate and get
// rendered-then-culled. Classify each at a cheap low spp first, and only pay the
// full QUALITY render for survivors. present() normalizes by totalSamples, so a
// low-spp render has the SAME brightness as full (just noisier) — the cull signal
// (sparse / black / low-coverage) is unaffected. ~4× cheaper per culled candidate.
const CULL_QUALITY = 24;
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

  // #389 — per-renderer scratch, reused across every renderThumb call instead of
  // allocate-per-call. Dims are fixed (DIM², `format`), so one allocation serves
  // all thumbnails. Destroyed in destroy(); a mid-render mapAsync rejection no
  // longer leaks a per-call texture+buffer (it was previously freed only on the
  // success path) — there's simply nothing per-call left to leak.
  const scratchTex = device.createTexture({
    size: { width: DIM, height: DIM }, format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const scratchBuf = device.createBuffer({
    size: bytesPerRow * DIM,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const itersForQuality = (q: number): number => Math.max(64, Math.ceil((q * DIM * DIM) / WALKERS));
  const freshSeed = (): number => (Math.random() * 0xffffffff) >>> 0;

  /** Present the CURRENT accumulated histogram (normalized by `totalSamples`),
   *  read it back, and classify. Does NOT reset — so it reflects however many
   *  iterate() calls have accumulated since the last reset. */
  async function presentAndClassify(framed: Genome, totalSamples: number): Promise<ThumbResult> {
    // present into the scratch COPY_SRC texture (swap-chain textures are not readable)
    renderer.present({ genome: framed, outputView: scratchTex.createView(), totalSamples, forceDeOff: false });
    // copy → mappable buffer → read RGBA (edit-mount.ts scratch-readback pattern)
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: scratchTex }, { buffer: scratchBuf, bytesPerRow, rowsPerImage: DIM }, { width: DIM, height: DIM });
    device.queue.submit([enc.finish()]);
    await scratchBuf.mapAsync(GPUMapMode.READ);
    // #389 — always unmap after a successful map so the buffer is reusable next call.
    try {
      const padded = new Uint8Array(scratchBuf.getMappedRange());
      const rgba = new Uint8ClampedArray(DIM * DIM * 4);
      for (let y = 0; y < DIM; y++) {
        for (let x = 0; x < DIM; x++) {
          const s = y * bytesPerRow + x * 4, d = (y * DIM + x) * 4;
          if (swapBR) { rgba[d] = padded[s + 2]!; rgba[d + 1] = padded[s + 1]!; rgba[d + 2] = padded[s]!; }
          else { rgba[d] = padded[s]!; rgba[d + 1] = padded[s + 1]!; rgba[d + 2] = padded[s + 2]!; }
          rgba[d + 3] = 255;
        }
      }
      return { rgba, w: DIM, h: DIM, verdict: classifyThumbnail(rgba, DIM, DIM) };
    } finally {
      scratchBuf.unmap();
    }
  }

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

    // #surprise-v2 two-stage with a HOT histogram. Most candidates are
    // degenerate, so accumulate only CULL_QUALITY samples and classify. If it's
    // a keeper, KEEP the histogram (no reset) and iterate the remaining samples
    // on top to reach full QUALITY — the cull probe's samples become part of the
    // final image instead of being thrown away. (saves CULL_QUALITY per survivor)
    const probeIters = itersForQuality(CULL_QUALITY);
    renderer.reset(framed);
    renderer.iterate({ genome: framed, seed: freshSeed(), walkers: WALKERS, itersPerWalker: probeIters });
    let totalSamples = WALKERS * probeIters;
    const probe = await presentAndClassify(framed, totalSamples);
    if (!probe.verdict.ok) return probe; // degenerate — skip the rest

    // Survivor: continue accumulating into the same hot histogram to full quality.
    const moreIters = itersForQuality(QUALITY) - probeIters;
    if (moreIters > 0) {
      renderer.iterate({ genome: framed, seed: freshSeed(), walkers: WALKERS, itersPerWalker: moreIters });
      totalSamples += WALKERS * moreIters;
    }
    return presentAndClassify(framed, totalSamples);
  }

  return {
    renderThumb,
    destroy: () => { renderer.destroy(); scratchTex.destroy(); scratchBuf.destroy(); },
  };
}
