import { describe, expect, it } from 'vitest';
import { stripRowPadding, displayHalfToLinearExr, displayHalfToPng16 } from './gpu-readback';
import { srgbToLinear } from './srgb';

// IEEE-754 half-float bit patterns (the GPU rgba16float readback hands us these).
const H0 = 0x0000; //  0.0
const H1 = 0x3c00; //  1.0
const HHALF = 0x3800; //  0.5
const HNAN = 0x7e00; //  quiet NaN — exercises the #388 EXR guard

/** Build a tight Uint8Array view over an rgba16float pixel buffer. */
function rgba16Tight(halves: number[]): Uint8Array {
  const u16 = Uint16Array.from(halves);
  return new Uint8Array(u16.buffer, u16.byteOffset, u16.byteLength);
}

describe('stripRowPadding', () => {
  it('removes 256-aligned row padding (rgba8, 2×2)', () => {
    const w = 2, h = 2, bpp = 4;
    const unpadded = w * bpp; // 8
    const bytesPerRow = Math.ceil(unpadded / 256) * 256; // 256
    const padded = new Uint8Array(bytesPerRow * h);
    // row 0 pixels, then 248 pad bytes; row 1 pixels, then pad
    padded.set([1, 2, 3, 4, 5, 6, 7, 8], 0);
    padded.set([9, 10, 11, 12, 13, 14, 15, 16], bytesPerRow);
    const tight = stripRowPadding(padded, w, h, bpp);
    expect(Array.from(tight)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(tight.length).toBe(w * h * bpp);
  });

  it('is a no-op when the row is already 256-aligned', () => {
    const w = 64, h = 1, bpp = 4; // 64*4 = 256 exactly
    const padded = new Uint8Array(256);
    for (let i = 0; i < 256; i++) padded[i] = i & 0xff;
    const tight = stripRowPadding(padded, w, h, bpp);
    expect(tight.length).toBe(256);
    expect(Array.from(tight)).toEqual(Array.from(padded));
  });
});

describe('displayHalfToLinearExr', () => {
  it('applies srgbToLinear to RGB, passes alpha linear, on a 1×1 pixel', () => {
    const tight = rgba16Tight([H1, H0, HHALF, HHALF]); // r=1, g=0, b=0.5, a=0.5
    const out = displayHalfToLinearExr(tight, 1, 1);
    expect(out[0]).toBeCloseTo(srgbToLinear(1.0), 6);
    expect(out[1]).toBeCloseTo(srgbToLinear(0.0), 6);
    expect(out[2]).toBeCloseTo(srgbToLinear(0.5), 6);
    expect(out[3]).toBeCloseTo(0.5, 6); // alpha NOT sRGB-curved
  });

  it('#388 — coerces non-finite (NaN) to 0 instead of writing NaN', () => {
    const tight = rgba16Tight([HNAN, HNAN, HNAN, HNAN]);
    const out = displayHalfToLinearExr(tight, 1, 1);
    for (const v of out) expect(v).toBe(0);
  });
});

describe('displayHalfToPng16', () => {
  it('quantizes clamped half-floats to 16-bit samples', () => {
    const tight = rgba16Tight([H1, H0, HHALF, H1]);
    const out = displayHalfToPng16(tight, 1, 1);
    expect(out[0]).toBe(65535);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(Math.round(0.5 * 65535));
    expect(out[3]).toBe(65535);
  });

  it('NaN self-heals to 0 on Uint16 coercion', () => {
    const tight = rgba16Tight([HNAN, HNAN, HNAN, HNAN]);
    const out = displayHalfToPng16(tight, 1, 1);
    for (const v of out) expect(v).toBe(0);
  });
});
