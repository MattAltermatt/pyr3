// Feature index — binary format owner (#48 / v1.2 gallery discovery).
//
// Encodes a precomputed per-genome feature record into the on-disk layout
// pyr3's runtime + bake CLI both agree on. Pure logic: no fetch, no I/O,
// no DOM, no WebGPU. Consumed by:
//   · bin/pyr3-bake-features.ts  — produces the file
//   · src/feature-index-client   — fetches + decodes the file at runtime
//
// File layout (after brotli decompression):
//
//   [ header — 41 bytes ]
//     magic            4   ASCII "pyf3"
//     schema_version   1   u8 — bumps when record layout changes
//     corpus_tag      32   UTF-8, NUL-padded
//     record_count     4   u32 little-endian
//
//   [ records — record_count × 78 bytes each, sorted (gen ↑, id ↑) ]
//     gen              2   u16 little-endian
//     id               4   u32 little-endian
//     variation_bitset 64  bit N = 1 iff variation index N appears in any
//                          xform. Catalog runs V0..V322 (323 variations);
//                          512 bits give headroom to bit 511. (Was 16 bytes /
//                          128 bits in schema v1 — too small for V128+, which
//                          made bitsetSet throw mid-bake; #393-D. A test in
//                          feature-index.test.ts trips loudly if the catalog
//                          ever outgrows this cap — grow it + bump schema
//                          here, don't wait for the crash.)
//     xform_count      1   u8, 1-30 expected
//     coverage_q8      1   u8 — 0..1 quantized to 0..255
//     mean_lum_q8      1   u8
//     entropy_q8       1   u8
//     color_var_q8     1   u8
//     reserved         3   zero-filled (one field-add at v1; larger changes
//                          bump schema_version)
//
// The score formula reads dequantized stats + the variation bitset; it is
// NOT stored in the index — see src/feature-score.ts for the client-side
// weight vector. Keeping the score derived means tuning the formula doesn't
// require re-baking the 3-4 hour Draft-render sweep.

export const FEATURE_INDEX_MAGIC = 'pyf3';
/** Schema v1: 30-byte records, 16-byte (128-bit) variation bitset. Frozen
 *  historical value — v1 files predate the catalog outgrowing 128 indices. */
export const FEATURE_INDEX_SCHEMA_V1 = 1;
/** Schema v2 (#393-D): 78-byte records, 64-byte (512-bit) variation bitset.
 *  The record layout changed, so the version bumps — v1 files are rejected by
 *  the client and degrade to "no index" until a re-bake ships. */
export const FEATURE_INDEX_SCHEMA_V2 = 2;
/** The version this build encodes + the only version the client accepts. */
export const FEATURE_INDEX_SCHEMA_CURRENT = FEATURE_INDEX_SCHEMA_V2;

export const FEATURE_INDEX_HEADER_BYTES = 41;
export const VARIATION_BITSET_BYTES = 64;
export const CORPUS_TAG_MAX_BYTES = 32;

// Offsets inside one record. Derived from the field widths so growing the
// bitset (or adding a field) shifts everything downstream automatically —
// no hand-recomputed literals to drift. Exported so the client can iterate
// via a single zero-alloc byte view without re-decoding each field.
export const REC_OFFSET_GEN = 0;
export const REC_OFFSET_ID = REC_OFFSET_GEN + 2;
export const REC_OFFSET_VARS = REC_OFFSET_ID + 4;
export const REC_OFFSET_XFORMS = REC_OFFSET_VARS + VARIATION_BITSET_BYTES;
export const REC_OFFSET_COVERAGE = REC_OFFSET_XFORMS + 1;
export const REC_OFFSET_MEAN_LUM = REC_OFFSET_COVERAGE + 1;
export const REC_OFFSET_ENTROPY = REC_OFFSET_MEAN_LUM + 1;
export const REC_OFFSET_COLOR_VAR = REC_OFFSET_ENTROPY + 1;
// 1 stat byte + 3 reserved bytes follow the last stat field.
export const FEATURE_INDEX_RECORD_BYTES = REC_OFFSET_COLOR_VAR + 1 + 3;

/** A sheep's coordinates in canonical corpus order. */
export interface SheepRef {
  gen: number;
  id: number;
}

/** Decoded, human-readable feature row. The bitset is unpacked into an
 *  ascending array of variation indices; stats are dequantized to 0..1. */
export interface SheepFeatures {
  variations: number[];
  xforms: number;
  coverage: number;
  meanLum: number;
  entropy: number;
  colorVar: number;
}

export interface FeatureRecord extends SheepRef, SheepFeatures {}

export interface FeatureIndexHeader {
  schemaVersion: number;
  /** ESF Release tag the bake was run against, e.g.
   *  "corpus-chunks-genome-2026-05-29". Trimmed of trailing NULs. */
  corpusTag: string;
  recordCount: number;
}

// ── Bitset helpers ──────────────────────────────────────────────────────

/** Set bit `index` in a 16-byte little-endian bitset. Mutates `bytes`.
 *  Caller is responsible for passing the right subarray (a record's
 *  variation-bitset slice, not the whole record). */
export function bitsetSet(bytes: Uint8Array, index: number): void {
  if (index < 0 || index >= VARIATION_BITSET_BYTES * 8) {
    throw new Error(`feature-index: variation index ${index} out of bitset range`);
  }
  bytes[index >>> 3]! |= 1 << (index & 7);
}

/** Test bit `index` in the bitset slice. Out-of-range returns false. */
export function bitsetGet(bytes: Uint8Array, index: number): boolean {
  if (index < 0 || index >= VARIATION_BITSET_BYTES * 8) return false;
  return (bytes[index >>> 3]! & (1 << (index & 7))) !== 0;
}

/** Unpack a bitset slice to a sorted ascending list of set-bit indices.
 *  Uses bit-by-bit isolation (`b & -b`) for branchless extraction. */
export function bitsetUnpack(bytes: Uint8Array, offset = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < VARIATION_BITSET_BYTES; i++) {
    let b = bytes[offset + i]!;
    const base = i * 8;
    while (b !== 0) {
      const bit = b & -b;
      out.push(base + Math.log2(bit));
      b ^= bit;
    }
  }
  return out;
}

// ── Quantization helpers (0..1 ↔ 0..255) ────────────────────────────────

/** Round 0..1 → 0..255 byte. Clamps out-of-range; treats non-finite as 0
 *  so a corrupt input never poisons the record with NaN. */
export function quantizeQ8(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const clamped = v < 0 ? 0 : v > 1 ? 1 : v;
  return Math.round(clamped * 255) & 0xff;
}

export function dequantizeQ8(b: number): number {
  return b / 255;
}

// ── Header encode / decode ──────────────────────────────────────────────

/** Encode the 41-byte file header. Caller writes this once at the start
 *  of the (uncompressed) stream, followed by the record table. */
export function encodeHeader(header: FeatureIndexHeader): Uint8Array {
  const out = new Uint8Array(FEATURE_INDEX_HEADER_BYTES);
  out[0] = 0x70; // 'p'
  out[1] = 0x79; // 'y'
  out[2] = 0x66; // 'f'
  out[3] = 0x33; // '3'
  out[4] = header.schemaVersion & 0xff;
  const tagBytes = new TextEncoder().encode(header.corpusTag);
  if (tagBytes.length > CORPUS_TAG_MAX_BYTES) {
    throw new Error(`feature-index: corpus tag too long (${tagBytes.length} bytes > ${CORPUS_TAG_MAX_BYTES})`);
  }
  out.set(tagBytes, 5);
  // bytes 5+tagLen .. 37 stay 0 (Uint8Array default) → NUL-padding
  new DataView(out.buffer).setUint32(37, header.recordCount, true);
  return out;
}

/** Decode the header from the start of a Uint8Array. Throws on truncation
 *  or magic mismatch — the client wraps both as a "no index available"
 *  fallback so a corrupt file never crashes the gallery. */
export function decodeHeader(bytes: Uint8Array): FeatureIndexHeader {
  if (bytes.length < FEATURE_INDEX_HEADER_BYTES) {
    throw new Error('feature-index: truncated header');
  }
  if (
    bytes[0] !== 0x70 || bytes[1] !== 0x79 || bytes[2] !== 0x66 || bytes[3] !== 0x33
  ) {
    throw new Error('feature-index: magic mismatch (expected "pyf3")');
  }
  const schemaVersion = bytes[4]!;
  // Tag occupies offsets 5..36 (32 bytes), trim at first NUL.
  let tagEnd = 5 + CORPUS_TAG_MAX_BYTES;
  for (let i = 5; i < 5 + CORPUS_TAG_MAX_BYTES; i++) {
    if (bytes[i] === 0x00) {
      tagEnd = i;
      break;
    }
  }
  const corpusTag = new TextDecoder().decode(bytes.subarray(5, tagEnd));
  const recordCount = new DataView(bytes.buffer, bytes.byteOffset).getUint32(37, true);
  return { schemaVersion, corpusTag, recordCount };
}

// ── Record encode / decode ──────────────────────────────────────────────

/** Encode one feature record into a 30-byte buffer. The caller concatenates
 *  records after the header (sorted: gen ascending, id ascending). */
export function encodeRecord(rec: FeatureRecord): Uint8Array {
  const out = new Uint8Array(FEATURE_INDEX_RECORD_BYTES);
  const dv = new DataView(out.buffer);
  dv.setUint16(REC_OFFSET_GEN, rec.gen, true);
  dv.setUint32(REC_OFFSET_ID, rec.id, true);
  const varSlice = out.subarray(REC_OFFSET_VARS, REC_OFFSET_VARS + VARIATION_BITSET_BYTES);
  for (const v of rec.variations) bitsetSet(varSlice, v);
  out[REC_OFFSET_XFORMS] = rec.xforms & 0xff;
  out[REC_OFFSET_COVERAGE] = quantizeQ8(rec.coverage);
  out[REC_OFFSET_MEAN_LUM] = quantizeQ8(rec.meanLum);
  out[REC_OFFSET_ENTROPY] = quantizeQ8(rec.entropy);
  out[REC_OFFSET_COLOR_VAR] = quantizeQ8(rec.colorVar);
  // bytes 27-29 reserved, zero-filled by Uint8Array default
  return out;
}

/** Decode a record at `offset` inside a larger byte view (typically the
 *  decompressed records section). Used by tests + the client; the client
 *  also has a faster zero-alloc iteration path in feature-index-client.ts. */
export function decodeRecord(bytes: Uint8Array, offset = 0): FeatureRecord {
  if (bytes.length < offset + FEATURE_INDEX_RECORD_BYTES) {
    throw new Error('feature-index: truncated record');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset + offset);
  return {
    gen: dv.getUint16(REC_OFFSET_GEN, true),
    id: dv.getUint32(REC_OFFSET_ID, true),
    variations: bitsetUnpack(bytes, offset + REC_OFFSET_VARS),
    xforms: bytes[offset + REC_OFFSET_XFORMS]!,
    coverage: dequantizeQ8(bytes[offset + REC_OFFSET_COVERAGE]!),
    meanLum: dequantizeQ8(bytes[offset + REC_OFFSET_MEAN_LUM]!),
    entropy: dequantizeQ8(bytes[offset + REC_OFFSET_ENTROPY]!),
    colorVar: dequantizeQ8(bytes[offset + REC_OFFSET_COLOR_VAR]!),
  };
}
