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

/** Pick `n` primaries spread across the eligible pool. For n <= pool size the
 *  picks are all-distinct (a shuffle prefix), so a batch never clumps on one
 *  variation; for n > pool size it cycles reshuffled passes. */
export function pickStratifiedPrimaries(rng: () => number, n: number): VariationIndex[] {
  const out: VariationIndex[] = [];
  while (out.length < n) {
    const pass = shuffled(rng, PRIMARY_ELIGIBLE);
    for (const idx of pass) {
      out.push(idx);
      if (out.length === n) break;
    }
  }
  return out;
}
