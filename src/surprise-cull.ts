// src/surprise-cull.ts
//
// Objective degeneracy classifier for Surprise Wall thumbnails. Cheap, pure,
// variation-agnostic stats over the rendered RGBA bytes. Rejects ONLY the
// confident-degenerate tier (black / dot / blob / noise); "valid but dull" is
// deliberately NOT culled (the #289 boundary — that is the human's eye).
//
// Tunable thresholds live here as named constants; calibrate against real walls
// in the verify phase. Metrics:
//   meanLuma         — rec.709 luminance mean over all pixels
//   occupiedFraction — fraction of pixels brighter than OCCUPIED_LUMA
//   edgeEnergy       — mean abs luma difference to right+down neighbour, /255

export type CullReason = 'black' | 'dot' | 'blob' | 'noise' | 'flat';
export interface CullVerdict { ok: boolean; reason?: CullReason; stats: CullStats }
export interface CullStats {
  meanLuma: number;
  occupiedFraction: number;
  edgeEnergy: number;
  /** Luma standard deviation /255 — global contrast. A real flame puts bright
   *  structure on a dark background (high std); a dull uniform field is low. */
  contrast: number;
}

export const BLACK_MEAN_LUMA = 2.0;    // /255 mean below this → dead render
export const OCCUPIED_LUMA = 16;       // /255 a pixel counts as "lit" above this
export const DOT_MIN_OCCUPIED = 0.004; // < 0.4% lit → point collapse
export const BLOB_MIN_EDGE = 0.03;     // lit but edge energy below this → smooth lump
export const NOISE_MAX_EDGE = 0.22;    // edge energy above this w/ high coverage → fog
// "flat" = a dull uniform field that fills the frame at near-constant luminance
// (weierstrass_p / blaschke / bakers_map-style washes). A real flame puts bright
// structure on a dark background, so it either leaves empty space (lower occupancy)
// or has high contrast. Calibrated against a live wall: flat fields measured
// contrast ≤0.09 at occ≈1.0, while good dense flames sit ≥0.21 — a wide margin.
export const FLAT_MIN_OCCUPIED = 0.85; // frame is essentially filled (no real shape)
export const FLAT_MAX_CONTRAST = 0.13; // …and luma barely varies → dull wash

function luma(r: number, g: number, b: number): number { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

export function classifyThumbnail(rgba: Uint8ClampedArray, w: number, h: number): CullVerdict {
  let sumLuma = 0, sumSq = 0, occupied = 0;
  const lum = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const l = luma(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    lum[p] = l; sumLuma += l; sumSq += l * l;
    if (l > OCCUPIED_LUMA) occupied++;
  }
  const n = w * h;
  const meanLuma = sumLuma / n;
  const occupiedFraction = occupied / n;
  const contrast = Math.sqrt(Math.max(0, sumSq / n - meanLuma * meanLuma)) / 255;

  let edgeSum = 0, edgeCount = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (x + 1 < w) { edgeSum += Math.abs(lum[p]! - lum[p + 1]!); edgeCount++; }
    if (y + 1 < h) { edgeSum += Math.abs(lum[p]! - lum[p + w]!); edgeCount++; }
  }
  const edgeEnergy = edgeCount ? (edgeSum / edgeCount) / 255 : 0;
  const stats: CullStats = { meanLuma, occupiedFraction, edgeEnergy, contrast };

  // black vs dot — both are "essentially nothing lit", distinguished by whether
  // ANY pixel is lit at all (occupied count), NOT by mean luma. A single bright
  // pixel raises meanLuma a lot at 32² (~0.25) but ~0 at 160², so a flat
  // meanLuma gate would mislabel the same speck "black" at large thumbnail
  // sizes. Occupancy keeps the verdict resolution-independent.
  if (occupiedFraction < DOT_MIN_OCCUPIED) {
    return { ok: false, reason: occupied === 0 ? 'black' : 'dot', stats };
  }
  // Enough pixels are lit, but the frame as a whole is a dead/near-black wash.
  if (meanLuma < BLACK_MEAN_LUMA) return { ok: false, reason: 'black', stats };
  if (edgeEnergy > NOISE_MAX_EDGE && occupiedFraction > 0.6) return { ok: false, reason: 'noise', stats };
  if (occupiedFraction > FLAT_MIN_OCCUPIED && contrast < FLAT_MAX_CONTRAST) return { ok: false, reason: 'flat', stats };
  if (edgeEnergy < BLOB_MIN_EDGE) return { ok: false, reason: 'blob', stats };
  return { ok: true, stats };
}
