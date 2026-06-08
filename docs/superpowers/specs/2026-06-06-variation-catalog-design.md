# pyr3 — Variation Catalog Page (design spec)

- **Date**: 2026-06-06
- **Status**: design-locked, plan pending
- **Issue**: [#119](https://github.com/MattAltermatt/pyr3/issues/119)
- **Branch**: `feature/issue-119-variation-catalog`
- **Mockups**:
  - `.remember/brainstorm/variation-catalog-left.html` — sidebar standalone
  - `.remember/brainstorm/variation-catalog-right.html` — catalog content standalone
  - `.remember/brainstorm/variation-catalog-full.html` — combined view, working scroll-spy + collapse + search

## 1. Goal

A live, interactive index of pyr3's 107 variations, modeled after the
"Appendix: Catalog of Variations" in Draves & Reckase 2003. Browse every
variation paired with the math formula, a deterministic grid-warp diagram,
and a real-time chaos-game flame render that responds to inline weight +
parameter sliders.

Replaces the need to consult the original paper for variation reference and
extends it for the post-flam3 plugins (DC family, JWildfire ports) that
aren't in the paper. The page also serves as both a developer reference
("what does `super_shape` do?") and a user-facing pedagogical surface
("watch julian arrive from weight 0 → 1").

## 2. Route

`/v1/variations` — new top-level route, registered in `src/main.ts` next to
`/v1/edit`, `/v1/gallery`, `/v1/screensaver`. Linked from the about page
and the global nav strip.

URL hashes: `/v1/variations#v14-julian` deep-links to a single variation.

## 3. Page architecture

Two-pane layout, full viewport:

- **Sidebar** (left, 280px): sticky, contains search + collapsible sticky
  section headers + variation index. Stays put while the catalog scrolls.
- **Catalog** (right, scrollable): single-column, one section per variation,
  scrolls independently. Sections stack vertically with hard rules between.

```
┌──────────────┬─────────────────────────────────────────────┐
│  SIDEBAR     │  CATALOG                                    │
│  (sticky)    │  (scrolls)                                  │
│  280px       │  max-width 880px, centered                  │
│              │                                             │
│ search       │  ── V0 linear ───────────────────────       │
│ ▾ flam3 99   │     [formula] [warp] [flame] [blurb]        │
│   V0 linear  │  ── V1 sinusoidal ───────────────────       │
│   V1 sin     │     [formula] [warp] [flame] [controls]     │
│   ...        │  ── V2 spherical ────────────────────       │
│ ▾ DC family 4│     ...                                     │
│ ▾ JWF 4      │                                             │
└──────────────┴─────────────────────────────────────────────┘
```

## 4. Sidebar

Top → bottom:

1. **Header strip**: "VARIATIONS · 107" (count = grand total, never moves)
2. **Search box**: live filter on name OR V-number. Type `jul` → julia,
   julian, juliascope, wedge_julia. Type `v10` → V100-V106.
3. **Scrollable list** with three **collapsible sticky section headers**:
   - `flam3` (V0-V98, 99 items)
   - `DC family` (V99-V102, 4 items)
   - `JWildfire ports` (V103-V106, 4 items)

Section behavior:
- Always present (do NOT hide a section just because all members are
  collapsed). Exception: during an active search, hide sections that have
  zero matches.
- Click header → toggle collapse. Caret `▾` (expanded) ↔ `▸` (collapsed).
- Each header is `position: sticky; top: 0` inside the scrollable list, so
  the current section's header pins at the top as you scroll through its
  members; pushed off when the next section's header arrives.
- Member count in header reflects the **search-filtered** count (so
  searching `cpow` shows `flam3 · 1`, `JWildfire ports · 2`).

Variation row layout:
- `V<idx>` (monospace, dim) · `<name>` · `<badge>` (`DC` / `JWF` if non-flam3)
- Active variation: left-edge amber bar, soft-amber background, accented V#.
- Click → catalog smooth-scrolls to that anchor.

Scroll-spy:
- Catalog scroll → IntersectionObserver picks the variation closest to 35%
  viewport height → sidebar active row updates → sidebar list auto-scrolls
  to keep active row visible.

## 5. Catalog (right pane)

Single column, sections stacked top-to-bottom in V-index order (V0 → V106).
Each section has the same anatomy.

### Per-section anatomy

```
─────────────────────────────────────────────────────  ← top rule
[name + V#]                              [source pill]
[formula — KaTeX, centered]

[grid warp pane]              [flame pane]
   (static SVG)                 (live WGSL render)
                              [controls panel]

[blurb — 1-2 sentences]
[▸ Open in editor with this variation]
─────────────────────────────────────────────────────  ← bottom rule
```

### Layout specifics

- Section vertical padding: `2.5rem` top + bottom
- Panes: 2-column CSS grid, `1fr 1fr`, gap `1rem`
- Each pane: aspect-ratio `1/1`, ~400×400px at typical desktop viewport
- Source pill (top right): rounded badge, `--bar-bg-1` background,
  `--bar-border` border, monospace, contents `flam3 core` / `DC family` /
  `JWildfire ports`
- Formula: centered, padding `1.3rem 0 1.5rem`, rendered with KaTeX 0.16.x
- Blurb: `--text-muted`, max-width `64ch`
- "Open in editor" link: amber accent (`--accent`), monospace.
  **Preserves full live state** — URL form
  `/v1/edit?from=catalog&v=<idx>&w=<weight>&p=<p1>,<p2>,…`. The editor's
  cold-start path detects `from=catalog`, builds a fresh sierpinski 3-xform
  scaffold, substitutes V<idx> into all 3 xforms at weight `w`, and applies
  the comma-separated `p` values as the variation's params. So the editor
  opens exactly mirroring the catalog's current view of that variation.

### Warp pane (left, static)

Deterministic SVG render of the variation function applied to a regular grid:
- Input domain: `[-π, π] × [-π, π]` (matches sinusoidal's natural range)
- 14 horizontal + 14 vertical gridlines, 60 sample points each
- Output coords scaled to viewBox `-2 -2 4 4` with overflow clipped
- Axes (faint): `--bar-border` darker shade
- Warp lines: medium grey (`#6e6e7a`)
- Renders **once on mount**, never re-iterates — pure CPU/JS computation

### Flame pane (right, live)

WebGPU chaos-game render of the **sierpinski scaffold** with the variation
substituted into all 3 xforms:
- Canvas: `<canvas>` mounted on intersection with viewport
- Renderer: shared `Renderer` instance (one per page), attached/reattached
  to whichever section is in view
- Iterates continuously while the section is in viewport (using the
  editor's existing live-render lane)
- When scrolled out: iteration pauses, GPU pipeline freed for next section
- Quality: live preset (matches editor's `LIVE_MAX_LONG_EDGE = 384`); on
  scroll-pause-then-back, iteration resumes from zero
- Live-dot indicator (amber pulse) in top-right corner of the pane

### Controls panel (under flame pane)

- **Weight slider** (universal — every variation except V0):
  - Range `0 → 1`, default `1` (full substitution), step `0.01`
  - Slider fill in `--accent` amber
  - Drives the per-xform `[linear: 1-w, variation: w]` mix on all 3
    sierpinski xforms
  - Live re-render (debounced 80ms, same as editor slow-lane)
- **Param scrubbies** (only for parameterized variations):
  - One row per param: label · drag-scrubby · numeric value · reset `↻`
  - Use the same component as `edit-scrubby-input.ts`
  - Defaults: **flam3 paper canonical values** (e.g., `julian: power=2,
    dist=1`; `cpow: r=1, i=0, power=1`)
- **Reset all** button (footer, right-aligned)
- **V0 special case**: no controls. Italic note: "no controls — linear is
  the reference (no warp to tune)" under flame pane.

## 6. Scaffold genome

Sierpinski 3-xform, weight 1/3 each, triangle vertices `(0,0)`, `(1,0)`,
`(0.5, √3/2)`. Each xform a 0.5 contraction toward its vertex:

| xform | a   | b | c     | d | e   | f      |
|-------|-----|---|-------|---|-----|--------|
| 0     | 0.5 | 0 | 0     | 0 | 0.5 | 0      |
| 1     | 0.5 | 0 | 0.5   | 0 | 0.5 | 0      |
| 2     | 0.5 | 0 | 0.25  | 0 | 0.5 | 0.433… |

All three xforms get `[linear weight = 1-w, V_target weight = w]` where
`w` is the section's weight slider.

Single palette across all 107 sections (consistency — variation character
is the differentiator, not palette). Default pick: a soft rainbow.

## 7. Per-variation data

Single content file: `src/variation-catalog-data.ts` — exports:

```ts
export interface VariationDoc {
  idx: number;
  name: string;
  source: 'flam3' | 'dc' | 'jwf';
  formula: string;         // LaTeX (KaTeX inline)
  blurb: string;           // 1-2 sentence description
  params?: ParamDoc[];     // only for parameterized variations
  warpFn?: (x: number, y: number) => [number, number];  // 2D JS implementation
}
export interface ParamDoc {
  name: string;
  default: number;
  min: number;
  max: number;
  step: number;
}
```

Authoring all 107 entries is content work, not engineering. Splits the
implementation cleanly: page chrome + iteration plumbing (engineering), vs.
formulas + blurbs + warp implementations + param tables (content).

Variations without a `warpFn` implementation (e.g., RNG-using ones like
`gaussian_blur` where the deterministic-warp visualization is meaningless)
render a placeholder note in the warp pane: "warp diagram not applicable
(RNG-driven)".

## 8. Live render perf model

- One iterator at a time. IntersectionObserver fires when a section enters
  ~50% viewport; renderer attaches to that section's canvas; iteration
  begins from zero.
- Section exits viewport → iterator detaches, GPU pipeline freed.
- Off-screen flame canvases stay in DOM but hold no GPU state (cheap).
- Warp SVGs are pure DOM — no perf concern at 107 of them.
- Scales to 200-300 variations without re-architecture. Layer 2 (lazy
  DOM-mount for sections more than 3 viewports out) deferred until needed.

## 9. Styling

Use pyr3 design tokens verbatim from `index.html :root` — `--bg`,
`--bar-bg-1/2/3`, `--bar-border`, `--accent`, `--accent-soft`,
`--accent-border`, `--text`, `--text-dim`, `--text-muted`.

KaTeX bundled as npm dep (`katex@0.16.x`), not CDN (avoids deployment
runtime dependency on jsdelivr).

## 10. Special cases

| Variation | Treatment |
|-----------|-----------|
| V0 linear | No controls; italic "linear is the reference" note |
| V44 blur, V45 gaussian_blur, V43 noise | RNG-driven; warp pane shows "warp not applicable" note; flame still iterates normally |
| V97 pre_blur | Standard treatment; blurb explains pre-affine modifier semantics |
| V99-V102 dc_* | Standard treatment; blurb explains direct-color override semantics |
| V14, V32, V39, V40, V41, V47, V90, V96, V103-V106 (parameterized) | Param scrubbies with flam3 paper defaults |

## 11. Keyboard navigation

- `↑` / `↓`: previous / next variation (smooth-scroll to anchor + update sidebar)
- `/`: focus search box
- `Escape`: clear search (when search is focused)

## 12. Acceptance criteria

- [ ] All 107 variations have a section with name + V# + source pill + formula
- [ ] Warp pane renders for every non-RNG variation (~100 of 107)
- [ ] Flame pane iterates while in viewport; pauses + frees pipeline when scrolled out
- [ ] Sidebar shows all 107 in collapsible sticky-headed sections
- [ ] Section headers pin to top of sidebar list while scrolling through their members
- [ ] Search filters live (by name OR V-number)
- [ ] Section count badges reflect search-filtered counts
- [ ] Click sidebar → smooth-scroll catalog
- [ ] Catalog scroll → sidebar scroll-spy updates active row + auto-scrolls list
- [ ] Weight slider works on every applicable section (V0 excluded)
- [ ] Param scrubbies present + functional on every parameterized variation
- [ ] V0 / pre_blur / dc_* / RNG-driven special cases handled
- [ ] "Open in editor" link round-trip preserves variation + weight + params:
  catalog tweak → click open → editor opens with the same sierpinski +
  variation + weight + params, visually matching the catalog flame pane
- [ ] Keyboard nav (↑/↓ between sections, / to focus search)
- [ ] No TypeScript errors; `npm test` + `npm run typecheck` pass
- [ ] Chrome verify: drive search, click jump, scroll, slider drag — all responsive
- [ ] No regressions in existing routes

## 13. Out of scope (v2+)

- Scaffold variant toggle (sierpinski / 2-xform pair / rotated)
- Palette swap UI in the catalog
- Seed re-roll
- Preset chips above scrubbies (e.g. `julian: [default] [5-sym] [inversion]`)
- Per-section thumbnail prerendering as cached PNG fallback for fast page-load
- Mobile layout (single column with sidebar collapse). Mobile rework is its
  own milestone (#33); revisit then.
- WASM bridge / CPU fallback (per pyr3 scope guardrail, never)
- Markov-chain-style "find variations like this one" (out of scope; deferred
  research arc, #36)

## 14. Open questions

None. Brainstorm exhausted the load-bearing decisions; remaining decisions
are tactical and made in the implementation plan.
