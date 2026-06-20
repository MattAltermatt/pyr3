// pyr3 — procedural palette ramp generator (#267, #358). Pure + off-seam:
// params → ColorStop[]. Computed in OkLCh (perceptual) so sweeps don't pulse
// in brightness / drag through a muddy middle the way a naive HSL sweep would.
import { oklchToRgb } from './color-math';
import type { ColorStop, RampParams, RampMeta } from './palette';

// RampParams/RampMeta live in palette.ts (so Palette.gen can reference them
// without a circular import); re-export here so existing call sites keep
// importing them from this module.
export type { RampParams, RampMeta } from './palette';

/** Normalized chroma ceiling: slider `chroma` ∈ [0,1] maps to OkLCh C ∈ [0, C_MAX].
 *  ~0.37 is near the max chroma achievable inside the sRGB gamut. */
export const C_MAX = 0.37;

/** The default generated ramp (a vivid rainbow). Used when the user first picks
 *  "Generate ramp" from the palette picker and as the generator's reset point. */
export function defaultRampMeta(): RampMeta {
  const seed = 0;
  return {
    mode: 'rainbow', hue: seedToHue(seed), chroma: 0.6, lightness: 0.65,
    lightFrom: 0.15, lightTo: 0.85, loops: 1, direction: 1, stops: 16, seed,
  };
}

export function generateRamp(p: RampParams): ColorStop[] {
  const n = Math.max(2, Math.round(p.stops));
  const C = Math.max(0, p.chroma) * C_MAX;
  const out: ColorStop[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let h: number, L: number;
    if (p.mode === 'shades') {
      h = p.hue;
      L = p.lightFrom + (p.lightTo - p.lightFrom) * t;
    } else {
      h = p.hue + p.direction * p.loops * 360 * t;
      L = p.lightness;
    }
    const { r, g, b } = oklchToRgb(L, C, h);
    out.push({ t, r, g, b });
  }
  return out;
}

/** Reproducible start hue from an integer seed (mulberry32 → [0,360)). The
 *  generator stays pure/deterministic; the UI's 🎲 picks a fresh seed. */
export function seedToHue(seed: number): number {
  let s = (seed >>> 0) + 0x6d2b79f5;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return u * 360;
}
