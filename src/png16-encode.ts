import { crc32 } from './png-text-chunk';

export interface Png16Input {
  width: number;
  height: number;
  /** Tightly packed RGBA u16 samples, row-major, length = width*height*4. */
  rgba16: Uint16Array;
}

export interface PngInput {
  width: number;
  height: number;
  bitDepth: 8 | 16;
  /** Tightly packed RGBA samples, row-major, length = width*height*4.
   *  Uint16Array for 16-bit output, Uint8Array for 8-bit. */
  data: Uint16Array | Uint8Array;
}

export type Deflate = (raw: Uint8Array) => Uint8Array | Promise<Uint8Array>;

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.length);
  dv.setUint32(8 + data.length, crc32(crcInput) >>> 0);
  return out;
}

/** Encode RGBA to an 8- or 16-bit-per-channel RGBA PNG. 16-bit samples are
 *  written big-endian per the PNG spec. `deflate` produces a zlib stream
 *  (RFC1950) — Node `zlib.deflateSync` or a browser `CompressionStream`. */
export async function encodePng(input: PngInput, deflate: Deflate): Promise<Uint8Array> {
  const { width, height, bitDepth, data } = input;
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = 6; // colorType RGBA
  // 10..12 = compression(0), filter(0), interlace(0)

  const sampleBytes = bitDepth === 16 ? 2 : 1;
  const bytesPerRow = width * 4 * sampleBytes;
  const raw = new Uint8Array(height * (1 + bytesPerRow));
  for (let y = 0; y < height; y++) {
    const rowOff = y * (1 + bytesPerRow);
    raw[rowOff] = 0; // filter: none
    let o = rowOff + 1;
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        const v = data[(y * width + x) * 4 + c]!;
        if (bitDepth === 16) {
          raw[o++] = (v >> 8) & 0xff;
          raw[o++] = v & 0xff;
        } else {
          raw[o++] = v & 0xff;
        }
      }
    }
  }
  const idat = await deflate(raw);

  const parts = [
    new Uint8Array(SIG),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat instanceof Uint8Array ? idat : new Uint8Array(idat)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/** Back-compat wrapper — 16-bit RGBA PNG from a Uint16Array. */
export function encodePng16(input: Png16Input, deflate: Deflate): Promise<Uint8Array> {
  return encodePng({ width: input.width, height: input.height, bitDepth: 16, data: input.rgba16 }, deflate);
}
