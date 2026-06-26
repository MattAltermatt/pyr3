// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { vetGmCoeffs, generateGmGenome } from './gm-search';
import { V } from './variations';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

describe('gm-search', () => {
  it('vets a Lyapunov-positive bounded coefficient set', () => {
    const c = vetGmCoeffs(lcg(1));
    expect(c).not.toBeNull();
    expect(c!.length).toBe(2);
    // negative-a regime
    expect(c![0]!).toBeLessThan(0);
  });
  it('gives up (null) when no rolls are allowed', () => {
    expect(vetGmCoeffs(lcg(1), 0)).toBeNull();
  });
  it('builds a single identity-affine GM xform', () => {
    const g = generateGmGenome(lcg(2));
    expect(g).not.toBeNull();
    expect(g!.xforms.length).toBe(1);
    const xf = g!.xforms[0]!;
    expect(xf.a).toBe(1); expect(xf.b).toBe(0); expect(xf.e).toBe(1);
    expect(xf.variations[0]!.index).toBe(V.gumowski_mira);
    expect(g!.symmetry).toBeUndefined();
  });
  it('is deterministic for a fixed seed', () => {
    expect(JSON.stringify(generateGmGenome(lcg(3)))).toBe(JSON.stringify(generateGmGenome(lcg(3))));
  });
});
