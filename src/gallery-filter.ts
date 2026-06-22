// FilterSpec — pure logic for the gallery's filter state (#49). Owned
// by the gallery surface; consumed by gallery-mount, gallery-facets,
// load-intent, and gallery-filter-ui.
//
// The URL is the single source of truth for filter state. parseFilterSpec
// is forgiving (unknown values silently fall back to defaults);
// encodeFilterSpec emits only non-default axes (clean canonical URLs).

import { V, VARIATION_NAMES } from './variations';
import type { ScoreWeights } from './feature-score';

// Reverse lookup name → index. VARIATION_NAMES is index → name; the URL
// parser needs the inverse. Built once at module load.
const NAME_TO_INDEX: Map<string, number> = new Map(
  Object.entries(V).map(([name, idx]) => [name, idx as number]),
);

export type SortMode = 'time' | 'interest' | 'coverage' | 'entropy' | 'colorVar' | 'meanLum' | 'custom';

/** All sort modes the gallery exposes. Ordered as they appear in the
 *  drawer's segmented control (time first = default; custom last — the UI
 *  treats it specially: there's no "click me" pill, the tune panel toggles
 *  it on when the visitor edits weights). */
export const SORT_MODES: readonly SortMode[] = Object.freeze([
  'time', 'interest', 'coverage', 'entropy', 'colorVar', 'meanLum', 'custom',
]) as readonly SortMode[];

export type SortDir = 'asc' | 'desc';

/** The four 0..1 stat axes from features.flam3idx that the gallery can
 *  filter on. Same range/from-to UX as xforms; the stat name appears in
 *  the URL param. Used by parse/encode/equals + the master-list build +
 *  the drawer's UI rows. */
export const STAT_AXES = ['coverage', 'entropy', 'colorVar', 'meanLum'] as const;
export type StatAxis = (typeof STAT_AXES)[number];

export interface FilterSpec {
  sort: SortMode;
  /** Sort direction. For weighted-stat sorts (interest/coverage/entropy/
   *  colorVar/meanLum), `desc` puts the highest-scoring flames first.
   *  For `time`, `desc` is reverse-chronological (newest first) and
   *  `asc` is canonical chronological (oldest first). Default `desc`. */
  sortDir: SortDir;
  /** Variation indices, AND semantics across the set. Sorted ascending
   *  as a class invariant for canonical URL emission + structural equality. */
  vars: number[];
  /** Inclusive lower bound on xform count. Required, defaults to 1. */
  xformMin: number;
  /** Inclusive upper bound on xform count, or null for "no upper cap". */
  xformMax: number | null;
  /** Stat-range filters — same shape as xform, in 0..1 float space.
   *  Default min=0 (no lower cap effect); default max=null (no upper cap). */
  coverageMin: number;
  coverageMax: number | null;
  entropyMin: number;
  entropyMax: number | null;
  colorVarMin: number;
  colorVarMax: number | null;
  meanLumMin: number;
  meanLumMax: number | null;
  /** Tunable interest-score weights. ONLY meaningful when `sort === 'custom'`;
   *  for every other sort mode the canonical preset weights apply and this
   *  field is `null`. URL grammar: `weights=cov,ent,col,dim` (4 floats in
   *  [0,1]). When `sort=custom` but weights are missing/malformed, callers
   *  treat null as DEFAULT_SCORE_WEIGHTS. */
  weights: ScoreWeights | null;
}

export const DEFAULT_FILTER_SPEC: FilterSpec = Object.freeze({
  sort: 'time' as SortMode,
  sortDir: 'desc' as SortDir,
  vars: Object.freeze([]) as unknown as number[],
  xformMin: 1,
  xformMax: null,
  coverageMin: 0,
  coverageMax: null,
  entropyMin: 0,
  entropyMax: null,
  colorVarMin: 0,
  colorVarMax: null,
  meanLumMin: 0,
  meanLumMax: null,
  weights: null,
}) as FilterSpec;

const WEIGHTS_EPS = 1e-9;

/** Epsilon-tolerant ScoreWeights comparison. Handles the URL round-trip
 *  drift (parseFloat(toFixed(3))) so a spec re-loaded from URL still
 *  compares equal to the in-memory original. Null compares equal to null. */
export function weightsEqual(a: ScoreWeights | null, b: ScoreWeights | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (
    Math.abs(a.coverage - b.coverage) <= WEIGHTS_EPS
    && Math.abs(a.entropy - b.entropy) <= WEIGHTS_EPS
    && Math.abs(a.colorVar - b.colorVar) <= WEIGHTS_EPS
    && Math.abs(a.dimPenalty - b.dimPenalty) <= WEIGHTS_EPS
  );
}

/** Structural equality: same sort, same xform bounds, same set of variations.
 *  Vars are kept sorted asc as a class invariant — direct compare suffices. */
export function filterSpecEquals(a: FilterSpec, b: FilterSpec): boolean {
  if (a.sort !== b.sort) return false;
  if (a.sortDir !== b.sortDir) return false;
  if (a.xformMin !== b.xformMin) return false;
  if (a.xformMax !== b.xformMax) return false;
  if (a.coverageMin !== b.coverageMin || a.coverageMax !== b.coverageMax) return false;
  if (a.entropyMin !== b.entropyMin || a.entropyMax !== b.entropyMax) return false;
  if (a.colorVarMin !== b.colorVarMin || a.colorVarMax !== b.colorVarMax) return false;
  if (a.meanLumMin !== b.meanLumMin || a.meanLumMax !== b.meanLumMax) return false;
  if (!weightsEqual(a.weights, b.weights)) return false;
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
  const rawSort = params.get('sort');
  if (rawSort !== null && (SORT_MODES as readonly string[]).includes(rawSort)) {
    sort = rawSort as SortMode;
  }

  let sortDir: SortDir = 'desc';
  if (params.get('order') === 'asc') sortDir = 'asc';

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

  const stat = (name: StatAxis): { min: number; max: number | null } => {
    const raw = params.get(name);
    if (!raw) return { min: 0, max: null };
    const dash = raw.indexOf('-');
    if (dash !== -1) {
      const lhs = raw.slice(0, dash);
      const rhs = raw.slice(dash + 1);
      let lo = Number.parseFloat(lhs);
      let hi: number | null = null;
      if (!Number.isFinite(lo)) lo = 0;
      lo = Math.max(0, Math.min(1, lo));
      if (rhs && rhs !== 'all') {
        const h = Number.parseFloat(rhs);
        if (Number.isFinite(h)) hi = Math.max(0, Math.min(1, h));
      }
      if (hi !== null && lo > hi) [lo, hi] = [hi, lo];
      return { min: lo, max: hi };
    }
    // Bare float `coverage=0.5` → ≥0.5 (open above), mirroring xforms semantics.
    const lo = Number.parseFloat(raw);
    if (Number.isFinite(lo) && lo > 0) {
      return { min: Math.max(0, Math.min(1, lo)), max: null };
    }
    return { min: 0, max: null };
  };

  const cov = stat('coverage');
  const ent = stat('entropy');
  const col = stat('colorVar');
  const lum = stat('meanLum');

  // Weights are ONLY honored when sort=custom. For named presets the canonical
  // weights apply; explicit `weights=` is ignored to keep the URL grammar
  // unambiguous ("preset name + tuple" can't disagree).
  let weights: ScoreWeights | null = null;
  if (sort === 'custom') {
    const raw = params.get('weights');
    if (raw) {
      const parts = raw.split(',');
      if (parts.length === 4) {
        const nums = parts.map((s) => Number.parseFloat(s));
        if (nums.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) {
          weights = {
            coverage: nums[0]!,
            entropy: nums[1]!,
            colorVar: nums[2]!,
            dimPenalty: nums[3]!,
          };
        }
      }
    }
  }

  return {
    sort, sortDir, vars, xformMin, xformMax,
    coverageMin: cov.min, coverageMax: cov.max,
    entropyMin: ent.min, entropyMax: ent.max,
    colorVarMin: col.min, colorVarMax: col.max,
    meanLumMin: lum.min, meanLumMax: lum.max,
    weights,
  };
}

/** Encode a FilterSpec into URLSearchParams. Default axes are OMITTED so
 *  a clean canonical-order browse stays at /v1/gallery/p/N with no
 *  querystring. */
export function encodeFilterSpec(spec: FilterSpec): URLSearchParams {
  const p = new URLSearchParams();
  if (spec.sort !== 'time') p.set('sort', spec.sort);
  if (spec.sortDir !== 'desc') p.set('order', spec.sortDir);
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
  /** Stat-range emission — same compact grammar as xforms but in 0..1
   *  floats. Default min=0 + max=null omits the param entirely. Values
   *  serialize with up to 3 sig figs after the decimal to keep URLs tidy
   *  while preserving the picker's 0.1-step resolution. */
  const fmt = (v: number): string => Number.parseFloat(v.toFixed(3)).toString();
  const emitStat = (name: StatAxis, lo: number, hi: number | null): void => {
    if (lo === 0 && hi === null) return;
    if (hi === null) p.set(name, fmt(lo));
    else p.set(name, `${fmt(lo)}-${fmt(hi)}`);
  };
  emitStat('coverage', spec.coverageMin, spec.coverageMax);
  emitStat('entropy', spec.entropyMin, spec.entropyMax);
  emitStat('colorVar', spec.colorVarMin, spec.colorVarMax);
  emitStat('meanLum', spec.meanLumMin, spec.meanLumMax);
  // Weights emit ONLY when sort=custom AND weights are non-null. Named presets
  // imply their canonical weights; explicit `weights=` would be ambiguous + is
  // stripped on parse.
  if (spec.sort === 'custom' && spec.weights !== null) {
    const w = spec.weights;
    p.set('weights', `${fmt(w.coverage)},${fmt(w.entropy)},${fmt(w.colorVar)},${fmt(w.dimPenalty)}`);
  }
  return p;
}
