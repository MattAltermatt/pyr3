import { describe, it, expect } from 'vitest';
import {
  downsampleIndexMap, paintMapDims, brushHistogram, regionMask, insertStopAtIndex,
  clientToPixel, colorAtIndex,
} from './color-index-map';

describe('downsampleIndexMap', () => {
  it('oversample=1 → avg = idxSum/count, mask from count>0', () => {
    // 2x1 image. px0: idxSum=128, count=255 → avg≈0.502. px1: empty.
    const map = downsampleIndexMap(
      new Uint32Array([128, 0]), new Uint32Array([255, 0]), 2, 1, 2, 1);
    expect(map.width).toBe(2);
    expect(map.avg[0]).toBeCloseTo(128 / 255, 5);
    expect(map.mask[0]).toBe(1);
    expect(map.mask[1]).toBe(0);
    expect(Number.isNaN(map.avg[1]!)).toBe(true);
  });

  it('oversample=2 → sums idx and count over each 2x2 block', () => {
    // 2x2 super → 1x1 out. idx sums to 510, count to 510 → avg=1.0.
    const idx = new Uint32Array([255, 255, 0, 0]);
    const cnt = new Uint32Array([255, 255, 0, 0]);
    const map = downsampleIndexMap(idx, cnt, 2, 2, 1, 1);
    expect(map.avg[0]).toBeCloseTo(1.0, 5);
    expect(map.mask[0]).toBe(1);
  });
});

describe('paintMapDims (#372 — aspect-true, in-bounds out-dims)', () => {
  it('16:9 render → out-dims share the aspect, NOT a forced square', () => {
    const { outW, outH } = paintMapDims(1024, 576, 256);
    expect(outW).toBe(256);
    expect(outH).toBe(144); // 1024/4, 576/4 — NOT 256 (the old square bug)
    expect(outW / outH).toBeCloseTo(1024 / 576, 5);
  });

  it('keeps oversample integer + every block in-bounds (no OOB → no missing coverage)', () => {
    const superW = 1024, superH = 576;
    const { outW, outH } = paintMapDims(superW, superH, 256);
    // downsampleIndexMap derives oversample = round(superW/outW); the last block
    // it reads must stay within the super-res buffer on BOTH axes.
    const oversample = Math.round(superW / outW);
    expect((outW - 1) * oversample + (oversample - 1)).toBeLessThan(superW);
    expect((outH - 1) * oversample + (oversample - 1)).toBeLessThan(superH);
  });

  it('square render stays square; portrait flips correctly', () => {
    expect(paintMapDims(512, 512, 256)).toEqual({ outW: 256, outH: 256 });
    expect(paintMapDims(576, 1024, 256)).toEqual({ outW: 144, outH: 256 });
  });

  it('a fully-covered non-square super map downsamples to a fully-covered map', () => {
    // 8x4 super, all pixels hit; paintMapDims(8,4,4) → oversample 2 → 4x2.
    const { outW, outH } = paintMapDims(8, 4, 4);
    const n = 8 * 4;
    const map = downsampleIndexMap(
      new Uint32Array(n).fill(100), new Uint32Array(n).fill(255), 8, 4, outW, outH);
    expect(map.width).toBe(outW);
    expect(map.height).toBe(outH);
    // EVERY output pixel must be covered — the old square-dims bug zeroed the
    // bottom rows via out-of-bounds reads.
    expect([...map.mask].every((m) => m === 1)).toBe(true);
  });
});

describe('brushHistogram', () => {
  it('bins covered pixels within the brush radius, normalized to max=1', () => {
    // 3x1 all covered: avg = [0.0, 0.5, 0.99]. Brush over all, 2 bins.
    const map = { avg: new Float32Array([0.0, 0.5, 0.99]), mask: new Uint8Array([1, 1, 1]), width: 3, height: 1 };
    const h = brushHistogram(map, 1, 0, 5, 2);
    expect(h.length).toBe(2);
    // floor(avg*2): 0.0→bin0, 0.5→bin1, 0.99→bin1. bin0={0.0}=1, bin1={0.5,0.99}=2
    // → normalized to max=1 → [0.5, 1].
    expect(h[0]).toBeCloseTo(0.5, 5);
    expect(h[1]).toBeCloseTo(1, 5);
  });

  it('ignores empty pixels and returns all-zero when none covered', () => {
    const map = { avg: new Float32Array([NaN]), mask: new Uint8Array([0]), width: 1, height: 1 };
    const h = brushHistogram(map, 0, 0, 3, 4);
    expect([...h]).toEqual([0, 0, 0, 0]);
  });
});

describe('regionMask', () => {
  it('marks covered pixels within epsilon of the stop index', () => {
    const map = { avg: new Float32Array([0.10, 0.50, 0.52, NaN]), mask: new Uint8Array([1, 1, 1, 0]), width: 4, height: 1 };
    const m = regionMask(map, 0.5, 0.03);
    expect([...m]).toEqual([0, 1, 1, 0]);
  });
});

describe('insertStopAtIndex', () => {
  it('inserts a sorted stop when none is near', () => {
    const r = insertStopAtIndex([{ t: 0, r: 0, g: 0, b: 0 }, { t: 1, r: 1, g: 1, b: 1 }], 0.4, { r: 0.5, g: 0.2, b: 0.1 }, 0.02);
    expect(r.selectedExisting).toBe(false);
    expect(r.stops.map((s) => s.t)).toEqual([0, 0.4, 1]);
    expect(r.stops[1]).toMatchObject({ t: 0.4, r: 0.5, g: 0.2, b: 0.1 });
  });

  it('selects an existing stop within dedup instead of duplicating', () => {
    const stops = [{ t: 0, r: 0, g: 0, b: 0 }, { t: 0.41, r: 1, g: 0, b: 0 }, { t: 1, r: 1, g: 1, b: 1 }];
    const r = insertStopAtIndex(stops, 0.4, { r: 0, g: 1, b: 0 }, 0.02);
    expect(r.selectedExisting).toBe(true);
    expect(r.stops).toBe(stops); // unchanged reference
  });
});

describe('clientToPixel', () => {
  it('maps client coords to a backing pixel, null outside', () => {
    const rect = { left: 100, top: 50, width: 200, height: 200 };
    expect(clientToPixel(rect, 200, 150, 384, 384)).toEqual({ ox: 192, oy: 192 });
    expect(clientToPixel(rect, 50, 150, 384, 384)).toBeNull();
  });
});

describe('colorAtIndex', () => {
  it('samples the baked LUT at t', () => {
    const stops = [{ t: 0, r: 0, g: 0, b: 0 }, { t: 1, r: 1, g: 1, b: 1 }];
    const c = colorAtIndex(stops, 0, 'linear', 1);
    expect(c.r).toBeCloseTo(1, 5); expect(c.g).toBeCloseTo(1, 5); expect(c.b).toBeCloseTo(1, 5);
    const mid = colorAtIndex(stops, 0, 'linear', 0.5);
    expect(mid.r).toBeCloseTo(0.5, 1);
  });
});
