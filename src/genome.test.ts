import { describe, expect, it } from 'vitest';
import { packXforms, MAX_XFORMS, XFORM_BYTES, type Genome, type Xform } from './genome';

// Minimal valid xform — packXforms only reads the affine + weight + variations.
function xf(): Xform {
  return { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, weight: 1, color: 0, colorSpeed: 0, variations: [{ index: 0, weight: 1 }] };
}

describe('packXforms — GPU xform-buffer fit (PYR3-033)', () => {
  // Regression for PYR3-033: the chaos xforms buffer is fixed at
  // (MAX_XFORMS + 1) × XFORM_BYTES. A genome with more xforms than the cap
  // packs into a larger ArrayBuffer, overflowing queue.writeBuffer — Dawn
  // silently drops the write and the render comes out pure black.
  // electricsheep.242.01373 (54 xforms + finalxform) was the type specimen.
  it('packs a 54-xform flame (electricsheep.242.01373) within the GPU xform buffer', () => {
    const genome = { xforms: Array.from({ length: 54 }, xf), finalxform: xf() } as unknown as Genome;
    const gpuBufferBytes = (MAX_XFORMS + 1) * XFORM_BYTES;
    expect(packXforms(genome).byteLength).toBeLessThanOrEqual(gpuBufferBytes);
  });

  it('packs exactly MAX_XFORMS regular xforms + finalxform to the full buffer size', () => {
    const genome = { xforms: Array.from({ length: MAX_XFORMS }, xf), finalxform: xf() } as unknown as Genome;
    expect(packXforms(genome).byteLength).toBe((MAX_XFORMS + 1) * XFORM_BYTES);
  });
});
