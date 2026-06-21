import { describe, it, expect } from 'vitest';
import type { Genome, Xform } from './genome';
import {
  xformLabel, alignedCount, toOrder, nudge, swap, toPermutation, classifyPairing,
} from './timeline-xform-pairing';

// linear = index 0, spherical = index 2 (src/variations.ts).
const xf = (...idx: number[]): Xform =>
  ({ weight: 1, variations: idx.map((index) => ({ index, weight: 1 })) } as Xform);
const genome = (...xforms: Xform[]): Genome => ({ xforms } as Genome);

describe('xformLabel', () => {
  it('formats 1-based index + variation names', () => {
    expect(xformLabel(xf(0, 2), 1)).toBe('#2 · linear, spherical');
  });
  it('falls back to var<idx> for unknown indices', () => {
    expect(xformLabel(xf(99999), 0)).toBe('#1 · var99999');
  });
  it('labels an empty variation list as linear', () => {
    expect(xformLabel(xf(), 0)).toBe('#1 · linear');
  });
});

describe('alignedCount', () => {
  it('is the max of the two real xform counts', () => {
    expect(alignedCount(genome(xf(0), xf(1), xf(2)), genome(xf(0), xf(1)))).toBe(3);
    expect(alignedCount(genome(xf(0)), genome(xf(0), xf(1), xf(2), xf(3)))).toBe(4);
  });
});

describe('toOrder', () => {
  it('returns identity when perm is absent', () => {
    expect(toOrder(undefined, 3)).toEqual([0, 1, 2]);
  });
  it('returns identity when perm is not a bijection over n', () => {
    expect(toOrder([0, 0, 2], 3)).toEqual([0, 1, 2]); // dup
    expect(toOrder([0, 1], 3)).toEqual([0, 1, 2]);     // wrong length
    expect(toOrder([0, 1, 5], 3)).toEqual([0, 1, 2]);  // out of range
  });
  it('passes through a valid permutation', () => {
    expect(toOrder([2, 0, 1], 3)).toEqual([2, 0, 1]);
  });
});

describe('nudge (adjacent swap)', () => {
  it('swaps a row up', () => {
    expect(nudge([0, 1, 2], 2, -1)).toEqual([0, 2, 1]);
  });
  it('swaps a row down', () => {
    expect(nudge([0, 1, 2], 0, 1)).toEqual([1, 0, 2]);
  });
  it('clamps at the ends (no-op)', () => {
    expect(nudge([0, 1, 2], 0, -1)).toEqual([0, 1, 2]);
    expect(nudge([0, 1, 2], 2, 1)).toEqual([0, 1, 2]);
  });
});

describe('swap (drag drop / arrow)', () => {
  it('swaps the two positions, leaving the rest in place', () => {
    expect(swap([0, 1, 2, 3], 0, 2)).toEqual([2, 1, 0, 3]); // not [1,2,0,3] — no shift
    expect(swap([0, 1, 2, 3], 3, 1)).toEqual([0, 3, 2, 1]);
  });
  it('is a no-op when i === j or out of range', () => {
    expect(swap([0, 1, 2], 1, 1)).toEqual([0, 1, 2]);
    expect(swap([0, 1, 2], 0, 5)).toEqual([0, 1, 2]);
    expect(swap([0, 1, 2], -1, 1)).toEqual([0, 1, 2]);
  });
});

describe('toPermutation', () => {
  it('returns undefined for an identity order', () => {
    expect(toPermutation([0, 1, 2])).toBeUndefined();
  });
  it('returns the order for a non-identity order', () => {
    expect(toPermutation([1, 0, 2])).toEqual([1, 0, 2]);
  });
});

// #413 — classify a stored pairing against the POST-symmetry-bake aligned count.
// rotational n=3 appends 2 rotation xforms (k=1,2), so 3 source xforms ⇒ 5 baked.
const symmetric = (n: number, ...xforms: Xform[]): Genome =>
  ({ xforms, symmetry: { kind: 'rotational', n } } as Genome);

describe('classifyPairing', () => {
  it('identity: no perm ⇒ kind identity (no badge)', () => {
    expect(classifyPairing(genome(xf(0), xf(1), xf(2)), genome(xf(0), xf(1), xf(2)), undefined).kind)
      .toBe('identity');
  });

  it('applies: full-length valid perm over the baked count', () => {
    const g = genome(xf(0), xf(1), xf(2));
    expect(classifyPairing(g, g, [1, 0, 2]).kind).toBe('applies');
  });

  it('positional-tail: short perm on a symmetry-baked flame (the #412 shape)', () => {
    // 3 source xforms + symmetry n=3 ⇒ bakes to 5; a 3-long perm gets an identity tail.
    const status = classifyPairing(symmetric(3, xf(0), xf(1), xf(2)), genome(xf(0), xf(1), xf(2)), [1, 0, 2]);
    expect(status.kind).toBe('positional-tail');
    if (status.kind === 'positional-tail') {
      expect(status.authoredLen).toBe(3);
      expect(status.bakedLen).toBe(5);
    }
  });

  it('rejected: stale over-long perm on a shrunk flame ⇒ silently dropped today', () => {
    // perm authored for 5 xforms, flame now bakes to 3 ⇒ resolve returns undefined.
    const g = genome(xf(0), xf(1), xf(2));
    const status = classifyPairing(g, g, [0, 1, 2, 3, 4]);
    expect(status.kind).toBe('rejected');
    if (status.kind === 'rejected') {
      expect(status.authoredLen).toBe(5);
      expect(status.bakedLen).toBe(3);
    }
  });

  it('rejected: full-length but non-bijective perm (dup index)', () => {
    const g = genome(xf(0), xf(1), xf(2));
    const status = classifyPairing(g, g, [0, 0, 2]); // dup ⇒ not a bijection over 3
    expect(status.kind).toBe('rejected');
    if (status.kind === 'rejected') {
      expect(status.authoredLen).toBe(3);
      expect(status.bakedLen).toBe(3);
    }
  });

  it('identity: full-length explicit identity perm ⇒ no badge', () => {
    const g = genome(xf(0), xf(1), xf(2));
    expect(classifyPairing(g, g, [0, 1, 2]).kind).toBe('identity');
  });
});

// Contract lock: the order array, applied the way interpolate.ts:103 applies it
// (perm.map(j => alignedB.xforms[j])), pairs A-row i with B-xform order[i].
describe('order ↔ interpolate contract', () => {
  it('order[i] selects which B-xform lands at row i', () => {
    const order = [2, 0, 1];
    const bXforms = ['B0', 'B1', 'B2'];
    const paired = order.map((j) => bXforms[j]);
    expect(paired).toEqual(['B2', 'B0', 'B1']); // row0↔B2, row1↔B0, row2↔B1
  });
});
