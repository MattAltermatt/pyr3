// Palettes — gradient-stop is the source of truth. The 256-entry LUT used by
// the GPU is baked on demand via `bakeLUT(stops)` at upload time. Phase 4b
// substrate: this shape JSON-serializes losslessly and lives on `Genome`.

import { rgbToHsv, hsvToRgb } from './color-math';

export const PALETTE_SIZE = 256;
export const PALETTE_BYTES = PALETTE_SIZE * 16; // 256 × vec4f

export type PaletteMode = 'linear' | 'step' | 'smooth';

export interface ColorStop {
  t: number; // [0, 1]
  r: number; // [0, 1]
  g: number;
  b: number;
}

/** Parameters for the procedural ramp generator (#267/#358). Pure data — the
 *  generator in `palette-generate.ts` turns these into stops. */
export interface RampParams {
  mode: 'rainbow' | 'shades';
  hue: number;        // start hue, degrees
  chroma: number;     // 0..1 (normalized → OkLCh C)
  lightness: number;  // 0..1 (rainbow mode)
  lightFrom: number;  // 0..1 (shades mode, dark end)
  lightTo: number;    // 0..1 (shades mode, light end)
  loops: number;      // >= 1 (rainbow): hue travels loops × 360°
  direction: 1 | -1;  // +1 = cw, -1 = ccw (rainbow)
  stops: number;      // stop count
}

/** Generator provenance: how a generated palette was produced (params + the UI
 *  seed). Stored on the palette so it rides through the in-session undo history
 *  (structuredClone), letting the generator controls re-sync after undo/redo.
 *  Editor-only — `serialize.ts` whitelists palette fields, so `gen` is NOT
 *  written to saved files / animation / parity. (#358) */
export interface RampMeta extends RampParams {
  seed: number;
}

export interface Palette {
  name: string;
  stops: ColorStop[];
  hue?: number;        // degrees in [0, 360); default 0 — HSV-rotate stops at bake time
  mode?: PaletteMode;  // default 'linear'
  gen?: RampMeta;      // generator provenance (editor-only, not serialized) — #358
}

// Cardinal Catmull-Rom (tension B=0.5) for one channel across 4 control values.
// Mirror of channel-curves.ts:evalSpline — kept local so palette.ts has no
// cross-module dependency on the curves editor. (#115 smooth interpolation.)
function catmullRom(u: number, xa: number, xb: number, xc: number, xd: number): number {
  const B = 0.5;
  let c = u * u * u * (-B * xa + (2 - B) * xb + (B - 2) * xc + B * xd);
  c += u * u * (2 * B * xa + (B - 3) * xb + (3 - 2 * B) * xc - B * xd);
  c += u * (-B * xa + B * xc);
  return c + xb;
}

/** Bake a 256-entry RGBA LUT (Float32Array, length 1024) from gradient stops.
 *  Pure function; allocates a fresh array.
 *
 *  @param stops Source gradient stops (any order; sorted internally by `t`).
 *  @param hue Optional HSV hue rotation in degrees, applied to each stop
 *             before interpolation. Default 0 (no rotation).
 *  @param mode Optional interpolation mode. 'linear' = piecewise-linear (default).
 *              'step' = piecewise-constant (use lower stop's color verbatim).
 *              'smooth' = Catmull-Rom through the stops (≥3 stops; clamps to [0,1];
 *              falls back to linear for <3 stops). */
export function bakeLUT(
  stops: ColorStop[],
  hue: number = 0,
  mode: PaletteMode = 'linear',
): Float32Array {
  const adjusted: ColorStop[] = hue === 0
    ? stops
    : stops.map((s) => {
        const rgb = rotateHueRGB(s.r, s.g, s.b, hue);
        return { t: s.t, r: rgb.r, g: rgb.g, b: rgb.b };
      });

  const sorted = [...adjusted].sort((a, b) => a.t - b.t);
  const data = new Float32Array(PALETTE_SIZE * 4);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const t = i / (PALETTE_SIZE - 1);
    let loIdx = 0;
    let hiIdx = sorted.length - 1;
    for (let s = 0; s < sorted.length - 1; s++) {
      if (t >= sorted[s]!.t && t <= sorted[s + 1]!.t) {
        loIdx = s;
        hiIdx = s + 1;
        break;
      }
    }
    const lo = sorted[loIdx]!;
    const hi = sorted[hiIdx]!;
    if (mode === 'step') {
      data[i * 4 + 0] = lo.r;
      data[i * 4 + 1] = lo.g;
      data[i * 4 + 2] = lo.b;
    } else {
      const span = hi.t - lo.t || 1;
      // Clamp to [0,1]: out-of-range coords (no enclosing segment, so lo/hi
      // keep the full-palette endpoints) take the nearest endpoint color
      // instead of extrapolating to negative / >1 RGB. (#240)
      const u = Math.max(0, Math.min(1, (t - lo.t) / span));
      if (mode === 'smooth' && sorted.length >= 3) {
        // Catmull-Rom through the stops, with phantom-duplicated endpoints
        // (mirror of channel-curves.ts:evalCurve). Clamp overshoot to [0,1].
        const a = sorted[Math.max(0, loIdx - 1)]!;
        const d = sorted[Math.min(sorted.length - 1, hiIdx + 1)]!;
        data[i * 4 + 0] = Math.max(0, Math.min(1, catmullRom(u, a.r, lo.r, hi.r, d.r)));
        data[i * 4 + 1] = Math.max(0, Math.min(1, catmullRom(u, a.g, lo.g, hi.g, d.g)));
        data[i * 4 + 2] = Math.max(0, Math.min(1, catmullRom(u, a.b, lo.b, hi.b, d.b)));
      } else {
        data[i * 4 + 0] = lo.r + (hi.r - lo.r) * u;
        data[i * 4 + 1] = lo.g + (hi.g - lo.g) * u;
        data[i * 4 + 2] = lo.b + (hi.b - lo.b) * u;
      }
    }
    data[i * 4 + 3] = 0;
  }
  return data;
}

/** HSV hue rotation for a single sRGB triplet, all channels in [0,1].
 *  Pure: same input → same output, no shared state. Grey inputs (saturation 0)
 *  pass through unchanged because hue is mathematically undefined for them. */
export function rotateHueRGB(
  r: number,
  g: number,
  b: number,
  deg: number,
): { r: number; g: number; b: number } {
  // #333 — reuse the shared sRGB↔HSV conversions (color-math.ts) rather than
  // reimplementing them. Byte-identical: hsvToRgb normalizes h mod 360 itself,
  // and grey inputs (s=0) pass through since hue is undefined for them.
  const { h, s, v } = rgbToHsv(r, g, b);
  return hsvToRgb(h + deg, s, v);
}

/** Construct a Palette from gradient stops. The stops are kept verbatim as
 *  the source of truth; the LUT is baked on demand at GPU upload. */
export function paletteFromStops(name: string, stops: ColorStop[]): Palette {
  return { name, stops };
}

/** The default v0.1 palette — a "pyre" warm gradient from deep red to warm white. */
export const PYRE_PALETTE: Palette = paletteFromStops('pyre', [
  { t: 0.0, r: 0.18, g: 0.0, b: 0.02 },
  { t: 0.18, r: 0.55, g: 0.04, b: 0.02 },
  { t: 0.4, r: 0.9, g: 0.18, b: 0.02 },
  { t: 0.6, r: 1.0, g: 0.5, b: 0.06 },
  { t: 0.8, r: 1.0, g: 0.85, b: 0.18 },
  { t: 1.0, r: 1.0, g: 0.98, b: 0.7 },
]);

/** DEEPSEA — cool ocean blues, hand-tuned for cold-fire flames. */
export const DEEPSEA: Palette = paletteFromStops('deepsea', [
  { t: 0.0, r: 0.01, g: 0.02, b: 0.08 },
  { t: 0.2, r: 0.02, g: 0.08, b: 0.22 },
  { t: 0.45, r: 0.04, g: 0.28, b: 0.45 },
  { t: 0.65, r: 0.08, g: 0.55, b: 0.65 },
  { t: 0.85, r: 0.5, g: 0.85, b: 0.92 },
  { t: 1.0, r: 0.9, g: 0.98, b: 1.0 },
]);

/** BONE — warm-grey monochrome ramp. */
export const BONE: Palette = paletteFromStops('bone', [
  { t: 0.0, r: 0.01, g: 0.01, b: 0.02 },
  { t: 0.25, r: 0.12, g: 0.11, b: 0.13 },
  { t: 0.55, r: 0.45, g: 0.43, b: 0.42 },
  { t: 0.8, r: 0.82, g: 0.79, b: 0.74 },
  { t: 1.0, r: 0.99, g: 0.97, b: 0.92 },
]);

// VIRIDIS / MAGMA stops sampled uniformly from matplotlib's canonical 256-entry
// `_cm_listed.py` (BSD-3-Clause). 9 stops at t = 0, 1/8, 2/8, …, 1; the 256-LUT
// bake interpolates between them, producing a smooth perceptual ramp.

/** VIRIDIS — perceptually-uniform purple → teal → yellow. matplotlib BSD-3. */
export const VIRIDIS: Palette = paletteFromStops('viridis', [
  { t: 0.0, r: 0.267, g: 0.005, b: 0.329 },
  { t: 0.125, r: 0.279, g: 0.175, b: 0.483 },
  { t: 0.25, r: 0.23, g: 0.322, b: 0.546 },
  { t: 0.375, r: 0.173, g: 0.449, b: 0.558 },
  { t: 0.5, r: 0.128, g: 0.567, b: 0.551 },
  { t: 0.625, r: 0.154, g: 0.68, b: 0.504 },
  { t: 0.75, r: 0.361, g: 0.786, b: 0.388 },
  { t: 0.875, r: 0.668, g: 0.862, b: 0.196 },
  { t: 1.0, r: 0.993, g: 0.906, b: 0.144 },
]);

/** MAGMA — perceptually-uniform black → purple → pink → cream. matplotlib BSD-3. */
export const MAGMA: Palette = paletteFromStops('magma', [
  { t: 0.0, r: 0.001, g: 0.0, b: 0.014 },
  { t: 0.125, r: 0.113, g: 0.065, b: 0.277 },
  { t: 0.25, r: 0.317, g: 0.072, b: 0.485 },
  { t: 0.375, r: 0.513, g: 0.148, b: 0.508 },
  { t: 0.5, r: 0.716, g: 0.215, b: 0.475 },
  { t: 0.625, r: 0.9, g: 0.315, b: 0.391 },
  { t: 0.75, r: 0.986, g: 0.528, b: 0.379 },
  { t: 0.875, r: 0.997, g: 0.762, b: 0.529 },
  { t: 1.0, r: 0.987, g: 0.991, b: 0.75 },
]);

/** Pack a Palette into the GPU upload form (256-entry × vec4f, 4 KB). Bakes
 *  the LUT from stops on every call (with optional hue rotation + step mode);
 *  cheap (1024 mults), runs only on swap. */
export function packPalette(p: Palette): ArrayBuffer {
  const ab = new ArrayBuffer(PALETTE_BYTES);
  new Float32Array(ab).set(bakeLUT(p.stops, p.hue ?? 0, p.mode ?? 'linear'));
  return ab;
}

