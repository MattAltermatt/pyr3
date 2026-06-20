// #269 Phase 2 — pure point-to-paint map logic. DOM-free (passes
// typecheck:engine). The renderer reads back super-res idx_sum + count; these
// helpers turn that into a per-pixel average-index map and answer the three
// interaction queries (brush histogram, region mask, stop insertion).
import { bakeLUT, type ColorStop, type PaletteMode } from './palette';

export interface IndexMap {
  /** Hit-weighted average color index ∈ [0,1] per output pixel, row-major.
   *  NaN where mask=0 (no hits). */
  avg: Float32Array;
  /** 1 = pixel had hits, 0 = empty. */
  mask: Uint8Array;
  width: number;
  height: number;
}

/** Choose downsample out-dims for an index map. `downsampleIndexMap` applies one
 *  integer `oversample` (= superW/outW) to BOTH axes, so the out-dims must divide
 *  the super-res dims by the SAME factor — otherwise blocks read out of bounds
 *  (→ mask=0, missing coverage) and the aspect is distorted. Derive an integer
 *  oversample from the long edge, then floor both axes by it: in-bounds AND
 *  aspect-true. (#372) */
export function paintMapDims(
  superW: number, superH: number, longEdge: number,
): { outW: number; outH: number } {
  const oversample = Math.max(1, Math.round(Math.max(superW, superH) / longEdge));
  return {
    outW: Math.max(1, Math.floor(superW / oversample)),
    outH: Math.max(1, Math.floor(superH / oversample)),
  };
}

/** Downsample super-res idx_sum + count (row-major, superW×superH) to output
 *  dims by summing both over each oversample block. avg = Σidx / Σcount (both
 *  carry the opacity*255 weight, so the ratio is the weighted-average color
 *  coord in [0,1]); mask = Σcount > 0. oversample = superW/outW (integer). */
export function downsampleIndexMap(
  idxSum: Uint32Array, count: Uint32Array,
  superW: number, _superH: number, outW: number, outH: number,
): IndexMap {
  // oversample is square (superW/outW === superH/outH); derive from width.
  const oversample = Math.max(1, Math.round(superW / outW));
  const avg = new Float32Array(outW * outH);
  const mask = new Uint8Array(outW * outH);
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      let sIdx = 0;
      let sCount = 0;
      for (let dy = 0; dy < oversample; dy++) {
        for (let dx = 0; dx < oversample; dx++) {
          const si = (oy * oversample + dy) * superW + (ox * oversample + dx);
          sIdx += idxSum[si]!;
          sCount += count[si]!;
        }
      }
      const o = oy * outW + ox;
      if (sCount > 0) { avg[o] = sIdx / sCount; mask[o] = 1; }
      else { avg[o] = NaN; mask[o] = 0; }
    }
  }
  return { avg, mask, width: outW, height: outH };
}

/** Weighted histogram (length `bins`) of avg-indices over a circular brush
 *  centered at output pixel (cx,cy), radius r. Covered pixels each add 1 to
 *  bin floor(avg*bins). Normalized so max bin = 1; all-zero if none covered. */
export function brushHistogram(
  map: IndexMap, cx: number, cy: number, radius: number, bins: number,
): Float32Array {
  const out = new Float32Array(bins);
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(map.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(map.height - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const o = y * map.width + x;
      if (!map.mask[o]) continue;
      let b = Math.floor(map.avg[o]! * bins);
      if (b >= bins) b = bins - 1;
      if (b < 0) b = 0;
      out[b]! += 1;
    }
  }
  let max = 0;
  for (let i = 0; i < bins; i++) if (out[i]! > max) max = out[i]!;
  if (max > 0) for (let i = 0; i < bins; i++) out[i]! /= max;
  return out;
}

/** Uint8 mask over output pixels whose avg-index is within `epsilon` of
 *  `stopIndex` ∈ [0,1]. Empty pixels never match. */
export function regionMask(map: IndexMap, stopIndex: number, epsilon: number): Uint8Array {
  const out = new Uint8Array(map.width * map.height);
  for (let i = 0; i < out.length; i++) {
    if (map.mask[i] && Math.abs(map.avg[i]! - stopIndex) <= epsilon) out[i] = 1;
  }
  return out;
}

export interface StopInsertResult { stops: ColorStop[]; selectedExisting: boolean; }

/** Insert a stop at t=index with `rgb`, unless an existing stop sits within
 *  `dedup` of index (then return stops unchanged + selectedExisting=true). */
export function insertStopAtIndex(
  stops: ColorStop[], index: number, rgb: { r: number; g: number; b: number }, dedup: number,
): StopInsertResult {
  if (stops.some((s) => Math.abs(s.t - index) <= dedup)) return { stops, selectedExisting: true };
  const next = [...stops, { t: index, r: rgb.r, g: rgb.g, b: rgb.b }].sort((a, b) => a.t - b.t);
  return { stops: next, selectedExisting: false };
}

/** Map a pointer's client coords to a backing pixel (ox,oy) on a canvas
 *  displayed at CSS `rect` size but backed by (width,height). Null if outside. */
export function clientToPixel(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number, clientY: number, width: number, height: number,
): { ox: number; oy: number } | null {
  const fx = (clientX - rect.left) / rect.width;
  const fy = (clientY - rect.top) / rect.height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  return {
    ox: Math.min(width - 1, Math.floor(fx * width)),
    oy: Math.min(height - 1, Math.floor(fy * height)),
  };
}

/** Sample the baked palette LUT at t ∈ [0,1] → the color currently at that
 *  gradient index (the double-click add-stop default color). */
export function colorAtIndex(
  stops: ColorStop[], hue: number, mode: PaletteMode, t: number,
): { r: number; g: number; b: number } {
  const lut = bakeLUT(stops, hue, mode);
  const idx = Math.round(Math.max(0, Math.min(1, t)) * 255);
  return { r: lut[idx * 4]!, g: lut[idx * 4 + 1]!, b: lut[idx * 4 + 2]! };
}
