import { type ColorStop, type PaletteMode, bakeLUT, PALETTE_SIZE } from './palette';
import { rgbToHsv, hsvToRgb } from './color-math';

const sortByT = (s: ColorStop[]) => [...s].sort((a, b) => a.t - b.t);

export function reverseStops(stops: ColorStop[]): ColorStop[] {
  return sortByT(stops.map((s) => ({ ...s, t: 1 - s.t })));
}

// Compress the gradient into [0,0.5] and reflect it into [0.5,1] -> symmetric.
export function mirrorStops(stops: ColorStop[]): ColorStop[] {
  const half = stops.map((s) => ({ ...s, t: s.t / 2 }));
  const refl = stops.map((s) => ({ ...s, t: 1 - s.t / 2 }));
  return sortByT([...half, ...refl]);
}

// Cyclic t-shift with wrap. frac in [0,1).
export function rotateStops(stops: ColorStop[], frac: number): ColorStop[] {
  const f = ((frac % 1) + 1) % 1;
  return sortByT(stops.map((s) => ({ ...s, t: (s.t + f) % 1 })));
}

// Invert HSV value, preserve hue/sat.
export function invertLuminanceStops(stops: ColorStop[]): ColorStop[] {
  return stops.map((s) => {
    const { h, s: sat, v } = rgbToHsv(s.r, s.g, s.b);
    const rgb = hsvToRgb(h, sat, 1 - v);
    return { t: s.t, r: rgb.r, g: rgb.g, b: rgb.b };
  });
}

// Bake to the 256 LUT (matches render) then sample N evenly-spaced control points.
export function resampleToN(stops: ColorStop[], n: number, mode: PaletteMode = 'linear'): ColorStop[] {
  const lut = bakeLUT(stops, 0, mode);
  const out: ColorStop[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const idx = Math.round(t * (PALETTE_SIZE - 1));
    out.push({ t, r: lut[idx * 4 + 0]!, g: lut[idx * 4 + 1]!, b: lut[idx * 4 + 2]! });
  }
  return out;
}
