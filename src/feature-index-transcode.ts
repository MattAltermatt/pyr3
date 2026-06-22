// One-time offline transcoder: feature-index schema v1 → v2 (#405 / #393-D).
//
// WHY a transcode instead of a re-bake: the v1→v2 change is a pure FORMAT
// WIDENING — the variation bitset grew 128→512 bits (16→64 bytes); every other
// field is byte-identical and no new per-sheep data was added. The deployed v1
// corpus is already complete: its 128-bit bake completed without `bitsetSet`
// throwing, which proves no sheep uses a variation index ≥128, so the upper 384
// bits a v2 record could hold are all zero anyway. Re-packing each v1 record
// into the wider v2 layout therefore yields a file byte-identical (in decoded
// content) to a full 5.2-hour GPU re-bake — in milliseconds, no GPU. A re-bake
// is only required when v2 adds genome-derived data (it doesn't) or the v1 data
// is wrong/incomplete (it can't be — v1 crashes rather than mis-records ≥128).
//
// This module is the PURE core (raw bytes → raw bytes, no I/O, no compression).
// The CLI wrapper `bin/pyr3-convert-feature-index.ts` adds Brotli + fs.

import {
  FEATURE_INDEX_HEADER_BYTES,
  FEATURE_INDEX_RECORD_BYTES,
  FEATURE_INDEX_SCHEMA_V1,
  FEATURE_INDEX_SCHEMA_V2,
  decodeHeader,
  encodeHeader,
  encodeRecord,
  dequantizeQ8,
  type FeatureRecord,
} from './feature-index';

// ── Frozen schema-v1 record layout ──────────────────────────────────────
// These are the v1 constants as they were before #393-D widened the bitset.
// They live here (not imported) precisely because the live constants in
// feature-index.ts now describe v2 — a transcoder must read the OLD shape.
const V1_RECORD_BYTES = 30;
const V1_BITSET_BYTES = 16; // 128 bits
const V1_OFF_GEN = 0;
const V1_OFF_ID = 2;
const V1_OFF_VARS = 6;
const V1_OFF_XFORMS = 22;
const V1_OFF_COVERAGE = 23;
const V1_OFF_MEAN_LUM = 24;
const V1_OFF_ENTROPY = 25;
const V1_OFF_COLOR_VAR = 26;

/** Unpack a v1 (16-byte) bitset slice to a sorted ascending list of set-bit
 *  indices. A v1-local copy of `bitsetUnpack` — the live one iterates 64 bytes
 *  (v2) and would over-read into the next record here. */
function bitsetUnpackV1(bytes: Uint8Array, offset: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < V1_BITSET_BYTES; i++) {
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

/** Decode one 30-byte v1 record at `offset` into a FeatureRecord. The decoded
 *  shape is schema-agnostic, so the result feeds straight into the v2
 *  `encodeRecord`. */
function decodeRecordV1(bytes: Uint8Array, offset: number): FeatureRecord {
  const dv = new DataView(bytes.buffer, bytes.byteOffset + offset);
  return {
    gen: dv.getUint16(V1_OFF_GEN, true),
    id: dv.getUint32(V1_OFF_ID, true),
    variations: bitsetUnpackV1(bytes, offset + V1_OFF_VARS),
    xforms: bytes[offset + V1_OFF_XFORMS]!,
    coverage: dequantizeQ8(bytes[offset + V1_OFF_COVERAGE]!),
    meanLum: dequantizeQ8(bytes[offset + V1_OFF_MEAN_LUM]!),
    entropy: dequantizeQ8(bytes[offset + V1_OFF_ENTROPY]!),
    colorVar: dequantizeQ8(bytes[offset + V1_OFF_COLOR_VAR]!),
  };
}

/** Transcode a *decompressed* schema-v1 feature index to *decompressed*
 *  schema-v2 bytes. Pure: no I/O, no Brotli. Throws on a non-v1 input, a magic
 *  mismatch, or a length that doesn't match `recordCount × 30 + header`. */
export function transcodeFeatureIndexV1ToV2(rawV1: Uint8Array): Uint8Array {
  const header = decodeHeader(rawV1); // validates magic; throws on mismatch
  if (header.schemaVersion !== FEATURE_INDEX_SCHEMA_V1) {
    throw new Error(
      `feature-index transcode: expected schema v${FEATURE_INDEX_SCHEMA_V1}, got v${header.schemaVersion}`,
    );
  }
  const expectedLen = FEATURE_INDEX_HEADER_BYTES + header.recordCount * V1_RECORD_BYTES;
  if (rawV1.length !== expectedLen) {
    throw new Error(
      `feature-index transcode: v1 length ${rawV1.length} ≠ expected ${expectedLen} ` +
        `(${header.recordCount} records × ${V1_RECORD_BYTES} + ${FEATURE_INDEX_HEADER_BYTES} header)`,
    );
  }

  const out = new Uint8Array(
    FEATURE_INDEX_HEADER_BYTES + header.recordCount * FEATURE_INDEX_RECORD_BYTES,
  );
  out.set(
    encodeHeader({
      schemaVersion: FEATURE_INDEX_SCHEMA_V2,
      corpusTag: header.corpusTag,
      recordCount: header.recordCount,
    }),
    0,
  );
  for (let i = 0; i < header.recordCount; i++) {
    const rec = decodeRecordV1(rawV1, FEATURE_INDEX_HEADER_BYTES + i * V1_RECORD_BYTES);
    // `encodeRecord` re-packs `rec.variations` into the wider v2 bitset; since
    // every v1 index is < 128 (16-byte bitset), the upper bits stay zero —
    // exactly what a native v2 bake of this corpus would write.
    out.set(encodeRecord(rec), FEATURE_INDEX_HEADER_BYTES + i * FEATURE_INDEX_RECORD_BYTES);
  }
  return out;
}
