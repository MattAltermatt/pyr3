# pyr3 — project notes for Claude

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

## Lineage (where ports come from)

| Repo | Role | Path |
|---|---|---|
| **pyr3-kotlin** | MOST mature predecessor; v1.x-E. JVM + LWJGL/Vulkan. Source of truth for GPU shader fixes, variation arms, parser edge-cases, R tolerance metric. | `/Users/matt/dev/MattAltermatt/pyr3-kotlin` |
| **pyr3-peek** | TS + WebGPU browser viewer. Phase 0 copies this wholesale as basis. WGSL shaders, ISAAC RNG, palette, calibration, 99-variation TS port. | `/Users/matt/dev/MattAltermatt/pyr3-peek` |
| **pyr3-rust** | Private archive. Rust core + WASM + React. Source of TS-era engine code pre-Rust pivot — `git log -- '*.ts'` is the entry point. | `/Users/matt/dev/muwamath/pyr3-rust` |

When porting from kotlin, every commit body MUST carry a `Port: pyr3-kotlin <ref>` line
citing the source (e.g. `Port: pyr3-kotlin v0.36-A 7c33994`).

## Locked decisions (load-bearing)

See [`docs/superpowers/specs/2026-05-27-pyr3-design.md`](docs/superpowers/specs/2026-05-27-pyr3-design.md)
for the authoritative record.

Short form:
1. TS + WebGPU + Vite
2. Node + `webgpu` npm (`dawn-gpu/node-webgpu`) — **NOT** `@kmamal/gpu`, **NOT** Deno, **NOT**
   Bun. Decided via parallel-dispatched dueling agents 2026-05-27.
3. Vitest + tsx
4. GPU only; no CPU path
5. v1.0 ship gate (two gates, both must pass on the curated fixture set):
   - **BE 4K parity vs kotlin v1.1** (BE CLI renders match kotlin's
     `SHOWCASE_4K` references at 3840 long-edge within R tolerance) —
     `[PYR3-023]`
   - **FE↔BE parity at quick-mode dims** (browser viewer renders match
     BE CLI for the same fixture at 1024 long-edge within R tolerance) —
     `[PYR3-026]`
   - The original "both FE and BE match flam3-C" framing was retired in
     v0.14 when FE 4K was removed; FE is now interactive at quick-mode
     only and BE owns the 4K parity vehicle.
6. Frontend = pyr3-peek layout for v1.0; editor is much-later post-v1
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
- BE 4K wrapper: `scripts/pyr3-023-be-render-4k.mjs` pre-processes the
  `.flame` (size / scale / oversample / quality rewrite) then invokes
  the same CLI — keeps the seam clean. Graduating to a first-class
  CLI flag is the first item in `[PYR3-023]`'s next phase.

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
  path `<img src="file:///Users/matt/dev/MattAltermatt/pyr3/...">`. Surface
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
`src/compare.ts` (ported verbatim from kotlin's
`/Users/matt/dev/MattAltermatt/pyr3-kotlin/parity/src/main/kotlin/pyr3/parity/Compare.kt`).
4K parity thresholds (BE vs kotlin v1.1 JPGs) still need separate
calibration — first item in `[PYR3-023]`'s next phase, since JPG noise
floor differs from the existing PNG-vs-PNG rig.

## Useful pointers

- Design spec: [`docs/superpowers/specs/2026-05-27-pyr3-design.md`](docs/superpowers/specs/2026-05-27-pyr3-design.md)
- Phase plan: [`ROADMAP.md`](ROADMAP.md) → "Next phases"
- Open tasks: [`BACKLOG.md`](BACKLOG.md)
- Ship history: [`CHANGELOG.md`](CHANGELOG.md)
- pyr3-peek's CLI seam (reference for the pattern we'll use):
  `/Users/matt/dev/MattAltermatt/pyr3-peek/bin/pyr3-render.ts`
- pyr3-peek's WGSL shaders:
  `/Users/matt/dev/MattAltermatt/pyr3-peek/src/shaders/{chaos,density,spatial-filter,visualize_u32,visualize_f32}.wgsl`
- pyr3-kotlin ROADMAP (for Phase 1 audit-port source):
  `/Users/matt/dev/MattAltermatt/pyr3-kotlin/ROADMAP.md`
- pyr3-kotlin CHANGELOG (same):
  `/Users/matt/dev/MattAltermatt/pyr3-kotlin/CHANGELOG.md`
