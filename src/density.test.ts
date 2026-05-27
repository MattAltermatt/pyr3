import { describe, it, expect } from 'vitest';
import { type Density, DEFAULT_DENSITY, radiusFor } from './density';

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
