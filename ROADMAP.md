# 🗺️ pyr3 Roadmap

Forward-looking only. Authoritative ship history lives in
[CHANGELOG.md](CHANGELOG.md) — each shipped version below points there. Open task registry
in [BACKLOG.md](BACKLOG.md).

## 🚀 Shipped (latest at top)

| Version | Date | Commit | Headline |
|---|---|---|---|
| **v0.3** | 2026-05-27 | _(this commit)_ | **Phase 1: kotlin audit-port (no-op outcome).** Documented audit of 12 enumerated kotlin GPU / parser / variation fixes v0.10 → v1.x-E. 11 already in peek or structurally N/A in WGSL/TS (incl. both signedness fixes v0.28b + v0.32 — `IntArray.toLong()` sign-extend bug class cannot manifest in WGSL `array<u32>` + `f32(hist[i])`). 1 differing-semantics item (v1.x-C-opacity: finalxform-only vs per-xform-splat) filed as `[PYR3-009]` for empirical investigation. 98 variation arms in `chaos.wgsl` match kotlin's 98/99 (gdoffs gap shared). |
| **v0.2** | 2026-05-27 | `0139076` | **Camera-zoom bug fix (the one pyr3-peek couldn't crack).** Browser quick-mode renders of any flame declaring `supersample > 1` over-zoomed by that factor — `chaos.ts:173` reads `g.scale × g.oversample` from the genome, but `main.ts` was rescaling `g.scale` for canvas fit without resetting `g.oversample`. One-line fix: `renderGenome.oversample = targetOversample`. Welcome flame `247.19679` now matches kotlin v1.1 4K reference composition. |
| **v0.1** | 2026-05-27 | `aae6d5b` | **Phase 0: TS+WGPU engine basis.** Copied pyr3-peek wholesale (`src/` + `bin/` + `scripts/` + `tests/` + `fixtures/` + `index.html` + Vite/tsconfig/package). Renamed `pyr3-peek` → `pyr3`. Stripped peek identifiers across 7 files. Verified: `npm test` 4471/4471 green, `npm run render` produces PNG in 5.22 s, `npm run dev` + Chrome verify renders welcome flame. |
| **v0.0** | 2026-05-27 | `bbc3b5a` | **Project genesis.** 6-doc structure + design spec + LICENSE seeded. No engine code yet. |

## 🎯 Next phases

### Phase 1 — Audit-port pyr3-kotlin's GPU/parser/variation fixes ✅ SHIPPED v0.3 2026-05-27

11 of 12 enumerated fixes were already in peek or structurally N/A in
WGSL/TS (both signedness items v0.28b + v0.32 cannot manifest in WGSL
`array<u32>`). 1 differing-semantics item (v1.x-C-opacity) moved to
`[PYR3-009]` for empirical investigation against fixtures with non-1
opacity. See CHANGELOG v0.3 for the full audit table.

Follow-up scoped to BACKLOG:
- `[PYR3-009]` Opacity-gate semantics investigation
- `[PYR3-010]` Variation-arm bit-parity audit (98 arms)

### Phase 2 — Flam3-vs-pyr3 test rig + golden fixture set (target: v0.7)

Build the verification infrastructure that the ship gate stands on:

- **Golden PNG fixtures.** Curated set of N Electric Sheep flames pre-rendered with flam3-C
  (stored under `fixtures/flam3-goldens/`).
- **R tolerance metric.** Port pyr3-kotlin's R formula from
  `parity/src/main/kotlin/pyr3/parity/Compare.kt` to TS.
- **Two parity test paths.**
  - **FE parity:** chrome-devtools-mcp drives the browser viewer, captures the canvas,
    R-compares to flam3-C golden.
  - **BE parity:** `npm run render` produces a PNG, R-compares to flam3-C golden.
- **Vitest harness.** Both paths run in CI.

**Acceptance:** test rig produces an R score for any (flame, consumer) pair; baseline R
scores captured for the current pre-Phase-1 + post-Phase-1 code.

### Phase 3 — Iterate to v1.0 ship gate (target: v0.7 → v1.0)

Use the test rig to drive bug-fixing, shader improvements, parameter tuning until **both FE
and BE pass R tolerance for the chosen fixture set**. Each iteration is a discrete versioned
ship (v0.7, v0.8, ...). v1.0 = the version where the ship gate passes.

**Acceptance:** v1.0 ship gate met. Trigger pulled for replacing MattAltermatt/pyr3 +
pyr3-peek on GitHub.

## 🚧 Current todos

_None yet — todos populated when Phase 0 begins._

## 🔮 Future (post-v1.0, sketch only)

- **Visual flame editor** (BACKLOG `[PYR3-001]`) — open + tweak + save flames; framework TBD
  via dueling agents when pulled forward.
- **Markov-chain flame generation research** (BACKLOG `[PYR3-002]`) — algorithmic exploration
  of new genome-generation strategies.
- **Single-binary CLI distribution** (BACKLOG `[PYR3-005]`) — Node SEA / pkg wraps
  `bin/pyr3-render.ts` into a self-contained executable.
- **GitHub Actions CI** (BACKLOG `[PYR3-006]`) — build + test + gh-pages auto-deploy.
- **Showcase gallery on homepage** (BACKLOG `[PYR3-007]`).
