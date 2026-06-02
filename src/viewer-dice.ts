// Viewer-side 🎲 surprise-me picker (#23). Picks a flame from the full
// corpus, biased toward high-interestingness scores.
//
// Why not the curated 55-fixture showcase set: a corpus-wide draw weighted
// by the same interestingness scoring the gallery uses gives ~5,000 elite
// flames instead of 55 hand-picked, and integrates with the per-session
// feature-index cache (loadFeatureIndex) the gallery already pays for.
// The user picked top 10% / 80-20 elite/explore split (2026-06-01).
//
// Pool composition (computed once per session on first dice click):
//   elite   = top 10% by interestScore (≥ ~0.665 with default weights)
//   explore = remaining 90%, MINUS bottom 5% (mostly bare/empty fractals)
// Each click: rng() < 0.80 → pick from elite, else from explore. Uniform
// within each pool. Sibling of the gallery 🎲 (which is uniform over the
// whole corpus, no weighting).

import { interestScore } from './feature-score';
import { loadFeatureIndex, type FeatureIndex } from './feature-index-client';
import type { SheepRef } from './feature-index';

/** Top fraction of the score-sorted corpus that lands in the elite pool. */
export const ELITE_FRACTION = 0.10;
/** Bottom fraction of the score-sorted corpus excluded entirely from the
 *  explore pool (mostly bare/empty/broken fractals — no upside in surfacing
 *  them via the dice). */
export const EXPLORE_BOTTOM_EXCLUDE = 0.05;
/** Probability the next dice click pulls from the elite pool (vs explore). */
export const ELITE_BIAS = 0.80;

export interface DicePools {
  /** SheepRefs in score-descending order; first ELITE_FRACTION of the
   *  corpus. Empty when the feature index is unavailable. */
  elite: readonly SheepRef[];
  /** SheepRefs in score-descending order; the middle slice between elite
   *  and the bottom-EXPLORE_BOTTOM_EXCLUDE cutoff. */
  explore: readonly SheepRef[];
}

/** Split a score-sorted (descending) list into elite + explore pools per
 *  the constants above. Exported for test coverage. */
export function partitionPools(scoredDesc: readonly SheepRef[]): DicePools {
  const n = scoredDesc.length;
  if (n === 0) return { elite: [], explore: [] };
  const eliteEnd = Math.max(1, Math.floor(n * ELITE_FRACTION));
  const exploreEnd = Math.max(eliteEnd, Math.floor(n * (1 - EXPLORE_BOTTOM_EXCLUDE)));
  return {
    elite: scoredDesc.slice(0, eliteEnd),
    explore: scoredDesc.slice(eliteEnd, exploreEnd),
  };
}

/** Build the pools from a loaded feature index. Allocates one SheepRef per
 *  record; the result is cached at the module level. */
export function buildPools(index: FeatureIndex): DicePools {
  if (index.recordCount === 0) return { elite: [], explore: [] };
  const scored: Array<{ ref: SheepRef; score: number }> = [];
  index.forEachRecord((rec) => {
    scored.push({ ref: { gen: rec.gen, id: rec.id }, score: interestScore(rec) });
  });
  scored.sort((a, b) => b.score - a.score);
  return partitionPools(scored.map((s) => s.ref));
}

let cachedPools: Promise<DicePools> | null = null;

/** Test-only: reset the module-level pool cache so the next call rebuilds. */
export function _resetDicePoolCache(): void {
  cachedPools = null;
}

/**
 * Pick the next surprise flame. First call awaits the feature index +
 * builds the pools; subsequent calls are synchronous-cheap (one rng() roll,
 * one array index).
 *
 * `rng` defaults to `Math.random` but is injectable for deterministic tests.
 * `loadIndex` defaults to the production cached loader; injectable for tests.
 *
 * Returns null when the feature index is empty (deploy in flight, fetch
 * failure, etc.) — caller should treat null as a no-op so the dice click
 * never crashes the viewer.
 */
export async function pickSurpriseFlame(
  rng: () => number = Math.random,
  loadIndex: () => Promise<FeatureIndex> = loadFeatureIndex,
): Promise<SheepRef | null> {
  if (cachedPools === null) {
    cachedPools = loadIndex().then(buildPools);
  }
  const pools = await cachedPools;
  return pickFromPools(pools, rng);
}

/** Sync core of pickSurpriseFlame: roll once for elite-vs-explore, roll
 *  again to pick within that pool. If the chosen pool is empty, fall back
 *  to the other. Returns null only when BOTH pools are empty. Exported for
 *  unit coverage of the bias logic in isolation. */
export function pickFromPools(pools: DicePools, rng: () => number): SheepRef | null {
  const { elite, explore } = pools;
  if (elite.length === 0 && explore.length === 0) return null;
  const fromElite = rng() < ELITE_BIAS;
  const pool = fromElite
    ? (elite.length > 0 ? elite : explore)
    : (explore.length > 0 ? explore : elite);
  const idx = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  return pool[idx] ?? null;
}
