import { describe, it, expect } from 'vitest';
import {
  makeRng, initChaosState, pickXform, stepChaos, runFuse, SIERPINSKI,
  sierpinskiWithWeights, catalogVariationFlame,
  type DemoFlame,
} from './learn-chaos';
import { ts_var_spherical } from './variations';

describe('pickXform', () => {
  it('selects by cumulative weight (equal weights → thirds)', () => {
    expect(pickXform(SIERPINSKI, 0.10)).toBe(0);
    expect(pickXform(SIERPINSKI, 0.50)).toBe(1);
    expect(pickXform(SIERPINSKI, 0.90)).toBe(2);
  });
  it('respects unequal weights', () => {
    const f: DemoFlame = { xforms: [
      { affine: { a:1,b:0,c:0,d:0,e:1,f:0 }, weight: 3, hue: 0 },
      { affine: { a:1,b:0,c:0,d:0,e:1,f:0 }, weight: 1, hue: 0 },
    ]};
    expect(pickXform(f, 0.70)).toBe(0); // first 0.75 of mass
    expect(pickXform(f, 0.80)).toBe(1);
  });
});

describe('makeRng', () => {
  it('is deterministic for a seed and returns [0,1)', () => {
    const a = makeRng(42); const b = makeRng(42);
    for (let i = 0; i < 5; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('SIERPINSKI chaos game', () => {
  const A: [number, number] = [0.5, 0.95];
  const B: [number, number] = [0.05, 0.05];
  const C: [number, number] = [0.95, 0.05];
  const inHull = (x: number, y: number): boolean => {
    const sign = (ax:number,ay:number,bx:number,by:number,px:number,py:number) =>
      (px-bx)*(ay-by) - (ax-bx)*(py-by);
    const d1 = sign(A[0],A[1],B[0],B[1],x,y);
    const d2 = sign(B[0],B[1],C[0],C[1],x,y);
    const d3 = sign(C[0],C[1],A[0],A[1],x,y);
    const hasNeg = d1<0||d2<0||d3<0, hasPos = d1>0||d2>0||d3>0;
    return !(hasNeg && hasPos);
  };

  it('converges into the triangle (all plotted points inside the convex hull)', () => {
    const rng = makeRng(7);
    let state = runFuse(SIERPINSKI, initChaosState(), rng, 30);
    for (let i = 0; i < 2000; i++) {
      const r = stepChaos(SIERPINSKI, state, rng);
      state = r.state;
      expect(inHull(r.point.x, r.point.y)).toBe(true);
    }
    expect(state.count).toBe(2000);
  });

  it('runFuse advances position without counting plotted points', () => {
    const rng = makeRng(1);
    const state = runFuse(SIERPINSKI, initChaosState(), rng, 20);
    expect(state.count).toBe(0);
  });
});

describe('presets', () => {
  it('sierpinskiWithWeights overrides weights, keeps affines', () => {
    const f = sierpinskiWithWeights(5, 1, 1);
    expect(f.xforms.map((x) => x.weight)).toEqual([5, 1, 1]);
    expect(f.xforms[0]!.affine).toEqual(SIERPINSKI.xforms[0]!.affine);
  });
  it('catalogVariationFlame(null) is the linear-only Sierpinski scaffold (3 xforms, w 1/3, palette rgb)', () => {
    const f = catalogVariationFlame(null);
    expect(f.xforms).toHaveLength(3);
    expect(f.xforms.every((x) => x.weight === 1 / 3)).toBe(true);
    expect(f.xforms.every((x) => x.chain?.length === 1 && x.chain[0]!.kind === 'linear')).toBe(true);
    expect(f.xforms.every((x) => Array.isArray(x.rgb))).toBe(true);
  });
  it('catalogVariationFlame(kind, w) mixes linear(1-w) + variation(w) per xform', () => {
    const f = catalogVariationFlame('swirl', 0.3);
    expect(f.xforms.every((x) => x.chain?.[0]?.kind === 'linear' && Math.abs(x.chain[0]!.weight - 0.7) < 1e-9)).toBe(true);
    expect(f.xforms.every((x) => x.chain?.[1]?.kind === 'swirl' && Math.abs(x.chain[1]!.weight - 0.3) < 1e-9)).toBe(true);
  });
});

describe('stepChaos reuses the real variation math', () => {
  it('a spherical-variation xform matches ts_var_spherical(affine(p))', () => {
    const f: DemoFlame = { xforms: [
      { affine: { a:0.6,b:0,c:0.1,d:0,e:0.6,f:0.2 }, weight: 1, hue: 0,
        variation: { kind: 'spherical', weight: 1 } },
    ]};
    const rng = () => 0; // always picks xform 0
    const start = { x: 0.3, y: -0.2, lastXform: -1, count: 0 };
    const { point } = stepChaos(f, start, rng);
    const tx = 0.6*0.3 + 0*-0.2 + 0.1;
    const ty = 0*0.3 + 0.6*-0.2 + 0.2;
    const expected = ts_var_spherical({ tx, ty, weight: 1 });
    expect(point.x).toBeCloseTo(expected.x, 12);
    expect(point.y).toBeCloseTo(expected.y, 12);
  });
});
