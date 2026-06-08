# Visual Overhaul — design spec

**Date:** 2026-06-04
**Status:** Drafted, awaiting user review
**Bundles:** #103 (DRY bar chrome), #51 (viewer-bar declutter), gallery filter rework
**Defers:** #66 (mobile overhaul) — designed-around but out of scope this pass
**Branch (proposed):** `feature/visual-overhaul`

## Overview

A coordinated visual pass across the four user-facing surfaces — Viewer · Gallery · Editor · About — that:

1. **Locks a single static top bar** rendered identically on every page (the substrate proposed in #103).
2. **Splits per-surface chrome into a clean info row (info only) + action row (verbs only)** instead of today's mixed cluster.
3. **Reworks the gallery filter** (#51 scope) from the current five-simultaneous-histograms wall into a progressive-disclosure layout with brush-selectable ranges.
4. **Repaints in the favicon color scheme** (flame amber `#ffbe3e` → red-orange `#bf2408`), retiring the ad-hoc purple/blue accents that crept in.
5. **Adopts a consistent "convention key" for mockups + spec** (LOCKED · FILLER · SAMPLE · OPEN) so design churn between brainstorm and implementation doesn't lose what was decided vs. what was placeholder.

The editor's existing body (#102 — 7 collapsible sections, scrubby inputs, palette dock) is **untouched**; only the chrome above the editor body adapts to the new convention.

## Scope and constraints

### In scope

- All four surfaces' top + sub-row chrome
- Color scheme migration (favicon palette throughout)
- Gallery filter rework (replaces current `src/gallery-filter-*.ts` UX; mechanism stays equivalent)
- About page content + layout (where the app version lives)
- Tile layout standardization (square aspect, ID-as-link below)
- DRY substrate refactor for the three (now four with About) bar mount functions

### Out of scope

- **Mobile (#66)** — designed-around as a constraint (no decisions block a future mobile pass) but no mobile-specific affordances ship in this overhaul
- Editor body (#102) — already shipped, untouched
- Per-tile metadata expansion (hover-reveal, etc.) — current "image + ID" stays
- Backend / parity / engine work
- Any changes to the corpus, the filter compute logic, or the routing layer

### Design constraints (locked across surfaces)

- **Color scheme** — flame gradient from `#ffbe3e` (top) → `#bf2408` (bottom). Intermediate `#e87c1a` for mid-tone accents. WebGPU status pill stays green `#6cd16c` for "system OK" signal. No purple/blue accents anywhere.
- **Top bar height** — `min-height: 44px`, `padding: 3px 18px` (matches today's production tightness, confirmed via DevTools measurement: `1728 × 43.34`).
- **Position** — `position: sticky; top: 0` on the top bar, pinned during scroll on every page.
- **Wordmark click** — navigates to `/` (Viewer is home; viewer-as-home was reconfirmed in this brainstorm — gallery-as-home was considered and rejected).
- **Version display** — appears on `/about` only. No `v1.4.0` in the top bar (drops the version chip that currently follows the wordmark).

## Mockup convention key

This convention applies to all future mockups + design docs in this lineage:

| Tag | Meaning |
|---|---|
| 🟢 **LOCKED** | Design call made; expect this exactly in the build. |
| 🟡 **FILLER** | Visual placeholder. Stripe overlay + corner "FILLER" tag. Count, exact content, density not decided. |
| 🔵 **SAMPLE** | Illustrative copy / numbers / values. Final wording or counts TBD. |
| 🔴 **OPEN** | Flagged; needs a decision before spec freezes. |

Every mockup carries a legend strip at the bottom enumerating which elements fall in which category for that surface. Brainstorm artifacts live under `.superpowers/brainstorm/<session>/content/` (gitignored).

## Top bar (static, identical across all surfaces)

### Structure

CSS grid, three columns: `1fr | auto | 1fr`.

```
[ brand + about ]    [ tabs ]    [ right cluster ]
```

### Left column (`.left-cluster`, flex)

- **Flame icon** — 38px × 38px inline SVG (same gradient as wordmark; matches `index.html` favicon path verbatim). Transform `translateY(1px)` for optical centering against wordmark baseline. Drop-shadow glow `0 0 6px rgba(255, 130, 30, 0.35)`.
- **Wordmark `pyr3`** — 24px, weight 800, `line-height: 1`, flame gradient text-clip.
- **about ↗** — 18px gap from wordmark. Color `#e87c1a`, external-link arrow (↗) suffix. Links to `/about`.

### Center column (`.tabs`)

Pill group, dark inner background `#07070a`, 3px padding, 9px border-radius, 1px border `#1a1a1f`. Three tab buttons: `Viewer | Gallery | Editor`.

**Active tab styling** (the surface the user is currently on):
- Background: linear gradient `#2a1a08 → #1a0d04` (dark warm).
- Color: `#ffbe3e` (flame top).
- Inner shadow: `inset 0 0 0 1px rgba(255, 190, 62, 0.5), inset 0 1px 3px rgba(0,0,0,0.7)`.
- Outer glow: `0 0 14px rgba(255, 130, 30, 0.2)`.
- Text shadow: `0 0 8px rgba(255, 190, 62, 0.5)`.

Reads as a "pressed-in" amber button. Inactive tabs are muted text `#8a8a92` with hover lift to `#d8d8de`.

### Right column (`.right-cluster`, flex, `justify-content: flex-end`, `gap: 18px`)

In left-to-right order (rightmost = `more flames`):

1. **WebGPU status pill** — `WebGPU ✓` in green. Compact pill `padding: 3px 10px`, green-on-near-black with checkmark suffix.
2. **🍴 fork it ↗** — existing octocat SVG (from `src/ui-bar.ts`, built via `createElementNS`) + amber title "fork it" with arrow + small dim subtitle "pyr3 on github". Links to `https://github.com/MattAltermatt/pyr3`.
3. **🌐 more flames ↗** — second existing octocat + title "more flames" + subtitle "electric sheep fold". Links to the Electric Sheep Fold corpus repo.

## Color tokens

To centralize for `src/ui-bar.ts` and future consumers:

```ts
// proposed: src/ui-tokens.ts (or inline in ui-bar.ts if minimal)
export const COLORS = {
  flame: {
    top: '#ffbe3e',
    mid: '#e87c1a',
    bot: '#bf2408',
  },
  bg: {
    page:   '#0a0a0c',
    bar:    '#0e0e10',
    info:   '#131316',
    action: '#15110d',
    panel:  '#141417',
  },
  border: '#26262c',
  text: {
    primary: '#d8d8de',
    muted:   '#8a8a92',
    dim:     '#5a5a60',
  },
  webgpu: '#6cd16c',
  danger:  '#e85a4a',     // remove-button hover; destructive-action accent
} as const;
```

## Per-surface chrome

Every surface composes:

```
[top bar (44px, static)]
[info row (info only — no verbs)]
[action row (verbs only — no info)]   // optional per surface
[render progress bar]                  // viewer + editor only, when active
[body / canvas / grid]
```

### Viewer (`/`)

**Info row**
- Single-line strip, all content visible (no overflow).
- Content (left-to-right): flame name (bold white) · `·` · dimensions (amber) · `·` · quality (amber) · `·` · tier label · `·` · **all variations expanded** (no `+2` collapse — variations spread across the full row width).
- Example: `electricsheep.247.19679 · 1920×1080 · q50 · Standard · linear · julia · bent · fan · spherical · sinusoidal`
- Background `#131316`, font-size 13px, padding `8px 18px`.

**Action row**
- Background `#15110d`, padding `7px 14px`, `min-height: 44px`, gap 10px.
- Content (left-to-right):
  - `📂 Open` — secondary button
  - `📐 Size ▾` — dropdown showing the current selected dimensions in amber (e.g., `📐 1920×1080 ▾`)
  - `QUALITY` label (small caps, dim) + numeric button group: `10 · 25 · 50 · 75 · 100`. Current selection highlighted in amber.
  - `🧬 Save Flame` — secondary button. Saves `.pyr3.json` genome.
  - `💾 Save Render` — **primary popped CTA**. Filled flame gradient background, dark text, glow. Saves PNG at the current size + quality.
  - `[grow spacer]`
  - `🔥 surprise me` — amber pill. Picks an interestingness-weighted flame from the corpus.
  - `‹ 247.19678` and `247.19680 ›` — amber pills. Prev/next in corpus.
- **Advanced button dropped** — power-user knobs now live in the Editor.

**Size dropdown menu (categorized)**
- `Common`: 1920×1080 (HD), 2560×1440 (2K), 3840×2160 (4K), 1080×1080 (square)
- `Phone portrait`: 1290×2796 (iPhone 15 Pro), 1284×2778 (iPhone 14 Pro Max), 1080×1920 (FHD portrait), 1440×3120 (Pixel 8 Pro)
- `Tablet`: 1668×2388 (iPad Pro 11"), 2048×2732 (iPad Pro 12.9")
- Footer: `⚙ Custom size & quality → open in Editor` (deflects custom sizing to the editor)

**Render progress bar** — appears between action row and canvas only while a render is in flight. Shows `Rendering · <dims> · q<n> · pass M/N`, a fill bar in flame gradient, and the percent. Disappears at idle. Existing informational links preserved.

**Canvas** — fills below the bar stack.

### Gallery (`/showcase`)

**Info row** (three-column grid: `1fr | auto | 1fr`)
- **Left** — empty (keeps center truly centered).
- **Center** — page-nav cluster, matches existing production styling (outlined amber pills, no fill):
  - `‹ prev` — outlined amber pill
  - `page <N> of <M>` — text, `tabular-nums`, **`min-width: 160px`, text-align: center** so prev/next pills do not shift horizontally as the page-number digit count changes.
  - `next ›` — outlined amber pill
  - `🎲 random page` — outlined amber pill with die-icon prefix
- **Right** — `🧰 Filter ▾` button with an inline active-filter count badge when ≥1 filter is active (`🧰 Filter 3 ▾`). Bare button when none.

**Tile grid**
- **3 × 3 = 9 tiles per page** (matches current `GALLERY_PAGE_SIZE = 9` in `src/load-intent.ts`). No change to page size.
- Each tile is a flame thumbnail at **square aspect ratio (1:1)** — matches current production tile rendering.
- Below each tile: ID label `<gen>/<id>` (e.g., `198/07372`), centered, monospace, color `#5a5a60` (dim). Hover transitions to `#ffbe3e`. ID *is* the link; clicking either the tile or the ID opens the viewer for that flame.

**Filter rework** (replaces current sprawl shown in image #11)
- Implementation direction: **progressive disclosure inline + brush-select histograms**.
- Filter panel slides open below the info row when the `🧰 Filter ▾` button is clicked (toggled).
- Panel contents:
  - **Active filter chips** at the top — each chip is a one-click remove. Example: `color variation 0.3–0.7 ×`. `× clear all` link on the right.
  - **Sort** — dropdown (`time | interest | coverage | entropy | colorVar | meanLum`) with a separate direction toggle (`↓ desc` / `↑ asc`). Sort labels match the existing names verbatim; only the filter labels get plain-English treatment (below).
  - **Variations** — chip selector. Add via `+ add ▾` opening the variation list; click to add, ×-click to remove.
  - **Metrics rows** — one row per dimension. Each row: name (left, plain-English) · histogram (middle, ~24px tall, distribution of corpus flames in this dimension) · range value (right, e.g., `0.3–0.7` or `all`).
    - **Range selection mechanism: brush-select on histogram bars (B2 from brainstorm).** Click on a bar and drag to a second bar — the range "paints" between them. Edge brackets mark the current range. Hover-tooltip on the histogram reads "click & drag to select range" for discoverability.
  - **Plain-English label mapping** (filter metrics only — sort labels stay as-is):
    - `interest` → `interestingness`
    - `coverage` → `coverage` (unchanged — already plain)
    - `entropy` → `complexity` (entropy is technical jargon)
    - `colorVar` → `color variation`
    - `meanLum` → `brightness`
    - `xforms` → `xform count`
- **Apply / Reset** at the panel bottom. Reset clears all active filters.

The histogram + brush mechanism preserves the "where do flames live in this dimension?" distribution signal that the current production filter offers — the rework is about *presentation*, not stripping data.

### Editor (`/v1/edit`)

**Info row** (single-line, info only)
- Editable flame name input (default: `untitled`) — dashed-underline edit affordance. Hover/focus expands the underline to amber.
- `by` label (dim).
- Editable author nick input (default: `you`) — same dashed-underline affordance.
- `·` · dimensions (amber, current size).

**Action row** — same shape as viewer's, with **`🎲 Reroll`** added between Open and Size:
- `📂 Open · 🎲 Reroll · 📐 Size ▾ · QUALITY [10 · 25 · 50 · 75 · 100] · 🧬 Save Flame · 💾 Save Render (popped)`
- No right-cluster pills (no surprise / prev / next — editor doesn't browse the corpus).

**Body** — the existing #102 panel + preview layout, completely unchanged. 7 collapsible sections on the left (🎨 Palette · 📐 Viewport · 🧬 Xforms · 🔚 Final xform · 🌐 Global · 💫 Density Emitter · 🎚️ Render), preview canvas on the right.

### About (`/about`)

**Body** — single-column readable layout, `max-width: 740px`, centered, generous padding.

**Content sections (in order):**

1. **Title + tagline**
   - H1 `pyr3` in flame gradient
   - Tagline: short sentence on what pyr3 is (TS + WebGPU fractal-flame renderer; flam3 lineage; GPL-3.0-or-later)

2. **Version chip** — amber outline pill on its own line. Format: `⚙ version 1.4.0 · build 2026-06-04 · WebGPU on Dawn`. Build date pulls from build-time injection; version from `package.json`. **This is the only place the version appears in the UI.**

3. **What it is** — paragraph explaining client-side WebGPU rendering, the dual frontend/CLI engine seam, the "similar but not identical to flam3-C" R-tolerance contract.

4. **Lineage** — paragraph crediting Scott Draves & Erik Reckase for the flam3 algorithm, linking the reference C impl, and the Electric Sheep Fold corpus.

5. **Credits** — bulleted list:
   - Algorithm · Scott Draves & Erik Reckase (flam3, 1992–present, GPL-3.0)
   - Corpus · Electric Sheep Fold
   - WebGPU + WGSL · Chrome team / Dawn
   - This implementation · pyr3 — TypeScript port + WGSL rewrite (GPL-3.0-or-later)

6. **Links** — bulleted list (all external, with ↗):
   - github.com/MattAltermatt/pyr3 · source + issues
   - Releases · ship history
   - License · GPL-3.0-or-later

7. **Notes** — small-text paragraph on WebGPU browser requirement + GPU-vendor variance disclaimer (Apple Silicon vs AMD/NVIDIA, both still pass R-tolerance).

No back-button or "return to viewer" affordance — the top bar's Viewer tab is right there.

## Tab navigation contract

The three tabs (`Viewer | Gallery | Editor`) are not stateless navigation — they carry the current-flame context per a one-way rule:

- **Viewer → Gallery**: opens the gallery at the page containing the currently-viewed flame, highlighting that tile.
- **Viewer → Editor**: opens the editor preloaded with the currently-viewed flame's genome. **Overwrites the editor's WIP without prompting** — Save Flame is one click away on the viewer's action row if the user wants to keep their work first. Revisit as a "discard unsaved?" prompt if this bites in practice.
- **All other tab transitions** (Editor → anywhere, Gallery → anywhere): NO context transfer. Each target surface restores its own last state.
- **Editor preserves WIP** across tab clicks via `localStorage`. Returning to the editor restores the genome in progress.
- **Gallery has no per-tile anchor** until the user clicks a tile (which navigates to viewer as today).

Implementation: a small app-state module exposes a `currentFlame` (genome + optional corpus-ID) that Viewer writes when it loads a flame and Editor writes when its genome changes. Tab clicks read it and pass it through the new-surface URL params.

## Editor body — design conventions

Issue #102 shipped the editor's structural foundation (7 collapsible sections, scrubby inputs, palette dock, the two-lane render). This pass overhauls the editor body's *interaction conventions* — not its structure. Acceptance: the existing #102 features remain shipped; their presentation is normalized to the conventions below.

### Section default state + persistence

- All seven sections default **collapsed** on cold load (matches the current `src/edit-state.ts` `sectionCollapse` initializer — every key starts `true`).
- User's expand/collapse choices persist to `localStorage` under the same key family as the WIP genome state. Returning to editor restores the user's last view.
- The chevron + emoji + UPPERCASE name section-header pattern is unchanged.

### Cold-start state

When `/v1/edit` opens with no URL params and no localStorage WIP:

1. **If localStorage has a saved WIP genome** → restore it.
2. **Otherwise** → random reroll (same code path as the `🎲 Reroll` button's existing behavior in #102). No hero-flame fallback.

This pairs the existing WIP-restore with the random-on-fresh-visit story. Users always see *something* meaningful; never an empty canvas.

### Row pattern (canonical)

Every row in every section follows:

```
display: grid;
grid-template-columns: 96px 1fr;    /* label · control */
align-items: center;
gap: 12px;
```

- Labels left-align in `--text-muted`, fixed 96px column.
- Controls right-align inside the 1fr column with consistent widths.
- Pairs (`W × H`, position `x, y`) use an inner sub-grid `1fr auto 1fr` with the separator (`×` or `,`) pinned center — neither input can clip.
- Compact controls (oversample `1×`, symmetry count) use fixed-narrow widths (`flex: 0 0 60px` or `76px`).

Section header retains the `▼/▶ chev · emoji · UPPERCASE TITLE` shape and may carry a right-aligned meta chip (e.g., `hue +30°`, `vivid`) showing key state visible even when the section is collapsed.

### Input primitives

- **Text/number input** — dark bg, 1px border, `tabular-nums`, right-aligned text. Focus border lifts to `flame.mid`.
- **Dropdown** — same chrome as input; caret `▾` in `--text-muted`.
- **Slider** — 4px rail in `--bg-tertiary`; fill in `flame.mid`; 14px handle in `flame.top` with 2px section-color border (so it pops). Numeric value always displayed on the right edge in `flame.top` with `tabular-nums`.
- **Color swatch** — full-width-of-control-column flat bordered box. Click opens a color picker (existing #102 affordance).
- **Checkbox** — 16×16 square, amber-filled with white check when on; dark with `--border-input` when off.

### Active/inactive toggle (xforms + variations)

Pill switch widget, 32×18px:

- **On**: amber pill (`rgba(255,190,62,0.18)` bg + `rgba(255,190,62,0.55)` border) + amber thumb on the right with soft glow.
- **Off**: dark pill + `--text-muted` thumb on the left.

`Shift+click` solos (preserves #102 contract — `Xform.active === false` / `Variation.active === false` are existing fields that `src/symmetry.ts:expandGenomeForGPU` already zeros packed weights for).

### Inactive state visual

When an xform or variation row is inactive:

- Header background dims (`#0a0a0d` for xform headers; row-level styling for variations).
- Label colors shift to `--text-dim`.
- Body content drops to 40% opacity and becomes click-through (`pointer-events: none`) for xform bodies; 55% opacity on variation row text.
- Subtle diagonal cross-hatch overlay on inactive headers reinforces the muted read without screaming "broken".

### Remove button

22×22 transparent square with `×` glyph at rest (`--text-dim`). Hover lights up with red-tinted background + red border + danger color (`--danger: #e85a4a`). **One-click destructive, no confirmation popup** — the localStorage WIP-restore is the safety net. Revisit if remove proves too easy to misfire.

### Button affordance tiers

Three button styles, distinct visual weight:

- **`btn`** (default secondary) — two-stop dark gradient (`#232328 → #1a1a1f`) + 1px border + inset highlight. Hover lifts border to `flame.mid` + color to `flame.top`. For neutral actions.
- **`btn-accent`** (warm accent) — warm-tint gradient (`#2a1f10 → #1c1409`) + warm border (`#5a4020`) + amber text. For inline actions where amber framing helps ("🎯 fit", "⟲ reset hue"). Hover lifts border to `flame.top` and brightens bg.
- **`btn-primary`** — already locked for Save Render only — filled flame gradient, dark text, glow. Reserved for the single primary CTA per surface.

### Quick ops (relative modifiers)

Replaces the "shape presets" cluster on affine xforms. **Each button applies a delta to current values, not an overwrite.** Locked op set:

| Op | Effect |
|---|---|
| `rotate +45°` / `rotate −45°` | current rotation += / −= 45° |
| `scale ×2` / `scale ×½` | multiplies / divides both scale x and scale y |
| `flip y` | negates scale y |
| `flip x` | negates scale x |
| `shear +0.1` | adds 0.1 to current shear |

The "identity" preset is split out as a separate **`⟲ reset to identity`** action (rendered as `btn-accent`) so absolute-reset is visually distinct from incremental modifiers. Name of the strip: "quick ops". No `rotate +90°` (drop — `rotate +45°` twice gets there).

### Named-combination presets (Density Emitter)

Some sections benefit from curated multi-value presets where individual knobs interact non-obviously. Pattern:

- **Preset strip** at the top of the section body (sub-row above the row grid): "presets · click to apply" label + N preset buttons.
- Each button **applies all the section's values at once**. Active preset gets `btn-accent` pressed styling.
- **Preset chip in section header** (e.g., `vivid`) — always visible, even when collapsed.
- **Dirty state**: once the user manually touches any value, the chip dims and gets a `*` suffix (`vivid*`); active highlight on the button stays so the user remembers what they started from. Clicking the preset button again re-snaps to clean values.

Density Emitter preset names: `default · soft · vivid · punchy · cinematic · crystal`. **Numeric values per preset are flagged OPEN** — gameplay-tuning per the sacrosanct rule, calibrated against sample flames during implementation with user sign-off before lock.

### Tooltip pattern

Whenever a field needs explanation:

- Small `?` info icon (14×14 circle, dark bg, subtle border) sits inline next to the label. `--text-dim` at rest; amber on hover and when its tooltip is open.
- **Click to toggle** (not hover-only). Tooltip stays open until clicked again or click-outside.
- **Tooltip anchors to the right of the section** (outside the section border, vertically aligned to the source row) so it never overlaps controls. Left-anchor fallback when the section is at the right viewport edge.
- Tooltip format: amber field-name heading in small-caps + body paragraph + dim "leave at default unless…" guidance line.

### Palette subpanel

- **Ribbon preview** at top — full-width 22px gradient strip of the current palette. The one intentional exception to the row grid. Click on the ribbon = shortcut to open the picker. The ribbon shows the *effective* (post-hue-rotation) palette — scrubbing the hue slider live-rotates via CSS `filter: hue-rotate(var(--hue))`, no canvas repaint.
- **`palette` row** — launcher button showing the current palette identifier in amber + a `browse 701 ▸` cue.
- **`hue rotation` row** — slider with `flame.top` value display (in **degrees**).
- **Inline action row** — `⟲ reset hue` (`btn-accent` style) — restores hue rotation to 0°.
- **Section header carries a `hue +30°` chip** so the rotation is visible even when collapsed.

Palette identifier format (the launcher button's content):

| Palette source | Identifier |
|---|---|
| Loaded as part of a corpus flame | `<gen>/<id>` (e.g., `198/07372`) |
| Picked from the flam3 catalog | `flam3 "<name>"` (e.g., `flam3 "sky flesh"`) — name in amber, `flam3` prefix in dim gray |
| flam3 catalog entry with no name | `flam3 #<N>` (numeric fallback) |
| User-saved (future, out of scope) | `mine "<name>"` |

Implementation needs a mapping `flam3 palette number → name` — sourced from a curated names file or upstream metadata; nameless entries fall through to `flam3 #<N>` so the launcher is never empty.

### Palette picker (docked sidecar)

Docked to the right of the editor's left panel (matches existing #102 dock placement). Width ~380px.

- **Header**: title + total/filtered badge + `×` close · search input · color filter chips · tabs · sort + auto-apply toggle.
- **Color filter chips** (11): red · orange · yellow · green · blue · purple · pink · brown · pastel · dark · gray. Each shows the canonical color swatch as a small dot. Multi-select with **OR** within the color filter, **AND** against other filters. `clear` link resets.
- **Tabs**: `all (701) · ★ favorites (N)`. (Recent tab dropped.)
- **Controls row**: `sort: name ▾` (options: name / number / hue / saturation / lightness) + `auto-apply` toggle. When auto-apply ON, clicking a cell instantly previews on the flame; when OFF, cell selection waits for the footer `apply & close`.
- **Grid**: 3 columns. Each cell = palette ribbon (36px) + name + star (top-right corner for favoriting).
- **Active cell**: amber border + glow.
- **Star**: persists favorites to `localStorage` (key separate from variation favorites).
- **Footer**: selected identifier (live) · `revert` · `apply & close`.

**OPEN spec data**: dominant-color tagging algorithm — pre-computed at build time, one-pass histogram → bucket each palette into the 11 categories. Specific quantization thresholds calibrated during implementation.

### Variation picker

Mirrors the palette picker shell deliberately (muscle memory). Same docked sidecar · same header layout · same tabs (`all (99) · ★ favorites (N)`) · same star/favorites · same auto-apply toggle · same footer · same 3-col grid.

Three differences:

1. **Title carries an "xform N" tag** — the picker is contextual to whichever xform's `+ add` button was clicked.
2. **Cell content** = static SVG thumbnail of the variation's transformation + name (no corner type tag, no filter chips — per user direction). Current production thumbnail assets stay; new ones only if necessary.
3. **No filter chips** — name search + favorites is enough. Type categorization stays as-is from current production.

### Xform internal layout (image #22 reference)

Per-xform sub-sections inside the Xforms panel all adopt the conventions above without further design work:

- **Header**: chevron · `#N` badge · variation summary · weight meta · active toggle · remove button (per the locked patterns).
- **Affine fields**: scale x / scale y / rotation / position pair · standard row pattern.
- **Quick ops strip**: per the locked relative-modifier strip; `⟲ reset to identity` action below.
- **VARIATIONS sub-list**: `toggle · name · weight input · ×` rows; `+ var` button opens the variation picker.
- **POST-TRANSFORM**: standard pill toggle widget; when on, an affine sub-block appears below using the same affine controls.
- **COLOR sub-section** (`color` · `colorSpeed` · `opacity`): standard row pattern; sliders with `flame.top` value display. Drop the blue accent currently shipping — sweep to flame palette.
- **XAOS sub-section** (`→xf1`, `→xf2`, …): standard row pattern; compact-width number inputs. Existing field semantics preserved.

Sub-headings ("VARIATIONS" / "POST-TRANSFORM" / "COLOR" / "XAOS") stay in their uppercase small-caps style — they're sub-organizing labels within the section, distinct from the section header itself.

## Implementation seam (#103 DRY substrate)

Refactor `src/ui-bar.ts` to expose a shared chrome primitive:

```ts
// proposed shape — final API decided during implementation
export function mountBarChrome(
  root: HTMLElement,
  opts: ChromeOpts,
): { middleSlot: HTMLElement; destroy: () => void };

interface ChromeOpts {
  surface: 'viewer' | 'gallery' | 'editor' | 'about';
  webgpu: WebGPUStatus;
  onTabClick: (surface: TabSurface) => void;
}
```

The chrome owner builds the left cluster (flame + wordmark + about), the tab group (with active state derived from `surface`), and the right cluster (WebGPU + fork + more) once. It returns a `middleSlot` empty by default; per-surface mount functions (the existing `mountBar`, `mountGalleryBar`, `mountEditBar`, plus a new `mountAboutBar`) compose their info row + action row + body **into the slot below** rather than re-implementing chrome.

The existing per-surface mount fns shrink to: `mount their info row` + (optionally) `mount their action row` + `mount their body` + `wire their handlers`. Not every surface has every sub-row (About has only the long-form body; Gallery has no action row — its actions live in the info row and inside the filter panel; Viewer + Editor have both). The DRY substrate eliminates ~150 lines of chrome duplication and makes future surfaces (#37 vault, #73 evolve) trivial to slot in.

Wordmark click + flame click both dispatch a navigate-to-`/` event from the chrome (not the per-surface bars).

## Color migration

Sweep `src/*.ts` + `src/shaders/visualize_*.wgsl` (UI-only — engine shaders unaffected) for hardcoded purple/blue accent values. Replace with the `COLORS` token table. Known accent surfaces to audit:

- Active-state highlights (currently mixed; standardize on `flame.top`)
- Render progress bar gradient (already amber-ish; lock to flame gradient)
- Selected-tile borders in gallery (audit current state)
- Editor panel section-head expanded color (already amber per #102)

The favicon SVG is the canonical color reference; the token table mirrors its `linearGradient` stops.

## Acceptance criteria

- [ ] **Color scheme** — all UI accent colors source from `COLORS`; grep for hex-literal accent uses returns only the token table.
- [ ] **Top bar** — identical DOM across `/`, `/showcase`, `/v1/edit`, `/about`. Chrome rendered once, no per-surface re-implementation. `position: sticky` confirmed on scroll.
- [ ] **Active tab** — tab matching current surface renders pressed-amber per spec; others muted. Click navigates correctly between routes.
- [ ] **About page** — exists at `/about`; version chip renders from `package.json` and build date; tab "about" highlights via the about-link (not via the Viewer/Gallery/Editor tab group — about is intentionally outside the tab cluster).
- [ ] **Viewer** — info row carries all variations expanded (no `+2`); action row has no Advanced button; Save Render visually distinct from Save Flame; size dropdown menu shows the categorized preset list; render progress bar info preserved.
- [ ] **Gallery info row** — three-column grid; page-text has `min-width: 160px` so prev/next pills do not shift; filter button shows active-count badge when filters apply.
- [ ] **Gallery tiles** — 3×3, square aspect, ID label below in dim gray; ID + tile both navigate to viewer.
- [ ] **Gallery filter** — old layout removed; new progressive-disclosure panel with brush-select histograms; plain-English labels per the mapping table.
- [ ] **Editor chrome** — top bar + info row (editable name + nick + dims, info-only) + action row matching viewer with `🎲 Reroll` added; render progress bar additive.
- [ ] **Editor body** — every section reflowed to the canonical row pattern (`96px label · 1fr control` grid). All inputs right-edge-align; W×H pair uses `1fr auto 1fr` sub-grid; pairs never clip.
- [ ] **Editor state persistence** — `localStorage` round-trip restores WIP genome and section collapse state on revisit; cold-start with no localStorage triggers random reroll (no hero fallback).
- [ ] **Tab navigation** — Viewer → Gallery anchors gallery at the current flame's page; Viewer → Editor preloads the editor with the current flame's genome. No other tab transition transfers context.
- [ ] **Active/inactive widgets** — pill-toggle widget shared between xform headers and variation rows; `Shift+click` solos per the existing #102 contract; inactive state dims header + cross-hatches.
- [ ] **Quick ops** — affine section's "shape presets" replaced with the relative-modifier set; `⟲ reset to identity` is the only absolute action and uses `btn-accent` styling.
- [ ] **Density Emitter presets** — six-preset strip at top of section body; chip in section header shows current preset with dirty-state (`*`) marker.
- [ ] **Tooltip pattern** — `?` info icon next to labels that need help; click to toggle; popover anchors to the right of the section (fallback left); existing #102 tooltips that overlapped controls are replaced with this pattern.
- [ ] **Palette subpanel** — ribbon previews effective (rotated) palette live; identifier format follows the locked table (`<gen>/<id>` for corpus-source, `flam3 "<name>"` for catalog-source).
- [ ] **Palette + variation pickers** — docked sidecar, 3-col grid; palette picker has 11 color-filter chips; variation picker is xform-contextual with no filter chips; both have ★ favorites persisted to localStorage.
- [ ] **Existing #102 tests** stay green; new tests cover the row pattern, toggle widget, remove button, tooltip popover, preset strip dirty-state, palette ribbon live-rotation, and picker favorites round-trip.
- [ ] **Tests** — existing `gallery-mount.test.ts` adapted to new info-row structure; new tests cover the chrome-substrate, tab active-state derivation, the about page presence, and the filter brush-interaction (likely a `@playwright` test for the drag gesture).
- [ ] **Type-check + unit tests + parity-rig**: green on PR.
- [ ] **Chrome verify** — all four surfaces eyeballed end-to-end: top bar consistent · tab highlight correct · gallery tiles render · filter panel opens + brush-selects · viewer save flame + save render both produce correct files · editor chrome adopts without breaking edit flows · about page reads cleanly.

## Out of scope (explicit deferrals)

- **#66 mobile overhaul** — narrow-viewport reflow, touch-scrubby, gesture interactions. Designed-around: the locked top bar's three-column grid can collapse cleanly on narrow viewports, the gallery's 3×3 can flex to 2-col / 1-col, and the action rows are already line-wrap-tolerant. No mobile work ships here.
- **Per-tile metadata** — hover-reveal, always-show variation list, etc. Filed as a follow-up if it becomes desired.
- **Filter compute logic** — the histograms, the active-filter pipeline, the corpus query — all unchanged. Only the UX rendering is reworked.
- **#37 visual flame editor** (post-v1 vault + recents + undo + landing) — explicitly outside.
- **#73 evolve page** — parked; no chrome adoption until it unparks.

## Brainstorm artifact references

The visual-companion mockups that drove this design live at:
`.superpowers/brainstorm/<session>/content/*.html`

Key mockups in lineage order: `q3-topbar-v6.html` (locked top bar) · `q4-viewer-action-v3.html` (locked viewer action row with Save Flame + Save Render) · `q5-gallery-final.html` (locked gallery tiles) · `q5b-interactions.html` (locked B2 brush-select) · `q5-gallery-info-row.html` (locked info-row layout with page-nav centered + filter right) · `q6-editor-and-about.html` (locked editor chrome adoption + about page).

## Code references

- `src/ui-bar.ts` — the file refactored most heavily. Contains all three current bar mount functions (`mountBar`, `mountGalleryBar`, `mountEditBar`); will gain `mountAboutBar` + the shared `mountBarChrome`.
- `src/main.ts` — wires the bars per route; touchpoints around the three `mountX` calls.
- `src/gallery-mount.ts` — gallery's per-surface row + filter panel mount. Filter UX replaced here.
- `src/gallery-filter-*.ts` — current filter implementation; mechanism preserved, UX rebuilt.
- `src/load-intent.ts` — `GALLERY_PAGE_SIZE = 9` stays.
- `index.html` — favicon SVG (the canonical color reference).
- `package.json` — version + build-date source for the About page version chip.
- `src/edit-mount.ts` + `src/edit-section-*.ts` — editor body, untouched.

## Risks + mitigations

- **DRY refactor regression risk** — moving chrome out of three sibling functions into a shared primitive can break per-surface idioms. Mitigation: ship the substrate first (no UX change), verify the three surfaces render identically, then layer the visual updates on top.
- **Filter rework risk** — the brush-select gesture is novel; a test for it needs to drive synthetic mouse events at pixel coordinates (the `replaceChildren` + click bug noted in CLAUDE.md applies here — MCP clicks via uid won't reproduce real-mouse behavior). Mitigation: pair the gesture with an explicit "click & drag" tooltip + a fallback "type the range numbers" affordance flagged OPEN for the iteration loop.
- **Color sweep miss** — purple/blue accents may linger in obscure code paths. Mitigation: grep for hex literals during code review; require all accent colors to route through the `COLORS` table.
- **About-page version drift** — the About page becomes the single version surface. If version isn't visible elsewhere, build/deploy regressions could go unnoticed. Mitigation: confirm `package.json` version still surfaces in the browser console at app boot (existing behavior; verify unchanged).

## Next steps

1. **User review of this spec** (gate before plan-writing).
2. On approval → invoke `writing-plans` to produce the implementation plan with phase breakdown, then proceed via the standard Subagent-Driven execution for pure-logic tasks (chrome substrate refactor, filter panel rebuild, about page) and lead-Inline tasks (Chrome verify, dev-server orchestration).
