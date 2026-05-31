import { describe, expect, it } from 'vitest';
import { packXforms, distinctVariationNames, MAX_XFORMS, XFORM_BYTES, type Genome, type Xform } from './genome';

// Minimal valid xform — packXforms only reads the affine + weight + variations.
function xf(): Xform {
  return { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, weight: 1, color: 0, colorSpeed: 0, variations: [{ index: 0, weight: 1 }] };
}

describe('packXforms — GPU xform-buffer fit (PYR3-033)', () => {
  // Regression for PYR3-033: the chaos xforms buffer is fixed at
  // (MAX_XFORMS + 1) × XFORM_BYTES. A genome with more xforms than the cap
  // packs into a larger ArrayBuffer, overflowing queue.writeBuffer — Dawn
  // silently drops the write and the render comes out pure black.
  // electricsheep.242.01373 (54 xforms + finalxform) was the type specimen.
  it('packs a 54-xform flame (electricsheep.242.01373) within the GPU xform buffer', () => {
    const genome = { xforms: Array.from({ length: 54 }, xf), finalxform: xf() } as unknown as Genome;
    const gpuBufferBytes = (MAX_XFORMS + 1) * XFORM_BYTES;
    expect(packXforms(genome).byteLength).toBeLessThanOrEqual(gpuBufferBytes);
  });

  it('packs exactly MAX_XFORMS regular xforms + finalxform to the full buffer size', () => {
    const genome = { xforms: Array.from({ length: MAX_XFORMS }, xf), finalxform: xf() } as unknown as Genome;
    expect(packXforms(genome).byteLength).toBe((MAX_XFORMS + 1) * XFORM_BYTES);
  });
});

// Variation indices used below: linear=0, spherical=2, swirl=3, julia=13.
function xfWith(weight: number, vars: Array<[number, number]>): Xform {
  return {
    a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, weight, color: 0, colorSpeed: 0,
    variations: vars.map(([index, w]) => ({ index, weight: w })),
  } as Xform;
}

describe('distinctVariationNames — info-bar variation set (#5)', () => {
  it('de-dupes across xforms and orders by total contribution weight (desc)', () => {
    // linear total = 2×1 + 1×0.5 = 2.5; spherical = 1×1 = 1 → linear leads.
    const genome = {
      xforms: [xfWith(2, [[0, 1]]), xfWith(1, [[2, 1], [0, 0.5]])],
    } as unknown as Genome;
    expect(distinctVariationNames(genome)).toEqual(['linear', 'spherical']);
  });

  it('folds finalxform variations into the set (nominal weight 1)', () => {
    const genome = {
      xforms: [xfWith(1, [[0, 1]])],
      finalxform: xfWith(999, [[13, 1]]), // finalxform selection weight is ignored
    } as unknown as Genome;
    expect(distinctVariationNames(genome)).toContain('julia');
  });

  it('breaks weight ties alphabetically', () => {
    // swirl + spherical both total 1 → alpha order: spherical before swirl.
    const genome = { xforms: [xfWith(1, [[3, 1], [2, 1]])] } as unknown as Genome;
    expect(distinctVariationNames(genome)).toEqual(['spherical', 'swirl']);
  });

  it('returns [] for a genome with no variations', () => {
    const genome = { xforms: [xfWith(1, [])] } as unknown as Genome;
    expect(distinctVariationNames(genome)).toEqual([]);
  });
});
