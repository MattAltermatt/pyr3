// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { vetHopalongCoeffs, generateHopalongGenome } from './hopalong-search';
import { V } from './variations';

// deterministic LCG (same generator style as sprott-search.test.ts)
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

describe('hopalong-search', () => {
  it('vets a bounded, well-covered coefficient set', () => {
    const c = vetHopalongCoeffs(lcg(1));
    expect(c).not.toBeNull();
    expect(c!.length).toBe(3);
  });
  it('gives up (null) when no rolls are allowed', () => {
    expect(vetHopalongCoeffs(lcg(1), 0)).toBeNull();
  });
  it('builds a single identity-affine Hopalong xform', () => {
    const g = generateHopalongGenome(lcg(2));
    expect(g).not.toBeNull();
    expect(g!.xforms.length).toBe(1);
    const xf = g!.xforms[0]!;
    expect(xf.a).toBe(1); expect(xf.b).toBe(0); expect(xf.e).toBe(1);
    expect(xf.variations[0]!.index).toBe(V.hopalong);
    expect(xf.variations[0]!.weight).toBe(1);
    expect(g!.symmetry).toBeUndefined();
  });
  it('is deterministic for a fixed seed', () => {
    expect(JSON.stringify(generateHopalongGenome(lcg(3)))).toBe(JSON.stringify(generateHopalongGenome(lcg(3))));
  });
});
