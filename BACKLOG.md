# 🗃️ pyr3 Backlog

Authoritative registry of open tasks. Every open task carries a `[PYR3-NNN]` ID (required) and
best-effort flags (optional): `category · size · sigil · status · milestone`.

Forward-only — shipped work lives in [CHANGELOG.md](CHANGELOG.md). Strategic narrative +
current cycle lives in [ROADMAP.md](ROADMAP.md).

> **Next ID: PYR3-023** — increment when creating a new entry. Never reuse, even for
> shipped/removed tasks.

## [PYR3-022] parser · S · 🪨 · queued · v1.x — Default-palette fallback when `<palette>` is missing

**Symptom (observed 2026-05-27, v0.13 doc-refresh):** `flame-import.ts:250`
throws if a `<flame>` lacks `<color>`, `<colors>`, AND `<palette>`. flam3-C
has a `flam3_palettes.xml` library of 700 numbered palettes that the
parser falls back to when no palette block is present (parser sets
`cp->palette_index` and `flam3_get_palette()` loads from the library).

**Hypothesis (unverified):** pyr3's 5-preset library (`PYRE`, `DEEPSEA`,
`BONE`, `VIRIDIS`, `MAGMA`) is wired for the dev-only "cycle palette"
button, NOT for parser fallback. A .flame without a palette block fails
to parse cleanly. ESF corpus is curated to always include palettes so
the gap hasn't surfaced in fixtures yet — but it's a v1.0 parser-
completeness gap.

**Next phase:** decide on fallback policy (port flam3's 700-palette
library to pyr3? OR use PYRE_PALETTE as the unconditional fallback? OR
keep the throw and require palette blocks?). Default-recommend: port
flam3-palettes once, treat as canonical reference; fall back to PYRE
only if the indexed palette lookup also fails.

Filed 2026-05-27 (v0.13). Low real-world risk until pyr3 ingests
non-ESF .flame files.

## [PYR3-021] parity · M · 🪨 · investigation · v1.x — PYR3-017 upstream-stage investigation pivot (palette / tonemap / density / spatial-filter)

PYR3-017 (`coverage.248.02226` R=32.6 systematic-brightness divergence)
was previously hypothesized to be a variation-arm bisection problem,
deferred to fold into the PYR3-010 98-arm audit. **PYR3-010 audit ran
v0.12 and ruled this out conclusively:** clusters C7+C8 explicitly
report that all six arms used by 248.02226 (`scry`/`cell`/`wedge_sph`/
`wedge_julia`/`oscope`/`flower`) audit clean. The audit cluster note:
*"any 248.02226 brightness divergence on this cluster is NOT a porting
bug at the arm level; it is either (a) accumulated f32 vs f64 precision,
(b) a non-cluster arm in the fixture, or (c) an upstream stage (palette
/ spatial-filter / density / log-tonemap)."*

v0.13 default-value fix dropped R from 32.62 → 29.96 (-2.66) — but
R=29.96 is still ~10× the suite average, so the residual is upstream
of the chaos game.

**Next phase candidates (decide via probe):**
- 🅰 **Palette baking diff** — `PYR3_DUMP_PALETTE=<path>` env var on the
  local flam3 binary at `/Users/matt/dev/sheep/flam3/flam3-render-32bit-isaac`
  (see `docs/flam3-local-build.md` channel #3). Diff pyr3's
  post-interpolation 256-RGB palette vs flam3's. Most likely culprit
  given the green-channel skew documented in original PYR3-017
  investigation (perChannel.g=51.40 vs r=39.68, b=39.44).
- 🅱 **Tonemap k1/k2 diff** — `PYR3_DUMP_TONEMAP=<path>` env var (channel
  #4). PYR3-017's original investigation analytically ruled out
  calibration math but the empirical re-test now becomes cheap.
- 🅲 **Density estimator divergence** — flam3-C's DE applies per-bucket
  ls during scatter (rect.c:140) at f64; pyr3's WGSL DE pass at f32.
  May explain residual brightness for high-quality dense fixtures.

**How to apply:** dispatch a `flame-fixture-investigator` subagent
with PYR3-017's fixture name + the upstream-stage shape, pointing at
the four instrumentation channels in `docs/flam3-local-build.md`.

Filed 2026-05-27 (v0.13). Replaces the previous PYR3-017 BACKLOG entry's
"folds into PYR3-010" plan now that PYR3-010 has run and the variation
hypothesis is ruled out.

## [PYR3-020] feat · M · 🐛 · queued · v1.x — `?flame=` share-link decode fails on ~6KB+ payloads

**Symptom (observed 2026-05-27):** Loading the FE viewer via a share
link encoded from any multi-genome `.flame` (e.g. `247.29388.flam3`,
~6.6KB URL) silently fails. Console shows
`pyr3: failed to decode ?flame= share link — Failed to fetch; falling
back to welcome`. The viewer then renders the welcome flame instead.

**Hypothesis (unverified):** `streamDecompress` in `src/url-codec.ts`
uses `new Response(stream).arrayBuffer()` — the `Failed to fetch`
error likely originates from the Response wrapper around the
DecompressionStream pipeline. Specific failure cause unknown; possible
that Vite dev-server's overall payload handling truncates or the
DecompressionStream barfs on the specific binary contents at this size.

**Next phase:** verify hypothesis against current code first — repro
with a smaller payload, add try/catch around each pipe stage, dump the
base64-decoded bytes pre-decompress, narrow the failure point.

Surfaced 2026-05-27 (v0.12) during PYR3-018 FE sweep — driven around by
loading via the 📂 Open button file picker instead. Sweep proceeded to
completion; this remains a real share-link regression to close before
v1.0.

## [PYR3-019] parity · L · 🪨 · queued · v1.x — 3-way verify: FE + BE + golden side-by-side

PYR3-018's sweep gates on FE-vs-flam3-C-golden (per spec §3, the v1.0
ship gate). User-requested 2026-05-27: future verify HTMLs should
surface all three pairings — FE-vs-golden (current), BE-vs-golden (from
`meta.json`), and FE-vs-BE direct — so the geometry of any divergence
is immediately visible (which engine is closer to flam3, where the two
pyr3 engines disagree regardless of golden alignment).

**Why L:** The current `pyr3-018-fe-collect.ts` produces FE-R + meta-
stashed BE-R. Adding FE-vs-BE direct requires a per-fixture BE render
on the fly (`npm run render` per fixture) OR reading from cached
`fixtures/flam3-goldens/<fix>/pyr3-render.png` (committed gitignored).
Then the diff PNG would expand to a 6-column grid (golden / FE / BE /
FE-vs-golden-diff / BE-vs-golden-diff / FE-vs-BE-diff) or a tabbed
layout. Affects both the collector and the HTML builder.

**How to apply:** Likely extend `scripts/pyr3-018-fe-collect.ts` to
optionally take a `--include-be-render` flag that loads pyr3-render.png
(BE), computes the 3 pairings, and emits all three diff PNGs. Update
`scripts/pyr3-018-build-html.mjs` to a wider grid. Generalize beyond
PYR3-018 — this is the right shape for any post-v1.x parity verify.

Filed 2026-05-27 (v0.12) as a follow-up to PYR3-018's first FE sweep.


## [PYR3-017] parity · M · 🪨 · investigation · v1.x — `coverage.248.02226` R=32.62 systematic-brightness divergence

**Symptom (observed 2026-05-27, v0.11):** `coverage.248.02226` is the
worst R outlier in the 19-fixture parity set (R=32.62; next-worst is
`coverage.245.06687` at R=14.58 — more than 2× the gap). R has been
stable across v0.7 → v0.11 (no shift from PYR3-009 finalxform-opacity
gate or PYR3-015 alpha-scaling). All five tonemap/opacity-related
ships have left it unchanged within run noise.

**Visual characterization (eyeballed `diff.png` + side-by-side
golden/render):** **Structural geometry matches perfectly** — same
xform skeleton, same swirl positions, same overall composition. The
divergence is **systematic brightness loss**, NOT geometric. pyr3
renders at roughly 30-40% of the golden's color intensity across the
entire canvas. The dense-feature bottom-left region (perRegion
bl=71.39) is worst-affected because that's where most of the brightness
lives in the golden; flatter regions diverge less (tr=32.61, br=31.62)
simply because there's less to dim. Green channel diverges most
(perChannel g=51.40 vs r=39.68 b=39.44), consistent with the golden's
dominant green/cyan palette being preferentially dimmed.

**Hypotheses RULED OUT:**
- ❌ **Geometric / rotation / center offset** — structure matches; only
  intensity differs.
- ❌ **Opacity-related** — all 9 xforms (8 regular + finalxform) have
  `opacity="1"`; PYR3-009 + PYR3-015 changes left R unchanged here.
- ❌ **Sample-count starvation** — at `quality="500.0"`, `1280×720`,
  targetSamples = 460,800,000. Renderer math (`renderer.ts:171-182`)
  produces dispatchWalkers=1024 × dispatchIters≈450,000 ≈ 460.8M,
  matching target exactly. Not capped by MAX_ITERS_PER_WALKER (2^20).
- ❌ **Calibration math** (`calibration.ts:37-43`) — k1 = brightness ×
  PREFILTER_WHITE × 268/256 and k2 = oversample² × scale² / (WHITE_LEVEL ×
  sampleCount). Confirmed equivalent to flam3 `rect.c:933-937` after
  algebraic substitution (sampleCount = W×H×quality in pyr3 terms).
- ❌ **General vibrancy=1 path bug** — 18/19 fixtures have `vibrancy="1"`
  and pass parity. The HSV / newrgb / per-channel-gamma branching in
  visualize_u32.wgsl handles vibrancy=1 broadly correctly.

**Hypothesis A — tonemap-parameter interaction — RULED OUT (2026-05-27 probe):**

`scripts/pyr3-017-probe.ts` swept 10 variants (brightness ∈ {11, 22, 44,
88}, gamma ∈ {2.0, 2.4, 3.2, 5.0}, vibrancy ∈ {0, 1}, highlight_power
∈ {0.5, 1, 2}). **Baseline R=32.6209 is the LOCAL MINIMUM** — every
single-axis swap moved R UP (worst: v0 R=34.29, b88 R=34.12). Pyr3's
tonemap math is self-consistent with the parameters; the divergence is
upstream of the visualize pass. Full sweep log:
`.remember/tmp/pyr3-017-sweep.log`.

**Hypothesis (new) — rotation precision — RULED OUT (2026-05-27 probe):**

Fixture has `rotate="-1890.87"` (≈ -33 rad as f32 fed to WGSL `cos()` /
`sin()`, whose precision is implementation-defined for large arguments).
Re-rendered with `rotate=-90.87` (mathematically equivalent post-mod):
R=32.6187 vs baseline 32.6209 — within run noise. GPU trig precision is
not the source of divergence on this fixture.

**Hypothesis (new) — `palette_interpolation="hsv_circular"` — RULED OUT
(2026-05-27 cross-fixture comparison):**

Pyr3 doesn't honor `palette_interpolation` (no source matches) — the
attribute affects authoring-time palette baking, not render-time. Six
OTHER fixtures use `hsv_circular` and pass parity with R ∈ [1.36, 4.92].
The attribute can't explain the 13× R gap to 248.02226.

**Hypothesis — dominant-xform variation drift — RULED OUT (2026-05-27
probe):**

Bisected the dominant xform (weight=6.651: swirl + cell + curve +
polar2 + scry) by swapping each variation to `linear` in turn and
re-rendering. **All 5 removals INCREASED R** — none dropped it toward
golden:

```text
variant            R       Δ vs baseline
-----------------  ------  --------------
baseline           32.61   —
remove-cell        35.03   +2.42 🔴
remove-curve       35.93   +3.32 🔴
remove-swirl       37.62   +5.01 🔴
remove-scry        39.37   +6.76 🔴
remove-polar2      39.55   +6.94 🔴
```

Cell-removal is particularly telling: cell has weight 0.00338 (~0.3%
of the xform's total variation budget); a buggy impl would have shown
R DROP on removal (composition barely changes, so any R drop is bug
signature). Instead R rose +2.42, indicating cell's impl is consistent
with flam3 on this fixture's input distribution. Same logic applies
to the other four — none flag as the bug.

**Hypothesis REMAINING — non-dominant-xform / non-variation drift:**

Divergence source is NOT in:
- Tonemap (10-axis sweep ruled out)
- Rotation (precision probe ruled out)
- Palette interpolation (cross-fixture comparison ruled out)
- Sample-count / calibration math (analytic verification ruled out)
- Dominant-xform variations (bisection above ruled out)

Remaining candidates:
- 🅰 **Lower-weight xforms' variations** (8 other xforms total weight ~7,
  many uncommon arms: flower, loonie, popcorn2, stripes, waves2,
  flower_petals, modulus, wedge_sph, bubble, wedge_julia, sec, csch,
  oscilloscope, disc, bent).
- 🅱 **Color blending** (color_speed=0.5 with color=0 vs color=1 mix in
  this fixture — could be a mix-order divergence).
- 🅲 **Pre/post affine application order or precision** in xforms with
  non-identity `post` (xforms 4, 5, 6, 7 here).
- 🅳 **Finalxform** with linear(0.547) + bent(0.452) — bent is a sign-flip
  variation, could have edge cases.
- 🅴 **ISAAC RNG xform-selection drift** vs flam3's RNG, biasing which
  xforms are picked. Would systematically shift sample density.

**Status update (2026-05-27, v0.13):** PYR3-010 audit ran in v0.12 and
**ruled out** the variation-arm hypothesis (all six arms used by
248.02226 audit clean — see `[PYR3-021]`). v0.13's default-value fix
dropped R from 32.62 → 29.96 (-2.66) but the residual is upstream of
the chaos game. Next-step investigation is now `[PYR3-021]`
(palette/tonemap/density/spatial-filter upstream-stage probes).

**Concrete next step (HISTORICAL — superseded by PYR3-021):** Folds
into `[PYR3-010]` 98-arm bit-parity audit which is the right vehicle
for per-arm comparison. Aggregate bisection exhausted in this session
— further isolation needs synthetic 1-xform probes against flam3-C /
kotlin per-arm references, not the 248.02226 fixture itself.

**Why M (not L):** Investigation narrowed 6 hypotheses → 1 area
(non-dominant xform / non-variation paths) in this session. Folded into
existing `[PYR3-010]` audit rather than re-prosecuted standalone.

**Acceptance:** Either R drops below ~5.0 as a side effect of `[PYR3-010]`
landing variation-arm fixes, OR the residual divergence is conclusively
attributed to a flam3 feature pyr3 deliberately implements differently
(e.g., a deferred-rendering decision in the chaos-game core).

Surfaced as a session-handoff mystery 2026-05-27 (v0.7 → v0.11); first
focused investigation 2026-05-27. Probe script preserved at
`scripts/pyr3-017-probe.ts` for re-use.

## [PYR3-014] infra · S · 🪶 · queued · v1.x — Vitest worker RPC timeout on 89s parity suite

`npm run test:parity` (19 fixtures, ~89 s total) emits an "Unhandled Error:
`[vitest-worker]: Timeout calling 'onTaskUpdate'`" at the end and exits 1.
All 19 tests pass — the error fires from vitest's internal worker→main RPC
heartbeat (`birpc`), which has a hardcoded ack timeout that's NOT
configurable via `testTimeout` / `hookTimeout` / `teardownTimeout` /
`poolOptions`.

**Why:** As Phase 3 adds more fixtures or higher-quality renders, the suite
will only get slower; the noise will be persistent. The exit-1 makes CI
treat the run as failed despite green tests.

**Investigation log (2026-05-27, on `vitest@3.2.4`):**
- ❌ `test.teardownTimeout: 120_000` + `test.hookTimeout: 120_000` in
  `vitest.config.ts` — no effect (these gate test-runner phases, not RPC).
- ❌ Switching `test.pool: 'forks'` + `poolOptions.forks.singleFork: true`
  — same error reproduces. Forks vs threads doesn't change RPC behavior.
- 🔍 Root cause confirmed: vitest 3.x bundles `birpc` with a hardcoded
  per-call timeout in `node_modules/vitest/dist/chunks/rpc.-pEldfrD.js:53`.
  Long-running GPU-driven tests block the event loop enough that the
  RPC ack window expires.

**Candidate fixes (none XS):**
- 🅰 **Upgrade to `vitest@4.x`** — major-version bump (current dep `^3.0.0`).
  May or may not include RPC-timeout config; needs migration testing.
- 🅱 **Per-fixture vitest invocations** — replace `vitest run
  src/parity.test.ts` with a shell loop that runs one fixture at a time
  (each <30s, well under RPC threshold). Bigger restructure of the test
  harness.
- 🅲 **Stderr-filter wrapper** — `scripts/run-parity.sh` runs vitest,
  filters the known noise, exits 0 iff all tests pass. Pragmatic hack.

Surfaced 2026-05-27 during v0.8 (19-fixture expansion); investigation
deepened 2026-05-27 during PYR3-014 attempt.

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
