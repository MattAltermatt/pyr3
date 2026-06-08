# /v1/edit — flame editor v1 (quick pass)

**Filed 2026-06-03 from brainstorm session.**

## Goal

Give pyr3 a single-flame **editing surface** — a page where the user
loads one flame (random seed, corpus id, or `.pyr3.json` open) and
tweaks **every adjustable genome value** with live visual feedback. The
math is *not* hidden (unlike `/v1/evolve` which hides everything behind
labeled mutation cells): every field has an honest control in a
left-side panel of collapsible sections.

This is the **foundation evolve sits on top of**. Once the editor
exists, the evolve loop's mutations have a meaningful surface to point
at ("edit this center cell directly"); without it, evolve dead-ends
when the user wants to refine a candidate they like.

## Why this is NOT the post-v1 visual editor (#37)

Issue #37 sketches the much broader vision: mutator + vault + recents +
undo + landing screen + session persistence + framework choice
(React/Svelte/Solid). The body explicitly flags it as "large enough to
consume the project" and depends on the v1.0 ship-gate pass.

The v1 surface in this spec is **deliberately smaller** — an honest
edit-every-field surface in vanilla TS+DOM. It defers vault, recents,
undo, landing, session persistence, framework migration, and on-canvas
direct manipulation (triangle gizmos). All of those become v2+
candidates in their own brainstorm cycles. #37 stays open as the
umbrella vision; this spec ships the foundation.

## Scope (v1)

- New route `/v1/edit` rendered by the same SPA shell as `/viewer` and
  `/v1/evolve`.
- Two-column layout: left panel with 7 collapsible sections, right side
  is a single render canvas whose aspect reflects the configured render
  dimensions (so iPhone wallpaper editing previews as a tall canvas).
- Every adjustable genome field is exposed in the panel; **animation
  excluded** explicitly. Palette stop-by-stop editor deferred to its
  own phase.
- **Two-lane refresh**: `present()`-only updates for palette / tonemap
  / density / background; `iterate()` re-runs only when xform inputs,
  viewport, or symmetry change; pipeline `resize()` only when render
  dimensions / oversample / filter radius change.
- Top bar: `🎲 reroll seed · 📂 open .pyr3.json · 💾 save .pyr3.json ·
  🖼️ render PNG`.
- All sections collapsible (▼/▶ chevron header); default state =
  expanded. Per-xform cards also individually collapsible.
- **No sliders unless the range is known.** Numeric inputs by default;
  sliders only for [0..1] / [0..360] / known-bounded ranges.
- **Nothing hidden behind progressive-disclosure "advanced" toggles.**
  Collapsible accordion is the only way to hide content, and it's user-
  driven.

## Out of scope (v1)

- Palette stop-by-stop editor (own phase later — see deepening list)
- On-canvas xform triangle gizmos (own phase later)
- Per-variation parameter sliders with variation-specific known ranges
  (v1 shows `param0..param7` labeled from `VARIATION_PARAMS` as plain
  number inputs; v2 maps known ranges to sliders)
- Cross-surface entry — "✏️ edit this" buttons in `/viewer` and
  `/v1/evolve` (small follow-up phase later)
- Vault / recents / undo / landing screen / session persistence (these
  are #37's broader scope, intentionally deferred)
- Animation / keyframe editing (out of pyr3 scope generally)
- Framework migration to React/Svelte/Solid (vanilla TS+DOM stays;
  #37's framework decision remains parked)

## Architecture

### File layout (per-section UI modules; per-concern engine plumbing)

```
src/edit-mount.ts              route handler, canvas mounting, owns EditState
src/edit-state.ts              EditState + lane dispatcher + per-lane debouncer
src/edit-seed.ts               random procedural seed (delegates to evolve-seed
                               if/when that lands on main; for now self-contained)
src/edit-render.ts             wraps Renderer; routes lane changes to
                               reset / iterate / present; owns the live
                               histogram across edits
src/edit-ui.ts                 composes section modules into the left panel
                               (top bar + collapsible accordion)

src/edit-section-palette.ts    palette strip + ◀▶ arrows + popover picker
                               (same shape as evolve's palette picker);
                               plus hue rotation slider + linear/step mode
src/edit-section-viewport.ts   scale / cx / cy / rotate (numeric inputs +
                               ±1 / ±10 / ±0.1 steppers, same UX as
                               evolve's viewport card)
src/edit-section-xforms.ts     per-xform card: weight / color / colorSpeed /
                               opacity / affine a-f / post.{a..f} (toggle) /
                               variations[] (kind + weight + param0..7) /
                               xaos row (N number inputs)
src/edit-section-final.ts      final xform: toggle active + same shape as
                               an xform (no weight, no xaos)
src/edit-section-global.ts     tonemap.brightness / .gamma / .vibrancy /
                               .highlightPower / .gammaThreshold + background
                               color picker + symmetry (toggle + kind + n)
src/edit-section-density.ts    DE preset dropdown + maxRad / minRad / curve
                               sliders (all ranges known)
src/edit-section-render.ts     size preset dropdown (iPhone / iPad / 1080p /
                               4K / square / custom) + w×h number inputs +
                               quality / oversample / filter radius / filter
                               shape

— targeted edits —
src/main.ts                    add /v1/edit route entry
```

**Rationale for per-section UI files** (departure from evolve's single
`evolve-ui.ts`): the v1 quick pass + per-section deepening rhythm means
each future "deepen palette stops" / "add xform gizmos" phase will edit
one file instead of scrolling through a 1500-line UI module. Total
v1 LOC across the section files will be comparable to `evolve-ui.ts`;
split-vs-mono is paid up front so deepening stays local. **Extraction of
the evolve panel parts into shared section modules is out of scope for
v1** but flagged as a future cleanup once the editor stabilises.

### State model

```ts
interface EditState {
  genome: Genome;                          // the live flame
  seed: number;                            // chaos game seed (determinism)
  preview: { width: number; height: number };  // canvas display dims
  sectionCollapse: Record<SectionKey, boolean>;
  xformCollapse: Record<number, boolean>;
  subscribe(fn: (change: StateChange) => void): () => void;
  // ...field-level mutators that produce StateChange events
}

type Lane = 'fast' | 'slow' | 'rebuild';

interface StateChange {
  lane: Lane;
  path: string;        // e.g. 'xforms.1.variations.0.weight'
}
```

### Lane categorisation

Pure function `(path: string) => Lane`:

| Lane         | Triggered by                                                                              | Renderer call                                                  |
|--------------|-------------------------------------------------------------------------------------------|----------------------------------------------------------------|
| `fast`       | palette swap, palette.hue, palette.mode, tonemap.*, density.*, background                 | `setPalette` (if palette changed) → `present()`                |
| `slow`       | xforms.* (any field), finalxform.*, scale, cx, cy, rotate, symmetry                       | `reset(genome)` → `iterate(quickModeSamples)` → `present()`    |
| `rebuild`    | size.width, size.height, oversample, spatialFilter.radius                                 | `resize()` → `reset(genome)` → `iterate()` → `present()`       |

Debounce per lane: fast = 16ms (next-frame); slow = 100ms (let drags
settle); rebuild = 200ms (resize is heaviest).

### Refresh loop

1. User edits a field → state mutator → emits StateChange(lane, path).
2. Lane dispatcher adds path to lane's pending set; debounce timer (re)starts.
3. On debounce fire:
   - `rebuild`: renderer.resize(opts) → reset(genome) → iterate(quick) → present.
   - `slow`: reset(genome) → iterate(quick) → present.
   - `fast`: setPalette if palette changed → present.
4. Canvas just shows the next frame; section UIs don't rebind on render
   (they rebind only when genome is *replaced* — open/reroll).

Quick-mode samples: 1024 long-edge equivalent at quality≤16,
oversample=1 (same budget as evolve cells, ~200ms-1s wall on a real
GPU).

## Per-section quick-pass content

### Top bar (always visible)

- `name` text input (genome.name)
- `nick` text input (genome.nick)
- `🎲 reroll seed` · `📂 open .pyr3.json` · `💾 save .pyr3.json` · `🖼️ render PNG`

### 🎨 Palette

- Clickable strip (current palette gradient) + label `<palette-name> ·
  flame #N` (same shape as evolve)
- ◀ / ▶ arrows step through the 701-palette library
- Click strip → 3-col popover picker (reuse evolve picker)
- Hue rotation: `0..360°` slider + number input (writes `palette.hue`)
- Mode radio: linear / step (writes `palette.mode`)

### 📐 Viewport

- `scale` / `cx` / `cy` / `rotate` numeric inputs with ±1 / ±10 / ±0.1
  steppers (reuse evolve's viewport card UX)

### 🧬 Xforms (collapsible accordion of N xform cards + `+ add`)

Per xform card (when expanded):
- Header: `▼ xform N · weight <input> 🗑️`
- `color` slider (0..1) + palette-index preview
- `colorSpeed` number input (range unknown — input only, no slider)
- `opacity` slider (0..1)
- **affine** label · `a b c` row · `d e f` row (6 number inputs)
- **post-transform** checkbox (active toggle) — when active, 6 number
  inputs for `post.{a..f}`; when inactive, inputs disabled and the
  `post` field is undefined in the genome
- **variations** label · `+ var` button · per-variation row:
  - kind dropdown (99 variations from `V` registry in `src/variations.ts`)
  - weight number input · 🗑️
  - param fields `param0..7` shown only when needed (look up which
    params are used from `VARIATION_PARAMS` in `src/serialize.ts`),
    labeled by name (e.g. `julian → power / dist`; `pdj → a / b / c / d`)
- **xaos →** row: N number inputs (one per other xform), default 1.0

### 🔚 Final xform

- Active checkbox (when off, `genome.finalxform = undefined`)
- When on: same card shape as a regular xform, minus `weight` and `xaos`

### 🌐 Global

- `brightness` number input (default 25)
- `gamma` number input (default 2.2)
- `highlightPower` number input (default 1.0)
- `gammaThreshold` number input (default 0.01)
- `vibrancy` slider 0..1
- `background` color picker (writes `genome.background` as `[r, g, b]`
  in 0..1)
- `symmetry` checkbox · kind dropdown (rotational / dihedral) · `n`
  number input — when off, `genome.symmetry = undefined`

### 💫 Density Emitter

- Preset dropdown: classic / crisp / dreamy / detail / custom (from
  `DENSITY_PRESETS` in `src/density.ts`); picking a preset replaces all
  three values and flips the dropdown to that preset name; manual
  editing flips it to "custom"
- `maxRad` slider 0..30 + number input
- `minRad` slider 0..maxRad + number input
- `curve` slider 0.1..2.0 + number input

### 🎚️ Render

- Size preset dropdown:
  - iPhone 15 Pro (1290 × 2796)
  - iPad Pro (2048 × 2732)
  - 1080p (1920 × 1080)
  - 4K (3840 × 2160)
  - Square (2048²)
  - Custom
- `width` × `height` number inputs (picking a preset fills these;
  manual edit flips dropdown to Custom)
- `quality` number input (default 100; presets clamp where needed)
- `oversample` dropdown (1 / 2 / 4)
- `spatialFilter.radius` number input + `shape` dropdown

## Entry points

Three ways to land on `/v1/edit`:

1. **Direct URL** — `/v1/edit` → random procedural seed (delegated to
   the same generator as evolve's reroll).
2. **Corpus query** — `/v1/edit?gen=NNN&id=MMMMM` → load that
   electricsheep flame from the chunked corpus (matches viewer URL
   convention).
3. **Open file** — `/v1/edit` → click 📂 → file picker → `.pyr3.json` →
   load.

## Save / Open

- **Save** (`💾`): serialize via `genomeToJson`; trigger browser
  download named `<slugified-name>.pyr3.json`. No localStorage / no
  cloud.
- **Open** (`📂`): file picker accepts `.pyr3.json`; parse via
  `genomeFromJson`; replace `EditState.genome`; section UIs rebind;
  slow-lane refresh fires.
- **Reroll** (`🎲`): replace `EditState.genome` with a fresh
  procedurally-seeded flame; same rebind + slow-lane refresh path as
  open.

## Render PNG (full-dim save)

Separate from save (which writes JSON, not pixels). On click:

1. Disable panel inputs (modal: "Rendering at WxH… N%").
2. `renderer.resize({ width, height, oversample, filterRadius })` to
   configured Render-section dims.
3. `renderer.reset(genome)` and `renderer.iterate(...)` at full
   quality.
4. `renderer.present(...)` to an offscreen render texture.
5. Hand bytes to `save-image.ts` for PNG download (`<slugified-name>.png`).
6. Restore preview dims and re-iterate at quick-mode so the editor
   canvas isn't stuck on the high-res render.

## Error handling

- **Invalid number input** — revert to last valid value on blur; no
  popups.
- **`.pyr3.json` parse failure** — toast at top of panel; same shape as
  the fix for evolve bug #76.
- **Render failure** — error overlay on canvas; same shape as evolve
  bug #98 fix.
- **Schema validation** — flow through existing `serialize.ts`
  validators; clamp out-of-spec values silently.

## Testing

- **Unit**: lane dispatcher categorisation (path → lane mapping),
  debouncer (timer behaviour), seed determinism, each section's
  edit-event → genome-diff (one test per editable field).
- **Round-trip**: edit → save → reopen → identical genome
  (`genomeFromJson(JSON.parse(JSON.stringify(genomeToJson(g)))) ≡ g`,
  already proven for evolve; just exercised through the editor UI).
- **Chrome E2E**: load `/v1/edit`, change one field per section,
  observe re-render frame count + dim deltas.
- **Seam contract**: `edit-state.ts` and `edit-render.ts` contain zero
  DOM (`seam.test.ts` enforces); DOM lives only in `edit-mount.ts`,
  `edit-ui.ts`, and `edit-section-*.ts`.

## Acceptance

- Page loads at `/v1/edit` (and `?gen=247&id=19679`, and after `.pyr3.json`
  open) and renders the loaded flame in ≤ ~1s on a real GPU.
- Every field listed in the per-section content above is wired to its
  genome path and triggers a refresh.
- Fast-lane edits (palette, tonemap, DE, background) render within one
  next-frame budget (< 50ms perceived).
- Slow-lane edits (xforms, viewport, symmetry) render at quick-mode
  budget (~200ms-1s).
- Round-trip save → reopen produces an identical genome.
- `🖼️ render PNG` produces a PNG at configured dimensions; preview
  canvas restores to interactive dims afterward.
- All existing parity gates remain green (`npm run test:parity`
  unchanged — the editor doesn't touch the importer or the renderer's
  pixel-correctness path).
- `seam.test.ts` passes against all new `src/edit-*.ts` modules.

## Phasing — v1 quick pass first, then per-section deepening

**v1 (this spec)** — page + canvas + state + all 7 sections at quick-
pass content + save/open/reroll/render-PNG.

**v2 candidates** (each its own brainstorm + plan + impl cycle, prioritised when surfaced):

| Phase           | Scope                                                                                                                |
|-----------------|----------------------------------------------------------------------------------------------------------------------|
| palette-stops   | Stop-by-stop palette editor (drag stops along 0..1, edit colors, add/remove). Replaces "picker only" for palette.    |
| xform-gizmos    | On-canvas triangle handles for affine + post xforms; drag/scale/rotate with snap. Heavy WGSL-ish UX work.            |
| variation-params| Per-variation param fields with variation-specific known ranges → sliders (e.g. `julian.power` 1..10).               |
| xaos-matrix     | Replace per-xform xaos row with a full N×N matrix view.                                                              |
| editor-from-x   | Cross-surface "✏️ edit this" buttons in `/viewer` and `/v1/evolve`.                                                  |
| editor-share    | Same shape as evolve's `🔍 view in viewer`: localStorage genome handoff so the editor opens with a passed genome.     |

## Open questions / parked decisions

- Whether to file a tracking GitHub issue for the v1 quick pass (and
  whether to bundle it under #37, or to file as its own focused issue
  with a "blocks-evolve-resumption" note). User to decide on GitHub
  write at branch / PR creation time per the standing approval rule.
- Whether `palette.hue` belongs in the palette section (current spec)
  or in Global with the other tone knobs. Current call: palette
  section, because it's a palette-specific transform.
- Long-term: if the editor grows beyond the foundation it sits on, fold
  some of the v2 candidates back into the #37 umbrella tracker.

## Effort

**L** — new page (mount + state + render + UI composition) + 7 section
modules + lane dispatcher + reroll/save/open/render-PNG plumbing.
Smaller than evolve was, because (a) no 3×3 grid orchestration, (b) no
mutation samplers, (c) no breadcrumb cache, (d) reuses evolve's palette
picker and viewport card shapes. Larger per-file count than evolve (per-
section UI split) but each file is small.
