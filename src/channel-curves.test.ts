import { describe, it, expect } from 'vitest';
import {
  validate,
  isIdentity,
  activeMask,
  bakeOne,
  bakeCurves,
  IDENTITY_POINTS,
} from './channel-curves';
import type { CurvePoint } from './genome';

describe('channel-curves: validate', () => {
  it('accepts a minimal identity curve', () => {
    expect(() => validate([{ x: 0, y: 0 }, { x: 1, y: 1 }])).not.toThrow();
  });
  it('rejects fewer than 2 points', () => {
    expect(() => validate([{ x: 0.5, y: 0.5 }])).toThrow(/at least 2/);
  });
  it('rejects more than 8 points', () => {
    const pts: CurvePoint[] = Array.from({ length: 9 }, (_, i) => ({ x: i / 8, y: i / 8 }));
    expect(() => validate(pts)).toThrow(/at most 8/);
  });
  it('rejects non-monotonic x', () => {
    expect(() => validate([
      { x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0.4, y: 0.4 }, { x: 1, y: 1 },
    ])).toThrow(/monotonic/);
  });
  it('rejects x out of [0,1]', () => {
    expect(() => validate([{ x: -0.1, y: 0 }, { x: 1, y: 1 }])).toThrow(/range/);
    expect(() => validate([{ x: 0, y: 0 }, { x: 1.1, y: 1 }])).toThrow(/range/);
  });
  it('rejects y out of [0,1]', () => {
    expect(() => validate([{ x: 0, y: -0.1 }, { x: 1, y: 1 }])).toThrow(/range/);
  });
});

describe('channel-curves: isIdentity', () => {
  it('returns true only for exactly [(0,0),(1,1)]', () => {
    expect(isIdentity([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(true);
  });
  it('returns false for [(0,0),(0.5,0.5),(1,1)]', () => {
    expect(isIdentity([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }])).toBe(false);
  });
  it('returns false for [(0,0),(1,0.99)]', () => {
    expect(isIdentity([{ x: 0, y: 0 }, { x: 1, y: 0.99 }])).toBe(false);
  });
});

describe('channel-curves: activeMask', () => {
  it('returns 0 for undefined', () => {
    expect(activeMask(undefined)).toBe(0);
  });
  it('returns 0 when all 5 channels are identity', () => {
    expect(activeMask({
      composite: IDENTITY_POINTS, r: IDENTITY_POINTS, g: IDENTITY_POINTS,
      b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    })).toBe(0);
  });
  it('returns the right bit per active channel', () => {
    const id = IDENTITY_POINTS;
    const lift: CurvePoint[] = [{ x: 0, y: 0.2 }, { x: 1, y: 1 }];
    expect(activeMask({ composite: lift, r: id,   g: id,   b: id,   luma: id   })).toBe(0b00001);
    expect(activeMask({ composite: id,   r: lift, g: id,   b: id,   luma: id   })).toBe(0b00010);
    expect(activeMask({ composite: id,   r: id,   g: lift, b: id,   luma: id   })).toBe(0b00100);
    expect(activeMask({ composite: id,   r: id,   g: id,   b: lift, luma: id   })).toBe(0b01000);
    expect(activeMask({ composite: id,   r: id,   g: id,   b: id,   luma: lift })).toBe(0b10000);
    expect(activeMask({ composite: lift, r: lift, g: lift, b: lift, luma: lift })).toBe(0b11111);
  });
});

describe('channel-curves: bakeOne', () => {
  it('identity bakes to y = x ± 1/512', () => {
    const lut = bakeOne(IDENTITY_POINTS);
    expect(lut.length).toBe(256);
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBeCloseTo(i / 255, 2);
    }
  });
  it('inverse curve bakes y = 1 - x', () => {
    const lut = bakeOne([{ x: 0, y: 1 }, { x: 1, y: 0 }]);
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBeCloseTo(1 - i / 255, 2);
    }
  });
  it('clamps below the leftmost point to its y', () => {
    const lut = bakeOne([{ x: 0.25, y: 0.5 }, { x: 1, y: 1 }]);
    // LUT samples at x = i/255 for i = 0..63 fall below 0.25 → clamped to 0.5
    expect(lut[0]).toBeCloseTo(0.5, 3);
    expect(lut[30]).toBeCloseTo(0.5, 3);
    expect(lut[63]).toBeCloseTo(0.5, 3);
  });
  it('clamps above the rightmost point to its y', () => {
    const lut = bakeOne([{ x: 0, y: 0 }, { x: 0.75, y: 0.5 }]);
    expect(lut[200]).toBeCloseTo(0.5, 3);
    expect(lut[255]).toBeCloseTo(0.5, 3);
  });
  it('soft-S curve has S shape (midpoint ≈ 0.5; shadows below, highlights above diagonal)', () => {
    const lut = bakeOne([
      { x: 0, y: 0 }, { x: 0.25, y: 0.2 }, { x: 0.75, y: 0.8 }, { x: 1, y: 1 },
    ]);
    expect(lut[127]).toBeCloseTo(0.5, 1);
    expect(lut[64]).toBeLessThan(0.25);
    expect(lut[192]).toBeGreaterThan(0.75);
  });
  it('clamps output to [0, 1] even when spline overshoots', () => {
    const lut = bakeOne([
      { x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 1 },
    ]);
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(0);
      expect(lut[i]).toBeLessThanOrEqual(1);
    }
  });
});

describe('channel-curves: bakeCurves', () => {
  it('returns null when all 5 channels are identity', () => {
    expect(bakeCurves({
      composite: IDENTITY_POINTS, r: IDENTITY_POINTS, g: IDENTITY_POINTS,
      b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    })).toBeNull();
  });
  it('packs 5x256 = 1280 floats when at least one channel is non-identity', () => {
    const lift: CurvePoint[] = [{ x: 0, y: 0.2 }, { x: 1, y: 1 }];
    const lut = bakeCurves({
      composite: lift, r: IDENTITY_POINTS, g: IDENTITY_POINTS,
      b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    });
    expect(lut).not.toBeNull();
    expect(lut!.length).toBe(5 * 256);
    // channel 0 (composite) was lifted at x=0 → y=0.2
    expect(lut![0]).toBeCloseTo(0.2, 2);
    // channel 1 (R) was identity
    expect(lut![1 * 256 + 127]).toBeCloseTo(127 / 255, 2);
  });
  it('packs channels in the canonical order: composite, r, g, b, luma', () => {
    const liftA: CurvePoint[] = [{ x: 0, y: 0.1 }, { x: 1, y: 0.1 }];
    const liftB: CurvePoint[] = [{ x: 0, y: 0.3 }, { x: 1, y: 0.3 }];
    const liftC: CurvePoint[] = [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }];
    const liftD: CurvePoint[] = [{ x: 0, y: 0.7 }, { x: 1, y: 0.7 }];
    const liftE: CurvePoint[] = [{ x: 0, y: 0.9 }, { x: 1, y: 0.9 }];
    const lut = bakeCurves({ composite: liftA, r: liftB, g: liftC, b: liftD, luma: liftE });
    expect(lut![0 * 256]).toBeCloseTo(0.1, 2);  // composite
    expect(lut![1 * 256]).toBeCloseTo(0.3, 2);  // r
    expect(lut![2 * 256]).toBeCloseTo(0.5, 2);  // g
    expect(lut![3 * 256]).toBeCloseTo(0.7, 2);  // b
    expect(lut![4 * 256]).toBeCloseTo(0.9, 2);  // luma
  });
});
