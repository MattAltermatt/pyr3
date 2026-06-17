import { describe, it, expect } from 'vitest';
import { histogramToLinearRgba } from './export-linear';

describe('histogramToLinearRgba', () => {
  it('box-averages oversample blocks and scales by the linear exposure k1·k2', () => {
    // 1 output pixel, oversample 2 → 2×2 super-pixels (block of 4).
    const superRgba = new Uint32Array([
      400, 0, 0, 1,   0, 0, 0, 1,
      0, 0, 0, 1,     0, 0, 0, 1,
    ]);
    const k1 = 2, k2 = 0.001; // scale = k1·k2/block = 0.002/4 = 0.0005
    const out = histogramToLinearRgba({ superRgba, width: 1, height: 1, oversample: 2, k1, k2 });
    // R sum over block = 400 → 400 × 0.0005 = 0.2 (= avg 100 × k1·k2).
    expect(out[0]!).toBeCloseTo(0.2, 6);
    // count sum = 4 → 4 × 0.0005 = 0.002 coverage.
    expect(out[3]!).toBeCloseTo(0.002, 6);
  });

  it('keeps over-range RGB (>1) but clamps the coverage alpha to [0,1]', () => {
    const superRgba = new Uint32Array([255000, 0, 0, 1000]);
    const out = histogramToLinearRgba({ superRgba, width: 1, height: 1, oversample: 1, k1: 1, k2: 0.01 });
    expect(out[0]!).toBeCloseTo(2550, 1); // 255000 × 0.01 — HDR, unclamped
    expect(out[3]!).toBe(1); // 1000 × 0.01 = 10 → clamped to 1
  });
});
