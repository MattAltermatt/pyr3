# 🗃️ pyr3 Backlog

Authoritative registry of open tasks. Every open task carries a `[PYR3-NNN]` ID (required) and
best-effort flags (optional): `category · size · sigil · status · milestone`.

Forward-only — shipped work lives in [CHANGELOG.md](CHANGELOG.md). Strategic narrative +
current cycle lives in [ROADMAP.md](ROADMAP.md).

> **Next ID: PYR3-016** — increment when creating a new entry. Never reuse, even for
> shipped/removed tasks.

## [PYR3-015] gpu · M · 🪨 · queued · v1.x — Regular-xform opacity → alpha-scaling (replace splat-skip stand-in)

After v0.9 shipped the finalxform-only opacity gate (`[PYR3-009]`), regular-
xform opacity in `chaos.wgsl:1727-1738` is still handled by the legacy
"Phase 9d probabilistic splat skip" — gate the splat at the chaos-game
level instead of alpha-scaling the deposited color in the tonemap path.

The flam3-faithful semantic is **per-xform alpha-scaling** via
`adjust_percentage(opacity)` through `variations.c:2044` + `:2167`
(kotlin tracks this as PYR3-035). Splat-skip is statistically equivalent at
the median pixel (opacity=0.5 → half samples = half accumulated color) but
**noisier at low SPP** than proper alpha-scaling (which deposits at full
sample density with scaled color).

**Why:** Phase 3 quality gating may surface fixtures whose splat-skip
behavior diverges visibly from flam3 at low render-quality bands. Alpha-
scaling is also a cleaner gradient.

**How to apply:**
1. Remove the `if (rand01 >= opacity) continue;` block at `chaos.wgsl:1727-
   1738` (the current splat-skip).
2. In the splat-color path (after the palette lookup, before the `atomicAdd`
   calls — chaos.wgsl ~1771-1777), multiply the `pal` rgb components by
   `xf.color_params.z` (= regular-xform opacity).
3. Verify against the 19 fixture set: regressions on coverage.248.24236 +
   coverage.248.33248 should NOT reappear (the new path achieves the same
   "deposit-less when opacity-low" effect, just without the random skip).
4. Recalibrate baselines on any fixtures that move > 0.1.

**Reference:** flam3 `variations.c:2044, 2167`; kotlin equivalent is
`PYR3-035` in pyr3-kotlin's BACKLOG.

## [PYR3-014] infra · XS · 🪶 · queued · v1.x — Vitest worker RPC timeout on 89s parity suite

## [PYR3-014] infra · XS · 🪶 · queued · v1.x — Vitest worker RPC timeout on 89s parity suite

`npm run test:parity` (19 fixtures, ~89 s total) emits an "Unhandled Error:
`[vitest-worker]: Timeout calling 'onTaskUpdate'`" at the end. All 19 tests
pass — the error is vitest's internal RPC heartbeat firing because the suite
runtime exceeds the default `onTaskUpdate` timeout. Doesn't affect correctness,
just produces scary log noise.

**Why:** As Phase 3 adds more fixtures or higher-quality renders, the suite
will only get slower; the noise will be persistent.

**How to apply:** Either bump vitest's worker timeout via `vitest.config.ts`
(`test.testTimeout` already 180s — this is a *different* RPC timeout — likely
`poolOptions.threads.singleThread` or `chaiConfig.includeStack`), or split the
parity suite into per-fixture vitest invocations. Easiest: try
`test.teardownTimeout: 120_000` + `test.hookTimeout: 120_000` in config.

Surfaced 2026-05-27 during v0.8 (19-fixture expansion).

## [PYR3-013] feat · L · 🪨 · queued · post-v1 — Showcase gallery (mirror pyr3-kotlin's v1.1)

User-facing reference: <https://mattaltermatt.github.io/pyr3/v1.1/>. A curated
multi-flame HTML gallery (3-column layout: flam3-C ref / pyr3 BE / pyr3 FE)
that visitors land on to see what pyr3 actually renders. ~50-150 flames, pulled
from the Electric Sheep Fold corpus + pyr3-kotlin's `parity/src/test/resources/`
+ the existing `fixtures/flam3-goldens/` parity set.

**Why post-v1.0:** the showcase IS the public-facing story for pyr3; needs the
ship gate met before it's worth building. Premature showcase risks shipping
"here are some flame renders" before they actually match flam3-C.

**Distinct from the parity rig:** Phase 2's `fixtures/flam3-goldens/` is the
**regression-gate** infrastructure (small focused set, R-gate, automated).
Showcase is the **presentation** surface (large curated set, HTML gallery,
visual review). The parity-set fixtures are a *subset* of showcase candidates
but the tooling and structure are different.

**Build prerequisites:**
1. Build flam3-C locally (pyr3-kotlin's `parity/flam3/` has source + build
   scripts) so we can golden whatever fixture lands in the showcase. Without
   this we're capped at the 16 fixtures kotlin already golden'd.
2. Curate fixture list — likely lift kotlin's `v1.0-showcase.txt` shape as a
   starting point. Some fixtures live in ESF corpus
   (`/Users/matt/dev/MattAltermatt/electric-sheep-fold/corpus/`), some in
   kotlin's `parity/src/test/resources/`. Path-resolution layer needed.
3. Decide hosting: GitHub Pages branch `gh-pages` (mirror kotlin's pattern via
   adapted `render-showcase.sh`), or shipped as `dist/showcase/`.
4. Render harness — batch invoke `bin/pyr3-render.ts` per fixture; FE side
   needs a chrome-devtools-mcp orchestration script (or pre-rendered PNG only).

**Dependency:** v1.0 ship-gate pass.

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
