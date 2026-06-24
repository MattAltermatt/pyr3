// Corpus-bounds + cross-gen neighbor resolution (#38).
//
// `public/chunks/gens.json` (the corpus shape oracle) lists the gens that exist
// in the deploy + their id ranges. The viewer uses it to:
//   1. Resolve prev/next when the user types an out-of-corpus (gen, id) into
//      the URL — so ‹ prev / next › always walks back onto a real sheep
//      instead of dead-ending.
//   2. Cross gen boundaries when the in-gen neighbor list runs out (id past
//      max → roll to next gen's first sheep; id below min → roll to prev gen's
//      last sheep).
//
// All fetches degrade silently to null: a missing/corrupt manifest just means
// no cross-gen rollover (the in-gen `neighbors` walk still works).

export interface GenEntry {
  gen: number;
  count: number;
  min_id: number;
  max_id: number;
}

export interface GensManifest {
  schema: number;
  build_date: string;
  chunk_size: number;
  /** Sorted ascending by `.gen`. */
  gens: GenEntry[];
}

/** Smallest unit the bar's prev/next pills carry — a target (gen, id) pair. */
export interface CorpusNeighbor {
  gen: number;
  id: number;
}

/** Prev / next around a target (gen, id), possibly in a different gen than the
 *  target itself. Either side is null at the genuine corpus boundary. */
export interface CorpusNeighbors {
  prev: CorpusNeighbor | null;
  next: CorpusNeighbor | null;
}

let _cached: Promise<GensManifest | null> | null = null;

function manifestUrl(): string {
  // Base-aware: apex `/` vs project-Pages `/pyr3/`.
  return `${import.meta.env.BASE_URL}chunks/gens.json`;
}

/** Fetch + cache the corpus gens manifest. Returns null on any failure (404,
 *  network, parse) — callers fall back to in-gen-only nav. Memoized. */
export async function loadGensManifest(
  fetchImpl: typeof fetch = fetch,
): Promise<GensManifest | null> {
  if (!_cached) {
    _cached = (async () => {
      try {
        const resp = await fetchImpl(manifestUrl());
        if (!resp.ok) return null;
        const data = (await resp.json()) as GensManifest;
        // Merge the committed pyr3-native sidecar (gen 1). The ESF Release
        // tar clobbers gens.json on deploy, so native gens MUST be merged
        // client-side from a distinct file the tar never touches (#435).
        try {
          const sresp = await fetchImpl(
            `${import.meta.env.BASE_URL}chunks/pyr3-gens.json`,
          );
          if (sresp.ok) {
            const side = (await sresp.json()) as { gens?: GenEntry[] };
            if (Array.isArray(side.gens)) data.gens = [...data.gens, ...side.gens];
          }
        } catch {
          // sidecar missing/offline → ESF-only manifest (current behaviour)
        }
        data.gens = [...data.gens].sort((a, b) => a.gen - b.gen);
        return data;
      } catch {
        return null;
      }
    })();
  }
  return _cached;
}

/** Test-only: reset the cached manifest promise. Production code never calls this. */
export function _resetGensManifestCache(): void {
  _cached = null;
}

/** Greatest manifest entry with `.gen < gen`, or null when `gen` is at/below
 *  the first manifest entry. Used to walk leftward across gen boundaries. */
export function prevGenEntry(manifest: GensManifest, gen: number): GenEntry | null {
  let best: GenEntry | null = null;
  for (const e of manifest.gens) {
    if (e.gen < gen) best = e;
    else break;
  }
  return best;
}

/** Smallest manifest entry with `.gen > gen`, or null when `gen` is at/above
 *  the last manifest entry. Used to walk rightward across gen boundaries. */
export function nextGenEntry(manifest: GensManifest, gen: number): GenEntry | null {
  for (const e of manifest.gens) {
    if (e.gen > gen) return e;
  }
  return null;
}

/** Resolve cross-gen prev/next for a target (gen, id).
 *
 * Strategy: compute in-gen prev/next via the provided `localNeighbors`; if
 * either side is null AND a manifest is loaded, walk to the adjacent gen
 * (filtering out gens whose avail manifest is empty) and use that gen's last
 * (for prev) or first (for next) present id.
 *
 * - `gen` outside any manifest entry → in-gen lookup is empty; walk fires for
 *   both sides. Below first gen → prev null, next = first sheep of first gen.
 *   Above last gen → prev = last sheep of last gen, next null.
 * - `gen` IS a manifest entry but `id` is out of its present-id range → in-gen
 *   gives one side, walk fills the other. e.g. id past max_id → prev = last
 *   present in-gen, next = first present id of next gen.
 *
 * Both `loadAvail` and `loadManifest` are injected for testability. */
export async function resolveCorpusNeighbors(
  gen: number,
  id: number,
  loadAvail: (g: number) => Promise<number[]>,
  loadManifest: () => Promise<GensManifest | null>,
  localNeighbors: (ids: number[], id: number) => { prev: number | null; next: number | null },
): Promise<CorpusNeighbors> {
  const ids = await loadAvail(gen);
  const local = localNeighbors(ids, id);
  let prev: CorpusNeighbor | null = local.prev !== null ? { gen, id: local.prev } : null;
  let next: CorpusNeighbor | null = local.next !== null ? { gen, id: local.next } : null;

  if (prev !== null && next !== null) return { prev, next };

  const manifest = await loadManifest();
  if (manifest === null) return { prev, next };

  if (prev === null) {
    let cursor = prevGenEntry(manifest, gen);
    while (cursor !== null) {
      const cIds = await loadAvail(cursor.gen);
      if (cIds.length > 0) {
        prev = { gen: cursor.gen, id: cIds[cIds.length - 1] as number };
        break;
      }
      cursor = prevGenEntry(manifest, cursor.gen);
    }
  }

  if (next === null) {
    let cursor = nextGenEntry(manifest, gen);
    while (cursor !== null) {
      const cIds = await loadAvail(cursor.gen);
      if (cIds.length > 0) {
        next = { gen: cursor.gen, id: cIds[0] as number };
        break;
      }
      cursor = nextGenEntry(manifest, cursor.gen);
    }
  }

  return { prev, next };
}
