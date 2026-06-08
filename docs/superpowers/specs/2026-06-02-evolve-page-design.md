# /v1/evolve — Picbreeder-style fractal-flame creator design spec

**Issue:** #73 — /v1/evolve — Picbreeder-style flame creator page (+ pyr3.json as save format)
**Milestone:** unmilestoned (themed milestone to be set when scheduled)
**Date:** 2026-06-02
**Status:** locked via brainstorm; ready for implementation plan

---

## Goal

Give pyr3 a **directed creation surface** — a page where a user starts from
a random flame and steers it toward something they love, **without ever
touching a transform matrix or knowing what a variation weight is**. The
math stays hidden; the user only sees rendered candidates and human-readable
mutation labels.

This is the canonical "make a new flame" entry point for users who do not
write `.flame` XML. It is **explicitly NOT** the post-v1 visual editor
(GitHub issue #37) — there are no affine-coefficient knobs, no per-xform
matrix inspectors, no manual variation tables. The whole interaction is
*"see N candidates → pick one → see N new candidates."* This is the
classic **Picbreeder-style interactive evolution** loop (Stanley &
Lehman, 2007), specialised for fractal flames.

Pairs with the introduction of `.pyr3.json` as the **native save format**
for pyr3-authored flames. The schema is already defined in
`src/serialize.ts` (`PYR3_JSON_VERSION = 1`); this spec wires it through
the user-facing save/load path for the first time. **Importantly, evolve
emits genomes by direct construction (no `.flame` XML at any point), so
issue #17 (flam3 importer-default divergences) is structurally bypassed.**

## Scope

**In:**

- **New route** `/v1/evolve` — rendered by the same SPA shell as the viewer,
  with its own page lifecycle (analogous to how the gallery mounts at
  `/v1/gallery`).
- **Layout** — 3×3 grid (center cell is the current flame, 8 surrounding
  cells are labeled mutations), right-rail `guide` panel that biases the
  mutation sampler, bottom-right lineage breadcrumb (Ctrl-Z semantics —
  click to rewind, no branching tree), top bar with `🎲 new seed`,
  `📂 open .pyr3.json`, `💾 save .pyr3.json`.
- **Eight mutation kinds (v1)** — each is a separately-testable function;
  the sampler picks one kind per cell independently (repeats allowed
  across the 8 cells — the visual variety comes from per-cell RNG
  perturbations, even within the same kind):
  1. `variationWeightNudge` — per-xform per-variation, ±20–40%
  2. `addVariation` — sample a new variation from the bias-weighted bag,
     introduce at low starting weight
  3. `swapVariation` — replace one variation in an xform with another
  4. `viewportZoom` — perturb `scale` by ±10–30%
  5. `viewportRotate` — perturb `rotate` by ±10–20°
  6. `paletteSwap` — replace palette with another from `flam3-palettes`
  7. `addXform` — emit only when xform count < guide max
  8. `removeXform` — emit only when xform count > guide min
  (kinds 7/8 are mutually exclusive on any given run — at min the
  sampler skips 8, at max it skips 7)
- **Guide panel — 4 sections:**
  - `variation bias` — sliders for the top 10 variations by current xform
    usage, with "expand to 99" affordance; biases the sampler for kinds
    (2) and (3).
  - `palette family` — radio: `any` / `warm` / `cool` / `specific palette`
    (drop-down listing all `flam3-palettes` entries). Filters kind (6).
  - `camera lock` — checkboxes: `lock zoom`, `lock rotate`. When checked,
    kinds (4) / (5) don't emit.
  - `complexity` — `xform count: min..max` two-handle range slider
    (defaults `3..7`) + `lock symmetry` checkbox.
  - `🎲 reroll surroundings` button — keep current center, resample the
    8 candidates.
- **Procedural starting seed** — `?seed` query param absent → roll 3 random
  xforms, each with 1–2 variations sampled from the full 99-variation set
  (with a soft bias toward common/visually-friendly ones — `linear`,
  `julia`, `spherical`, `swirl`, `spiral`, etc., curated in
  `evolve-seed.ts`), random palette from `flam3-palettes`, viewport
  `scale 1.5 cx 0 cy 0`, no symmetry, no finalxform.
- **Optional `?seed=<gen>/<id>` query** — start from a corpus flame fetched
  the same way the gallery does it (via `chunkFetchGenome`). Lineage
  breadcrumb's leftmost thumb is that flame.
- **Render strategy** — 9 quick-mode renders/generation (1024² long-edge,
  q≤16, oversample=1; same as the viewer's quick mode). Same dim for
  center + surrounding cells. Wall-clock target: 1.5–3s per generation
  on a real GPU; gracefully slower on software.
- **Lineage breadcrumb** — caches the (center genome, 8 surrounding
  candidates) for each step. Clicking an earlier breadcrumb thumb
  restores both. Forward path after the click is dropped (Ctrl-Z, not
  a tree). Cache survives only the current page life — no localStorage.
- **Save bundle (4 pieces; all ship together):**
  - (i) `💾 save .pyr3.json` triggers a browser blob-download with default
    filename `evolved-YYYY-MM-DD-HHmm.pyr3.json`. Content is
    `genomeToJson(currentCenter)` serialized.
  - (ii) Viewer's `📂 Open` file picker accepts `.pyr3.json` alongside
    `.flame`. New branch: if extension is `.pyr3.json`, call
    `genomeFromJson(JSON.parse(text))` instead of `parseFlame(text)`.
  - (iii) Evolve's `📂 open .pyr3.json` button — same picker, but loads
    into evolve as the new center (replacing the random seed). Useful
    for resuming a previously-downloaded flame.
  - (iv) BE CLI `npm run render <file> <out.png>` accepts `.pyr3.json` by
    extension. Same `genomeFromJson` plumbing in `bin/pyr3-render.ts`.
- **Viewer-bar nav pill** — new `evolve` pill in `src/ui-bar.ts`, between
  the existing `gallery` link and the flame-name slot. Pulls forward the
  minimal pill-add slice from #51 (Viewer bar revamp/declutter) without
  doing the full revamp.

**Out (explicit deferrals):**

- **Branching lineage tree** — would let the user explore multiple paths
  in parallel; needs a tree-view UI. v2.
- **Persistent local history** — no localStorage anywhere. Page-load is a
  clean slate. If user closes the tab without downloading, lineage is
  gone.
- **Cloud / gist sharing** — no third-party server. File-on-disk is the
  only persistence.
- **Multi-flame "my flames" gallery in-app** — files in `~/Downloads` are
  the gallery. The existing `/v1/gallery` is for the 52k-corpus, not
  user saves.
- **Six additional mutation kinds** — coef nudge, remove variation,
  palette hue shift, viewport pan, symmetry add/remove, background-color
  swap. All defer to a v2 mutation expansion. Coef nudge is visually
  boring solo; the others are either minor levers or scope creep.
- **The visual flame editor (#37)** — explicitly different mechanic;
  evolve is the curator-style path, #37 is the author-style path.
- **The Markov-chain generator (#36)** — different mechanic, also XL/
  post-v1.

## Architecture

### Page lifecycle

The evolve page mounts inside the same SPA shell as the viewer + gallery
(see `src/main.ts` route-dispatch around `currentSurface` switching).
Adding a third surface — `'viewer' | 'gallery' | 'evolve'` — extends the
existing pattern; the viewer bar's DOM is cleared and replaced by the
evolve bar, and the canvas is hidden while the evolve grid takes the
viewport.

### Module layout

New files:

```text
src/evolve-mount.ts        // page lifecycle: mount, unmount, route entry, top bar
src/evolve-state.ts        // current center + lineage + cache + guide state machine
src/evolve-mutate.ts       // the 7 mutation samplers; pure functions (genome, guide, rng) → (genome, label)
src/evolve-seed.ts         // procedural random seed generator
src/evolve-ui.ts           // DOM construction: 3×3 grid cells, guide panel, breadcrumb
src/evolve-render.ts       // 9-cell parallel render orchestration (reuses createRenderer)
```

Plus targeted edits to existing files:

```text
src/main.ts                // route dispatch + currentSurface = 'evolve'
src/ui-bar.ts              // new `evolve` pill in BarOpts.nav (the part of the bar shared with viewer)
src/genome.ts              // (unchanged) genomeFromJson / genomeToJson already exist via serialize.ts
src/serialize.ts           // (unchanged) version 1 schema already covers everything we need
bin/pyr3-render.ts         // switch on file extension; route to genomeFromJson for .pyr3.json
```

### State machine sketch

```text
EvolveState {
  center:   Genome
  centerLabel: string          // "seed" or mutation label that led here
  surrounding: Array<{ genome: Genome; label: string }>  // 8 candidates
  lineage:  Array<{ genome: Genome; label: string; surrounding: cache }>
  guide: {
    variationBias: Map<VariationIndex, number>  // 0..1, default 0.5 each
    paletteFamily: 'any' | 'warm' | 'cool' | { paletteName: string }
    cameraLock: { zoom: boolean; rotate: boolean }
    complexity: { xformsMin: number; xformsMax: number; lockSymmetry: boolean }
  }
}

// Actions:
//   pickSurrounding(index)  → center := surrounding[index]; lineage.push(prev); resample surrounding
//   rewindToLineage(index)  → center := lineage[index].genome; surrounding := lineage[index].surrounding; truncate lineage
//   rerollSurroundings()    → resample surrounding (center untouched)
//   newSeed()               → reset everything; center := evolveSeed.random()
//   openFile(pyr3JsonText)  → reset; center := genomeFromJson(JSON.parse(text))
//   saveFile()              → download blob (genomeToJson(center))
```

### Mutation sampler interface

```text
interface MutationResult { genome: Genome; label: string }

function sampleMutation(
  source: Genome,
  guide: EvolveState['guide'],
  rng: RNG,
): MutationResult
```

The sampler picks a mutation kind weighted by what the guide allows
(camera-locked → kinds 4/5 skipped; xform-count at max → `add xform`
skipped; etc.), then dispatches to the kind-specific function.

`evolve-mutate.ts` exports `sampleMutation(...)` plus each kind-specific
function as a separately-testable export (`mutateAddVariation`,
`mutateSwapVariation`, …) so unit tests can exercise each in isolation.

### Render orchestration

9 quick-mode renders per generation. Reuses `createRenderer(device, format,
opts)` (`src/main.ts:Renderer`); each cell is a separate render target
sized 1024² (long-edge cap). Sequencing strategy:

- Render the center cell first (user already sees it, but a fresh render
  with current device is the source of truth).
- Render the 8 surrounding cells either sequentially or in a small
  pipeline (depends on device cost of context-switch between renders).
  Start with sequential; profile and parallelise later if the
  generation-to-display time is annoying.

Each cell is its own `<canvas>` inside a CSS grid. The 9-cell render
orchestrator owns a cancellation token; clicking a surrounding cell while
some cells are mid-render cancels in-flight work and starts the next
generation.

## Components

### `evolve-mount.ts`

Public surface:

```text
export interface EvolveMountOpts {
  device: GPUDevice
  format: GPUTextureFormat
  onSurfaceChange?: (surface: 'viewer' | 'gallery' | 'evolve') => void
}
export interface EvolveMountHandle {
  cancel: () => void          // stop any in-flight renders, free GPU resources
  setSeed: (gen?: number, id?: number) => void  // for ?seed= URL handling
}
export function mountEvolve(root: HTMLElement, opts: EvolveMountOpts): EvolveMountHandle
```

### `evolve-mutate.ts`

Public surface:

```text
export type MutationKind =
  | 'variationWeightNudge'
  | 'addVariation'
  | 'swapVariation'
  | 'viewportZoom'
  | 'viewportRotate'
  | 'paletteSwap'
  | 'addXform'
  | 'removeXform'

export interface MutationResult { genome: Genome; label: string; kind: MutationKind }

export function sampleMutation(source: Genome, guide: GuideState, rng: RNG): MutationResult

// Plus one named export per kind for direct unit-testing:
export function mutateVariationWeightNudge(source: Genome, guide: GuideState, rng: RNG): MutationResult
// ... etc, 8 total (counting addXform / removeXform separately)
```

`RNG` is the existing `src/rng.ts` mulberry32 / seeded interface; tests
seed the RNG deterministically.

### `evolve-state.ts`

Owns the lineage cache, the guide state, and the action surface listed in
the state-machine sketch. Pure TS, no DOM, no GPU. Subscribers
(`evolve-ui.ts`) re-render when state changes.

### `evolve-ui.ts`

Pure DOM construction. Takes a `EvolveState` reference and a callback bag
for actions. Mirrors the gallery-mount / gallery-filter-ui split.

### `evolve-render.ts`

9-cell render orchestrator. Takes the 9 genomes + an array of canvases and
fires renders in sequence with a cancellation token.

### `evolve-seed.ts`

Procedural random-seed generator. Produces a valid Genome with 3 xforms,
1–2 variations each, random palette, viewport `scale 1.5 cx 0 cy 0`.

## Data flow

```text
                                                          ┌──────────────────┐
   ?seed=… absent                                          │                  │
      │                                                    │  evolveSeed      │
      ▼                                                    │  (procedural)    │
   mountEvolve()──────► EvolveState.center := seed ◄──────►│                  │
      │                          │                         └──────────────────┘
      │                          ▼
      │                  evolve-ui renders 3×3 grid + guide + breadcrumb
      │                          │
      │                  evolve-render dispatches 9 quick renders
      │                          │
      │                  user clicks surrounding cell N
      │                          ▼
      │              EvolveState.pickSurrounding(N)
      │                    │
      │                    ├──► lineage.push({prev center, prev surrounding})
      │                    ├──► center := surrounding[N]
      │                    └──► resample 8 new surrounding via sampleMutation()
      │                          │
      │                          ▼ (repeat)
      │
      ▼ user clicks 💾 save
   JSON.stringify(genomeToJson(center)) → blob download
```

## Error handling

- **Render failure on a single cell** — keep the other 8 visible, surface
  a small "render failed" overlay on the bad cell, log to console. Do
  not bring down the page.
- **Invalid `.pyr3.json` upload (parse failure)** — toast-style error
  (existing pattern from gallery), keep current state. Don't unload.
- **Mutation produces degenerate genome** (e.g., all-zero affine after a
  weight nudge) — sampler retries up to 5 times; if still degenerate,
  falls back to a no-op mutation (label "no change") so the user always
  gets 8 candidates.
- **`?seed=GEN/ID` not found in corpus** — toast error, fall back to
  procedural random seed. Preserve the URL for sharing.

## Test plan

- **`src/evolve-mutate.test.ts`** — each of the 8 kind-specific mutation
  functions:
  - given a fixed seed RNG, output is deterministic
  - output Genome is structurally valid (xform count in range, weights
    finite, variations in [0, 99] index range, viewport scale > 0)
  - the label matches the kind (e.g., `addVariation` produces a label
    starting with `+ `)
  - `sampleMutation` respects guide constraints (camera-locked → never
    emits zoom/rotate; xform-count at max → never emits `addXform`)
- **`src/evolve-seed.test.ts`** — procedural seed:
  - deterministic given a seed
  - produced genome renders without throwing (smoke test against the
    existing renderer)
- **`src/evolve-state.test.ts`** — state machine:
  - `pickSurrounding` advances lineage correctly
  - `rewindToLineage` restores prior center + prior surrounding cache
  - `rerollSurroundings` preserves center
  - `newSeed` clears lineage
- **`src/evolve-mount.test.ts`** — DOM smoke:
  - mount → assert 9 `<canvas>` elements, guide panel, breadcrumb present
  - no leaked GPU resources on `cancel()`
- **`src/serialize.test.ts` (extension)** — round-trip test:
  - `genomeFromJson(JSON.parse(JSON.stringify(genomeToJson(g)))) ≡ g` for
    an evolve-produced genome
- **Manual Chrome verify** — load `/v1/evolve`, click through 5 generations,
  download a save, verify the file opens back into the viewer correctly.

## Scope estimate

**Effort: L** — new page, mutation samplers, guidance state, breadcrumb
cache, 9-cell parallel render orchestration, plus the small (ii)/(iii)/(iv)
wiring on the load-side. Not XL because it reuses everything: Genome
shape, renderer, palette bank, JSON schema, page-lifecycle pattern from
the gallery. Breakdown:

```text
piece                                                   estimate
------------------------------------------------------ ---------
evolve-seed.ts + tests                                       XS
evolve-mutate.ts (8 functions) + tests                        M
evolve-state.ts + tests                                        S
evolve-render.ts                                              XS
evolve-ui.ts (grid + guide + breadcrumb DOM)                   M
evolve-mount.ts + route in main.ts                             S
viewer-bar `evolve` pill                                      XS
viewer Open accepts .pyr3.json (ii)                           XS
evolve Open accepts .pyr3.json (iii)                          XS
BE CLI accepts .pyr3.json (iv)                                XS
genomeFromJson round-trip test                                XS
Chrome verify + bug-fix headroom                               S
```

## Followups (out of v1, parked here so they're not forgotten)

- **Adjustable randomness intensity** — a global "mutation magnitude"
  control ranging from "pretty close" (small nudges, ±5% weights, ±5°
  rotates, ±10% zooms) to "wild" (big swings, swap whole xforms, drop &
  re-add). Either a slider in the top bar or a discrete preset picker
  (gentle / normal / bold / wild). Affects all mutation kinds' magnitude
  ranges uniformly. User asked 2026-06-02 evening.
- **Save-name customization** — on `💾 save .pyr3.json`, prompt for a
  filename. Prefix is sticky (remembered across saves in the same session
  via localStorage `pyr3.evolve.savePrefix`), suffix auto-increments
  (e.g. `dragonweb-001.pyr3.json`, `dragonweb-002.pyr3.json`) OR uses a
  short hash of the genome JSON. User asked 2026-06-02 evening.
- **Branching lineage tree** instead of Ctrl-Z. Keeps abandoned paths
  visible; richer UX but needs a tree view.
- **Mutation kinds v2** — coef nudge, palette hue shift, viewport pan,
  symmetry add/remove, background swap.
- **Compare-two mode** — pin two candidates side-by-side at higher resolution
  to inspect details before committing.
- **Variation-set presets** in the guide — "spiral pack" / "soft pack" /
  "geometric pack" as one-click bias presets.
- **Importer-default parity sweep (#17)** — orthogonal to evolve, but
  worth landing alongside if the user starts saving + sharing `.flame`
  files cross-app.
