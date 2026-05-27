// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import {
  meanAbsDiffRgba,
  meanAbsDiffAccumulator,
  perChannelDrift,
  perRegionDrift,
} from './compare';

describe('meanAbsDiffRgba', () => {
  it('identity: equal arrays → 0', () => {
    const a = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]);
    expect(meanAbsDiffRgba(a, a)).toBe(0);
  });

  it('constant offset of 5 across all 16 bytes → 5.0', () => {
    const a = new Uint8Array(16).fill(100);
    const b = new Uint8Array(16).fill(105);
    expect(meanAbsDiffRgba(a, b)).toBe(5.0);
  });

  it('mixed: hand-crafted small example', () => {
    // 2 pixels (8 bytes). Diffs: |10-13| + |20-20| + |30-35| + |255-255|
    //                          + |40-44| + |50-50| + |60-66| + |255-255|
    //                        =  3 + 0 + 5 + 0 + 4 + 0 + 6 + 0 = 18
    // MAD = 18 / 8 = 2.25
    const a = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
    const b = new Uint8Array([13, 20, 35, 255, 44, 50, 66, 255]);
    expect(meanAbsDiffRgba(a, b)).toBe(2.25);
  });

  it('empty arrays → 0', () => {
    const a = new Uint8Array(0);
    const b = new Uint8Array(0);
    expect(meanAbsDiffRgba(a, b)).toBe(0);
  });

  it('size mismatch throws exact message', () => {
    const a = new Uint8Array(8);
    const b = new Uint8Array(12);
    expect(() => meanAbsDiffRgba(a, b)).toThrow('rgba size mismatch: 8 vs 12');
  });

  it('non-multiple-of-4 throws exact message', () => {
    const a = new Uint8Array(6);
    const b = new Uint8Array(6);
    expect(() => meanAbsDiffRgba(a, b)).toThrow('rgba size not a multiple of 4: 6');
  });
});

describe('meanAbsDiffAccumulator', () => {
  it('identity: equal arrays → 0', () => {
    const a = new Float64Array([1.5, 2.5, 3.5, 4.5, 5.5]);
    expect(meanAbsDiffAccumulator(a, a)).toBe(0);
  });

  it('constant offset → exact diff', () => {
    const a = new Float64Array([1.0, 2.0, 3.0, 4.0]);
    const b = new Float64Array([1.5, 2.5, 3.5, 4.5]);
    expect(meanAbsDiffAccumulator(a, b)).toBe(0.5);
  });

  it('empty arrays → 0', () => {
    const a = new Float64Array(0);
    const b = new Float64Array(0);
    expect(meanAbsDiffAccumulator(a, b)).toBe(0);
  });

  it('size mismatch throws exact message', () => {
    const a = new Float64Array(3);
    const b = new Float64Array(5);
    expect(() => meanAbsDiffAccumulator(a, b)).toThrow('accumulator size mismatch: 3 vs 5');
  });
});

describe('perChannelDrift', () => {
  it('identity: equal arrays → all zeros', () => {
    const a = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
    const result = perChannelDrift(a, a);
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
  });

  it('empty arrays → all zeros', () => {
    const a = new Uint8Array(0);
    const b = new Uint8Array(0);
    const result = perChannelDrift(a, b);
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
  });

  it('red-shifted by 10 on every pixel → r=10, g=0, b=0', () => {
    // 4 pixels, R differs by 10, G/B/A identical.
    const a = new Uint8Array([100, 50, 60, 255, 100, 50, 60, 255, 100, 50, 60, 255, 100, 50, 60, 255]);
    const b = new Uint8Array([110, 50, 60, 255, 110, 50, 60, 255, 110, 50, 60, 255, 110, 50, 60, 255]);
    const result = perChannelDrift(a, b);
    expect(result.r).toBe(10);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
  });

  it('alpha-only difference → all RGB zero (alpha ignored)', () => {
    const a = new Uint8Array([10, 20, 30, 0, 40, 50, 60, 0]);
    const b = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
    const result = perChannelDrift(a, b);
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
  });

  it('size mismatch throws', () => {
    const a = new Uint8Array(8);
    const b = new Uint8Array(12);
    expect(() => perChannelDrift(a, b)).toThrow('perChannelDrift: a.size (8) != b.size (12)');
  });
});

describe('perRegionDrift', () => {
  it('top-left corruption on 4×4 framebuffer → only qTl non-zero, qTl=30', () => {
    // 4×4 = 16 pixels = 64 bytes. xMid=2, yMid=2.
    // TL = {(0,0),(1,0),(0,1),(1,1)} = 4 pixels.
    // Each TL pixel has RGB diffs of 30,30,30 (sum 90); A identical.
    // qTl = (4 × 90) / 3 / 4 = 30.
    const w = 4, h = 4;
    const a = new Uint8Array(w * h * 4);
    const b = new Uint8Array(w * h * 4);
    // Fill both with same base values, then perturb TL of b.
    for (let i = 0; i < a.length; i += 4) {
      a[i] = 100; a[i + 1] = 100; a[i + 2] = 100; a[i + 3] = 255;
      b[i] = 100; b[i + 1] = 100; b[i + 2] = 100; b[i + 3] = 255;
    }
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const idx = (y * w + x) * 4;
        b[idx] = 130;
        b[idx + 1] = 130;
        b[idx + 2] = 130;
        // alpha unchanged
      }
    }
    const result = perRegionDrift(a, b, w, h);
    expect(result.qTl).toBe(30);
    expect(result.qTr).toBe(0);
    expect(result.qBl).toBe(0);
    expect(result.qBr).toBe(0);
  });

  it('identity: equal arrays → all zeros', () => {
    const w = 2, h = 2;
    const a = new Uint8Array(w * h * 4);
    for (let i = 0; i < a.length; i++) a[i] = (i * 7) & 0xff;
    const b = new Uint8Array(a);
    const result = perRegionDrift(a, b, w, h);
    expect(result.qTl).toBe(0);
    expect(result.qTr).toBe(0);
    expect(result.qBl).toBe(0);
    expect(result.qBr).toBe(0);
  });

  it('size mismatch throws', () => {
    const a = new Uint8Array(16);
    const b = new Uint8Array(20);
    expect(() => perRegionDrift(a, b, 2, 2)).toThrow('perRegionDrift: a.size (16) != b.size (20)');
  });

  it('size != w*h*4 throws', () => {
    const a = new Uint8Array(16);
    const b = new Uint8Array(16);
    // w*h*4 = 3*3*4 = 36, but a.length = 16
    expect(() => perRegionDrift(a, b, 3, 3)).toThrow('perRegionDrift: a.size (16) != w*h*4 (36)');
  });
});
