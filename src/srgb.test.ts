import { describe, it, expect } from 'vitest';
import { srgbToLinear } from './srgb';

describe('srgbToLinear', () => {
  it('maps the transfer endpoints + a known midpoint', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 6);
    // sRGB 0.5 → linear ≈ 0.2140 (standard reference value).
    expect(srgbToLinear(0.5)).toBeCloseTo(0.21404, 4);
  });
  it('uses the linear segment below the 0.04045 knee', () => {
    expect(srgbToLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 7);
    expect(srgbToLinear(0.02)).toBeCloseTo(0.02 / 12.92, 7);
  });
});
