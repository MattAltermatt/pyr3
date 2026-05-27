# 📋 pyr3 Changelog

Authoritative ship history. Backward-looking only — forward plans live in
[ROADMAP.md](ROADMAP.md), open tasks in [BACKLOG.md](BACKLOG.md).

Version format: `vMAJOR.MINOR[-suffix]`. Pre-v1.0 versions are unstable scaffolding;
**v1.0** marks the ship gate: both pyr3 frontend (browser WebGPU) and pyr3 backend (Node CLI
WebGPU) producing renders that match flam3-C within R tolerance for the curated fixture set.

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
