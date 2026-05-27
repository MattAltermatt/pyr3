# 🗺️ pyr3 Roadmap

Forward-looking only. Authoritative ship history lives in
[CHANGELOG.md](CHANGELOG.md) — each shipped version below points there. Open task registry
in [BACKLOG.md](BACKLOG.md).

## 🚀 Shipped (latest at top)

| Version | Date | Commit | Headline |
|---|---|---|---|
| **v0.8** | 2026-05-27 | _(this commit)_ | **Parity fixture set 3 → 19 (`[PYR3-011]` shipped).** 16 more flam3-C goldens lifted from `pyr3-kotlin/parity/goldens/` (turns out `flame.png` IS the flam3-C-binary golden per kotlin's `bakeOrLoad` cache contract — no local flam3-C build needed). R distribution now spans 0.45 (244.57686) → 32.62 (coverage.248.02226). `[PYR3-009]` opacity-gate investigation now has its reference fixtures (`coverage.248.11405` op=0.73 R=7.5, `coverage.248.25196` op=0.39 R=11.3). Per-fixture baselines + thresholds calibrated (variance < 0.02 across 3 runs). `[PYR3-014]` filed for cosmetic vitest RPC-timeout noise on the 89s suite. |
| **v0.7** | 2026-05-27 | `461c657` | **Phase 2: parity test rig + flam3-C goldens.** R-metric ported verbatim from kotlin (`src/compare.ts`, 19 unit tests); 3 fixtures lifted from pyr3-kotlin's `parity/goldens/` (247.29388, 248.04487, 248.11268, all 800×592); BE harness `src/parity.test.ts` spawns the Node CLI per fixture, asserts `R ≤ thresholdR`, writes a visibility-scaled `diff.png` for lead diagnostics; FE harness `scripts/fe-parity.ts` is lead-driven via chrome-devtools-mcp (+ dev-only `window.__pyr3LastHandle` hook). Per-fixture thresholds calibrated against ~deterministic baselines (R ≈ 2.0-3.0, threshold ≈ baseline + 1.0); gate verified live. |
| **v0.3** | 2026-05-27 | `5b1f559` | **Phase 1: kotlin audit-port (no-op outcome).** Documented audit of 12 enumerated kotlin GPU / parser / variation fixes v0.10 → v1.x-E. 11 already in peek or structurally N/A in WGSL/TS (incl. both signedness fixes v0.28b + v0.32 — `IntArray.toLong()` sign-extend bug class cannot manifest in WGSL `array<u32>` + `f32(hist[i])`). 1 differing-semantics item (v1.x-C-opacity: finalxform-only vs per-xform-splat) filed as `[PYR3-009]` for empirical investigation. 98 variation arms in `chaos.wgsl` match kotlin's 98/99 (gdoffs gap shared). |
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

### Phase 2 — Flam3-vs-pyr3 test rig + golden fixture set ✅ SHIPPED v0.7 2026-05-27

Acceptance met: 3 fixtures (247.29388, 248.04487, 248.11268) produce R
scores via the BE Vitest harness; the FE path is lead-driven via
`scripts/fe-parity.ts` + chrome-devtools-mcp. Per-fixture R thresholds
calibrated (baseline ≈ 2.0-3.0, threshold ≈ baseline + 1.0). Diff PNGs
auto-generated per run for lead diagnostics. See CHANGELOG v0.7.

Follow-up scoped to BACKLOG:
- `[PYR3-011]` Expand parity fixture set to 5-7 flames (requires building
  flam3-C locally).

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
