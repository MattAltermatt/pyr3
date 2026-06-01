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
  exclude: { vars?: boolean; xforms?: boolean },
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
  return true;
}

/** Collapse any xform_count ≥ 10 into bucket key 10 — the UI's "10+" cell.
 *  Buckets keep the per-value resolution for 1..9. */
function xformBucket(n: number): number {
  return n >= 10 ? 10 : n;
}

export interface FacetCounts {
  /** variation index → count of flames having THIS variation among the
   *  set that passes ALL OTHER filters (variation axis excluded). */
  variations: Map<number, number>;
  /** xform bucket (1..9, or 10 for 10+) → count of flames having THIS
   *  xform count among the set that passes ALL OTHER filters (xform
   *  axis excluded). */
  xforms: Map<number, number>;
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
    // Total: respect ALL filters.
    if (passesFilters(rec, spec, {})) total++;
  });

  return { variations, xforms, total };
}
