# 📋 pyr3 Changelog

Authoritative ship history. Backward-looking only — forward plans live in
[ROADMAP.md](ROADMAP.md), open tasks in [BACKLOG.md](BACKLOG.md).

Version format: `vMAJOR.MINOR[-suffix]`. Pre-v1.0 versions are unstable scaffolding;
**v1.0** marks the ship gate: both pyr3 frontend (browser WebGPU) and pyr3 backend (Node CLI
WebGPU) producing renders that match flam3-C within R tolerance for the curated fixture set.

## v0.11 — 2026-05-27 — Opacity-clamp serialization hardening ([PYR3-016] shipped)

**Outcome:** Clamp `Xform.opacity` to flam3-spec'd [0, 1] at the GPU
serialization boundary (`genome.ts:packXformInto`). Defensive hardening
against malformed `.flame` input that passes `flame-import.ts` finiteness
validation but carries out-of-range values. Valid flames are unaffected
(all 19 parity fixtures use opacity ∈ {0, 0.39, 0.61904, 0.73, 1.0}).

**The change** (`src/genome.ts:281`):
```ts
buf[o + 10] = Math.max(0, Math.min(1, x.opacity ?? 1.0));
```
Zero perf cost. Prevents WGSL-implementation-defined `u32()` of negative
weights at `opacity < 0`, and histogram-bucket-overflow at `opacity > 1`
(post-PYR3-015, `weight = opacity * 255.0` so the count channel would
accumulate > 255 per hit if unclamped).

**Tests:** 4 new tests in `serialize.test.ts` cover the clamp at the
public `packXforms` boundary (in-range, negative-clamped, >1-clamped,
undefined→1 default). 4494/4499 tests pass.

Surfaced by code-review subagent on the PYR3-015 branch.

## v0.10 — 2026-05-27 — Phase 3 cycle 2: regular-xform alpha-scaling ([PYR3-015] shipped)

**Outcome:** Replaced the v0.9-era probabilistic splat-skip in `chaos.wgsl`
with deterministic per-xform alpha-scaling — flam3's actual
`adjust_percentage` semantic. **19/19 parity fixtures pass with all deltas
|ΔR| < 0.01 vs v0.9 baselines** — statistically equivalent to splat-skip
across the buffer, but deterministic (no RNG draw, no skip-vs-deposit
branching) and cleaner gradients at low SPP. No baseline recalibration
needed. Closes the regular-xform half of the v1.x-C-opacity port that
PYR3-009 started.

**The change** (`src/shaders/chaos.wgsl`):

Inside the `if (i >= u.fuse)` splat block, removed the `if (opacity < 1.0)`
→ `if (rand01() >= opacity) continue;` stochastic skip and replaced it with
a deterministic `weight = opacity * 255.0` that scales BOTH the rgb and
count (alpha) channels of the histogram deposit. opacity=0 → zero deposit
(rgb=0, count=0, no contribution); opacity=1 → full deposit (matches the
old fast-path); intermediate values deposit proportionally. Trajectory
update is unaffected — only the histogram contribution is gated, matching
v0.9 splat-skip's chaos-game-state contract.

**Mid-cycle bug-and-fix (worth surfacing):**

First impl (`cd3e6f5`) scaled only the rgb channels per the BACKLOG
recipe — and regressed `coverage.248.33248` R 4.92 → 8.57. Root cause:
that fixture has an `opacity="0"` xform; depositing count=255 with rgb=0
creates a "ghost density" region the tonemap reads as legitimate dark
pixels. Fix (`f99868e`): scale the count channel by opacity too, making
the full deposit weight linear in opacity. With count-scaling, all 19
fixtures returned to within |ΔR| < 0.01 of v0.9 baselines. The BACKLOG
recipe was incomplete on this point; updated PYR3-015's archived rationale
in this entry instead.

**Per-fixture R (representative sample — full 19/19 in
`.remember/tmp/v0.10-parity-post-fix.log`):**

| Fixture | v0.9 baseline | v0.10 R | Δ | Note |
|---|---|---|---|---|
| `coverage.248.33248` | 4.9229 | 4.9250 | +0.002 | `opacity="0"` xform — caught the count-scaling bug |
| `coverage.248.24236` | 2.7065 | 2.6988 | −0.008 | BACKLOG-flagged regression-risk #2; held |
| `coverage.248.11405` | 1.3610 | 1.3582 | −0.003 | PYR3-009 win held |
| `coverage.248.25196` | 2.1809 | 2.1844 | +0.004 | PYR3-009 win held |
| `coverage.248.02226` | 32.6200 | 32.6267 | +0.007 | biggest R outlier; mystery unchanged |
| other 14 | (baseline) | (~same, <0.01) | flat | within run noise |

**Documentation sync:** Updated `src/genome.ts:34-41` `Xform.opacity` field
comment to describe the alpha-scaling contract (was still describing v0.9
splat-skip). Surfaced by code-review subagent.

**Follow-up backlog:**

- **`[PYR3-016]`** (new): opacity-clamp hardening in `genome.ts:277`
  serialization layer. `flame-import.ts:350` validates finiteness but not
  range. A malformed `.flame` with `opacity` outside [0, 1] would reach the
  shader and cause WGSL-implementation-defined `u32()` of negative values
  or histogram-bucket overflow on `opacity > 1`. Defensive hardening; no
  effect on valid flames. Surfaced by code-review subagent.

**Perf note:** Replaces a stochastic branch + RNG draw per iter with a
deterministic multiply on the hot path. Net should be neutral-to-faster;
no formal perf gate at this stage.

## v0.9 — 2026-05-27 — Phase 3 cycle 1: finalxform-opacity gate ([PYR3-009] shipped — half-port)

**Outcome:** Ported kotlin's finalxform-only opacity gate to `chaos.wgsl`'s
finalxform block. **R dropped ~81% on both [PYR3-009] reference fixtures**
without regressing any of the other 17. First Phase-3 "iterate-toward-v1.0"
cycle: hypothesis → implementation → measurement → ship.

**Per-fixture R deltas (post-PYR3-009 vs v0.8 baseline):**

| Fixture | Pre R | Post R | Delta | Note |
|---|---|---|---|---|
| **coverage.248.11405** | 7.5131 | **1.3610** | **−6.15 (−81.9%)** | finalxform op=0.73 — `[PYR3-009]` ref |
| **coverage.248.25196** | 11.3177 | **2.1809** | **−9.14 (−80.7%)** | finalxform op=0.39 — `[PYR3-009]` ref |
| all other 17 | (baseline) | (~same, < 0.02) | flat | within run noise |

Both [PYR3-009] reference fixtures' thresholds tightened: 248.11405 8.51 →
2.50, 248.25196 12.32 → 3.50. Other 17 fixtures' thresholds unchanged.

**The change** (`src/shaders/chaos.wgsl`):

Inside the finalxform block (`if (u.final_xform_idx >= 0)`), gate the lens
application by `fxf.color_params.z` (= opacity). RNG draw is short-circuited
when `opacity == 1.0` per `flam3.c:336-337` — preserves RNG-determinism for
the common opaque-finalxform case. When the gate fails, `splat_p` stays at
`p_pre_final` (the pre-lens default), so the deposit lands at the pre-
finalxform position — mirrors flam3's behavior of leaving `q[]` unchanged
when the opacity gate fails (`flam3.c:335-341`). WGSL `||` isn't spec-
guaranteed short-circuit; nested-if keeps `rand01` unconsumed when
`opacity == 1.0`. Port: `pyr3-kotlin core/src/main/kotlin/pyr3/core/CpuF64Backend.kt:566-585`.

**Mid-cycle discovery (worth noting):**

A first pass also removed the existing per-regular-xform splat-skip block
(treating it as redundant with the new finalxform gate). That regressed two
fixtures (coverage.248.24236, coverage.248.33248) with regular xforms at
opacity < 1 — they rely on the splat-skip as a coarse stand-in for flam3's
actual regular-xform behavior (alpha-scaling via `adjust_percentage`,
`variations.c:2044`, kotlin's PYR3-035 equivalent). Restored the splat-skip;
ship is the finalxform-half port only. Splat-skip is sample-noisier but
statistically equivalent to alpha-scaling (opacity=0 → no splat = no color;
opacity=0.5 → ½ samples = ½ accumulated color); the destination port lives
in a separate, larger fix.

**Follow-up backlog:**

- **`[PYR3-015]`** (new): regular-xform opacity → alpha-scaling per
  `flam3`'s `adjust_percentage` path (kotlin's PYR3-035 equivalent). Current
  splat-skip stand-in is correct on average but noisier at low SPP than
  proper alpha-scaling would be. Larger fix — touches tonemap path, not just
  the chaos-game shader.

**Closes:** `[PYR3-009]` (the finalxform half — the spec was specifically
finalxform-only gating; the per-regular-xform path is a separate entry now).

## v0.8 — 2026-05-27 — Parity fixture set expanded 3 → 19 ([PYR3-011] shipped)

**Outcome:** 16 more flam3-C goldens lifted from `pyr3-kotlin/parity/goldens/`
without needing to build flam3-C locally — kotlin already had `flame.png` (the
flam3-C-binary golden, per its `bakeOrLoad` cache contract) for 16 fixtures we
hadn't pulled yet. Parity rig now covers 19 fixtures spanning a much wider R
distribution (0.45 → 32.62), which gives Phase 3 fixes proper triangulation.

**Fixtures added (16):**

| ID | Dims | baselineR | thresholdR | Notes |
|---|---|---|---|---|
| 244.00016 | 800×592 | 3.98 | 5.00 | low-quality fixture (q=5), fast render |
| 244.57686 | 800×592 | **0.45** | 1.45 | best parity in the set |
| 244.82270 | 800×592 | 3.32 | 4.32 | |
| 244.82986 | 800×592 | 9.90 | 10.90 | |
| coverage.243.04616 | 800×592 | 11.55 | 12.55 | |
| coverage.245.00381 | 800×592 | 4.42 | 5.42 | |
| coverage.245.06687 | 1280×720 | 14.58 | 15.58 | quadrant skew (br=43.90) |
| coverage.247.20817 | 800×592 | 3.11 | 4.11 | |
| coverage.247.28068 | 800×592 | 5.17 | 6.17 | |
| coverage.247.31007 | 800×592 | 1.52 | 2.52 | |
| coverage.248.02226 | 1280×720 | **32.62** | 33.62 | highest divergence — Phase 3 priority |
| coverage.248.11405 | 800×592 | 7.51 | 8.51 | **finalxform op=0.73 — `[PYR3-009]` ref** |
| coverage.248.19873 | 800×592 | 1.58 | 2.58 | |
| coverage.248.24236 | 1280×720 | 2.71 | 3.71 | |
| coverage.248.25196 | 800×592 | 11.32 | 12.32 | **finalxform op=0.39 — `[PYR3-009]` ref** |
| coverage.248.33248 | 800×592 | 4.92 | 5.92 | |

All baselines = mean over 3 deterministic-within-machine runs on M-series +
Dawn-node 2026-05-27; variance < 0.02 per fixture. Thresholds = baseline +
~1.0 (start permissive; tighten in Phase 3).

**Mixed dimensions:** 16 fixtures at 800×592 + 3 at 1280×720. `parity.test.ts`
reads dims from the PNG; no harness changes needed.

**Phase 3 unblocking:**

- `[PYR3-009]` (opacity-gate semantics: finalxform-only vs per-xform-splat)
  now has its reference fixtures (`coverage.248.11405` op=0.73,
  `coverage.248.25196` op=0.39) and both show meaningful R divergence (7.5
  and 11.3 respectively) — the rig will measure whether the kotlin
  finalxform-only port reduces R.
- `coverage.248.02226` at R=32.6 is the biggest signal in the set — worth
  eyeballing its `diff.png` early in Phase 3 to identify the divergence
  shape (likely a tonemap, gamma, or finalxform issue given the cross-
  quadrant variance: bl=71.4 vs br=31.6).

**Closes:** `[PYR3-011]` (was: "expand to 5-7 flames; requires building
flam3-C locally" — turned out neither prereq was needed; lifting from kotlin
covered it).

**Files (16 new fixture dirs):**

`fixtures/flam3-goldens/{244.00016, 244.57686, 244.82270, 244.82986,
coverage.243.04616, coverage.245.00381, coverage.245.06687, coverage.247.20817,
coverage.247.28068, coverage.247.31007, coverage.248.02226, coverage.248.11405,
coverage.248.19873, coverage.248.24236, coverage.248.25196, coverage.248.33248}/`
— each with `golden.png` + `<id>.flam3` + `meta.json`.

**New backlog (surfaced this phase):**

- `[PYR3-014]` Vitest worker RPC timeout on 89s parity suite (cosmetic — all
  tests pass, just emits an "Unhandled Error" log line at the end).

## v0.7 — 2026-05-27 — Phase 2: parity test rig + flam3-C goldens

**Outcome:** Phase 2 acceptance met. The harness produces R scores for
3 fixtures via the BE (Node CLI) path, gated by per-fixture thresholds in
Vitest; the FE (chrome-devtools-mcp + browser) path is lead-driven via
`scripts/fe-parity.ts`. Phase 3 (iterate to v1.0 ship gate) now has the
objective parity signal it needs.

**Shipped pieces:**

- 🧮 **R-metric ported verbatim from kotlin** — `src/compare.ts` exports
  `meanAbsDiffRgba` (scalar gate), `perChannelDrift`, `perRegionDrift`,
  `meanAbsDiffAccumulator`. 19 unit tests. Same validation messages, same
  empty-array semantics, same RGB-alpha-ignored semantics, same load-bearing
  `/ 3.0` in `perRegionDrift`.
  *Port: pyr3-kotlin `parity/src/main/kotlin/pyr3/parity/Compare.kt`.*

- 🖼️ **3 flam3-C goldens lifted from pyr3-kotlin** — `247.29388`, `248.04487`,
  `248.11268` (all 800×592 RGBA). Each fixture: `golden.png` + source `.flam3`
  + `meta.json` carrying `baselineR` + `thresholdR`. Lives under
  `fixtures/flam3-goldens/<id>/`. Building flam3-C locally to add more
  fixtures is deferred to `[PYR3-011]`.

- 🪲 **Two-layer parity output: scalar gate + visual diagnostic** — every
  parity run computes R + per-channel + per-region drift AND writes a
  visibility-scaled `diff.png` to `fixtures/flam3-goldens/<id>/diff.png` so
  the lead can `open` the divergence map in 2 seconds when a fixture fails.
  R alone is spatially blind; the diff PNG closes that gap. New helper at
  `src/diff-image.ts`.

- ⚙️ **BE harness in CI** — `src/parity.test.ts` discovers fixtures, spawns
  `bin/pyr3-render.ts` per fixture via `child_process`, decodes both PNGs,
  computes all four metrics, writes the diff PNG, asserts
  `R ≤ thresholdR` when calibrated. `npm run test:parity` added to scripts.

- 🌐 **FE harness lead-driven (not Vitest)** — `scripts/fe-parity.ts`
  prints a `?flame=v1:<base64>` share URL + step-by-step
  `chrome-devtools-mcp` instructions; reads captured canvas RGBA on stdin
  in `compare` mode and prints FE-R + drift breakdown. Pairs with a
  dev-only `window.__pyr3LastHandle` hook in `src/main.ts` so the MCP
  session can `await` the render before capturing.

- 📐 **Per-fixture R baselines + thresholds calibrated** (mean over 3
  deterministic-within-machine runs on M-series + Dawn-node):

  | Fixture | baselineR | thresholdR | per-channel skew (r/g/b) |
  |---|---|---|---|
  | `247.29388` | 3.0030 | 4.00 | 5.79 / 3.68 / 2.53 |
  | `248.04487` | 2.3248 | 3.32 | 2.87 / 3.12 / 3.31 |
  | `248.11268` | 1.9951 | 3.00 | 2.74 / 2.88 / 2.35 |

  Gate verified live by flipping `248.11268.thresholdR` to `1.50` (below
  baseline) and confirming the expected FAIL; reverted to 3.00.

**Out of scope (deferred):**

- Building flam3-C locally to add more fixtures → `[PYR3-011]`.
- Tightening R thresholds aggressively → Phase 3 iteration.
- `TwoSeedGate` / two-seed noise-floor logic → post-v1.0 if needed.
- FE parity in CI (needs a headless-browser-with-WebGPU CI runner) → out
  of scope for v1.0.

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
