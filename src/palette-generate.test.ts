import { describe, it, expect } from 'vitest';
import { generateRamp, seedToHue, C_MAX, type RampParams } from './palette-generate';

const base: RampParams = {
  mode: 'rainbow', hue: 0, chroma: 0.6, lightness: 0.65,
  lightFrom: 0.15, lightTo: 0.85, loops: 1, direction: 1, stops: 16,
};

describe('generateRamp', () => {
  it('emits the requested number of stops with monotone t in [0,1]', () => {
    const s = generateRamp({ ...base, stops: 12 });
    expect(s).toHaveLength(12);
    expect(s[0]!.t).toBe(0);
    expect(s[s.length - 1]!.t).toBeCloseTo(1, 6);
    for (let i = 1; i < s.length; i++) expect(s[i]!.t).toBeGreaterThan(s[i - 1]!.t);
  });

  it('keeps every channel in [0,1]', () => {
    for (const st of generateRamp({ ...base, chroma: 1 })) {
      for (const c of [st.r, st.g, st.b]) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
    }
  });

  it('is deterministic for identical params', () => {
    expect(generateRamp(base)).toEqual(generateRamp(base));
  });

  it('rainbow with integer loops wraps seamlessly (first ~= last color)', () => {
    const s = generateRamp({ ...base, loops: 2, hue: 40 });
    expect(s[0]!.r).toBeCloseTo(s[s.length - 1]!.r, 2);
    expect(s[0]!.g).toBeCloseTo(s[s.length - 1]!.g, 2);
    expect(s[0]!.b).toBeCloseTo(s[s.length - 1]!.b, 2);
  });

  it('direction reverses the hue travel', () => {
    const cw = generateRamp({ ...base, loops: 1, direction: 1, stops: 5 });
    const ccw = generateRamp({ ...base, loops: 1, direction: -1, stops: 5 });
    expect(cw[1]!.r === ccw[1]!.r && cw[1]!.g === ccw[1]!.g && cw[1]!.b === ccw[1]!.b).toBe(false);
  });

  it('shades mode ramps lightness monotonically and holds one hue', () => {
    const s = generateRamp({ ...base, mode: 'shades', hue: 220, lightFrom: 0.1, lightTo: 0.9, stops: 8 });
    const lum = (c: { r: number; g: number; b: number }) => c.r + c.g + c.b;
    expect(lum(s[s.length - 1]!)).toBeGreaterThan(lum(s[0]!));
  });

  it('clamps stops to a sane minimum of 2', () => {
    expect(generateRamp({ ...base, stops: 1 }).length).toBeGreaterThanOrEqual(2);
  });
});

describe('seedToHue', () => {
  it('is deterministic and in [0,360)', () => {
    for (const seed of [0, 1, 7, 12345]) {
      const h = seedToHue(seed);
      expect(h).toBe(seedToHue(seed));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
  it('C_MAX is a positive sRGB-ish chroma ceiling', () => {
    expect(C_MAX).toBeGreaterThan(0.2);
    expect(C_MAX).toBeLessThan(0.5);
  });
});
