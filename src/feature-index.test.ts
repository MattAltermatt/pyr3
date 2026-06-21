import { describe, expect, it } from 'vitest';
import {
  bitsetGet,
  bitsetSet,
  bitsetUnpack,
  CORPUS_TAG_MAX_BYTES,
  decodeHeader,
  decodeRecord,
  dequantizeQ8,
  encodeHeader,
  encodeRecord,
  FEATURE_INDEX_HEADER_BYTES,
  FEATURE_INDEX_MAGIC,
  FEATURE_INDEX_RECORD_BYTES,
  FEATURE_INDEX_SCHEMA_CURRENT,
  quantizeQ8,
  type FeatureRecord,
  VARIATION_BITSET_BYTES,
} from './feature-index';
import { V } from './variations';

// ── Catalog-coverage tripwire (#393-D) ──────────────────────────────────
//
// The variation bitset must address every catalog index. When it didn't
// (16-byte / 128-bit cap vs a V0..V322 catalog) `bitsetSet` threw mid-bake
// — a latent crash hours into a 3-4h feature bake. This test turns any
// future overflow into a loud, fast unit failure: when the catalog grows
// past the bitset capacity, bump VARIATION_BITSET_BYTES + schema here, not
// in a crash report.
describe('variation bitset covers the whole catalog (#393-D)', () => {
  const maxCatalogIndex = Math.max(...Object.values(V));

  it('addresses the highest catalog variation index', () => {
    expect(maxCatalogIndex).toBeLessThan(VARIATION_BITSET_BYTES * 8);
  });

  it('bitsetSet accepts the highest catalog index without throwing', () => {
    const buf = new Uint8Array(VARIATION_BITSET_BYTES);
    expect(() => bitsetSet(buf, maxCatalogIndex)).not.toThrow();
    expect(bitsetGet(buf, maxCatalogIndex)).toBe(true);
  });
});

// ── Bitset helpers ──────────────────────────────────────────────────────

describe('bitsetSet / bitsetGet / bitsetUnpack', () => {
  it.each([
    [0, 0, 0x01],   // first bit, byte 0
    [1, 0, 0x02],
    [7, 0, 0x80],   // last bit of byte 0
    [8, 1, 0x01],   // first bit of byte 1
    [63, 7, 0x80],  // last bit of byte 7
    [64, 8, 0x01],  // first bit of byte 8
    [98, 12, 0x04], // index 98 = byte 12, bit (98 % 8 = 2), 0x04
    [127, 15, 0x80], // last bit of the old (v1) 16-byte bitset
    [322, 40, 0x04], // highest catalog index (V322) = byte 40, bit 2
    [511, 63, 0x80], // last addressable bit of the v2 64-byte bitset
  ])('set bit %i lands in byte %i with mask 0x%s', (idx, byteIndex, mask) => {
    const buf = new Uint8Array(VARIATION_BITSET_BYTES);
    bitsetSet(buf, idx);
    expect(buf[byteIndex]).toBe(mask);
    expect(bitsetGet(buf, idx)).toBe(true);
  });

  it('rejects negative indices', () => {
    const buf = new Uint8Array(VARIATION_BITSET_BYTES);
    expect(() => bitsetSet(buf, -1)).toThrow(/out of bitset range/);
  });

  it('rejects indices past the bitset capacity', () => {
    const buf = new Uint8Array(VARIATION_BITSET_BYTES);
    expect(() => bitsetSet(buf, 512)).toThrow(/out of bitset range/);
  });

  it('bitsetGet returns false for out-of-range indices (graceful, not throwing)', () => {
    const buf = new Uint8Array(VARIATION_BITSET_BYTES);
    expect(bitsetGet(buf, -1)).toBe(false);
    expect(bitsetGet(buf, 512)).toBe(false);
  });

  it('bitsetUnpack returns sorted ascending indices', () => {
    const buf = new Uint8Array(VARIATION_BITSET_BYTES);
    const toSet = [0, 7, 8, 63, 64, 98, 127, 322, 511];
    for (const i of toSet) bitsetSet(buf, i);
    expect(bitsetUnpack(buf)).toEqual(toSet);
  });

  it('bitsetUnpack on empty buffer returns []', () => {
    expect(bitsetUnpack(new Uint8Array(VARIATION_BITSET_BYTES))).toEqual([]);
  });

  it('multiple sets are idempotent', () => {
    const buf = new Uint8Array(VARIATION_BITSET_BYTES);
    bitsetSet(buf, 42);
    bitsetSet(buf, 42);
    bitsetSet(buf, 42);
    expect(bitsetUnpack(buf)).toEqual([42]);
  });
});

// ── Quantization ────────────────────────────────────────────────────────

describe('quantizeQ8 / dequantizeQ8', () => {
  it('endpoints map cleanly', () => {
    expect(quantizeQ8(0)).toBe(0);
    expect(quantizeQ8(1)).toBe(255);
  });

  it('clamps out-of-range values', () => {
    expect(quantizeQ8(-0.5)).toBe(0);
    expect(quantizeQ8(2)).toBe(255);
  });

  it('treats non-finite as 0', () => {
    expect(quantizeQ8(Number.NaN)).toBe(0);
    expect(quantizeQ8(Number.POSITIVE_INFINITY)).toBe(0);
    expect(quantizeQ8(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('round-trips within ±1/255 across the full range', () => {
    for (let q = 0; q <= 255; q++) {
      const v = dequantizeQ8(q);
      const requantized = quantizeQ8(v);
      expect(requantized).toBe(q);
    }
  });

  it('round-trips arbitrary 0..1 floats with sub-step accuracy', () => {
    for (const v of [0.1, 0.25, 0.333, 0.5, 0.667, 0.9, 0.999]) {
      const requantized = dequantizeQ8(quantizeQ8(v));
      expect(Math.abs(requantized - v)).toBeLessThanOrEqual(1 / 255);
    }
  });
});

// ── Header encode / decode ──────────────────────────────────────────────

describe('encodeHeader / decodeHeader', () => {
  it('round-trips a typical header', () => {
    const header = {
      schemaVersion: FEATURE_INDEX_SCHEMA_CURRENT,
      corpusTag: 'corpus-chunks-genome-2026-05-29',
      recordCount: 52365,
    };
    const bytes = encodeHeader(header);
    expect(bytes.length).toBe(FEATURE_INDEX_HEADER_BYTES);
    expect(decodeHeader(bytes)).toEqual(header);
  });

  it('emits the magic bytes "pyf3" at offset 0..3', () => {
    const bytes = encodeHeader({
      schemaVersion: 1,
      corpusTag: 'x',
      recordCount: 0,
    });
    const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
    expect(magic).toBe(FEATURE_INDEX_MAGIC);
  });

  it('round-trips an empty corpus tag', () => {
    const header = { schemaVersion: 1, corpusTag: '', recordCount: 7 };
    expect(decodeHeader(encodeHeader(header))).toEqual(header);
  });

  it('round-trips a maximum-length 32-byte tag', () => {
    const tag = 'a'.repeat(CORPUS_TAG_MAX_BYTES);
    const header = { schemaVersion: 1, corpusTag: tag, recordCount: 1 };
    expect(decodeHeader(encodeHeader(header))).toEqual(header);
  });

  it('rejects a tag longer than 32 bytes at encode time', () => {
    const tag = 'a'.repeat(CORPUS_TAG_MAX_BYTES + 1);
    expect(() => encodeHeader({ schemaVersion: 1, corpusTag: tag, recordCount: 0 }))
      .toThrow(/too long/);
  });

  it('rejects truncated input', () => {
    expect(() => decodeHeader(new Uint8Array(10))).toThrow(/truncated header/);
  });

  it('rejects magic mismatch', () => {
    const bytes = encodeHeader({ schemaVersion: 1, corpusTag: 't', recordCount: 0 });
    bytes[0] = 0x00; // corrupt the magic
    expect(() => decodeHeader(bytes)).toThrow(/magic mismatch/);
  });

  it('round-trips a maximum u32 record count', () => {
    const header = {
      schemaVersion: 1,
      corpusTag: 'x',
      recordCount: 0xffffffff,
    };
    expect(decodeHeader(encodeHeader(header))).toEqual(header);
  });

  it('preserves schema_version byte (future-bumps decode without throwing)', () => {
    const header = { schemaVersion: 99, corpusTag: 'x', recordCount: 0 };
    expect(decodeHeader(encodeHeader(header)).schemaVersion).toBe(99);
  });
});

// ── Record encode / decode ──────────────────────────────────────────────

describe('encodeRecord / decodeRecord', () => {
  function makeRec(over: Partial<FeatureRecord> = {}): FeatureRecord {
    return {
      gen: 247,
      id: 19679,
      variations: [0, 7, 42, 98],
      xforms: 4,
      coverage: 0.7,
      meanLum: 0.4,
      entropy: 0.85,
      colorVar: 0.55,
      ...over,
    };
  }

  it('encodes to exactly FEATURE_INDEX_RECORD_BYTES', () => {
    expect(encodeRecord(makeRec()).length).toBe(FEATURE_INDEX_RECORD_BYTES);
  });

  it('round-trips identity within quantization tolerance', () => {
    const rec = makeRec();
    const decoded = decodeRecord(encodeRecord(rec));
    expect(decoded.gen).toBe(rec.gen);
    expect(decoded.id).toBe(rec.id);
    expect(decoded.variations).toEqual(rec.variations);
    expect(decoded.xforms).toBe(rec.xforms);
    for (const k of ['coverage', 'meanLum', 'entropy', 'colorVar'] as const) {
      expect(Math.abs(decoded[k] - rec[k])).toBeLessThanOrEqual(1 / 255);
    }
  });

  it('handles empty variation list (all-zero bitset)', () => {
    const rec = makeRec({ variations: [] });
    expect(decodeRecord(encodeRecord(rec)).variations).toEqual([]);
  });

  it('handles maximum (gen, id, xforms) boundary values', () => {
    const rec = makeRec({ gen: 0xffff, id: 0xffffffff, xforms: 0xff });
    const decoded = decodeRecord(encodeRecord(rec));
    expect(decoded.gen).toBe(0xffff);
    expect(decoded.id).toBe(0xffffffff);
    expect(decoded.xforms).toBe(0xff);
  });

  it('decodes a record at a non-zero offset', () => {
    const r1 = encodeRecord(makeRec({ gen: 100, id: 1 }));
    const r2 = encodeRecord(makeRec({ gen: 100, id: 2 }));
    const cat = new Uint8Array(r1.length + r2.length);
    cat.set(r1, 0);
    cat.set(r2, r1.length);
    expect(decodeRecord(cat, r1.length).id).toBe(2);
  });

  it('rejects a truncated record', () => {
    expect(() => decodeRecord(new Uint8Array(10))).toThrow(/truncated record/);
  });

  it('reserved bytes (27-29) decode without affecting other fields', () => {
    const rec = makeRec();
    const bytes = encodeRecord(rec);
    bytes[27] = 0xab;
    bytes[28] = 0xcd;
    bytes[29] = 0xef;
    const decoded = decodeRecord(bytes);
    expect(decoded.gen).toBe(rec.gen);
    expect(decoded.id).toBe(rec.id);
    expect(decoded.xforms).toBe(rec.xforms);
  });
});
