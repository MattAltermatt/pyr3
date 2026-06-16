import { describe, it, expect } from 'vitest';
import { apportionWalkers } from './animate-render';

// #302 — largest-remainder (Hamilton) apportionment of the integer walker
// budget across per-sub-frame filter weights. The old max(1,round(...)) floored
// every tail to ≥1, blowing the total toward N for large ntemporal_samples.
describe('apportionWalkers (#302)', () => {
  it('sums EXACTLY to the budget for a box filter, no per-entry floor', () => {
    const N = 2000; // far exceeds the ~1024 dispatch pool — the bug case
    const out = apportionWalkers(1024, new Array(N).fill(1));
    expect(out.reduce((a, b) => a + b, 0)).toBe(1024);
    // most tails are zero, not floored to 1 (the bug would give sum ≈ 2000)
    expect(out.filter((w) => w === 0).length).toBeGreaterThan(900);
  });

  it('preserves the total for a peaked (gaussian-like) filter and keeps the hump', () => {
    const weights = [0.05, 0.3, 1.0, 0.3, 0.05];
    const out = apportionWalkers(100, weights);
    expect(out.reduce((a, b) => a + b, 0)).toBe(100);
    // the center weight (1.0) gets the most; the bug would flatten the hump.
    expect(out[2]).toBeGreaterThan(out[1]!);
    expect(out[2]).toBeGreaterThan(out[3]!);
  });

  it('allocates the whole budget to a single non-zero weight', () => {
    const out = apportionWalkers(64, [0, 0, 1, 0]);
    expect(out).toEqual([0, 0, 64, 0]);
  });

  it('returns all-zero for a zero/empty budget or zero weights', () => {
    expect(apportionWalkers(0, [1, 1, 1])).toEqual([0, 0, 0]);
    expect(apportionWalkers(100, [0, 0])).toEqual([0, 0]);
    expect(apportionWalkers(100, [])).toEqual([]);
  });

  it('never exceeds the budget even with many equal weights', () => {
    for (const N of [3, 7, 1000, 4096]) {
      const out = apportionWalkers(1024, new Array(N).fill(1));
      expect(out.reduce((a, b) => a + b, 0)).toBe(1024);
      expect(out.every((w) => w >= 0)).toBe(true);
    }
  });
});
