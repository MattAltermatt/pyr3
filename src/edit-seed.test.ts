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

  it("first variation of every xform is non-linear", () => {
    // Pure linear would collapse the xform to its (contractive) affine —
    // no fractal structure. Sweep a range of seeds to guard the invariant.
    for (let s = 0; s < 50; s++) {
      const g = generateRandomGenome(seededRng(s + 1));
      for (const xf of g.xforms) {
        expect(SEED_NONLINEAR).toContain(xf.variations[0]!.index);
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
    // The contractive-affine seed recipe guarantees a real attractor, so
    // computeFitViewport should always return finite values; scale ends up
    // well above the 1-placeholder we set before fitting.
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

  it('does not set optional fields the editor expects to default in', () => {
    // edit-mount.ts applies its own defaults (size, quality) — the seed must
    // leave those undefined so the editor's policy wins.
    const g = generateRandomGenome(seededRng(1));
    expect(g.size).toBeUndefined();
    expect(g.quality).toBeUndefined();
    expect(g.finalxform).toBeUndefined();
    expect(g.symmetry).toBeUndefined();
    expect(g.density).toBeUndefined();
    expect(g.tonemap).toBeUndefined();
    expect(g.rotate).toBeUndefined();
  });
});
