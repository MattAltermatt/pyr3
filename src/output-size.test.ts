import { describe, it, expect } from 'vitest';
import { longEdgeScaleAdjust, rescaleGenomeToOutput } from './output-size';
import { type Genome } from './genome';

describe('longEdgeScaleAdjust', () => {
  it('4K from HD (same 16:9 aspect) scales by the long-edge ratio', () => {
    expect(longEdgeScaleAdjust({ width: 1920, height: 1080 }, { width: 3840, height: 2160 })).toBeCloseTo(2);
  });
  it('square-1080 from HD-1920 anchors on the source long edge', () => {
    // declMax 1920 → targetMax 1080 ⇒ 0.5625; horizontal framing preserved, short axis reveals more.
    expect(longEdgeScaleAdjust({ width: 1920, height: 1080 }, { width: 1080, height: 1080 })).toBeCloseTo(0.5625);
  });
  it('clamps degenerate (zero) dims to avoid divide-by-zero', () => {
    expect(longEdgeScaleAdjust({ width: 0, height: 0 }, { width: 100, height: 100 })).toBe(100);
  });
});

describe('rescaleGenomeToOutput', () => {
  const base = { scale: 10, size: { width: 1920, height: 1080 } } as unknown as Genome;
  it('sets target size and multiplies scale by the long-edge ratio', () => {
    const out = rescaleGenomeToOutput(base, { width: 3840, height: 2160 });
    expect(out.size).toEqual({ width: 3840, height: 2160 });
    expect(out.scale).toBeCloseTo(20);
  });
  it('falls back to target size when genome has no declared size (scaleAdjust 1)', () => {
    const out = rescaleGenomeToOutput({ scale: 10 } as unknown as Genome, { width: 800, height: 600 });
    expect(out.scale).toBeCloseTo(10);
    expect(out.size).toEqual({ width: 800, height: 600 });
  });
  it('does not mutate the input genome', () => {
    const snapshot = JSON.parse(JSON.stringify(base));
    rescaleGenomeToOutput(base, { width: 3840, height: 2160 });
    expect(base).toEqual(snapshot);
  });
});
