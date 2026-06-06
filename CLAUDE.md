# pyr3 — project notes for Claude

## Quick commands

```bash
npm install                     # one-time
npm run dev                     # Vite dev server on :5173 (Chrome verify target)
npm test                        # unit suite, ~2s wall (includes seam-invariant tests)
npm run test:parity             # 26-fixture BE-vs-flam3-C parity rig, ~91s wall
npm run test:fe-be-smoke        # 3-fixture FE↔BE smoke (~90s) — run when the FE viewer changes
npm run test:parity-fe-be       # FULL 26-fixture FE↔BE sweep, ~13min — PRE-RELEASE ONLY
npm run test:all                # union of test + parity (excludes the slow FE↔BE full sweep)
npm run typecheck               # tsc --noEmit (full project)
npm run typecheck:engine        # no-DOM kernel typecheck — enforces the FE/BE seam (#15)
npm run render <in.flam3> <out.png>                # BE CLI render at genome-native dims
npm run render -- --preset quick <in> <out>        # 1024-long-edge cap, q≤16, oversample=1 (FE quick-mode match)
npm run render -- --preset 4k <in> <out>           # 3840-long-edge force, q≤200, oversample=1 (reference SHOWCASE_4K)
```

Before commit: `npm run typecheck && npm test`. The BE↔flam3-C parity rig
(`npm run test:parity`, 91s) is optional but recommended when the render
path changes. The 3-fixture FE↔BE smoke (`npm run test:fe-be-smoke`, 90s)
is the right gate when the viewer-side WebGPU path changes specifically.
The full 13-minute FE↔BE sweep (`npm run test:parity-fe-be`) is **pre-
release only** — too slow for routine work, and the seam-invariant unit
tests in `npm test` catch the class of regressions it used to guard.

## Scope guardrail

**pyr3 is a TypeScript + WebGPU fractal-flame renderer with two consumers: a browser viewer
(Vite + WebGPU + gh-pages) and a headless CLI (Node + `webgpu` npm). Same engine, both ends.**
"Similar but not the same" as flam3-C — never bit-faithful parity. GPU only; no CPU path.

If the request would add a CPU fallback, fork the engine into separate FE/BE copies, or
introduce a WASM bridge — push back. Those are not in scope.

Markov-chain flame generation (#36) stays a deferred research arc. The visual editor (`/v1/edit`)
already shipped across many small issues post-v1.0 — `#37` is closed as superseded.

## Planning lives in GitHub (2026-05-30 pivot)

Open work, roadmap, and ship history all live on GitHub now — **not** in markdown docs.
The old `ROADMAP.md` / `BACKLOG.md` / `CHANGELOG.md` triad was retired; do not recreate them.

- **Open tasks → [GitHub Issues](https://github.com/MattAltermatt/pyr3/issues).** Each issue
  carries a **type label** (`feat` · `bug` · `parity` · `chore` · `infra` · `docs` · `test` ·
  `cli` · `perf`), a **size label** (`size/XS`…`size/XL`), and optionally `partial`. Reference
  issues by `#N`. The legacy `[PYR3-NNN]` IDs are preserved in each migrated issue body and in
  git history, but new work uses `#N` — do not invent new `PYR3-` IDs.
- **Roadmap → [Milestones](https://github.com/MattAltermatt/pyr3/milestones).** Each `vX.Y`
  milestone IS a ship gate: when every issue in it closes, tag the release. **v1.0 → v1.4
  have all shipped** (latest: `v1.4.0` on 2026-06-02 — render improvements). The active
  themed milestones are **Apophysis and JWildfire** (plugin pack #114, gradient editor #115,
  channel curves #116) and **Mobile rework** (#33). Two parked milestones live off-main and
  wait on the evolve unpark: **evolve - picbreeder editor surface** and **parked —
  evolve-page cleanup**. No Project board — milestone-only planning.
- **Ship history → [GitHub Releases](https://github.com/MattAltermatt/pyr3/releases)** (v1.0
  onward). Pre-1.0 history is frozen in `HISTORY.md` (kept in-repo for provenance).
- **In-repo docs that survive:** `VISION` · `CLAUDE` · `README` (+ `HISTORY.md`, `NOTICE.md`).
  These still track code. No more six-doc sync dance.

## Repo conventions

- Default branch: `main`.
- Local git identity (required — global identity is unset):
  - `user.name  = MattAltermatt`
  - `user.email = 1435066+MattAltermatt@users.noreply.github.com`
- License: GPL-3.0-or-later (inherited from the flam3 lineage).
- Spec location: `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
- Version source of truth: `package.json`. The showcase build reads it.
- Git tags: **the first tag is `v1.0.0`** (semver, matching `package.json`). The v0.x line is
  work-in-progress and is NOT tagged (no one wants v0.x tags of a WIP). At v1.0.0 and after,
  each ship bumps `package.json`, tags `git tag vX.Y.Z`, and cuts a GitHub Release (the ship
  notes). (See issue #12.)

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
     R tolerance) — the 26-fixture parity rig (`npm run test:parity`); an
     optional 4K-resolution gate is deferred (`#34`)
   - **FE↔BE parity at quick-mode dims** (browser viewer renders match
     BE CLI for the same fixture at 1024 long-edge within R tolerance) —
     `#35`
   - **Ground truth = flam3-C, NOT the predecessor.** The 2026-05-28 pivot
     replaced the predecessor-port goldens with deterministic `flam3-render-32bit-isaac`
     output (`isaac_seed=<fixture-id>`). The predecessor was sufficiently faithful
     in most cases (R<5 vs flam3) but carries a small port-specific offset
     that distorted pyr3's measured parity. flam3-C is the canonical lineage
     reference. Goldens in `fixtures/flam3-goldens/<id>/golden.png` are now
     flam3-C renders; expectedR / thresholdR in each `meta.json` reflect
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

## Editor affine decomposition (`/v1/edit` xforms v2)

The xforms section presents each xform's affine pre-transform as 5 plain
fields (scale x, scale y, rotation in degrees, position x, position y)
plus optional shear, with the raw `a..f` matrix tucked into a fold-up.
The genome's source of truth stays the raw `a..f` matrix on `Xform`;
`src/affine-decompose.ts` provides forward (`decomposedToRaw`) + inverse
(`rawToDecomposed`) maps that recompose on every edit.

Composition order is QR: shear → scale → rotate → translate.
Canonical sign: `scale_x ≥ 0` (positive); a flipped orientation shows up
as `scale_y < 0`. Editing one view (raw or decomposed) live-syncs the
other. Open file with `shear ≠ 0` → the shear fold-up auto-expands so
the user doesn't miss it. Same treatment is applied to the optional
post-affine when "use post-transform" is checked.

The picker for variation kinds (`src/edit-variation-picker.ts`) is the
"fitting-room" modal: tile-click previews live, apply commits, revert
restores the snapshot while keeping the picker open. `Xform.active` and
`Variation.active` are optional booleans (undefined = active); the
packer (`src/symmetry.ts:expandGenomeForGPU`) zeros packed weights when
`active === false` — no shader change. Shift-click on the active
checkbox solos; `state.soloXformSnapshot` / `soloVariationSnapshot`
hold the transient restore state (UI-only, never serialized).

## Verification expectations

Per the global workflow:
- ✅ Type-check + tests pass before commit
- ✅ Chrome verify (via `chrome-devtools-mcp`) for any change touching the render path or
  canvas wiring. **Built-in Claude preview is forbidden.**
- ✅ Hand the user a clickable `http://localhost:5173/` URL when a verify is needed
  (pyr3 has no audio — global `?mute=1` default doesn't apply)
- ✅ Backend renders verified by `npm run render` + R-comparison to flam3-C golden
- ⚠️ BE parity gate is **local-only** (`npm run test:parity`, ~91s on a real GPU).
  #71 attempted to wire it into CI on `ubuntu-latest` (Dawn + lavapipe software
  Vulkan); each fixture's render exceeded the per-spawn 120s cap on lavapipe,
  so the gate cannot run in any reasonable CI budget. Run locally before any
  PR that touches the render path; pre-release manual sweep before tagging.
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

**Tier contract (re-baselined 2026-06-02 — issue #43):** Per-fixture
`meta.json` carries `expectedR` (3-run mean R vs flam3-C on the current
engine), `thresholdR = expectedR + 1.0`, and `tier: 1 | 2`. **Tier-1**
fixtures have `expectedR < 5.0` — the healthy parity band where pyr3
matches flam3-C within visual tolerance (22 of 26 fixtures). **Tier-2**
fixtures have `expectedR ≥ 5.0` (4 fixtures) and carry a `notes` field
describing the residual. Both gates are equally load-bearing for the v1.0
ship contract: a tier-2 regression past `thresholdR` means the residual
moved (real ship-blocker); tier-1 regressions read as engine bugs.

**Walker jitter is now scale-relative (#43, 2026-06-02).** The chaos kernel
adds a per-iter perturbation of `local_mag × k` where `local_mag` is the
walker's current coord magnitude and `k = DEFAULT_WALKER_JITTER = 1e-7` is
a dimensionless proportional factor anchored to f32 epsilon
(`2^-23 ≈ 1.19e-7`). This replaced the static-amplitude story (`1e-6` →
`1e-8` → `1e-10` across #6/#10) which was a per-class band-aid; the new
mechanism self-tunes per walker and retired the amplitude conversation.
On the canonical jitter-sensitive fixture `electricsheep.248.23554` this
drops R from 11.4 → 6.4 (−44%) without per-fixture tuning. Future
investigations of `--jitter` / `?jitter=` debug knobs interpret the value
as a proportional factor, NOT an absolute amplitude.

The 4 remaining tier-2 fixtures (`248.23554` R≈6.4, `244.82986` R≈8.9,
`coverage.248.02226` R≈5.7, `244.42746` R≈5.3) have **non-jitter
residuals** — they were unchanged by the scale-relative mechanism, which
is the empirical proof that their divergence is upstream/orthogonal to
the chaos-game perturbation. Each needs its own diagnosis. The
`electricsheep.248.25703` case (filed in #64) was **RESOLVED in #72**
(now tier-1, R≈2.16, added to the parity rig as `248.25703`) — and its
cause was NOT a tier-2-style residual but the **Dawn f32 trig range
cliff**: Dawn's f32 `sin`/`cos` return exactly 0 for |arg| ≳ 1e7
(accurate only below ~5e6; spec-permitted, not a Dawn bug). `var_waves`
with degenerate coefs (`c=f=0`) computes `sin(p·1e10)` → 0 → waves
degenerates to the identity transform → 3× attractor-coverage collapse →
dark/sharp at high gamma. Fixed by `safe_sin`/`safe_cos`/`safe_tan` in
`chaos.wgsl` (native trig below `SIN_SAFE_MAX=1e6`, deterministic
hash-spread above), applied to all non-angle-bounded variation trig.
**For any new WGSL `sin`/`cos`/`tan` of a coord / radius / r² /
coef-scaled value (anything not freshly `atan2`'d into [-π,π]), route it
through `safe_*`** (and test with RUNTIME args — constant trig args get
compiler-folded, masking the cliff). The other 4 tier-2 fixtures are not
waves-degenerate; their residuals remain per-fixture-unfiled. Historical
lineage: **PYR3-056** (v0.36 DE-norm fix)
collapsed the original wave of outliers; #43 (this commit) collapsed the
jitter-sensitive subset; what's left needs per-fixture investigation.
(`HISTORY.md` v0.19 records the original f32-floor rationale as a frozen
historical entry — superseded by this section.)

## Useful pointers

- Design spec: [`docs/superpowers/specs/2026-05-27-pyr3-design.md`](docs/superpowers/specs/2026-05-27-pyr3-design.md)
- Open tasks + roadmap: [GitHub Issues](https://github.com/MattAltermatt/pyr3/issues) +
  [Milestones](https://github.com/MattAltermatt/pyr3/milestones) (`v1.0` = ship gate)
- Ship history: [Releases](https://github.com/MattAltermatt/pyr3/releases) (v1.0+) ·
  [`HISTORY.md`](HISTORY.md) (frozen pre-1.0 log)
- The "single engine, two consumers" seam: `src/main.ts` (browser) + `bin/pyr3-render.ts` (CLI)
- WGSL shaders: `src/shaders/{chaos,density,visualize_u32,visualize_f32}.wgsl`
