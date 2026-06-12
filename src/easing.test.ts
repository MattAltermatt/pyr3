import { describe, it, expect } from 'vitest';
import { evalEasing, type EasingCurve } from './easing';

describe('evalEasing — presets', () => {
  it('linear is the identity remap', () => {
    const c: EasingCurve = { kind: 'preset', name: 'linear' };
    expect(evalEasing(c, 0)).toBeCloseTo(0);
    expect(evalEasing(c, 0.5)).toBeCloseTo(0.5);
    expect(evalEasing(c, 1)).toBeCloseTo(1);
  });

  it('easeIn = t^2 (slow start)', () => {
    const c: EasingCurve = { kind: 'preset', name: 'easeIn' };
    expect(evalEasing(c, 0.5)).toBeCloseTo(0.25);
    expect(evalEasing(c, 0)).toBeCloseTo(0);
    expect(evalEasing(c, 1)).toBeCloseTo(1);
  });

  it('easeOut = 1-(1-t)^2 (slow end)', () => {
    const c: EasingCurve = { kind: 'preset', name: 'easeOut' };
    expect(evalEasing(c, 0.5)).toBeCloseTo(0.75);
  });

  it('easeInOut = smoothstep, symmetric about 0.5', () => {
    const c: EasingCurve = { kind: 'preset', name: 'easeInOut' };
    expect(evalEasing(c, 0.5)).toBeCloseTo(0.5);
    expect(evalEasing(c, 0.25)).toBeCloseTo(0.15625);
    expect(evalEasing(c, 0.25) + evalEasing(c, 0.75)).toBeCloseTo(1);
  });

  it('hold is a step discontinuity: 0 until the very end, then 1', () => {
    const c: EasingCurve = { kind: 'preset', name: 'hold' };
    expect(evalEasing(c, 0)).toBe(0);
    expect(evalEasing(c, 0.99)).toBe(0);
    expect(evalEasing(c, 1)).toBe(1);
  });

  it('clamps the input to [0,1]', () => {
    const c: EasingCurve = { kind: 'preset', name: 'linear' };
    expect(evalEasing(c, -0.5)).toBeCloseTo(0);
    expect(evalEasing(c, 1.5)).toBeCloseTo(1);
  });
});

describe('evalEasing — cubicBezier', () => {
  it('the linear bezier (0,0,1,1) is the identity', () => {
    const c: EasingCurve = { kind: 'cubicBezier', x1: 0, y1: 0, x2: 1, y2: 1 };
    expect(evalEasing(c, 0.3)).toBeCloseTo(0.3, 3);
    expect(evalEasing(c, 0.7)).toBeCloseTo(0.7, 3);
  });

  it('ease-in (0.42,0,1,1) lags identity at t=0.5', () => {
    const c: EasingCurve = { kind: 'cubicBezier', x1: 0.42, y1: 0, x2: 1, y2: 1 };
    expect(evalEasing(c, 0.5)).toBeLessThan(0.5);
  });

  it('matches CSS ease-in-out (0.42,0,0.58,1) at the midpoint', () => {
    const c: EasingCurve = { kind: 'cubicBezier', x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
    expect(evalEasing(c, 0.5)).toBeCloseTo(0.5, 3);
  });

  it('is monotonic increasing for an in-[0,1]-handle curve', () => {
    const c: EasingCurve = { kind: 'cubicBezier', x1: 0.42, y1: 0, x2: 1, y2: 1 };
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const y = evalEasing(c, i / 20);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });

  it('clamps overshoot output (y outside [0,1]) back into range', () => {
    const c: EasingCurve = { kind: 'cubicBezier', x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 };
    for (let i = 0; i <= 20; i++) {
      const y = evalEasing(c, i / 20);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it('unknown kind falls back to linear', () => {
    const c = { kind: 'mystery' } as unknown as EasingCurve;
    expect(evalEasing(c, 0.4)).toBeCloseTo(0.4);
  });

  it('stays finite and in-range for out-of-[0,1] x handles (non-monotone)', () => {
    const c: EasingCurve = { kind: 'cubicBezier', x1: -0.5, y1: 0.2, x2: 1.5, y2: 0.8 };
    for (let i = 0; i <= 20; i++) {
      const y = evalEasing(c, i / 20);
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });
});
