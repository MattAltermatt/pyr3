import { describe, it, expect } from 'vitest';
import {
  computeMeanLuminance,
  computeMeanLuminanceHalf,
  fitBrightnessToTarget,
  AE_DEADBAND,
  AE_MAX_ITERS,
  AE_BRIGHTNESS_MAX,
} from './auto-exposure';

// Encode an f32 into an IEEE-754 half (float16) bit pattern for test fixtures.
function floatToHalf(v: number): number {
  const f = new Float32Array(1);
  const i = new Uint32Array(f.buffer);
  f[0] = v;
  const x = i[0]!;
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  const mant = x & 0x7fffff;
  if (exp <= 0) return sign; // flush sub-normals/zero to 0 (sufficient for [0,1] fixtures)
  if (exp >= 0x1f) return sign | 0x7c00; // inf
  return sign | (exp << 10) | (mant >>> 13);
}

function halfBuffer(pixels: Array<[number, number, number, number]>): Uint8Array {
  const out = new Uint8Array(pixels.length * 8);
  const view = new DataView(out.buffer);
  pixels.forEach((p, idx) => {
    for (let c = 0; c < 4; c++) view.setUint16(idx * 8 + c * 2, floatToHalf(p[c]!), true);
  });
  return out;
}

describe('computeMeanLuminance (rgba8unorm)', () => {
  it('returns 0 for an empty buffer', () => {
    expect(computeMeanLuminance(new Uint8Array(0))).toBe(0);
  });

  it('returns 0 for all-black', () => {
    expect(computeMeanLuminance(new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]))).toBe(0);
  });

  it('returns 255 for all-white (alpha ignored)', () => {
    expect(computeMeanLuminance(new Uint8Array([255, 255, 255, 255]))).toBe(255);
  });

  it('averages (R+G+B)/3 over pixels', () => {
    // pixel A = (60,90,120) → 90; pixel B = (0,0,0) → 0; mean = 45
    expect(computeMeanLuminance(new Uint8Array([60, 90, 120, 255, 0, 0, 0, 255]))).toBe(45);
  });
});

describe('computeMeanLuminanceHalf (rgba16float → [0,255])', () => {
  it('returns 0 for an empty buffer', () => {
    expect(computeMeanLuminanceHalf(new Uint8Array(0))).toBe(0);
  });

  it('maps full-white half pixels to ~255', () => {
    const buf = halfBuffer([[1, 1, 1, 1]]);
    expect(computeMeanLuminanceHalf(buf)).toBeCloseTo(255, 4);
  });

  it('clamps out-of-range half values to [0,1]·255', () => {
    const buf = halfBuffer([[4, 4, 4, 1]]); // > 1 → clamped to 1 → 255
    expect(computeMeanLuminanceHalf(buf)).toBeCloseTo(255, 4);
  });

  it('matches the rgba8 scale (0.5 grey → ~127.5)', () => {
    const buf = halfBuffer([[0.5, 0.5, 0.5, 1]]);
    expect(computeMeanLuminanceHalf(buf)).toBeCloseTo(127.5, 1);
  });

  it('treats NaN half-float pixels as 0 (no NaN propagation — #388 class)', () => {
    // half-float NaN = exponent 0x1f + nonzero fraction → 0x7e00.
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setUint16(0, 0x7e00, true); // R = NaN
    new DataView(buf.buffer).setUint16(2, 0x7e00, true); // G = NaN
    new DataView(buf.buffer).setUint16(4, 0x7e00, true); // B = NaN
    const m = computeMeanLuminanceHalf(buf);
    expect(Number.isFinite(m)).toBe(true);
    expect(m).toBe(0);
  });
});

describe('fitBrightnessToTarget', () => {
  it('no-ops within the deadband (byte-identical render)', async () => {
    let calls = 0;
    const fit = await fitBrightnessToTarget(3.0, 100, 100 * (1 + AE_DEADBAND / 2), async () => {
      calls++;
      return 0;
    });
    expect(fit.corrected).toBe(false);
    expect(fit.brightness).toBe(3.0);
    expect(fit.iters).toBe(0);
    expect(calls).toBe(0); // never re-presents
  });

  it('no-ops on a black initial render (guard)', async () => {
    const fit = await fitBrightnessToTarget(3.0, 100, 0, async () => 100);
    expect(fit.corrected).toBe(false);
    expect(fit.brightness).toBe(3.0);
  });

  it('no-ops on a black target (guard)', async () => {
    const fit = await fitBrightnessToTarget(3.0, 0, 50, async () => 100);
    expect(fit.corrected).toBe(false);
  });

  it('no-ops (never presents NaN) on non-finite means', async () => {
    let calls = 0;
    const rerender = async () => {
      calls++;
      return 50;
    };
    const a = await fitBrightnessToTarget(3.0, NaN, 50, rerender);
    const b = await fitBrightnessToTarget(3.0, 100, NaN, rerender);
    expect(a.corrected).toBe(false);
    expect(a.brightness).toBe(3.0);
    expect(b.corrected).toBe(false);
    expect(b.brightness).toBe(3.0);
    expect(calls).toBe(0);
  });

  it('converges a perfectly-linear brightness→luminance map in one pass', async () => {
    // model: mean = brightness × 10. base brightness 1 → initial mean 10.
    // target 80 → needs brightness 8.
    const rerender = async (b: number) => b * 10;
    const fit = await fitBrightnessToTarget(1.0, 80, 10, rerender);
    expect(fit.corrected).toBe(true);
    expect(fit.brightness).toBeCloseTo(8.0, 6);
    expect(fit.finalMean).toBeCloseTo(80, 6);
    expect(fit.iters).toBe(1);
  });

  it('converges a non-linear (sub-linear) map within the iteration cap', async () => {
    // model: mean = 30 × log(1 + brightness). base brightness 1 → ~20.79.
    const rerender = async (b: number) => 30 * Math.log(1 + b);
    const target = 60; // requires brightness = e^2 − 1 ≈ 6.389
    const fit = await fitBrightnessToTarget(1.0, target, 30 * Math.log(2), rerender);
    expect(fit.corrected).toBe(true);
    expect(fit.iters).toBeLessThanOrEqual(AE_MAX_ITERS);
    expect(fit.finalMean / target).toBeGreaterThan(1 - AE_DEADBAND);
    expect(fit.finalMean / target).toBeLessThan(1 + AE_DEADBAND);
  });

  it('clamps brightness to AE_BRIGHTNESS_MAX for an unreachable target', async () => {
    // saturating map: mean asymptotes to 5 regardless of brightness → target 100
    // is unreachable, brightness runs to the clamp.
    const rerender = async (b: number) => 5 * (1 - Math.exp(-b / 1e6));
    const fit = await fitBrightnessToTarget(1.0, 100, 5 * (1 - Math.exp(-1 / 1e6)), rerender);
    expect(fit.brightness).toBeLessThanOrEqual(AE_BRIGHTNESS_MAX);
    expect(fit.iters).toBeLessThanOrEqual(AE_MAX_ITERS);
  });
});
