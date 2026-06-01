// Pure per-sheep statistics for the feature-index bake CLI.
//
// Four formulas — histogram coverage, mean luminance, density entropy,
// color variance — plus a quantizing wrapper. ZERO environment branching,
// no GPU, no I/O, no DOM. Inputs are the raw Float32 density grid and the
// RGBA8 pixel buffer the Draft render leaves behind; outputs are 0..1
// floats (or q8 bytes from the wrapper). All four are defensive against
// empty inputs and non-finite values so a corrupt render never poisons a
// feature record with NaN.

import { quantizeQ8 } from '../src/feature-index';

/** Fraction of histogram cells with non-zero density. 0..1. */
export function histogramCoverage(density: Float32Array): number {
  const n = density.length;
  if (n === 0) return 0;
  let nonZero = 0;
  for (let i = 0; i < n; i++) {
    const v = density[i]!;
    if (Number.isFinite(v) && v > 0) nonZero++;
  }
  return nonZero / n;
}

/** Mean luminance — average of (R+G+B)/3 across RGBA pixels, normalized
 *  to 0..1 via /255. Alpha channel ignored. */
export function meanLuminance(rgba: Uint8Array): number {
  const pixelCount = rgba.length >>> 2;
  if (pixelCount === 0) return 0;
  let sum = 0;
  for (let p = 0; p < pixelCount; p++) {
    const base = p << 2;
    sum += rgba[base]! + rgba[base + 1]! + rgba[base + 2]!;
  }
  // sum is over (R+G+B); divide by 3 channels * 255 max * pixelCount.
  const mean = sum / (3 * 255 * pixelCount);
  if (!Number.isFinite(mean)) return 0;
  return mean < 0 ? 0 : mean > 1 ? 1 : mean;
}

/** Shannon entropy of the normalized density histogram (zero cells skipped),
 *  scaled by 1/log2(nonZeroCellCount) so the result lands in 0..1. Returns
 *  0 for an empty or single-spike histogram. */
export function densityEntropy(density: Float32Array): number {
  const n = density.length;
  if (n === 0) return 0;
  let total = 0;
  let nonZero = 0;
  for (let i = 0; i < n; i++) {
    const v = density[i]!;
    if (Number.isFinite(v) && v > 0) {
      total += v;
      nonZero++;
    }
  }
  if (nonZero < 2 || total <= 0) return 0;
  let h = 0;
  for (let i = 0; i < n; i++) {
    const v = density[i]!;
    if (Number.isFinite(v) && v > 0) {
      const p = v / total;
      h -= p * Math.log2(p);
    }
  }
  const norm = h / Math.log2(nonZero);
  if (!Number.isFinite(norm)) return 0;
  return norm < 0 ? 0 : norm > 1 ? 1 : norm;
}

/** Stddev of (R,G,B) treated as a 3D point cloud across the canvas,
 *  divided by sqrt(3) * 127.5 to clamp the maximum possible stddev to 1.
 *  Alpha channel ignored. */
export function colorVariance(rgba: Uint8Array): number {
  const pixelCount = rgba.length >>> 2;
  if (pixelCount === 0) return 0;
  let sumR = 0, sumG = 0, sumB = 0;
  for (let p = 0; p < pixelCount; p++) {
    const base = p << 2;
    sumR += rgba[base]!;
    sumG += rgba[base + 1]!;
    sumB += rgba[base + 2]!;
  }
  const meanR = sumR / pixelCount;
  const meanG = sumG / pixelCount;
  const meanB = sumB / pixelCount;
  let ssR = 0, ssG = 0, ssB = 0;
  for (let p = 0; p < pixelCount; p++) {
    const base = p << 2;
    const dR = rgba[base]! - meanR;
    const dG = rgba[base + 1]! - meanG;
    const dB = rgba[base + 2]! - meanB;
    ssR += dR * dR;
    ssG += dG * dG;
    ssB += dB * dB;
  }
  const totalVar = (ssR + ssG + ssB) / pixelCount;
  const stddev = Math.sqrt(totalVar);
  // Max possible stddev for 3 channels of 0..255 values is sqrt(3) * 127.5.
  const norm = stddev / (Math.sqrt(3) * 127.5);
  if (!Number.isFinite(norm)) return 0;
  return norm < 0 ? 0 : norm > 1 ? 1 : norm;
}

/** The 4 q8 bytes the bake writes into a feature record for one sheep. */
export interface QuantizedStats {
  coverage: number;
  meanLum: number;
  entropy: number;
  colorVar: number;
}

/** Convenience: compute all four stats + quantize. The bake CLI calls this
 *  once per sheep after the Draft render completes. */
export function computeQuantizedStats(
  density: Float32Array,
  rgba: Uint8Array,
): QuantizedStats {
  return {
    coverage: quantizeQ8(histogramCoverage(density)),
    meanLum: quantizeQ8(meanLuminance(rgba)),
    entropy: quantizeQ8(densityEntropy(density)),
    colorVar: quantizeQ8(colorVariance(rgba)),
  };
}
