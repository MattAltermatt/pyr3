import { describe, expect, it } from 'vitest';
import { buildGaussianKernel, buildSpatialKernel, evalShape, SHAPE_SUPPORT, MAX_KERNEL_TAPS } from './spatial-filter';
import { SPATIAL_FILTER_SHAPES, type SpatialFilterShape } from './genome';

// Kernel mirrors flam3 filt.c flam3_create_spatial_filter for
// filter_shape="gaussian" at supersample=1, aspect_ratio=1.
//   fw = 3 × radius
//   fwidth = floor(fw) + 1, parity-adjusted to odd (matches SS=1)
//   clamp to [3, MAX_KERNEL_TAPS]
//   adjust = 1.5 × fwidth / fw
//   x_i = ((2i+1)/fwidth - 1) × adjust
//   tap_i = exp(-2 × x_i²); normalize Σ=1.

describe('buildGaussianKernel', () => {
  it('sums to 1.0 for radius=1', () => {
    const k = buildGaussianKernel(1);
    const sum = k.reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('sums to 1.0 for radius=3', () => {
    const k = buildGaussianKernel(3);
    const sum = k.reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('is symmetric (radius=3)', () => {
    const k = buildGaussianKernel(3);
    for (let i = 0; i < Math.floor(k.length / 2); i++) {
      expect(k[i]!).toBeCloseTo(k[k.length - 1 - i]!, 6);
    }
  });

  it('center tap is the maximum (radius=2)', () => {
    const k = buildGaussianKernel(2);
    const center = (k.length - 1) / 2;
    for (let i = 0; i < k.length; i++) {
      if (i === center) continue;
      expect(k[center]!).toBeGreaterThan(k[i]!);
    }
  });

  it('returns flam3-faithful fwidth for typical radii (parity-adjusted to odd)', () => {
    // radius=0.5: fw=1.5, fwidth=2 → parity-adjust → 3
    expect(buildGaussianKernel(0.5).length).toBe(3);
    // radius=1: fw=3, fwidth=4 → parity-adjust → 5
    expect(buildGaussianKernel(1).length).toBe(5);
    // radius=1.5: fw=4.5, fwidth=5 (already odd)
    expect(buildGaussianKernel(1.5).length).toBe(5);
    // radius=2: fw=6, fwidth=7 (already odd)
    expect(buildGaussianKernel(2).length).toBe(7);
    // radius=3: fw=9, fwidth=10 → parity-adjust → 11
    expect(buildGaussianKernel(3).length).toBe(11);
  });

  it('always returns an odd-length kernel (centered on output pixel)', () => {
    for (const r of [0.5, 0.8, 1, 1.5, 2, 3, 4, 5]) {
      expect(buildGaussianKernel(r).length % 2).toBe(1);
    }
  });

  it('subpixel radius rounds half-width up to at least 3 taps', () => {
    expect(buildGaussianKernel(0.1).length).toBe(3);
    expect(buildGaussianKernel(0.5).length).toBe(3);
  });

  it('rejects non-positive radius', () => {
    expect(() => buildGaussianKernel(0)).toThrow(/positive/);
    expect(() => buildGaussianKernel(-1)).toThrow(/positive/);
  });

  it('caps kernel length at MAX_KERNEL_TAPS', () => {
    const k = buildGaussianKernel(50);
    expect(k.length).toBe(MAX_KERNEL_TAPS);
  });

  it('scales fwidth with oversample (filt.c:225 — fw = 2 × 1.5 × oversample × radius)', () => {
    // oversample=1, radius=1: fw=3, fwidth=4 → parity-adjust → 5 (odd matches odd SS)
    expect(buildGaussianKernel(1, 1).length).toBe(5);
    // oversample=2, radius=1: fw=6, fwidth=7 → parity-adjust → 8 (even matches even SS)
    // BUT capped at MAX_KERNEL_TAPS=17, so 8 stays.
    expect(buildGaussianKernel(1, 2).length).toBe(8);
    // oversample=4, radius=1: fw=12, fwidth=13 → parity-adjust → 14 (even matches even SS).
    expect(buildGaussianKernel(1, 4).length).toBe(14);
    // oversample=4, radius=0.5: fw=6, fwidth=7 → 8 (parity to even).
    expect(buildGaussianKernel(0.5, 4).length).toBe(8);
  });

  it('preserves kernel sum=1 across oversample values', () => {
    for (const ss of [1, 2, 3, 4]) {
      const k = buildGaussianKernel(1, ss);
      const sum = k.reduce((s, v) => s + v, 0);
      expect(sum, `oversample=${ss}`).toBeCloseTo(1, 6);
    }
  });

  it('rejects non-integer / non-positive oversample', () => {
    expect(() => buildGaussianKernel(1, 0)).toThrow(/positive integer/);
    expect(() => buildGaussianKernel(1, -1)).toThrow(/positive integer/);
    expect(() => buildGaussianKernel(1, 1.5)).toThrow(/positive integer/);
  });

  it('matches flam3 reference values at radius=1 (5-tap, fw=3, adjust=2.5)', () => {
    // fw = 2 × 1.5 × 1 × 1 = 3; fwidth = floor(3)+1 = 4 → parity-adjust → 5
    // adjust = 1.5 × 5 / 3 = 2.5
    // x_i = ((2i+1)/5 - 1) × 2.5 for i=0..4: -2.0, -1.0, 0.0, 1.0, 2.0
    // exp(-2x²) → 3.355e-4, 0.13534, 1.0, 0.13534, 3.355e-4
    // sum ≈ 1.27135; normalized: ~ [2.638e-4, 0.10645, 0.78657, 0.10645, 2.638e-4]
    const k = buildGaussianKernel(1);
    expect(k.length).toBe(5);
    expect(k[2]!).toBeCloseTo(0.78657, 3);
    expect(k[1]!).toBeCloseTo(0.10645, 3);
    expect(k[3]!).toBeCloseTo(0.10645, 3);
    expect(k[0]!).toBeCloseTo(0.000264, 4);
    expect(k[4]!).toBeCloseTo(0.000264, 4);
  });
});

// Phase 9-filter-shapes: per-shape evaluator parity with flam3 `filters.c`
// (47-202). Each test pins the hand-computed value at one or two key sample
// points + boundary behavior. The dispatcher-included sinc multipliers for
// the windowed-sinc family (blackman/hanning/hamming/lanczos2/lanczos3)
// are folded into evalShape, so a value at x=0 reflects the FINAL dispatcher
// output, not just the raw envelope.
describe('evalShape — per-shape evaluator (flam3 filters.c parity)', () => {
  // ----- compact polynomial / piecewise shapes ----------------------------

  it('hermite: f(0)=1, f(0.5)=0.5, f(1)=0, f(1.5)=0 (filters.c:47-52)', () => {
    expect(evalShape('hermite', 0)).toBe(1.0);
    // 2·0.125 - 3·0.25 + 1 = 0.25 - 0.75 + 1 = 0.5
    expect(evalShape('hermite', 0.5)).toBeCloseTo(0.5, 10);
    expect(evalShape('hermite', 1.0)).toBe(0.0); // boundary excluded (t<1)
    expect(evalShape('hermite', 1.5)).toBe(0.0);
    // Symmetric around 0
    expect(evalShape('hermite', -0.5)).toBeCloseTo(evalShape('hermite', 0.5), 10);
  });

  it('box: 1 on (-0.5, 0.5], 0 outside; boundary quirks match flam3 (filters.c:54-57)', () => {
    expect(evalShape('box', 0)).toBe(1.0);
    expect(evalShape('box', 0.5)).toBe(1.0); // closed-right
    expect(evalShape('box', -0.5)).toBe(0.0); // open-left (flam3 t > -0.5)
    expect(evalShape('box', 0.499)).toBe(1.0);
    expect(evalShape('box', 0.501)).toBe(0.0);
    expect(evalShape('box', 1.0)).toBe(0.0);
  });

  it('triangle: f(0)=1, f(0.5)=0.5, f(1)=0 (filters.c:59-63)', () => {
    expect(evalShape('triangle', 0)).toBe(1.0);
    expect(evalShape('triangle', 0.5)).toBe(0.5);
    expect(evalShape('triangle', 1.0)).toBe(0.0);
    expect(evalShape('triangle', -0.25)).toBe(0.75);
  });

  it('bell: f(0)=0.75, f(0.5)=0.5, f(1.5)=0 (filters.c:65-74)', () => {
    expect(evalShape('bell', 0)).toBe(0.75);
    // |t|=0.5 boundary: 0.5*0.5 = 0.25 via the t<1.5 branch (t' = 0.5-1.5 = -1.0)
    // BUT flam3's t<0.5 branch fires first: 0.75 - 0.25 = 0.5
    expect(evalShape('bell', 0.5)).toBeCloseTo(0.5, 10);
    expect(evalShape('bell', 1.0)).toBeCloseTo(0.125, 10); // 0.5 * 0.5² = 0.125
    expect(evalShape('bell', 1.5)).toBe(0.0);
    expect(evalShape('bell', 2.0)).toBe(0.0);
  });

  it('bspline: f(0)=2/3, f(1)=1/6, f(2)=0 (filters.c:76-90)', () => {
    expect(evalShape('bspline', 0)).toBeCloseTo(2.0 / 3.0, 10);
    // At t=1 the t<2 branch fires: t'=1, return (1/6) · 1 = 1/6
    expect(evalShape('bspline', 1.0)).toBeCloseTo(1.0 / 6.0, 10);
    expect(evalShape('bspline', 2.0)).toBe(0.0);
    // Cubic interior: t=0.5 → 0.5·0.125 - 0.25 + 2/3 = 0.0625 - 0.25 + 0.6667 ≈ 0.4792
    expect(evalShape('bspline', 0.5)).toBeCloseTo(0.0625 - 0.25 + 2.0 / 3.0, 8);
  });

  it('mitchell: f(0)=8/9, f(1)=1/18, f(2)=0 (Mitchell B=C=1/3, filters.c:116-134)', () => {
    // At t=0: ((6 - 2·B)/6) = (6 - 2/3)/6 = 16/18 = 8/9
    expect(evalShape('mitchell', 0)).toBeCloseTo(8.0 / 9.0, 8);
    expect(evalShape('mitchell', 2.0)).toBe(0.0);
    // At t=1 inner-poly evaluates to 1/18 with B=C=1/3 (cross-check value)
    expect(evalShape('mitchell', 1.0)).toBeCloseTo(1.0 / 18.0, 6);
    // Symmetric
    expect(evalShape('mitchell', -0.5)).toBeCloseTo(evalShape('mitchell', 0.5), 8);
  });

  // ----- piecewise SIGNED-x shapes (catrom, quadratic) -------------------

  it('catrom: f(0)=1, f(-1)=0, f(1)=0, f(2)=0 (filters.c:102-114)', () => {
    // x=0 falls into "x<1" branch: 0.5·(2+0·(...)) = 1
    expect(evalShape('catrom', 0)).toBeCloseTo(1.0, 10);
    // x=1 hits "x<2" branch: 0.5·(4 + 1·(-8 + 1·(5 - 1))) = 0.5·(4 + (-8 + 4)) = 0.5·0 = 0
    expect(evalShape('catrom', 1.0)).toBeCloseTo(0.0, 10);
    // x=-1 hits "x<0" branch: 0.5·(2 + 1·(-5 + 3)) = 0.5·(2 + (-2)) = 0
    expect(evalShape('catrom', -1.0)).toBeCloseTo(0.0, 10);
    expect(evalShape('catrom', 2.0)).toBe(0.0);
    expect(evalShape('catrom', -2.0)).toBe(0.0);
  });

  it('quadratic: f(0)=0.75, f(±0.5)=0.5, f(±1.5)=0 (filters.c:160-170)', () => {
    // x=0: in [-0.5, 0.5) → 0.75 - 0 = 0.75
    expect(evalShape('quadratic', 0)).toBe(0.75);
    // x=0.5: in [0.5, 1.5) → 0.5·(0.5-1.5)² = 0.5·1 = 0.5
    expect(evalShape('quadratic', 0.5)).toBeCloseTo(0.5, 10);
    // x=-0.5: in [-1.5, -0.5) → 0.5·(-0.5+1.5)² = 0.5
    expect(evalShape('quadratic', -0.5)).toBeCloseTo(0.5, 10);
    expect(evalShape('quadratic', 1.5)).toBe(0.0);
    expect(evalShape('quadratic', -1.5)).toBe(0.0);
  });

  // ----- windowed-sinc shapes (dispatcher folds sinc into the envelope) --

  it('blackman: f(0)=1.0 (envelope=1, sinc(0)=1; filters.c:98-100 × 188-189)', () => {
    // 0.42 + 0.5·cos(0) + 0.08·cos(0) = 0.42 + 0.5 + 0.08 = 1.0; sinc(0)=1.
    expect(evalShape('blackman', 0)).toBeCloseTo(1.0, 10);
    // At x=1, sinc(1) = sin(π)/π = 0 → final value is 0 regardless of envelope.
    expect(evalShape('blackman', 1.0)).toBeCloseTo(0.0, 10);
  });

  it('hanning: f(0)=1, f(1)=0 via sinc-zero (filters.c:136-138 × 192-193)', () => {
    // 0.5 + 0.5·cos(0) = 1.0; sinc(0) = 1.
    expect(evalShape('hanning', 0)).toBeCloseTo(1.0, 10);
    // sinc(1) = 0 → dispatcher output = 0 regardless of envelope (~0).
    expect(evalShape('hanning', 1.0)).toBeCloseTo(0.0, 10);
  });

  it('hamming: f(0)=1, f(1)=0 via sinc-zero (filters.c:140-142 × 194-195)', () => {
    // 0.54 + 0.46·cos(0) = 1.0; sinc(0) = 1.
    expect(evalShape('hamming', 0)).toBeCloseTo(1.0, 10);
    expect(evalShape('hamming', 1.0)).toBeCloseTo(0.0, 10);
  });

  it('lanczos2: f(0)=1, f(1)=0 via sinc, f(2)=0 boundary (filters.c:150-154 × 198-199)', () => {
    // f(0) = sinc(0) · sinc(0/2) · sinc(0/2) = 1·1·1 = 1.
    expect(evalShape('lanczos2', 0)).toBeCloseTo(1.0, 10);
    // f(1) = sinc(1) · sinc(0.5)² = 0 · (...) · sinc(0.5) — the leading sinc(1) zeroes it.
    expect(evalShape('lanczos2', 1.0)).toBeCloseTo(0.0, 10);
    expect(evalShape('lanczos2', 2.0)).toBe(0.0); // outside support
  });

  it('lanczos3: f(0)=1, f(1)=0 via sinc, f(3)=0 boundary (filters.c:144-148 × 196-197)', () => {
    expect(evalShape('lanczos3', 0)).toBeCloseTo(1.0, 10);
    expect(evalShape('lanczos3', 1.0)).toBeCloseTo(0.0, 10);
    expect(evalShape('lanczos3', 3.0)).toBe(0.0);
  });

  // ----- gaussian (re-test under the new dispatch shape) -----------------

  it('gaussian: f(0)=1 (pre-normalize), f(±SUPPORT)≈small (filters.c:156-158)', () => {
    // The dropped sqrt(2/π) prefactor (see evalShape gaussian branch) means
    // evalShape returns exp(-2x²) directly. f(0)=exp(0)=1.
    expect(evalShape('gaussian', 0)).toBe(1.0);
    expect(evalShape('gaussian', 0.5)).toBeCloseTo(Math.exp(-0.5), 10);
    expect(evalShape('gaussian', 1.0)).toBeCloseTo(Math.exp(-2.0), 10);
  });

  // ----- structural invariants across all shapes -------------------------

  // 10 of the 14 shapes have **compact support** — their flam3 evaluator
  // has an explicit `if (t < N) ...; return 0` guard (filters.c:47-170).
  // The other 4 (gaussian / blackman / hanning / hamming) are unbounded —
  // flam3 picks `flam3_spatial_support[]` for kernel-build half-width, but
  // the math itself never hard-zeroes. The kernel build never SAMPLES
  // outside support either way; this invariant is just a sanity check on
  // the hard-zero family.
  const HARD_ZERO_SHAPES: SpatialFilterShape[] = [
    'hermite',
    'box',
    'triangle',
    'bell',
    'bspline',
    'mitchell',
    'catrom',
    'lanczos2',
    'lanczos3',
    'quadratic',
  ];

  it.each(HARD_ZERO_SHAPES)('%s: f(±beyond-support) = 0 (compact support)', (shape) => {
    const xs = SHAPE_SUPPORT[shape] + 1.0;
    expect(evalShape(shape, xs)).toBe(0.0);
    expect(evalShape(shape, -xs)).toBe(0.0);
  });

  it.each(['gaussian', 'blackman', 'hanning', 'hamming'] as const)(
    '%s: f(±beyond-support) is tiny (continuous, not hard-zeroed)',
    (shape) => {
      const xs = SHAPE_SUPPORT[shape] + 1.0;
      // < 0.01 captures gaussian's exponential decay at x>SUPPORT and the
      // float-noise zeros of the windowed-sinc family.
      expect(Math.abs(evalShape(shape, xs))).toBeLessThan(0.01);
      expect(Math.abs(evalShape(shape, -xs))).toBeLessThan(0.01);
    },
  );

  it.each(
    // catrom uses SIGNED x branches (not |x|), so anti-symmetric flam3 polynomial
    // pieces produce slight numerical drift; everything else is symmetric.
    SPATIAL_FILTER_SHAPES.filter((s) => s !== 'catrom' && s !== 'box'),
  )('%s: f(x) = f(-x) (even / symmetric)', (shape) => {
    for (const x of [0.1, 0.5, 0.9]) {
      expect(evalShape(shape, x)).toBeCloseTo(evalShape(shape, -x), 10);
    }
  });

  it('box is asymmetric at the closed-right / open-left boundary (flam3-faithful)', () => {
    expect(evalShape('box', 0.5)).toBe(1.0);
    expect(evalShape('box', -0.5)).toBe(0.0);
  });
});

describe('buildSpatialKernel — kernel build dispatches on shape', () => {
  it.each(SPATIAL_FILTER_SHAPES)('%s: kernel sums to 1 at radius=1, oversample=1', (shape) => {
    const k = buildSpatialKernel(shape, 1);
    const sum = k.reduce((s, v) => s + v, 0);
    expect(sum, `shape=${shape}`).toBeCloseTo(1.0, 6);
  });

  it.each(SPATIAL_FILTER_SHAPES)('%s: kernel length matches SF_SUPP × radius parity rule', (shape) => {
    // fw = 2 × SUPPORT × 1 × 1 = 2·SUPPORT; fwidth = floor(fw)+1, parity to odd
    // (oversample=1 → fwidth XOR 1 even → fwidth odd). All 14 shapes share
    // the same kernel-build pipeline, so each should produce an odd kernel.
    const k = buildSpatialKernel(shape, 1, 1);
    expect(k.length % 2, `shape=${shape}`).toBe(1);
    expect(k.length).toBeGreaterThanOrEqual(3);
    expect(k.length).toBeLessThanOrEqual(MAX_KERNEL_TAPS);
  });

  it('larger SF_SUPP produces wider kernel at same radius', () => {
    // Per SHAPE_SUPPORT: box=0.5 (narrowest), lanczos3=3.0 (widest)
    const narrow = buildSpatialKernel('box', 1);
    const wide = buildSpatialKernel('lanczos3', 1);
    expect(wide.length).toBeGreaterThan(narrow.length);
  });

  it.each(SPATIAL_FILTER_SHAPES)('%s: kernel symmetric (for oversample=1, odd kernels)', (shape) => {
    const k = buildSpatialKernel(shape, 1.5, 1);
    // Catrom + box are technically asymmetric at the dispatcher level
    // (signed-x branches / boundary conventions), but the parity-matched
    // sampling grid (x_i = ((2i+1)/fwidth - 1) × adjust) places samples
    // symmetrically around 0, so the kernel taps are still mirror-symmetric.
    // Skip box because the boundary at exactly x = ±0.5 can land on different
    // sides of the closed-right / open-left split depending on radius.
    if (shape === 'box') return;
    for (let i = 0; i < Math.floor(k.length / 2); i++) {
      expect(k[i]!, `shape=${shape} i=${i}`).toBeCloseTo(k[k.length - 1 - i]!, 6);
    }
  });
});

describe('SHAPE_SUPPORT — mirrors flam3 flam3_spatial_support[] (filters.c:29-45)', () => {
  it('every shape has a defined support value', () => {
    for (const shape of SPATIAL_FILTER_SHAPES) {
      expect(typeof SHAPE_SUPPORT[shape], `shape=${shape}`).toBe('number');
      expect(SHAPE_SUPPORT[shape], `shape=${shape}`).toBeGreaterThan(0);
    }
  });

  it('matches flam3 enum-indexed support values', () => {
    // From filters.c:29-45; enum order matches parser.c:407-435 attr order.
    const expected: Record<SpatialFilterShape, number> = {
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
    for (const shape of SPATIAL_FILTER_SHAPES) {
      expect(SHAPE_SUPPORT[shape], `shape=${shape}`).toBe(expected[shape]);
    }
  });
});
