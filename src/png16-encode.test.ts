import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { encodePng16 } from './png16-encode';

const deflate = (b: Uint8Array) => new Uint8Array(deflateSync(b));

describe('encodePng16', () => {
  it('writes a 16-bit RGBA PNG with correct IHDR', async () => {
    const width = 2, height = 2;
    const rgba16 = new Uint16Array(width * height * 4).fill(65535);
    const out = await encodePng16({ width, height, rgba16 }, deflate);
    expect([...out.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(dv.getUint32(16)).toBe(width);
    expect(dv.getUint32(20)).toBe(height);
    expect(out[24]).toBe(16); // bit depth
    expect(out[25]).toBe(6);  // colorType RGBA
  });

  it('round-trips through pngjs (16-bit)', async () => {
    const { PNG } = await import('pngjs');
    const width = 2, height = 1;
    const rgba16 = new Uint16Array([65535, 0, 0, 65535, 0, 65535, 0, 65535]);
    const out = await encodePng16({ width, height, rgba16 }, deflate);
    const parsed = PNG.sync.read(Buffer.from(out));
    expect(parsed.width).toBe(width);
  });
});
