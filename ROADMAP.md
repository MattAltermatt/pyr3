# 🗺️ pyr3 Roadmap

Forward-looking only. Authoritative ship history lives in
[CHANGELOG.md](CHANGELOG.md) — each shipped version below points there. Open task registry
in [BACKLOG.md](BACKLOG.md).

## 🚀 Shipped (latest at top)

| Version | Date | Commit | Headline |
|---|---|---|---|
| **v0.1** | 2026-05-27 | _(this commit)_ | **Phase 0: TS+WGPU engine basis.** Copied pyr3-peek wholesale (`src/` + `bin/` + `scripts/` + `tests/` + `fixtures/` + `index.html` + Vite/tsconfig/package). Renamed `pyr3-peek` → `pyr3`. Stripped peek identifiers across 7 files. Verified: `npm test` 4471/4471 green, `npm run render` produces PNG in 5.22 s, `npm run dev` + Chrome verify renders welcome flame. |
| **v0.0** | 2026-05-27 | `bbc3b5a` | **Project genesis.** 6-doc structure + design spec + LICENSE seeded. No engine code yet. |

## 🎯 Next phases

### Phase 1 — Audit-port pyr3-kotlin's GPU/parser/variation fixes (target: v0.5)

Enumerate every pyr3-kotlin commit (v0.10 → v1.x-E) that touches `:gpu` (WGSL), `:flam3`
(parser), `:core` (variations / calibration / tonemap / palette). For each: evaluate whether
peek's TS/WGSL has the same bug; if so, port. Each port is its own commit with a `Port:
pyr3-kotlin <ref>` body trailer citing the kotlin source.

Known-load-bearing ports queued:

| kotlin ref | What | WGSL file |
|---|---|---|
| v0.36-A | EDISC EPS-clamp (near-unit-circle precision crater) | `chaos.wgsl` |
| v0.36-H | sub-ulp walker jitter (fractalapple tight-orbit recovery) | `chaos.wgsl` |
| v1.x-C | finalxform opacity gate (`opacity-=1` short-circuit) | `chaos.wgsl` |
| v1.x-E | post-process pipeline ordering (DE + spatial on readback) | render-orchestrator |
| v0.32 | TonemapPass u32 signedness fix | `visualize_u32.wgsl` |
| v0.28b | DE u32 signedness fix | `density.wgsl` |
| v0.21 | `pre_blur` variation | `variations.ts` + `chaos.wgsl` |

Full enumeration happens during phase execution by scanning kotlin's CHANGELOG.

**Acceptance:** all known kotlin GPU/shader/variation/parser fixes accounted for (ported, or
marked non-applicable with one-line reason in commit body). `npm test` green.

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
