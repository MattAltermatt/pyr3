import { describe, it, expect } from 'vitest';
import { type Density, DEFAULT_DENSITY, radiusFor, buildKernelNormLut } from './density';

describe('radiusFor', () => {
  it('returns maxRad when count is 0', () => {
    expect(radiusFor(0, DEFAULT_DENSITY)).toBe(DEFAULT_DENSITY.maxRad);
  });

  it('clamps to minRad for very large counts', () => {
    const d: Density = { maxRad: 9, minRad: 1, curve: 0.4 };
    expect(radiusFor(1e9, d)).toBe(1);
  });

  it('is monotonically non-increasing in count', () => {
    let prev = Infinity;
    for (const c of [0, 1, 5, 10, 50, 100, 1000, 10000]) {
      const r = radiusFor(c, DEFAULT_DENSITY);
      expect(r).toBeLessThanOrEqual(prev);
      prev = r;
    }
  });

  it('larger curve produces faster decay (smaller r) at fixed count', () => {
    const c = 100;
    const slow = radiusFor(c, { ...DEFAULT_DENSITY, curve: 0.2 });
    const fast = radiusFor(c, { ...DEFAULT_DENSITY, curve: 0.8 });
    expect(fast).toBeLessThan(slow);
  });

  it('clamps to minRad even when raw formula would go lower', () => {
    const d: Density = { maxRad: 9, minRad: 2, curve: 1.0 };
    // raw at count=1000 = 9 / 1001 ≈ 0.009, well below minRad
    expect(radiusFor(1000, d)).toBe(2);
  });
});

describe('DE kernel normalization (PYR3-056)', () => {
  const lut = buildKernelNormLut();

  // Replicate the shader's per-bucket scatter weight for a given radius:
  // sum over the disc of exp(-d²/2σ²)/knorm. The shape mirrors density.wgsl
  // density_main exactly.
  function scatteredWeight(radiusForCutoffAndSigma: number, lutIndex: number): number {
    const r = radiusForCutoffAndSigma;
    const sigma = Math.max(r / 3.0, 1e-6);
    const inv2s2 = 1.0 / (2.0 * sigma * sigma);
    const r2 = r * r;
    const knorm = Math.max(lut[lutIndex]!, 1e-6);
    const R = Math.ceil(r);
    let sum = 0;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        sum += Math.exp(-d2 * inv2s2) / knorm;
      }
    }
    return sum;
  }

  it('post-fix: each bucket scatters total weight ≈ 1.0 across an n_rad sweep', () => {
    // Sweep float radii (incl. values straddling round() boundaries) the way
    // the adaptive formula produces them, snap to the integer radius, and use
    // that ONE radius for cutoff, sigma, AND the LUT index — as density.wgsl
    // now does. Total scattered weight must be 1.0 (the normalization invariant).
    for (let nRadF = 1.0; nRadF <= 10.0; nRadF += 0.137) {
      const ri = Math.round(nRadF);
      const w = scatteredWeight(ri, ri); // same integer radius everywhere
      expect(w, `n_rad_f=${nRadF.toFixed(3)} → r=${ri}`).toBeCloseTo(1.0, 5);
    }
  });

  it('pre-fix mismatch is real: float cutoff/sigma + rounded LUT index drifts from 1.0', () => {
    // The OLD code used the FLOAT radius for cutoff + sigma but the ROUNDED
    // integer for the LUT index. Demonstrate that produced a non-unit weight
    // (the brightness ripple) at a radius that rounds down hard.
    const nRadF = 2.49; // rounds to 2, but the float disc/sigma are wider
    const wOld = scatteredWeight(nRadF, Math.round(nRadF));
    expect(Math.abs(wOld - 1.0)).toBeGreaterThan(0.1);
  });
});
