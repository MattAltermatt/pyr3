# pyr3 — project notes for Claude

## Quick commands

```bash
npm install                     # one-time
npm run dev                     # Vite dev server on :5173 (Chrome verify target)
npm test                        # unit suite, ~1s wall, 4582 passed
npm run test:parity             # 25-fixture BE-vs-flam3-C parity rig, ~91s wall
npm run test:all                # union of the above
npm run typecheck               # tsc --noEmit
npm run render <in.flam3> <out.png>                # BE CLI render at genome-native dims
npm run render -- --preset quick <in> <out>        # 1024-long-edge cap, q≤16, oversample=1 (FE quick-mode match)
npm run render -- --preset 4k <in> <out>           # 3840-long-edge force, q≤200, oversample=1 (reference SHOWCASE_4K)
```

Before commit: `npm run typecheck && npm test` (parity rig optional —
skip unless the render path was touched).

## Scope guardrail

**pyr3 is a TypeScript + WebGPU fractal-flame renderer with two consumers: a browser viewer
(Vite + WebGPU + gh-pages) and a headless CLI (Node + `webgpu` npm). Same engine, both ends.**
"Similar but not the same" as flam3-C — never bit-faithful parity. GPU only; no CPU path.

If the request would add a CPU fallback, fork the engine into separate FE/BE copies, or
introduce a WASM bridge — push back. Those are not in scope.

If the request would build the visual editor / mutator / vault before the v1.0 ship gate
passes — push back. Those are explicit `[PYR3-001]` / `[PYR3-002]` BACKLOG entries with a
hard "much-later" status.

## Repo conventions

- Default branch: `main`.
- Local git identity (required — global identity is unset):
  - `user.name  = MattAltermatt`
  - `user.email = 1435066+MattAltermatt@users.noreply.github.com`
- License: GPL-3.0-or-later (inherited from the flam3 lineage).
- 6-doc structure mandatory: `VISION` · `ROADMAP` · `BACKLOG` · `CHANGELOG` · `CLAUDE` ·
  `README`. All kept in sync with code at every ship.
- BACKLOG IDs: `[PYR3-NNN]`, never reused, monotonically increasing (next ID lives at the top
  of BACKLOG.md).
- Spec location: `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.

## Lineage

pyr3 reads the upstream **flam3** C reference renderer (Scott Draves & Erik Reckase,
GPL-3.0-or-later — <https://github.com/scottdraves/flam3>) for algorithmic clarity; the
TypeScript + WGSL in this repo is an independent reimplementation. flam3-C is the parity
ground truth (see the ship-gate + R-tolerance sections below).

## Locked decisions (load-bearing)

The authoritative design record is kept in the local design spec under
`docs/superpowers/specs/` (internal scaffolding, gitignored — not in the public repo).

Short form:
1. TS + WebGPU + Vite
2. Node + `webgpu` npm (`dawn-gpu/node-webgpu`) — **NOT** `@kmamal/gpu`, **NOT** Deno, **NOT**
   Bun. Decided via parallel-dispatched dueling agents 2026-05-27.
3. Vitest + tsx
4. GPU only; no CPU path
5. v1.0 ship gate (two gates, both must pass on the curated fixture set):
   - **BE parity vs flam3-C** (BE CLI renders match flam3-C
     `flam3-render-32bit-isaac qs=1` output at genome-native dims within
     R tolerance) — the 25-fixture parity rig (`npm run test:parity`); an
     optional 4K-resolution gate is deferred (`[PYR3-043]`)
   - **FE↔BE parity at quick-mode dims** (browser viewer renders match
     BE CLI for the same fixture at 1024 long-edge within R tolerance) —
     `[PYR3-026]`
   - **Ground truth = flam3-C, NOT the predecessor.** The 2026-05-28 pivot
     replaced the predecessor-port goldens with deterministic `flam3-render-32bit-isaac`
     output (`isaac_seed=<fixture-id>`). The predecessor was sufficiently faithful
     in most cases (R<5 vs flam3) but carries a small port-specific offset
     that distorted pyr3's measured parity. flam3-C is the canonical lineage
     reference. Goldens in `fixtures/flam3-goldens/<id>/golden.png` are now
     flam3-C renders; baselineR / thresholdR in each `meta.json` reflect
     pyr3 vs flam3-C.
6. Frontend = the slim browser-viewer layout for v1.0; editor is much-later post-v1
7. Repo replacement on GitHub is gated on ship-gate proof (do not push to
   `github.com/MattAltermatt/pyr3` until v1.0 passes)

## The "single engine, two consumers" seam

The non-negotiable architectural invariant: engine modules (`src/*.ts` + `src/shaders/*.wgsl`)
contain ZERO environment branching. No `if (typeof window === 'undefined')`. No `isNode`
checks. The CLI host stamps WebGPU globals onto `globalThis` and the same `createRenderer()`
runs unmodified.

Reference implementation of the seam (in pyr3 itself, since Phase 0
v0.1):
- Browser side: `src/main.ts` calls `createRenderer(device, format, opts)` after acquiring
  the GPU adapter from `navigator.gpu`.
- CLI side: `bin/pyr3-render.ts` stamps `webgpu`'s `globals` onto `globalThis`, sets up a
  `happy-dom` `DOMParser` shim (for `.flame` XML parsing), then calls the same
  `createRenderer()`.
- BE 4K (v0.20+): `bin/pyr3-render.ts --preset 4k` uses `src/presets.ts`
  to bundle dim/quality/oversample (reference SHOWCASE_4K-matched). The
  pre-v0.20 `scripts/pyr3-023-be-render-4k.mjs` wrapper was graduated
  into the `--preset` flag family in v0.20.

Any code that breaks this seam should be loudly questioned before landing.

## Verification expectations

Per the global workflow:
- ✅ Type-check + tests pass before commit
- ✅ Chrome verify (via `chrome-devtools-mcp`) for any change touching the render path or
  canvas wiring. **Built-in Claude preview is forbidden.**
- ✅ Hand the user a clickable `http://localhost:5173/` URL when a verify is needed
  (pyr3 has no audio — global `?mute=1` default doesn't apply)
- ✅ Backend renders verified by `npm run render` + R-comparison to flam3-C golden
- ✅ **Eyeball-verify gates default to HTML pages.** Any moment the user
  needs to visually compare images (FF-merge gate, parity gallery, before/
  after, diff PNG vs golden vs render) → build a self-contained HTML page
  at `.remember/verify/<phase-or-fixture>-<purpose>.html` with absolute-
  path `<img src="file:///<abs-repo-path>/...">`. Surface
  as `open <abs-path>` on its own line in chat. Canonical layout: 3-column
  `golden / pyr3-render / diff` per fixture, dark theme, mono labels,
  inline pills for R + per-channel + per-region. **Don't hand a list of
  `open <path>` commands and expect the user to alt-tab between
  individual files** — they've flagged this preference explicitly.
  `.remember/verify/` is already gitignored.

## Determinism & R tolerance contract

GPU determinism cross-vendor is not guaranteed. The contract:
- **Within a single hardware + Dawn version:** repeated renders byte-identical
- **Across FE/BE on the same machine:** approximately equal (not byte-identical) — both
  independently pass R-vs-flam3 tolerance, so they're "similar but not the same" to each
  other too
- **Across machines / GPU vendors:** divergence allowed, both must still pass R tolerance

R tolerance thresholds calibrated per-fixture during Phase 2 (v0.7) and
tightened through Phase 3 cycles. Live thresholds in each
`fixtures/flam3-goldens/<id>/meta.json`. R-metric implementation at
`src/compare.ts`.

**Tier contract (v0.19):** Per-fixture `meta.json` carries `expectedR`
(measured R vs flam3-C, replacing the prior `baselineR` label),
`thresholdR = expectedR + 1.0`, and `tier: 1 | 2`. **Tier-1** fixtures
have `expectedR < 5.0` and represent the healthy parity band where pyr3
matches flam3-C within visual tolerance. **Tier-2** fixtures have
`expectedR ≥ 5.0` and carry a `notes` field naming the band as
`engine-precision-drift, not regression — GPU f32 vs CPU f64 in
variation kernels`. Both gates are equally load-bearing for the v1.0
ship contract: a tier-2 regression that exceeds `thresholdR` means the
f32 floor moved (real ship-blocker); tier-1 regressions read as engine
bugs. The tier contract is the deliberate v0.19 closure of `[PYR3-029]`
— see CHANGELOG v0.19 + the BACKLOG entry for the f32-floor rationale.

## Useful pointers

- Design spec: [`docs/superpowers/specs/2026-05-27-pyr3-design.md`](docs/superpowers/specs/2026-05-27-pyr3-design.md)
- Phase plan: [`ROADMAP.md`](ROADMAP.md) → "Next phases"
- Open tasks: [`BACKLOG.md`](BACKLOG.md)
- Ship history: [`CHANGELOG.md`](CHANGELOG.md)
- The "single engine, two consumers" seam: `src/main.ts` (browser) + `bin/pyr3-render.ts` (CLI)
- WGSL shaders: `src/shaders/{chaos,density,spatial-filter,visualize_u32,visualize_f32}.wgsl`
