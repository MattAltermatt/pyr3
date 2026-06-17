// #334 — integration: the linear-EXR chain (raw histogram → collapse →
// normalize → EXR encode) produces a structurally valid OpenEXR whose pixel
// values reflect the input radiance. The individual stages are unit-tested in
// export-linear.test.ts and exr-encode.test.ts; this ties them together.
//
// Parity-safety of the default render path (the other half of the F1 guard) is
// covered by the 26-fixture rig (`npm run test:parity`): export modes are
// opt-in, so the clamped 8-bit path stays byte-identical.
import { describe, it, expect } from 'vitest';
import { histogramToLinearRgba } from './export-linear';
import { encodeExr } from './exr-encode';

describe('linear-EXR export pipeline', () => {
  it('collapses a super-histogram and encodes a valid 32f EXR', () => {
    // 2×2 output, oversample 2 → 4×4 super-pixels, 4 u32 (R,G,B,count) each.
    const width = 2, height = 2, oversample = 2;
    const superW = width * oversample;
    const superRgba = new Uint32Array(superW * superW * 4);
    // Light up one super-pixel of the top-left output pixel brightly.
    superRgba[0] = 2550; superRgba[1] = 1275; superRgba[2] = 0; superRgba[3] = 10;

    // k1·k2 = 1/255 → scale = (1/255)/block(4); R sum 2550 → 2550/255/4 = 2.5.
    const linear = histogramToLinearRgba({ superRgba, width, height, oversample, k1: 1, k2: 1 / 255 });
    expect(linear.length).toBe(width * height * 4);
    // Top-left pixel R = 2550/255/4 (block avg) = 2.5 — over-range linear HDR.
    expect(linear[0]).toBeCloseTo(2.5, 5);
    expect(linear[1]).toBeCloseTo(1.25, 5);

    const exr = encodeExr({ width, height, rgba: linear });
    const dv = new DataView(exr.buffer, exr.byteOffset, exr.byteLength);
    expect(dv.getUint32(0, true)).toBe(0x01312f76); // magic
    expect(dv.getUint8(4)).toBe(2); // version
    // Decoder-agnostic structural sanity: the buffer is larger than its header.
    expect(exr.byteLength).toBeGreaterThan(width * height * 4 * 4);
  });

  it('preserves over-range highlights (>1.0) instead of clamping', () => {
    const superRgba = new Uint32Array([255000, 0, 0, 1000]); // very bright single pixel
    const linear = histogramToLinearRgba({ superRgba, width: 1, height: 1, oversample: 1, k1: 1, k2: 1 / 255 });
    expect(linear[0]!).toBeGreaterThan(1.0); // 255000/255 = 1000 ≫ 1.0, kept as float
  });
});
