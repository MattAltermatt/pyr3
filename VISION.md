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
processing on your laptop). It joins flam3 (Scott Draves's C reference, CPU-f64), JWildfire
(Andreas Maschke's Java implementation, CPU-f64), and pyr3-kotlin (the JVM/Vulkan predecessor
in this lineage) as siblings.

**pyr3 is its own thing.** Lineage-respectful, draws heavily on flam3's algorithms, but
exercises independent judgment where flam3's design choices were shaped by the C / hardware /
compiler constraints of its era — constraints pyr3 doesn't share on the modern WebGPU stack.
**pyr3 renders should look "similar but not the same" as flam3 — and that's the contract.**
If a downstream consumer wants 100% bit-faithful flam3 parity, that's a future feature flag,
not the default.

## 🎯 The v1.0 ship gate

**Both pyr3 frontend (browser WebGPU) and pyr3 backend (Node CLI WebGPU) produce renders that
match flam3-C reference renders within R tolerance**, for a curated fixture set of Electric
Sheep flames. FE and BE don't need to match each other byte-for-byte — they each independently
pass R-vs-flam3. That's the trigger to replace MattAltermatt/pyr3 (the kotlin one) and
MattAltermatt/pyr3-peek on GitHub.

## 🔥 Keep (the soul)

- **Chaos-game IFS iteration** — one walking point, fuse-then-store, picking xforms by
  weighted random.
- **Histogram → log-density tone map** — this IS what makes flames glow; not negotiable.
- **Color via iterated `p[2]` coord** → palette lookup, with both STEP and LINEAR palette
  interpolation modes.
- **Affine + nonlinear variation chain** per xform, with optional per-xform post-affine +
  finalxform lens.
- **The flam3 variation library** — 99 variations ported (basis: pyr3-peek's TS port).
- **Genome-level features Electric Sheep relies on** — palette-by-index lookup, `<flame hue>`
  rotation, multi-value `color="V S"` attributes, the HSV-highpow desaturation branch of the
  tone-map, per-xform post-affine.

## 🛠️ Modernize

- **GPU-only.** No CPU path. pyr3-kotlin learned the hard way: CPU is ~50× slower on the same
  hardware, and "match flam3 C-speed on CPU" is an unwinnable arc. pyr3 ships GPU-first,
  GPU-only, day one.
- **One engine, two consumers.** Pure TS modules + WGSL shaders, called from a browser (Vite
  + gh-pages) and a CLI (Node + `webgpu` npm + `tsx`). No language boundary, no WASM, no
  parallel implementations to keep in sync.
- **Share links via URL.** `?flame=<inline-encoded>` carries the full flame content in the
  URL — no remote fetch, no 404 risk. Paste anywhere; always renders the same flame.

## 🗃️ Explicitly defer

- **Visual flame editor.** Comes later as its own arc. See BACKLOG `[PYR3-001]`.
- **Markov-chain flame generation research.** Much-later research arc. See BACKLOG
  `[PYR3-002]`.
- **CPU fallback path.** Not happening. WebGPU is the only path.
- **flam3 bit-faithful parity.** "Similar but not the same" is the standing contract.

## Lineage

- **pyr3-kotlin** — the JVM/Vulkan predecessor (v1.x-E shipped 2026-05-27). Source of truth
  for GPU shader fixes, variation arms, parser edge-cases. Phase 1 audit-ports its shipped
  improvements into the TS/WGSL world.
- **pyr3-peek** — the TS+WebGPU browser viewer. Phase 0 copies its source tree as the new
  pyr3's basis.
- **pyr3-rust** — private archive (Rust core + WASM + React experiment). Source of TS-era
  engine code that pre-dated the Rust pivot; `git log -- '*.ts'` is the entry point.
