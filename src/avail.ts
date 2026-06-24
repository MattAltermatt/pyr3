// Availability-manifest decoder for corpus chunk delivery.
//
// Each per-gen availability manifest is a brotli-compressed stream of
// unsigned LEB128 (little-endian base-128) varints that encode sorted,
// unique present sheep ids as:
//   varint(ids[0]) || varint(ids[1]-ids[0]) || varint(ids[2]-ids[1]) || ...
//
// There is NO leading count — read varints until the buffer is exhausted,
// then reconstruct ids by cumulative sum.  An empty manifest (brotli of an
// empty buffer) decodes to [].
//
// This decoder is byte-for-byte conformant with the ESF Python `encode_avail`
// encoder, verified by the cross-repo fixture tests in avail.test.ts.

import { inflateBrotliBytes } from './brotli';

/**
 * Read all unsigned LEB128 varints from `buf`.
 *
 * Each varint is encoded as 7 bits per byte (little-endian groups);
 * the high bit (0x80) is set on every byte except the last.
 */
export function readVarints(buf: Uint8Array): number[] {
  const values: number[] = [];
  let i = 0;
  while (i < buf.length) {
    let value = 0;
    let shift = 0;
    let complete = false;
    // #325 — bound the inner loop on buf.length. A truncated buffer whose last
    // byte still has the 0x80 continuation bit set would otherwise read
    // `buf[i++]` past the end (undefined → NaN value); treat it as corrupt.
    while (i < buf.length) {
      const byte = buf[i++] as number;
      // Multiply (not `|= << shift`): JS bitwise ops are 32-bit signed, which
      // would corrupt ids >= 2^28. Multiplication stays exact to ~2^53, so the
      // decoder matches Python's arbitrary-precision encoder for any real id.
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
      if ((byte & 0x80) === 0) { complete = true; break; }
    }
    if (!complete) {
      throw new Error('avail manifest truncated: dangling varint continuation byte');
    }
    values.push(value);
  }
  return values;
}

/**
 * Encode a sorted, ascending id list as LEB128 delta varints — the raw
 * (pre-brotli) form `readVarints` decodes. Stream is
 * `varint(ids[0]) || varint(ids[1]-ids[0]) || …` with no leading count, the
 * exact inverse of `readVarints`. The bake CLI brotli-compresses the result
 * (`node:zlib`) into a gen's `avail.flam3idx` (#435). Uses division (not
 * 32-bit shifts) so ids beyond 2^28 stay exact — symmetric to the decoder.
 */
export function encodeAvailRaw(ids: number[]): Uint8Array {
  const out: number[] = [];
  let prev = 0;
  for (const id of ids) {
    let delta = id - prev; // first iter: id - 0 = id
    prev = id;
    do {
      let byte = delta % 128;
      delta = Math.floor(delta / 128);
      if (delta > 0) byte += 128;
      out.push(byte);
    } while (delta > 0);
  }
  return Uint8Array.from(out);
}

/**
 * Decode a per-gen availability manifest into a sorted list of present sheep ids.
 *
 * The manifest bytes are brotli-compressed LEB128 delta-encoded varints
 * (ESF `encode_avail` format).  Returns `[]` for an empty manifest.
 */
export async function decodeAvail(bytes: ArrayBuffer): Promise<number[]> {
  const raw = await inflateBrotliBytes(bytes);
  if (raw.length === 0) return [];

  const deltas = readVarints(raw);
  if (deltas.length === 0) return [];
  const ids: number[] = new Array(deltas.length) as number[];
  ids[0] = deltas[0] as number;
  for (let i = 1; i < deltas.length; i++) {
    ids[i] = (ids[i - 1] as number) + (deltas[i] as number);
  }
  return ids;
}

/**
 * Binary-search `ids` (a sorted number[]) for `id`.
 *
 * O(log n) — do NOT use Array.includes on these lists (up to ~40k entries).
 */
export function exists(ids: number[], id: number): boolean {
  let lo = 0;
  let hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = ids[mid] as number;
    if (v === id) return true;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}
