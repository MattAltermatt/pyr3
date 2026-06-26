import { describe, it, expect } from 'vitest';
import { ts_var_sprott_poly, type VarInput } from './variations';
import { VARIATION_PARAMS, VARIATION_DEFAULTS } from './serialize';

// V323 sprott_poly — the variation holds the 10 linear+quadratic coeffs
// p0..p9 = [a1,a2,a3,a4,a5,b1,b2,b3,b4,b5]. The 2 constants ride the xform
// post-affine, NOT this variation. Weight is applied INSIDE the ts_var (matches
// ts_var_linear convention: dispatchVariation uses the return directly).
const NAMES = ['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'b2', 'b3', 'b4', 'b5'];

function input(x: number, y: number, coeffs: number[], weight = 1): VarInput {
  return { tx: x, ty: y, weight, params: Object.fromEntries(NAMES.map((n, i) => [n, coeffs[i]!])) };
}

describe('ts_var_sprott_poly', () => {
  const coeffs = [0.5, -0.3, 0.2, 0.9, -0.4, 0.1, 0.6, -0.7, 0.3, 0.8];

  it('computes the quadratic map (weight=1)', () => {
    const x = 0.4, y = -0.2;
    const out = ts_var_sprott_poly(input(x, y, coeffs));
    const x2 = x * x, xy = x * y, y2 = y * y;
    const ex = 0.5 * x - 0.3 * x2 + 0.2 * xy + 0.9 * y - 0.4 * y2;
    const ey = 0.1 * x + 0.6 * x2 - 0.7 * xy + 0.3 * y + 0.8 * y2;
    expect(out.x).toBeCloseTo(ex, 10);
    expect(out.y).toBeCloseTo(ey, 10);
  });

  it('applies weight inside (ts_var convention)', () => {
    const x = 0.4, y = -0.2, w = 2.5;
    const w1 = ts_var_sprott_poly(input(x, y, coeffs, 1));
    const wW = ts_var_sprott_poly(input(x, y, coeffs, w));
    expect(wW.x).toBeCloseTo(w * w1.x, 10);
    expect(wW.y).toBeCloseTo(w * w1.y, 10);
  });

  it('registers exactly 10 params and 10 defaults under matching keys', () => {
    expect(VARIATION_PARAMS.sprott_poly).toEqual(NAMES);
    expect(VARIATION_DEFAULTS.sprott_poly).toHaveLength(10);
  });
});
