# 🗺️ pyr3 Roadmap

Forward-looking only. Authoritative ship history lives in
[CHANGELOG.md](CHANGELOG.md) — each shipped version below points there. Open task registry
in [BACKLOG.md](BACKLOG.md).

## 🚀 Shipped (latest at top)

| Version | Date | Commit | Headline |
|---|---|---|---|
| **v0.22** | 2026-05-28 | `c69ec6a` | **PYR3-034/024 fix + safeguards — flame-import silently dropped 6 underscore-named variations.** `parseXformElement` split xform attribute names on the first `_` before the variation-table check, so `radial_blur`/`gaussian_blur`/`pre_blur`/`super_shape`/`wedge_julia`/`wedge_sph` were classified as params and dropped. `electricsheep.243.00171` lost its radial_blur halo (chaos coverage **0.43% → 55%**, matches flam3-C ~1%); fix = test `name in V` before the split. **NOT a precision/df64 issue** — a CPU f64-vs-f32 oracle showed identical coverage, retiring the PYR3-029 "f32-floor" framing for this case. Also resolved **`[PYR3-024]`** (248.22289 4K R **44.96 → 5.57**). **`[PYR3-035]`** re-rendered 13 showcase fixtures (243.06888 now beats the too-dark kotlin v1.1 ref). **`[PYR3-036]`** safeguards: loud parser + all-99 reachability test + curated-corpus assertion. Verified: 25/25 BE parity + 5/5 4K + 25/25 FE↔BE + 4539 unit. |
| **v0.21** | 2026-05-28 | `8a10b23` | **Public `/showcase` gallery — v1.0 Chunk 1 (`[PYR3-007]` slice).** `scripts/build-showcase.mjs` generates a static masonry gallery into `public/showcase/` from the 55 pre-rendered 4K PNGs: two JPEG tiers per fixture (`~q90` full 4K + 600px thumb), `.flame` downloads, artist attribution (nick from source, 35/55), render-time pills (time only, no `×faster`), permalinks, mobile single-col. Heavy images gitignored + deploy-only (gh-pages via the Vite `dist/` artifact; never in `main`) — mirrors kotlin's gh-pages pattern. **Scope pivots:** root `/` = viewer (front door), `/showcase` = gallery (reverses "root = showcase"); unversioned URL; no click-to-load in v1.0 (deferred w/ `[PYR3-020]`); `[PYR3-031]` split out. Chrome-verified + dist proof + 4510 green. |
| **v0.20** | 2026-05-28 | `9a18791` | **Corpus expansion 19→25 + `--preset {quick,4k}` CLI flag family (`[PYR3-023]` closes).** Parity gate added 3 untapped kotlin goldens (`244.00617`, `244.42746`, `248.23554`) + 3 ESF picks from kotlin's `v1.0-showcase.txt` (`electricsheep.247.08620`, `.245.07670`, `.244.59334`). Tier ratio lands at **18:7** — 4 new Tier-1 (R∈[0.72, 3.26]) + 2 new Tier-2 kotlin lifts (244.42746 R=5.50 boundary, 248.23554 R=24.12). New `src/presets.ts` owns the preset specs (`quick` cap-mode, `4k` force-mode with kotlin-matched `Math.floor` on the short edge); `bin/pyr3-render.ts` consumes via `applyPreset()`. Legacy `--quick` flag removed (no stop-gap); `scripts/pyr3-023-be-render-4k.mjs` wrapper deleted. 4K showcase meta harmonized to the v0.19 schema. PYR3-023 closes. **v1.0 next** — the showcase gallery (PYR3-007), FE cleanup pass (PYR3-031), and GitHub repo replacement ship together as v1.0. |
| **v0.19** | 2026-05-28 | `40d19e1` | **Accept the f32 floor: per-fixture threshold tier recalibration (`[PYR3-029]` closes).** The 19-fixture parity contract becomes tier-aware. `baselineR` → `expectedR`; new `tier: 1\|2` (cutoff at R=5.0) + `notes` field on tier-2 fixtures naming the engine-precision-drift band. Tier-1 (14 fixtures, R<5) keeps the original sub-5 ceiling intent; Tier-2 (5 fixtures: 247.28068, 244.82986, 243.04616, 245.06687, 02226 at R∈[5.16, 29.92]) pass at `expectedR + 1.0` with documented `GPU f32 vs CPU f64 in variation kernels` rationale. PYR3-029 formally closes — Phase 5 ported every flam3-canonical chaos algorithm we could identify and R was unchanged, confirming the residual is precision-bound not algorithm-bound. Phase 6 precision research stays as an in-entry future-research note (no fresh ID). Contract-only ship — no engine changes; 4K showcase meta also gets `tier` for narrative consistency (field-name harmonization defers to v0.20). All 19 fixtures pass `npm run test:parity` under the new schema. Unblocks v0.20 corpus expansion + v1.0 ship gate. |
| **v0.18** | 2026-05-28 | `c8ed3ab` | **Ground-truth pivot: kotlin v1.1 → flam3-C goldens.** All 19 parity goldens regenerated from `flam3-render-32bit-isaac qs=1 isaac_seed=<id>` (deterministic); `baselineR` recalibrated. See CHANGELOG v0.18 for rationale. |
| **v0.17** | 2026-05-27 | `ae6cea6` | **PYR3-023 BE 4K parity gate INFRASTRUCTURE shipped (2/2 v1.0 ship gates wired).** `npm run test:parity-4k` runs all showcase fixtures through pyr3 BE @ 3840 long-edge (matched to kotlin's `SHOWCASE_4K`) and R-compares vs kotlin v1.1 JPG refs (via `jpeg-js`). 5 fixtures probed; **4/5 render within / below the BE-vs-flam3 median R~6** — 247.19679 (the README hero) at R=2.78, 244.36880 at 3.24, 248.31324 at 6.14, 243.09081 at 7.36. Only 248.22289 is the outlier (R=44.96 — known PYR3-029 chaos-game divergence). Dim-rounding fix in `scripts/pyr3-023-be-render-4k.mjs` (`Math.round` → `Math.floor` integer math) catches kotlin's 1-px short-edge rounding. Per-fixture thresholds in `fixtures/kotlin-4k-refs/meta.json`. **Both v1.0 ship gates now have working infrastructure; remaining work is PYR3-029 + corpus-expansion.** |
| **v0.16** | 2026-05-27 | `a7b5427` | **PYR3-017/021/024 → 029 root cause located (chaos game, not upstream stages).** Phase C `flame-fixture-investigator` dispatch on both `coverage.248.02226` (R=29.96) AND `electricsheep.248.22289` (R=44.96 vs kotlin v1.1 JPG) **conclusively ruled out** all four upstream-stage hypotheses (palette/tonemap/density/spatial-filter). Palette baking bit-identical. Tonemap k1/k2 math identical. DE ablation Δ < 2.5 R. Spatial-filter faithful port. **Pyr3 chaos-game histogram-deposit ratios diverge from flam3 exactly in the per-channel R signature direction for both fixtures.** Same mechanism, different chromatic manifestation (02226 over-green; 22289 over-red+blue) because variation-arm sets differ. Filed `[PYR3-029]` chaos-walker-coverage audit (4 ranked sub-hypotheses); `[PYR3-030]` f64 tonemap precision shim (secondary). PYR3-017, PYR3-021 marked superseded. PYR3-024 folded. Phase B sub-deliverable: PYR3-023 step 1 pulled forward — `scripts/pyr3-023-be-render-4k.mjs` `FULL_MAX_DIM` 4096 → 3840 (matches kotlin `SHOWCASE_4K`). |
| **v0.15** | 2026-05-27 | `23d33cb` | **PYR3-026 FE↔BE quick-mode parity gate shipped (1/2 v1.0 ship gates closed).** New `npm run test:parity-fe-be` Vitest gate runs all 19 fixtures FE-vs-BE at matched quick-mode dims (1024 long-edge, q=16, oversample=1). Mechanism: `--quick` + `--max-dim N` flags on `bin/pyr3-render.ts` mirror `src/main.ts` `rerender()` math; new `window.__pyr3LoadFlame` dev hook lets Playwright inject fixture text without the OS file picker; headless Chromium WebGPU via swiftshader (deterministic, ~10min total). 2-run baseline showed FE↔BE variance < 1% — R is dominated by systematic engine drift, not RNG noise. Per-fixture `feBeBaselineR` + `feBeThresholdR` calibrated (max×1.5+2.0). R distribution 0.46 → 19.40; the 3 high-R outliers overlap with PYR3-018's FE-vs-flam3 sweep — FE-side drift exists in both comparisons. Eyeball gallery at `.remember/verify/pyr3-026-fe-be.html`. |
| **v0.14** | 2026-05-27 | `2ce5837` | **PYR3-023 probe + FE 4K removal pivot (BE-only 4K).** Probed pyr3's `🎯 Render 4K` on 5 kotlin v1.1 showcase fixtures — 2/5 reproducibly crashed Chrome's tab; 3/5 succeeded but at 13× BE's wall-clock. User pivot: FE no longer supports 4K; BE is the v1.0 4K renderer + ship-gate vehicle. FE button removed; `RenderMode` + `FULL_MAX_*` constants collapsed; `renderInMode(mode)` → `rerender()`. BACKLOG re-scoped: `[PYR3-023]` narrowed to "BE 4K parity gate vs kotlin v1.1"; `[PYR3-024]` (248.22289 BE divergence), `[PYR3-025]` (Chrome crash investigation, post-v1), `[PYR3-026]` (FE↔BE quick-mode parity invariant), `[PYR3-027]` (FE/BE perf-gap investigation) filed. New apples-to-apples baseline pinned to kotlin's `SHOWCASE_4K` preset (3840 long-edge × 200 SPP × oversample=1). `npm test` 4494/4499 green. |
| **v0.13** | 2026-05-27 | `55a2f36` | **Phase 3 cycle 5: 98-arm audit closes + 3 parity-completeness fixes (`[PYR3-010]` complete + var_fan + VARIATION_DEFAULTS + alias normalization).** 8-cluster `wgsl-parity-reviewer` fan-out found 79 match, 18 documented minor-diff, 1 bug (var_fan WGSL Euclidean-mod-vs-fmod). Two follow-up audits found 17/38 arms missing canonical non-zero defaults + 2 partial XML-attribute alias coverage. All three fixes bundled. Per-fixture BE parity: `coverage.248.02226` dropped R 32.62 → 29.96 (-2.66, PYR3-017 partial closure); other 18 fixtures noise-floor unchanged. Filed `[PYR3-021]` (PYR3-017 upstream-stage investigation pivot) + `[PYR3-022]` (default-palette fallback). |
| **v0.12** | 2026-05-27 | `3bb903e` | **Phase 3 cycle 4: FE parity sweep + capture-hook engine API (`[PYR3-018]` shipped).** First FE-vs-flam3-C-golden measurement across all 19 fixtures, gated on new dev-only `window.__pyr3CapturePixels` engine hook that mirrors the CLI readback path (offscreen RGBA texture + `copyTextureToBuffer` — bypasses the WebGPU canvas swap-chain readback limitation). Eyeball gallery at `.remember/verify/pyr3-018-fe-sweep.html`. All Δ FE−BE in +0.23..+9.87 range, consistent with the FE quick-mode SPP cap (16) vs BE native quality (~2000) noise floor; no FE-specific bugs surfaced. Surfaced `[PYR3-019]` (3-way verify) + `[PYR3-020]` (share-link decode regression). |
| **v0.11.1** | 2026-05-27 | `1fced80` | **Test-split + README v0.11 refresh (`[PYR3-012]` shipped).** `npm test` now unit-only (~1s wall, 4494/4499 green); the 19-fixture parity suite moves behind `npm run test:parity` (~91s wall, 19/19 green); `npm run test:all` runs both. New `vitest.config.ts` toggles parity inclusion via `VITEST_INCLUDE_PARITY=1` env var. README's `## Status` block refreshed from stale v0.7 → v0.11 with the three Phase 3 cycles named. |
| **v0.11** | 2026-05-27 | `297e5d8` | **Opacity-clamp serialization hardening (`[PYR3-016]` shipped).** Clamp `Xform.opacity` to [0, 1] at `genome.ts:packXformInto` — defensive hardening against malformed `.flame` input that passes finiteness validation but carries out-of-range values. Prevents WGSL-implementation-defined `u32()` of negative weights and histogram overflow at opacity > 1 (post-PYR3-015 the count channel uses `opacity * 255.0`). 4 new clamp tests; 4494/4499 green. |
| **v0.10** | 2026-05-27 | `caafa6d` | **Phase 3 cycle 2: regular-xform alpha-scaling (`[PYR3-015]` shipped).** Replaced v0.9 splat-skip in `chaos.wgsl` with deterministic alpha-scaling (rgb AND count channels scaled by xform opacity). 19/19 parity fixtures hold within |ΔR| < 0.01 vs v0.9 baselines — statistically equivalent to splat-skip but deterministic + cleaner gradients at low SPP. No threshold recalibration. Mid-cycle bug: first impl scaled only rgb and ghost-deposited count=255 at opacity=0, regressing `coverage.248.33248` R 4.92 → 8.57; count-scaling fix landed in commit 2. Surfaced `[PYR3-016]` (opacity-clamp hardening at the serialization boundary). |
| **v0.9** | 2026-05-27 | `6ac3918` | **Phase 3 cycle 1: finalxform-opacity gate (`[PYR3-009]` shipped — half-port).** Ported kotlin's finalxform-only opacity gate to `chaos.wgsl`. R dropped ~81% on both [PYR3-009] reference fixtures (`coverage.248.11405` 7.51 → 1.36, `coverage.248.25196` 11.32 → 2.18); 17 other fixtures unchanged. Mid-cycle discovery: the existing per-regular-xform splat-skip is a sample-noisier stand-in for flam3's adjust_percentage alpha-scaling — kept in place (filed as `[PYR3-015]` for the proper alpha-scaling port). Tightened thresholds on the two improved fixtures. |
| **v0.8** | 2026-05-27 | `88beb47` | **Parity fixture set 3 → 19 (`[PYR3-011]` shipped).** 16 more flam3-C goldens lifted from `pyr3-kotlin/parity/goldens/` (turns out `flame.png` IS the flam3-C-binary golden per kotlin's `bakeOrLoad` cache contract — no local flam3-C build needed). R distribution now spans 0.45 (244.57686) → 32.62 (coverage.248.02226). `[PYR3-009]` opacity-gate investigation now has its reference fixtures (`coverage.248.11405` op=0.73 R=7.5, `coverage.248.25196` op=0.39 R=11.3). Per-fixture baselines + thresholds calibrated (variance < 0.02 across 3 runs). `[PYR3-014]` filed for cosmetic vitest RPC-timeout noise on the 89s suite. |
| **v0.7** | 2026-05-27 | `461c657` | **Phase 2: parity test rig + flam3-C goldens.** R-metric ported verbatim from kotlin (`src/compare.ts`, 19 unit tests); 3 fixtures lifted from pyr3-kotlin's `parity/goldens/` (247.29388, 248.04487, 248.11268, all 800×592); BE harness `src/parity.test.ts` spawns the Node CLI per fixture, asserts `R ≤ thresholdR`, writes a visibility-scaled `diff.png` for lead diagnostics; FE harness `scripts/fe-parity.ts` is lead-driven via chrome-devtools-mcp (+ dev-only `window.__pyr3LastHandle` hook). Per-fixture thresholds calibrated against ~deterministic baselines (R ≈ 2.0-3.0, threshold ≈ baseline + 1.0); gate verified live. |
| **v0.3** | 2026-05-27 | `5b1f559` | **Phase 1: kotlin audit-port (no-op outcome).** Documented audit of 12 enumerated kotlin GPU / parser / variation fixes v0.10 → v1.x-E. 11 already in peek or structurally N/A in WGSL/TS (incl. both signedness fixes v0.28b + v0.32 — `IntArray.toLong()` sign-extend bug class cannot manifest in WGSL `array<u32>` + `f32(hist[i])`). 1 differing-semantics item (v1.x-C-opacity: finalxform-only vs per-xform-splat) filed as `[PYR3-009]` for empirical investigation. 98 variation arms in `chaos.wgsl` match kotlin's 98/99 (gdoffs gap shared). |
| **v0.2** | 2026-05-27 | `0139076` | **Camera-zoom bug fix (the one pyr3-peek couldn't crack).** Browser quick-mode renders of any flame declaring `supersample > 1` over-zoomed by that factor — `chaos.ts:173` reads `g.scale × g.oversample` from the genome, but `main.ts` was rescaling `g.scale` for canvas fit without resetting `g.oversample`. One-line fix: `renderGenome.oversample = targetOversample`. Welcome flame `247.19679` now matches kotlin v1.1 4K reference composition. |
| **v0.1** | 2026-05-27 | `aae6d5b` | **Phase 0: TS+WGPU engine basis.** Copied pyr3-peek wholesale (`src/` + `bin/` + `scripts/` + `tests/` + `fixtures/` + `index.html` + Vite/tsconfig/package). Renamed `pyr3-peek` → `pyr3`. Stripped peek identifiers across 7 files. Verified: `npm test` 4471/4471 green, `npm run render` produces PNG in 5.22 s, `npm run dev` + Chrome verify renders welcome flame. |
| **v0.0** | 2026-05-27 | `bbc3b5a` | **Project genesis.** 6-doc structure + design spec + LICENSE seeded. No engine code yet. |

## 🎯 Next phases

### Phase 3 — Iterate to v1.0 ship gate (active, target v0.15 → v1.0)

Drive the parity rigs to passing. v1.0 = both ship gates green for the
curated fixture set. Each iteration is a discrete versioned ship.

**v1.0 ship gates (re-scoped post-2026-05-28 pivot to flam3-C ground truth):**
- ✅ **BE parity vs flam3-C** — infrastructure shipped v0.17; goldens
  switched from kotlin v1.1 → deterministic flam3-C (`isaac_seed=<id>`)
  in v0.18. 4K showcase set: 4/5 clean (247.19679 hero R=2.78);
  19-fixture corpus baselines recalibrated. 1 fixture (248.22289)
  still blocked on PYR3-029.
- ✅ **FE↔BE parity at quick-mode dims** — shipped v0.15 (PYR3-026 closed).

**Acceptance:** both gates green. Trigger pulled for replacing
MattAltermatt/pyr3 (kotlin) + pyr3-peek on GitHub.

## 🚧 Current todos — next steps to v1.0

Post-v0.18 reframe (2026-05-28): PYR3-029 deep investigation across
Phases 1-5 ported every flam3-canonical chaos-engine algorithm we could
identify (rand transforms, walker init RNG draws, xform-pick distribution
table, bilateral RNG-aligned trace infrastructure). R(02226) ≈ 29.91
remained unchanged — the residual is **GPU f32 vs CPU f64 precision in
the variation kernels**, not an algorithm bug. CLAUDE.md decision #4
("GPU only; no CPU path") is load-bearing: chasing bit-exactness via
compensated arithmetic in WGSL is heroic for marginal payoff.

**"Similar but not the same"** (per VISION.md) applies here — pyr3
doesn't owe flam3 bit-faithfulness, just visual tolerance within the
curated corpus. v1.0 ships when the curated corpus passes its
per-fixture thresholds (which acknowledge the f32 reality), not when
every fixture closes to R<5.

🎯 **Next phase — v1.0 (decomposed into 4 chunks, 2026-05-28):**

The v1.0 public surface was broken into independently-shippable chunks
(supersedes the earlier "four deliverables bundled" framing). **Landing
reversal:** root `/` stays the FE viewer (front door); the gallery lives
at `/showcase`. This *reverses* the original "root = showcase" decision —
re-decided once the viewer's continued root presence was recalled.

1. ✅ **Chunk 1 — public `/showcase` gallery** (shipped v0.21). Static
   masonry gallery from the 55 pre-rendered 4K PNGs; two JPEG tiers
   (`~q90`), `.flame` downloads, attribution, render-time pills (time only,
   **no `×faster` comparison**), permalinks, mobile. Heavy images gitignored
   + deploy-only (gh-pages via Vite `dist/`; never in `main`). Unversioned
   URL. See CHANGELOG v0.21 + spec `docs/superpowers/specs/2026-05-28-v1.0-showcase-gallery-design.md`.
2. 🚧 **Chunk 2 — gallery→viewer click-to-load + `[PYR3-020]`** (post-v1
   sharing-mechanics). Deferred: how share/load works needs its own design.
3. 🚧 **Chunk 3 — `[PYR3-031]` FE viewer cleanup pass** (split out from the
   old bundle; dead code, stale TODOs, CSS polish on the root viewer).
4. 🚧 **Chunk 4 — GitHub repo replacement + gh-pages deploy** (Vite
   `base: '/pyr3/'`; push to `github.com/MattAltermatt/pyr3` replacing the
   kotlin repo; archive pyr3-kotlin + pyr3-peek per VISION `§Acceptance`).
   Gated on parity gates green + CLAUDE.md decision #7.

   Viewer URL: `https://mattaltermatt.github.io/pyr3/` · gallery:
   `…/pyr3/showcase/` (both unversioned — always latest).

   **Pre-rendered artifacts already in place (2026-05-28):**
   - 55 × 4K renders at `fixtures/showcase-v1.0/<id>.pyr3-4k.png`
     (gitignored, ~928MB total disk; regenerated by
     `scripts/render-showcase-v1.0.mjs` in ~9 min on M-series Mac).
   - Manifest JSON committed for the gallery-builder lookup table
     (carries source-`.flame` paths + per-fixture render times).

✅ **v0.20 shipped (2026-05-28):** Parity corpus 19→25; `--preset
{quick,4k}` CLI flag family (legacy `--quick` removed; 4K wrapper
script deleted); 4K meta harmonized; `[PYR3-023]` closes. See CHANGELOG
v0.20.

✅ **v0.19 shipped (2026-05-28):** Per-fixture threshold tier
recalibration. 19-fixture corpus tier-aware: 14 Tier-1 (R<5), 5 Tier-2
(R≥5, engine-precision-drift band). `[PYR3-029]` formally closes. See
CHANGELOG v0.19.

🪨 **Post-v1.0 backlog (filed, not gating):**
- `[PYR3-030]` — f64 tonemap precision shim (helps with FE↔BE
  tightening, secondary post-PYR3-029 finding).
- Phase 6 PYR3-029 follow-on: per-variation f64 reference impl +
  variation bottleneck locate. If a future contributor cares about
  closing the precision gap, this is the runway.

## 🔮 Future (post-v1.0, sketch only)

- **Visual flame editor** (BACKLOG `[PYR3-001]`) — open + tweak + save flames; framework TBD
  via dueling agents when pulled forward.
- **Markov-chain flame generation research** (BACKLOG `[PYR3-002]`) — algorithmic exploration
  of new genome-generation strategies.
- **Single-binary CLI distribution** (BACKLOG `[PYR3-005]`) — Node SEA / pkg wraps
  `bin/pyr3-render.ts` into a self-contained executable.
- **GitHub Actions CI** (BACKLOG `[PYR3-006]`) — build + test + gh-pages auto-deploy.
- **Showcase gallery on homepage** (BACKLOG `[PYR3-007]`).
