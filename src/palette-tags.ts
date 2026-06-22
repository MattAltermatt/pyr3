// pyr3 — palette dominant-color tagging (Phase 9 visual overhaul).
//
// computeTags(rgb) reads a 256-color palette LUT (raw bytes — RGB triples)
// and returns the unique dominant-color tags present. The palette picker's
// color-filter chips (Task 9.5) read these tags to filter the cell grid.
//
// Algorithm — simple, deterministic, no I/O:
//   1. Sample N evenly-spaced colors across the LUT (N = SAMPLE_COUNT).
//   2. Convert each to HSL.
//   3. Classify into one of the 11 chip categories via H/S/L thresholds.
//   4. Return unique tags in COLOR_TAGS canonical order.
//
// Tuning knobs are flagged with `TUNING-FLAG` — adjustable during Chrome
// verify. The current defaults are calibrated against the synthetic-color
// unit tests in palette-tags.test.ts (pure red/orange/yellow/green/blue/
// purple/pink/brown/pastel/dark/gray inputs).

import { FLAM3_PALETTE_COUNT, getLibraryStops } from './flam3-palettes';

export const COLOR_TAGS = [
  'red', 'orange', 'yellow', 'green', 'blue', 'purple',
  'pink', 'brown', 'pastel', 'dark', 'gray',
] as const;

export type ColorTag = typeof COLOR_TAGS[number];

// ── Tuning knobs ──────────────────────────────────────────────────────────
// TUNING-FLAG: number of evenly-spaced samples across the 256-color LUT.
// 16 = every-16th index; balances representativeness vs cost.
const SAMPLE_COUNT = 16;

// TUNING-FLAG: lightness thresholds in [0, 1] HSL space.
//   ≤ DARK_L     → tagged 'dark' (also strips chromatic tags below this)
//   ≥ PASTEL_L
//     AND ≤ PASTEL_S
//                → tagged 'pastel'
const DARK_L   = 0.15;
// PASTEL_L raised from 0.75 → 0.80 so pastel covers strictly-higher-L tints
// than pink (PINK_L_MIN = 0.75). The two bands used to overlap exactly at
// 0.75; with the pink check now running first this is belt+braces against
// future ordering drift.
const PASTEL_L = 0.80;
const PASTEL_S = 0.40;

// TUNING-FLAG: gray threshold. Saturation ≤ GRAY_S in [0, 1] → 'gray'
// (when not already classified as 'dark' / 'pastel').
const GRAY_S = 0.12;

// TUNING-FLAG: pink = high lightness + warm hue (320..360 OR 0..30). High
// saturation is allowed because high-L pinks like rgb(255,180,200) come back
// with s=1.0 under the standard HSL formula. The distinguishing axis is L.
const PINK_L_MIN = 0.75;
const PINK_S_MAX = 1.01;

// TUNING-FLAG: brown = darker (L 0.1..0.45), warm hue (0..50), mid sat.
const BROWN_L_MIN = 0.10;
const BROWN_L_MAX = 0.45;
const BROWN_S_MIN = 0.20;

// Hue bands (degrees). Inclusive lower, exclusive upper unless noted.
const HUE_BANDS: ReadonlyArray<{ tag: ColorTag; lo: number; hi: number }> = [
  // red wraps at 360 → use both [330, 360) and [0, 15)
  { tag: 'red',    lo: 0,   hi: 15 },
  { tag: 'orange', lo: 15,  hi: 45 },
  { tag: 'yellow', lo: 45,  hi: 70 },
  { tag: 'green',  lo: 70,  hi: 170 },
  { tag: 'blue',   lo: 170, hi: 260 },
  { tag: 'purple', lo: 260, hi: 320 },
  { tag: 'red',    lo: 320, hi: 360 },
];

// ── HSL conversion (sRGB-relative; standard formula) ──────────────────────
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rN: h = ((gN - bN) / d + (gN < bN ? 6 : 0)) * 60; break;
      case gN: h = ((bN - rN) / d + 2) * 60; break;
      default: h = ((rN - gN) / d + 4) * 60; break;
    }
  }
  return { h, s, l };
}

// Classify a single color into a single ColorTag (chained priority).
function classify(r: number, g: number, b: number): ColorTag {
  const { h, s, l } = rgbToHsl(r, g, b);

  // Dark precedes hue classification — near-black is read as 'dark' regardless
  // of the (often noisy) hue at low lightness.
  if (l <= DARK_L) return 'dark';

  // Pink runs BEFORE pastel so that warm-hue light tints (e.g. blush
  // rgb(240,200,210)) get tagged 'pink' instead of being swallowed by the
  // pastel check. The two used to share a 0.75 lightness floor; pink wins on
  // hue and pastel now sits at L ≥ 0.80 (PASTEL_L raised above).
  if ((h >= 320 || h < 30) && l >= PINK_L_MIN && s <= PINK_S_MAX) {
    return 'pink';
  }

  // Pastel: high-lightness low-saturation chromatic tints.
  if (l >= PASTEL_L && s <= PASTEL_S) return 'pastel';

  // Gray: low saturation across the mid-lightness band.
  if (s <= GRAY_S) return 'gray';

  // Brown: warm hue (0..50°), darker band, mid saturation.
  if (h >= 0 && h < 50 && l >= BROWN_L_MIN && l <= BROWN_L_MAX && s >= BROWN_S_MIN) {
    return 'brown';
  }

  // Hue bands.
  for (const band of HUE_BANDS) {
    if (h >= band.lo && h < band.hi) return band.tag;
  }
  // h might be exactly 360 due to float — wrap to red.
  return 'red';
}

/** Mean H/S/L across the same SAMPLE_COUNT positions computeTags samples.
 *  Used by the palette picker's sort dropdown (hue / saturation / lightness
 *  modes). Hue is averaged via the unit-circle mean (sin/cos sums) so the
 *  wrap-around at 360°→0° doesn't dominate; saturation and lightness are
 *  arithmetic means.
 *
 *  Achromatic samples (s == 0) contribute their lightness/saturation but
 *  not their (undefined) hue; if every sample is achromatic, hue defaults
 *  to 0. */
export function computeMeanHsl(
  rgb: Uint8Array | Uint8ClampedArray,
): { h: number; s: number; l: number } {
  const n = Math.min(256, Math.floor(rgb.length / 3));
  if (n === 0) return { h: 0, s: 0, l: 0 };
  let sumSin = 0;
  let sumCos = 0;
  let sumS = 0;
  let sumL = 0;
  let hueCount = 0;
  for (let k = 0; k < SAMPLE_COUNT; k++) {
    let i = Math.min(n - 1, Math.floor((k * n) / SAMPLE_COUNT));
    if (k % 2 === 1 && i + 1 < n) i += 1;
    const r = rgb[i * 3]!;
    const g = rgb[i * 3 + 1]!;
    const b = rgb[i * 3 + 2]!;
    const hsl = rgbToHsl(r, g, b);
    sumS += hsl.s;
    sumL += hsl.l;
    if (hsl.s > 0) {
      const rad = (hsl.h * Math.PI) / 180;
      sumSin += Math.sin(rad);
      sumCos += Math.cos(rad);
      hueCount++;
    }
  }
  let h = 0;
  if (hueCount > 0) {
    h = (Math.atan2(sumSin / hueCount, sumCos / hueCount) * 180) / Math.PI;
    if (h < 0) h += 360;
  }
  return { h, s: sumS / SAMPLE_COUNT, l: sumL / SAMPLE_COUNT };
}

/** Compute the unique dominant-color tags present in a 256-entry palette
 *  expressed as raw RGB byte triples (length = 768). The sample count is
 *  SAMPLE_COUNT; tags are returned in COLOR_TAGS canonical order so callers
 *  can compare arrays by equality. */
export function computeTags(rgb: Uint8Array | Uint8ClampedArray): ColorTag[] {
  const present = new Set<ColorTag>();
  const n = Math.min(256, Math.floor(rgb.length / 3));
  if (n === 0) return [];
  // Sample SAMPLE_COUNT positions evenly across the LUT, alternating parity
  // on each step so both even-indexed and odd-indexed entries are hit. A
  // pure `floor(n / SAMPLE_COUNT)` stride misses one parity on power-of-two
  // sizes, which breaks alternating-color palettes (caught by the red/blue
  // multi-tag test).
  for (let k = 0; k < SAMPLE_COUNT; k++) {
    let i = Math.min(n - 1, Math.floor((k * n) / SAMPLE_COUNT));
    if (k % 2 === 1 && i + 1 < n) i += 1; // hit odd parity on alternating samples
    const r = rgb[i * 3]!;
    const g = rgb[i * 3 + 1]!;
    const b = rgb[i * 3 + 2]!;
    present.add(classify(r, g, b));
  }
  return COLOR_TAGS.filter((t) => present.has(t));
}

// ── Cached lookup for flam3 catalog palettes ──────────────────────────────
//
// The picker calls getFlam3PaletteTags(idx) once per cell at mount; the cache
// pays the LUT-decode cost only on first hit per index. All 701 entries
// are pre-computed lazily so search filtering stays O(N) across chip combos.

const _flam3TagsCache = new Map<number, readonly ColorTag[]>();
const _flam3HslCache = new Map<number, { h: number; s: number; l: number }>();

function buildFlam3Rgb(idx: number): Uint8Array | null {
  if (idx < 0 || idx >= FLAM3_PALETTE_COUNT || !Number.isInteger(idx)) {
    return null;
  }
  const stops = getLibraryStops(idx);
  if (!stops || stops.length === 0) return null;
  const rgb = new Uint8Array(256 * 3);
  for (const s of stops) {
    const i = Math.round(s.t * 255);
    if (i < 0 || i > 255) continue;
    rgb[i * 3] = Math.round(s.r * 255);
    rgb[i * 3 + 1] = Math.round(s.g * 255);
    rgb[i * 3 + 2] = Math.round(s.b * 255);
  }
  return rgb;
}

/** Cached mean H/S/L for a flam3 catalog palette. Returns `{h:0, s:0, l:0}`
 *  for indices with no stops; the sort dropdown treats those as low values
 *  consistently. */
export function getFlam3PaletteHsl(idx: number): { h: number; s: number; l: number } {
  const cached = _flam3HslCache.get(idx);
  if (cached) return cached;
  const rgb = buildFlam3Rgb(idx);
  const hsl = rgb ? computeMeanHsl(rgb) : { h: 0, s: 0, l: 0 };
  _flam3HslCache.set(idx, hsl);
  return hsl;
}

export function getFlam3PaletteTags(idx: number): readonly ColorTag[] {
  if (idx < 0 || idx >= FLAM3_PALETTE_COUNT || !Number.isInteger(idx)) {
    return [];
  }
  const cached = _flam3TagsCache.get(idx);
  if (cached) return cached;
  const rgb = buildFlam3Rgb(idx);
  if (!rgb) {
    const empty: ColorTag[] = [];
    _flam3TagsCache.set(idx, empty);
    return empty;
  }
  const tags = computeTags(rgb);
  _flam3TagsCache.set(idx, tags);
  return tags;
}
