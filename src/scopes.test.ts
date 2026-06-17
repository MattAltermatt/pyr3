import { describe, it, expect } from 'vitest';
import {
  computeWaveform,
  computeParade,
  computeVectorscope,
  REC709,
} from './scopes';
import type { SettledPixels } from './edit-state';

// Build a SettledPixels from a (x,y)->[r,g,b] function.
function makePixels(
  w: number,
  h: number,
  fn: (x: number, y: number) => [number, number, number],
): SettledPixels {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * w + x) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
    }
  }
  return { width: w, height: h, rgba };
}

describe('REC709 luma weights', () => {
  it('sum to 1', () => {
    expect(REC709[0] + REC709[1] + REC709[2]).toBeCloseTo(1, 6);
  });
});

describe('computeWaveform', () => {
  it('a uniform mid-gray field lands every column on one luma row', () => {
    const px = makePixels(16, 16, () => [128, 128, 128]);
    const wf = computeWaveform(px, 32, 16);
    // every source pixel has the same luma → all hits in a single scope row.
    let rowsHit = 0;
    for (let sy = 0; sy < wf.height; sy++) {
      let rowTotal = 0;
      for (let sx = 0; sx < wf.width; sx++) rowTotal += wf.lum[sy * wf.width + sx]!;
      if (rowTotal > 0) rowsHit++;
    }
    expect(rowsHit).toBe(1);
  });

  it('pure white rides the top row, pure black the bottom row', () => {
    const white = computeWaveform(makePixels(8, 8, () => [255, 255, 255]), 16, 16);
    const black = computeWaveform(makePixels(8, 8, () => [0, 0, 0]), 16, 16);
    // top row (sy=0) is brightest; bottom row (sy=height-1) is darkest.
    const rowSum = (wf: typeof white, sy: number) => {
      let s = 0; for (let sx = 0; sx < wf.width; sx++) s += wf.lum[sy * wf.width + sx]!; return s;
    };
    expect(rowSum(white, 0)).toBeGreaterThan(0);
    expect(rowSum(white, white.height - 1)).toBe(0);
    expect(rowSum(black, black.height - 1)).toBeGreaterThan(0);
    expect(rowSum(black, 0)).toBe(0);
  });
});

describe('computeParade', () => {
  it('a pure-red field fills the R sub-bin top and leaves G,B top empty', () => {
    const px = makePixels(8, 8, () => [255, 0, 0]);
    const p = computeParade(px, 32, 16);
    const total = (a: Uint32Array) => a.reduce((s, v) => s + v, 0);
    // every pixel contributes to all three channel grids (G/B land at value 0).
    expect(total(p.r)).toBe(64);   // 8*8 pixels
    expect(total(p.g)).toBe(64);
    // R rides the top (value 255), G/B sit on the bottom row (value 0).
    const topHalf = (a: Uint32Array) => {
      let s = 0;
      for (let sy = 0; sy < p.height / 2; sy++)
        for (let sx = 0; sx < p.segW; sx++) s += a[sy * p.segW + sx]!;
      return s;
    };
    expect(topHalf(p.r)).toBeGreaterThan(0);
    expect(topHalf(p.g)).toBe(0);
    expect(topHalf(p.b)).toBe(0);
  });
});

describe('computeVectorscope', () => {
  it('a neutral-gray field collapses to the center', () => {
    const px = makePixels(8, 8, () => [128, 128, 128]);
    const v = computeVectorscope(px, 64);
    const c = (v.size / 2) | 0;
    // all mass within 1px of center (chroma ~0 for gray).
    let offCenter = 0;
    for (let y = 0; y < v.size; y++)
      for (let x = 0; x < v.size; x++)
        if (v.density[y * v.size + x]! > 0 && (Math.abs(x - c) > 1 || Math.abs(y - c) > 1))
          offCenter++;
    expect(offCenter).toBe(0);
  });

  it('a pure-red field pushes mass off-center (nonzero chroma)', () => {
    const px = makePixels(8, 8, () => [255, 0, 0]);
    const v = computeVectorscope(px, 64);
    const c = (v.size / 2) | 0;
    let maxDist = 0;
    for (let y = 0; y < v.size; y++)
      for (let x = 0; x < v.size; x++)
        if (v.density[y * v.size + x]! > 0)
          maxDist = Math.max(maxDist, Math.hypot(x - c, y - c));
    expect(maxDist).toBeGreaterThan(2);
  });
});
