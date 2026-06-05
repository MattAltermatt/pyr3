import { describe, it, expect } from 'vitest';
import {
  qTarget,
  BUILD_UP_TARGET_Q,
  cumulativeSamplesAt,
  rampLabel,
  RAMP_PRESETS,
} from './screensaver-pacing';

describe('qTarget', () => {
  it('is 0 at t=0', () => {
    expect(qTarget(0, 300)).toBe(0);
  });

  it('hits BUILD_UP_TARGET_Q at t=buildUpSec', () => {
    expect(qTarget(300, 300)).toBe(BUILD_UP_TARGET_Q);
  });

  it('clamps at BUILD_UP_TARGET_Q past buildUpSec', () => {
    expect(qTarget(600, 300)).toBe(BUILD_UP_TARGET_Q);
  });

  it('linear in between', () => {
    expect(qTarget(150, 300)).toBe(BUILD_UP_TARGET_Q / 2);
  });

  it('clamps to 0 for negative elapsed', () => {
    expect(qTarget(-10, 300)).toBe(0);
  });

  it('handles buildUpSec=0 (immediately target)', () => {
    expect(qTarget(0,   0)).toBe(BUILD_UP_TARGET_Q);
    expect(qTarget(0.1, 0)).toBe(BUILD_UP_TARGET_Q);
  });
});

describe('cumulativeSamplesAt', () => {
  const TOTAL = 1_000_000;

  it('returns 0 at t=0 regardless of ramp', () => {
    expect(cumulativeSamplesAt(0, 30, TOTAL, 1.0)).toBe(0);
    expect(cumulativeSamplesAt(0, 30, TOTAL, 2.0)).toBe(0);
    expect(cumulativeSamplesAt(0, 30, TOTAL, 3.0)).toBe(0);
  });

  it('returns totalSamples at t=buildUpSec regardless of ramp', () => {
    expect(cumulativeSamplesAt(30, 30, TOTAL, 1.0)).toBe(TOTAL);
    expect(cumulativeSamplesAt(30, 30, TOTAL, 2.0)).toBe(TOTAL);
    expect(cumulativeSamplesAt(30, 30, TOTAL, 3.0)).toBe(TOTAL);
  });

  it('clamps at totalSamples past buildUpSec', () => {
    expect(cumulativeSamplesAt(60, 30, TOTAL, 2.0)).toBe(TOTAL);
  });

  it('linear (ramp=1.0) at t=T/2 returns total/2', () => {
    expect(cumulativeSamplesAt(15, 30, TOTAL, 1.0)).toBeCloseTo(TOTAL / 2);
  });

  it('quadratic (ramp=2.0) at t=T/2 returns total/4', () => {
    expect(cumulativeSamplesAt(15, 30, TOTAL, 2.0)).toBeCloseTo(TOTAL / 4);
  });

  it('cubic (ramp=3.0) at t=T/2 returns total/8', () => {
    expect(cumulativeSamplesAt(15, 30, TOTAL, 3.0)).toBeCloseTo(TOTAL / 8);
  });

  it('heavy (ramp=5.0) at t=T/2 returns total × (1/2)^5', () => {
    expect(cumulativeSamplesAt(15, 30, TOTAL, 5.0)).toBeCloseTo(TOTAL * Math.pow(0.5, 5));
  });

  it('non-integer ramp (1.5) at t=T/2 returns total × (1/2)^1.5', () => {
    expect(cumulativeSamplesAt(15, 30, TOTAL, 1.5)).toBeCloseTo(TOTAL * Math.pow(0.5, 1.5));
  });

  it('returns 0 for negative elapsed', () => {
    expect(cumulativeSamplesAt(-5, 30, TOTAL, 2.0)).toBe(0);
  });

  it('returns totalSamples for buildUpSec=0', () => {
    expect(cumulativeSamplesAt(0,  0, TOTAL, 2.0)).toBe(TOTAL);
    expect(cumulativeSamplesAt(10, 0, TOTAL, 2.0)).toBe(TOTAL);
  });

  it('returns 0 for totalSamples=0', () => {
    expect(cumulativeSamplesAt(15, 30, 0, 2.0)).toBe(0);
  });
});

describe('rampLabel', () => {
  it('returns the preset label for exact matches', () => {
    expect(rampLabel(1)).toBe('Linear');
    expect(rampLabel(2)).toBe('Gentle');
    expect(rampLabel(3)).toBe('Medium');
    expect(rampLabel(5)).toBe('Heavy');
  });

  it('falls back to ×N for custom exponents', () => {
    expect(rampLabel(2.5)).toBe('×2.5');
    expect(rampLabel(4.0)).toBe('×4.0');
    expect(rampLabel(7.5)).toBe('×7.5');
  });
});

describe('RAMP_PRESETS', () => {
  it('exposes 4 presets in ascending exponent order', () => {
    expect(RAMP_PRESETS.map((p) => p.value)).toEqual([1, 2, 3, 5]);
  });

  it('all preset labels round-trip through rampLabel', () => {
    for (const p of RAMP_PRESETS) expect(rampLabel(p.value)).toBe(p.label);
  });
});
