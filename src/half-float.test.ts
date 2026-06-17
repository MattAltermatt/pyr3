import { describe, it, expect } from 'vitest';
import { halfToFloat } from './half-float';

describe('halfToFloat', () => {
  it('decodes exact values', () => {
    expect(halfToFloat(0x0000)).toBe(0); // +0
    expect(halfToFloat(0x3c00)).toBe(1); // 1.0
    expect(halfToFloat(0x4000)).toBe(2); // 2.0
    expect(halfToFloat(0xc000)).toBe(-2); // -2.0
    expect(halfToFloat(0x3800)).toBeCloseTo(0.5, 6);
  });
  it('handles subnormals and large values', () => {
    expect(halfToFloat(0x0001)).toBeCloseTo(5.9604645e-8, 12); // smallest subnormal
    expect(halfToFloat(0x7bff)).toBeCloseTo(65504, 0); // max half
  });
});
