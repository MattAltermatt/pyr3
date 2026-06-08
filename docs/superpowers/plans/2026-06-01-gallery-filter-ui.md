# Gallery filter UI — Implementation Plan (#49)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `/v1/gallery` 3×3 grid from a flat sequential walk into a real discovery surface — variation/xform filters + sort-by-interest, with URL state, a collapsible drawer, and faceted "leave-one-out" live counts.

**Architecture:** Filter state lives in the URL; the gallery mount loads `features.flam3idx` once at start, then a single `applyFilter(spec)` entry point updates URL → rebuilds a per-mount master ref list → repaints the grid. Drawer + pickers are pure-DOM under `src/gallery-filter-ui.ts`; the data plumbing (FilterSpec parse/encode, page-of-sheep-filtered, computeFacetCounts) is pure logic under `src/gallery-filter.ts` + `src/gallery-facets.ts`. Three-phase ship: data layer → drawer + sort/xform UI → variation picker.

**Tech Stack:** TypeScript, WebGPU, Vite, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-01-gallery-filter-ui-design.md` (locked via brainstorm 2026-06-01)
**Branches:** `feature/issue-49-gallery-filter-phase-a`, `…-phase-b`, `…-phase-c` (one branch per phase)
**Issue:** #49 (v1.2 milestone — `gallery and discovery`)

---

## File structure

```text
file                                  role
------------------------------------- ----------------------------------------------
src/gallery-filter.ts                 NEW — FilterSpec types, URL parse/encode,
                                      defaults, equality. Pure logic.
src/gallery-filter.test.ts            NEW — Unit tests.
src/gallery-facets.ts                 NEW — computeFacetCounts (leave-one-out
                                      counts across variations + xform buckets).
src/gallery-facets.test.ts            NEW — Unit tests.
src/gallery-filter-ui.ts              NEW (Phase B) — mountFilterDrawer + sort/
                                      xform/reset controls + open/close state.
src/gallery-filter-ui.test.ts         NEW — Unit tests.
src/variation-picker.ts               NEW (Phase C) — mountVariationPicker (the
                                      3-group dropdown panel).
src/variation-picker.test.ts          NEW — Unit tests.
src/feature-index-client.ts           EXTENDED — add forEachRecord(visitor) so
                                      gallery-facets + master-list builder can
                                      walk the index without one-by-one get().
src/feature-index-client.test.ts      EXTENDED — forEachRecord coverage.
src/load-intent.ts                    EXTENDED — parseLoadIntent gallery shape
                                      gains `filter: FilterSpec`; galleryUrl
                                      takes optional filter arg.
src/load-intent.test.ts               EXTENDED — gallery filter URL round-trip.
src/gallery-mount.ts                  EXTENDED — pageOfSheepFiltered, master-
                                      list cache, mountGallery loads index
                                      once, totalPagesFiltered helper.
src/gallery-mount.test.ts             EXTENDED — filter-aware page math tests.
src/ui-bar.ts                         EXTENDED — gallery bar gains the
                                      `[⚙ filters ▾ (N active)]` pill + count
                                      badge wiring + onFilterToggle callback.
src/ui-bar.test.ts                    EXTENDED — pill present + badge math.
src/main.ts                           EXTENDED — gallery mount path threads
                                      FilterSpec through; popstate handler
                                      routes filter through; applyFilter wiring.
src/variations.ts                     UNCHANGED — VARIATION_NAMES already
                                      maps index→name; we build reverse map
                                      (name→index) inside gallery-filter.ts.
src/feature-score.ts                  UNCHANGED — interestScore() consumed by
                                      the master-list sort.
```

## Conventions (apply to every task)

- **Pre-commit gate:** `npm run typecheck && npm test` (~2s) must pass before each commit. Per-file vitest is OK during dev; `npm test` is the gate.
- **Branch identity:** per-repo `MattAltermatt <1435066+MattAltermatt@users.noreply.github.com>` (set in `.git/config` already).
- **Commit style:** one-line subject 50–72 chars, no body unless non-obvious, no trailers, no `Co-Authored-By`. Conventional-commit prefixes (`feat`/`fix`/`test`/`refactor`/`chore`).
- **No DOM in pure-logic modules.** `gallery-filter.ts`, `gallery-facets.ts`, helpers in `gallery-mount.ts` stay DOM-free.
- **Injectable side effects.** Where modules touch fetch / DOM / time, expose a dependency arg with a sensible default (mirrors `gallery-mount.ts:LoadAvailFn` pattern).
- **No emoji in commit messages.** (Emoji fine in chat + docs; per CLAUDE.md.)

---

## Plan expansion (2026-06-01, user-directive mid-Phase-A)

After Phase A's data layer landed, the user folded three additions
into #49 (instead of filing as sibling issues):

- **Named single-axis sort presets** — `coverage / entropy / colorVar
  / meanLum` alongside the original `time / interest`. 6 pills total.
- **Stat-range filters** — `from / to` range filters on the four 0..1
  stats (coverage, entropy, colorVar, meanLum), same UX as xform.
- **Tunable interest weights** — slider panel anchored to the
  interest pill. Button↔slider auto-link (clicking a preset pill =
  setting sliders to that preset; moving any slider away from a
  preset switches `sort` to `custom`).

The 3-phase plan expanded to **5 phases**, with B/C from the original
draft swapped (stat filters before the variation picker so the picker
lands on a stable substrate):

```text
A  Data layer + facets                                ✅ SHIPPED
B  Drawer scaffold + 6 sort preset pills + xform range + reset
C  Stat-range filters (coverage/entropy/colorVar/meanLum)
D  Variation picker (was Phase C in the original draft)
E  Tunable interest weights slider panel
```

The task lists below for old Phase B and old Phase C remain accurate
in spirit but need small revisions tracked here:

- **Phase B Task B3** (sort segmented) — expand from 2 pills to 6
  (named preset pills `time / interest / coverage / entropy /
  colorVar / meanLum`). Each pill commits the preset's weights when
  clicked; URL emits `sort=<name>`.
- **Phase B Task B4** (xform pickers) — expand `1..10+` range to
  `1..15` + `all`. Strip cells display `1..13` with `14+` collapse
  (per the corpus distribution measurement: p95=14, p99=17).
- **Phase C (NEW — stat-range filters)** — task list authored fresh
  at the bottom of this plan. Same `from/to + count-strip` shape as
  xform but for the four 0..1 stats.
- **Phase D** — what the original plan called "Phase C" (variation
  picker). Content below is correct; only the phase letter changes
  in headers + branch names.
- **Phase E (NEW — tunable interest weights)** — task list authored
  fresh at the bottom of this plan.

**Other Phase A bug fixes that landed during verify** (not in the
original plan but committed to the Phase A branch):
- Bare integer `xforms=N` semantic clarification (started as "exact
  match"; user redirected to "≥N open-ended above"). Final: `xforms=6`
  = `{min:6, max:null}`; `xforms=6-6` = exact.
- URL self-canonicalization: on parse, if any tokens were dropped
  (unknown variation names, malformed xforms), `replaceState` rewrites
  the URL to its canonical form. `console.warn` for dropped tokens.

---

## Phase A — Data layer + facets

**Branch:** `feature/issue-49-gallery-filter-phase-a`
**Outcome:** URL filter params round-trip; gallery walks the indexed subset; hand-typing `/v1/gallery?sort=interest&vars=julia` filters and re-sorts the grid. Drawer/pill don't exist yet. Visible UI looks identical when no filter is present.

### Task A1: Branch + FilterSpec module skeleton

**Files:**
- Create: `src/gallery-filter.ts`
- Create: `src/gallery-filter.test.ts`

- [ ] **Step 1: Create the feature branch from main**

```bash
git checkout main && git pull --ff-only
git checkout -b feature/issue-49-gallery-filter-phase-a
```

- [ ] **Step 2: Write the failing test for FilterSpec defaults + equality**

```ts
// src/gallery-filter.test.ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILTER_SPEC,
  filterSpecEquals,
  isDefaultFilterSpec,
  type FilterSpec,
} from './gallery-filter';

describe('FilterSpec defaults', () => {
  it('default spec is the canonical no-filter state', () => {
    expect(DEFAULT_FILTER_SPEC).toEqual({
      sort: 'time',
      vars: [],
      xformMin: 1,
      xformMax: null,
    });
  });

  it('isDefaultFilterSpec returns true for the default', () => {
    expect(isDefaultFilterSpec(DEFAULT_FILTER_SPEC)).toBe(true);
  });

  it('isDefaultFilterSpec returns false when any axis differs', () => {
    expect(isDefaultFilterSpec({ ...DEFAULT_FILTER_SPEC, sort: 'interest' })).toBe(false);
    expect(isDefaultFilterSpec({ ...DEFAULT_FILTER_SPEC, vars: [14] })).toBe(false);
    expect(isDefaultFilterSpec({ ...DEFAULT_FILTER_SPEC, xformMin: 2 })).toBe(false);
    expect(isDefaultFilterSpec({ ...DEFAULT_FILTER_SPEC, xformMax: 8 })).toBe(false);
  });

  it('filterSpecEquals compares structurally (vars order-independent)', () => {
    const a: FilterSpec = { sort: 'interest', vars: [3, 14], xformMin: 2, xformMax: 8 };
    const b: FilterSpec = { sort: 'interest', vars: [14, 3], xformMin: 2, xformMax: 8 };
    expect(filterSpecEquals(a, b)).toBe(true);
    expect(filterSpecEquals(a, { ...a, sort: 'time' })).toBe(false);
  });
});
```

- [ ] **Step 3: Run the failing test**

```bash
npx vitest run src/gallery-filter.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the module**

```ts
// src/gallery-filter.ts
// FilterSpec — pure logic for the gallery's filter state. Owned by the
// gallery surface (#49); consumed by gallery-mount, gallery-facets,
// load-intent, and gallery-filter-ui.
//
// The URL is the single source of truth for filter state. parseFilterSpec
// is forgiving (unknown values silently fall back to defaults); encode-
// FilterSpec emits only non-default axes (clean canonical URLs).

export type SortMode = 'time' | 'interest';

export interface FilterSpec {
  sort: SortMode;
  /** Variation indices, AND semantics across the set. Sorted ascending
   *  for canonical URL emission + structural equality. */
  vars: number[];
  /** Inclusive lower bound on xform count. Required, defaults to 1. */
  xformMin: number;
  /** Inclusive upper bound on xform count, or null for "no upper cap". */
  xformMax: number | null;
}

export const DEFAULT_FILTER_SPEC: FilterSpec = Object.freeze({
  sort: 'time',
  vars: [],
  xformMin: 1,
  xformMax: null,
}) as FilterSpec;

/** Structural equality: same sort, same xform bounds, same set of variations
 *  (order-independent). Used to short-circuit URL writes + master-list
 *  rebuilds. */
export function filterSpecEquals(a: FilterSpec, b: FilterSpec): boolean {
  if (a.sort !== b.sort) return false;
  if (a.xformMin !== b.xformMin) return false;
  if (a.xformMax !== b.xformMax) return false;
  if (a.vars.length !== b.vars.length) return false;
  // vars are kept sorted asc as a class invariant — direct compare suffices.
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
```

- [ ] **Step 5: Run the test — pass**

```bash
npx vitest run src/gallery-filter.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck + full unit suite + commit**

```bash
npm run typecheck && npm test
git add src/gallery-filter.ts src/gallery-filter.test.ts
git commit -m "feat(gallery-filter): FilterSpec module + defaults + structural equality"
```

### Task A2: FilterSpec URL parse/encode

**Files:**
- Modify: `src/gallery-filter.ts`
- Modify: `src/gallery-filter.test.ts`

- [ ] **Step 1: Add tests for parseFilterSpec + encodeFilterSpec round-trip**

```ts
// Append to src/gallery-filter.test.ts
import { parseFilterSpec, encodeFilterSpec } from './gallery-filter';
import { V } from './variations';

describe('parseFilterSpec', () => {
  function parse(qs: string) {
    return parseFilterSpec(new URLSearchParams(qs));
  }

  it('empty querystring → DEFAULT_FILTER_SPEC', () => {
    expect(parse('')).toEqual(DEFAULT_FILTER_SPEC);
  });

  it('sort=interest is honored', () => {
    expect(parse('sort=interest').sort).toBe('interest');
  });

  it('unknown sort value silently falls back to default', () => {
    expect(parse('sort=garbage').sort).toBe('time');
  });

  it('vars=julia,linear → sorted variation indices', () => {
    const out = parse('vars=julia,linear');
    expect(out.vars).toEqual([V.linear, V.julia].sort((a, b) => a - b));
  });

  it('vars with unknown name silently drops it', () => {
    const out = parse('vars=julia,not_a_real_variation');
    expect(out.vars).toEqual([V.julia]);
  });

  it('vars deduplicates within the param', () => {
    const out = parse('vars=julia,julia,linear');
    expect(out.vars).toEqual([V.linear, V.julia].sort((a, b) => a - b));
  });

  it('xforms=2-8 sets both bounds', () => {
    const out = parse('xforms=2-8');
    expect(out.xformMin).toBe(2);
    expect(out.xformMax).toBe(8);
  });

  it('xforms=2-all sets min only, max=null', () => {
    const out = parse('xforms=2-all');
    expect(out.xformMin).toBe(2);
    expect(out.xformMax).toBe(null);
  });

  it('xforms=2- (empty max) also means open-ended', () => {
    const out = parse('xforms=2-');
    expect(out.xformMin).toBe(2);
    expect(out.xformMax).toBe(null);
  });

  it('xforms=garbage silently falls back to defaults', () => {
    const out = parse('xforms=hello');
    expect(out.xformMin).toBe(1);
    expect(out.xformMax).toBe(null);
  });

  it('xforms with max<min auto-swaps', () => {
    const out = parse('xforms=8-2');
    expect(out.xformMin).toBe(2);
    expect(out.xformMax).toBe(8);
  });

  it('xformMin clamps to ≥ 1', () => {
    const out = parse('xforms=0-5');
    expect(out.xformMin).toBe(1);
  });
});

describe('encodeFilterSpec', () => {
  it('default spec → empty params', () => {
    const p = encodeFilterSpec(DEFAULT_FILTER_SPEC);
    expect(p.toString()).toBe('');
  });

  it('non-default sort emitted', () => {
    const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, sort: 'interest' });
    expect(p.get('sort')).toBe('interest');
  });

  it('vars emitted as comma-separated names, alphabetical', () => {
    const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, vars: [V.julia, V.linear] });
    expect(p.get('vars')).toBe('julia,linear');
  });

  it('xform range emits N-M when bounded', () => {
    const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, xformMin: 2, xformMax: 8 });
    expect(p.get('xforms')).toBe('2-8');
  });

  it('xform range emits N- when unbounded above', () => {
    const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, xformMin: 2, xformMax: null });
    expect(p.get('xforms')).toBe('2-');
  });

  it('xformMin=1 + xformMax=8 emits 1-8', () => {
    const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, xformMin: 1, xformMax: 8 });
    expect(p.get('xforms')).toBe('1-8');
  });
});

describe('FilterSpec round-trip', () => {
  it('parse(encode(spec)) === spec for various specs', () => {
    const specs: FilterSpec[] = [
      DEFAULT_FILTER_SPEC,
      { sort: 'interest', vars: [V.julia], xformMin: 1, xformMax: null },
      { sort: 'time', vars: [V.linear, V.julia, V.spherical].sort((a, b) => a - b), xformMin: 3, xformMax: 7 },
      { sort: 'interest', vars: [], xformMin: 2, xformMax: null },
    ];
    for (const s of specs) {
      const round = parseFilterSpec(encodeFilterSpec(s));
      expect(filterSpecEquals(round, s)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npx vitest run src/gallery-filter.test.ts
```

Expected: FAIL — `parseFilterSpec` + `encodeFilterSpec` not defined.

- [ ] **Step 3: Implement parse + encode**

```ts
// Append to src/gallery-filter.ts
import { V, VARIATION_NAMES } from './variations';

// Build the name→index lookup once at module load. VARIATION_NAMES is
// index→name; the reverse is needed for URL parsing.
const NAME_TO_INDEX: Map<string, number> = new Map(
  Object.entries(V).map(([name, idx]) => [name, idx as number]),
);

/** Parse a URLSearchParams into a FilterSpec. Forgiving: unknown values
 *  silently fall back to the default for that axis. Never throws. */
export function parseFilterSpec(params: URLSearchParams): FilterSpec {
  let sort: SortMode = 'time';
  const sortParam = params.get('sort');
  if (sortParam === 'interest') sort = 'interest';

  let vars: number[] = [];
  const varsParam = params.get('vars');
  if (varsParam) {
    const seen = new Set<number>();
    for (const name of varsParam.split(',')) {
      const idx = NAME_TO_INDEX.get(name);
      if (idx !== undefined && !seen.has(idx)) {
        seen.add(idx);
        vars.push(idx);
      }
    }
    vars.sort((a, b) => a - b);
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
      // Auto-swap if min > max.
      if (xformMax !== null && xformMin > xformMax) {
        [xformMin, xformMax] = [xformMax, xformMin];
      }
    }
  }

  return { sort, vars, xformMin, xformMax };
}

/** Encode a FilterSpec into URLSearchParams. Default axes are OMITTED so
 *  a clean canonical-order browse stays at /v1/gallery/p/N with no
 *  querystring. The returned params can be appended verbatim to the URL. */
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
  // xforms emitted iff either bound differs from default.
  if (spec.xformMin !== 1 || spec.xformMax !== null) {
    const rhs = spec.xformMax === null ? '' : String(spec.xformMax);
    p.set('xforms', `${spec.xformMin}-${rhs}`);
  }
  return p;
}
```

- [ ] **Step 4: Run tests — pass**

```bash
npx vitest run src/gallery-filter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck + full suite + commit**

```bash
npm run typecheck && npm test
git add src/gallery-filter.ts src/gallery-filter.test.ts
git commit -m "feat(gallery-filter): URL parse/encode round-trip with forgiving fallback"
```

### Task A3: feature-index forEachRecord + computeFacetCounts

**Files:**
- Modify: `src/feature-index-client.ts` (add `forEachRecord`)
- Modify: `src/feature-index-client.test.ts`
- Create: `src/gallery-facets.ts`
- Create: `src/gallery-facets.test.ts`

- [ ] **Step 1: Test forEachRecord on the index client**

```ts
// Append to src/feature-index-client.test.ts (find existing describe block
// for loadFeatureIndex and add cases at the end, or add a new describe).
import { loadFeatureIndex, _resetFeatureIndexCache } from './feature-index-client';

describe('FeatureIndex.forEachRecord', () => {
  it('visits every record exactly once in ascending (gen,id) order', async () => {
    _resetFeatureIndexCache();
    // Use the existing in-test stub fetch from this file (mirror the
    // shape used by `loads + decodes` cases).
    const stub = makeFakeIndexFetch([
      { gen: 165, id: 0, variations: [0], xforms: 2, coverage: 0.5, meanLum: 0.5, entropy: 0.5, colorVar: 0.5 },
      { gen: 165, id: 1, variations: [1], xforms: 3, coverage: 0.6, meanLum: 0.6, entropy: 0.6, colorVar: 0.6 },
      { gen: 169, id: 5, variations: [2], xforms: 4, coverage: 0.7, meanLum: 0.7, entropy: 0.7, colorVar: 0.7 },
    ]);
    const idx = await loadFeatureIndex(stub);
    const seen: Array<{ gen: number; id: number }> = [];
    idx.forEachRecord((rec) => { seen.push({ gen: rec.gen, id: rec.id }); });
    expect(seen).toEqual([
      { gen: 165, id: 0 },
      { gen: 165, id: 1 },
      { gen: 169, id: 5 },
    ]);
  });

  it('does nothing on the EMPTY sentinel index', async () => {
    _resetFeatureIndexCache();
    const stub = () => Promise.resolve(new Response(null, { status: 503 })) as ReturnType<typeof fetch>;
    const idx = await loadFeatureIndex(stub);
    expect(idx.recordCount).toBe(0);
    let visits = 0;
    idx.forEachRecord(() => { visits++; });
    expect(visits).toBe(0);
  });
});
```

(If `makeFakeIndexFetch` does not already exist in the test file, copy its definition from `src/feature-index-client.test.ts`'s existing "loads + decodes" describe; do NOT re-invent a parallel helper.)

- [ ] **Step 2: Implement forEachRecord**

In `src/feature-index-client.ts`:

```ts
// (a) Extend the FeatureIndex interface (add the method between filter and the closing brace).
export interface FeatureIndex {
  schemaVersion: number;
  corpusTag: string;
  recordCount: number;
  has(gen: number, id: number): boolean;
  get(gen: number, id: number): FeatureRecord | null;
  filter(predicate: (rec: FeatureRecord) => boolean): SheepRef[];
  /** Single-pass walk yielding every record in (gen↑, id↑) order. Allocates
   *  one FeatureRecord per visit — fine for the ~50k-row corpus. Returns
   *  early when the visitor returns false (truthy keeps walking). */
  forEachRecord(visitor: (rec: FeatureRecord) => void | boolean): void;
}

// (b) Update EMPTY sentinel.
const EMPTY: FeatureIndex = Object.freeze({
  schemaVersion: 0,
  corpusTag: '',
  recordCount: 0,
  has: () => false,
  get: () => null,
  filter: () => [],
  forEachRecord: () => {},
}) as FeatureIndex;

// (c) Add forEachRecord to the built index near the bottom of buildIndex():
return {
  schemaVersion: header.schemaVersion,
  corpusTag: header.corpusTag,
  recordCount: count,
  _terminal: true,
  has(gen, id) { /* unchanged */ },
  get(gen, id) { /* unchanged */ },
  filter(predicate) { /* unchanged */ },
  forEachRecord(visitor) {
    for (let i = 0; i < count; i++) {
      const rec = decodeRecord(recordsBytes, i * FEATURE_INDEX_RECORD_BYTES);
      const cont = visitor(rec);
      if (cont === false) return;
    }
  },
};
```

- [ ] **Step 3: Run feature-index tests**

```bash
npx vitest run src/feature-index-client.test.ts
```

Expected: PASS (existing + the two new cases).

- [ ] **Step 4: Test computeFacetCounts (leave-one-out semantics)**

```ts
// src/gallery-facets.test.ts
import { describe, it, expect } from 'vitest';
import { computeFacetCounts } from './gallery-facets';
import { DEFAULT_FILTER_SPEC, type FilterSpec } from './gallery-filter';
import type { FeatureIndex } from './feature-index-client';
import type { FeatureRecord } from './feature-index';

/** Build an in-memory FeatureIndex stub from a record array — bypasses the
 *  binary format entirely so facets math is tested in isolation. */
function makeIndex(records: FeatureRecord[]): FeatureIndex {
  return {
    schemaVersion: 1,
    corpusTag: 'test',
    recordCount: records.length,
    has: (g, i) => records.some((r) => r.gen === g && r.id === i),
    get: (g, i) => records.find((r) => r.gen === g && r.id === i) ?? null,
    filter: (p) => records.filter(p).map((r) => ({ gen: r.gen, id: r.id })),
    forEachRecord: (visitor) => {
      for (const r of records) {
        if (visitor(r) === false) return;
      }
    },
  };
}

function rec(gen: number, id: number, vars: number[], xforms: number): FeatureRecord {
  return {
    gen, id,
    variations: vars,
    xforms,
    coverage: 0.5, meanLum: 0.5, entropy: 0.5, colorVar: 0.5,
  };
}

describe('computeFacetCounts', () => {
  it('no filter → variation counts are raw corpus counts', () => {
    const idx = makeIndex([
      rec(165, 0, [0, 14], 2), // linear + julia
      rec(165, 1, [14], 3),    // julia
      rec(165, 2, [0], 4),     // linear
    ]);
    const c = computeFacetCounts(idx, DEFAULT_FILTER_SPEC);
    expect(c.variations.get(0)).toBe(2);   // linear in 2 flames
    expect(c.variations.get(14)).toBe(2);  // julia in 2 flames
    expect(c.total).toBe(3);
  });

  it('variation counts apply OTHER active filters (leave-one-out)', () => {
    // With xform filter [3, ∞), only records with xforms≥3 should count.
    const idx = makeIndex([
      rec(165, 0, [0, 14], 2), // dropped by xform filter
      rec(165, 1, [14], 3),    // counted: julia
      rec(165, 2, [0], 4),     // counted: linear
    ]);
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, xformMin: 3 };
    const c = computeFacetCounts(idx, spec);
    expect(c.variations.get(0)).toBe(1);
    expect(c.variations.get(14)).toBe(1);
    expect(c.total).toBe(2);
  });

  it('variation counts do NOT apply the variation filter itself (leave-one-out)', () => {
    // Selecting julia should NOT narrow the variation-axis counts to "only julia"
    // — counts must still show what would happen if a SECOND variation were added.
    const idx = makeIndex([
      rec(165, 0, [0, 14], 2),   // linear + julia
      rec(165, 1, [14, 50], 3),  // julia + spherical
      rec(165, 2, [0], 4),       // linear only — outside the julia subset
    ]);
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, vars: [14] };
    const c = computeFacetCounts(idx, spec);
    // Among julia records (165/0 + 165/1):
    expect(c.variations.get(0)).toBe(1);   // linear AND julia → 165/0
    expect(c.variations.get(50)).toBe(1);  // spherical AND julia → 165/1
    expect(c.variations.get(14)).toBe(2);  // julia itself: count over the julia subset = 2
    expect(c.total).toBe(2);
  });

  it('xform counts apply OTHER active filters but NOT the xform range itself', () => {
    const idx = makeIndex([
      rec(165, 0, [14], 2),
      rec(165, 1, [14], 3),
      rec(165, 2, [14], 4),
      rec(165, 3, [0], 5),  // linear, dropped by julia filter
    ]);
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, vars: [14], xformMin: 3 };
    const c = computeFacetCounts(idx, spec);
    // xform counts should reflect the julia filter but NOT the [3, ∞) cap.
    expect(c.xforms.get(2)).toBe(1);
    expect(c.xforms.get(3)).toBe(1);
    expect(c.xforms.get(4)).toBe(1);
    // total respects ALL filters (julia AND xforms≥3) → 2 records.
    expect(c.total).toBe(2);
  });

  it('xform counts collapse 10+ into bucket key 10', () => {
    const idx = makeIndex([
      rec(165, 0, [0], 9),
      rec(165, 1, [0], 10),
      rec(165, 2, [0], 15),
      rec(165, 3, [0], 30),
    ]);
    const c = computeFacetCounts(idx, DEFAULT_FILTER_SPEC);
    expect(c.xforms.get(9)).toBe(1);
    expect(c.xforms.get(10)).toBe(3);  // 10, 15, 30 all collapse here
  });

  it('variation AND semantic — total respects intersection', () => {
    const idx = makeIndex([
      rec(165, 0, [14], 2),         // julia only
      rec(165, 1, [0, 14], 3),      // linear + julia
      rec(165, 2, [0], 4),          // linear only
    ]);
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, vars: [0, 14] };
    const c = computeFacetCounts(idx, spec);
    expect(c.total).toBe(1);
  });
});
```

- [ ] **Step 5: Run the failing test**

```bash
npx vitest run src/gallery-facets.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 6: Implement computeFacetCounts**

```ts
// src/gallery-facets.ts
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
    // Variations axis: include rec iff every OTHER filter passes.
    if (passesFilters(rec, spec, { vars: true })) {
      for (const v of rec.variations) {
        variations.set(v, (variations.get(v) ?? 0) + 1);
      }
    }
    // Xforms axis: include rec iff every OTHER filter passes.
    if (passesFilters(rec, spec, { xforms: true })) {
      const k = xformBucket(rec.xforms);
      xforms.set(k, (xforms.get(k) ?? 0) + 1);
    }
    // Total: respect ALL filters.
    if (passesFilters(rec, spec, {})) total++;
  });

  return { variations, xforms, total };
}
```

- [ ] **Step 7: Run tests — pass**

```bash
npx vitest run src/gallery-facets.test.ts src/feature-index-client.test.ts
```

Expected: PASS.

- [ ] **Step 8: Typecheck + full suite + commit**

```bash
npm run typecheck && npm test
git add src/gallery-facets.ts src/gallery-facets.test.ts src/feature-index-client.ts src/feature-index-client.test.ts
git commit -m "feat(gallery-facets): leave-one-out facet counts + forEachRecord on index"
```

### Task A4: load-intent.ts — gallery intent carries FilterSpec

**Files:**
- Modify: `src/load-intent.ts`
- Modify: `src/load-intent.test.ts`

- [ ] **Step 1: Write the failing tests for gallery filter URL handling**

```ts
// Append to src/load-intent.test.ts
import { V } from './variations';
import { DEFAULT_FILTER_SPEC } from './gallery-filter';

describe('parseLoadIntent — gallery filter', () => {
  it('/v1/gallery → page 1, default filter', () => {
    const i = parseLoadIntent('/v1/gallery');
    expect(i).toEqual({ kind: 'gallery', page: 1, filter: DEFAULT_FILTER_SPEC });
  });

  it('/v1/gallery/p/3 → page 3, default filter', () => {
    const i = parseLoadIntent('/v1/gallery/p/3');
    expect(i).toEqual({ kind: 'gallery', page: 3, filter: DEFAULT_FILTER_SPEC });
  });

  it('/v1/gallery?sort=interest → page 1, interest sort', () => {
    const i = parseLoadIntent('/v1/gallery?sort=interest');
    expect(i?.kind).toBe('gallery');
    if (i?.kind === 'gallery') {
      expect(i.page).toBe(1);
      expect(i.filter.sort).toBe('interest');
    }
  });

  it('/v1/gallery/p/3?vars=julia → page 3, julia filter', () => {
    const i = parseLoadIntent('/v1/gallery/p/3?vars=julia');
    expect(i?.kind).toBe('gallery');
    if (i?.kind === 'gallery') {
      expect(i.page).toBe(3);
      expect(i.filter.vars).toEqual([V.julia]);
    }
  });
});

describe('galleryUrl — filter round-trip', () => {
  it('default filter → bare /v1/gallery', () => {
    expect(galleryUrl(1)).toMatch(/v1\/gallery$/);
  });

  it('default filter, page 3 → /v1/gallery/p/3 (no querystring)', () => {
    expect(galleryUrl(3, DEFAULT_FILTER_SPEC)).toMatch(/v1\/gallery\/p\/3$/);
  });

  it('non-default filter on page 1 emits /v1/gallery?...', () => {
    const url = galleryUrl(1, { ...DEFAULT_FILTER_SPEC, sort: 'interest' });
    expect(url).toMatch(/v1\/gallery\?sort=interest$/);
  });

  it('non-default filter on page 3 emits /v1/gallery/p/3?...', () => {
    const url = galleryUrl(3, { ...DEFAULT_FILTER_SPEC, sort: 'interest', vars: [V.julia] });
    expect(url).toMatch(/v1\/gallery\/p\/3\?sort=interest&vars=julia$/);
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
npx vitest run src/load-intent.test.ts
```

Expected: FAIL — gallery intent is missing `filter`, `galleryUrl` doesn't accept it.

- [ ] **Step 3: Extend parseLoadIntent + galleryUrl**

In `src/load-intent.ts`:

(a) Add the imports at the top:

```ts
import {
  DEFAULT_FILTER_SPEC,
  encodeFilterSpec,
  parseFilterSpec,
  type FilterSpec,
} from './gallery-filter';
```

(b) Update the union type:

```ts
export type LoadIntent =
  | { kind: 'home' }
  | { kind: 'gen-list' }
  | { kind: 'gen-browse'; gen: number }
  | { kind: 'corpus'; gen: number; id: number }
  | { kind: 'flame-stub' }
  | { kind: 'gallery'; page: number; filter: FilterSpec };  // <-- add filter
```

(c) Update parseLoadIntent's gallery branch — accept a URL not just a pathname; the existing function signature already takes a string but the querystring needs parsing. Update the signature + body:

```ts
// Original signature:  export function parseLoadIntent(path: string): LoadIntent | null
// Keep accepting a path-only string for back-compat. If the caller hands a
// full URL or path+search, both work.
export function parseLoadIntent(input: string): LoadIntent | null {
  // Normalize: parse via URL so the querystring is extracted whether the
  // caller hands "/v1/gallery?a=1" or "https://x/v1/gallery?a=1".
  let pathname: string;
  let search: string;
  try {
    const u = new URL(input, 'http://_');  // synthetic base for path-only input
    pathname = u.pathname;
    search = u.search;
  } catch {
    return null;
  }
  // ... existing path-splitting logic operates on `pathname` instead of `path`.
  // At the gallery branch:
  //
  //   if (parts.length === 2 && parts[1] === 'gallery') {
  //     return { kind: 'gallery', page: 1,
  //              filter: parseFilterSpec(new URLSearchParams(search)) };
  //   }
  //   if (parts.length === 4 && parts[1] === 'gallery' && parts[2] === 'p') {
  //     const n = Number(parts[3]);
  //     if (Number.isFinite(n) && n >= 1) {
  //       return { kind: 'gallery', page: n,
  //                filter: parseFilterSpec(new URLSearchParams(search)) };
  //     }
  //   }
}
```

(Adapt the existing code in place — the inserts above show only the changed shape; do not rewrite unchanged branches.)

(d) Update `galleryUrl`:

```ts
/** Canonical base-aware gallery share URL. Page 1 produces the bare
 *  `/v1/gallery` URL (no `/p/1` suffix); page ≥ 2 includes `/p/N`.
 *  When `filter` is non-default, appends a querystring (defaults omitted). */
export function galleryUrl(page: number, filter?: FilterSpec): string {
  const base = page <= 1
    ? `${import.meta.env.BASE_URL}v1/gallery`
    : `${import.meta.env.BASE_URL}v1/gallery/p/${page}`;
  if (!filter) return base;
  const qs = encodeFilterSpec(filter).toString();
  return qs.length === 0 ? base : `${base}?${qs}`;
}
```

- [ ] **Step 4: Run the test — pass**

```bash
npx vitest run src/load-intent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck + full suite + commit**

The shape change to `LoadIntent.gallery` will ripple through `main.ts` callers — fix them in the next task; do not paper over with `as any` here. Run typecheck and expect a small number of errors in `main.ts` referencing `{ kind: 'gallery' }` without `filter`:

```bash
npm run typecheck
```

If `main.ts` callers fail compile, defer to Task A5 (they're addressed there). Move on if the only errors are in `main.ts`; commit the contained change here.

```bash
git add src/load-intent.ts src/load-intent.test.ts
git commit -m "feat(load-intent): gallery intent carries FilterSpec + galleryUrl writes it"
```

### Task A5: gallery-mount — pageOfSheepFiltered + master-list cache + index load

**Files:**
- Modify: `src/gallery-mount.ts`
- Modify: `src/gallery-mount.test.ts`
- Modify: `src/main.ts` (just enough to make typecheck pass with the new LoadIntent shape)

- [ ] **Step 1: Test pageOfSheepFiltered + totalPagesFiltered**

```ts
// Append to src/gallery-mount.test.ts
import { pageOfSheepFiltered, totalPagesFiltered } from './gallery-mount';
import { DEFAULT_FILTER_SPEC, type FilterSpec } from './gallery-filter';
import type { FeatureIndex } from './feature-index-client';
import type { FeatureRecord } from './feature-index';

function makeStubIndex(records: FeatureRecord[]): FeatureIndex {
  return {
    schemaVersion: 1, corpusTag: 'test', recordCount: records.length,
    has: (g, i) => records.some((r) => r.gen === g && r.id === i),
    get: (g, i) => records.find((r) => r.gen === g && r.id === i) ?? null,
    filter: (p) => records.filter(p).map((r) => ({ gen: r.gen, id: r.id })),
    forEachRecord: (visitor) => { for (const r of records) if (visitor(r) === false) return; },
  };
}

function recF(gen: number, id: number, xforms: number, coverage = 0.5, entropy = 0.5, colorVar = 0.5, meanLum = 0.5, variations: number[] = [14]): FeatureRecord {
  return { gen, id, xforms, coverage, entropy, colorVar, meanLum, variations };
}

describe('pageOfSheepFiltered', () => {
  const idx = makeStubIndex(
    Array.from({ length: 25 }, (_, i) => recF(165, i, 3, /*cov*/ (25 - i) / 25))
  );

  it('default filter, page 1, perPage 9 returns 9 refs in (gen,id) order', async () => {
    const out = await pageOfSheepFiltered(1, 9, DEFAULT_FILTER_SPEC, { index: idx });
    expect(out.length).toBe(9);
    expect(out[0]).toEqual({ gen: 165, id: 0 });
    expect(out[8]).toEqual({ gen: 165, id: 8 });
  });

  it('page 3 returns the trailing 7 refs (25 - 18 = 7)', async () => {
    const out = await pageOfSheepFiltered(3, 9, DEFAULT_FILTER_SPEC, { index: idx });
    expect(out.length).toBe(7);
  });

  it('sort=interest reorders by interestScore descending', async () => {
    // Coverage decreases with id; interestScore is dominated by coverage in
    // the defaults — so id 0 (cov 1.0) should sort first.
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, sort: 'interest' };
    const out = await pageOfSheepFiltered(1, 9, spec, { index: idx });
    expect(out[0]).toEqual({ gen: 165, id: 0 });
  });

  it('vars filter narrows the result set', async () => {
    const mixed = makeStubIndex([
      recF(165, 0, 3, 0.5, 0.5, 0.5, 0.5, [14]),   // julia
      recF(165, 1, 3, 0.5, 0.5, 0.5, 0.5, [0]),    // linear
      recF(165, 2, 3, 0.5, 0.5, 0.5, 0.5, [14, 0]),// julia + linear
    ]);
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, vars: [14] };
    const out = await pageOfSheepFiltered(1, 9, spec, { index: mixed });
    expect(out).toEqual([{ gen: 165, id: 0 }, { gen: 165, id: 2 }]);
  });

  it('xform range narrows the result set', async () => {
    const mixed = makeStubIndex([
      recF(165, 0, 2),
      recF(165, 1, 3),
      recF(165, 2, 4),
      recF(165, 3, 5),
    ]);
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, xformMin: 3, xformMax: 4 };
    const out = await pageOfSheepFiltered(1, 9, spec, { index: mixed });
    expect(out).toEqual([{ gen: 165, id: 1 }, { gen: 165, id: 2 }]);
  });
});

describe('totalPagesFiltered', () => {
  it('25 records / 9 per page = 3 pages', () => {
    const idx = makeStubIndex(
      Array.from({ length: 25 }, (_, i) => recF(165, i, 3))
    );
    expect(totalPagesFiltered(DEFAULT_FILTER_SPEC, 9, { index: idx })).toBe(3);
  });

  it('empty result set → 0 pages', () => {
    const idx = makeStubIndex([recF(165, 0, 3, 0.5, 0.5, 0.5, 0.5, [14])]);
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, vars: [0] };  // linear absent
    expect(totalPagesFiltered(spec, 9, { index: idx })).toBe(0);
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
npx vitest run src/gallery-mount.test.ts
```

Expected: FAIL — `pageOfSheepFiltered` + `totalPagesFiltered` not exported.

- [ ] **Step 3: Implement pageOfSheepFiltered + totalPagesFiltered**

Append to `src/gallery-mount.ts`:

```ts
import { type FilterSpec, filterSpecEquals } from './gallery-filter';
import { interestScore } from './feature-score';
import type { FeatureIndex } from './feature-index-client';
import type { FeatureRecord } from './feature-index';

export interface FilteredPageDeps {
  index: FeatureIndex;
}

interface MasterListCache {
  spec: FilterSpec;
  refs: SheepRef[];
}

let masterCache: MasterListCache | null = null;

/** Test-only: clear the master-list cache so consecutive tests don't see each
 *  other's filtered lists. Production code never calls. */
export function _resetMasterListCache(): void {
  masterCache = null;
}

function buildMasterList(index: FeatureIndex, spec: FilterSpec): SheepRef[] {
  const out: SheepRef[] = [];
  // First pass: filter.
  const passing: FeatureRecord[] = [];
  index.forEachRecord((rec) => {
    if (rec.xforms < spec.xformMin) return;
    if (spec.xformMax !== null && rec.xforms > spec.xformMax) return;
    for (const v of spec.vars) {
      if (!rec.variations.includes(v)) return;
    }
    passing.push(rec);
  });
  // Second pass: sort.
  if (spec.sort === 'interest') {
    passing.sort((a, b) => {
      const dA = interestScore(a);
      const dB = interestScore(b);
      if (dB !== dA) return dB - dA;             // interest descending
      if (a.gen !== b.gen) return a.gen - b.gen;  // ties → (gen, id) ascending
      return a.id - b.id;
    });
  }
  // time-sort is identity — records are already (gen↑, id↑) in the index.
  for (const r of passing) out.push({ gen: r.gen, id: r.id });
  return out;
}

function getMasterList(index: FeatureIndex, spec: FilterSpec): SheepRef[] {
  if (masterCache && filterSpecEquals(masterCache.spec, spec)) {
    return masterCache.refs;
  }
  const refs = buildMasterList(index, spec);
  masterCache = { spec, refs };
  return refs;
}

/** Return the refs for `page` (1-indexed) under the given filter, sliced
 *  from a per-process cached master list. The master list is rebuilt only
 *  when `spec` changes; page nav within the same spec is a single slice. */
export async function pageOfSheepFiltered(
  page: number,
  perPage: number,
  spec: FilterSpec,
  deps: FilteredPageDeps,
): Promise<SheepRef[]> {
  if (page < 1 || perPage < 1) return [];
  const master = getMasterList(deps.index, spec);
  const start = (page - 1) * perPage;
  return master.slice(start, start + perPage);
}

/** Total pages for the given filter spec. 0 when the filter matches no
 *  records (drives the empty-state UX). */
export function totalPagesFiltered(
  spec: FilterSpec,
  perPage: number,
  deps: FilteredPageDeps,
): number {
  if (perPage < 1) return 0;
  const master = getMasterList(deps.index, spec);
  return Math.ceil(master.length / perPage);
}
```

- [ ] **Step 4: Patch main.ts to compile under the new LoadIntent shape**

In `src/main.ts`, find every place that constructs `{ kind: 'gallery', page: N }` or destructures `kind === 'gallery'` and add the `filter` field. Minimum to compile:

```ts
// Where the popstate / initial dispatch reads parseLoadIntent's result, the
// filter is now on the intent — pass it through to galleryHandle.setPage
// and galleryUrl. For Task A5 we just need to compile; full wiring of
// applyFilter / popstate flows lands in Task A6.
const intent = parseLoadIntent(location.pathname + location.search);
if (intent?.kind === 'gallery') {
  // existing path used: intent.page
  // new field available: intent.filter
  // For now, pass DEFAULT_FILTER_SPEC if nothing else is wired yet.
  // Replace as the wiring is built in Task A6.
}
```

Concretely: at any `history.pushState({}, '', galleryUrl(page))` callsite, also pass the current filter spec when one is in scope; if filter wiring isn't done yet, pass `undefined` to keep behavior identical to today.

- [ ] **Step 5: Typecheck + tests + commit**

```bash
npm run typecheck && npm test
git add src/gallery-mount.ts src/gallery-mount.test.ts src/main.ts
git commit -m "feat(gallery-mount): pageOfSheepFiltered + master-list cache (spec-keyed)"
```

### Task A6: main.ts — wire applyFilter + popstate + feature-index load

**Files:**
- Modify: `src/main.ts`

This is the wiring task. mountGallery now accepts an `initialFilter`. main.ts loads the feature index once (cached promise; reused across pages) and threads the filter spec through every transition.

- [ ] **Step 1: Add initialFilter + currentFilter state in the gallery section**

Locate the existing gallery block in `src/main.ts` (search for `galleryHandle`, `mountGalleryBar`, `galleryTotalPages`). Add:

```ts
import { DEFAULT_FILTER_SPEC, filterSpecEquals, type FilterSpec } from './gallery-filter';
import { loadFeatureIndex } from './feature-index-client';
import { totalPagesFiltered } from './gallery-mount';

// Inside the gallery wiring block (alongside galleryHandle, galleryBar, galleryTotalPages):
let currentFilter: FilterSpec = DEFAULT_FILTER_SPEC;
let featureIndexPromise: ReturnType<typeof loadFeatureIndex> | null = null;

function ensureFeatureIndex() {
  if (featureIndexPromise === null) featureIndexPromise = loadFeatureIndex();
  return featureIndexPromise;
}
```

- [ ] **Step 2: Update mountGallery + setPage callsites to accept filter**

Locate the gallery dispatch (`if (intent.kind === 'gallery') { … }`). After awaiting the feature index, build mountGallery + the bar with the parsed filter:

```ts
if (intent.kind === 'gallery') {
  currentFilter = intent.filter;
  const index = await ensureFeatureIndex();
  // The mount helper does the master-list-cache + slice via the deps {index}
  // passed through. Page math now uses totalPagesFiltered(currentFilter).
  galleryTotalPages = totalPagesFiltered(currentFilter, GALLERY_PAGE_SIZE, { index });
  // Pass index into the mountGallery deps (extend GalleryMountDeps in Task A7
  // if not already done — for now mountGallery uses a closure-captured filter+index).
  // ... rest of existing gallery mount path stays similar
}
```

- [ ] **Step 3: Implement applyFilter — the single canonical filter-write entry**

Add inside the gallery wiring block:

```ts
function applyFilter(nextFilter: FilterSpec): void {
  if (filterSpecEquals(currentFilter, nextFilter)) return;
  currentFilter = nextFilter;
  // Filter changes always reset to page 1.
  const url = galleryUrl(1, nextFilter);
  history.pushState({}, '', url);
  setDocTitle('gallery · p1');
  // Recompute total page count under the new filter.
  void ensureFeatureIndex().then((index) => {
    galleryTotalPages = totalPagesFiltered(nextFilter, GALLERY_PAGE_SIZE, { index });
    galleryBar?.setPage(1, galleryTotalPages);
    void galleryHandle?.setPage(1);
  });
}
```

- [ ] **Step 4: popstate handler reroutes filter changes**

Find the existing `popstate` handler. Add filter-aware re-dispatch:

```ts
window.addEventListener('popstate', () => {
  const next = parseLoadIntent(location.pathname + location.search);
  if (next?.kind === 'gallery' && currentSurface === 'gallery') {
    if (!filterSpecEquals(next.filter, currentFilter)) {
      currentFilter = next.filter;
      void ensureFeatureIndex().then((index) => {
        galleryTotalPages = totalPagesFiltered(currentFilter, GALLERY_PAGE_SIZE, { index });
        galleryBar?.setPage(next.page, galleryTotalPages);
        void galleryHandle?.setPage(next.page);
      });
      return;
    }
    // Same filter, different page — existing page-only branch handles this.
  }
  // … existing handler logic
});
```

- [ ] **Step 5: Verify Phase A end-to-end manually**

Run dev server, hand-type a filtered URL:

```bash
npm run dev
```

Open in Chrome (via the chrome-devtools-mcp plugin, NOT the built-in preview):
- `http://localhost:5173/v1/gallery` — should look identical to today
- `http://localhost:5173/v1/gallery?sort=interest` — different first 9 cells, sorted by interest
- `http://localhost:5173/v1/gallery?vars=julia` — only julia flames
- Browser back/forward should restore each URL's filter state

Drawer doesn't exist yet — that's expected. The test is "URL hand-typing filters correctly."

- [ ] **Step 6: Typecheck + tests + commit**

```bash
npm run typecheck && npm test
git add src/main.ts
git commit -m "feat(main): wire FilterSpec through gallery mount + popstate + applyFilter"
```

### Task A7: Phase A ship — FF-merge to main + deploy verify

- [ ] **Step 1: Verify branch is clean + all tests pass**

```bash
git status
npm run typecheck && npm test
```

- [ ] **Step 2: Hand off for user-verify-before-FF-merge**

Surface a verify URL to the user. Confirm:
- canonical-order browse unchanged at `/v1/gallery`
- hand-typed `?sort=interest` reorders
- hand-typed `?vars=julia` filters
- browser back/forward restores state across both

Wait for explicit user approval before merging.

- [ ] **Step 3: Squash-merge Phase A to main**

```bash
git checkout main
git merge --squash feature/issue-49-gallery-filter-phase-a
git commit -m "feat(gallery): Phase A — FilterSpec + URL plumbing + faceted facet counts (#49)"
git push origin main
```

- [ ] **Step 4: Watch the deploy run + live-verify**

```bash
gh run watch $(gh run list --workflow=deploy.yml --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

After deploy: open `https://pyr3.app/v1/gallery?sort=interest&vars=julia` in Chrome. Confirm filtering works on the live site. If it does, Phase A is shipped.

- [ ] **Step 5: Delete the merged Phase A branch (per CLAUDE.md session-end carve-out, this is mid-session so PER-INSTANCE ASK)**

Ask the user explicitly before `git branch -D` + `git push origin --delete`. Do NOT auto-clean mid-session.

---

## Phase B — Drawer + sort + xform UI

**Branch:** `feature/issue-49-gallery-filter-phase-b` (from updated main)
**Outcome:** Visible feature — drawer pill in gallery bar; clicking opens the drawer with sort segmented control + xform from/to pickers + reset. Variation picker stubbed `"coming next"`. Loading + empty states ship here.

### Task B1: Branch + drawer scaffold + reset pill

**Files:**
- Create: `src/gallery-filter-ui.ts`
- Create: `src/gallery-filter-ui.test.ts`

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull --ff-only
git checkout -b feature/issue-49-gallery-filter-phase-b
```

- [ ] **Step 2: Test the drawer mount + reset wiring**

```ts
// src/gallery-filter-ui.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Window } from 'happy-dom';
import { mountFilterDrawer } from './gallery-filter-ui';
import { DEFAULT_FILTER_SPEC, type FilterSpec } from './gallery-filter';

function dom() {
  const w = new Window();
  // @ts-expect-error inject for tests
  globalThis.document = w.document;
  // @ts-expect-error inject for tests
  globalThis.HTMLElement = w.HTMLElement;
  return w;
}

describe('mountFilterDrawer', () => {
  it('mounts hidden when initialFilter is default', () => {
    dom();
    const root = document.createElement('div');
    const onChange = vi.fn();
    const handle = mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      onChange,
      facetCounts: { variations: new Map(), xforms: new Map(), total: 0 },
    });
    expect(root.querySelector('.pyr3-filter-drawer')?.classList.contains('open')).toBe(false);
    handle.destroy();
  });

  it('mounts open when initialFilter is non-default', () => {
    dom();
    const root = document.createElement('div');
    const handle = mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, sort: 'interest' },
      onChange: vi.fn(),
      facetCounts: { variations: new Map(), xforms: new Map(), total: 5 },
    });
    expect(root.querySelector('.pyr3-filter-drawer')?.classList.contains('open')).toBe(true);
    handle.destroy();
  });

  it('reset button fires onChange with DEFAULT_FILTER_SPEC', () => {
    dom();
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, sort: 'interest', vars: [14] },
      onChange,
      facetCounts: { variations: new Map(), xforms: new Map(), total: 5 },
    });
    const resetBtn = root.querySelector('.pyr3-filter-reset') as HTMLButtonElement;
    expect(resetBtn).toBeTruthy();
    resetBtn.click();
    expect(onChange).toHaveBeenCalledWith(DEFAULT_FILTER_SPEC);
  });
});
```

- [ ] **Step 3: Implement the scaffold + reset**

```ts
// src/gallery-filter-ui.ts
// Mount + manage the gallery filter drawer — the UI surface that sits below
// the gallery bar and hosts sort/variation/xform controls.
//
// State lives in the URL; the drawer is a controlled component — it never
// holds filter state internally. Every interaction calls opts.onChange with
// the next FilterSpec; main.ts owns the URL write + master-list rebuild.

import { DEFAULT_FILTER_SPEC, isDefaultFilterSpec, type FilterSpec } from './gallery-filter';
import type { FacetCounts } from './gallery-facets';

export interface FilterDrawerOpts {
  initialFilter: FilterSpec;
  facetCounts: FacetCounts;
  /** Fired when any control inside the drawer changes. */
  onChange(nextFilter: FilterSpec): void;
  /** Optional — when set, drawer renders a "loading filter index…" banner
   *  and every control is disabled. main.ts sets this until the index
   *  loadFeatureIndex() promise resolves. */
  loading?: boolean;
}

export interface FilterDrawerHandle {
  /** Replace the drawer's view of facet counts (call after every applyFilter
   *  so dropdowns + count rows re-render). */
  setFacetCounts(counts: FacetCounts): void;
  /** Replace the drawer's view of the filter (mirror state after main.ts
   *  has accepted the change — keeps the drawer's internal DOM in sync). */
  setFilter(filter: FilterSpec): void;
  /** Toggle open/closed externally — used by the bar pill click. */
  toggleOpen(): void;
  isOpen(): boolean;
  destroy(): void;
}

const STYLES_ID = 'pyr3-filter-drawer-styles';

function injectStylesOnce(): void {
  if (document.getElementById(STYLES_ID)) return;
  const style = document.createElement('style');
  style.id = STYLES_ID;
  style.textContent = `
.pyr3-filter-drawer { display:none; padding:12px 16px; background:#15151a; border-bottom:1px solid #2a2a30; font-family:ui-monospace, monospace; font-size:12px; color:#ddd; }
.pyr3-filter-drawer.open { display:block; }
.pyr3-filter-row { display:flex; align-items:center; gap:8px; padding:4px 0; }
.pyr3-filter-row-label { color:#888; min-width:60px; }
.pyr3-filter-reset { background:#2a2a30; color:#ddd; border:1px solid #3a3a40; padding:4px 10px; border-radius:3px; cursor:pointer; }
.pyr3-filter-reset:hover { background:#3a3a40; }
.pyr3-filter-drawer.loading .pyr3-filter-row > *:not(.pyr3-filter-loading-banner) { opacity:0.4; pointer-events:none; }
.pyr3-filter-loading-banner { color:var(--accent, #ff8c1a); padding:4px 0; }
`;
  document.head.appendChild(style);
}

export function mountFilterDrawer(root: HTMLElement, opts: FilterDrawerOpts): FilterDrawerHandle {
  injectStylesOnce();
  root.replaceChildren();

  let currentFilter = opts.initialFilter;
  let currentCounts = opts.facetCounts;
  let isOpen = !isDefaultFilterSpec(currentFilter);

  const drawer = document.createElement('div');
  drawer.className = `pyr3-filter-drawer ${isOpen ? 'open' : ''}`;
  if (opts.loading) drawer.classList.add('loading');

  // Loading banner (visible only when .loading is on the drawer).
  const loadingBanner = document.createElement('div');
  loadingBanner.className = 'pyr3-filter-loading-banner';
  loadingBanner.textContent = 'loading feature index… (filters arrive in ~0.5s)';
  drawer.appendChild(loadingBanner);

  // ── sort row (filled by Task B3) ────────────────────────────────────
  const sortRow = document.createElement('div');
  sortRow.className = 'pyr3-filter-row sort';
  // Placeholder — B3 wires this row.
  sortRow.textContent = 'sort: (Phase B3)';
  drawer.appendChild(sortRow);

  // ── vars row (Phase B leaves this stubbed; Phase C wires the picker) ──
  const varsRow = document.createElement('div');
  varsRow.className = 'pyr3-filter-row vars';
  varsRow.textContent = 'vars: (coming next)';
  drawer.appendChild(varsRow);

  // ── xforms row (Task B4) ──────────────────────────────────────────────
  const xformsRow = document.createElement('div');
  xformsRow.className = 'pyr3-filter-row xforms';
  xformsRow.textContent = 'xforms: (Phase B4)';
  drawer.appendChild(xformsRow);

  // ── actions row ───────────────────────────────────────────────────────
  const actionsRow = document.createElement('div');
  actionsRow.className = 'pyr3-filter-row actions';
  const resetBtn = document.createElement('button');
  resetBtn.className = 'pyr3-filter-reset';
  resetBtn.textContent = '✕ reset';
  resetBtn.onclick = () => opts.onChange(DEFAULT_FILTER_SPEC);
  actionsRow.appendChild(resetBtn);
  drawer.appendChild(actionsRow);

  root.appendChild(drawer);

  return {
    setFacetCounts(c) {
      currentCounts = c;
      // re-render points (B3/B4/C wire detailed updates).
    },
    setFilter(f) {
      currentFilter = f;
      const shouldOpen = !isDefaultFilterSpec(f);
      if (shouldOpen !== isOpen) {
        isOpen = shouldOpen;
        drawer.classList.toggle('open', isOpen);
      }
    },
    toggleOpen() {
      isOpen = !isOpen;
      drawer.classList.toggle('open', isOpen);
    },
    isOpen() { return isOpen; },
    destroy() { root.replaceChildren(); },
  };
}
```

- [ ] **Step 4: Run the tests — pass**

```bash
npx vitest run src/gallery-filter-ui.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + full suite + commit**

```bash
npm run typecheck && npm test
git add src/gallery-filter-ui.ts src/gallery-filter-ui.test.ts
git commit -m "feat(gallery-filter-ui): drawer scaffold + reset pill + auto-open on non-default"
```

### Task B2: ui-bar.ts — `[⚙ filters ▾ (N active)]` pill

**Files:**
- Modify: `src/ui-bar.ts`
- Modify: `src/ui-bar.test.ts`

- [ ] **Step 1: Add countActiveAxes helper + test it**

In `src/gallery-filter.ts`:

```ts
/** How many filter axes differ from the default? Used by the bar pill's
 *  count badge ("N active"). Variations count as ONE axis regardless of
 *  how many are selected. */
export function countActiveAxes(spec: FilterSpec): number {
  let n = 0;
  if (spec.sort !== DEFAULT_FILTER_SPEC.sort) n++;
  if (spec.vars.length > 0) n++;
  if (spec.xformMin !== DEFAULT_FILTER_SPEC.xformMin || spec.xformMax !== DEFAULT_FILTER_SPEC.xformMax) n++;
  return n;
}
```

Test in `src/gallery-filter.test.ts`:

```ts
import { countActiveAxes } from './gallery-filter';

describe('countActiveAxes', () => {
  it('default → 0', () => expect(countActiveAxes(DEFAULT_FILTER_SPEC)).toBe(0));
  it('sort changed → 1', () => expect(countActiveAxes({ ...DEFAULT_FILTER_SPEC, sort: 'interest' })).toBe(1));
  it('vars set → 1 regardless of count', () => {
    expect(countActiveAxes({ ...DEFAULT_FILTER_SPEC, vars: [14] })).toBe(1);
    expect(countActiveAxes({ ...DEFAULT_FILTER_SPEC, vars: [14, 0, 50] })).toBe(1);
  });
  it('xform range changed → 1', () => {
    expect(countActiveAxes({ ...DEFAULT_FILTER_SPEC, xformMin: 2 })).toBe(1);
    expect(countActiveAxes({ ...DEFAULT_FILTER_SPEC, xformMax: 8 })).toBe(1);
  });
  it('all three axes → 3', () => {
    expect(countActiveAxes({ sort: 'interest', vars: [14], xformMin: 2, xformMax: 8 })).toBe(3);
  });
});
```

- [ ] **Step 2: Extend GalleryBarOpts with filter pill callbacks + badge**

In `src/ui-bar.ts`, update `GalleryBarOpts` + `GalleryBarHandle`:

```ts
export interface GalleryBarOpts {
  webgpu: WebGPUStatus;
  page: number;
  totalPages: number;
  onPrevPage(): void;
  onNextPage(): void;
  onRandomPage(): void;
  // NEW:
  /** Initial active-axis count for the filter pill badge. */
  activeAxes: number;
  /** Fired when the visitor clicks the `[⚙ filters ▾]` pill. main.ts
   *  forwards to the drawer's toggleOpen(). */
  onFilterToggle(): void;
}

export interface GalleryBarHandle {
  setPage(page: number, totalPages?: number): void;
  // NEW:
  /** Update the filter pill's badge count (hidden when 0). */
  setActiveAxes(n: number): void;
  destroy(): void;
}
```

In `mountGalleryBar`, build a new pill element next to the dice pill:

```ts
// After dicePill is created:
const filterPill = el('a', 'pyr3-nav-pill pyr3-bar-filter-pill') as HTMLAnchorElement;
const filterPillLabel = document.createElement('span');
filterPillLabel.textContent = '⚙ filters ▾';
const filterPillBadge = document.createElement('span');
filterPillBadge.className = 'pyr3-bar-filter-badge';
filterPill.append(filterPillLabel, filterPillBadge);
filterPill.title = 'open the gallery filter drawer';
filterPill.onclick = (e) => { e.preventDefault(); opts.onFilterToggle(); };

const renderBadge = (n: number): void => {
  if (n === 0) {
    filterPillBadge.textContent = '';
    filterPillBadge.style.display = 'none';
  } else {
    filterPillBadge.textContent = `${n} active`;
    filterPillBadge.style.display = '';
  }
};
renderBadge(opts.activeAxes);

infoCenter.append(prevPill, pageLabel, nextPill, dicePill, filterPill);

// Return shape — add setActiveAxes:
return {
  setPage(page, totalPages) { /* unchanged */ },
  setActiveAxes(n) { renderBadge(n); },
  destroy() { /* unchanged */ },
};
```

Add CSS in `ui-bar.ts`'s styles block (where the other `.pyr3-bar-*` rules live):

```css
.pyr3-bar-filter-pill { display:inline-flex; align-items:center; gap:6px; }
.pyr3-bar-filter-badge { background:var(--accent-soft, rgba(255,140,26,0.18)); color:var(--accent, #ff8c1a); border:1px solid var(--accent-border, #884a1a); padding:1px 6px; border-radius:8px; font-size:10px; }
```

- [ ] **Step 3: Update existing ui-bar tests + add coverage for the badge**

Existing `mountGalleryBar` tests construct opts without the new fields — pass `activeAxes: 0` and `onFilterToggle: () => {}`. Add a new test:

```ts
// Append to src/ui-bar.test.ts
describe('mountGalleryBar — filter pill', () => {
  it('badge hidden when activeAxes is 0', () => {
    const root = makeRoot();
    mountGalleryBar(root, { ...baseGalleryBarOpts(), activeAxes: 0 });
    const badge = root.querySelector('.pyr3-bar-filter-badge') as HTMLElement;
    expect(badge.style.display).toBe('none');
  });

  it('badge shown when activeAxes ≥ 1', () => {
    const root = makeRoot();
    const handle = mountGalleryBar(root, { ...baseGalleryBarOpts(), activeAxes: 2 });
    const badge = root.querySelector('.pyr3-bar-filter-badge') as HTMLElement;
    expect(badge.textContent).toBe('2 active');
    handle.setActiveAxes(0);
    expect(badge.style.display).toBe('none');
  });

  it('onFilterToggle fires on pill click', () => {
    const root = makeRoot();
    const onFilterToggle = vi.fn();
    mountGalleryBar(root, { ...baseGalleryBarOpts(), onFilterToggle });
    const pill = root.querySelector('.pyr3-bar-filter-pill') as HTMLAnchorElement;
    pill.click();
    expect(onFilterToggle).toHaveBeenCalled();
  });
});
```

(`baseGalleryBarOpts()` is the existing helper or its inline equivalent in `ui-bar.test.ts` — extend it with `activeAxes: 0, onFilterToggle: () => {}`.)

- [ ] **Step 4: Run tests + commit**

```bash
npm run typecheck && npm test
git add src/ui-bar.ts src/ui-bar.test.ts src/gallery-filter.ts src/gallery-filter.test.ts
git commit -m "feat(ui-bar): gallery bar [filters ▾] pill with active-axes badge"
```

### Task B3: Sort segmented control wired

**Files:**
- Modify: `src/gallery-filter-ui.ts`
- Modify: `src/gallery-filter-ui.test.ts`

- [ ] **Step 1: Test sort pill behavior**

```ts
describe('drawer sort control', () => {
  it('renders both sort pills with the active one highlighted', () => {
    dom();
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, sort: 'interest' },
      onChange: vi.fn(),
      facetCounts: { variations: new Map(), xforms: new Map(), total: 5 },
    });
    const timePill = root.querySelector('.pyr3-sort-pill[data-sort="time"]') as HTMLButtonElement;
    const intPill = root.querySelector('.pyr3-sort-pill[data-sort="interest"]') as HTMLButtonElement;
    expect(timePill.classList.contains('active')).toBe(false);
    expect(intPill.classList.contains('active')).toBe(true);
  });

  it('clicking a pill fires onChange with the new sort', () => {
    dom();
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      onChange,
      facetCounts: { variations: new Map(), xforms: new Map(), total: 5 },
    });
    const intPill = root.querySelector('.pyr3-sort-pill[data-sort="interest"]') as HTMLButtonElement;
    intPill.click();
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTER_SPEC, sort: 'interest' });
  });
});
```

- [ ] **Step 2: Replace the sort-row placeholder with the segmented control**

In `mountFilterDrawer`, where `sortRow` is built:

```ts
sortRow.replaceChildren();
const sortLabel = document.createElement('span');
sortLabel.className = 'pyr3-filter-row-label';
sortLabel.textContent = 'sort:';
sortRow.appendChild(sortLabel);

const sortPills: HTMLButtonElement[] = [];
for (const mode of ['time', 'interest'] as const) {
  const pill = document.createElement('button');
  pill.className = 'pyr3-sort-pill';
  pill.dataset.sort = mode;
  pill.textContent = mode;
  pill.onclick = () => opts.onChange({ ...currentFilter, sort: mode });
  sortPills.push(pill);
  sortRow.appendChild(pill);
}

const renderSortActive = (sort: 'time' | 'interest'): void => {
  for (const p of sortPills) {
    p.classList.toggle('active', p.dataset.sort === sort);
  }
};
renderSortActive(currentFilter.sort);
```

And inside the returned handle's `setFilter`:

```ts
setFilter(f) {
  currentFilter = f;
  renderSortActive(f.sort);
  // ... existing open/close logic
},
```

CSS additions (in injectStylesOnce):

```css
.pyr3-sort-pill { background:#1a1a20; color:#aaa; border:1px solid #2a2a30; padding:3px 10px; border-radius:3px; cursor:pointer; font-family:ui-monospace, monospace; font-size:12px; }
.pyr3-sort-pill.active { background:var(--accent-soft, rgba(255,140,26,0.18)); color:var(--accent, #ff8c1a); border-color:var(--accent-border, #884a1a); }
.pyr3-sort-pill:hover:not(.active) { background:#2a2a30; }
```

- [ ] **Step 3: Run tests + commit**

```bash
npm run typecheck && npm test
git add src/gallery-filter-ui.ts src/gallery-filter-ui.test.ts
git commit -m "feat(gallery-filter-ui): sort segmented control (time | interest)"
```

### Task B4: Xform from/to pickers + live count row

**Files:**
- Modify: `src/gallery-filter-ui.ts`
- Modify: `src/gallery-filter-ui.test.ts`

- [ ] **Step 1: Test xform picker interactions**

```ts
describe('drawer xform pickers', () => {
  it('renders count cells 1..10 with per-bucket counts', () => {
    dom();
    const root = document.createElement('div');
    const counts = new Map<number, number>([[1, 5], [2, 100], [3, 50], [10, 2]]);
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      onChange: vi.fn(),
      facetCounts: { variations: new Map(), xforms: counts, total: 157 },
    });
    const cells = root.querySelectorAll('.pyr3-xform-cell');
    expect(cells.length).toBe(10);
    // First cell shows "1 (5)"
    expect((cells[0] as HTMLElement).textContent).toContain('1');
    expect((cells[0] as HTMLElement).textContent).toContain('5');
    // 10+ cell
    expect((cells[9] as HTMLElement).textContent).toContain('10+');
    expect((cells[9] as HTMLElement).textContent).toContain('2');
  });

  it('cells inside the active [from, to] range are highlighted', () => {
    dom();
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, xformMin: 3, xformMax: 5 },
      onChange: vi.fn(),
      facetCounts: { variations: new Map(), xforms: new Map(), total: 50 },
    });
    const cells = Array.from(root.querySelectorAll('.pyr3-xform-cell')) as HTMLElement[];
    expect(cells[0].classList.contains('active')).toBe(false);  // 1
    expect(cells[2].classList.contains('active')).toBe(true);   // 3
    expect(cells[4].classList.contains('active')).toBe(true);   // 5
    expect(cells[5].classList.contains('active')).toBe(false);  // 6
  });

  it('changing from-picker fires onChange with new xformMin', () => {
    dom();
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      onChange,
      facetCounts: { variations: new Map(), xforms: new Map(), total: 100 },
    });
    const fromSel = root.querySelector('.pyr3-xform-from') as HTMLSelectElement;
    fromSel.value = '3';
    fromSel.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTER_SPEC, xformMin: 3 });
  });

  it('to-picker auto-clamps when from exceeds current to', () => {
    dom();
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, xformMin: 1, xformMax: 5 },
      onChange,
      facetCounts: { variations: new Map(), xforms: new Map(), total: 100 },
    });
    const fromSel = root.querySelector('.pyr3-xform-from') as HTMLSelectElement;
    fromSel.value = '8';
    fromSel.dispatchEvent(new Event('change'));
    // The next FilterSpec should auto-bump to to match the new from (or null).
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ xformMin: 8 }));
    const call = onChange.mock.calls[0][0] as FilterSpec;
    expect(call.xformMax === null || call.xformMax >= 8).toBe(true);
  });
});
```

- [ ] **Step 2: Implement the xform row**

Replace the `xformsRow` placeholder block. Build two `<select>` elements + a horizontal count row beneath. Wire change events to `opts.onChange`. Make sure `to` is clamped to ≥ `from`.

```ts
xformsRow.replaceChildren();
const xformsLabel = document.createElement('span');
xformsLabel.className = 'pyr3-filter-row-label';
xformsLabel.textContent = 'xforms:';
xformsRow.appendChild(xformsLabel);

const fromLabel = document.createTextNode(' from ');
const fromSel = document.createElement('select');
fromSel.className = 'pyr3-xform-from';
for (let i = 1; i <= 10; i++) {
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = i === 10 ? '10+' : String(i);
  fromSel.appendChild(opt);
}

const toLabel = document.createTextNode(' to ');
const toSel = document.createElement('select');
toSel.className = 'pyr3-xform-to';
const allOpt = document.createElement('option');
allOpt.value = 'all';
allOpt.textContent = 'all';
toSel.appendChild(allOpt);
for (let i = 1; i <= 10; i++) {
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = i === 10 ? '10+' : String(i);
  toSel.appendChild(opt);
}

xformsRow.append(fromLabel, fromSel, toLabel, toSel);

// Count strip — second row inside xformsRow's parent column.
const xformCountStrip = document.createElement('div');
xformCountStrip.className = 'pyr3-xform-count-strip';
const xformCellEls: HTMLElement[] = [];
for (let i = 1; i <= 10; i++) {
  const cell = document.createElement('span');
  cell.className = 'pyr3-xform-cell';
  cell.dataset.xform = String(i);
  xformCellEls.push(cell);
  xformCountStrip.appendChild(cell);
}
// Insert the count strip directly after the xforms row.
xformsRow.insertAdjacentElement('afterend', xformCountStrip);

function renderXformCells(filter: FilterSpec, counts: Map<number, number>): void {
  const cap = filter.xformMax === null ? 10 : Math.min(filter.xformMax, 10);
  for (let i = 1; i <= 10; i++) {
    const cell = xformCellEls[i - 1]!;
    const label = i === 10 ? '10+' : String(i);
    const n = counts.get(i) ?? 0;
    cell.textContent = `${label} (${n.toLocaleString()})`;
    cell.classList.toggle('active', i >= filter.xformMin && i <= cap);
    cell.classList.toggle('empty', n === 0);
  }
}

function syncXformPickers(filter: FilterSpec): void {
  fromSel.value = String(Math.max(1, Math.min(10, filter.xformMin)));
  toSel.value = filter.xformMax === null ? 'all' : String(Math.min(10, filter.xformMax));
}

syncXformPickers(currentFilter);
renderXformCells(currentFilter, currentCounts.xforms);

fromSel.addEventListener('change', () => {
  const lo = Math.max(1, Number.parseInt(fromSel.value, 10) || 1);
  let hi = currentFilter.xformMax;
  if (hi !== null && hi < lo) hi = lo;  // clamp; auto-bump to to ≥ from
  opts.onChange({ ...currentFilter, xformMin: lo, xformMax: hi });
});
toSel.addEventListener('change', () => {
  const v = toSel.value;
  const hi = v === 'all' ? null : Number.parseInt(v, 10);
  let lo = currentFilter.xformMin;
  if (hi !== null && lo > hi) lo = hi;
  opts.onChange({ ...currentFilter, xformMin: lo, xformMax: hi });
});
```

Update `setFilter` to call `syncXformPickers(f)` + `renderXformCells(f, currentCounts.xforms)`, and `setFacetCounts` to call `renderXformCells(currentFilter, c.xforms)`.

CSS:

```css
.pyr3-xform-from, .pyr3-xform-to { background:#1a1a20; color:#ddd; border:1px solid #2a2a30; padding:2px 6px; border-radius:3px; font-family:ui-monospace, monospace; }
.pyr3-xform-count-strip { display:flex; gap:8px; flex-wrap:wrap; padding:4px 0 4px 68px; }
.pyr3-xform-cell { color:#666; font-size:11px; }
.pyr3-xform-cell.active { color:var(--accent, #ff8c1a); }
.pyr3-xform-cell.empty { color:#444; font-style:italic; }
```

- [ ] **Step 3: Run tests + commit**

```bash
npm run typecheck && npm test
git add src/gallery-filter-ui.ts src/gallery-filter-ui.test.ts
git commit -m "feat(gallery-filter-ui): xform from/to pickers + live faceted count strip"
```

### Task B5: main.ts — mount the drawer + wire applyFilter into UI

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Mount the drawer below the gallery bar**

In `main.ts`'s gallery branch, after `mountGalleryBar`:

```ts
import { mountFilterDrawer, type FilterDrawerHandle } from './gallery-filter-ui';
import { computeFacetCounts, type FacetCounts } from './gallery-facets';
import { countActiveAxes } from './gallery-filter';

let drawerHandle: FilterDrawerHandle | null = null;
let drawerRoot: HTMLElement | null = null;

// After galleryBar mount:
drawerRoot = document.createElement('div');
drawerRoot.id = 'pyr3-gallery-filter-drawer-root';
// Insert beneath the bar root.
barRoot.insertAdjacentElement('afterend', drawerRoot);

const initialIndex = await ensureFeatureIndex();
const initialCounts: FacetCounts = computeFacetCounts(initialIndex, currentFilter);

drawerHandle = mountFilterDrawer(drawerRoot, {
  initialFilter: currentFilter,
  facetCounts: initialCounts,
  onChange: (next) => applyFilter(next),
});

// Bar pill toggles the drawer:
galleryBar = mountGalleryBar(barRoot, {
  // ... existing fields,
  activeAxes: countActiveAxes(currentFilter),
  onFilterToggle: () => drawerHandle?.toggleOpen(),
});
```

- [ ] **Step 2: applyFilter recomputes counts + sync's the drawer + pill**

Update `applyFilter`:

```ts
function applyFilter(nextFilter: FilterSpec): void {
  if (filterSpecEquals(currentFilter, nextFilter)) return;
  currentFilter = nextFilter;
  const url = galleryUrl(1, nextFilter);
  history.pushState({}, '', url);
  setDocTitle('gallery · p1');
  void ensureFeatureIndex().then((index) => {
    galleryTotalPages = totalPagesFiltered(nextFilter, GALLERY_PAGE_SIZE, { index });
    galleryBar?.setPage(1, galleryTotalPages);
    galleryBar?.setActiveAxes(countActiveAxes(nextFilter));
    const counts = computeFacetCounts(index, nextFilter);
    drawerHandle?.setFilter(nextFilter);
    drawerHandle?.setFacetCounts(counts);
    void galleryHandle?.setPage(1);
  });
}
```

- [ ] **Step 3: Cleanup drawer on surface swap**

Find where the gallery surface unmounts (search for `galleryHandle.destroy` / `galleryBar.destroy`) — add `drawerHandle?.destroy(); drawerRoot?.remove(); drawerHandle = null; drawerRoot = null;`.

- [ ] **Step 4: Chrome verify**

Run `npm run dev`. Open via `chrome-devtools-mcp`:

- Visit `http://localhost:5173/v1/gallery` — drawer closed, pill visible, "0 active" hidden.
- Click `[⚙ filters ▾]` — drawer opens with sort + xform controls.
- Click `interest` — drawer pill shows "1 active", grid reorders.
- Set xform `from=3`, `to=5` — pill shows "2 active", grid narrows.
- Click `✕ reset` — both axes clear, pill goes back to no badge.
- Refresh on `?sort=interest` — drawer opens automatically, `interest` pill is active.

- [ ] **Step 5: Typecheck + tests + commit**

```bash
npm run typecheck && npm test
git add src/main.ts
git commit -m "feat(main): mount filter drawer + wire applyFilter → counts/page/badge sync"
```

### Task B6: Empty-state + loading-state UX

**Files:**
- Modify: `src/gallery-mount.ts` (empty-state placeholder)
- Modify: `src/main.ts` (loading-state — drawer `loading` flag while index is in-flight)
- Modify: tests

- [ ] **Step 1: Test empty-state placeholder**

In `src/gallery-mount.test.ts`:

```ts
describe('runWave — empty filter result', () => {
  it('renders nine empty cells with "no flames match" when refs.length === 0', async () => {
    // ... build a mountGallery with a filter that matches nothing, then
    // inspect the DOM. Expected: all 9 cells in `.pyr3-gallery-cell.empty`
    // with the placeholder label text.
  });
});
```

- [ ] **Step 2: Wire the placeholder in main.ts**

When `pageOfSheepFiltered` returns `[]` for a non-default filter, render an inline message ABOVE the grid:

```ts
// Inside the gallery mount path, after mountGallery resolves:
const emptyBanner = document.createElement('div');
emptyBanner.className = 'pyr3-gallery-empty-banner';
emptyBanner.style.display = 'none';
emptyBanner.textContent = 'no flames match the current filter — try clearing variations or widening xforms.';
galleryContainer.insertBefore(emptyBanner, galleryContainer.firstChild);

function refreshEmptyBanner(total: number): void {
  emptyBanner.style.display = total === 0 ? 'block' : 'none';
}

// Inside applyFilter's promise body:
refreshEmptyBanner(counts.total);
```

CSS in `ui-bar.ts` or a new module-scoped style block:

```css
.pyr3-gallery-empty-banner { padding:12px 16px; color:var(--accent, #ff8c1a); font-family:ui-monospace, monospace; font-size:12px; text-align:center; }
```

- [ ] **Step 3: Loading state — drawer disabled until index lands**

In `main.ts`:

```ts
// When the gallery mounts BEFORE the index resolves, mount the drawer with
// `loading: true`. When the promise resolves, switch to loading: false +
// real counts.

drawerHandle = mountFilterDrawer(drawerRoot, {
  initialFilter: currentFilter,
  facetCounts: { variations: new Map(), xforms: new Map(), total: 0 },
  loading: true,
  onChange: (next) => applyFilter(next),
});

void ensureFeatureIndex().then((index) => {
  const counts = computeFacetCounts(index, currentFilter);
  drawerHandle?.setFacetCounts(counts);
  drawerHandle?.setLoading(false);
});
```

Add `setLoading(b: boolean)` to `FilterDrawerHandle`:

```ts
// In gallery-filter-ui.ts:
setLoading(b: boolean) {
  drawer.classList.toggle('loading', b);
},
```

- [ ] **Step 4: Run tests + commit**

```bash
npm run typecheck && npm test
git add src/main.ts src/gallery-mount.ts src/gallery-filter-ui.ts src/gallery-filter-ui.test.ts
git commit -m "feat(gallery): empty-state banner + drawer loading state while index in-flight"
```

### Task B7: Phase B ship — Chrome verify + FF-merge

- [ ] **Step 1: Final Chrome verify**

Run `npm run dev`. Walk through every interaction with `chrome-devtools-mcp`:
- Drawer open/close via pill.
- Sort time/interest cycle.
- Xform range from→to and the count strip live-updates.
- Reset clears everything.
- Refresh-restore of any non-default URL.
- Empty-state banner shows when filter matches nothing (e.g. `?xforms=29-30` if that yields zero).
- Loading state visible on a hard refresh (briefly).

- [ ] **Step 2: Hand off to user-verify-before-FF-merge**

Surface clickable URLs:
- `http://localhost:5173/v1/gallery`
- `http://localhost:5173/v1/gallery?sort=interest&xforms=2-4`

Wait for explicit approval.

- [ ] **Step 3: Squash-merge to main + deploy verify**

```bash
git checkout main
git merge --squash feature/issue-49-gallery-filter-phase-b
git commit -m "feat(gallery): Phase B — drawer + sort + xform UI + loading/empty states (#49)"
git push origin main
gh run watch $(gh run list --workflow=deploy.yml --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

After deploy: open `https://pyr3.app/v1/gallery` in Chrome; full interaction walk on the live site.

---

## Phase C — Variation picker

**Branch:** `feature/issue-49-gallery-filter-phase-c` (from updated main)
**Outcome:** The `(coming next)` stub is replaced by the real 3-group picker. Selecting/removing variations updates the URL + grid + counts. `#49 closes`.

### Task C1: Branch + variation-picker module

**Files:**
- Create: `src/variation-picker.ts`
- Create: `src/variation-picker.test.ts`

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull --ff-only
git checkout -b feature/issue-49-gallery-filter-phase-c
```

- [ ] **Step 2: Test the picker's 3-group structure + behavior**

```ts
// src/variation-picker.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Window } from 'happy-dom';
import { mountVariationPicker } from './variation-picker';
import { V, VARIATION_NAMES } from './variations';

function dom() {
  const w = new Window();
  // @ts-expect-error inject
  globalThis.document = w.document;
  // @ts-expect-error inject
  globalThis.HTMLElement = w.HTMLElement;
}

describe('mountVariationPicker', () => {
  it('renders all 91 variations across Available + Empty groups when no selection', () => {
    dom();
    const root = document.createElement('div');
    mountVariationPicker(root, {
      selected: [],
      counts: new Map(Object.values(V).map((idx) => [idx as number, 100])),
      onChange: vi.fn(),
    });
    const avail = root.querySelectorAll('.pyr3-var-group.available .pyr3-var-row');
    expect(avail.length).toBe(Object.keys(V).length);
  });

  it('selected variations appear in the Selected group with × buttons', () => {
    dom();
    const root = document.createElement('div');
    mountVariationPicker(root, {
      selected: [V.julia, V.linear],
      counts: new Map(),
      onChange: vi.fn(),
    });
    const selected = Array.from(root.querySelectorAll('.pyr3-var-group.selected .pyr3-var-row')) as HTMLElement[];
    expect(selected.length).toBe(2);
    // Alphabetical: julia before linear
    expect(selected[0].textContent).toContain('julia');
    expect(selected[1].textContent).toContain('linear');
  });

  it('clicking an Available row fires onChange adding the variation', () => {
    dom();
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountVariationPicker(root, {
      selected: [],
      counts: new Map([[V.julia, 100]]),
      onChange,
    });
    const row = root.querySelector(`.pyr3-var-row[data-var="${V.julia}"]`) as HTMLElement;
    row.click();
    expect(onChange).toHaveBeenCalledWith([V.julia]);
  });

  it('clicking a × on a Selected row removes it', () => {
    dom();
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountVariationPicker(root, {
      selected: [V.julia, V.linear],
      counts: new Map(),
      onChange,
    });
    const remove = root.querySelector(`.pyr3-var-group.selected .pyr3-var-row[data-var="${V.julia}"] .pyr3-var-remove`) as HTMLElement;
    remove.click();
    expect(onChange).toHaveBeenCalledWith([V.linear]);
  });

  it('Empty group rows are dim + italic but still clickable', () => {
    dom();
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountVariationPicker(root, {
      selected: [],
      counts: new Map([[V.julia, 100]]),  // linear absent → Empty
      onChange,
    });
    const emptyRow = root.querySelector(`.pyr3-var-group.empty .pyr3-var-row[data-var="${V.linear}"]`) as HTMLElement;
    expect(emptyRow).toBeTruthy();
    emptyRow.click();
    expect(onChange).toHaveBeenCalledWith([V.linear]);
  });

  it('groups stay alphabetical within themselves', () => {
    dom();
    const root = document.createElement('div');
    mountVariationPicker(root, {
      selected: [],
      counts: new Map([[V.julia, 1], [V.linear, 1], [V.spherical, 1]]),
      onChange: vi.fn(),
    });
    const rows = Array.from(root.querySelectorAll('.pyr3-var-group.available .pyr3-var-row')) as HTMLElement[];
    const names = rows.map((r) => r.dataset.varName!).filter((n) => ['julia', 'linear', 'spherical'].includes(n));
    expect(names).toEqual(['julia', 'linear', 'spherical']);
  });
});
```

- [ ] **Step 3: Implement the picker**

```ts
// src/variation-picker.ts
// The faceted variation picker that lives inside the gallery filter
// drawer. Three alphabetized groups: Selected (× to remove), Available
// (count > 0), Empty (count == 0). Counts arrive from gallery-facets's
// leave-one-out computation — the picker is presentational.

import { V, VARIATION_NAMES } from './variations';

export interface VariationPickerOpts {
  /** Currently-selected variation indices. */
  selected: number[];
  /** Live counts from computeFacetCounts(...).variations. */
  counts: Map<number, number>;
  /** Fired when the visitor toggles a variation. Argument is the next set,
   *  sorted ascending (caller may sort/dedupe further). */
  onChange(nextSelected: number[]): void;
}

export interface VariationPickerHandle {
  setState(opts: { selected: number[]; counts: Map<number, number> }): void;
  destroy(): void;
}

const ALL_VARIATIONS: Array<{ idx: number; name: string }> = Object.entries(V)
  .map(([name, idx]) => ({ name, idx: idx as number }))
  .sort((a, b) => a.name.localeCompare(b.name));

const STYLES_ID = 'pyr3-variation-picker-styles';

function injectStylesOnce(): void {
  if (document.getElementById(STYLES_ID)) return;
  const style = document.createElement('style');
  style.id = STYLES_ID;
  style.textContent = `
.pyr3-var-picker { font-family:ui-monospace, monospace; font-size:12px; color:#ddd; }
.pyr3-var-group { padding:4px 0; }
.pyr3-var-group-label { color:#888; padding:2px 0; }
.pyr3-var-row { display:flex; justify-content:space-between; align-items:center; padding:2px 8px; cursor:pointer; border-radius:3px; }
.pyr3-var-row:hover { background:#2a2a30; }
.pyr3-var-group.empty .pyr3-var-row { color:#555; font-style:italic; }
.pyr3-var-remove { color:#aaa; padding:0 6px; }
.pyr3-var-remove:hover { color:#ff7a7a; }
.pyr3-var-count { color:#888; font-size:11px; }
`;
  document.head.appendChild(style);
}

export function mountVariationPicker(root: HTMLElement, opts: VariationPickerOpts): VariationPickerHandle {
  injectStylesOnce();
  root.replaceChildren();
  const wrapper = document.createElement('div');
  wrapper.className = 'pyr3-var-picker';
  root.appendChild(wrapper);

  let currentSelected = [...opts.selected];
  let currentCounts = opts.counts;

  function render(): void {
    wrapper.replaceChildren();

    const selectedSet = new Set(currentSelected);

    // Selected group
    if (currentSelected.length > 0) {
      const g = document.createElement('div');
      g.className = 'pyr3-var-group selected';
      const label = document.createElement('div');
      label.className = 'pyr3-var-group-label';
      label.textContent = `Selected (${currentSelected.length})`;
      g.appendChild(label);
      const sel = ALL_VARIATIONS.filter((v) => selectedSet.has(v.idx));
      // ALL_VARIATIONS is already alphabetical → filter preserves order.
      for (const v of sel) {
        const row = document.createElement('div');
        row.className = 'pyr3-var-row';
        row.dataset.var = String(v.idx);
        row.dataset.varName = v.name;
        const name = document.createElement('span');
        name.textContent = v.name;
        const x = document.createElement('span');
        x.className = 'pyr3-var-remove';
        x.textContent = '×';
        x.onclick = (e) => {
          e.stopPropagation();
          opts.onChange(currentSelected.filter((i) => i !== v.idx).sort((a, b) => a - b));
        };
        row.append(name, x);
        g.appendChild(row);
      }
      wrapper.appendChild(g);
    }

    // Available + Empty groups — exclude already-selected, split by count.
    const unselected = ALL_VARIATIONS.filter((v) => !selectedSet.has(v.idx));
    const available = unselected.filter((v) => (currentCounts.get(v.idx) ?? 0) > 0);
    const empty = unselected.filter((v) => (currentCounts.get(v.idx) ?? 0) === 0);

    if (available.length > 0) {
      const g = document.createElement('div');
      g.className = 'pyr3-var-group available';
      const label = document.createElement('div');
      label.className = 'pyr3-var-group-label';
      label.textContent = `Available (${available.length})`;
      g.appendChild(label);
      for (const v of available) {
        const row = document.createElement('div');
        row.className = 'pyr3-var-row';
        row.dataset.var = String(v.idx);
        row.dataset.varName = v.name;
        const name = document.createElement('span');
        name.textContent = v.name;
        const count = document.createElement('span');
        count.className = 'pyr3-var-count';
        count.textContent = `(${(currentCounts.get(v.idx) ?? 0).toLocaleString()})`;
        row.append(name, count);
        row.onclick = () => {
          opts.onChange([...currentSelected, v.idx].sort((a, b) => a - b));
        };
        g.appendChild(row);
      }
      wrapper.appendChild(g);
    }

    if (empty.length > 0) {
      const g = document.createElement('div');
      g.className = 'pyr3-var-group empty';
      const label = document.createElement('div');
      label.className = 'pyr3-var-group-label';
      label.textContent = `Empty (${empty.length})`;
      g.appendChild(label);
      for (const v of empty) {
        const row = document.createElement('div');
        row.className = 'pyr3-var-row';
        row.dataset.var = String(v.idx);
        row.dataset.varName = v.name;
        const name = document.createElement('span');
        name.textContent = v.name;
        const count = document.createElement('span');
        count.className = 'pyr3-var-count';
        count.textContent = '(0)';
        row.append(name, count);
        row.onclick = () => {
          opts.onChange([...currentSelected, v.idx].sort((a, b) => a - b));
        };
        g.appendChild(row);
      }
      wrapper.appendChild(g);
    }
  }

  render();

  return {
    setState({ selected, counts }) {
      currentSelected = [...selected];
      currentCounts = counts;
      render();
    },
    destroy() {
      root.replaceChildren();
    },
  };
}
```

- [ ] **Step 4: Run tests — pass**

```bash
npx vitest run src/variation-picker.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck + suite + commit**

```bash
npm run typecheck && npm test
git add src/variation-picker.ts src/variation-picker.test.ts
git commit -m "feat(variation-picker): 3-group faceted dropdown with alphabetized rows"
```

### Task C2: Wire variation picker into the drawer

**Files:**
- Modify: `src/gallery-filter-ui.ts`
- Modify: `src/gallery-filter-ui.test.ts`

- [ ] **Step 1: Test: drawer's vars row mounts a variation picker; selecting updates filter**

```ts
describe('drawer vars row + picker', () => {
  it('clicking [+ add ▾] toggles the picker open', () => {
    dom();
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      onChange: vi.fn(),
      facetCounts: { variations: new Map(), xforms: new Map(), total: 0 },
    });
    const addBtn = root.querySelector('.pyr3-vars-add-btn') as HTMLButtonElement;
    expect(root.querySelector('.pyr3-var-picker')).toBeFalsy();
    addBtn.click();
    expect(root.querySelector('.pyr3-var-picker')).toBeTruthy();
  });

  it('picker onChange propagates as a FilterSpec update with the new vars', () => {
    dom();
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      onChange,
      facetCounts: { variations: new Map([[V.julia, 100]]), xforms: new Map(), total: 100 },
    });
    (root.querySelector('.pyr3-vars-add-btn') as HTMLButtonElement).click();
    const julia = root.querySelector(`.pyr3-var-row[data-var="${V.julia}"]`) as HTMLElement;
    julia.click();
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTER_SPEC, vars: [V.julia] });
  });

  it('active selections render as chips outside the picker', () => {
    dom();
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, vars: [V.julia, V.linear] },
      onChange: vi.fn(),
      facetCounts: { variations: new Map(), xforms: new Map(), total: 5 },
    });
    const chips = root.querySelectorAll('.pyr3-vars-chip');
    expect(chips.length).toBe(2);
  });
});
```

- [ ] **Step 2: Replace the `varsRow` placeholder**

In `mountFilterDrawer`, where `varsRow` was previously stubbed as `"vars: (coming next)"`:

```ts
import { mountVariationPicker, type VariationPickerHandle } from './variation-picker';
import { VARIATION_NAMES } from './variations';

// ... inside mountFilterDrawer:
varsRow.replaceChildren();
const varsLabel = document.createElement('span');
varsLabel.className = 'pyr3-filter-row-label';
varsLabel.textContent = 'vars:';
varsRow.appendChild(varsLabel);

const addBtn = document.createElement('button');
addBtn.className = 'pyr3-vars-add-btn';
addBtn.textContent = '+ add ▾';
varsRow.appendChild(addBtn);

const chipsContainer = document.createElement('span');
chipsContainer.className = 'pyr3-vars-chips';
varsRow.appendChild(chipsContainer);

const pickerPanel = document.createElement('div');
pickerPanel.className = 'pyr3-vars-picker-panel';
pickerPanel.style.display = 'none';
varsRow.insertAdjacentElement('afterend', pickerPanel);

let pickerHandle: VariationPickerHandle | null = null;
let pickerOpen = false;

function renderChips(vars: number[]): void {
  chipsContainer.replaceChildren();
  for (const v of vars) {
    const chip = document.createElement('span');
    chip.className = 'pyr3-vars-chip';
    chip.textContent = `${VARIATION_NAMES[v]} ×`;
    chip.onclick = () => opts.onChange({ ...currentFilter, vars: currentFilter.vars.filter((i) => i !== v) });
    chipsContainer.appendChild(chip);
  }
}

function togglePicker(): void {
  pickerOpen = !pickerOpen;
  pickerPanel.style.display = pickerOpen ? 'block' : 'none';
  if (pickerOpen && pickerHandle === null) {
    pickerHandle = mountVariationPicker(pickerPanel, {
      selected: currentFilter.vars,
      counts: currentCounts.variations,
      onChange: (nextVars) => opts.onChange({ ...currentFilter, vars: nextVars }),
    });
  } else if (pickerOpen && pickerHandle !== null) {
    pickerHandle.setState({ selected: currentFilter.vars, counts: currentCounts.variations });
  }
}

addBtn.onclick = togglePicker;
renderChips(currentFilter.vars);
```

Update `setFilter` and `setFacetCounts` to call `renderChips(f.vars)` and `pickerHandle?.setState({...})`.

Click-outside dismissal: add a `document.addEventListener('click', …)` that closes the picker when the click target is outside `pickerPanel` AND outside `addBtn`. Remove this listener in `destroy()`.

CSS:

```css
.pyr3-vars-add-btn { background:#1a1a20; color:#aaa; border:1px solid #2a2a30; padding:3px 10px; border-radius:3px; cursor:pointer; font-family:ui-monospace, monospace; font-size:12px; }
.pyr3-vars-add-btn:hover { background:#2a2a30; }
.pyr3-vars-chips { display:inline-flex; gap:6px; flex-wrap:wrap; padding-left:6px; }
.pyr3-vars-chip { background:var(--accent-soft, rgba(255,140,26,0.18)); color:var(--accent, #ff8c1a); border:1px solid var(--accent-border, #884a1a); padding:2px 8px; border-radius:8px; font-size:11px; cursor:pointer; }
.pyr3-vars-chip:hover { background:#3a2a1a; }
.pyr3-vars-picker-panel { padding:8px 16px 12px 76px; max-height:400px; overflow-y:auto; border-bottom:1px solid #2a2a30; }
```

- [ ] **Step 3: Chrome verify**

`npm run dev` and walk through:
- Open drawer, click `[+ add ▾]`.
- Picker opens below with all 91 variations under "Available".
- Click `julia` — picker stays open, chip appears in the drawer row, gallery narrows.
- Open picker again (or re-click `[+ add ▾]`): notice the Available group counts have dropped (leave-one-out), Empty group populated.
- Click `linear` if Empty/Available — adds. Two chips visible.
- Click `×` on a chip — removes the variation, picker updates.
- Click outside the picker — picker closes.
- Reset pill clears everything.

- [ ] **Step 4: Run unit tests + commit**

```bash
npm run typecheck && npm test
git add src/gallery-filter-ui.ts src/gallery-filter-ui.test.ts
git commit -m "feat(gallery-filter-ui): wire variation picker into drawer + active-chip strip"
```

### Task C3: Phase C ship — Chrome verify + FF-merge + close #49

- [ ] **Step 1: Full Chrome verify on the integration**

Walk every interaction one final time. Pay special attention to:
- Variation picker counts update correctly after each toggle (leave-one-out).
- Refresh on `?vars=julia,linear&sort=interest&xforms=2-5` restores the full state.
- Browser back/forward across multiple filter changes.
- The 91-name picker scrolls smoothly inside the picker-panel.

- [ ] **Step 2: User-verify-before-FF-merge**

Surface URLs for manual click-through. Wait for explicit approval.

- [ ] **Step 3: Squash-merge to main + deploy verify**

```bash
git checkout main
git merge --squash feature/issue-49-gallery-filter-phase-c
git commit -m "feat(gallery): Phase C — variation picker (faceted 3-group) ships #49"
git push origin main
gh run watch $(gh run list --workflow=deploy.yml --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

After deploy: open the live site and click through the picker.

- [ ] **Step 4: Close #49**

```bash
gh issue close 49 --comment "Shipped across Phase A/B/C. Final UI live at https://pyr3.app/v1/gallery — drawer pill, sort modes (time/interest), xform range with live faceted counts, variation picker with Selected/Available/Empty groups, URL state via querystring with defaults omitted. Supersedes #4 (corpus discovery) and the sort-half of #24 (skip-to-interesting)."
```

---

---

## Phase C (NEW — stat-range filters)

**Branch:** `feature/issue-49-gallery-filter-phase-c-stat-filters`
**Outcome:** Four new `from/to` range filters — `coverage`, `entropy`,
`colorVar`, `meanLum` — each operating on the corresponding 0..1 quantized
stat in `features.flam3idx`. UI mirrors the xform range pattern (two
pickers + a discretized count strip). URL gets four new params.
Faceted "leave-one-out" rule applies to each stat axis individually.

The 4 stats are 0..1 floats (q8-quantized at bake time, dequantized to
`/255` precision on read). UI buckets them into deciles (0.0..0.1,
0.1..0.2, …, 0.9..1.0). Filter math operates on continuous values
(no need to align with UI buckets).

### Task C1: Extend FilterSpec for stat ranges

**Files:** `src/gallery-filter.ts`, `src/gallery-filter.test.ts`

- Add 8 new fields to `FilterSpec` (4 pairs of `{stat}Min` / `{stat}Max`),
  defaults `0` and `null`.
- Extend `DEFAULT_FILTER_SPEC` with the 8 new fields (all defaults).
- `parseFilterSpec` recognizes `coverage`, `entropy`, `colorVar`,
  `meanLum` params using the same `N`, `N-`, `N-M`, `N-N` grammar as
  xforms — only difference: values are 0..1 floats, not integers.
- `encodeFilterSpec` emits each only when non-default.
- `filterSpecEquals` updated to compare the new fields.
- `countActiveAxes` returns 1 per stat-axis pair that differs from
  default (max 4 additional axes).
- Unit tests: parse/encode round-trip for each stat, defaults
  omitted, malformed values fall through to defaults.

Commit: `feat(gallery-filter): FilterSpec extended with stat-range axes`

### Task C2: gallery-facets — facet counts for stat buckets

**Files:** `src/gallery-facets.ts`, `src/gallery-facets.test.ts`

- Add `coverage`, `entropy`, `colorVar`, `meanLum` Maps to
  `FacetCounts` interface, each keyed `0..9` for decile bucket index.
- `computeFacetCounts` extends to bucket by decile per stat,
  applying leave-one-out on the bucketed axis (same pattern as xform).
- Unit tests for each stat's bucketing + leave-one-out.

Commit: `feat(gallery-facets): decile-bucket counts for the 4 stat axes`

### Task C3: gallery-mount — apply stat-range filters in master-list build

**Files:** `src/gallery-mount.ts`, `src/gallery-mount.test.ts`

- `buildMasterList` extends to check each stat range: `rec.coverage
  >= spec.coverageMin` AND (`spec.coverageMax === null` ||
  `rec.coverage <= spec.coverageMax`). Repeat for the other 3.
- Tests: each stat narrows correctly; combined narrowings compose.

Commit: `feat(gallery-mount): stat-range filter pass in buildMasterList`

### Task C4: UI — four new rows in the drawer + count strips

**Files:** `src/gallery-filter-ui.ts`, `src/gallery-filter-ui.test.ts`

- Add 4 new `.pyr3-filter-row.stat-{name}` rows below the xforms row.
- Each row: from/to pickers (`0.0, 0.1, …, 1.0`) + 10-cell count
  strip (deciles). UX matches xform exactly.
- Picker options are `0.0..1.0` in 0.1 steps; `all` on the `to`
  side. Same `to >= from` auto-clamp invariant as xform.
- `setFacetCounts` updates all 4 stat strips alongside variations
  and xforms.

Commit: `feat(gallery-filter-ui): four stat-range filter rows`

### Task C5: Wire + Chrome verify + ship

- main.ts: nothing changes (the drawer + URL plumbing already routes
  any FilterSpec change through `applyFilter`).
- Chrome verify: open drawer, set `coverage` from 0.5, watch grid
  narrow + counts update across all axes.
- User-verify-before-FF-merge, squash-merge, deploy verify.

Commit: `feat(gallery): Phase C — stat-range filters (#49)`

---

## Phase D — Variation picker

(Content of the original "Phase C" stays as-is — task lists C1, C2,
C3 above this expansion are accurate for the variation picker. The
branch name should be `feature/issue-49-gallery-filter-phase-d` and
the squash-merge commit `feat(gallery): Phase D — variation picker
(faceted 3-group)`.)

---

## Phase E (NEW — tunable interest weights slider panel)

**Branch:** `feature/issue-49-gallery-filter-phase-e-weight-tuner`
**Outcome:** Slider panel anchored to (or triggered from) the interest
sort pill. Four sliders edit the weights of the interest-score formula;
URL round-trips via `weights=` param when `sort=custom`. Preset pills
auto-highlight when sliders match a known preset.

### Task E1: Extend feature-score.ts with named presets + custom mode

**Files:** `src/feature-score.ts`, `src/feature-score.test.ts`

- Export `PRESET_WEIGHTS: Record<SortPreset, ScoreWeights>`:
  - `interest`: the existing `DEFAULT_SCORE_WEIGHTS`
  - `coverage`: `{coverage: 1, entropy: 0, colorVar: 0, dimPenalty: 0}`
  - `entropy`: `{coverage: 0, entropy: 1, colorVar: 0, dimPenalty: 0}`
  - `colorVar`: `{coverage: 0, entropy: 0, colorVar: 1, dimPenalty: 0}`
  - `meanLum`: `{coverage: 0, entropy: 0, colorVar: 0, dimPenalty: 1}`
- `weightsToPresetName(w): SortPreset | null` — exact match against
  `PRESET_WEIGHTS`, returns the preset name or null for "custom".
- `interestScore` already accepts custom weights — no signature change.

Commit: `feat(feature-score): named-preset weight tuples + reverse lookup`

### Task E2: Extend FilterSpec with `weights` field + sort union

**Files:** `src/gallery-filter.ts`, `src/gallery-filter.test.ts`

- Widen `SortMode` to include the 4 new preset names + `custom`.
- Add `weights: ScoreWeights | null` to `FilterSpec`; null means "use
  the sort name's preset" (or N/A for `time`).
- `parseFilterSpec`:
  - `sort=time` → unchanged.
  - `sort=interest|coverage|entropy|colorVar|meanLum` → ensure
    `weights === null` (presets imply weights; explicit weights are
    only honored for `sort=custom`).
  - `sort=custom&weights=A,B,C,D` → weights tuple (4 floats, sum
    sanity-check; null on parse fail).
- `encodeFilterSpec`:
  - Named-preset sort emits only `sort=<name>`, NEVER `weights=`.
  - `sort=custom` emits both `sort=custom` AND `weights=`.
- Unit tests cover all 7 sort modes + custom-weights round-trip.

Commit: `feat(gallery-filter): expand SortMode + weights field`

### Task E3: gallery-mount — pass weights into interestScore call

**Files:** `src/gallery-mount.ts`

- `buildMasterList`'s interest-sort branch reads `effectiveWeights`:
  - `sort === 'custom'` → `spec.weights ?? DEFAULT_SCORE_WEIGHTS`
  - Named preset → `PRESET_WEIGHTS[spec.sort]`
  - `time` → no-op (chronological)
- Single change: replace `interestScore(rec)` with
  `interestScore(rec, effectiveWeights)`.

Commit: `feat(gallery-mount): route preset / custom weights into interest sort`

### Task E4: UI — preset pills with auto-highlight + tune ▾ panel

**Files:** `src/gallery-filter-ui.ts`, `src/gallery-filter-ui.test.ts`

- Sort row already has 6 preset pills from Phase B (`time`,
  `interest`, `coverage`, `entropy`, `colorVar`, `meanLum`). Phase E
  adds a 7th: `[tune ▾]` button anchored to the interest pill (or
  adjacent).
- Clicking a preset pill commits `{sort: <name>, weights: null}`.
- `[tune ▾]` opens a small popover panel below the bar:
  - 4 sliders (`coverage`, `entropy`, `colorVar`, `dimPenalty`),
    each `0..1` in 0.05 steps.
  - "Reset to interest defaults" button (re-emits
    `sort=interest`, clears weights).
  - Live: each slider drag emits a new FilterSpec where:
    - if the new weights tuple matches `PRESET_WEIGHTS[X]` exactly
      → `sort=X`, `weights=null`
    - else → `sort=custom`, `weights=<tuple>`
- Active pill state: the pill matching the current sort highlights.
  For `sort=custom`, NO preset pill highlights (the `[tune ▾]` button
  shows as active instead).

Commit: `feat(gallery-filter-ui): tune-weights panel with preset auto-highlight`

### Task E5: Chrome verify + ship

- Chrome verify: click each preset pill, watch grid reorder, watch
  pill highlight reflect URL. Open `[tune ▾]`, drag sliders, watch
  `sort=custom&weights=...` appear in URL. Drag back to a preset's
  values → that preset's pill auto-highlights, weights disappear
  from URL.
- User-verify-before-FF-merge, squash-merge, deploy verify.
- Close #49.

Commit: `feat(gallery): Phase E — tunable interest weights slider panel (#49 closes)`

---

## Self-review checklist (executed during plan writing)

- **Spec coverage:** Every locked decision in the spec maps to at least one task. URL contract (A2), variation logic AND (A3 + A5), faceted leave-one-out (A3), drawer auto-open (B1), sort segmented (B3), xform range (B4), reset pill (B1), loading state (B6), empty state (B6), variation picker 3 groups (C1+C2). ✓
- **Placeholder scan:** No `TBD` / `implement later` / "similar to Task N" present. Each step shows complete code. ✓
- **Type consistency:** `FilterSpec` shape stable across all tasks. `FacetCounts` shape stable. `FilterDrawerOpts` evolves only by adding fields with sensible defaults. `mountGallery` extensions are additive. ✓
- **Cross-references:** `feature-index-client.ts:forEachRecord` (A3) is consumed by `gallery-facets.ts` (A3) and `gallery-mount.ts:buildMasterList` (A5) — both reference the same signature. ✓
- **Test idiom drift:** Stub-index `makeStubIndex` is duplicated between `gallery-facets.test.ts` and `gallery-mount.test.ts`. Acceptable for v1 — the duplication keeps test files independently readable; an extraction can land later if a third consumer appears. ✓

