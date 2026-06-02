// pyr3 — flam3 spatial-filter kernel builder + shape evaluators.
//
// Builds discrete 1D convolution kernels for flam3's 14 canonical AA filter
// shapes (gaussian + hermite/box/triangle/bell/bspline/mitchell/blackman/
// catrom/hanning/hamming/lanczos3/lanczos2/quadratic), ported verbatim from
// `filters.c:47-202` (per-shape evaluators) + `filters.c:217-269` (kernel
// build). Runtime today wires only `gaussian` via `buildGaussianKernel` (the
// renderer's DE path); the other 13 evaluators stay live as a parse seam
// for `Genome.spatialFilter` round-trips.

import { type SpatialFilterShape } from './genome';

// Per-shape support (kernel half-width in unit-radius space). Mirrors
// `flam3_spatial_support[]` in filters.c:29-45 — entries here are keyed by
// the pyr3 XML attribute string instead of the C enum index.
export const SHAPE_SUPPORT: Readonly<Record<SpatialFilterShape, number>> = {
  gaussian: 1.5,
  hermite: 1.0,
  box: 0.5,
  triangle: 1.0,
  bell: 1.5,
  bspline: 2.0,
  mitchell: 2.0,
  blackman: 1.0,
  catrom: 2.0,
  hanning: 1.0,
  hamming: 1.0,
  lanczos3: 3.0,
  lanczos2: 2.0,
  quadratic: 1.5,
};

// Mitchell-Netravali constants per flam3 `private.h:150-151`. flam3 picks
// B=C=1/3 (the canonical "Mitchell" parameterization; equivalent to
// ImageMagick's default). NOT the cubic-bspline (B=1, C=0) or catrom (B=0,
// C=0.5) corners of the same family.
const MITCHELL_B = 1.0 / 3.0;
const MITCHELL_C = 1.0 / 3.0;

// flam3's sinc helper (`filters.c:92-96`): sinc(x) = sin(π·x) / (π·x), with
// the limit value 1.0 at x=0. Used as the modulating envelope for the
// windowed-sinc family (blackman/hanning/hamming) AND as the secondary window
// inside lanczos2/lanczos3 (which already contain one sinc layer).
function sinc(x: number): number {
  const px = x * Math.PI;
  if (px === 0) return 1.0;
  return Math.sin(px) / px;
}

/**
 * Evaluate a flam3 spatial filter shape at offset `x` (in unit-radius space).
 * Returns the filter value before normalization. Each branch ports the
 * corresponding `flam3_<shape>_filter` from `filters.c:47-202` verbatim.
 *
 * Note on the windowed-sinc family (blackman/hanning/hamming): flam3's
 * `flam3_spatial_filter` dispatcher (filters.c:172-202) multiplies the raw
 * envelope by `flam3_sinc(x)`. lanczos2/lanczos3 are double-windowed —
 * the raw `flam3_lanczos{N}_filter` already contains one sinc layer, then
 * the dispatcher applies a SECOND sinc(x/N). This function folds both
 * layers into the per-shape evaluation so callers get the dispatcher's
 * final value directly.
 */
export function evalShape(shape: SpatialFilterShape, x: number): number {
  switch (shape) {
    case 'gaussian': {
      // filters.c:156-158: exp(-2·x²) · sqrt(2/π).
      // sqrt(2/π) is a constant multiplier that washes out under per-kernel
      // sum-normalize, so we drop it for numerical stability. Pre-fix and
      // post-fix kernels are identical after normalize_vector.
      return Math.exp(-2.0 * x * x);
    }
    case 'hermite': {
      // filters.c:47-52: 2|t|³ - 3|t|² + 1 on [-1, 1], 0 outside.
      const t = Math.abs(x);
      if (t < 1.0) return (2.0 * t - 3.0) * t * t + 1.0;
      return 0.0;
    }
    case 'box': {
      // filters.c:54-57: 1 on (-0.5, 0.5], 0 outside. flam3's open-left /
      // closed-right boundary is preserved.
      if (x > -0.5 && x <= 0.5) return 1.0;
      return 0.0;
    }
    case 'triangle': {
      // filters.c:59-63: 1 - |t| on [-1, 1], 0 outside.
      const t = Math.abs(x);
      if (t < 1.0) return 1.0 - t;
      return 0.0;
    }
    case 'bell': {
      // filters.c:65-74: (3-box convolution). Piecewise quadratic on [-1.5, 1.5].
      let t = Math.abs(x);
      if (t < 0.5) return 0.75 - t * t;
      if (t < 1.5) {
        t = t - 1.5;
        return 0.5 * t * t;
      }
      return 0.0;
    }
    case 'bspline': {
      // filters.c:76-90: (4-box convolution). Cubic B-spline on [-2, 2].
      let t = Math.abs(x);
      if (t < 1.0) {
        const tt = t * t;
        return 0.5 * tt * t - tt + 2.0 / 3.0;
      }
      if (t < 2.0) {
        t = 2.0 - t;
        return (1.0 / 6.0) * t * t * t;
      }
      return 0.0;
    }
    case 'mitchell': {
      // filters.c:116-134 with B=C=1/3 (private.h:150-151).
      const tt = x * x;
      let t = Math.abs(x);
      if (t < 1.0) {
        const v =
          (12.0 - 9.0 * MITCHELL_B - 6.0 * MITCHELL_C) * (t * tt) +
          (-18.0 + 12.0 * MITCHELL_B + 6.0 * MITCHELL_C) * tt +
          (6.0 - 2.0 * MITCHELL_B);
        return v / 6.0;
      }
      if (t < 2.0) {
        const v =
          (-1.0 * MITCHELL_B - 6.0 * MITCHELL_C) * (t * tt) +
          (6.0 * MITCHELL_B + 30.0 * MITCHELL_C) * tt +
          (-12.0 * MITCHELL_B - 48.0 * MITCHELL_C) * t +
          (8.0 * MITCHELL_B + 24.0 * MITCHELL_C);
        return v / 6.0;
      }
      return 0.0;
    }
    case 'blackman': {
      // filters.c:98-100 envelope × dispatcher sinc(x) — filters.c:188-189.
      // Envelope: 0.42 + 0.5·cos(π·x) + 0.08·cos(2π·x).
      const env = 0.42 + 0.5 * Math.cos(Math.PI * x) + 0.08 * Math.cos(2.0 * Math.PI * x);
      return sinc(x) * env;
    }
    case 'catrom': {
      // filters.c:102-114: Catmull-Rom spline (cubic, B=0, C=0.5 corner of the
      // BC family but flam3 hardcodes the coefficients). Piecewise cubic on
      // [-2, 2]. Note flam3 evaluates the SIGNED x, not |x| — the polynomial
      // pieces are anti-symmetric around 0 but the conditionals are signed.
      if (x < -2.0) return 0.0;
      if (x < -1.0) return 0.5 * (4.0 + x * (8.0 + x * (5.0 + x)));
      if (x < 0.0) return 0.5 * (2.0 + x * x * (-5.0 - 3.0 * x));
      if (x < 1.0) return 0.5 * (2.0 + x * x * (-5.0 + 3.0 * x));
      if (x < 2.0) return 0.5 * (4.0 + x * (-8.0 + x * (5.0 - x)));
      return 0.0;
    }
    case 'hanning': {
      // filters.c:136-138 envelope × dispatcher sinc(x) — filters.c:192-193.
      // Envelope: 0.5 + 0.5·cos(π·x).
      const env = 0.5 + 0.5 * Math.cos(Math.PI * x);
      return sinc(x) * env;
    }
    case 'hamming': {
      // filters.c:140-142 envelope × dispatcher sinc(x) — filters.c:194-195.
      // Envelope: 0.54 + 0.46·cos(π·x).
      const env = 0.54 + 0.46 * Math.cos(Math.PI * x);
      return sinc(x) * env;
    }
    case 'lanczos3': {
      // filters.c:144-148 base (sinc(t) · sinc(t/3) on [-3, 3]) × dispatcher
      // sinc(x/3) — filters.c:196-197. The double-sinc inside ÷ outside layout
      // matches flam3's quirky lanczos3 dispatcher; the result is
      // sinc(t)·sinc(t/3)² on [-3, 3].
      const t = Math.abs(x);
      if (t < 3.0) return sinc(t) * sinc(t / 3.0) * sinc(x / 3.0);
      return 0.0;
    }
    case 'lanczos2': {
      // filters.c:150-154 base × dispatcher sinc(x/2) — filters.c:198-199.
      // sinc(t)·sinc(t/2)² on [-2, 2].
      const t = Math.abs(x);
      if (t < 2.0) return sinc(t) * sinc(t / 2.0) * sinc(x / 2.0);
      return 0.0;
    }
    case 'quadratic': {
      // filters.c:160-170: piecewise quadratic on [-1.5, 1.5]. Like `bell`
      // shape but with different coefficient placement at the wings.
      if (x < -1.5) return 0.0;
      if (x < -0.5) return 0.5 * (x + 1.5) * (x + 1.5);
      if (x < 0.5) return 0.75 - x * x;
      if (x < 1.5) return 0.5 * (x - 1.5) * (x - 1.5);
      return 0.0;
    }
  }
}

// Maximum kernel half-width (cap on (fwidth - 1) / 2). flam3-faithful kernel
// width grows as ~3 × radius, so this caps the input radius at ~5 effectively.
// Real-world flames use radius ≤ 2; the cap is conservative.
export const MAX_KERNEL_HALFWIDTH = 8;
export const MAX_KERNEL_TAPS = 2 * MAX_KERNEL_HALFWIDTH + 1;

/**
 * Build a discrete 1D spatial-filter kernel matching flam3's
 * `flam3_create_spatial_filter` (`filters.c:217-269`) at `aspect_ratio=1`.
 * The kernel half-width grows as `~SUPPORT × oversample × radius`
 * super-pixels, matching flam3's filter-during-supersample-collapse semantics.
 *
 * Math (filters.c:217-269): SF_SUPP = SHAPE_SUPPORT[shape];
 * fw = 2 × SF_SUPP × oversample × radius;
 * fwidth = floor(fw) + 1, parity-adjusted so (fwidth XOR oversample) is even
 * — odd `oversample` produces odd `fwidth` (kernel centered on a super-pixel),
 * even `oversample` produces even `fwidth` (kernel centered between super-
 * pixels); adjust = SF_SUPP × fwidth / fw; x_i = ((2i+1)/fwidth - 1) × adjust;
 * tap_i = evalShape(shape, x_i). Then normalize so Σ kernel = 1.
 *
 * @param shape filter shape (one of `SPATIAL_FILTER_SHAPES`).
 * @param radius filter radius in OUTPUT pixels (must be > 0).
 * @param oversample super-resolution multiplier (≥ 1). Default 1.
 * @returns Float32Array of length in [3, MAX_KERNEL_TAPS].
 */
export function buildSpatialKernel(
  shape: SpatialFilterShape,
  radius: number,
  oversample = 1,
): Float32Array {
  if (!(radius > 0)) {
    throw new Error(`pyr3: spatial-filter radius must be positive, got ${radius}`);
  }
  if (!(oversample >= 1) || !Number.isInteger(oversample)) {
    throw new Error(`pyr3: oversample must be a positive integer, got ${oversample}`);
  }
  const SF_SUPP = SHAPE_SUPPORT[shape];
  const ASPECT_RATIO = 1.0; // square pixels assumed

  const fw = (2.0 * SF_SUPP * oversample * radius) / ASPECT_RATIO;
  let fwidth = Math.floor(fw) + 1;
  // filters.c:233-234 — parity match against oversample.
  if (((fwidth ^ oversample) & 1) !== 0) fwidth++;
  // Clamp to [3, MAX_KERNEL_TAPS]; min 3 ensures we always have wings even
  // when SF_SUPP × radius is sub-pixel-tiny.
  fwidth = Math.max(3, Math.min(MAX_KERNEL_TAPS, fwidth));

  const adjust = fw > 0 ? (SF_SUPP * fwidth) / fw : 1.0;
  const out = new Float32Array(fwidth);
  let sum = 0;
  for (let i = 0; i < fwidth; i++) {
    const x = ((2.0 * i + 1.0) / fwidth - 1.0) * adjust;
    const v = evalShape(shape, x);
    out[i] = v;
    sum += v;
  }
  // flam3's `normalize_vector` (filters.c:204-214) bails out when sum=0; we
  // preserve that — an all-zero kernel here means the shape has no support at
  // the sampled offsets (impossible for the 14 shapes at fwidth ≥ 3 and the
  // parity-matched sampling, but guard the divide for defensive symmetry).
  if (sum !== 0) {
    for (let i = 0; i < fwidth; i++) out[i]! /= sum;
  }
  return out;
}

/**
 * @deprecated Phase 9-filter-shapes: prefer `buildSpatialKernel('gaussian',
 * radius, oversample)`. Retained as a thin alias because `spatial-filter.test.ts`
 * + downstream tooling that pre-dated the shape extension still import the
 * old name.
 */
export function buildGaussianKernel(radius: number, oversample = 1): Float32Array {
  return buildSpatialKernel('gaussian', radius, oversample);
}

