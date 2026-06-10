import { describe, expect, it } from 'vitest';
import { motionFuncs, applyMotionParameters } from './motion';
import { type Xform } from './genome';
import { linear as linearVar, julian, V } from './variations';

// ── motionFuncs ────────────────────────────────────────────────────────────

describe('motionFuncs — SIN (1)', () => {
  it('sin(2π * 0) = 0', () => {
    expect(motionFuncs(1, 0)).toBeCloseTo(0);
  });
  it('sin(2π * 0.25) = 1 (peak)', () => {
    expect(motionFuncs(1, 0.25)).toBeCloseTo(1);
  });
  it('sin(2π * 0.5) = 0 (zero crossing)', () => {
    expect(motionFuncs(1, 0.5)).toBeCloseTo(0);
  });
  it('sin(2π * 0.75) = -1 (trough)', () => {
    expect(motionFuncs(1, 0.75)).toBeCloseTo(-1);
  });
  it('sin(2π * 1) = 0 (zero at integer t)', () => {
    expect(motionFuncs(1, 1)).toBeCloseTo(0);
  });
});

describe('motionFuncs — TRIANGLE (2)', () => {
  it('triangle(0) = 0', () => {
    expect(motionFuncs(2, 0)).toBeCloseTo(0);
  });
  it('triangle(0.25) = +1 (peak)', () => {
    expect(motionFuncs(2, 0.25)).toBeCloseTo(1);
  });
  it('triangle(0.5) = 0 (zero crossing)', () => {
    expect(motionFuncs(2, 0.5)).toBeCloseTo(0);
  });
  it('triangle(0.75) = -1 (trough)', () => {
    expect(motionFuncs(2, 0.75)).toBeCloseTo(-1);
  });
  it('triangle(1) = 0 (zero at integer t)', () => {
    expect(motionFuncs(2, 1)).toBeCloseTo(0);
  });
  it('triangle is cyclic over negative input', () => {
    expect(motionFuncs(2, -0.75)).toBeCloseTo(motionFuncs(2, 0.25));
  });
});

describe('motionFuncs — HILL (3)', () => {
  it('hill(0) = 0', () => {
    expect(motionFuncs(3, 0)).toBeCloseTo(0);
  });
  it('hill(0.5) = 1 (peak)', () => {
    expect(motionFuncs(3, 0.5)).toBeCloseTo(1);
  });
  it('hill(1) = 0 (zero at integer t)', () => {
    expect(motionFuncs(3, 1)).toBeCloseTo(0);
  });
  it('hill stays non-negative (range [0, 1])', () => {
    for (let t = 0; t < 1; t += 0.05) {
      const v = motionFuncs(3, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

// ── applyMotionParameters ─────────────────────────────────────────────────

const base = (overrides: Partial<Xform> = {}): Xform => ({
  a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
  weight: 1, color: 0, colorSpeed: 0.5,
  variations: [linearVar(1)],
  ...overrides,
});

describe('applyMotionParameters', () => {
  it('no-op when xform.motion is undefined', () => {
    const x = base();
    const r = applyMotionParameters(x, 0.5);
    expect(r).toEqual(x);
  });

  it('no-op when xform.motion is empty array', () => {
    const x = base({ motion: [] });
    const r = applyMotionParameters(x, 0.5);
    expect(r).toEqual(x);
  });

  it('does not mutate input xform', () => {
    const motionEl = base({ motion_freq: 1, motion_func: 1, a: 10, b: 0, c: 0, d: 0, e: 0, f: 0, weight: 0, color: 0, colorSpeed: 0, variations: [] });
    const x = base({ motion: [motionEl] });
    const snapshot = JSON.parse(JSON.stringify(x));
    applyMotionParameters(x, 0.25);
    expect(x).toEqual(snapshot);
  });

  it('SIN motion @ blend=0 = 0 contribution (zero crossing)', () => {
    const motionEl = base({ motion_freq: 1, motion_func: 1, a: 10, b: 0, c: 0, d: 0, e: 0, f: 0, weight: 0, color: 0, colorSpeed: 0, variations: [] });
    const x = base({ motion: [motionEl] });
    const r = applyMotionParameters(x, 0);
    expect(r.a).toBeCloseTo(1);  // unchanged
  });

  it('SIN motion @ blend=0.25 with freq=1 → full motion element contribution', () => {
    // sin(2π · 1 · 0.25) = sin(π/2) = 1 → contribution = motion.a * 1 = 10
    const motionEl = base({ motion_freq: 1, motion_func: 1, a: 10, b: 0, c: 0, d: 0, e: 0, f: 0, weight: 0, color: 0, colorSpeed: 0, variations: [] });
    const x = base({ motion: [motionEl] });
    const r = applyMotionParameters(x, 0.25);
    expect(r.a).toBeCloseTo(11);  // base 1 + contribution 10
  });

  it('HILL motion @ blend=0.5 with freq=1 → peak contribution', () => {
    const motionEl = base({ motion_freq: 1, motion_func: 3, a: 5, b: 0, c: 0, d: 0, e: 0, f: 0, weight: 0, color: 0, colorSpeed: 0, variations: [] });
    const x = base({ motion: [motionEl] });
    const r = applyMotionParameters(x, 0.5);
    expect(r.a).toBeCloseTo(6);  // base 1 + 5 * 1
  });

  it('motion_freq=2 doubles the cycle rate', () => {
    // SIN with freq=2 at blend=0.25 → sin(2π · 2 · 0.25) = sin(π) = 0
    const motionEl = base({ motion_freq: 2, motion_func: 1, a: 10, b: 0, c: 0, d: 0, e: 0, f: 0, weight: 0, color: 0, colorSpeed: 0, variations: [] });
    const x = base({ motion: [motionEl] });
    const r = applyMotionParameters(x, 0.25);
    expect(r.a).toBeCloseTo(1);  // base unchanged at this phase
  });

  it('multiple motion elements sum contributions', () => {
    const m1 = base({ motion_freq: 1, motion_func: 1, a: 5, b: 0, c: 0, d: 0, e: 0, f: 0, weight: 0, color: 0, colorSpeed: 0, variations: [] });
    const m2 = base({ motion_freq: 1, motion_func: 1, a: 3, b: 0, c: 0, d: 0, e: 0, f: 0, weight: 0, color: 0, colorSpeed: 0, variations: [] });
    const x = base({ motion: [m1, m2] });
    const r = applyMotionParameters(x, 0.25);
    expect(r.a).toBeCloseTo(1 + 5 + 3);
  });

  it('motion_func=0 means no contribution', () => {
    const motionEl = base({ motion_freq: 1, motion_func: 0, a: 10, b: 0, c: 0, d: 0, e: 0, f: 0, weight: 0, color: 0, colorSpeed: 0, variations: [] });
    const x = base({ motion: [motionEl] });
    const r = applyMotionParameters(x, 0.25);
    expect(r.a).toBeCloseTo(1);  // unchanged
  });

  it('clamps color to [0, 1] after motion applied', () => {
    const motionEl = base({ motion_freq: 1, motion_func: 1, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, weight: 0, color: 100, colorSpeed: 0, variations: [] });
    const x = base({ color: 0.5, motion: [motionEl] });
    const r = applyMotionParameters(x, 0.25);
    expect(r.color).toBeLessThanOrEqual(1);
    expect(r.color).toBeGreaterThanOrEqual(0);
  });

  it('clamps weight to ≥ 0 after motion applied', () => {
    const motionEl = base({ motion_freq: 1, motion_func: 1, a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, weight: -100, color: 0, colorSpeed: 0, variations: [] });
    const x = base({ weight: 0.5, motion: [motionEl] });
    const r = applyMotionParameters(x, 0.25);
    expect(r.weight).toBeGreaterThanOrEqual(0);
  });

  it('applies motion to variation weights by matched index', () => {
    // Base xform has linear(weight=1). Motion element overlays linear with weight=2.
    const motionEl: Xform = base({
      motion_freq: 1, motion_func: 1,
      a: 0, b: 0, c: 0, d: 0, e: 0, f: 0,
      weight: 0, color: 0, colorSpeed: 0,
      variations: [linearVar(2)],
    });
    const x = base({ motion: [motionEl] });
    const r = applyMotionParameters(x, 0.25);
    // sin(2π · 1 · 0.25) = 1, so contribution = 2 * 1 = 2; result weight = 1 + 2 = 3
    expect(r.variations[0]!.weight).toBeCloseTo(3);
  });

  it('drops motion contributions for variations missing from base xform', () => {
    // Base xform has only linear. Motion element overlays julian — no match, drop.
    const motionEl: Xform = base({
      motion_freq: 1, motion_func: 1,
      a: 0, b: 0, c: 0, d: 0, e: 0, f: 0,
      weight: 0, color: 0, colorSpeed: 0,
      variations: [julian(2, 3, 1)],
    });
    const x = base({ motion: [motionEl] });
    const r = applyMotionParameters(x, 0.25);
    // Base xform should still only have linear; no julian appears.
    expect(r.variations).toHaveLength(1);
    expect(r.variations[0]!.index).toBe(V.linear);
  });

  it('applies motion to variation params when matched', () => {
    // Base julian with power=2. Motion overlays julian with power=4. blend=0.25, sin peak.
    const motionEl: Xform = base({
      motion_freq: 1, motion_func: 1,
      a: 0, b: 0, c: 0, d: 0, e: 0, f: 0,
      weight: 0, color: 0, colorSpeed: 0,
      variations: [julian(0, 4, 0)],  // weight=0 to test param-only contribution
    });
    const x = base({ variations: [julian(1, 2, 1)], motion: [motionEl] });
    const r = applyMotionParameters(x, 0.25);
    // power: base 2 + (4 * 1.0) = 6
    expect(r.variations[0]!.param0).toBeCloseTo(6);
  });
});
