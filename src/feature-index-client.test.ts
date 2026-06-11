import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brotliCompressSync } from 'node:zlib';
import {
  loadFeatureIndex,
  _resetFeatureIndexCache,
} from './feature-index-client';
import {
  encodeHeader,
  encodeRecord,
  FEATURE_INDEX_RECORD_BYTES,
  FEATURE_INDEX_SCHEMA_V1,
  type FeatureRecord,
} from './feature-index';

// Build an uncompressed (header + records) buffer for the given records,
// then brotli-compress + wrap in a Response. Records are sorted by the
// caller; the format requires (gen ↑, id ↑).
function buildIndexResponse(
  records: FeatureRecord[],
  schemaVersion = FEATURE_INDEX_SCHEMA_V1,
  corpusTag = 'test-corpus',
): Response {
  const header = encodeHeader({ schemaVersion, corpusTag, recordCount: records.length });
  const recBytes = new Uint8Array(records.length * FEATURE_INDEX_RECORD_BYTES);
  records.forEach((r, i) => recBytes.set(encodeRecord(r), i * FEATURE_INDEX_RECORD_BYTES));
  const uncompressed = new Uint8Array(header.length + recBytes.length);
  uncompressed.set(header, 0);
  uncompressed.set(recBytes, header.length);
  const compressed = brotliCompressSync(uncompressed);
  // Slice to ArrayBuffer for the Response body.
  const ab = compressed.buffer.slice(
    compressed.byteOffset,
    compressed.byteOffset + compressed.byteLength,
  );
  return new Response(ab);
}

const sample: FeatureRecord[] = [
  {
    gen: 245,
    id: 100,
    variations: [0, 3, 7],
    xforms: 3,
    coverage: 0.6,
    meanLum: 0.4,
    entropy: 0.7,
    colorVar: 0.5,
  },
  {
    gen: 245,
    id: 200,
    variations: [1, 2],
    xforms: 4,
    coverage: 0.8,
    meanLum: 0.5,
    entropy: 0.6,
    colorVar: 0.6,
  },
  {
    gen: 246,
    id: 50,
    variations: [10, 20],
    xforms: 4,
    coverage: 0.3,
    meanLum: 0.7,
    entropy: 0.5,
    colorVar: 0.8,
  },
  {
    gen: 247,
    id: 19679,
    variations: [27],
    xforms: 2,
    coverage: 0.5,
    meanLum: 0.6,
    entropy: 0.4,
    colorVar: 0.3,
  },
];

describe('loadFeatureIndex', () => {
  beforeEach(() => {
    _resetFeatureIndexCache();
  });

  it('happy path: header fields + has/get round-trip + filter', async () => {
    const f = vi.fn(async () => buildIndexResponse(sample));
    const idx = await loadFeatureIndex(f as unknown as typeof fetch);
    expect(idx.schemaVersion).toBe(FEATURE_INDEX_SCHEMA_V1);
    expect(idx.corpusTag).toBe('test-corpus');
    expect(idx.recordCount).toBe(sample.length);

    // has: present + absent
    expect(idx.has(245, 100)).toBe(true);
    expect(idx.has(247, 19679)).toBe(true);
    expect(idx.has(245, 999)).toBe(false);
    expect(idx.has(999, 100)).toBe(false);
    expect(idx.has(246, 49)).toBe(false);

    // get: round-trip stats (Q8 quantization → small tolerance)
    const got = idx.get(245, 200);
    expect(got).not.toBeNull();
    expect(got!.gen).toBe(245);
    expect(got!.id).toBe(200);
    expect(got!.variations).toEqual([1, 2]);
    expect(got!.xforms).toBe(4);
    expect(got!.coverage).toBeCloseTo(0.8, 2);
    expect(got!.meanLum).toBeCloseTo(0.5, 2);

    // get: absent → null
    expect(idx.get(245, 999)).toBeNull();
    expect(idx.get(999, 0)).toBeNull();

    // filter: xforms === 4 should hit (245,200) + (246,50)
    const fours = idx.filter((r) => r.xforms === 4);
    expect(fours).toEqual([
      { gen: 245, id: 200 },
      { gen: 246, id: 50 },
    ]);
  });

  it('caches the result — second call does not re-fetch', async () => {
    const f = vi.fn(async () => buildIndexResponse(sample));
    const a = await loadFeatureIndex(f as unknown as typeof fetch);
    const b = await loadFeatureIndex(f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('fetch !ok (404) → empty sentinel', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = vi.fn(async () => new Response(null, { status: 404 }));
    const idx = await loadFeatureIndex(f as unknown as typeof fetch);
    expect(idx.schemaVersion).toBe(0);
    expect(idx.recordCount).toBe(0);
    expect(idx.has(245, 100)).toBe(false);
    expect(idx.get(245, 100)).toBeNull();
    expect(idx.filter(() => true)).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('fetch throws → empty sentinel', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = vi.fn(async () => {
      throw new Error('offline');
    });
    const idx = await loadFeatureIndex(f as unknown as typeof fetch);
    expect(idx.schemaVersion).toBe(0);
    expect(idx.has(245, 100)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('magic mismatch (non-feature-index payload) → empty sentinel', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // brotli-compress a buffer that decodes to bytes NOT starting with "pyf3".
    const junk = new Uint8Array(64).fill(0xff);
    const compressed = brotliCompressSync(junk);
    const ab = compressed.buffer.slice(
      compressed.byteOffset,
      compressed.byteOffset + compressed.byteLength,
    );
    const f = vi.fn(async () => new Response(ab));
    const idx = await loadFeatureIndex(f as unknown as typeof fetch);
    expect(idx.schemaVersion).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('schema mismatch → empty sentinel + console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = vi.fn(async () => buildIndexResponse(sample, 99));
    const idx = await loadFeatureIndex(f as unknown as typeof fetch);
    expect(idx.schemaVersion).toBe(0);
    expect(idx.has(245, 100)).toBe(false);
    expect(warn).toHaveBeenCalled();
    // The warn message should mention the schema version.
    const msg = warn.mock.calls.map((c) => String(c[0])).join(' ');
    expect(msg).toMatch(/schema/i);
    warn.mockRestore();
  });

  it('truncated body (header record_count exceeds the bytes present) → empty sentinel (#256)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Valid header claiming sample.length records, but only ONE record's
    // worth of body bytes follow — a partial deploy / hand-edited file.
    const header = encodeHeader({
      schemaVersion: FEATURE_INDEX_SCHEMA_V1,
      corpusTag: 'test-corpus',
      recordCount: sample.length,
    });
    const recBytes = encodeRecord(sample[0]!); // 1 of sample.length records
    const uncompressed = new Uint8Array(header.length + recBytes.length);
    uncompressed.set(header, 0);
    uncompressed.set(recBytes, header.length);
    const compressed = brotliCompressSync(uncompressed);
    const ab = compressed.buffer.slice(
      compressed.byteOffset,
      compressed.byteOffset + compressed.byteLength,
    );
    const f = vi.fn(async () => new Response(ab));
    const idx = await loadFeatureIndex(f as unknown as typeof fetch);
    // Degrades to EMPTY rather than throwing into boot (.catch → dead overlay).
    expect(idx.schemaVersion).toBe(0);
    expect(idx.recordCount).toBe(0);
    expect(idx.has(245, 100)).toBe(false);
    expect(idx.filter(() => true)).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('transient fetch failure does NOT poison the cache — retry succeeds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let attempt = 0;
    const f = vi.fn(async () => {
      attempt++;
      if (attempt === 1) return new Response(null, { status: 503 }); // transient
      return buildIndexResponse(sample);
    });
    const a = await loadFeatureIndex(f as unknown as typeof fetch);
    expect(a.schemaVersion).toBe(0);
    // Second call must NOT return the same dead sentinel — it should retry
    // because the first failure was transient.
    const b = await loadFeatureIndex(f as unknown as typeof fetch);
    expect(b.schemaVersion).toBe(FEATURE_INDEX_SCHEMA_V1);
    expect(b.recordCount).toBe(sample.length);
    expect(f).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('terminal magic-mismatch failure DOES cache — no retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const junk = new Uint8Array(64).fill(0xff);
    const compressed = brotliCompressSync(junk);
    const ab = compressed.buffer.slice(
      compressed.byteOffset,
      compressed.byteOffset + compressed.byteLength,
    );
    const f = vi.fn(async () => new Response(ab));
    await loadFeatureIndex(f as unknown as typeof fetch);
    await loadFeatureIndex(f as unknown as typeof fetch);
    // Terminal — second call hits the cache, fetch only called once.
    expect(f).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('_resetFeatureIndexCache lets a subsequent load re-fetch', async () => {
    const f = vi.fn(async () => buildIndexResponse(sample));
    await loadFeatureIndex(f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
    _resetFeatureIndexCache();
    await loadFeatureIndex(f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('FeatureIndex.forEachRecord', () => {
  beforeEach(() => {
    _resetFeatureIndexCache();
  });

  it('visits every record exactly once in ascending (gen,id) order', async () => {
    const f = vi.fn(async () => buildIndexResponse(sample));
    const idx = await loadFeatureIndex(f as unknown as typeof fetch);
    const seen: Array<{ gen: number; id: number }> = [];
    idx.forEachRecord((rec) => {
      seen.push({ gen: rec.gen, id: rec.id });
    });
    expect(seen).toEqual(sample.map((r) => ({ gen: r.gen, id: r.id })));
  });

  it('does nothing on the EMPTY sentinel index', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = vi.fn(async () => new Response(null, { status: 503 }));
    const idx = await loadFeatureIndex(f as unknown as typeof fetch);
    expect(idx.recordCount).toBe(0);
    let visits = 0;
    idx.forEachRecord(() => {
      visits++;
    });
    expect(visits).toBe(0);
    warn.mockRestore();
  });

  it('returns early when visitor returns false', async () => {
    const f = vi.fn(async () => buildIndexResponse(sample));
    const idx = await loadFeatureIndex(f as unknown as typeof fetch);
    const seen: Array<{ gen: number; id: number }> = [];
    idx.forEachRecord((rec) => {
      seen.push({ gen: rec.gen, id: rec.id });
      if (seen.length >= 2) return false;
    });
    expect(seen).toHaveLength(2);
    expect(seen).toEqual([
      { gen: sample[0]!.gen, id: sample[0]!.id },
      { gen: sample[1]!.gen, id: sample[1]!.id },
    ]);
  });
});
