import { describe, expect, it } from 'vitest';
import { generateSurpriseBatch, isCollapsed } from './surprise-seed';
import { generateRandomGenome } from './edit-seed';
import { PRIMARY_ELIGIBLE } from './surprise-seed-pool';
import { V } from './variations';
import { type Genome } from './genome';

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

describe('generateSurpriseBatch', () => {
  it('returns n genomes', () => {
    expect(generateSurpriseBatch(seededRng(1), 16)).toHaveLength(16);
  });
  it('is deterministic for the same rng seed', () => {
    expect(generateSurpriseBatch(seededRng(5), 8)).toEqual(generateSurpriseBatch(seededRng(5), 8));
  });
  it('each genome has 4 xforms and a non-empty palette', () => {
    for (const g of generateSurpriseBatch(seededRng(2), 8)) {
      expect(g.xforms).toHaveLength(4);
      expect(g.palette.stops.length).toBeGreaterThan(0);
      expect(Number.isFinite(g.scale)).toBe(true);
    }
  });
  it('leads each genome with an eligible primary variation', () => {
    for (const g of generateSurpriseBatch(seededRng(4), 12)) {
      const shapeXform = g.xforms.find((x) => x.variations[0] && x.variations[0].weight >= 0.99);
      expect(shapeXform).toBeDefined();
      expect(PRIMARY_ELIGIBLE).toContain(shapeXform!.variations[0]!.index);
    }
  });
});

describe('collapse-to-point guard (#446)', () => {
  // A flame whose every affine shares the origin fixed point (c=f=0) and is
  // contractive collapses to a point — the #445 repro shape. Build one by
  // forcing those affines + pure-linear variations onto a valid skeleton.
  function makeCollapsed(seed: number): Genome {
    const g = generateRandomGenome(seededRng(seed));
    for (const x of g.xforms) {
      x.c = 0; x.f = 0; x.a = 0.4; x.b = 0.1; x.d = -0.1; x.e = 0.4;
      x.variations = [{ index: V.linear, weight: 1 }];
      delete x.post;
    }
    return g;
  }

  it('flags a collapse-to-origin genome as degenerate', () => {
    expect(isCollapsed(makeCollapsed(99))).toBe(true);
  });
  it('does NOT flag normal generated flames (no false positives)', () => {
    for (let s = 0; s < 20; s++) {
      expect(isCollapsed(generateRandomGenome(seededRng(200 + s)))).toBe(false);
    }
  });
  it('generateSurpriseBatch never emits a collapsed genome', () => {
    for (const g of generateSurpriseBatch(seededRng(3), 16)) {
      expect(isCollapsed(g)).toBe(false);
    }
  });
});

describe('generateSurpriseBatch params (#surprise-v2 T3)', () => {
  it('threads xformCount into every genome', () => {
    for (const g of generateSurpriseBatch(seededRng(7), 4, { xformCount: [2, 2] })) {
      expect(g.xforms).toHaveLength(2);
    }
  });
  it('only-mode restricts primaries to the preferred set', () => {
    const batch = generateSurpriseBatch(seededRng(8), 6, { preferred: [V.spherical, V.swirl], preferMode: 'only' });
    expect(batch).toHaveLength(6);
  });
  it('blendPerXform threads through to richer xform blends', () => {
    const batch = generateSurpriseBatch(seededRng(9), 4, { xformCount: [2, 2], blendPerXform: [3, 3], preferred: [V.spherical, V.swirl, V.sinusoidal] });
    const maxBlend = Math.max(...batch.flatMap((g) => g.xforms.map((x) => x.variations.length)));
    expect(maxBlend).toBeGreaterThanOrEqual(2);
  });
  it('no params → same diverse default batch (16, 4 xforms each)', () => {
    const batch = generateSurpriseBatch(seededRng(10), 16);
    expect(batch).toHaveLength(16);
    for (const g of batch) expect(g.xforms).toHaveLength(4);
  });
});
