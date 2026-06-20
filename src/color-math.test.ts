import { describe, it, expect } from 'vitest';
import { rgbToHsv, hsvToRgb, oklchToRgb, rgbToOklch } from './color-math';

describe('color-math', () => {
  it('round-trips primary red', () => {
    const hsv = rgbToHsv(1, 0, 0);
    expect(hsv.h).toBeCloseTo(0, 4); expect(hsv.s).toBeCloseTo(1, 4); expect(hsv.v).toBeCloseTo(1, 4);
    const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
    expect(rgb.r).toBeCloseTo(1, 4); expect(rgb.g).toBeCloseTo(0, 4); expect(rgb.b).toBeCloseTo(0, 4);
  });
  it('round-trips an arbitrary color', () => {
    const h = rgbToHsv(0.3, 0.7, 0.45);
    const rgb = hsvToRgb(h.h, h.s, h.v);
    expect(rgb.r).toBeCloseTo(0.3, 4); expect(rgb.g).toBeCloseTo(0.7, 4); expect(rgb.b).toBeCloseTo(0.45, 4);
  });
  it('greys have saturation 0', () => {
    expect(rgbToHsv(0.5, 0.5, 0.5).s).toBe(0);
  });
});

describe('OkLCh <-> sRGB', () => {
  it('roundtrips in-gamut colors within tolerance', () => {
    const fixtures: Array<[number, number, number]> = [[0.2, 0.5, 0.9], [0.8, 0.1, 0.3], [0.5, 0.5, 0.5], [0.05, 0.7, 0.2]];
    for (const [r, g, b] of fixtures) {
      const { L, C, h } = rgbToOklch(r, g, b);
      const back = oklchToRgb(L, C, h);
      expect(back.r).toBeCloseTo(r, 3);
      expect(back.g).toBeCloseTo(g, 3);
      expect(back.b).toBeCloseTo(b, 3);
    }
  });

  it('maps pure red to its known OkLCh anchor', () => {
    const { L, C, h } = rgbToOklch(1, 0, 0);
    expect(L).toBeCloseTo(0.6279, 2);
    expect(C).toBeCloseTo(0.2577, 2);
    expect(h).toBeCloseTo(29.23, 1);
  });

  it('gamut-clamps out-of-gamut OkLCh to [0,1]', () => {
    // Very high chroma at mid lightness is outside sRGB for most hues.
    const { r, g, b } = oklchToRgb(0.6, 0.9, 140);
    for (const c of [r, g, b]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('produces black for L=0 and near-white for L=1,C=0', () => {
    const blk = oklchToRgb(0, 0, 0);
    expect(blk.r).toBeCloseTo(0, 3); expect(blk.g).toBeCloseTo(0, 3); expect(blk.b).toBeCloseTo(0, 3);
    const wht = oklchToRgb(1, 0, 0);
    expect(wht.r).toBeCloseTo(1, 2); expect(wht.g).toBeCloseTo(1, 2); expect(wht.b).toBeCloseTo(1, 2);
  });
});
