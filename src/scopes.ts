// #174 — Color-grading scopes. Pure binning math for the editor's Scopes
// section (src/edit-section-scopes.ts). DOM-free so it stays engine-clean
// (passes typecheck:engine) and unit-testable. Bins are integer counts
// (Uint32Array) so they normalize through normalizeBins(...,'log') — the
// same log-density trick the histogram uses to keep a flame's huge black
// background from crushing mid-tones. See 2026-06-17-scopes-panel-design.md.

import type { SettledPixels } from './edit-state';

/** Rec.709 luma coefficients (R, G, B). Sum to 1. */
export const REC709: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

export function luma(r: number, g: number, b: number): number {
  return REC709[0] * r + REC709[1] * g + REC709[2] * b;
}

export interface WaveformBins {
  width: number;
  height: number;
  /** [scopeY * width + scopeX] integer hit counts; scopeY=0 is brightest. */
  lum: Uint32Array;
}

/** Luminance waveform: source-x → scope-x, brightness → scope-y (top=bright). */
export function computeWaveform(px: SettledPixels, width: number, height: number): WaveformBins {
  const lum = new Uint32Array(width * height);
  const { width: W, height: H, rgba } = px;
  if (W <= 0 || H <= 0) return { width, height, lum };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const L = luma(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!); // 0..255
      let sx = ((x / W) * width) | 0; if (sx >= width) sx = width - 1;
      // round (not truncate): float luma of pure white is 254.999…, which
      // would floor one row below the top. round lands 255 → top row.
      let sy = (height - 1) - Math.round((L / 255) * (height - 1));
      if (sy < 0) sy = 0; if (sy >= height) sy = height - 1;
      lum[sy * width + sx]!++;
    }
  }
  return { width, height, lum };
}

export interface ParadeBins {
  segW: number;
  height: number;
  /** Each is [scopeY * segW + scopeX] counts; scopeY=0 = channel value 255. */
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
}

/** RGB parade: three side-by-side waveforms, one per channel (raw value). */
export function computeParade(px: SettledPixels, segW: number, height: number): ParadeBins {
  const r = new Uint32Array(segW * height);
  const g = new Uint32Array(segW * height);
  const b = new Uint32Array(segW * height);
  const out: [Uint32Array, Uint32Array, Uint32Array] = [r, g, b];
  const { width: W, height: H, rgba } = px;
  if (W <= 0 || H <= 0) return { segW, height, r, g, b };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let sx = ((x / W) * segW) | 0; if (sx >= segW) sx = segW - 1;
      for (let ch = 0; ch < 3; ch++) {
        const val = rgba[i + ch]!; // 0..255
        let sy = (height - 1) - Math.round((val / 255) * (height - 1));
        if (sy < 0) sy = 0; if (sy >= height) sy = height - 1;
        out[ch]![sy * segW + sx]!++;
      }
    }
  }
  return { segW, height, r, g, b };
}

export interface VectorBins {
  size: number;
  /** [y * size + x] counts on a square grid; center = neutral (no chroma). */
  density: Uint32Array;
}

/** Vectorscope: polar chroma. U=B−Y, V=R−Y plotted from center (V up). GAIN=1
 *  keeps even fully-saturated primaries inside the disc — blue has the largest
 *  chroma magnitude (~0.93 of the radius), so any gain >1 would clip it off. */
export function computeVectorscope(px: SettledPixels, size: number): VectorBins {
  const density = new Uint32Array(size * size);
  const { width: W, height: H, rgba } = px;
  if (W <= 0 || H <= 0) return { size, density };
  const c = size / 2;
  const R = size / 2 - 1;
  const GAIN = 1.0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!;
      const Y = luma(r, g, b);
      const U = (b - Y) / 255; // ~ -0.7..0.7
      const V = (r - Y) / 255;
      const sx = (c + U * R * GAIN) | 0;
      const sy = (c - V * R * GAIN) | 0;
      if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
      density[sy * size + sx]!++;
    }
  }
  return { size, density };
}
