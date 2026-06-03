/**
 * Visibility-scaled abs-diff PNG helper for the parity harness.
 * Per channel: |a - b| * scale, clamped to [0, 255]. Alpha always 255.
 */

import { PNG } from 'pngjs';

export function renderDiffPng(
  a: Uint8Array,
  b: Uint8Array,
  width: number,
  height: number,
  scale: number = 8,
): Buffer {
  const expected = width * height * 4;
  if (a.length !== expected || b.length !== expected || a.length !== b.length) {
    throw new Error('diff-image: array size mismatch');
  }
  const out = Buffer.alloc(expected);
  for (let i = 0; i < expected; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i + c]! - b[i + c]!) * scale;
      out[i + c] = d > 255 ? 255 : d;
    }
    out[i + 3] = 255;
  }
  const png = new PNG({ width, height });
  png.data = out;
  return PNG.sync.write(png);
}

/** Nearest-neighbor RGBA downscale. Used to bring a higher-res golden onto
 *  the quick-mode FE capture dims for R-compare; not visually pretty but
 *  pixel-faithful enough to be a fair denominator. */
export function nearestDownscale(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(srcH - 1, Math.floor(y * yRatio));
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(srcW - 1, Math.floor(x * xRatio));
      const srcOff = (srcY * srcW + srcX) * 4;
      const dstOff = (y * dstW + x) * 4;
      dst[dstOff] = src[srcOff]!;
      dst[dstOff + 1] = src[srcOff + 1]!;
      dst[dstOff + 2] = src[srcOff + 2]!;
      dst[dstOff + 3] = src[srcOff + 3]!;
    }
  }
  return dst;
}
