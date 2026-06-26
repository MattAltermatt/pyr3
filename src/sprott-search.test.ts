import { describe, it, expect } from 'vitest';
import { lyapunov, coverage, vetSprottCoeffs, generateSprottGenome, SPROTT_SEARCH } from './sprott-search';
import { V } from './variations';
import { isAttractorCollapsed } from './edit-fit-viewport';

// A Slice-1 preset's 12 coeffs (sprott-1): chaotic + high coverage.
const RICH = [-0.72092, 0.53529, 0.92536, -0.11898, 1.06441, 1.10974, -0.21011, 0.89531, -0.09822, -0.48153, -0.88715, -0.86533];
// Pure contraction toward origin: x' = 0.3x, y' = 0.3y (no quadratic) → not chaotic.
const CALM = [0, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0];

// deterministic LCG for reproducible tests
function lcg(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

describe('lyapunov', () => {
  it('is positive (> LE_MIN) for a known chaotic map', () => {
    expect(lyapunov(RICH)).toBeGreaterThan(SPROTT_SEARCH.LE_MIN);
  });
  it('is non-positive for a pure contraction', () => {
    expect(lyapunov(CALM)).toBeLessThanOrEqual(0);
  });
});

describe('coverage', () => {
  it('is high (> COV_MIN) for the rich attractor', () => {
    expect(coverage(RICH)).toBeGreaterThan(SPROTT_SEARCH.COV_MIN);
  });
  it('is below COV_MIN for the collapsing contraction', () => {
    expect(coverage(CALM)).toBeLessThan(SPROTT_SEARCH.COV_MIN);
  });
});

describe('vetSprottCoeffs', () => {
  it('returns 12 coeffs passing both gates', () => {
    // seed 777 is known to find a vetted set early (generateSprottGenome below
    // uses it). The default 200-roll cap has a ~3.6% give-up chance per seed, so
    // a fixed-seed "finds one" assertion must use a seed known to succeed.
    const c = vetSprottCoeffs(lcg(777));
    expect(c).not.toBeNull();
    expect(c!).toHaveLength(12);
    expect(lyapunov(c!)).toBeGreaterThan(SPROTT_SEARCH.LE_MIN);
    expect(coverage(c!)).toBeGreaterThan(SPROTT_SEARCH.COV_MIN);
  });
  it('gives up (null) when no rolls are allowed', () => {
    expect(vetSprottCoeffs(lcg(1), 0)).toBeNull();
  });
});

describe('generateSprottGenome', () => {
  it('builds a single-xform V323 genome that is renderable and not collapsed', () => {
    const g = generateSprottGenome(lcg(777));
    expect(g).not.toBeNull();
    expect(g!.xforms).toHaveLength(1);
    expect(g!.xforms[0]!.variations[0]!.index).toBe(V.sprott_poly);
    expect(g!.symmetry).toBeUndefined();
    expect(g!.xforms[0]!.post).toBeDefined();
    expect(Number.isFinite(g!.scale)).toBe(true);
    expect(isAttractorCollapsed(g!)).toBe(false);
  });
  it('is deterministic for a fixed seed', () => {
    const a = generateSprottGenome(lcg(999));
    const b = generateSprottGenome(lcg(999));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
