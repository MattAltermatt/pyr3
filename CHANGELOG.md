# 📋 pyr3 Changelog

Authoritative ship history. Backward-looking only — forward plans live in
[ROADMAP.md](ROADMAP.md), open tasks in [BACKLOG.md](BACKLOG.md).

Version format: `vMAJOR.MINOR[-suffix]`. Pre-v1.0 versions are unstable scaffolding;
**v1.0** marks the ship gate: both pyr3 frontend (browser WebGPU) and pyr3 backend (Node CLI
WebGPU) producing renders that match flam3-C within R tolerance for the curated fixture set.

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
