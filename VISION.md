# pyr3 — vision

**pyr3** (pronounced "pyre") — a fractal-flame renderer in the flam3 lineage, written in
TypeScript with WebGPU compute shaders. GPL-3.0-or-later.

## What is a fractal flame?

A fractal flame is the visual output of an Iterated Function System (IFS) where each point is
bent through a chain of nonlinear transformations ("variations"), accumulated into a histogram,
and tone-mapped logarithmically. The result: glowing, luminous, often biological-looking
attractors that look more like astrophotography than mathematics.

Originated by Scott Draves, formalized in *The Fractal Flame Algorithm* (Draves & Reckase,
2003). Made world-famous by the [Electric Sheep](https://electricsheep.org) screensaver and
the [Apophysis](https://sourceforge.net/projects/apophysis/) editor.

## What is pyr3?

pyr3 is a **TypeScript + WebGPU reimplementation in the flam3 family** with one defining
promise: **one engine, two consumers.** The same `.ts` modules and the same `.wgsl` shaders
drive both a browser viewer (deployable to GitHub Pages) and a headless CLI binary (for batch
processing on your laptop). It joins flam3 (Scott Draves's C reference, CPU-f64) and JWildfire
(Andreas Maschke's Java implementation, CPU-f64) as siblings in this lineage.

**pyr3 is its own thing.** Lineage-respectful, draws heavily on flam3's algorithms, but
exercises independent judgment where flam3's design choices were shaped by the C / hardware /
compiler constraints of its era — constraints pyr3 doesn't share on the modern WebGPU stack.
**pyr3 renders should look "similar but not the same" as flam3 — and that's the contract.**
If a downstream consumer wants 100% bit-faithful flam3 parity, that's a future feature flag,
not the default.

## 🎯 The v1.0 ship gate (passed)

**Two gates, both green, on the curated 26-fixture set of Electric Sheep flames:**

1. **BE parity vs flam3-C.** The headless CLI renders match
   `flam3-render-32bit-isaac qs=1` output within R tolerance at native
   genome dims (the 26-fixture parity corpus). flam3-C is the canonical
   lineage source of truth; the **2026-05-28 pivot replaced the
   prior reference renderer**. The predecessor port was close (R<5 vs flam3
   in most cases) but carried a port-specific offset that confounded
   pyr3's measured drift. Goldens regenerated deterministically via
   `isaac_seed=<fixture-id>`. (An optional 4K-resolution gate is deferred —
   native-dim parity implies 4K; see issue #34.)
2. **FE↔BE parity at quick-mode dims.** The browser viewer renders
   match the BE CLI for the same fixture at FE's supported dims
   (1024 long-edge, 16 SPP) within R tolerance. The FE quality tiers
   now go all the way to 4K in-browser (added in v0.29); the parity
   gate stays at quick-mode dims because it measures engine agreement,
   not output size.

FE and BE don't need to match byte-for-byte; the "similar but not the
same" contract holds across engines too. Both gates went green for v1.0,
and the v1.0 → v1.10 line has shipped — the viewer is live at
[pyr3.app](https://pyr3.app/), tagged releases are published through
**v1.10.0** (2026-06-14), and the
[milestone ladder](https://github.com/MattAltermatt/pyr3/milestones)
tracks themed follow-on work. The **Apophysis and JWildfire** plugin
pack (#114 / #117 / #120 / #121 / #170, plus the gradient editor #115)
and the **More variations** arc (novel families: folds, attractors,
cartographic and conformal warps, plane curves, spirals, escape-time
fractals, chaotic billiards, physical-field warps, and number-theoretic
maps) grew the catalog to **323 entries (V0..V322)** — both milestones
are now closed. The **Binary distribution** arc (`npm run build:cli
render` → standalone `pyr3-render`) shipped 2026-06-06, **Color Curves**
(#116) shipped 2026-06-07, and the **Animation** milestone (keyframe
interpolation, per-xform motion, temporal-sampling motion blur, a
timeline sequencer + playback scrubber, the `/animate` editor + headless
`/api/animate`) closed as **v1.9.0**. Remaining themed slots cover
**Binary distribution** (Windows `.exe` #287, cross-platform verify
#126), **Viewer / editor UX & presets**, **Color grading & scopes**,
**evolving flame creation**, and the **Mobile rework** arc (#66). The
importer-default parity sweep (#17) shipped 2026-06-08.

## 🔥 Keep (the soul)

- **Chaos-game IFS iteration** — one walking point, fuse-then-store, picking xforms by
  weighted random.
- **Histogram → log-density tone map** — this IS what makes flames glow; not negotiable.
- **Color via iterated `p[2]` coord** → palette lookup, with both STEP and LINEAR palette
  interpolation modes.
- **Affine + nonlinear variation chain** per xform, with optional per-xform post-affine +
  finalxform lens.
- **The flam3 variation library** — all 99 numbered VAR_* constants ported (V0..V98), plus the DC family + Apophysis + JWildfire 2D long tail + pyr3's own novel families (323 entries total, V0..V322).
- **Genome-level features Electric Sheep relies on** — palette-by-index lookup, `<flame hue>`
  rotation, multi-value `color="V S"` attributes, the HSV-highpow desaturation branch of the
  tone-map, per-xform post-affine.

## 🛠️ Modernize

- **GPU-only.** No CPU path. CPU is ~50× slower on the same
  hardware, and "match flam3 C-speed on CPU" is an unwinnable arc. pyr3 ships GPU-first,
  GPU-only, day one.
- **One engine, two consumers.** Pure TS modules + WGSL shaders, called from a browser (Vite
  + gh-pages) and a CLI (Node + `webgpu` npm + `tsx`). No language boundary, no WASM, no
  parallel implementations to keep in sync.
- **Share links via URL.** `/esf/gen/{gen}/id/{id}` carries the corpus coordinates of an
  Electric Sheep flame; the viewer fetches that one chunk and renders it. Paste anywhere;
  always the same flame. (The legacy inline `?flame=<encoded>` codec was removed in v0.32,
  superseded by the corpus URL.)
- **`/editor` — the visual flame editor (shipped).** Xforms with decomposed
  affine (scale / rotation / position + optional shear), the **fitting-room** variation
  picker over the full 99-variation flam3 library plus pyr3's **direct-color (DC) family**
  (`dc_linear` · `dc_perlin` · `dc_gridout` · `dc_cylinder`), live + settled render lanes,
  undo/redo, name templates, save to `.pyr3.json`. The "much-later post-v1" editor arc that
  shipped earlier than planned across many small issues.
- **`/screensaver` — build-up or slideshow over the corpus.** Watch one flame paint over
  a minute (literal pixel-landing → smooth settle) or crossfade through the corpus. Press
  **R** to record any session to `.webm` (#111).
- **`/animate` — keyframe animation (shipped v1.6.0).** Interpolate between flame
  keyframes with per-xform motion elements and temporal-sampling motion blur, scrub playback
  in the viewer, and export the sequence to frames. The headless companion is `npm run
  animate` / the `pyr3 serve` backend's `/api/animate` route — the `flam3-render` /
  `flam3-animate` split, modernized.

## 🗃️ Explicitly defer

- **Markov-chain flame generation research.** Much-later research arc. See issue
  [#36](https://github.com/MattAltermatt/pyr3/issues/36) (`post-v1`).
- **CPU fallback path.** Not happening. WebGPU is the only path.
- **flam3 bit-faithful parity.** "Similar but not the same" is the standing contract.
- **Mobile / touch layout.** Tracked in the **Mobile rework** milestone; desktop-first
  through v1.x.

## Lineage

- **flam3** — Scott Draves & Erik Reckase's C reference renderer (GPL-3.0-or-later), the
  origin of the fractal-flame algorithm and pyr3's parity ground truth. pyr3 reads it for
  algorithmic clarity but is an independent TypeScript + WGSL reimplementation.
- **JWildfire** — Andreas Maschke's Java implementation, a sibling in the same lineage.
