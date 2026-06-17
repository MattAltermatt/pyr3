import { describe, it, expect } from 'vitest';
import { encodeExr } from './exr-encode';

function readAttr(bytes: Uint8Array, name: string): number {
  const needle = new TextEncoder().encode(name + '\0');
  outer: for (let i = 0; i < bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

describe('encodeExr', () => {
  it('writes a structurally valid uncompressed 32f EXR', () => {
    const width = 2, height = 2;
    const rgba = new Float32Array(width * height * 4).fill(0.5);
    const out = encodeExr({ width, height, rgba });
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(dv.getUint32(0, true)).toBe(0x01312f76);
    expect(dv.getUint8(4)).toBe(2); // version
    expect(readAttr(out, 'channels')).toBeGreaterThan(0);
    expect(readAttr(out, 'compression')).toBeGreaterThan(0);
    expect(readAttr(out, 'dataWindow')).toBeGreaterThan(0);
    expect(readAttr(out, 'screenWindowWidth')).toBeGreaterThan(0);
  });

  it('round-trips a known pixel value (channel R of pixel 0)', () => {
    const width = 1, height = 1;
    const rgba = new Float32Array([3.25, 0, 0, 1]);
    const out = encodeExr({ width, height, rgba });
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const rVal = dv.getFloat32(out.byteLength - 4, true);
    expect(rVal).toBeCloseTo(3.25, 5);
  });
});
