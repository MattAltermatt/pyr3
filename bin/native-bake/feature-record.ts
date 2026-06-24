// bin/native-bake/feature-record.ts
// Genome → FeatureRecord for the pyr3-native gen (#435). Variation bitset +
// xform count come straight from the genome; the four stats are computed by
// the caller from a draft render (same path as bin/pyr3-bake-features.ts).
//
// NOTE on the variation field: the in-memory `Variation` produced by
// `genomeFromJson` (src/serialize.ts) carries a numeric `.index` (the catalog
// index, V0..V322) — NOT a `.name` string (the JSON external shape uses
// `name`, but it is mapped to `index` on parse). So the real bake path feeds us
// `.index` directly. We read `.index` when present (already a catalog index)
// and fall back to a `.name` → `V` lookup for name-shaped variation objects.
import { V } from '../../src/variations';
import type { FeatureRecord } from '../../src/feature-index';
import type { Genome } from '../../src/genome';

const NAME_TO_INDEX = V as unknown as Record<string, number>;

/** Sorted, deduped catalog indices of every variation used across all xforms.
 *  Reads each variation's numeric `.index` (the in-memory `Variation` shape
 *  from `genomeFromJson`); falls back to a `.name` → catalog-index lookup for
 *  name-shaped objects. Unknown names are skipped. */
export function genomeVariationIndices(g: Genome): number[] {
  const set = new Set<number>();
  for (const xf of g.xforms ?? []) {
    for (const v of xf.variations ?? []) {
      const anyV = v as unknown as { index?: number; name?: string };
      if (typeof anyV.index === 'number') {
        set.add(anyV.index);
        continue;
      }
      if (typeof anyV.name === 'string') {
        const idx = NAME_TO_INDEX[anyV.name];
        if (typeof idx === 'number') set.add(idx);
      }
    }
  }
  return [...set].sort((a, b) => a - b);
}

export interface Stats { coverage: number; meanLum: number; entropy: number; colorVar: number; }

export function buildFeatureRecord(gen: number, id: number, g: Genome, stats: Stats): FeatureRecord {
  return {
    gen, id,
    variations: genomeVariationIndices(g),
    xforms: (g.xforms ?? []).length,
    coverage: stats.coverage,
    meanLum: stats.meanLum,
    entropy: stats.entropy,
    colorVar: stats.colorVar,
  };
}
