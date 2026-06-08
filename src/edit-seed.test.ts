import { describe, expect, it } from 'vitest';
import { generateRandomGenome, SEED_NONLINEAR, SEED_BIAS_VARIATIONS } from './edit-seed';

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('generateRandomGenome', () => {
  it('is deterministic for the same rng', () => {
    const a = generateRandomGenome(seededRng(42));
    const b = generateRandomGenome(seededRng(42));
    expect(a).toEqual(b);
  });

  it('produces a 4-xform genome with 1-3 variations each', () => {
    const g = generateRandomGenome(seededRng(1));
    expect(g.xforms).toHaveLength(4);
    for (const xf of g.xforms) {
      expect(xf.variations.length).toBeGreaterThanOrEqual(1);
      expect(xf.variations.length).toBeLessThanOrEqual(3);
      expect(xf.weight).toBeGreaterThan(0);
    }
    expect(g.palette.stops.length).toBeGreaterThan(0);
    // Palette name format from the curated library: '<human>#<idx>'.
    expect(g.palette.name).toMatch(/#\d+$/);
  });

  it("first variation of non-duplicator xforms is non-linear", () => {
    // Pure linear is allowed on duplicators, but non-duplicator xforms
    // must have a non-linear variation from the theme pool.
    for (let s = 0; s < 50; s++) {
      const g = generateRandomGenome(seededRng(s + 1));
      for (const xf of g.xforms) {
        if (xf.colorSpeed !== 0.0) {
          expect(SEED_NONLINEAR).toContain(xf.variations[0]!.index);
        } else {
          expect(xf.variations[0]!.index).toBe(0); // V.linear
        }
      }
    }
  });

  it('all variation indices come from the curated bias set', () => {
    const g = generateRandomGenome(seededRng(7));
    for (const xf of g.xforms) {
      for (const v of xf.variations) {
        expect(SEED_BIAS_VARIATIONS).toContain(v.index);
      }
    }
  });

  it('auto-fits viewport — scale > 1 and finite cx / cy', () => {
    for (let s = 0; s < 10; s++) {
      const g = generateRandomGenome(seededRng(s + 1));
      expect(g.scale).toBeGreaterThan(1);
      expect(g.scale).toBeLessThan(1_000_000);
      expect(Number.isFinite(g.cx)).toBe(true);
      expect(Number.isFinite(g.cy)).toBe(true);
    }
  });

  it('produces different output for different seeds', () => {
    const a = generateRandomGenome(seededRng(1));
    const b = generateRandomGenome(seededRng(2));
    expect(a).not.toEqual(b);
  });

  it('falls back to Math.random when no rng provided', () => {
    const g = generateRandomGenome();
    expect(g.xforms).toHaveLength(4);
  });

  it('does not set optional fields the editor expects to default in, except injected ones', () => {
    const g = generateRandomGenome(seededRng(1));
    expect(g.size).toBeUndefined();
    expect(g.quality).toBeUndefined();
    expect(g.finalxform).toBeUndefined();
    expect(g.density).toBeUndefined();
    expect(g.rotate).toBeUndefined();

    // Injected tonemap
    expect(g.tonemap).toBeDefined();
    expect(g.tonemap?.brightness).toBeGreaterThanOrEqual(2.5);
    expect(g.tonemap?.brightness).toBeLessThanOrEqual(4.5);
    expect(g.tonemap?.gamma).toBeGreaterThanOrEqual(3.5);
    expect(g.tonemap?.gamma).toBeLessThanOrEqual(4.0);
    expect(g.tonemap?.vibrancy).toBe(1.0);
    expect(g.tonemap?.highlightPower).toBe(1.0);
    expect(g.tonemap?.gammaThreshold).toBe(0.01);

    // Injected symmetry (if present)
    if (g.symmetry !== undefined) {
      expect(['rotational', 'dihedral']).toContain(g.symmetry.kind);
      expect([2, 3, 4, 5, 6, 8]).toContain(g.symmetry.n);
    }
  });

  it('injects symmetry approximately 50% of the time', () => {
    let symmetryCount = 0;
    const runs = 100;
    for (let s = 0; s < runs; s++) {
      const g = generateRandomGenome(seededRng(s));
      if (g.symmetry !== undefined) {
        symmetryCount++;
        expect(['rotational', 'dihedral']).toContain(g.symmetry.kind);
        expect([2, 3, 4, 5, 6, 8]).toContain(g.symmetry.n);
      }
    }
    // With 100 runs, we expect roughly 50 successes. We check for a reasonable range.
    expect(symmetryCount).toBeGreaterThanOrEqual(35);
    expect(symmetryCount).toBeLessThanOrEqual(65);
  });
});
