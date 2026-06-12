// pyr3 — channel histogram binning for the Color Curves overlay (#175).
//
// Bins post-tonemap, PRE-curve canvas pixels into 4×256 tonal histograms
// (R, G, B, Luma) drawn under the curve spline as a placement reference.
//
// Design (settled via dueling-agents review): the overlay shows the
// INPUT-referred distribution — the tones entering the curve LUT — so it
// stays still while the user drags spline points (curves are a present-pass
// op, so the pre-curve image is curve-invariant). The readback boundary in
// edit-mount.ts hands us tight, TRUE-RGBA bytes (bgra→rgba swap already done),
// so this module is GPU-free and format-agnostic.
//
// Bytes are display-encoded (post-tonemap, sRGB-ish). We bin them AS-IS and
// compute Luma via BT.709 in that same encoded space — do NOT linearize. A
// "what tonal ranges exist on screen" histogram is correct in display space;
// half-linearizing (Luma on linear, channels on encoded) would desync them.

export const HISTOGRAM_BINS = 256;

// Cap on pixels actually sampled per readback. A 1024² preview is ~1M pixels;
// binning all of them every settle is wasteful and the histogram shape is
// indistinguishable from a deterministic stride subsample of this size. The
// stride is derived from total/target, so the SAME image always samples the
// SAME pixels → frame-to-frame stable bins (no shimmer).
export const HISTOGRAM_TARGET_SAMPLES = 60000;

export interface ChannelHistogram {
  /** Per-bin pixel counts, length HISTOGRAM_BINS. */
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  luma: Uint32Array;
}

/** BT.709 luma of display-encoded bytes → nearest bin [0..255]. */
function lumaBin(r: number, g: number, b: number): number {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const bin = Math.round(y);
  return bin < 0 ? 0 : bin > 255 ? 255 : bin;
}

/**
 * Bin tight true-RGBA bytes into 4×256 channel histograms.
 *
 * @param rgba   tightly-packed RGBA (4 bytes/pixel), length ≥ width*height*4
 * @param width  image width in pixels
 * @param height image height in pixels
 * @param targetSamples deterministic-stride sample cap (default 60k)
 */
export function binChannels(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  targetSamples = HISTOGRAM_TARGET_SAMPLES,
): ChannelHistogram {
  const r = new Uint32Array(HISTOGRAM_BINS);
  const g = new Uint32Array(HISTOGRAM_BINS);
  const b = new Uint32Array(HISTOGRAM_BINS);
  const luma = new Uint32Array(HISTOGRAM_BINS);

  const total = Math.max(0, Math.floor(width * height));
  if (total === 0) return { r, g, b, luma };

  // Deterministic stride: every `stride`-th pixel, anchored at 0. Same image
  // → same sampled set → stable bins. stride ≥ 1.
  const stride = Math.max(1, Math.floor(total / Math.max(1, targetSamples)));

  for (let i = 0; i < total; i += stride) {
    const o = i * 4;
    const pr = rgba[o]!;
    const pg = rgba[o + 1]!;
    const pb = rgba[o + 2]!;
    r[pr] = r[pr]! + 1;
    g[pg] = g[pg]! + 1;
    b[pb] = b[pb]! + 1;
    const yl = lumaBin(pr, pg, pb);
    luma[yl] = luma[yl]! + 1;
  }
  return { r, g, b, luma };
}

/**
 * Scale integer bin counts to 0..1. Defaults to each histogram's own peak;
 * pass a shared `peak` (e.g. the max across R/G/B) so overlaid channels stay
 * height-comparable. Empty histogram (peak 0) → all-zero (no NaN).
 *
 * `scale='log'` maps heights through log1p — essential for fractal flames,
 * whose huge pure-black background produces a giant bin-0 spike that would
 * crush every mid-tone bin to ~0 under linear scaling. Log scaling reveals
 * the full distribution shape (the conventional fix for spiky image
 * histograms) while keeping the relative ordering of bin magnitudes.
 */
export function normalizeBins(
  bins: Uint32Array,
  peak?: number,
  scale: 'linear' | 'log' = 'linear',
): Float32Array {
  const out = new Float32Array(bins.length);
  let max = peak;
  if (max === undefined) {
    max = 0;
    for (const v of bins) if (v > max) max = v;
  }
  if (max <= 0) return out;
  if (scale === 'log') {
    const lp = Math.log1p(max);
    if (lp <= 0) return out;
    for (let i = 0; i < bins.length; i++) out[i] = Math.log1p(bins[i]!) / lp;
    return out;
  }
  for (let i = 0; i < bins.length; i++) out[i] = bins[i]! / max;
  return out;
}

/** Max count across one or more histograms — for shared-peak normalization. */
export function peakOf(...bins: Uint32Array[]): number {
  let max = 0;
  for (const arr of bins) for (const v of arr) if (v > max) max = v;
  return max;
}
