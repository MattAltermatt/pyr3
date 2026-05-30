/**
 * Mean-absolute-difference metrics for the parity gate (R-metric).
 *
 * `meanAbsDiffRgba` sums |Δ| over **all four channels (R, G, B, AND alpha)**
 * and divides by the total byte count. The live parity thresholds in every
 * `meta.json` are calibrated against this exact definition, so it must not
 * change without re-baselining the whole corpus (PYR3-069). In practice alpha
 * is identical between golden and render for opaque flames, so it contributes
 * 0 to the numerator while still counting 1/4 of the denominator (i.e. the
 * value is the RGB sum scaled by 3/4 relative to a true RGB-only mean).
 * `perChannelDrift` below is the genuinely alpha-ignoring per-channel variant;
 * the accumulator variant compares raw f64 values.
 */

export function meanAbsDiffRgba(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) {
    throw new Error(`rgba size mismatch: ${a.length} vs ${b.length}`);
  }
  if (a.length % 4 !== 0) {
    throw new Error(`rgba size not a multiple of 4: ${a.length}`);
  }
  if (a.length === 0) return 0.0;
  let acc = 0.0;
  for (let i = 0; i < a.length; i++) {
    acc += Math.abs(a[i]! - b[i]!);
  }
  return acc / a.length;
}

export function meanAbsDiffAccumulator(a: Float64Array, b: Float64Array): number {
  if (a.length !== b.length) {
    throw new Error(`accumulator size mismatch: ${a.length} vs ${b.length}`);
  }
  if (a.length === 0) return 0.0;
  let acc = 0.0;
  for (let i = 0; i < a.length; i++) {
    acc += Math.abs(a[i]! - b[i]!);
  }
  return acc / a.length;
}

export interface PerChannel {
  r: number;
  g: number;
  b: number;
}

export function perChannelDrift(a: Uint8Array, b: Uint8Array): PerChannel {
  if (a.length !== b.length) {
    throw new Error(`perChannelDrift: a.size (${a.length}) != b.size (${b.length})`);
  }
  if (a.length % 4 !== 0) {
    throw new Error(`perChannelDrift: a.size (${a.length}) not a multiple of 4 (RGBA layout)`);
  }
  if (a.length === 0) return { r: 0.0, g: 0.0, b: 0.0 };
  const pixelCount = a.length / 4;
  let sR = 0;
  let sG = 0;
  let sB = 0;
  let i = 0;
  while (i < a.length) {
    sR += Math.abs(a[i]! - b[i]!);
    sG += Math.abs(a[i + 1]! - b[i + 1]!);
    sB += Math.abs(a[i + 2]! - b[i + 2]!);
    // alpha (i+3) ignored
    i += 4;
  }
  const n = pixelCount;
  return { r: sR / n, g: sG / n, b: sB / n };
}

export interface QuadrantMad {
  qTl: number;
  qTr: number;
  qBl: number;
  qBr: number;
}

export function perRegionDrift(a: Uint8Array, b: Uint8Array, w: number, h: number): QuadrantMad {
  if (a.length !== b.length) {
    throw new Error(`perRegionDrift: a.size (${a.length}) != b.size (${b.length})`);
  }
  if (a.length !== w * h * 4) {
    throw new Error(`perRegionDrift: a.size (${a.length}) != w*h*4 (${w * h * 4})`);
  }
  const xMid = Math.floor(w / 2);
  const yMid = Math.floor(h / 2);
  let sTl = 0; let nTl = 0;
  let sTr = 0; let nTr = 0;
  let sBl = 0; let nBl = 0;
  let sBr = 0; let nBr = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const d =
        Math.abs(a[idx]! - b[idx]!) +
        Math.abs(a[idx + 1]! - b[idx + 1]!) +
        Math.abs(a[idx + 2]! - b[idx + 2]!);
      if (x < xMid && y < yMid) {
        sTl += d; nTl += 1;
      } else if (x >= xMid && y < yMid) {
        sTr += d; nTr += 1;
      } else if (x < xMid && y >= yMid) {
        sBl += d; nBl += 1;
      } else {
        sBr += d; nBr += 1;
      }
    }
  }
  // Per-pixel MAD = (sum-of-channel-diffs) / 3 / count.
  const q = (s: number, n: number): number => (n === 0 ? 0.0 : (s / 3.0) / n);
  return { qTl: q(sTl, nTl), qTr: q(sTr, nTr), qBl: q(sBl, nBl), qBr: q(sBr, nBr) };
}
