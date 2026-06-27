// Render-time auto-exposure (#475).
//
// Thin single-xform attractors (Gumowski-Mira / Hopalong) render near-black at
// HQ/4K while looking fine in the low-res gallery preview. Cause: their ink is a
// measure-zero 1-D filament. As output resolution r grows, the same total
// samples land on ~r× more filament buckets, so per-bucket `count ∝ r` grows and
// the log-density curve `ls = k1·log(1+count·k2)/count ∝ log(r)/r` shrinks — the
// filament body falls below the visible threshold even though the bright cores
// clip. Area-filling flames are resolution-stable (per-bucket count is
// resolution-invariant), so this only bites measure-zero sets. flam3-C has the
// same property; it is inherent to log-density tonemapping, not a pyr3 bug.
//
// This module makes any render's EXPOSURE match the genome's preview-resolution
// appearance: render a cheap probe at preview res, measure its mean luminance as
// the target, then scale `tonemap.brightness` at the actual resolution until the
// render hits the same target (re-running only the cheap visualize/tonemap pass
// via `present()` — never re-iterating the chaos game). The required factor is
// CONTENT-dependent (~8× for thin filaments, ~1× for area-fill) so it must be
// MEASURED, not computed from resolution.
//
// Auto-exposure is a render-time VIEWING TRANSFORM, like the flow/trap/phase
// color modes — NOT a genome mutation. The genome's authored `brightness` stays
// canonical (the embedded `pyr3` chunk + source .pyr3.json are untouched); a
// re-render with auto-exposure on reproduces the corrected image deterministically.
//
// Seam-safe: this module touches only createRenderer + an offscreen texture +
// readTextureTight (all environment-agnostic), so the same code runs in the
// browser and the CLI host with zero env branching.

import { type Genome } from './genome';
import { createRenderer } from './renderer';
import { readTextureTight } from './gpu-readback';
import { halfToFloat } from './half-float';
import { applyPreset, customSpec } from './presets';

// Probe geometry: match the viewer's default Preview tier (src/presets.ts
// QUALITY_TIERS[1] — 1024 long-edge, 16 spp) EXACTLY, so the auto-exposure
// target is literally "what the gallery shows on first paint". Both axes matter:
// for a thin (measure-zero) attractor, mean luminance falls with BOTH resolution
// AND sample count (more samples → a sharper, thinner, darker filament; measured
// q16→5.3, q200→2.7, q2000→0.3 at 1024px), so the probe must pin both to the
// preview's values, not just the long edge.
export const AE_PROBE_LONG_EDGE = 1024;
export const AE_PROBE_QUALITY = 16;
/** Fixed probe seed → the target (and thus the corrected master) is stable
 *  run-to-run rather than wobbling with the chaos game's random seed. */
export const AE_PROBE_SEED = 0x9e3779b9;
/** No-op deadband: when the brightness factor lands within ±this of 1.0, skip
 *  the correction entirely so well-exposed flames stay byte-identical to the
 *  un-corrected render. Collapses the default-on blast radius to "only flames
 *  that actually drift". */
export const AE_DEADBAND = 0.10;
/** Max present()+measure refinement passes (the brightness→luminance map is
 *  mildly non-linear through gamma, so one multiply lands close; a couple of
 *  refinements converge it). */
export const AE_MAX_ITERS = 4;
/** Brightness clamp — guards a pathological probe (e.g. all-black) from driving
 *  brightness to absurd values. */
export const AE_BRIGHTNESS_MIN = 1e-3;
export const AE_BRIGHTNESS_MAX = 1e4;

function clamp(x: number, lo: number, hi: number): number {
  // #388-class NaN guard: a NaN half-float pixel (Dawn writes them; see
  // gpu-readback.ts displayHalfToLinearExr) must NOT propagate — Math.max/min
  // pass NaN through, which would bypass fitBrightnessToTarget's guards and
  // present a NaN brightness. Treat non-finite as lo (= 0 for luminance), the
  // same choice displayHalfToLinearExr makes for NaN pixels.
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo;
}

/** Mean of (R+G+B)/3 across rgba8unorm pixels, in [0,255]. Empty → 0. */
export function computeMeanLuminance(pixels: Uint8Array): number {
  const n = pixels.length >>> 2;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    sum += (pixels[i]! + pixels[i + 1]! + pixels[i + 2]!) / 3;
  }
  return sum / n;
}

/** Mean luminance of an rgba16float buffer, mapped to the SAME [0,255] scale as
 *  `computeMeanLuminance` (clamp each channel to [0,1] → ×255). Lets the fit
 *  loop measure png16/exr (half-float) output comparably to the rgba8 probe. */
export function computeMeanLuminanceHalf(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const px = Math.floor(bytes.length / 8); // 4 channels × 2 bytes
  if (px === 0) return 0;
  let sum = 0;
  for (let i = 0; i < px; i++) {
    const base = i * 8;
    const r = clamp(halfToFloat(view.getUint16(base + 0, true)), 0, 1);
    const g = clamp(halfToFloat(view.getUint16(base + 2, true)), 0, 1);
    const b = clamp(halfToFloat(view.getUint16(base + 4, true)), 0, 1);
    sum += ((r + g + b) / 3) * 255;
  }
  return sum / px;
}

/** Render a preview-resolution probe of `genome` and return its mean luminance
 *  (the auto-exposure target). Builds + destroys its own renderer + texture.
 *  Seam-safe (createRenderer + readback only). */
export async function measureProbeLuminance(
  device: GPUDevice,
  genome: Genome,
  opts?: { longEdge?: number; quality?: number; seed?: number },
): Promise<number> {
  const longEdge = opts?.longEdge ?? AE_PROBE_LONG_EDGE;
  const quality = opts?.quality ?? AE_PROBE_QUALITY;
  // applyPreset force-rescales dims + scale to the probe long edge (preserving
  // the flame's aspect), so the probe frames the flame exactly like the gallery.
  const probe = applyPreset(genome, customSpec(longEdge, quality));
  const width = probe.size?.width ?? longEdge;
  const height = probe.size?.height ?? longEdge;
  const renderer = createRenderer(device, 'rgba8unorm', { width, height, oversample: 1 });
  const texture = device.createTexture({
    label: 'auto-exposure.probe',
    size: { width, height },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  try {
    renderer.render({ genome: probe, outputView: texture.createView(), seed: opts?.seed ?? AE_PROBE_SEED });
    await device.queue.onSubmittedWorkDone();
    const pixels = await readTextureTight(device, texture, width, height, 4);
    return computeMeanLuminance(pixels);
  } finally {
    texture.destroy();
    renderer.destroy();
  }
}

export interface BrightnessFit {
  /** Brightness to present the final HQ image at. */
  brightness: number;
  /** True iff the brightness was changed from `baseBrightness`. */
  corrected: boolean;
  /** Number of refinement re-presents performed. */
  iters: number;
  /** Final measured HQ mean luminance. */
  finalMean: number;
  /** factor = targetMean / initialHqMean (diagnostic). */
  factor: number;
}

/** Fixed-point fit of `brightness` so the HQ render's mean luminance matches
 *  `targetMean`. `initialHqMean` is the HQ mean already measured at
 *  `baseBrightness` (free — the host read it back to encode). `rerender(b)` must
 *  re-present the HQ texture at brightness `b` and return its measured mean
 *  luminance. Returns the un-changed brightness when the initial factor is
 *  within AE_DEADBAND (so well-exposed flames are byte-identical). */
export async function fitBrightnessToTarget(
  baseBrightness: number,
  targetMean: number,
  initialHqMean: number,
  rerender: (brightness: number) => Promise<number>,
): Promise<BrightnessFit> {
  const finite = Number.isFinite(targetMean) && Number.isFinite(initialHqMean);
  const factor0 = finite && initialHqMean > 0 ? targetMean / initialHqMean : 1;
  if (!finite || targetMean <= 0 || initialHqMean <= 0 || Math.abs(factor0 - 1) <= AE_DEADBAND) {
    return { brightness: baseBrightness, corrected: false, iters: 0, finalMean: initialHqMean, factor: factor0 };
  }
  let brightness = baseBrightness;
  let mean = initialHqMean;
  let iters = 0;
  for (let k = 0; k < AE_MAX_ITERS; k++) {
    const factor = targetMean / mean;
    if (Math.abs(factor - 1) <= AE_DEADBAND) break;
    brightness = clamp(brightness * factor, AE_BRIGHTNESS_MIN, AE_BRIGHTNESS_MAX);
    mean = await rerender(brightness);
    iters++;
    if (mean <= 0) break;
  }
  return { brightness, corrected: iters > 0, iters, finalMean: mean, factor: factor0 };
}
