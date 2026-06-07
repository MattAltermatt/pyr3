import { describe, it, expect } from 'vitest';
import { buildCatalogGenome, SIERPINSKI_CORNERS } from './variation-catalog-scaffold';
import { V } from './variations';

describe('buildCatalogGenome', () => {
  it('builds a 3-xform sierpinski with equal weights', () => {
    const g = buildCatalogGenome(V.linear, 1, []);
    expect(g.xforms).toHaveLength(3);
    expect(g.xforms.every(x => Math.abs(x.weight - 1 / 3) < 1e-9)).toBe(true);
  });

  it('places each xform as a 0.5 contraction toward its corner', () => {
    const g = buildCatalogGenome(V.linear, 1, []);
    g.xforms.forEach((x, i) => {
      const [vx, vy] = SIERPINSKI_CORNERS[i]!;
      expect(x.a).toBe(0.5);
      expect(x.b).toBe(0);
      expect(x.c).toBe(0.5 * vx);
      expect(x.d).toBe(0);
      expect(x.e).toBe(0.5);
      expect(x.f).toBe(0.5 * vy);
    });
  });

  it('substitutes variation at weight=1 (linear chain entry weight=0)', () => {
    const g = buildCatalogGenome(V.sinusoidal, 1, []);
    g.xforms.forEach(x => {
      const linear = x.variations.find(v => v.index === V.linear);
      const sin = x.variations.find(v => v.index === V.sinusoidal);
      expect(linear?.weight).toBe(0);
      expect(sin?.weight).toBe(1);
    });
  });

  it('interpolates weight=0.4 as linear=0.6 + variation=0.4', () => {
    const g = buildCatalogGenome(V.sinusoidal, 0.4, []);
    g.xforms.forEach(x => {
      const linear = x.variations.find(v => v.index === V.linear);
      const sin = x.variations.find(v => v.index === V.sinusoidal);
      expect(linear?.weight).toBeCloseTo(0.6);
      expect(sin?.weight).toBeCloseTo(0.4);
    });
  });

  it('applies positional params to variation slots', () => {
    const g = buildCatalogGenome(V.julian, 1, [5, 0.7]);
    const julian = g.xforms[0]!.variations.find(v => v.index === V.julian)!;
    expect(julian.param0).toBe(5);
    expect(julian.param1).toBe(0.7);
  });

  it('V0 linear is plain sierpinski at any weight', () => {
    const g0 = buildCatalogGenome(V.linear, 0, []);
    const g1 = buildCatalogGenome(V.linear, 1, []);
    expect(g0.xforms[0]!.variations).toEqual([{ index: V.linear, weight: 1 }]);
    expect(g1.xforms[0]!.variations).toEqual([{ index: V.linear, weight: 1 }]);
  });

  it('clamps weight to [0, 1]', () => {
    const high = buildCatalogGenome(V.sinusoidal, 1.5, []);
    const low = buildCatalogGenome(V.sinusoidal, -0.5, []);
    const sinHigh = high.xforms[0]!.variations.find(v => v.index === V.sinusoidal)!;
    const sinLow = low.xforms[0]!.variations.find(v => v.index === V.sinusoidal)!;
    expect(sinHigh.weight).toBe(1);
    expect(sinLow.weight).toBe(0);
  });

  it('spreads xform colors 0 / 0.5 / 1 across the palette', () => {
    const g = buildCatalogGenome(V.spherical, 1, []);
    expect(g.xforms.map(x => x.color)).toEqual([0, 0.5, 1]);
  });

  it('all 8 positional params land on param0..param7 (mobius)', () => {
    const g = buildCatalogGenome(V.mobius, 1, [1, 2, 3, 4, 5, 6, 7, 8]);
    const mob = g.xforms[0]!.variations.find(v => v.index === V.mobius)!;
    expect(mob.param0).toBe(1);
    expect(mob.param1).toBe(2);
    expect(mob.param2).toBe(3);
    expect(mob.param3).toBe(4);
    expect(mob.param4).toBe(5);
    expect(mob.param5).toBe(6);
    expect(mob.param6).toBe(7);
    expect(mob.param7).toBe(8);
  });

  it('extra slots param8/param9 land when 10 positional params are supplied (#120 seam expand)', () => {
    // Use V.mobius as a vehicle for the slot test — mobius itself only reads
    // 0..7, but the scaffold's positional-param routing extends to 8/9 after
    // the #120 seam expand. param8/param9 should land on the Variation regardless.
    const g = buildCatalogGenome(V.mobius, 1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const mob = g.xforms[0]!.variations.find(v => v.index === V.mobius)!;
    expect(mob.param8).toBe(9);
    expect(mob.param9).toBe(10);
  });
});
