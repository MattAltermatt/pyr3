import { describe, expect, it } from 'vitest';
import { createTemporalFilter } from './temporal-filter';

describe('createTemporalFilter — single sub-frame', () => {
  it('N=1 returns [0]/[1.0]/1.0 (motion-blur disabled)', () => {
    const f = createTemporalFilter(1, 'box', 1.0, 0);
    expect(f.deltas).toEqual([0]);
    expect(f.filter).toEqual([1.0]);
    expect(f.sumfilt).toBe(1.0);
  });
});

describe('createTemporalFilter — BOX', () => {
  it('N=4, width=1: deltas span [-0.5, 0.5] uniformly', () => {
    const f = createTemporalFilter(4, 'box', 1.0, 0);
    expect(f.deltas).toHaveLength(4);
    expect(f.deltas[0]).toBeCloseTo(-0.5);
    expect(f.deltas[3]).toBeCloseTo(0.5);
    // Uniform spacing.
    expect(f.deltas[1]! - f.deltas[0]!).toBeCloseTo(1 / 3);
  });

  it('N=4: filter[i] === 1.0 for all i, sumfilt === 1.0', () => {
    const f = createTemporalFilter(4, 'box', 1.0, 0);
    expect(f.filter).toEqual([1, 1, 1, 1]);
    expect(f.sumfilt).toBeCloseTo(1.0);
  });

  it('width=2 doubles delta span', () => {
    const f = createTemporalFilter(4, 'box', 2.0, 0);
    expect(f.deltas[0]).toBeCloseTo(-1);
    expect(f.deltas[3]).toBeCloseTo(1);
  });
});

describe('createTemporalFilter — GAUSSIAN', () => {
  it('peak at center, lower at edges', () => {
    const f = createTemporalFilter(11, 'gaussian', 1.0, 0);
    const center = f.filter[5]!;
    const edge = f.filter[0]!;
    expect(center).toBeGreaterThan(edge);
  });

  it('max(filter) normalized to 1.0', () => {
    const f = createTemporalFilter(11, 'gaussian', 1.0, 0);
    const max = Math.max(...f.filter);
    expect(max).toBeCloseTo(1.0);
  });

  it('sumfilt < 1.0 (energy below box equivalent)', () => {
    // Gaussian is more concentrated than box, so sumfilt (avg weight) < 1.
    const f = createTemporalFilter(11, 'gaussian', 1.0, 0);
    expect(f.sumfilt).toBeLessThan(1.0);
    expect(f.sumfilt).toBeGreaterThan(0);
  });
});

describe('createTemporalFilter — EXP', () => {
  it('positive exponent favors later sub-frames', () => {
    const f = createTemporalFilter(10, 'exp', 1.0, /* exp */ 2.0);
    // filter[i] = ((i+1)/N)^|exp|, so later i = higher weight; normalize → last = 1.
    expect(f.filter[9]).toBeCloseTo(1.0);
    expect(f.filter[0]).toBeLessThan(f.filter[9]!);
  });

  it('negative exponent favors earlier sub-frames', () => {
    const f = createTemporalFilter(10, 'exp', 1.0, /* exp */ -2.0);
    // filter[i] = ((N-i)/N)^|exp|, earlier i = higher weight; first normalized to 1.
    expect(f.filter[0]).toBeCloseTo(1.0);
    expect(f.filter[9]).toBeLessThan(f.filter[0]!);
  });

  it('exp=0 → all weights equal (constant ramp)', () => {
    // pow(slpx, 0) = 1 for any slpx > 0.
    const f = createTemporalFilter(10, 'exp', 1.0, 0);
    for (const v of f.filter) expect(v).toBeCloseTo(1.0);
  });
});

describe('createTemporalFilter — walker-budget invariance', () => {
  it('box: sum(filter[i] / (N * sumfilt)) === 1 (preserves total walkers)', () => {
    const f = createTemporalFilter(7, 'box', 1.0, 0);
    const ratios = f.filter.map((w) => w / (f.filter.length * f.sumfilt));
    const sum = ratios.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });

  it('gaussian: sum(filter[i] / (N * sumfilt)) === 1 (preserves total walkers)', () => {
    const f = createTemporalFilter(11, 'gaussian', 1.0, 0);
    const ratios = f.filter.map((w) => w / (f.filter.length * f.sumfilt));
    const sum = ratios.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });
});
