import { describe, expect, it } from 'vitest';
import { unpackSettledRgba } from './edit-pixel-readback';

// Build a 256-row-aligned padded readback buffer for a width×height image, filling
// each pixel with the given [c0,c1,c2,c3] bytes and junk in the pad region.
function paddedBuf(width: number, height: number, px: (x: number, y: number) => number[]): Uint8Array {
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
  const buf = new Uint8Array(bytesPerRow * height).fill(0xee); // 0xee = pad sentinel
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = y * bytesPerRow + x * 4;
      const [a, b, c, d] = px(x, y);
      buf[s] = a!; buf[s + 1] = b!; buf[s + 2] = c!; buf[s + 3] = d!;
    }
  }
  return buf;
}

describe('unpackSettledRgba', () => {
  it('strips row padding into tight rgba (no swap)', () => {
    const w = 3, h = 2;
    const buf = paddedBuf(w, h, (x, y) => [x * 10 + y, 100 + x, 200 + y, 255]);
    const out = unpackSettledRgba(buf, w, h, false);
    expect(out.length).toBe(w * h * 4);
    // pixel (2,1): r=21, g=102, b=201, a=255 at tight offset (1*3+2)*4 = 20
    expect(Array.from(out.slice(20, 24))).toEqual([21, 102, 201, 255]);
    // no pad sentinel (0xee) leaked into the tight output
    expect(Array.from(out)).not.toContain(0xee);
  });

  it('swaps B/R when swapBR (bgra→rgba), alpha straight through', () => {
    const w = 1, h = 1;
    const buf = paddedBuf(w, h, () => [10, 20, 30, 40]); // stored as B=10,G=20,R=30,A=40
    const out = unpackSettledRgba(buf, w, h, true);
    expect(Array.from(out.slice(0, 4))).toEqual([30, 20, 10, 40]); // R,G,B,A
  });

  it('no-swap leaves channel order intact', () => {
    const buf = paddedBuf(1, 1, () => [10, 20, 30, 40]);
    const out = unpackSettledRgba(buf, 1, 1, false);
    expect(Array.from(out.slice(0, 4))).toEqual([10, 20, 30, 40]);
  });

  it('handles a width whose row is already 256-aligned', () => {
    const w = 64, h = 1; // 64*4 = 256
    const buf = paddedBuf(w, h, (x) => [x, x, x, 255]);
    const out = unpackSettledRgba(buf, w, h, false);
    expect(out.length).toBe(256);
    expect(Array.from(out.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(out.slice(252, 256))).toEqual([63, 63, 63, 255]);
  });
});
