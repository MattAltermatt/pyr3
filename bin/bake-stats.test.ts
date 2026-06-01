import { describe, it, expect } from 'vitest';
import {
  histogramCoverage,
  meanLuminance,
  densityEntropy,
  colorVariance,
  computeQuantizedStats,
} from './bake-stats';
import { quantizeQ8 } from '../src/feature-index';

// Build an N-pixel RGBA8 buffer where every pixel has the same (r,g,b,255).
function solidCanvas(pixels: number, r: number, g: number, b: number): Uint8Array {
  const out = new Uint8Array(pixels * 4);
  for (let p = 0; p < pixels; p++) {
    const base = p * 4;
    out[base] = r;
    out[base + 1] = g;
    out[base + 2] = b;
    out[base + 3] = 255;
  }
  return out;
}

describe('histogramCoverage', () => {
  it('returns 0 for empty input', () => {
    expect(histogramCoverage(new Float32Array(0))).toBe(0);
  });

  it('returns 0 for all-zero density', () => {
    expect(histogramCoverage(new Float32Array(16))).toBe(0);
  });

  it('returns 1 for all-nonzero density', () => {
    expect(histogramCoverage(new Float32Array([1, 2, 3, 4]))).toBe(1);
  });

  it('returns 0.5 for half-and-half', () => {
    expect(histogramCoverage(new Float32Array([0, 1, 0, 1]))).toBeCloseTo(0.5, 10);
  });

  it('ignores non-finite cells', () => {
    expect(histogramCoverage(new Float32Array([NaN, 1, 0, 1]))).toBeCloseTo(0.5, 10);
  });
});

describe('meanLuminance', () => {
  it('returns 0 for empty input', () => {
    expect(meanLuminance(new Uint8Array(0))).toBe(0);
  });

  it('returns 0 for all-black canvas', () => {
    expect(meanLuminance(solidCanvas(4, 0, 0, 0))).toBe(0);
  });

  it('returns 1 for all-white canvas', () => {
    expect(meanLuminance(solidCanvas(4, 255, 255, 255))).toBeCloseTo(1, 10);
  });

  it('returns ~0.5 for mid-grey canvas', () => {
    // 127.5 isn't representable as a byte — use 128 and accept slightly > 0.5.
    expect(meanLuminance(solidCanvas(4, 128, 128, 128))).toBeCloseTo(128 / 255, 10);
  });

  it('ignores alpha channel', () => {
    // Alpha=0 should NOT pull the result down.
    const buf = solidCanvas(4, 255, 255, 255);
    for (let p = 0; p < 4; p++) buf[p * 4 + 3] = 0;
    expect(meanLuminance(buf)).toBeCloseTo(1, 10);
  });
});

describe('densityEntropy', () => {
  it('returns 0 for empty histogram', () => {
    expect(densityEntropy(new Float32Array(0))).toBe(0);
  });

  it('returns 0 for all-zero histogram', () => {
    expect(densityEntropy(new Float32Array(16))).toBe(0);
  });

  it('returns 0 for a single-spike histogram', () => {
    expect(densityEntropy(new Float32Array([5, 0, 0, 0]))).toBe(0);
  });

  it('returns 1 for a uniform histogram', () => {
    expect(densityEntropy(new Float32Array([1, 1, 1, 1]))).toBeCloseTo(1, 10);
  });

  it('returns 1 for a 2-cell uniform distribution', () => {
    expect(densityEntropy(new Float32Array([0.5, 0.5, 0, 0]))).toBeCloseTo(1, 10);
  });

  it('handles non-uniform distributions in (0,1)', () => {
    // 3 nonzero cells, weights {2, 1, 1}: total=4, p={0.5, 0.25, 0.25}
    // H = -0.5*log2(0.5) - 0.25*log2(0.25) - 0.25*log2(0.25)
    //   = 0.5 + 0.5 + 0.5 = 1.5
    // normalized: 1.5 / log2(3) ≈ 0.9464
    const expected = 1.5 / Math.log2(3);
    expect(densityEntropy(new Float32Array([2, 1, 1, 0]))).toBeCloseTo(expected, 10);
  });
});

describe('colorVariance', () => {
  it('returns 0 for empty input', () => {
    expect(colorVariance(new Uint8Array(0))).toBe(0);
  });

  it('returns 0 for an all-same-color canvas', () => {
    expect(colorVariance(solidCanvas(16, 80, 120, 200))).toBe(0);
  });

  it('returns ~1 for a max-spread canvas (half black, half white)', () => {
    const buf = new Uint8Array(8 * 4);
    for (let p = 0; p < 4; p++) {
      buf[p * 4 + 3] = 255;
      // first 4 pixels stay (0,0,0,255)
    }
    for (let p = 4; p < 8; p++) {
      buf[p * 4] = 255;
      buf[p * 4 + 1] = 255;
      buf[p * 4 + 2] = 255;
      buf[p * 4 + 3] = 255;
    }
    // Per-channel variance: mean=127.5, each pixel diff=127.5, variance=127.5^2.
    // Sum across 3 channels: 3 * 127.5^2. stddev = sqrt(3) * 127.5.
    // Normalized to 1.
    expect(colorVariance(buf)).toBeCloseTo(1, 10);
  });

  it('matches hand-computed mid-spread variance', () => {
    // 2 pixels: (0,0,0,255) and (100,0,0,255).
    // meanR=50, meanG=0, meanB=0. Per-channel:
    //   ssR = 50^2 + 50^2 = 5000 → var=2500
    //   ssG = 0, ssB = 0
    // totalVar = 2500, stddev = 50.
    // norm = 50 / (sqrt(3) * 127.5) ≈ 0.22641.
    const buf = new Uint8Array([0, 0, 0, 255, 100, 0, 0, 255]);
    const expected = 50 / (Math.sqrt(3) * 127.5);
    expect(colorVariance(buf)).toBeCloseTo(expected, 10);
  });
});

describe('computeQuantizedStats', () => {
  it('combines all four formulas + quantizes', () => {
    // All-white canvas + half-and-half density.
    const density = new Float32Array([0, 1, 0, 1]);
    const rgba = solidCanvas(4, 255, 255, 255);
    const out = computeQuantizedStats(density, rgba);
    expect(out.coverage).toBe(quantizeQ8(0.5));
    expect(out.meanLum).toBe(quantizeQ8(1));
    expect(out.entropy).toBe(quantizeQ8(1));
    expect(out.colorVar).toBe(quantizeQ8(0));
  });

  it('handles empty inputs without NaN', () => {
    const out = computeQuantizedStats(new Float32Array(0), new Uint8Array(0));
    expect(out.coverage).toBe(0);
    expect(out.meanLum).toBe(0);
    expect(out.entropy).toBe(0);
    expect(out.colorVar).toBe(0);
  });
});
