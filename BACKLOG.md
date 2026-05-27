# 🗃️ pyr3 Backlog

Authoritative registry of open tasks. Every open task carries a `[PYR3-NNN]` ID (required) and
best-effort flags (optional): `category · size · sigil · status · milestone`.

Forward-only — shipped work lives in [CHANGELOG.md](CHANGELOG.md). Strategic narrative +
current cycle lives in [ROADMAP.md](ROADMAP.md).

> **Next ID: PYR3-013** — increment when creating a new entry. Never reuse, even for
> shipped/removed tasks.

## [PYR3-012] infra · XS · 🪶 · queued · v1.x — Separate `npm test` from `npm run test:parity`

`vitest run` auto-discovers `src/parity.test.ts` alongside the unit tests, so
`npm test` quietly invokes the WebGPU CLI per fixture. On any host without a
Dawn-capable GPU (CI, Docker, contributor laptops without WebGPU support) the
parity tests fail non-cleanly with a spawn exit=1 + buried stderr.

**Why:** README's "full unit + parity suite" framing sets expectation that
`npm test` is the everyday dev command. Pure-unit work should not require a
GPU; parity work has its own `npm run test:parity` entry.

**How to apply:** Add a `vitest.config.ts` with `test.exclude:
['**/parity.test.ts']` (or move `parity.test.ts` to a folder vitest doesn't
auto-discover). Keep `test:parity` as the explicit parity entrypoint. Surface
to the user before tightening — the current shape is intentional per Phase 2
(parity in CI deferred to post-v1.0), so this is purely a DX tweak.

Surfaced by Phase 2 code review (2026-05-27).

## [PYR3-011] parity · M · 🎚️ · queued · v1.x — Expand parity fixture set to 5-7 flames (requires building flam3-C locally)

v0.7 shipped Phase 2 with 3 fixtures lifted from `pyr3-kotlin/parity/goldens/`
(247.29388, 248.04487, 248.11268 — the ones with existing `flam3-ref.png`
goldens). The spec calls for 3-5 fixtures balanced across variation usage +
visual character. Currently the set is biased toward whatever `pyr3-kotlin`
happened to have golden'd; we want 2-4 more representing different variation
clusters (e.g. `pre_blur`-heavy, `julia`-heavy, finalxform-with-opacity, xaos-
heavy).

**Why:** Phase 3 R-threshold tightening only generalizes if the fixture set
covers the variation surface. Three goldens is the floor, not the target.

**How to apply:** Build flam3-C locally (`pyr3-kotlin/parity/flam3/` has the
source + build scripts; or apt/brew if available). For each chosen
Electric Sheep flame: `flam3-render` it at the same canvas size as the
existing 3 fixtures (800×592 keeps the harness simple), commit the golden +
source .flam3 + meta.json under `fixtures/flam3-goldens/<id>/`. Re-run
calibration (3 runs, populate baselineR + thresholdR).

**Dependency:** [PYR3-009] resolution informs which opacity-bearing fixtures
make sense to add.

## [PYR3-009] gpu · M · 🪨 · investigation · v1.x — Opacity-gate semantics (finalxform-only vs per-xform-splat)

pyr3 currently gates regular xforms' splats by `rand01 < opacity` at
`chaos.wgsl:1727-1738` ("Phase 9d probabilistic splat skip"). pyr3-kotlin's
v1.x-C-opacity ships a different gate: finalxform-only, via `rand01 < opacity`
matching `flam3.c:336-337`'s `opacity-=1` RNG short-circuit. Kotlin's
PYR3-035 separately tracks regular-xform opacity as alpha-scaling (the
flam3 `adjust_percentage(opacity)` path through `variations.c:2044, 2167`),
not splat-skip.

**Why:** Two implementations of "opacity" exist in flam3 — finalxform skip
vs regular-xform alpha-scale. peek's current code is closer to neither
canonically. Need empirical investigation against fixtures with non-1
opacity (kotlin uses `coverage.248.11405` op=0.73, `coverage.248.25196`
op=0.39).

**How to apply:** Fetch a fixture with `finalxform opacity < 1` from the
ESF corpus. Render with peek's current code. Render with a port of
kotlin's finalxform-only gate. Compare visually + R-metric vs flam3-C
golden. Pick the more flam3-faithful approach.

## [PYR3-010] gpu · L · 🪨 · queued · v1.x — Variation-arm bit-parity audit (98 arms)

Sweep all 98 variation arms in `variations.ts` + `chaos.wgsl` against
pyr3-kotlin's `Variations.kt` port. For each arm, bilateral-probe (peek
output vs kotlin output for a synthetic 1-xform genome). Kotlin has
documented its variation-arm porting in CHANGELOG v0.10-v0.18 with
flam3-C source citations.

**Why:** Audit work is cheaper now (engine is in shape, fixtures correct,
test harness ready) than after we accumulate fixtures that depend on
specific arms.

**How to apply:** Spawn an Agent per variation cluster (8-15 arms each).
Each agent diffs peek's TS impl + WGSL impl against kotlin's Kotlin impl,
reports per-arm verdicts (identical / bit-divergent / algorithmically
divergent). Bundle findings into a per-arm follow-up BACKLOG.

## [PYR3-008] gpu · S · 🪨 · queued · v1.x — Decouple chaos.ts oversample from genome

`chaos.ts:173` reads `g.oversample` from the genome to compute the WGSL
`scale` uniform (`g.scale × g.oversample`). The pipeline's *actual*
oversample is already known to the renderer (`pipelines.oversample`); the
genome value is a vestigial parallel input that allowed v0.2's camera-zoom
bug to creep in (host setup forgot to keep them in sync).

**Why:** Defensive — eliminate the divergence class entirely so future host
setup bugs of the same shape cannot recur. The pipeline oversample is the
authority; the chaos pass should accept it as a dispatch parameter, not
re-read from the genome.

**How to apply:** Change `chaos.ts:dispatch` signature to take `oversample`
as an explicit arg (or derive from pipeline state). Update both call sites
(`renderer.iterate` + any other). Add a regression test that varies
`genome.oversample` and asserts WGSL `scale` matches `pipelineOversample × g.scale`,
not `genomeOversample × g.scale`.

**Flag vocabularies:**
- **category:** feat · perf · bug · parity · docs · cli · gpu · cpu · infra
- **size:** XS · S · M · L · XL
- **sigil:** 🪨 load-bearing · 🎚️ tunable · 🎨 cosmetic · 🪶 trivial
- **status:** active · queued · investigation · parked · someday
- **milestone:** v1.x · v2.0 · post-v1 · ...

Order convention when flags present: `category · size · sigil · status · milestone — title`.

## [PYR3-001] feat · XL · 🪨 · someday · post-v1 — Visual flame editor

Mutator + vault + recents + undo + landing screen + session persistence — essentially
pyr3-rust's scope, in pure TS (no WASM). Framework choice (React / Svelte / Solid) is itself
a load-bearing decision worthy of dueling agents when pulled forward.

**Depends on:** v1.0 ship-gate pass.

**Why much-later:** the editor is large enough to consume the project. Locking the viewer +
share-link + ship-gate first keeps the v1.0 scope honest.

## [PYR3-002] feat · XL · 🪨 · someday · post-v1 — Markov-chain flame generation research

Algorithmic research: train a Markov chain on a corpus of "good" Electric Sheep flames, sample
new flames from the chain, evaluate visual quality. Possibly with variation-arm or
parameter-space embeddings. Open research, not a feature ship.

**Depends on:** editor ([PYR3-001]) so generated flames have somewhere to live + be tweaked.

## [PYR3-003] perf · M · 🎚️ · queued · v1.x — GPU perf characterization

Once v1.0 ships, characterize wall-clock per-fixture on FE (Chrome) and BE (Node). Identify
hot paths in WGSL. Decide whether perf work is worth the engineering cost.

## [PYR3-004] gpu · S · 🪨 · queued · v1.x — Expand variation set audit

pyr3-peek's README claims 99 variations; pyr3-kotlin shipped 98/99 with `gdoffs` as the gap.
Audit which 99 peek has, confirm completeness, port any missing arms from kotlin during the
Phase 1 audit-port pass.

## [PYR3-005] cli · S · 🪨 · queued · v1.x — Single-binary CLI distribution

Ship `pyr3` as a single self-contained executable (Node SEA / pkg / similar) so users don't
need `npm install` or `node` installed on their machine. v1.0 ships with `npm run render`
working; post-v1.0 wraps the same `bin/pyr3-render.ts` into a `pyr3` binary. The underneath
must not change — `Phase 0` proves this seam works.

## [PYR3-006] infra · S · 🎨 · queued · v1.x — GitHub Actions CI

Build, typecheck, test on push to any branch. Auto-deploy frontend to `gh-pages` on tag push.
Cache `node_modules` for fast turnaround.

## [PYR3-007] feat · XS · 🎨 · queued · v1.x — Showcase flame gallery on homepage

The browser entry-point shows a curated gallery of share-link buttons so visitors land on
something visual, not an empty viewer. Pulls from `fixtures/showcase/`.
