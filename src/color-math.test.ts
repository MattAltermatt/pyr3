import { describe, it, expect } from 'vitest';
import { rgbToHsv, hsvToRgb } from './color-math';

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
