// Runtime client for the feature index. Fetches `chunks/features.flam3idx`
// once per session, brotli-decodes it, and exposes a small query API used
// by the gallery filter chips + future sort-by-interest modes.
//
// Mirrors `src/avail-client.ts`'s cache semantics: module-level Promise,
// base-URL-aware fetch, never throws into boot. On any failure (network,
// brotli, magic mismatch, schema mismatch) resolves to an "empty" sentinel
// with schemaVersion=0 — callers gate UI on that.

import { inflateBrotliBytes } from './brotli';
import {
  decodeHeader,
  decodeRecord,
  FEATURE_INDEX_HEADER_BYTES,
  FEATURE_INDEX_RECORD_BYTES,
  FEATURE_INDEX_SCHEMA_CURRENT,
  REC_OFFSET_GEN,
  REC_OFFSET_ID,
  type FeatureRecord,
  type SheepRef,
} from './feature-index';

export interface FeatureIndex {
  /** Schema version of the loaded index, or 0 when no index is available
   *  (fetch failed / magic mismatch / schema mismatch). Filter UI gates
   *  its chip controls on this being non-zero. */
  schemaVersion: number;
  /** Tag from the file header — typically the ESF release tag. Empty when
   *  schemaVersion=0. */
  corpusTag: string;
  /** Number of records in the index. 0 when schemaVersion=0. */
  recordCount: number;
  has(gen: number, id: number): boolean;
  get(gen: number, id: number): FeatureRecord | null;
  /** Single-pass O(N) scan returning matching refs. Predicate runs on a
   *  decoded record view — allocates one object per record visited; fine
   *  for v1.2's ~50k-row corpus. */
  filter(predicate: (rec: FeatureRecord) => boolean): SheepRef[];
  /** Single-pass walk yielding every record in (gen↑, id↑) order. Allocates
   *  one FeatureRecord per visit — fine for the ~50k-row corpus. Returns
   *  early when the visitor returns false (truthy keeps walking). */
  forEachRecord(visitor: (rec: FeatureRecord) => void | boolean): void;
}

function featureIndexUrl(): string {
  // Base-aware (apex `/` vs project-Pages `/pyr3/`), same opaque-bytes
  // contract as chunk-fetch — never assume Content-Encoding.
  return `${import.meta.env.BASE_URL}chunks/features.flam3idx`;
}

const EMPTY: FeatureIndex = Object.freeze({
  schemaVersion: 0,
  corpusTag: '',
  recordCount: 0,
  has: () => false,
  get: () => null,
  filter: () => [],
  forEachRecord: () => {},
}) as FeatureIndex;

/** Sentinel for a transient failure — caller does NOT cache, so a later
 *  load can retry. */
function transientEmpty(): BuiltIndex {
  return { ...EMPTY, _terminal: false };
}

/** Sentinel for a terminal failure — caller caches so we don't re-decode
 *  the same bad buffer on every nav. */
function terminalEmpty(): BuiltIndex {
  return { ...EMPTY, _terminal: true };
}

let cached: Promise<FeatureIndex> | null = null;
let warnedSchema = false;
let warnedFetch = false;
let warnedMagic = false;

/**
 * Fetch + brotli-decode + parse the feature index, caching the result for
 * the rest of the session. Two-call `await loadFeatureIndex()` returns the
 * same instance.
 *
 * Caching mirrors `avail-client.ts`: TERMINAL states (success + schema
 * mismatch + magic mismatch) are committed to the cache; TRANSIENT
 * failures (network errors, non-OK fetches) return EMPTY without caching
 * so a later page load / nav can retry. This matters when a deploy is
 * mid-roll or a CDN edge is slow — without it, one transient 503 would
 * disable filters for the whole session.
 *
 * @param fetchImpl injectable for tests (defaults to global fetch).
 */
export async function loadFeatureIndex(
  fetchImpl: typeof fetch = fetch,
): Promise<FeatureIndex> {
  if (cached) return cached;
  // Build first, await before deciding to cache. This lets transient
  // failures (fetch errors / non-OK) return EMPTY without poisoning the
  // cache; only terminal results stick.
  const pending = buildIndex(fetchImpl);
  const built = await pending;
  if (built._terminal) {
    cached = Promise.resolve(built);
  }
  return built;
}

/** Test-only: reset the cached promise so a subsequent `loadFeatureIndex`
 *  re-runs the fetch. Production code never calls. */
export function _resetFeatureIndexCache(): void {
  cached = null;
  warnedSchema = false;
  warnedFetch = false;
  warnedMagic = false;
}

/** Internal extension of FeatureIndex carrying a flag the loader uses to
 *  decide whether to cache. Never visible to callers — the public type
 *  strips it. */
interface BuiltIndex extends FeatureIndex {
  _terminal: boolean;
}

function nativeFeatureIndexUrl(): string {
  return `${import.meta.env.BASE_URL}chunks/pyr3-features.flam3idx`;
}

/** Fetch + decode the committed pyr3-native feature sidecar, returning its
 *  record-section bytes (header stripped) or null on any problem. Native gen
 *  1 < all ESF gens, so these records prepend cleanly to keep (gen,id) order.
 *  Fail-soft: a missing/bogus sidecar must never disable ESF filtering (#435). */
async function fetchNativeRecordBytes(fetchImpl: typeof fetch): Promise<Uint8Array | null> {
  try {
    const resp = await fetchImpl(nativeFeatureIndexUrl());
    if (!resp.ok) return null;
    const bytes = await inflateBrotliBytes(await resp.arrayBuffer());
    const header = decodeHeader(bytes); // throws on bad magic/truncation
    if (header.schemaVersion !== FEATURE_INDEX_SCHEMA_CURRENT) return null;
    const start = FEATURE_INDEX_HEADER_BYTES;
    const end = start + header.recordCount * FEATURE_INDEX_RECORD_BYTES;
    if (bytes.length < end) return null;
    return bytes.subarray(start, end);
  } catch {
    return null;
  }
}

async function buildIndex(fetchImpl: typeof fetch): Promise<BuiltIndex> {
  let bytes: Uint8Array;
  try {
    const resp = await fetchImpl(featureIndexUrl());
    if (!resp.ok) {
      if (!warnedFetch) {
        warnedFetch = true;
        console.warn(`pyr3: feature index fetch returned ${resp.status}; filter chips disabled`);
      }
      return transientEmpty();
    }
    const compressed = await resp.arrayBuffer();
    bytes = await inflateBrotliBytes(compressed);
  } catch (err) {
    if (!warnedFetch) {
      warnedFetch = true;
      console.warn('pyr3: feature index fetch/decode failed; filter chips disabled', err);
    }
    return transientEmpty();
  }

  let header;
  try {
    header = decodeHeader(bytes);
  } catch {
    // Magic mismatch or truncation — the on-disk file is structurally
    // bogus. This is a terminal state: retrying won't help until the
    // deploy ships a corrected file, so cache the empty result so we
    // don't re-decode the same bad buffer on every call.
    if (!warnedMagic) {
      warnedMagic = true;
      console.warn('pyr3: feature index header invalid; filter chips disabled');
    }
    return terminalEmpty();
  }

  if (header.schemaVersion !== FEATURE_INDEX_SCHEMA_CURRENT) {
    if (!warnedSchema) {
      warnedSchema = true;
      console.warn(
        `pyr3: feature index schema v${header.schemaVersion} not supported (expected v${FEATURE_INDEX_SCHEMA_CURRENT}); filter chips disabled`,
      );
    }
    return terminalEmpty();
  }

  // Truncation guard: decodeHeader validates magic + length≥41 but NOT that
  // recordCount × FEATURE_INDEX_RECORD_BYTES record bytes actually follow. A truncated index (partial
  // deploy, hand-edited / re-compressed file whose header disagrees with the
  // table) would otherwise make the binary search read past the buffer
  // (RangeError) or decodeRecord throw 'truncated record' — an uncaught
  // rejection that bubbles to main().catch → dead "init failed" overlay. This
  // is the same terminal/structural-corruption class as a bad magic, so honor
  // the module's "never throw into boot, degrade to EMPTY" contract. (#256)
  const availableRecords = Math.floor(
    (bytes.length - FEATURE_INDEX_HEADER_BYTES) / FEATURE_INDEX_RECORD_BYTES,
  );
  if (availableRecords < header.recordCount) {
    if (!warnedMagic) {
      warnedMagic = true;
      console.warn(
        `pyr3: feature index truncated (header claims ${header.recordCount} records, body holds ${availableRecords}); filter chips disabled`,
      );
    }
    return terminalEmpty();
  }

  const recordsStart = FEATURE_INDEX_HEADER_BYTES;
  const esfRecordsBytes = bytes.subarray(
    recordsStart,
    recordsStart + header.recordCount * FEATURE_INDEX_RECORD_BYTES,
  );

  // Merge the committed pyr3-native records (deploy-clobber workaround). The
  // binary search requires the merged buffer stay sorted by (gen,id). pyr3
  // natives are a single reserved gen distinct from every ESF gen, so the
  // native block is entirely below or entirely above the ESF range — order
  // the two blocks by gen rather than hardcoding a side (#435).
  let recordsBytes = esfRecordsBytes;
  let mergedCount = header.recordCount;
  const nativeBytes = await fetchNativeRecordBytes(fetchImpl);
  if (nativeBytes && nativeBytes.length > 0 && header.recordCount > 0) {
    const nCount = Math.floor(nativeBytes.length / FEATURE_INDEX_RECORD_BYTES);
    const nativeFirstGen = new DataView(
      nativeBytes.buffer,
      nativeBytes.byteOffset,
      nativeBytes.byteLength,
    ).getUint16(0, true);
    const esfLastGen = new DataView(
      esfRecordsBytes.buffer,
      esfRecordsBytes.byteOffset,
      esfRecordsBytes.byteLength,
    ).getUint16((header.recordCount - 1) * FEATURE_INDEX_RECORD_BYTES, true);
    const m = new Uint8Array(nativeBytes.length + esfRecordsBytes.length);
    if (nativeFirstGen > esfLastGen) {
      m.set(esfRecordsBytes, 0); // native gen above all ESF → append
      m.set(nativeBytes, esfRecordsBytes.length);
    } else {
      m.set(nativeBytes, 0); // native gen below all ESF → prepend
      m.set(esfRecordsBytes, nativeBytes.length);
    }
    recordsBytes = m;
    mergedCount = header.recordCount + nCount;
  } else if (nativeBytes && nativeBytes.length > 0) {
    // No ESF records (degenerate) — native records stand alone.
    recordsBytes = nativeBytes;
    mergedCount = Math.floor(nativeBytes.length / FEATURE_INDEX_RECORD_BYTES);
  }

  // Take a DataView over the (possibly merged) records buffer for the
  // binary-search (zero-alloc) comparison path used by has()/get().
  const dv = new DataView(
    recordsBytes.buffer,
    recordsBytes.byteOffset,
    recordsBytes.byteLength,
  );
  const count = mergedCount;

  // Records are sorted (gen ↑, id ↑). Find lower bound by (gen, id).
  function lowerBound(gen: number, id: number): number {
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const off = mid * FEATURE_INDEX_RECORD_BYTES;
      const g = dv.getUint16(off + REC_OFFSET_GEN, true);
      if (g < gen) {
        lo = mid + 1;
        continue;
      }
      if (g > gen) {
        hi = mid;
        continue;
      }
      const i = dv.getUint32(off + REC_OFFSET_ID, true);
      if (i < id) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function findIndex(gen: number, id: number): number {
    const idx = lowerBound(gen, id);
    if (idx >= count) return -1;
    const off = idx * FEATURE_INDEX_RECORD_BYTES;
    if (
      dv.getUint16(off + REC_OFFSET_GEN, true) === gen &&
      dv.getUint32(off + REC_OFFSET_ID, true) === id
    ) {
      return idx;
    }
    return -1;
  }

  return {
    schemaVersion: header.schemaVersion,
    corpusTag: header.corpusTag,
    recordCount: count,
    _terminal: true,
    has(gen, id) {
      return findIndex(gen, id) !== -1;
    },
    get(gen, id) {
      const idx = findIndex(gen, id);
      if (idx === -1) return null;
      return decodeRecord(recordsBytes, idx * FEATURE_INDEX_RECORD_BYTES);
    },
    filter(predicate) {
      const out: SheepRef[] = [];
      for (let i = 0; i < count; i++) {
        const rec = decodeRecord(recordsBytes, i * FEATURE_INDEX_RECORD_BYTES);
        if (predicate(rec)) out.push({ gen: rec.gen, id: rec.id });
      }
      return out;
    },
    forEachRecord(visitor) {
      for (let i = 0; i < count; i++) {
        const rec = decodeRecord(recordsBytes, i * FEATURE_INDEX_RECORD_BYTES);
        const cont = visitor(rec);
        if (cont === false) return;
      }
    },
  };
}
