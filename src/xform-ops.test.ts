import { describe, expect, it } from 'vitest';
import { addXform, removeXform, duplicateXform, makeDefaultXform, swapXforms } from './xform-ops';
import { generateRandomGenome } from './edit-seed';

const g = () => generateRandomGenome(() => 0.5);

describe('makeDefaultXform', () => {
  it('builds an identity-affine linear xform', () => {
    const xf = makeDefaultXform();
    expect([xf.a, xf.b, xf.c, xf.d, xf.e, xf.f]).toEqual([1, 0, 0, 0, 1, 0]);
    expect(xf.weight).toBeGreaterThan(0);
    expect(xf.variations.length).toBe(1);
  });
});

describe('addXform', () => {
  it('appends a new xform and returns its index as the new selection', () => {
    const genome = g();
    const n = genome.xforms.length;
    const sel = addXform(genome);
    expect(genome.xforms.length).toBe(n + 1);
    expect(sel).toBe(n);
    expect(genome.xforms[n]!.weight).toBeGreaterThan(0);
  });
});

describe('removeXform', () => {
  it('removes at index and clamps the returned selection', () => {
    const genome = g();
    while (genome.xforms.length < 3) addXform(genome);
    const before = genome.xforms.length;
    const sel = removeXform(genome, before - 1);
    expect(genome.xforms.length).toBe(before - 1);
    expect(sel).toBe(before - 2);
  });

  it('refuses to remove the last remaining xform', () => {
    const genome = g();
    while (genome.xforms.length > 1) removeXform(genome, genome.xforms.length - 1);
    const sel = removeXform(genome, 0);
    expect(genome.xforms.length).toBe(1);
    expect(sel).toBe(0);
  });

  it('drops the matching xaos column from every surviving xform', () => {
    const genome = g();
    while (genome.xforms.length < 3) addXform(genome);
    genome.xforms.forEach((xf) => { xf.xaos = [1, 1, 1]; });
    removeXform(genome, 1); // remove middle → each xaos row loses index 1
    for (const xf of genome.xforms) expect(xf.xaos!.length).toBe(2);
  });
});

describe('duplicateXform', () => {
  it('inserts a deep copy after the source and selects the copy', () => {
    const genome = g();
    genome.xforms[0]!.weight = 0.42;
    const sel = duplicateXform(genome, 0);
    expect(sel).toBe(1);
    expect(genome.xforms[1]!.weight).toBe(0.42);
    genome.xforms[1]!.weight = 0.99;
    expect(genome.xforms[0]!.weight).toBe(0.42); // deep copy, not a shared ref
  });
});

describe('swapXforms (#335)', () => {
  it('permutes xaos so the transition relation is invariant', () => {
    const genome = g();
    while (genome.xforms.length < 3) addXform(genome);
    // asymmetric xaos: xforms[i].xaos[j] = i→j multiplier
    genome.xforms[0]!.xaos = [1.0, 0.2, 0.7];
    genome.xforms[1]!.xaos = [0.3, 1.0, 0.1];
    genome.xforms[2]!.xaos = [0.9, 0.4, 1.0];
    // weight of the 0→2 transition before the swap
    const before = genome.xforms[0]!.weight * genome.xforms[0]!.xaos![2]!;
    swapXforms(genome, 0, 2);
    // the SAME pair (old-0 → old-2) now lives at (index 2 → index 0)
    const after = genome.xforms[2]!.weight * genome.xforms[2]!.xaos![0]!;
    expect(after).toBeCloseTo(before, 12);
  });

  it('swaps the xform payloads themselves', () => {
    const genome = g();
    while (genome.xforms.length < 2) addXform(genome);
    genome.xforms[0]!.weight = 0.11;
    genome.xforms[1]!.weight = 0.88;
    swapXforms(genome, 0, 1);
    expect(genome.xforms[0]!.weight).toBe(0.88);
    expect(genome.xforms[1]!.weight).toBe(0.11);
  });

  it('is a no-op for equal indices', () => {
    const genome = g();
    const w = genome.xforms[0]!.weight;
    swapXforms(genome, 0, 0);
    expect(genome.xforms[0]!.weight).toBe(w);
  });
});
