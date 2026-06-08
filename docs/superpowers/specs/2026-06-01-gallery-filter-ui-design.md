# Gallery filter UI — v1.2 design spec

**Issue:** #49 — Gallery search/filter affordances — variation, xform, sort
**Milestone:** `v1.2 - gallery and discovery`
**Date:** 2026-06-01
**Status:** locked via brainstorm; ready for implementation plan

---

## Goal

Turn pyr3's gallery from a flat ~5,800-page sequential walk into a real
**discovery surface**. The 2026-05-31 #21 restructure made the architectural
call — "gallery = discovery surface, viewer = view-only" — and #48
(features.flam3idx) was built to power that surface. Without #49, the
gallery is a slideshow over canonical corpus order and the feature index
is dead weight.

The minimum that makes the gallery genuinely a discovery surface is **both
a content filter and a non-canonical sort**. Sort alone is still
sequential. Filter alone leaves hundreds of pages.

## Scope (v1.2 — expanded 2026-06-01)

The original brainstorm scope (variation filter + xform range filter +
two sort modes) is preserved. Three additions came out of mid-Phase-A
verify, all logical companions in the discovery surface:

1. **Named single-axis sort presets** — `coverage` / `entropy` /
   `colorVar` / `meanLum` alongside `time` / `interest`.
2. **Tunable interest weights** — slider panel that edits the four
   weights of the interest-score formula; round-trips via URL.
3. **Stat-range filters** — same from/to UX as xform, but for the
   four 0..1 stats (coverage / entropy / colorVar / meanLum).

The sort presets and the slider panel are **two UI surfaces over the
same data** (the weights tuple). Clicking a preset pill = setting
sliders to that preset's weights; moving any slider away from a known
preset → no pill highlighted (custom mode); moving back to a preset's
values → that pill auto-highlights. Same underlying state, two views.

**In:**
- **Filter by variation** — faceted multi-select picker (AND semantics
  across selected variations).
- **Filter by xform count** — `from`/`to` range. `from` defaults to 1
  (required); `to` defaults to `all` (no upper cap). UI offers `1..15`
  (covers p95 of corpus distribution); power users can hand-type
  `xforms=25-30` via URL for tail values.
- **Filter by stat range** — same from/to UX as xform, applied to each
  of `coverage`, `entropy`, `colorVar`, `meanLum`. Sliders or text
  inputs in `0.0..1.0` 0.1-step resolution.
- **Sort modes — 6 preset pills** —
  - `time` (chronological, default; not a weighted sort)
  - `interest` (canonical weighted combo — the default weights from
    `src/feature-score.ts:DEFAULT_SCORE_WEIGHTS`)
  - `coverage` (preset weights: `{cov:1, ent:0, col:0, dim:0}`)
  - `entropy` (preset: `{cov:0, ent:1, col:0, dim:0}`)
  - `colorVar` (preset: `{cov:0, ent:0, col:1, dim:0}`)
  - `meanLum` (preset: `{cov:0, ent:0, col:0, dim:1}`)
- **Tunable interest weights** — slider panel anchored to (or
  triggered from) the interest pill. Four sliders: `coverage`,
  `entropy`, `colorVar`, `dimPenalty`. Reset-to-defaults button
  restores the canonical weights. Slider state ↔ URL `weights=` param
  (clean round-trip).
- **Reset/clear-all pill** — restores all filter + sort defaults;
  clears URL params.
- **URL state** — query string after the page path; defaults omitted;
  refresh restores filter state; browser back/forward respects filter
  history.
- **URL self-canonicalization** — on gallery mount, if the parsed
  FilterSpec doesn't round-trip to the URL (unknown variation names,
  malformed param formats), `history.replaceState` rewrites to the
  canonical form. `console.warn` for dropped tokens. (Phase A
  delivered — see "Locked decisions" below.)
- **Collapsible drawer** — single `[⚙ filters ▾ (N active)]` pill in the
  gallery bar; click toggles a drawer under the bar; auto-opens iff the
  URL has any filter param.

**Out (explicitly deferred to follow-ups):**
- **Random sort** — the existing 🎲 pill (gallery `random page` + #23
  viewer-side dice) already covers random discovery. Adding `sort=random`
  would be functional duplication.
- **Thumbnail dedup** — ESF v0.7's `is_thumb_representative` flag would
  collapse the 52,175 indexed flames to ~51,257 visually-distinct
  representatives. Out of scope for #49; tracked separately. Filter +
  sort already moves the needle without dedup.
- **Find-similar / cluster-by-pattern** — likely v1.3+.
- **Saving named filter sets** — niche; URL deep-linking is the
  bookmark mechanism.
- **Filter the corpus tar (52,365 flames)** — filter operates on the
  indexed subset (52,175). The ~190 unindexed flames are zero-xform /
  bake-error corpses already filtered by the bake CLI.

## Locked decisions (brainstorm Q&A — 2026-06-01)

1. **Filter scope:** all four affordances ship in v1.2's first cut.
2. **Layout:** collapsible drawer (pill in bar, tray below).
   Defaults closed; auto-opens iff URL carries any filter param.
3. **URL encoding:** query string after the page path, defaults omitted.
4. **Variation logic:** AND across selected variations.
5. **Variation picker:** faceted dropdown with three alphabetized groups
   — Selected (× to remove) / Available (count > 0) / Empty (count == 0,
   greyed but still clickable). Counts always reflect ALL OTHER active
   filters.
6. **Xform filter:** range with `from`/`to` integer pickers + a live per-
   value count row. `from` defaults to 1 (required); `to` defaults to
   `all`. Tail collapses at `10+`. UI prevents `to < from`.
7. **Sort modes:** `time` (default) | `interest`. Segmented control,
   mutually exclusive. **Random removed** (🎲 pill already covers it).
8. **Reset pill:** single button in drawer; restores all defaults;
   clears the URL's filter params.
9. **Index subset:** filter always operates on the 52,175 indexed
   flames (the ~190 unindexed are excluded — consistent UX whether or
   not a filter is active).
10. **xform bucket range (2026-06-01, post-data measurement):** real
    distribution shows mean 6.32 / median 5 / p95 14 / p99 17, with a
    spike at 12 (6.21% — 2nd-largest bucket after 3 and 4). UI offers
    `from`/`to` integer pickers covering `1..15` (captures p95). The
    count strip displays per-value cells up to a threshold (likely
    `1..13` with `14+` collapse — Phase B finalizes). Beyond 15:
    power users hand-type `xforms=N-M` for any integer values.
11. **Sort presets are URL-first-class:** the URL emits `sort=<name>`
    for the 6 named presets (terse, shareable). `sort=custom` is the
    only form that carries `weights=`. Named presets do NOT emit
    `weights=` — the name implies the canonical weights tuple.
12. **Button↔slider auto-link:** clicking a preset pill commits the
    preset's weights (replaces any prior weights). Slider panel reflects
    current weights live; moving any slider to non-preset values flips
    `sort` to `custom`; matching a preset's values flips back to that
    preset's name. The DOM source of truth is the URL.
13. **URL self-canonicalization (Phase A delivered):** on mount, if
    `parseLoadIntent` drops any tokens (unknown variation names,
    malformed xform params), `history.replaceState` rewrites the URL
    to its canonical form so the address bar can never lie about
    what's actually applied. `console.warn` for dropped tokens makes
    typos discoverable.

## URL contract

Page stays in the path; filters/sort ride as standard query params via
`URLSearchParams`. Defaults are OMITTED — a clean canonical-order browse
stays at `/v1/gallery/p/N` with no querystring. Page 1 still collapses
to bare `/v1/gallery`.

```text
Recognized params (all optional; defaults omitted):
  sort     = time | interest | coverage | entropy | colorVar | meanLum | custom
                                                  (default: time)
  weights  = "cov,ent,col,dim" four-tuple of 0..1 floats, ONLY meaningful
             when sort=custom; default weights are implicit when
             sort=interest (no weights param emitted)
  vars     = comma-separated variation names      (default: empty → AND of {})
  xforms   = "N" (≥N), "N-" (≥N), "N-all" (≥N), "N-M" (closed range
             inclusive), or "N-N" (exact)         (default: 1, no cap)
  coverage = same N / N- / N-M grammar as xforms, values 0..1 float
                                                  (default: full range)
  entropy  = same grammar                         (default: full range)
  colorVar = same grammar                         (default: full range)
  meanLum  = same grammar                         (default: full range)

Examples:
  /v1/gallery                                        — page 1, no filters
  /v1/gallery/p/3                                    — page 3, no filters
  /v1/gallery?sort=interest                          — page 1, default-weight interest sort
  /v1/gallery?sort=coverage                          — page 1, sort by frame coverage desc
  /v1/gallery?sort=custom&weights=0.5,0.2,0.2,0.1    — custom weights
  /v1/gallery/p/3?vars=julia                         — page 3, julia-only
  /v1/gallery?xforms=6                                — ≥6 xforms
  /v1/gallery?xforms=6-6                              — exactly 6 xforms
  /v1/gallery?coverage=0.5-                           — coverage ≥ 0.5
  /v1/gallery/p/3?sort=interest&vars=julia,radial_blur&xforms=2-8
```

### URL ↔ FilterSpec

```ts
export type SortMode = 'time' | 'interest' | 'coverage' | 'entropy'
                     | 'colorVar' | 'meanLum' | 'custom';

export interface FilterSpec {
  sort: SortMode;
  /** Custom weights — only meaningful when sort==='custom'. Other
   *  sort modes imply their canonical preset weights, looked up via
   *  PRESET_WEIGHTS in feature-score.ts. */
  weights: ScoreWeights | null;
  vars: number[];               // variation indices (sorted asc); AND semantics
  xformMin: number;             // ≥1, required, default 1
  xformMax: number | null;      // null = no upper cap; default null
  /** Stat-range filters. Each has the same shape as xform: [min, max|null]
   *  in 0..1. null max = no upper cap. */
  coverageMin: number;          // default 0
  coverageMax: number | null;   // default null
  entropyMin: number;           // default 0
  entropyMax: number | null;    // default null
  colorVarMin: number;          // default 0
  colorVarMax: number | null;   // default null
  meanLumMin: number;           // default 0
  meanLumMax: number | null;    // default null
}

export const DEFAULT_FILTER_SPEC: FilterSpec = {
  sort: 'time',
  weights: null,
  vars: [],
  xformMin: 1, xformMax: null,
  coverageMin: 0, coverageMax: null,
  entropyMin: 0,  entropyMax: null,
  colorVarMin: 0, colorVarMax: null,
  meanLumMin: 0,  meanLumMax: null,
};

export function parseFilterSpec(params: URLSearchParams): FilterSpec;
export function encodeFilterSpec(spec: FilterSpec): URLSearchParams;
export function isDefaultFilterSpec(spec: FilterSpec): boolean;
```

**Phase A delivered the original 4-axis FilterSpec** (sort: time|interest;
vars; xformMin/xformMax). Phase C extends it with the 4 stat-range
pairs; Phase E extends `SortMode` with the named presets + `custom`
and the `weights` field. The shape is purely additive — Phase A
already-shipped behavior continues to work unchanged with the
expanded type (defaults compose).

Variation names round-trip via `src/variations.ts:VARIATION_NAMES`
(reverse-lookup name → index on parse). Unknown variation names parse to
no-op (omitted from the spec, not an error — keeps malformed URLs
forgiving).

## Data layer

**New module — `src/gallery-filter.ts`:** owns `FilterSpec`, parsing,
encoding, defaults, and equality.

**`src/load-intent.ts` extensions:**
- `parseLoadIntent` for `/v1/gallery[/p/N]` now also parses the
  querystring into a `FilterSpec`. Return shape:
  `{ kind: 'gallery'; page: number; filter: FilterSpec }`.
- `galleryUrl(page, filter?)` — when `filter` is omitted or
  `isDefaultFilterSpec(filter)`, output stays at today's
  `/v1/gallery[/p/N]`. Otherwise appends the querystring.

**`src/gallery-mount.ts` extensions:**
- `pageOfSheepFiltered(page, perPage, filter, deps)` — replaces
  `pageOfSheep` in the mount path. Operates on the indexed subset.
  Maintains a per-mount cached **master ref list** keyed on the
  current `filter`: rebuilt on filter change, sliced on page nav.
- `mountGallery` opts gain `initialFilter: FilterSpec`. The mount
  loads `features.flam3idx` once via `feature-index-client.ts`
  before the first wave starts (already-wired cache makes this free
  on subsequent mounts).

### Filter + sort algorithm

```ts
function buildMasterList(index: FeatureIndex, spec: FilterSpec): SheepRef[] {
  // Walk all 52,175 records once. Apply variation AND filter via bitset AND.
  // Apply xform range filter via inclusive bounds check.
  // Sort by spec.sort:
  //   - 'time'     → already sorted in the index (gen↑, id↑); no-op
  //   - 'interest' → interestScore(record) descending; ties break on gen↑,id↑
  // Result: stable Uint32-packed-or-SheepRef list.
}
```

Cost: 52,175 entries × handful-of-ops per record → sub-millisecond JS
work on a modern laptop. No memoization beyond the per-mount cache.

## Faceted count engine

**New module — `src/gallery-facets.ts`:** computes the "narrowing
preview" counts the variation picker and xform count-row display.

```ts
export interface FacetCounts {
  variations: Map<number, number>;  // variation index → count
  xforms: Map<number, number>;      // bucket 1..10 (10 = 10+) → count
  total: number;                    // matching records under full spec
}

export function computeFacetCounts(
  index: FeatureIndex,
  spec: FilterSpec,
): FacetCounts;
```

**Per-axis "leave-one-out" rule** — counts for the variations axis
reflect ALL active filters EXCEPT the variations selection itself.
Counts for the xforms axis reflect ALL active filters EXCEPT the
xform range itself. This is the "what happens if I add to this axis"
preview.

**`10+` xform bucket** — the UI compresses any `xform_count ≥ 10`
into a single cell. Internally the bucket is keyed at `10` in the
xform counts map; filter logic uses raw integers (so `xformMax = 10`
means "≤10" and `xformMax = null` means "no cap" — distinct).

**Performance** — worst case (no filters) is 52,175 × 91 variations
= 4.7M ops. Single-digit ms in V8. Recompute on every filter change;
no memoization needed.

## UI layer

### Bar pill (in `src/ui-bar.ts:mountGalleryBar`)

A new element in the gallery bar's left or right zone:
`[⚙ filters ▾ (N active)]`. Badge `(N active)` reflects the count of
NON-DEFAULT axes (e.g. `vars=julia` is 1, `vars=julia,radial xforms=2-5`
is 2). Hidden when N == 0.

Click toggles drawer open/closed. Drawer state is **NOT** persisted
(URL is the source of truth for filter state; drawer is a transient
view).

### Drawer (new module — `src/gallery-filter-ui.ts`)

```
.pyr3-filter-drawer (hidden unless open)
├── .pyr3-filter-row.sort
│     sort:  [ time ][ interest ]              ← segmented pills
├── .pyr3-filter-row.vars
│     vars:  [+ add ▾]  julia ×  radial_blur ×  ← picker button + active chips
├── .pyr3-filter-row.xforms
│     xforms:  from [ 1 ▾ ]  to [ all ▾ ]
│     counts:  1(412)  2(3,827)  3(1,204)  4(587) ...  10+(15)
│              ^^^^^^^^^^^^^^ active range highlighted ^^^^^^^^^^^^^^^^
└── .pyr3-filter-row.actions
      [✕ reset]
```

Drawer auto-opens on mount iff `!isDefaultFilterSpec(initialFilter)`.

### Sort segmented control

Two mutually-exclusive pills. Active pill has accent color
(`var(--accent)`). Click flips the active mode + triggers
`applyFilter({ ...spec, sort: nextSort })`.

### Xform from/to pickers

Two custom dropdowns, side by side. Each opens a list of integer
options (1..10+ for `from`, "all"/10+/9/.../from for `to`). Each option
shows its live count: `2 (3,827)`. Selected option highlights. Picker
ensures `to ≥ from` (when `from` increases past current `to`,
auto-bump `to` to match, or jump `to` to `all`).

Below the pickers, the count row is a horizontal strip of cells
displaying every bucket from `1` through `10+`. Cells inside the
active range get the accent color; cells outside dim. Cells with
`count == 0` get the same "empty-but-selectable" treatment as the
variation picker's Empty group: dimmed, italic, hover hint
"would yield no flames."

### Variation picker (new module — `src/variation-picker.ts`)

Click `[+ add ▾]` opens an absolute-positioned panel anchored to the
button. Inside: three vertical groups, each alphabetized within itself.

```
.pyr3-var-picker
├── .pyr3-var-group.selected    ← only present when count > 0
│   ▸ Selected (2)
│   • bubble       ×
│   • julia        ×
├── .pyr3-var-group.available
│   ▸ Available (47)
│   • conic        (1,204)
│   • horseshoe    (3,002)
│   • linear       (4,237)
│   ...
└── .pyr3-var-group.empty
    ▸ Empty (42)
    • auger        (0)         ← dim italic, still clickable
    • boarders     (0)
    ...
```

**Behavior:**
- Each variation row is a button-as-row; click adds (Available/Empty)
  or removes (Selected).
- Counts beside Available/Empty rows update LIVE as the rest of the
  spec changes (e.g. a new variation is selected → all other rows
  recount).
- "Selected" group is omitted entirely when no variations are
  selected.
- Picker stays open across selections (don't dismiss on each click)
  — visitor can build a multi-variation filter without re-opening.
- Click outside or `Esc` closes the picker. Active chips
  (`julia ×`) live OUTSIDE the picker (in the drawer's `.vars` row)
  so visitor sees what's selected without opening.

### Reset pill

Single `[✕ reset]` button in the actions row. Click → `applyFilter(
DEFAULT_FILTER_SPEC)`. URL params clear. Page resets to 1.

### Empty-state UX

When `FacetCounts.total === 0` (filter matches nothing):
- 3×3 grid renders nine empty cells with a placeholder label
  ("no flames match").
- A subtle inline message above the grid: `"no flames match the
  current filter — try clearing variations or widening xforms."`
- The reset pill in the drawer gets a subtle pulse accent to draw
  the eye.

### Loading state

`features.flam3idx` is 445 KB brotli-compressed; first-paint load is
under 200 ms on a typical connection but not instant. While the index
is loading:
- The filter pill in the bar is disabled with a small spinner glyph
  and a "loading filters…" tooltip.
- The drawer can still be opened, but every control is disabled. A
  banner inside reads `"loading feature index… (~0.5 s)"`.
- Page nav still works — filter-less canonical-order browse is the
  fallback. Once the index lands, the drawer's controls enable.

## State management

The URL is the **single source of truth** for filter state. Every
visitor interaction calls a single `applyFilter(nextSpec)` that:

1. Writes the URL via `history.pushState(galleryUrl(1, nextSpec))`
   — single canonical write. Filter changes always reset to page 1.
2. Re-runs `mountHandle.setPage(1, nextSpec)` to rebuild the master
   list + repaint the grid.
3. Re-renders the drawer's facet counts + active-chip strip + bar
   pill badge.

Page nav `‹`/`›` calls `applyPage(nextPage)` which only updates the
page segment of the URL — filter spec persists. (Existing behavior;
no change.)

`popstate` (browser back/forward) re-parses the URL into
`{ page, filter }` and calls `setPage(page, filter)` — restores the
previous state correctly across the entire filter+page space.

## Module map

```text
NEW:
  src/gallery-filter.ts          — FilterSpec, parse/encode/equals, defaults
  src/gallery-facets.ts          — computeFacetCounts (faceted "leave-one-out" counts)
  src/gallery-filter-ui.ts       — mountFilterDrawer (drawer scaffold + sort/xform/reset wiring)
  src/variation-picker.ts        — mountVariationPicker (the 3-group dropdown panel)

EXTENDED:
  src/load-intent.ts             — parseLoadIntent + galleryUrl handle FilterSpec
  src/gallery-mount.ts           — pageOfSheepFiltered + master-list cache;
                                   loads feature-index once at mount
  src/ui-bar.ts                  — gallery bar pill + count badge wiring;
                                   onFilterToggle / onFilterChange callbacks
  src/main.ts                    — gallery mount path threads FilterSpec through;
                                   popstate handler routes filter through

UNCHANGED (but consumed):
  src/feature-index-client.ts    — already loads + caches features.flam3idx
  src/feature-index.ts           — record layout, bitset helpers, dequantize
  src/feature-score.ts           — interestScore() (existing weights)
  src/variations.ts              — VARIATION_NAMES (name ↔ index)
```

## Phasing breakdown (expanded 2026-06-01)

The original 3-phase plan (A: data, B: drawer+sort+xform, C: variation
picker) expanded to **5 phases** when the user folded in named single-
axis sort presets, stat-range filters, and tunable interest weights.
B/C order swapped from the original draft so the variation picker
(self-contained, picky UI work) lands later on a stable substrate.

```text
A  Data layer + facets                          ✅ SHIPPED (Phase A — branch ready to FF-merge)
B  Drawer scaffold + 6 sort preset pills + xform range + reset
C  Stat-range filters (coverage/entropy/colorVar/meanLum, same UX as xform)
D  Variation picker (3-group faceted dropdown — was Phase C in original draft)
E  Tunable interest weights slider panel (button↔slider auto-link)
```

### Phase A — Data layer + facets (no visible UI change)

Goal: ship the data plumbing + URL contract with the gallery still
looking visually identical. URL hand-typing works end-to-end.

- `src/gallery-filter.ts` — `FilterSpec`, `parseFilterSpec`,
  `encodeFilterSpec`, `isDefaultFilterSpec`, `filterSpecEquals`,
  `DEFAULT_FILTER_SPEC`.
- `src/gallery-facets.ts` — `computeFacetCounts`.
- `src/load-intent.ts` — extend `parseLoadIntent` + `galleryUrl` to
  carry filter spec.
- `src/gallery-mount.ts` — `pageOfSheepFiltered`; master-list cache;
  wire `features.flam3idx` load into `mountGallery`.
- `src/main.ts` — thread filter through gallery mount + popstate.
- Unit tests across all of the above.

Verify: hand-type `?sort=interest&vars=julia` into the URL bar →
gallery shows different cells in different order. Drawer doesn't
exist yet; bar looks identical. **SHIP.**

### Phase B — Drawer + sort + xform UI (visible feature lands)

Goal: the drawer is real, the sort and xform controls work, the
variation picker is stubbed.

- `src/gallery-filter-ui.ts` — drawer mount, scaffold, reset pill.
- `src/ui-bar.ts` — filter pill in gallery bar, count badge.
- Sort segmented control wired.
- Xform from/to pickers + count row wired.
- Variation picker stub: `[+ add ▾]` button visible but disabled
  with `"coming next"` tooltip; URL-derived `vars=…` still applies
  the filter (the picker is just the editor — the filter itself
  works).
- Empty-state UX + loading state.
- Drawer auto-opens iff URL has any filter param.
- Unit tests for the UI surface.

Verify in Chrome: open drawer, toggle sort modes, set xform range,
clear with reset. Refresh — drawer reopens with state restored. User
verify before FF-merge. **SHIP.**

### Phase C — Variation picker (last polish)

Goal: full picker; drops the stub.

- `src/variation-picker.ts` — three-group dropdown (Selected /
  Available / Empty), alphabetized, live counts.
- Drop the Phase B stub; wire the real picker to `applyFilter`.
- Unit tests for the picker (Selected/Available/Empty grouping,
  alpha sort, count updates).
- Chrome verify: select 2 variations, watch counts narrow across
  the other axes, clear, refresh round-trip.

User verify before FF-merge. **SHIP. #49 closes.**

## Testing notes

- **Unit:** `gallery-filter.ts` (URL round-trip), `gallery-facets.ts`
  (count math, leave-one-out rule), `gallery-mount.ts`
  (`pageOfSheepFiltered` page-math under filter). Keep ~2-sec `npm
  test` budget; nothing in this issue requires the parity rig.
- **FE↔BE smoke:** unchanged. Filter is FE-only; BE CLI is
  untouched.
- **Chrome verify (Phase B + C):** open drawer, run a handful of
  filter sequences end-to-end, watch counts react. Verify URL
  round-trip via refresh + browser back/forward.
- **Performance:** no profiling gate — 52k × 91 is sub-ms in V8 and
  filter changes are user-driven, not per-frame. If it ever feels
  laggy, memoize per-spec; until then YAGNI.

## Non-goals / open questions left at the door

- **Filter persistence across sessions** — URL only. No
  localStorage. (Discussed during brainstorm; URL is single source
  of truth.)
- **AND-vs-OR toggle inside the variation picker** — out of scope
  for v1.2; AND is the locked semantic.
- **Random sort** — removed; 🎲 pill covers it.
- **Per-sheep "find similar"** — separate v1.3+ work.
- **Thumbnail dedup** — separate follow-up issue; not blocking #49.
- **Server-side filter index pre-computation** — overengineering;
  the live in-browser facet pass is fast enough.

## References

- Issue #49 — Gallery search/filter affordances
- Issue #21 — v1.2 restructure (parent; "gallery = discovery surface")
- Issue #47 — Gallery view shape (delivered the 3×3 grid)
- Issue #48 — Feature index (delivered features.flam3idx)
- Issue #50 — Gallery 🎲 pill (delivered random discovery; #49 doesn't duplicate it)
- ESF v0.7 release (2026-06-01) — features.flam3idx live at
  `pyr3.app/chunks/features.flam3idx`
- `docs/esf-v0.7-integration.md` — integration handoff
- Prior brainstorm:
  `docs/superpowers/specs/2026-05-31-gallery-view-shape-design.md`
  (#47)
- Prior brainstorm:
  `docs/superpowers/specs/2026-05-31-feature-index-foundation-design.md`
  (#48)
