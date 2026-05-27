# 📋 pyr3 Changelog

Authoritative ship history. Backward-looking only — forward plans live in
[ROADMAP.md](ROADMAP.md), open tasks in [BACKLOG.md](BACKLOG.md).

Version format: `vMAJOR.MINOR[-suffix]`. Pre-v1.0 versions are unstable scaffolding;
**v1.0** marks the ship gate: both pyr3 frontend (browser WebGPU) and pyr3 backend (Node CLI
WebGPU) producing renders that match flam3-C within R tolerance for the curated fixture set.

## v0.3 — 2026-05-27 — Phase 1: kotlin-fix audit-port pass (no code changes — pyr3-peek was already aligned)

**Outcome:** 11 of 12 enumerated kotlin GPU / parser / variation fixes from
v0.10 → v1.x-E are either already present in pyr3-peek's source or
structurally non-applicable. The "audit-port" phase reduces to a
documented audit + 1 follow-up investigation.

**Audit table:**

| kotlin ref | what | status in pyr3 |
|---|---|---|
| v0.28b | DE u32 signedness (`DensityEstimator.kt`) | **N/A** — WGSL `array<u32>` + `f32(hist[i])` is structurally unsigned; the kotlin/JVM `IntArray[i].toLong()` sign-extension bug class cannot manifest in WGSL |
| v0.32 | `TonemapPass` u32 signedness | **N/A** — same reason as v0.28b |
| v0.36-A | EDISC `acos` / `sqrt` precision-crater clamp | **ALREADY PORTED** (`chaos.wgsl:957-960`, attributed to "Batch F wgsl-shader-reviewer fix") |
| v0.36-H | sub-ulp ±5e-7 walker jitter (fractalapple class) | **ALREADY PORTED** (`chaos.wgsl:1714-1725`, explicit `Port: pyr3 chaos.comp:2580-2599` reference) |
| v1.x-E | DE + spatial filter on GPU readback path | **ARCHITECTURALLY EQUIVALENT** — peek's `visualize_u32.wgsl` + `visualize_f32.wgsl` both bake Gaussian spatial-collapse into the fragment shader (lines 139-160); no separate `TonemapPass` vs `PostProcessPipeline` split exists, the equivalent of v1.x-E's fix is the design |
| v0.27 | k2 supersample² fix in calibration | **ALREADY PORTED** (`calibration.ts:16-17, 41` — `oversampleSq` in k2 numerator per `rect.c:936-937`) |
| v0.21 | `pre_blur` variation (V=97) | **ALREADY PORTED** (`chaos.wgsl:1362-1363` "V=97 pre_blur handled pre-switch in 2-pass loop") |
| v0.19 | xaos transition matrix + background color | **ALREADY PORTED** (`genome.ts:43` xaos field + `chaos.wgsl:55,124` xaos_buffer pack) |
| v0.5 | per-xform post-affine | **ALREADY PORTED** (`genome.ts:44` "Phase 9c" + `chaos.wgsl:92-95` post0 vec4f slot) |
| v0.14a | parser: palette-by-index, hue, multi-value color, float-rgb | **ALREADY PORTED** (`palette.ts:20,28,34-40,75-77` hue rotation; `flame-import.ts:445` hue attr) |
| v0.14b | HSV highlight-power desaturation | **ALREADY PORTED** (`visualize_u32.wgsl:79-104` calc_newrgb with rgb2hsv branch) |
| v0.29.1 | PaletteEntry Int → Double widening | **N/A** — JS `number` is always f64; no Int/Double mismatch class exists in TS |
| v0.29.3 | NaN-propagation defense (Xform init guard) | **ALREADY PORTED** (`flame-import.ts` 5+ `Number.isFinite` guards at parse sites) |
| v1.x-C-opacity | finalxform opacity gate | ⚠️ **DIFFERENT SEMANTICS** — peek implements per-xform splat-skip opacity gating (`chaos.wgsl:1727-1738`, "Phase 9d probabilistic splat skip"); kotlin implements finalxform-only flam3-faithful gating with `rand01 < opacity`. Both have merit. Filed as `[PYR3-009]` for empirical investigation against fixtures with `finalxform opacity < 1` (kotlin's reference: `coverage.248.11405` op=0.73, `coverage.248.25196` op=0.39 — neither in our current fixture set). |

**Variation count:** 98 `var_*` functions in `chaos.wgsl`, matching kotlin's
"98/99 shipped, `gdoffs` is the JWildfire/Apophysis-only gap" claim from
pyr3-kotlin VISION.

**Skipped (JVM-specific, not portable):**
- v0.31, v0.33, v0.34, v0.34.1, v0.35 — `Math.fma`, Pair allocation,
  `StrictMath` vs `Math`, JVM inlining flags
- v0.36-B...G, v0.36-I, v0.37-A/B, v0.38 — AutoRoute, kotlin showcase
  harness, bench infra
- v1.x-D-pivot, v1.x-D, v1.x-A, v1.x-B-revival, v1.x-C-cpu-progress —
  docs / strategy / CPU-path work

**Follow-up BACKLOG opened:**
- `[PYR3-009]` Opacity-gate semantics investigation (finalxform-only vs
  per-xform-splat) — empirical comparison against kotlin's
  `coverage.248.11405` reference flame.
- `[PYR3-010]` Variation-arm bit-parity audit — sweep all 98 arms in
  `variations.ts` + `chaos.wgsl` against kotlin's port for any
  algorithmic divergence (kotlin has known bilateral-probe data for
  many).

**Why the audit lands as a doc-only ship rather than a stream of ports:**
Per CLAUDE.md "Audit backlog items before bundling — pulling N backlog
entries into a polish phase → verify each is actually unshipped against
current code first." Audit before code. The user named "different maths
involved, signed/unsigned" as a specific concern; both signedness fixes
turn out N/A in TS+WGSL by language semantics, which is itself
load-bearing context worth pinning. This is exactly the surface the
audit was designed to surface.

## v0.2 — 2026-05-27 — Camera-zoom bug fix (the one pyr3-peek couldn't crack)

**One-line fix in `src/main.ts` closes the long-standing "camera looks zoomed
in, stuck right at the middle point" symptom in the browser viewer.**

**Symptom:** browser quick-mode renders of Electric Sheep flames that declare
`supersample > 1` in their XML showed an extreme-close-up of the central
attractor instead of the full composition. CLI renders of the same flames
worked correctly. pyr3-peek's owner could not isolate the cause across
multiple sessions.

**Root cause:** `chaos.ts:173-174` computes the WGSL `scale` uniform as
`g.scale * g.oversample`, reading `oversample` from the **genome**, not from
the pipeline configuration. In quick mode `main.ts` builds the pipeline at
`oversample=1` and rescales `g.scale` to fit the canvas — but it left
`g.oversample` at the genome's declared `supersample` (typically 4 for ES
flames). Result: the WGSL uniform = `rescaled_scale × 4` — a 4× over-zoom in
projection, exactly the "stuck at middle" symptom.

**Fix:** `renderGenome.oversample = targetOversample` so the genome's
oversample stays aligned with the pipeline's configured oversample.

**Diagnostic process (symptom-before-hypothesis):**
1. Pulled kotlin v1.1 4K reference (`fixtures/kotlin-goldens/electricsheep.247.19679.v1.1.gpu.4k.jpg`)
2. CLI render at genome-native 1280×720 oversample=4 q=2000 — **matches kotlin
   reference visually** (12.32s wall, 1.2 MB PNG). Engine works.
3. CLI render at browser params (1024×576 oversample=1 q=16, via hand-edited
   .flame) — **still matches kotlin composition** at lower quality. So
   neither quality nor supersample/oversample alone causes the symptom.
4. Compared CLI's `renderer.render()` vs browser's
   `reset+iterate+present` chain — same internal API.
5. Grep for `g.oversample` usage — single occurrence in `chaos.ts:173`,
   reading from genome.

**Verification:** Chrome reload at `localhost:5173/?mute=1` shows
`electricsheep.247.19679` rendering with the correct diagonal sweep + dense
filament fill, matching kotlin v1.1 reference. `npm test` 4471/4471 green.
`npm run typecheck` clean. Screenshot at `.phase1-fe-fixed-orig-orch.png`.

**Follow-up:** `[PYR3-008]` — refactor chaos.ts to take oversample from
the pipeline (defensive against future host setup bugs of the same shape).

This is the load-bearing precondition for Phase 1's broader kotlin-fix
audit-port pass: with the camera now correct, all subsequent visual
comparisons FE-vs-flam3 will be meaningful.

## v0.1 — 2026-05-27 — Phase 0: TS+WGPU engine basis

- **Copied pyr3-peek wholesale** into this repo: `src/` (engine + 5 WGSL shaders + 15 Vitest
  suites), `bin/` (`pyr3-render.ts` CLI + `pyr3-bench.ts` + `flame-to-json.ts` + WGSL loader
  hook), `scripts/`, `tests/`, `fixtures/`, `help/`, `index.html`, `vite.config.ts`,
  `tsconfig.json`, `package.json` + `package-lock.json`.
- **Renamed** package `pyr3-peek` → `pyr3`, version `0.0.0` → `0.1.0`, description updated to
  reflect dual-consumer scope (browser + headless CLI from one engine).
- **Stripped peek-specific identifiers** across 7 files (`src/main.ts` log prefixes,
  `src/ui-bar.ts` wordmark, `index.html` `<title>`, `src/genome.ts` + `src/load-intent.ts`
  comments, two test-fixture strings). All `console.*` output now reads `pyr3: ...`.
- **Verified end-to-end:** `npm install` (67 packages) · `npm test` (4471 passed, 5 skipped,
  0 failed across 15 test files in 620 ms) · `npm run typecheck` (clean) · `npm run render
  fixtures/electricsheep.247.12151.flam3` (PNG written in 5.22s on M-series, oversample=4,
  800×592) · `npm run dev` + Chrome verify at `http://localhost:5173/?mute=1` (welcome
  flame `electricsheep.247.19679` renders correctly, no console errors).
- **Lineage attribution:** every source file carrying peek's TS+WGSL inherits its history
  per NOTICE.md; fresh git history, peek is not a remote.
- Known minor: Node prints `DeprecationWarning: module.register() is deprecated` from the
  WGSL loader hook during CLI render — non-fatal, queued for cleanup.

## v0.0 — 2026-05-27 — Project genesis

- Initial 6-doc structure seeded: `VISION` · `ROADMAP` · `BACKLOG` · `CHANGELOG` · `CLAUDE`
  · `README` + `NOTICE` + `LICENSE` (GPL-3.0-or-later).
- Locked decisions captured in
  [`docs/superpowers/specs/2026-05-27-pyr3-design.md`](docs/superpowers/specs/2026-05-27-pyr3-design.md):
  TS + WebGPU + Vite + Node + `webgpu` npm (dawn-gpu/node-webgpu), GPU-only, one-engine /
  two-consumers, "similar but not the same" R-tolerance contract vs flam3-C.
- Runtime pick `Node + webgpu npm` backed by parallel-dispatched research agents (vs Deno,
  Bun, `@kmamal/gpu`) per CLAUDE.md "dueling agents for load-bearing decisions" rule.
- Lineage documented: TS+WGSL basis to be Phase-0-copied from
  [pyr3-peek](https://github.com/MattAltermatt/pyr3-peek); GPU/parser/variation fixes
  audit-ported from [pyr3-kotlin](https://github.com/MattAltermatt/pyr3) during Phase 1.
- BACKLOG seeded with `[PYR3-001]` through `[PYR3-007]` (editor, Markov research, perf,
  variation audit, single-binary CLI, CI, showcase gallery).
- Local git identity: `MattAltermatt`. GPL-3.0-or-later. `main` as default branch.
- No engine code yet — `Phase 0` (copy pyr3-peek) begins next session.
