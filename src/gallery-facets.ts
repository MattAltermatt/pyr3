// Faceted "leave-one-out" counts for the gallery filter drawer. The picker
// UIs show, for each candidate value on an axis, how many flames would
// remain if that value were added — but the candidate's own axis is NOT
// applied so the picker can show counts even for the currently-selected
// values.

import type { FilterSpec } from './gallery-filter';
import type { FeatureIndex } from './feature-index-client';
import type { FeatureRecord } from './feature-index';

/** Internal helper: do all of `spec`'s filters pass on `rec`, EXCEPT the
 *  axes named in `exclude`? Used to power leave-one-out facet counts.
 *  Variation AND semantics across spec.vars. */
function passesFilters(
  rec: FeatureRecord,
  spec: FilterSpec,
  exclude: {
    vars?: boolean;
    xforms?: boolean;
    coverage?: boolean;
    entropy?: boolean;
    colorVar?: boolean;
    meanLum?: boolean;
  },
): boolean {
  if (!exclude.vars) {
    for (const v of spec.vars) {
      if (!rec.variations.includes(v)) return false;
    }
  }
  if (!exclude.xforms) {
    if (rec.xforms < spec.xformMin) return false;
    if (spec.xformMax !== null && rec.xforms > spec.xformMax) return false;
  }
  if (!exclude.coverage) {
    if (rec.coverage < spec.coverageMin) return false;
    if (spec.coverageMax !== null && rec.coverage > spec.coverageMax) return false;
  }
  if (!exclude.entropy) {
    if (rec.entropy < spec.entropyMin) return false;
    if (spec.entropyMax !== null && rec.entropy > spec.entropyMax) return false;
  }
  if (!exclude.colorVar) {
    if (rec.colorVar < spec.colorVarMin) return false;
    if (spec.colorVarMax !== null && rec.colorVar > spec.colorVarMax) return false;
  }
  if (!exclude.meanLum) {
    if (rec.meanLum < spec.meanLumMin) return false;
    if (spec.meanLumMax !== null && rec.meanLum > spec.meanLumMax) return false;
  }
  return true;
}

/** Decile bucket for a stat value in [0, 1]. Returns 0..9 — `v=0.0` → 0,
 *  `v=0.05` → 0, `v=0.55` → 5, `v=1.0` → 9 (the 9th decile is [0.9, 1.0]
 *  inclusive of the upper edge so values exactly at 1.0 don't fall off). */
function statDecile(v: number): number {
  return Math.min(9, Math.max(0, Math.floor(v * 10)));
}

/** Collapse any xform_count ≥ 14 into bucket key 14 — the UI's "14+" cell.
 *  Buckets keep the per-value resolution for 1..13. Threshold chosen to
 *  match the measured corpus distribution (p95=14, p99=17); values ≥14 are
 *  <3% combined, so collapsing them into a single tail bucket keeps the
 *  count strip compact while preserving signal on the common cases. */
function xformBucket(n: number): number {
  return n >= 14 ? 14 : n;
}

export interface FacetCounts {
  /** variation index → count of flames having THIS variation among the
   *  set that passes ALL OTHER filters (variation axis excluded). */
  variations: Map<number, number>;
  /** xform bucket (1..13, or 14 for 14+) → count of flames having THIS
   *  xform count among the set that passes ALL OTHER filters (xform
   *  axis excluded). */
  xforms: Map<number, number>;
  /** Decile bucket (0..9) → count of flames whose `coverage` stat falls
   *  in that decile among the set that passes ALL OTHER filters (the
   *  coverage axis itself is excluded — leave-one-out). Bucket 0 is
   *  `[0.0, 0.1)`, bucket 9 is `[0.9, 1.0]`. */
  coverage: Map<number, number>;
  /** Same shape as `coverage` for the `entropy` stat axis. */
  entropy: Map<number, number>;
  /** Same shape as `coverage` for the `colorVar` stat axis. */
  colorVar: Map<number, number>;
  /** Same shape as `coverage` for the `meanLum` stat axis. */
  meanLum: Map<number, number>;
  /** Number of records matching ALL active filters — drives the "0 of N"
   *  empty-state and the total page count. */
  total: number;
}

export function computeFacetCounts(
  index: FeatureIndex,
  spec: FilterSpec,
): FacetCounts {
  const variations = new Map<number, number>();
  const xforms = new Map<number, number>();
  const coverage = new Map<number, number>();
  const entropy = new Map<number, number>();
  const colorVar = new Map<number, number>();
  const meanLum = new Map<number, number>();
  let total = 0;

  index.forEachRecord((rec) => {
    // Variations axis: include rec iff ALL filters pass (the candidate
    // variation logically extends spec.vars by one; for any v already in
    // spec.vars the count equals the post-filter subset size, and for any
    // v outside spec.vars it counts how many of the current subset also
    // have v — both fall out of "walk the fully-filtered subset and bump
    // each rec's variations").
    if (passesFilters(rec, spec, {})) {
      for (const v of rec.variations) {
        variations.set(v, (variations.get(v) ?? 0) + 1);
      }
    }
    // Xforms axis: include rec iff every OTHER filter passes (leave-one-out
    // on the xform range so the picker shows non-zero counts even for
    // buckets outside the currently-selected range).
    if (passesFilters(rec, spec, { xforms: true })) {
      const k = xformBucket(rec.xforms);
      xforms.set(k, (xforms.get(k) ?? 0) + 1);
    }
    // Stat axes: leave-one-out on each axis's own range — the picker
    // strip needs to show what would happen if the user moved its slider.
    if (passesFilters(rec, spec, { coverage: true })) {
      const k = statDecile(rec.coverage);
      coverage.set(k, (coverage.get(k) ?? 0) + 1);
    }
    if (passesFilters(rec, spec, { entropy: true })) {
      const k = statDecile(rec.entropy);
      entropy.set(k, (entropy.get(k) ?? 0) + 1);
    }
    if (passesFilters(rec, spec, { colorVar: true })) {
      const k = statDecile(rec.colorVar);
      colorVar.set(k, (colorVar.get(k) ?? 0) + 1);
    }
    if (passesFilters(rec, spec, { meanLum: true })) {
      const k = statDecile(rec.meanLum);
      meanLum.set(k, (meanLum.get(k) ?? 0) + 1);
    }
    // Total: respect ALL filters.
    if (passesFilters(rec, spec, {})) total++;
  });

  return { variations, xforms, coverage, entropy, colorVar, meanLum, total };
}
