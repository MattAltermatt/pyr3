# 📋 pyr3 Changelog

Authoritative ship history. Backward-looking only — forward plans live in
[ROADMAP.md](ROADMAP.md), open tasks in [BACKLOG.md](BACKLOG.md).

Version format: `vMAJOR.MINOR[-suffix]`. Pre-v1.0 versions are unstable scaffolding;
**v1.0** marks the ship gate: both pyr3 frontend (browser WebGPU) and pyr3 backend (Node CLI
WebGPU) producing renders that match flam3-C within R tolerance for the curated fixture set.

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
