// pyr3 — channel-histogram tests (#175).
//
// Pure binning of post-tonemap RGBA bytes into 4×256 channel histograms for
// the Color Curves overlay. GPU-free: the readback boundary (edit-mount)
// hands us tight, true-RGBA bytes — these tests exercise only the binning +
// normalization math.

import { describe, it, expect } from 'vitest';
import {
  binChannels,
  normalizeBins,
  HISTOGRAM_BINS,
  type ChannelHistogram,
} from './channel-histogram';

/** Build a tight RGBA buffer from per-pixel [r,g,b] triples (alpha = 255). */
function rgbaOf(pixels: Array<[number, number, number]>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  });
  return out;
}

function totalCount(h: Uint32Array): number {
  let s = 0;
  for (const v of h) s += v;
  return s;
}

describe('binChannels', () => {
  it('produces 256-length bins for every channel', () => {
    const h = binChannels(rgbaOf([[0, 0, 0]]), 1, 1);
    for (const ch of [h.r, h.g, h.b, h.luma] as const) {
      expect(ch.length).toBe(HISTOGRAM_BINS);
    }
  });

  it('bins each channel at the byte value (no stride loss for small images)', () => {
    const h = binChannels(
      rgbaOf([
        [0, 128, 255],
        [255, 0, 64],
      ]),
      2,
      1,
    );
    expect(h.r[0]).toBe(1); // pixel 0 R=0
    expect(h.r[255]).toBe(1); // pixel 1 R=255
    expect(h.g[128]).toBe(1);
    expect(h.g[0]).toBe(1);
    expect(h.b[255]).toBe(1);
    expect(h.b[64]).toBe(1);
  });

  it('computes Luma via BT.709 on the display-encoded bytes (no linearization)', () => {
    // Pure green at 255 → 0.7152*255 ≈ 182.4 → bin 182.
    const h = binChannels(rgbaOf([[0, 255, 0]]), 1, 1);
    expect(h.luma[182]).toBe(1);
    // Pure white → 255.
    const w = binChannels(rgbaOf([[255, 255, 255]]), 1, 1);
    expect(w.luma[255]).toBe(1);
    // Pure black → 0.
    const k = binChannels(rgbaOf([[0, 0, 0]]), 1, 1);
    expect(k.luma[0]).toBe(1);
  });

  it('counts every pixel when the image is small (stride 1)', () => {
    const pixels: Array<[number, number, number]> = [];
    for (let i = 0; i < 100; i++) pixels.push([i, i, i]);
    const h = binChannels(rgbaOf(pixels), 100, 1);
    expect(totalCount(h.r)).toBe(100);
    expect(totalCount(h.luma)).toBe(100);
  });

  it('subsamples deterministically when over targetSamples (same input → same bins)', () => {
    const n = 10000;
    const pixels: Array<[number, number, number]> = [];
    for (let i = 0; i < n; i++) {
      const v = i % 256;
      pixels.push([v, v, v]);
    }
    const rgba = rgbaOf(pixels);
    const a = binChannels(rgba, n, 1, 500);
    const b = binChannels(rgba, n, 1, 500);
    // Deterministic: byte-identical bins on repeat.
    expect(Array.from(a.r)).toEqual(Array.from(b.r));
    // Subsampled: far fewer than n total counts, but non-empty.
    const c = totalCount(a.r);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThanOrEqual(n);
    expect(c).toBeLessThan(n); // genuinely strided, not all-pixels
  });

  it('ignores the alpha channel entirely', () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 0, 10, 20, 30, 200]);
    const h = binChannels(rgba, 2, 1);
    expect(h.r[10]).toBe(2);
    expect(h.g[20]).toBe(2);
    expect(h.b[30]).toBe(2);
  });
});

describe('normalizeBins', () => {
  it('scales bins to 0..1 against their own peak by default', () => {
    const bins = new Uint32Array(HISTOGRAM_BINS);
    bins[10] = 50;
    bins[20] = 100;
    const norm = normalizeBins(bins);
    expect(norm[20]).toBeCloseTo(1.0);
    expect(norm[10]).toBeCloseTo(0.5);
    expect(norm[0]).toBe(0);
  });

  it('honours a shared peak override (for comparable R/G/B overlay)', () => {
    const bins = new Uint32Array(HISTOGRAM_BINS);
    bins[5] = 25;
    const norm = normalizeBins(bins, 100);
    expect(norm[5]).toBeCloseTo(0.25);
  });

  it('returns all-zero when the peak is zero (empty histogram, no NaN)', () => {
    const bins = new Uint32Array(HISTOGRAM_BINS);
    const norm = normalizeBins(bins);
    expect(norm.every((v: number) => v === 0)).toBe(true);
  });

  it('log scale lifts mid-tones out of a background-dominated spike', () => {
    // Mimics a flame: a giant pure-black bin-0 spike, sparse mid-tones.
    const bins = new Uint32Array(HISTOGRAM_BINS);
    bins[0] = 1_000_000;
    bins[128] = 50;
    const lin = normalizeBins(bins, undefined, 'linear');
    const log = normalizeBins(bins, undefined, 'log');
    // Under linear scaling the mid-tone is invisible (~0); log makes it visible.
    expect(lin[128]).toBeLessThan(0.001);
    expect(log[128]).toBeGreaterThan(0.2);
    // The peak bin still pins to 1.0 in both.
    expect(log[0]).toBeCloseTo(1.0);
  });

  it('log scale honours a shared peak (composite R/G/B comparability)', () => {
    const bins = new Uint32Array(HISTOGRAM_BINS);
    bins[64] = 100;
    const norm = normalizeBins(bins, 1000, 'log');
    // log1p(100)/log1p(1000) ≈ 4.615 / 6.909 ≈ 0.668
    expect(norm[64]).toBeCloseTo(Math.log1p(100) / Math.log1p(1000), 5);
  });
});

describe('ChannelHistogram type shape', () => {
  it('exposes r/g/b/luma', () => {
    const h: ChannelHistogram = binChannels(rgbaOf([[1, 2, 3]]), 1, 1);
    expect(h).toHaveProperty('r');
    expect(h).toHaveProperty('g');
    expect(h).toHaveProperty('b');
    expect(h).toHaveProperty('luma');
  });
});
