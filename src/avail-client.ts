// Availability-manifest client for the corpus viewer.
//
// Wraps the per-gen availability manifests (`/chunks/{gen}/avail.flam3idx`,
// brotli LEB128 — decoded by `src/avail.ts`) with a cached fetch + a
// neighbor-search used to drive prev/next/nearest corpus navigation.
//
// Fetch failures (missing manifest, offline) resolve to [] — navigation simply
// hides; this must never throw into the viewer boot path.

import { decodeAvail } from './avail';

const cache = new Map<number, number[]>();
const inflight = new Map<number, Promise<number[]>>();

function availUrl(gen: number): string {
  // Base-aware (apex `/` vs project-Pages `/pyr3/`), same opaque-bytes contract
  // as chunk-fetch — never assume Content-Encoding.
  return `${import.meta.env.BASE_URL}chunks/${gen}/avail.flam3idx`;
}

/**
 * Fetch + decode + cache a gen's sorted present-id list.
 * Memoized per gen; concurrent calls share one in-flight request.
 * Any failure resolves to [] (never throws).
 *
 * @param fetchImpl injectable for tests (defaults to global fetch).
 */
export async function loadAvail(gen: number, fetchImpl: typeof fetch = fetch): Promise<number[]> {
  const hit = cache.get(gen);
  if (hit) return hit;
  const pending = inflight.get(gen);
  if (pending) return pending;

  const p = (async () => {
    try {
      const resp = await fetchImpl(availUrl(gen));
      if (!resp.ok) {
        // A 404/410 means the gen has no manifest — cache the empty result so
        // repeated prev/next taps on a missing gen don't re-hit the network.
        cache.set(gen, []);
        return [];
      }
      const ids = await decodeAvail(await resp.arrayBuffer());
      cache.set(gen, ids);
      return ids;
    } catch {
      // Transient (offline / decode hiccup) — do NOT cache, so it can recover
      // on a later attempt; just hide nav for now.
      return [];
    } finally {
      inflight.delete(gen);
    }
  })();

  inflight.set(gen, p);
  return p;
}

export interface Neighbors {
  /** Greatest present id strictly less than `id`, or null. */
  prev: number | null;
  /** Smallest present id strictly greater than `id`, or null. */
  next: number | null;
  /** Closest present id (ties resolve to the lower id), or null when empty. */
  nearest: number | null;
  /** True iff `id` itself is in the list. */
  isPresent: boolean;
}

/**
 * Prev/next/nearest present id around `id` in a sorted unique list.
 * `id` need not be present. O(log n) — binary search for the lower bound.
 */
export function neighbors(ids: number[], id: number): Neighbors {
  if (ids.length === 0) return { prev: null, next: null, nearest: null, isPresent: false };

  // lower bound: first index with ids[i] >= id
  let lo = 0;
  let hi = ids.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((ids[mid] as number) < id) lo = mid + 1;
    else hi = mid;
  }
  const atOrAbove = lo;
  const isPresent = atOrAbove < ids.length && ids[atOrAbove] === id;

  const prevIdx = atOrAbove - 1;
  const nextIdx = isPresent ? atOrAbove + 1 : atOrAbove;
  const prev = prevIdx >= 0 ? (ids[prevIdx] as number) : null;
  const next = nextIdx < ids.length ? (ids[nextIdx] as number) : null;

  let nearest: number | null;
  if (isPresent) nearest = id;
  else if (prev === null) nearest = next;
  else if (next === null) nearest = prev;
  else nearest = id - prev <= next - id ? prev : next; // ties → lower

  return { prev, next, nearest, isPresent };
}
