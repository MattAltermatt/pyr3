import { describe, expect, it } from 'vitest';
import { generateRandomGenome } from './edit-seed';

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

  it('produces a valid Genome shape', () => {
    const g = generateRandomGenome(seededRng(1));
    expect(g.xforms.length).toBeGreaterThanOrEqual(2);
    expect(g.xforms.length).toBeLessThanOrEqual(4);
    for (const x of g.xforms) {
      expect(x.variations.length).toBeGreaterThanOrEqual(1);
      expect(x.weight).toBeGreaterThan(0);
    }
    expect(g.palette.stops.length).toBeGreaterThan(0);
    expect(g.palette.name.startsWith('flame #')).toBe(true);
  });

  it('produces different output for different seeds', () => {
    const a = generateRandomGenome(seededRng(1));
    const b = generateRandomGenome(seededRng(2));
    expect(a).not.toEqual(b);
  });

  it('falls back to Math.random when no rng provided', () => {
    const g = generateRandomGenome();
    expect(g.xforms.length).toBeGreaterThanOrEqual(2);
  });
});
