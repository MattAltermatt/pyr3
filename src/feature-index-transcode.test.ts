import { describe, expect, it } from 'vitest';
import {
  FEATURE_INDEX_HEADER_BYTES,
  FEATURE_INDEX_RECORD_BYTES,
  FEATURE_INDEX_SCHEMA_V2,
  decodeHeader,
  decodeRecord,
  encodeHeader,
  quantizeQ8,
  type FeatureRecord,
} from './feature-index';
import { transcodeFeatureIndexV1ToV2 } from './feature-index-transcode';

// ── Synthetic schema-v1 encoder (mirrors the frozen 30-byte layout) ──────
// We can't reuse the live `encodeRecord` — it now writes v2 (78-byte) records.
const V1_RECORD_BYTES = 30;
function encodeRecordV1(rec: FeatureRecord): Uint8Array {
  const out = new Uint8Array(V1_RECORD_BYTES);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, rec.gen, true);
  dv.setUint32(2, rec.id, true);
  const vars = out.subarray(6, 6 + 16); // 16-byte / 128-bit v1 bitset
  for (const v of rec.variations) vars[v >>> 3]! |= 1 << (v & 7);
  out[22] = rec.xforms & 0xff;
  out[23] = quantizeQ8(rec.coverage);
  out[24] = quantizeQ8(rec.meanLum);
  out[25] = quantizeQ8(rec.entropy);
  out[26] = quantizeQ8(rec.colorVar);
  return out;
}
function buildV1Index(corpusTag: string, records: FeatureRecord[]): Uint8Array {
  // `encodeHeader` writes the same 41-byte header for any version — pass v1.
  const header = encodeHeader({ schemaVersion: 1, corpusTag, recordCount: records.length });
  const out = new Uint8Array(FEATURE_INDEX_HEADER_BYTES + records.length * V1_RECORD_BYTES);
  out.set(header, 0);
  records.forEach((r, i) =>
    out.set(encodeRecordV1(r), FEATURE_INDEX_HEADER_BYTES + i * V1_RECORD_BYTES),
  );
  return out;
}

// A spread of records exercising every field; stats chosen as k/255 so the q8
// quantize/dequantize round-trips exactly (lets us assert strict equality).
const SAMPLE: FeatureRecord[] = [
  { gen: 0, id: 0, variations: [], xforms: 1, coverage: 0, meanLum: 0, entropy: 0, colorVar: 0 },
  { gen: 244, id: 42746, variations: [0, 1, 27, 98], xforms: 6, coverage: 51 / 255, meanLum: 128 / 255, entropy: 200 / 255, colorVar: 17 / 255 },
  { gen: 248, id: 23554, variations: [7, 64, 127], xforms: 30, coverage: 255 / 255, meanLum: 1 / 255, entropy: 99 / 255, colorVar: 254 / 255 },
];

describe('transcodeFeatureIndexV1ToV2', () => {
  it('produces a v2 header with the same tag + record count', () => {
    const v2 = transcodeFeatureIndexV1ToV2(buildV1Index('corpus-2026-06-01', SAMPLE));
    const h = decodeHeader(v2);
    expect(h.schemaVersion).toBe(FEATURE_INDEX_SCHEMA_V2);
    expect(h.corpusTag).toBe('corpus-2026-06-01');
    expect(h.recordCount).toBe(SAMPLE.length);
  });

  it('output length is header + recordCount × 78', () => {
    const v2 = transcodeFeatureIndexV1ToV2(buildV1Index('t', SAMPLE));
    expect(v2.length).toBe(FEATURE_INDEX_HEADER_BYTES + SAMPLE.length * FEATURE_INDEX_RECORD_BYTES);
    expect(FEATURE_INDEX_RECORD_BYTES).toBe(78);
  });

  it('preserves every decoded field of every record (lossless)', () => {
    const v2 = transcodeFeatureIndexV1ToV2(buildV1Index('t', SAMPLE));
    SAMPLE.forEach((orig, i) => {
      const got = decodeRecord(v2, FEATURE_INDEX_HEADER_BYTES + i * FEATURE_INDEX_RECORD_BYTES);
      expect(got.gen).toBe(orig.gen);
      expect(got.id).toBe(orig.id);
      expect(got.variations).toEqual(orig.variations);
      expect(got.xforms).toBe(orig.xforms);
      expect(got.coverage).toBeCloseTo(orig.coverage, 10);
      expect(got.meanLum).toBeCloseTo(orig.meanLum, 10);
      expect(got.entropy).toBeCloseTo(orig.entropy, 10);
      expect(got.colorVar).toBeCloseTo(orig.colorVar, 10);
    });
  });

  it('zero-extends the bitset — no variation index ≥ 128 ever appears', () => {
    const v2 = transcodeFeatureIndexV1ToV2(buildV1Index('t', SAMPLE));
    SAMPLE.forEach((_, i) => {
      const got = decodeRecord(v2, FEATURE_INDEX_HEADER_BYTES + i * FEATURE_INDEX_RECORD_BYTES);
      for (const v of got.variations) expect(v).toBeLessThan(128);
    });
  });

  it('handles an empty (0-record) index', () => {
    const v2 = transcodeFeatureIndexV1ToV2(buildV1Index('empty', []));
    expect(decodeHeader(v2).recordCount).toBe(0);
    expect(v2.length).toBe(FEATURE_INDEX_HEADER_BYTES);
  });

  it('throws on a magic mismatch', () => {
    const junk = new Uint8Array(FEATURE_INDEX_HEADER_BYTES);
    junk[0] = 0x00; // not 'p'
    expect(() => transcodeFeatureIndexV1ToV2(junk)).toThrow(/magic/);
  });

  it('throws when the input is already v2 (wrong version)', () => {
    const v2once = transcodeFeatureIndexV1ToV2(buildV1Index('t', SAMPLE));
    expect(() => transcodeFeatureIndexV1ToV2(v2once)).toThrow(/expected schema v1/);
  });

  it('throws on a length that does not match recordCount × 30', () => {
    const v1 = buildV1Index('t', SAMPLE);
    const truncated = v1.subarray(0, v1.length - 5); // drop 5 bytes
    expect(() => transcodeFeatureIndexV1ToV2(truncated)).toThrow(/length/);
  });
});
