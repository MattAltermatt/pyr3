// #123 — inject a PNG tEXt chunk into an existing PNG byte stream.
//
// Used by both the BE CLI (bin/pyr3-render.ts) and the FE save paths
// (src/main.ts viewer save, src/edit-mount.ts editor save) to embed the
// source genome as `pyr3`-keyed JSON so that the rendered PNG is
// self-describing. Round-trip: a future PNG-import reader pulls the
// chunk out via the inverse readTextChunks().
//
// We use tEXt (not iTXt) because pyr3's JSON serializer emits ASCII-safe
// output — any non-Latin1 chars in the source (palette names, nicks) are
// escaped to `\uXXXX` by encodeAsciiSafe() below, so the chunk text
// stays in the tEXt-required Latin-1 range without information loss.
//
// PNG tEXt chunk format (PNG spec, section 11.3.4.3):
//   4 bytes  big-endian length         (= keyword.length + 1 + text.length)
//   4 bytes  chunk type                (= 'tEXt')
//   N bytes  keyword                   (1-79 chars, Latin-1, no NULL)
//   1 byte   null separator            (= 0x00)
//   N bytes  text                      (Latin-1)
//   4 bytes  big-endian CRC32          (of chunk type + keyword + 0x00 + text)
//
// Insertion point is just before the IEND chunk (always the last chunk).

const SIG_LEN = 8;
const IEND_TYPE = new Uint8Array([0x49, 0x45, 0x4e, 0x44]); // 'IEND'

/** Escape any non-Latin1 (≥ 0x80) characters to `\uXXXX` so the resulting
 *  string is safe to embed in a PNG tEXt chunk. JSON.parse on the readback
 *  side unescapes them back to the original Unicode. */
function encodeAsciiSafe(s: string): string {
  return s.replace(/[-￿]/g, (c) => {
    const hex = c.charCodeAt(0).toString(16).padStart(4, '0');
    return `\\u${hex}`;
  });
}

/** CRC32 (IEEE 802.3 polynomial, init=0xFFFFFFFF, finalize=invert).
 *  Matches PNG spec. Lazy table init. */
let _crcTable: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (_crcTable) return _crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n >>> 0;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  _crcTable = t;
  return t;
}
export function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Build a tEXt chunk for the given key + value. */
function buildTextChunk(key: string, value: string): Uint8Array {
  if (key.length === 0 || key.length > 79) {
    throw new Error(`pyr3 PNG tEXt: key length must be 1..79, got ${key.length}`);
  }
  const safeValue = encodeAsciiSafe(value);
  const keyBytes = new Uint8Array(key.length);
  for (let i = 0; i < key.length; i++) keyBytes[i] = key.charCodeAt(i) & 0xff;
  const valBytes = new Uint8Array(safeValue.length);
  for (let i = 0; i < safeValue.length; i++) valBytes[i] = safeValue.charCodeAt(i) & 0xff;

  const dataLen = keyBytes.length + 1 + valBytes.length;
  const chunk = new Uint8Array(4 + 4 + dataLen + 4);
  const dv = new DataView(chunk.buffer);

  // length (big-endian)
  dv.setUint32(0, dataLen, false);
  // type = 'tEXt'
  chunk[4] = 0x74; chunk[5] = 0x45; chunk[6] = 0x58; chunk[7] = 0x74;
  // keyword
  chunk.set(keyBytes, 8);
  // null separator
  chunk[8 + keyBytes.length] = 0x00;
  // text
  chunk.set(valBytes, 8 + keyBytes.length + 1);
  // CRC32 over (type + data)
  const crcInput = chunk.subarray(4, 4 + 4 + dataLen);
  dv.setUint32(4 + 4 + dataLen, crc32(crcInput), false);

  return chunk;
}

/** Inject a tEXt chunk (key, value) into an existing PNG. The chunk is
 *  inserted just before the IEND chunk. Returns a NEW Uint8Array; does
 *  not mutate the input. Throws if the input is not a valid PNG. */
export function injectPngTextChunk(png: Uint8Array, key: string, value: string): Uint8Array {
  if (png.length < SIG_LEN + 12) {
    throw new Error('pyr3 PNG tEXt: input too short to be a PNG');
  }
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47 ||
    png[4] !== 0x0d || png[5] !== 0x0a || png[6] !== 0x1a || png[7] !== 0x0a
  ) {
    throw new Error('pyr3 PNG tEXt: bad PNG signature');
  }

  // Find IEND chunk. It is ALWAYS the last chunk (4-byte length + 4-byte type +
  // 0-byte data + 4-byte CRC = 12 bytes). The type bytes are at offset
  // png.length - 12 + 4 = png.length - 8.
  const iendStart = png.length - 12;
  if (
    png[iendStart + 4] !== IEND_TYPE[0] || png[iendStart + 5] !== IEND_TYPE[1] ||
    png[iendStart + 6] !== IEND_TYPE[2] || png[iendStart + 7] !== IEND_TYPE[3]
  ) {
    // Some encoders may have trailing data. Walk chunks from the front.
    let off = SIG_LEN;
    let found = -1;
    while (off + 12 <= png.length) {
      const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
      const dataLen = dv.getUint32(off, false);
      const t0 = png[off + 4], t1 = png[off + 5], t2 = png[off + 6], t3 = png[off + 7];
      if (t0 === IEND_TYPE[0] && t1 === IEND_TYPE[1] && t2 === IEND_TYPE[2] && t3 === IEND_TYPE[3]) {
        found = off;
        break;
      }
      off += 4 + 4 + dataLen + 4;
    }
    if (found < 0) throw new Error('pyr3 PNG tEXt: IEND not found');
    return spliceAt(png, found, buildTextChunk(key, value));
  }
  return spliceAt(png, iendStart, buildTextChunk(key, value));
}

function spliceAt(png: Uint8Array, iendOff: number, chunk: Uint8Array): Uint8Array {
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, iendOff), 0);
  out.set(chunk, iendOff);
  out.set(png.subarray(iendOff), iendOff + chunk.length);
  return out;
}

/** Read all tEXt chunks (key → value) from a PNG. Used by the PNG-import
 *  reader (src/loader.ts). Returns the raw Latin-1 value verbatim — any
 *  `\uXXXX` escapes encodeAsciiSafe() added stay as JSON-native escapes that
 *  the consumer's JSON.parse decodes (#239). Returns an empty object on a
 *  non-PNG input rather than throwing — callers can decide what to do with
 *  the absence of metadata. */
export function readPngTextChunks(png: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  if (png.length < SIG_LEN + 12) return out;
  if (
    png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47
  ) return out;

  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let off = SIG_LEN;
  while (off + 12 <= png.length) {
    const dataLen = dv.getUint32(off, false);
    const t0 = png[off + 4], t1 = png[off + 5], t2 = png[off + 6], t3 = png[off + 7];
    if (t0 === 0x74 && t1 === 0x45 && t2 === 0x58 && t3 === 0x74) {
      // tEXt
      const data = png.subarray(off + 8, off + 8 + dataLen);
      let sep = -1;
      for (let i = 0; i < data.length; i++) {
        if (data[i] === 0x00) { sep = i; break; }
      }
      if (sep > 0) {
        let key = '';
        for (let i = 0; i < sep; i++) key += String.fromCharCode(data[i]!);
        let value = '';
        for (let i = sep + 1; i < data.length; i++) value += String.fromCharCode(data[i]!);
        // #239 — do NOT unescape \uXXXX here. encodeAsciiSafe() emits
        // JSON-native \uXXXX escapes for non-ASCII chars, so the stored value
        // is already valid JSON; the consumer's JSON.parse decodes them
        // natively. A readback-time regex unescape cannot distinguish an escape
        // the encoder added from a literal `\uXXXX` already present in the JSON
        // (e.g. a flame name like `testAliteral`, whose backslash JSON
        // doubles to `\\u0041`); decoding corrupted it into invalid JSON and
        // crashed reload. Returning the raw Latin-1 value is lossless.
        out[key] = value;
      }
    }
    // IEND? Done.
    if (t0 === IEND_TYPE[0] && t1 === IEND_TYPE[1] && t2 === IEND_TYPE[2] && t3 === IEND_TYPE[3]) {
      break;
    }
    off += 4 + 4 + dataLen + 4;
  }
  return out;
}
