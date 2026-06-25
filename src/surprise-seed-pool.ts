// src/surprise-seed-pool.ts
//
// Eligibility pool for the Surprise Wall's diverse seed generator. The editor's
// generateRandomGenome draws primaries from just 31 curated variations; the wall's
// whole job is novelty, so we broaden to a categorically-filtered pool (brave-ish)
// and lean on the post-render cull to drop whatever renders degenerate.
//
// "Primary-eligible" = forms coherent structure as the dominant variation of an
// xform. We START from all V0..V322 and exclude only categorical mis-fits:
//   - direct-color variations (DC_VARIATION_SET) — deposit position (0,0) for some,
//     and color-from-position rather than shape; wrong as a sole spatial primary.
//   - pure blur / scatter variations — no spatial structure as a lead.
// The cull backstops anything else.

import { V, DC_VARIATION_SET, type VariationIndex } from './variations';

/** Pure blur / scatter / degenerate-as-primary variations (no spatial structure
 *  when used as the dominant variation). Hand-listed — these still work fine as
 *  *secondary* blends, just not as a batch's lead shape. */
export const SURPRISE_PRIMARY_EXCLUDE: ReadonlySet<number> = new Set<number>([
  V.noise, V.blur, V.gaussian_blur, V.pre_blur, V.blur_circle, V.circleblur,
  V.rays, V.blade, V.twintrian, V.square, V.arch,
]);

const VARIATION_COUNT = 323; // V0..V322 (src/variations.ts:633)

/** Broadened primary pool: every variation index that is neither direct-color
 *  nor a pure blur/scatter. ~300 entries (vs the legacy 31). */
export const PRIMARY_ELIGIBLE: readonly VariationIndex[] = Array.from(
  { length: VARIATION_COUNT },
  (_, i) => i as VariationIndex,
).filter((i) => !DC_VARIATION_SET.has(i) && !SURPRISE_PRIMARY_EXCLUDE.has(i));

/** Fisher–Yates shuffle of a COPY, driven by the injected rng (deterministic). */
function shuffled<T>(rng: () => number, src: readonly T[]): T[] {
  const a = src.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Options for steering the per-genome PRIMARY (lead) variation toward a
 *  caller-supplied preferred set. Both modes force the lead from `preferred`
 *  (stratified, so a batch spans the set); they differ only in the BLEND pool,
 *  which the caller handles (#450):
 *  - `only`:     whole flame restricted to `preferred`.
 *  - `featured`: lead is `preferred`, blends/rest are broad → featured + diverse.
 *  Both fall back to the broad pool when `preferred` is empty/undefined, so the
 *  wall is never empty. */
export interface PickPrimariesOptions {
  preferred?: number[];
  preferMode?: 'featured' | 'only';
}

/** Pick `n` primaries spread across the eligible pool. For n <= pool size the
 *  picks are all-distinct (a shuffle prefix), so a batch never clumps on one
 *  variation; for n > pool size it cycles reshuffled passes.
 *
 *  With `opts`, the primary is steered toward a preferred variation set —
 *  both `only` and `featured` force it from `preferred` (#450). Absent `opts`,
 *  behavior is the original broad-pool stratification, unchanged. */
export function pickStratifiedPrimaries(
  rng: () => number,
  n: number,
  opts?: PickPrimariesOptions,
): VariationIndex[] {
  const preferred = (opts?.preferred ?? []) as VariationIndex[];
  const mode = opts?.preferMode;

  // Both 'only' and 'featured' force the lead from the preferred set (stratified
  // so a batch spans it); they diverge only in the blend pool, handled by the
  // caller (#450). Guard: empty preferred falls back to the broad pool so the
  // wall is never empty.
  if ((mode === 'only' || mode === 'featured') && preferred.length > 0) {
    return stratify(rng, n, preferred);
  }

  // absent / fallback: original broad-pool stratification, unchanged.
  return stratify(rng, n, PRIMARY_ELIGIBLE);
}

/** Stratified prefix of `n` indices drawn from `pool` via reshuffled passes
 *  (all-distinct for n <= pool size; cycles for n > pool size). */
function stratify(rng: () => number, n: number, pool: readonly VariationIndex[]): VariationIndex[] {
  const out: VariationIndex[] = [];
  while (out.length < n) {
    const pass = shuffled(rng, pool);
    for (const idx of pass) {
      out.push(idx);
      if (out.length === n) break;
    }
  }
  return out;
}
