// FilterSpec — pure logic for the gallery's filter state (#49). Owned
// by the gallery surface; consumed by gallery-mount, gallery-facets,
// load-intent, and gallery-filter-ui.
//
// The URL is the single source of truth for filter state. parseFilterSpec
// is forgiving (unknown values silently fall back to defaults);
// encodeFilterSpec emits only non-default axes (clean canonical URLs).

import { V, VARIATION_NAMES } from './variations';

// Reverse lookup name → index. VARIATION_NAMES is index → name; the URL
// parser needs the inverse. Built once at module load.
const NAME_TO_INDEX: Map<string, number> = new Map(
  Object.entries(V).map(([name, idx]) => [name, idx as number]),
);

export type SortMode = 'time' | 'interest';

export interface FilterSpec {
  sort: SortMode;
  /** Variation indices, AND semantics across the set. Sorted ascending
   *  as a class invariant for canonical URL emission + structural equality. */
  vars: number[];
  /** Inclusive lower bound on xform count. Required, defaults to 1. */
  xformMin: number;
  /** Inclusive upper bound on xform count, or null for "no upper cap". */
  xformMax: number | null;
}

export const DEFAULT_FILTER_SPEC: FilterSpec = Object.freeze({
  sort: 'time' as SortMode,
  vars: Object.freeze([]) as unknown as number[],
  xformMin: 1,
  xformMax: null,
}) as FilterSpec;

/** Structural equality: same sort, same xform bounds, same set of variations.
 *  Vars are kept sorted asc as a class invariant — direct compare suffices. */
export function filterSpecEquals(a: FilterSpec, b: FilterSpec): boolean {
  if (a.sort !== b.sort) return false;
  if (a.xformMin !== b.xformMin) return false;
  if (a.xformMax !== b.xformMax) return false;
  if (a.vars.length !== b.vars.length) return false;
  for (let i = 0; i < a.vars.length; i++) {
    if (a.vars[i] !== b.vars[i]) return false;
  }
  return true;
}

/** True when every axis matches the default — used to decide whether to
 *  emit a querystring at all (and whether the drawer auto-opens). */
export function isDefaultFilterSpec(spec: FilterSpec): boolean {
  return filterSpecEquals(spec, DEFAULT_FILTER_SPEC);
}

/** Parse a URLSearchParams into a FilterSpec. Forgiving: unknown values
 *  silently fall back to the default for that axis. Never throws. */
export function parseFilterSpec(params: URLSearchParams): FilterSpec {
  let sort: SortMode = 'time';
  if (params.get('sort') === 'interest') sort = 'interest';

  const vars: number[] = [];
  const varsParam = params.get('vars');
  if (varsParam) {
    const seen = new Set<number>();
    const dropped: string[] = [];
    for (const name of varsParam.split(',')) {
      const idx = NAME_TO_INDEX.get(name);
      if (idx !== undefined && !seen.has(idx)) {
        seen.add(idx);
        vars.push(idx);
      } else if (idx === undefined && name.length > 0) {
        dropped.push(name);
      }
    }
    vars.sort((a, b) => a - b);
    if (dropped.length > 0 && typeof console !== 'undefined') {
      console.warn(
        `pyr3 gallery filter: unknown variation name(s) dropped from URL: ${dropped.join(', ')}`,
      );
    }
  }

  let xformMin = 1;
  let xformMax: number | null = null;
  const xformsParam = params.get('xforms');
  if (xformsParam) {
    const dash = xformsParam.indexOf('-');
    if (dash !== -1) {
      const lhs = xformsParam.slice(0, dash);
      const rhs = xformsParam.slice(dash + 1);
      const lo = Number.parseInt(lhs, 10);
      if (Number.isFinite(lo)) xformMin = Math.max(1, lo);
      if (rhs && rhs !== 'all') {
        const hi = Number.parseInt(rhs, 10);
        if (Number.isFinite(hi) && hi >= 1) xformMax = hi;
      }
      if (xformMax !== null && xformMin > xformMax) {
        [xformMin, xformMax] = [xformMax, xformMin];
      }
    } else {
      // Bare integer — open-ended above. `xforms=6` means "≥6 xforms"
      // (min=6, max=null). The natural URL reading: "give me complex
      // flames starting at 6 xforms." Exact match stays explicit as
      // `xforms=6-6` (a single-value closed range).
      const lo = Number.parseInt(xformsParam, 10);
      if (Number.isFinite(lo) && lo >= 1) {
        xformMin = lo;
        xformMax = null;
      }
    }
  }

  return { sort, vars, xformMin, xformMax };
}

/** Encode a FilterSpec into URLSearchParams. Default axes are OMITTED so
 *  a clean canonical-order browse stays at /v1/gallery/p/N with no
 *  querystring. */
export function encodeFilterSpec(spec: FilterSpec): URLSearchParams {
  const p = new URLSearchParams();
  if (spec.sort !== 'time') p.set('sort', spec.sort);
  if (spec.vars.length > 0) {
    const names = spec.vars
      .map((i) => VARIATION_NAMES[i])
      .filter((n): n is string => typeof n === 'string')
      .sort();
    p.set('vars', names.join(','));
  }
  if (spec.xformMin !== 1 || spec.xformMax !== null) {
    if (spec.xformMax === null) {
      // Open-ended above — compact bare form. `xforms=6` reads as ≥6.
      p.set('xforms', String(spec.xformMin));
    } else {
      p.set('xforms', `${spec.xformMin}-${spec.xformMax}`);
    }
  }
  return p;
}
