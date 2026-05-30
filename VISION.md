# 🔥 pyr3 — vision

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

## 🎯 The v1.0 ship gate

**Two gates, both green, on a curated fixture set of Electric Sheep flames:**

1. **BE parity vs flam3-C.** The headless CLI renders match
   `flam3-render-32bit-isaac qs=1` output within R tolerance, both
   at the 19-fixture parity-corpus dims (native genome size) AND
   at the 4K showcase set (3840 long-edge). flam3-C is the canonical
   lineage source of truth; the **2026-05-28 pivot replaced the
   prior reference renderer**. The predecessor port was close (R<5 vs flam3
   in most cases) but carried a port-specific offset that confounded
   pyr3's measured drift. Goldens regenerated deterministically via
   `isaac_seed=<fixture-id>`.
2. **FE↔BE parity at quick-mode dims.** The browser viewer renders
   match the BE CLI for the same fixture at FE's supported dims
   (1024 long-edge, 16 SPP) within R tolerance. FE is interactive only
   — 4K is BE-exclusive per the v0.14 pivot.

FE and BE don't need to match byte-for-byte; the "similar but not the
same" contract holds across engines too. Both gates green = trigger
pulled for the public GitHub ship.

## 🔥 Keep (the soul)

- **Chaos-game IFS iteration** — one walking point, fuse-then-store, picking xforms by
  weighted random.
- **Histogram → log-density tone map** — this IS what makes flames glow; not negotiable.
- **Color via iterated `p[2]` coord** → palette lookup, with both STEP and LINEAR palette
  interpolation modes.
- **Affine + nonlinear variation chain** per xform, with optional per-xform post-affine +
  finalxform lens.
- **The flam3 variation library** — 99 variations ported.
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
- **Share links via URL.** `/v1/gen/{gen}/id/{id}` carries the corpus coordinates of an
  Electric Sheep flame; the viewer fetches that one chunk and renders it. Paste anywhere;
  always the same flame. (The legacy inline `?flame=<encoded>` codec was removed in v0.32,
  superseded by the corpus URL — see BACKLOG `[PYR3-020]`.)

## 🗃️ Explicitly defer

- **Visual flame editor.** Comes later as its own arc. See BACKLOG `[PYR3-001]`.
- **Markov-chain flame generation research.** Much-later research arc. See BACKLOG
  `[PYR3-002]`.
- **CPU fallback path.** Not happening. WebGPU is the only path.
- **flam3 bit-faithful parity.** "Similar but not the same" is the standing contract.

## Lineage

- **flam3** — Scott Draves & Erik Reckase's C reference renderer (GPL-3.0-or-later), the
  origin of the fractal-flame algorithm and pyr3's parity ground truth. pyr3 reads it for
  algorithmic clarity but is an independent TypeScript + WGSL reimplementation.
- **JWildfire** — Andreas Maschke's Java implementation, a sibling in the same lineage.
