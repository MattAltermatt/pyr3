import { describe, it, expect } from 'vitest';
import { reverseStops, mirrorStops, rotateStops, invertLuminanceStops, resampleToN } from './palette-transforms';
import { type ColorStop } from './palette';

const G: ColorStop[] = [
  { t: 0, r: 0, g: 0, b: 0 }, { t: 0.5, r: 0.5, g: 0.2, b: 0.1 }, { t: 1, r: 1, g: 1, b: 1 },
];

describe('palette-transforms', () => {
  it('reverse flips t and keeps colors', () => {
    const out = reverseStops(G);
    expect(out[0]!.t).toBeCloseTo(0); expect(out[0]!.r).toBeCloseTo(1);
    expect(out[out.length - 1]!.r).toBeCloseTo(0);
  });
  it('mirror produces a symmetric gradient spanning [0,1]', () => {
    const out = mirrorStops(G);
    expect(out[0]!.t).toBeCloseTo(0);
    expect(out[out.length - 1]!.t).toBeCloseTo(1);
  });
  it('rotate shifts t cyclically and wraps', () => {
    const out = rotateStops(G, 0.25);
    expect(out.every((s) => s.t >= 0 && s.t <= 1)).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(G.length);
  });
  it('invert-luminance darkens the white stop and brightens black', () => {
    const out = invertLuminanceStops(G);
    expect(out[0]!.r).toBeGreaterThan(0.5);
    expect(out[out.length - 1]!.r).toBeLessThan(0.5);
  });
  it('resampleToN returns exactly N stops at even t spanning [0,1]', () => {
    const out = resampleToN(G, 5);
    expect(out.length).toBe(5);
    expect(out[0]!.t).toBeCloseTo(0); expect(out[4]!.t).toBeCloseTo(1);
    expect(out[2]!.t).toBeCloseTo(0.5);
  });
});
