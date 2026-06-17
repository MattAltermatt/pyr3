export interface ExrInput {
  width: number;
  height: number;
  /** Tightly packed RGBA f32, row-major, length = width*height*4. Linear scene-referred. */
  rgba: Float32Array;
}

// Channels are written in alphabetical order. PIXELTYPE FLOAT = 2.
const CHANNELS = ['A', 'B', 'G', 'R'] as const;
const SRC_INDEX: Record<string, number> = { R: 0, G: 1, B: 2, A: 3 };

function strBytes(s: string): number[] {
  return [...new TextEncoder().encode(s), 0];
}

/** Encode RGBA f32 to an uncompressed (NO_COMPRESSION) single-part scanline
 *  OpenEXR file. Linear scene-referred data; no compression for v1. */
export function encodeExr(input: ExrInput): Uint8Array {
  const { width, height, rgba } = input;
  const head: number[] = [];
  const push = (...b: number[]) => head.push(...b);
  const pushI32 = (v: number) => { const d = new DataView(new ArrayBuffer(4)); d.setInt32(0, v, true); push(d.getUint8(0), d.getUint8(1), d.getUint8(2), d.getUint8(3)); };

  // magic + version 2, no flags
  pushI32(0x01312f76);
  pushI32(2);

  const attr = (name: string, type: string, payload: number[]) => {
    push(...strBytes(name), ...strBytes(type));
    pushI32(payload.length);
    push(...payload);
  };

  // channels: each `name\0 <i32 pixelType=2> <u8 pLinear=0> <u8[3] reserved> <i32 xSampling=1> <i32 ySampling=1>`, terminated by \0
  const chPayload: number[] = [];
  const chPush = (...b: number[]) => chPayload.push(...b);
  const chI32 = (v: number) => { const d = new DataView(new ArrayBuffer(4)); d.setInt32(0, v, true); chPush(d.getUint8(0), d.getUint8(1), d.getUint8(2), d.getUint8(3)); };
  for (const c of CHANNELS) {
    chPush(...strBytes(c));
    chI32(2);            // FLOAT
    chPush(0, 0, 0, 0);  // pLinear + 3 reserved
    chI32(1); chI32(1);  // x/y sampling
  }
  chPush(0);             // channel-list terminator
  attr('channels', 'chlist', chPayload);

  attr('compression', 'compression', [0]); // NO_COMPRESSION
  const box: number[] = [];
  const boxI32 = (v: number) => { const d = new DataView(new ArrayBuffer(4)); d.setInt32(0, v, true); box.push(d.getUint8(0), d.getUint8(1), d.getUint8(2), d.getUint8(3)); };
  boxI32(0); boxI32(0); boxI32(width - 1); boxI32(height - 1);
  attr('dataWindow', 'box2i', box.slice());
  attr('displayWindow', 'box2i', box.slice());
  attr('lineOrder', 'lineOrder', [0]); // INCREASING_Y

  const f32attr = (name: string, type: string, vals: number[]) => {
    const p: number[] = [];
    for (const v of vals) { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, v, true); p.push(d.getUint8(0), d.getUint8(1), d.getUint8(2), d.getUint8(3)); }
    attr(name, type, p);
  };
  f32attr('pixelAspectRatio', 'float', [1]);
  f32attr('screenWindowCenter', 'v2f', [0, 0]);
  f32attr('screenWindowWidth', 'float', [1]);
  push(0); // end of header

  // Scanline offset table: one ulong (8 bytes) per scanline.
  const headerLen = head.length;
  const offsetTableLen = height * 8;
  const rowDataBytes = CHANNELS.length * width * 4; // FLOAT
  const scanlineBlock = 4 /*y*/ + 4 /*size*/ + rowDataBytes;

  const total = headerLen + offsetTableLen + height * scanlineBlock;
  const out = new Uint8Array(total);
  out.set(head, 0);
  const dv = new DataView(out.buffer);

  let cursor = headerLen + offsetTableLen;
  for (let y = 0; y < height; y++) {
    // write offset for this scanline (little-endian u64; high word 0 for our sizes)
    dv.setUint32(headerLen + y * 8, cursor, true);
    dv.setUint32(headerLen + y * 8 + 4, 0, true);
    dv.setInt32(cursor, y, true);                 // y
    dv.setInt32(cursor + 4, rowDataBytes, true);  // dataSize
    let o = cursor + 8;
    for (const c of CHANNELS) {
      const src = SRC_INDEX[c]!;
      for (let x = 0; x < width; x++) {
        dv.setFloat32(o, rgba[(y * width + x) * 4 + src]!, true);
        o += 4;
      }
    }
    cursor += scanlineBlock;
  }
  return out;
}
