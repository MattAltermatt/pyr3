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
