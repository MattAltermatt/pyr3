# /v1/edit xforms section v2 — panel UX redesign

**Date:** 2026-06-03
**Branch:** `feature/flame-editor-v1`
**Status:** brainstorm complete — ready for implementation plan
**Related:** Visual Overhaul milestone (#9); scrubby-input ([#105](https://github.com/MattAltermatt/pyr3/issues/105))

## Background

The current `src/edit-section-xforms.ts` (591 LOC) renders each xform as a
collapsible card with raw matrix fields (`a` / `b` / `c` / `d` / `e` / `f`)
and 90+ numeric inputs across 4 cards (~1474 px tall). Functional, but
opaque to anyone who doesn't already think in 2×2 matrices, and there's
no way to A/B test what each piece contributes.

This redesign targets non-math users without sacrificing power-user
access to raw values. Four guiding goals (from the brainstorm):

1. Replace raw `a..f` with plain-English fields the user already
   understands (rotation, scale, position).
2. Make it trivial to A/B test contribution — toggle each xform and each
   variation on / off, with shift-click "solo" for the audio-mixer move.
3. Plain-English hover tooltips on every field so the user never has to
   ask "what does this number do?"
4. Embed a live mini visualization of the affine so the user can SEE
   what their edits do without needing to interpret the flame canvas.

The triangle-gizmo-overlay idea (drag handles on the flame canvas, as
in Apophysis) is explicitly **rejected** — the flame image doesn't
visually match the affine triangle, so the gizmo creates more confusion
than it solves. The mini viz inside each card replaces it.

## Locked decisions

### Decision 1 — Decomposed affine, raw matrix in a fold-up

Replace the 6 raw cells with 5 plain-English fields (default view):

| Field      | Type      | Default | Tooltip                                                                          |
| ---------- | --------- | ------- | -------------------------------------------------------------------------------- |
| scale x    | number    | 1       | How much this xform stretches the X dimension. <1 shrinks, >1 grows, negative mirrors. |
| scale y    | number    | 1       | Same, vertically.                                                                |
| rotation   | number °  | 0       | Counter-clockwise rotation in degrees, applied around the position point.        |
| position x | number    | 0       | Horizontal offset — where this xform 'lives' along the X axis.                  |
| position y | number    | 0       | Vertical offset.                                                                 |

Two fold-up disclosures below:

- **shear** — one field. Default 0. Tooltip: "Skew along the X axis. 0 = no skew. Rare; auto-opens if a file is opened with non-zero shear."
- **raw matrix (a / b / c / d / e / f)** — 6 fields in a 3×2 grid. For round-trip clarity and power-user editing.

Decomposed and raw stay live-synced. Editing one rewrites the other.

#### Math

Forward (decomposed → raw, runs on every decomposed edit):

```text
a = scale_x · cos(rotation)
b = scale_x · shear · cos(rotation) − scale_y · sin(rotation)
c = position_x
d = scale_x · sin(rotation)
e = scale_x · shear · sin(rotation) + scale_y · cos(rotation)
f = position_y
```

Inverse (raw → decomposed, runs on file open + on raw edits):

```text
scale_x  = √(a² + d²)                          ← always positive
rotation = atan2(d, a)                         ← computed for display only, shown in degrees
det      = a·e − b·d
scale_y  = det / scale_x                       ← negative if matrix flips orientation
shear    = (a·b + d·e) / (a² + d²)
position_x = c · position_y = f
```

Composition order is QR: shear → scale → rotate → translate. The
decomposition is canonical (`scale_x ≥ 0`) but the matrix is unchanged
— `a..f` remains the genome's source of truth in memory and on disk.

#### Edge cases

- `scale_x = 0` → division-by-zero in the inverse. The UI clamps display
  to a sentinel ("0") and disables shear / scale_y editing until
  scale_x ≠ 0.
- Sign ambiguity (negative scale ≡ 180° rotation + positive scale). The
  canonical form picks positive `scale_x`; the rotation absorbs any
  flip on that axis. `scale_y` carries the determinant sign.
- Opening a file with shear ≠ 0 → the shear fold-up auto-expands so
  the user doesn't silently miss it.

#### Same treatment for the post-affine

The post-affine (`xform.post`) gets identical decomposed-fields-plus-viz
treatment when "use post-transform" is checked. Same math, same fold-ups.
The current "active" checkbox that creates / removes the `post` object
stays as-is (semantically distinct from the new `xform.active` toggle —
see Decision 2).

### Decision 2 — Active / inactive toggle on xforms + variations

#### Schema

Additive change to `src/genome.ts`:

```typescript
export interface Xform {
  // ...existing fields
  /** Inactive xforms are packed with weight=0 at GPU upload time; the
   *  user's original weight stays in the genome so re-activation
   *  restores it. Default: undefined = active. */
  active?: boolean;
}

export interface Variation {
  // ...existing fields
  /** Inactive variations contribute zero to the variation chain. Same
   *  pattern as Xform.active. Default: undefined = active. */
  active?: boolean;
}
```

#### Packer behavior

`src/symmetry.ts` (or wherever `expandGenomeForGPU` lives) zeros the
packed weight when `active === false`. No shader change. The user's
authored weight stays untouched in `state.genome`.

For variations: the WGSL `apply_variation` dispatch already accepts a
per-variation weight; we just pack `0` when `active === false`. Chain
sum stays valid (a zero-weight term is a no-op).

#### UI

- Small `[ ] active` checkbox in xform card header (next to weight) and
  in each variation row header.
- Inactive cards / rows dim to ~55% opacity; the weight field grays out
  (not hidden — still readable so the user knows the underlying value).
- Toggling fires the slow lane (`onChange('xforms.N.active')` → slow
  lane → re-iterate). Instant A/B visual.

#### Shift-click solo

Shift-clicking the `active` checkbox enables "solo" mode for that
xform / variation:

- All other xforms in the genome flip to `active = false`, with the
  prior state captured in a transient UI-only `soloRestoreSnapshot`.
- Shift-clicking the same checkbox AGAIN exits solo: the snapshot
  restores every other entry's prior active state.
- Shift-clicking a DIFFERENT entry transfers solo to it (snapshot
  re-captured on the new "all others", restored from the old snapshot
  first to handle nesting).
- Plain-click on any entry's checkbox while in solo mode dirties the
  snapshot (subsequent solo-exit will respect the user's manual change).

The solo snapshot lives in `EditState`, NOT in the genome — solo is a
viewing mode, not a persisted state. Save / reload preserves whichever
active values were live at save time (so soloing-then-saving captures
the on/off pattern as committed).

The same shift-click solo applies to variation rows within one xform.

### Decision 3 — Native `title=` tooltips on every field

Plain-English, one short sentence each (~80 chars max so they fit the
native browser tooltip). No JS popover library. Tooltips listed in the
spec sections above + the appendix below.

### Decision 4 — Mini live affine viz embedded in each expanded card

Per-card `<canvas>` (120 × 120 px), only painted while the card is
expanded. Draws the unit square (orange: input) → image after affine
(blue: output). Updates synchronously on each decomposed / raw edit
(~1 ms per redraw). Cheap; no GPU.

Helper module: `src/edit-xform-viz.ts`. Pure 2D canvas, no engine
coupling.

### Decision 5 — Shape presets in a fold-up

8 presets in a 2×4 grid inside a "shape presets" disclosure. Clicking
overwrites the 5 decomposed fields + clears shear:

| Preset       | scale_x | scale_y | rotation | shear | position |
| ------------ | ------- | ------- | -------- | ----- | -------- |
| identity     | 1       | 1       | 0        | 0     | (0, 0)   |
| half scale   | 0.5     | 0.5     | 0        | 0     | (0, 0)   |
| rotate 30°   | 1       | 1       | 30       | 0     | (0, 0)   |
| rotate 45°   | 1       | 1       | 45       | 0     | (0, 0)   |
| rotate 90°   | 1       | 1       | 90       | 0     | (0, 0)   |
| flip y       | 1       | −1      | 0        | 0     | (0, 0)   |
| flip x       | −1      | 1       | 0        | 0     | (0, 0)   |
| shear right  | 1       | 1       | 0        | 0.5   | (0, 0)   |

Presets preserve `position_x` / `position_y` (the xform's "where it
lives" stays put). Confirmable in the live mockup at
`.remember/verify/xform-card-mockup.html`.

### Decision 6 — Variation kind picker (tiered modal, fitting-room mode)

Native `<select>` with 80+ options is unbrowsable and doesn't scale to
JWildfire's ~250 additional variations. Replace the kind dropdown in
each variation row with a click-to-open modal picker.

#### Tier structure

```text
┌── Pick a variation ──────────────────────── [ × ] ─────┐
│  search 80 variations… [             ]  [✓ apply] [↺ revert] [× cancel]  │
│                                                         │
│  RECENTLY USED · 3                                      │
│  [ spherical ] [ julian ] [ swirl ]                    │
│                                                         │
│  FEATURED · 24 — the workhorses, ~90% of flames use these│
│  [ linear ] [ sinusoidal ] … 24 tiles                  │
│                                                         │
│  BROWSE ALL · 80 grouped by family                     │
│  ▼ Polar / angular · 12                                 │
│  ▼ Julia family · 5                                     │
│  ▼ Waves / rings · 10                                   │
│  ▼ Blur / random · 9                                    │
│  ▼ Transcendental · 14                                  │
│  ▼ Misc / exotic · 30                                   │
└─────────────────────────────────────────────────────────┘
```

- **Recently used** — top strip; localStorage-backed FIFO of 3-5 most
  recently picked. Grows DURING a picker session as the user previews.
- **Featured** (~25 curated) — covers the workhorse variations. Draft
  list: linear, sinusoidal, spherical, swirl, horseshoe, polar, heart,
  disc, spiral, hyperbolic, diamond, ex, julian, julia, waves, fisheye,
  bubble, rings, fan, cross, ngon, cell, blob, rectangles. Editable
  later in `src/edit-variation-picker.ts`.
- **Browse all** — categorized accordion. Categories: Polar/angular,
  Julia family, Waves/rings, Blur/random, Transcendental, Misc/exotic
  (final category list curated during impl from the V registry).
- **Search** — instant string-match across every tier; filtered results
  collapse the accordions and show matches in a flat grid.

#### Fitting-room behavior

The picker is a **"try things on, commit at the end"** modal:

1. Opening the picker snapshots the current `variation.index` + `params`
   into a `pickerSnapshot` on `EditState`.
2. Clicking a tile rewrites `xform.variations[N].index` to the picked
   kind, resets params to that kind's defaults, fires the slow lane.
   The flame canvas behind re-renders. The picker stays open. Clicked
   tile gets a 1.5 px orange border indicating "this is what's
   currently previewing."
3. Top-of-picker actions:
   - **✓ apply** — commits the preview (snapshot discarded); closes.
   - **↺ revert** — restores `pickerSnapshot` to the genome (snapshot
     kept); keeps the picker open so the user can keep browsing.
   - **× cancel** / Escape / backdrop-click — restores AND closes.
4. The picker has **no dark backdrop** — the flame canvas behind stays
   fully visible. The picker is centered, ~700 px wide; the canvas is
   typically wider, so flame is visible on either side.
5. Hover does NOT preview — too jittery, too many accidental renders.
6. Closing without explicit apply (×, Escape, click-outside) defaults
   to **cancel** behavior. No silent commits.

#### Thumbnails

64 × 64 px PNG per variation, baked at build time. `npm run
gen:variation-thumbs` (new script) iterates each `ts_var_*`, applies
it to a 20×20 grid of points in `[-1, 1]²`, plots the result as
white-on-black pixels into a PNG, drops it into
`public/variation-thumbs/<name>.png`. The picker's `<img>` tags load
from there. CI runs the bake to verify completeness.

Live-render fallback for variations missing a thumb (e.g. JWildfire
additions before the next bake): the picker renders the same math
client-side into a transient canvas. Same output, slower first-paint.

#### `+ var` button behavior

Clicking `+ var` opens the picker immediately, with no auto-insert.
The user picks a kind first, then the row materializes in the chain.
Avoids the current behavior of inserting `linear` (weight 1) as a
placeholder the user didn't choose.

### Decision 7 — Card body order

Reorder so the user works shape → math → color → mixing:

1. Header (chev · "xform N" · weight · active · duplicate · delete)
2. **Affine** (decomposed + viz + presets / shear / raw fold-ups)
3. **Variations** (chain — kind, weight, params, active per row)
4. **Post-affine** (same decomposed treatment, behind "use post-transform")
5. **Color** (color slider, colorSpeed, opacity slider)
6. **Xaos** (per-destination weights)

Justification: affine + variations DEFINE the xform's geometric
contribution; color is a property of HOW it deposits; xaos is how it
INTERACTS with other xforms (most niche).

## Out of scope

- Per-xform isolated render previews (separate question; could be a
  later phase — "what does just THIS xform contribute?")
- Triangle gizmos on the flame canvas (explicitly rejected)
- Scrubby slider input ([#105](https://github.com/MattAltermatt/pyr3/issues/105), separate)
- Variation chain reordering / drag-handles (commutative — order is
  cosmetic; revisit if the chain UI feels cluttered)
- Variation kind tooltips: 80 short plain-English descriptions —
  written incrementally; not gating ship of the picker
- Compare-mode (split-canvas A/B of two variations) — possible follow-up
  after fitting-room ships
- xaos matrix view (current per-source row stays — `xaos-matrix` is in
  the existing post-v1 backlog in the original editor design spec)
- JWildfire variation port (separate large effort — the picker is
  already shaped to absorb their ~250 variations when they land)

## Files

### New

- `src/affine-decompose.ts` — forward + inverse math, ~50 LOC. Pure.
- `src/affine-decompose.test.ts` — round-trip tests across rotations,
  shears, flips, identity, near-singular matrices.
- `src/edit-xform-viz.ts` — `attachXformViz(canvas, getAffine)`. Pure
  2D canvas, ~80 LOC.
- `src/edit-xform-viz.test.ts` — happy-dom smoke (renders without
  error, redraws on update).
- `src/edit-xform-presets.ts` — list of 8 shape presets (identity, half
  scale, rotate 30/45/90°, flip x/y, shear right). ~30 LOC.
- `src/edit-variation-picker.ts` — modal picker UI + tier data
  (FEATURED list, CATEGORY map, RECENTLY_USED localStorage helpers).
  Fitting-room state machine (snapshot / preview / apply / revert /
  cancel). ~350 LOC.
- `src/edit-variation-picker.test.ts` — picker open/close, tile click
  previews, apply commits, revert restores snapshot, cancel restores +
  closes, search filters, recently-used FIFO.
- `scripts/gen-variation-thumbs.mjs` — build-time bake that iterates
  every `ts_var_*`, applies it to a 20×20 grid, writes a 64×64 PNG to
  `public/variation-thumbs/<name>.png`. Runs via `npm run
  gen:variation-thumbs`; CI verifies output.
- `public/variation-thumbs/*.png` — 80 baked thumbnails (kept in git
  per the no-artifacts rule's exception: small, version-pinned, regen
  is idempotent — verify against repo-debloat policy at impl time;
  alternative is shipping live-render only and skipping the bake).

### Modified

- `src/genome.ts` — add `active?: boolean` to `Xform` and `Variation`.
- `src/serialize.ts` — emit `active` in `.pyr3.json` only when
  `false` (matches the existing "omit defaults" pattern); parse it
  on import.
- `src/symmetry.ts` (`expandGenomeForGPU`) — zero packed weight when
  `active === false` (xforms + variation chain).
- `src/edit-section-xforms.ts` — significant rewrite to the new card
  layout. Estimated growth ~591 → ~850 LOC.
- `src/edit-section-xforms.test.ts` — update existing tests, add
  coverage for active toggle, shift-click solo, decomposed editing,
  preset application.
- `src/edit-state.ts` — add `soloRestoreSnapshot?: SoloSnapshot` for
  transient solo state.
- `src/seam.test.ts` — register new edit-* modules as DOM-mounting if
  they touch window / document.
- `docs/keybindings.md` — flip planned → shipped on Q2 + Q5 rows.

### Documentation

- Update `CLAUDE.md` if the affine decomposition needs to be discoverable
  to future Claude sessions (probably yes — math + sign convention).

## Tests

### Unit (vitest)

- `edit-variation-picker.test.ts`
  - opening picker snapshots current variation kind + params
  - clicking a tile rewrites the variation (kind + default params for
    that kind), fires `onChange('xforms.N.variations.M.index')`
  - `✓ apply` commits + closes (snapshot discarded)
  - `↺ revert` restores snapshot to genome AND keeps picker open
  - `× cancel` / Escape restores snapshot AND closes
  - clicking outside the picker = cancel
  - search filters across tiers; collapses categories during filter
  - recently-used FIFO: previewing pushes to the front, max 5 entries,
    survives localStorage round-trip
  - thumbnails: tries `<img src="/variation-thumbs/<name>.png">`,
    falls back to live-render canvas if the asset 404s

- `affine-decompose.test.ts`
  - identity round-trip
  - pure rotation (90°, 180°, −45°)
  - pure scale (uniform, non-uniform, negative)
  - flip-y (negative det → negative scale_y, positive rotation)
  - rotation + scale composition
  - shear + rotation composition
  - near-singular matrix (scale_x near 0) → sentinel handling
  - 100-sample random fuzz: `raw → decomposed → raw` returns within 1e-10
- `edit-section-xforms.test.ts` (additions)
  - active toggle: `active = false` → packer zeros weight at upload
    (mock the packer; assert the input it sees)
  - shift-click solo: only that xform stays active, others snapshotted
  - shift-click same checkbox again: snapshot restored
  - shift-click different checkbox: snapshot transfers
  - plain-click while in solo dirties snapshot (subsequent exit
    respects the new state)
  - decomposed field edit writes back to a/b/c/d/e/f
  - raw field edit writes back to decomposed
  - preset click overwrites the 5 decomposed fields
  - shear fold-up auto-opens when a file with shear ≠ 0 is opened
  - tooltips: every field has a non-empty `title` attribute

### Manual / Chrome verify

- Drop in the editor, expand a fresh xform card, sweep the decomposed
  fields one at a time and watch the viz follow.
- Click presets — flame re-renders with the new shape.
- Toggle xforms off — flame loses that piece live.
- Shift-click solo — only that xform contributes; flame collapses to
  just its attractor.
- Open a file that contains shear ≠ 0 — shear fold-up auto-expands.
- Open a file, edit decomposed, save, reload — round-trip is lossless
  (matrix values byte-identical aside from float fmt).
- Open variation picker → click `heart` → flame redraws → click
  `diamond` → flame redraws → click `revert` → original variation back
  + picker still open → click `apply` → keeps `diamond`, closes.
- Search "jul" in picker → julia / julian / juliascope highlighted in
  flat grid; recently-used + featured still visible above.
- Recently-used grows during one session, persists across page reload.
- Click outside the picker (or Escape) — same as cancel: original
  restored, picker closed.

## Appendix — tooltip strings

Final wording finalized in the implementation phase; draft set below.

| Field                  | Tooltip                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| xform header weight    | Relative chance this xform gets picked each chaos-game step. Higher = more contribution. |
| xform active           | Click to toggle this xform on/off. Shift-click to solo (turn off all others).    |
| xform duplicate        | Clone this xform with the same affine, color, and variations.                    |
| xform delete           | Remove this xform from the genome.                                               |
| scale x                | How much this xform stretches the X dimension. <1 shrinks, >1 grows, negative mirrors. |
| scale y                | How much this xform stretches the Y dimension.                                   |
| rotation               | Counter-clockwise rotation in degrees, applied around the position point.        |
| position x             | Horizontal offset — where this xform 'lives' along the X axis.                  |
| position y             | Vertical offset.                                                                 |
| shear                  | Skew along the X axis. 0 = no skew. Rare; only used by some imported flames.    |
| raw a/b/c/d/e/f        | Direct entries of the 2×2 affine matrix (new_x = a·x + b·y + c, new_y = d·x + e·y + f). |
| preset (each)          | Set the affine to <preset name>.                                                 |
| color                  | Where this xform pulls toward on the palette gradient (0 = left edge, 1 = right). |
| colorSpeed             | How fast each visit tugs the color toward its target. 0 = ignore, 1 = snap.     |
| opacity                | Visibility of this xform's deposits. 0 = ghostly, 1 = full.                     |
| variation kind         | Choose which math function this variation applies after the affine.              |
| variation weight       | Strength of this variation's contribution. The chain sums weighted contributions. |
| variation active       | Click to toggle this variation on/off. Shift-click to solo within this xform.    |
| variation params       | Variation-specific knobs (see flam3 docs for details).                          |
| post use-checkbox      | Apply a second affine AFTER the variation chain. Optional.                       |
| post (decomposed)      | Same as the pre-affine, applied after the variation chain transforms the point. |
| xaos row               | Per-source bias. Value at column N is how likely THIS xform is picked AFTER xform N. 1 = neutral, 0 = forbidden. |
