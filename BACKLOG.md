# 🗃️ pyr3 Backlog

Authoritative task registry. Every task carries a `[PYR3-NNN]` ID (required) and
best-effort flags (optional): `category · size · sigil · status · milestone`.

Two sections: **🔥 Open** (actionable work, ordered by milestone then bugs-first,
newest ID first within a tier) and **✅ Resolved & shipped** (kept for provenance,
newest first). The ship narrative lives in [CHANGELOG.md](CHANGELOG.md); the
strategic arc + current cycle in [ROADMAP.md](ROADMAP.md).

> **Next ID: PYR3-055** — increment when creating a new entry. Never reuse, even for
> shipped/removed tasks. New open entries go at the top of **🔥 Open**; flip an entry
> to ✅ in its header and move it into **✅ Resolved & shipped** when it ships.

## 🔥 Open

## [PYR3-054] feat · S · 💾 · queued · post-v1 — Save-image hints flame name + preset in the filename

**Filed 2026-05-29 (user-directive).** When the user right-clicks the canvas and "Save image
as…", the browser's suggested filename should hint at **the flame name + the preset that was
rendered**, instead of a generic `download.png`. E.g. `electricsheep.247.19679-4k.png`,
`electricsheep.247.19679-preview-q16.png`, or for an Advanced custom render
`electricsheep.247.19679-2048px-q100.png`. Pull the name from the loaded flame's meta and the
preset/quality from the active `QUALITY_TIERS` selection (`src/presets.ts`); fall back to a
plain `<flame-name>.png` when no preset applies. **Implementation note:** a WebGPU `<canvas>`
right-click "Save image" doesn't honor a filename attribute the way an `<a download>` does —
likely needs a download affordance (explicit "💾 save" pill, or a hidden `<a download="…">`
wired to a `canvas.toBlob()` / texture readback) rather than relying on the native context
menu. Confirm the native-menu behavior first before picking the mechanism.

## [PYR3-053] feat · S · 🎲 · queued · post-v1 — "🎲 Surprise me" — random showcase flame on click

**Filed 2026-05-29 (user-directive).** An explicit shuffle action (e.g. a `🎲 surprise me`
pill in the action bar, or a `/v1/random` route) that jumps to a **random flame drawn from
the curated showcase set** — not the whole corpus, so it always lands on a vetted-good flame
(no weak/slow/tier-2 surprises). Deliberately **not** wired to bare-root load: the front door
stays the stable hero (`electricsheep.247.19679`) for brand + share-determinism; randomness is
a chosen click, not a load-time dice roll. Pairs naturally with PYR3-052 (interestingness
scoring) — a "surprise" could bias toward high-interest flames once that index exists.

## [PYR3-052] feat · L · 🐑 · queued · post-v1 — "Interesting flames" scoring + a skip-to-interesting nav mode

**Filed 2026-05-29 (user-directive).** Browsing the corpus with `‹`/`›` (PYR3-041) steps
through *every* id in order — and many adjacent sheep are near-duplicate blobs, so you can
see "the same boring blob 10× in a row." Add a way to find the **more interesting** flames
programmatically and a nav **mode** where `‹`/`›` jump to those instead of the literal
neighbor.

**Interestingness, programmatically (candidates — needs a probe):**
- **Histogram coverage** — % of non-empty density cells; sparse/blob flames score low.
  pyr3 already has the related mean-luminance black-skip in `scripts/build-showcase.mjs`
  and the chaos-coverage metric from the PYR3-034 work — reuse that lineage.
- **Density entropy / variance** — flat or single-spike histograms = boring; spread +
  structure = interesting.
- **Colour variance + edge/detail density** — multi-hue, high-frequency detail scores up.
- Compute cheaply on a tiny **Draft (512) thumbnail** render (we already have the tier),
  then **precompute a per-gen "interestingness index"** baked alongside `avail.flam3idx`
  (an ESF-side or build-step pass), so the viewer just reads scores — mirrors the avail
  manifest pattern (`src/avail-client.ts`).

**Nav mode:** a toggle (e.g. an "✨ interesting" switch by the nav cluster) that makes
`neighbors()` skip to the next id whose score ≥ threshold, using the precomputed index
(or a live skip-ahead sampling pass as a fallback). Default off (literal neighbors).

**Why L / post-v1:** the scoring heuristic needs a real probe (what actually correlates
with "interesting" on the ES corpus?) + likely an ESF-side precompute to be fast at browse
time. Pairs with the corpus-nav trio (PYR3-039/040/041, shipped v0.33).

## [PYR3-051] feat · M · 🎛️ · queued · v1.x — CLI quality parity: tiers + custom dims/quality in the BE

**Filed 2026-05-29 (user-directive).** The quality settings being wired into the FE
(`[PYR3-050]`) must also be available in the **BE CLI** (`bin/pyr3-render.ts`) — the
"single engine, two consumers" principle. `QUALITY_TIERS` already lives in the shared
`src/presets.ts`, so the CLI can consume the same ladder (Draft / Preview / Standard /
High / 4K) plus arbitrary **custom dimensions + quality**, rather than only today's
`--preset {quick,4k}`. Proposed surface: extend the preset flag to accept tier names
(`--preset high`) and add `--long-edge N` / `--quality N` (or `--dims WxH`) for custom
renders, sharing `tierToSpec()` / `applyPreset()` so FE and CLI produce identical dims/
SPP for the same request. Keeps the two consumers in lockstep.

## [PYR3-049] docs · M · 📝 · queued · v1.x — README overhaul

**Filed 2026-05-29 (user-directive).** The root `README.md` has drifted from the
current product and feature set — its `## Status` block trails the live version
(last refreshed ~v0.28; code is now v0.31+), it predates the live public surface
(apex `pyr3.app` viewer + `/showcase` gallery + corpus share-URLs + live 4K render),
and it carries the old `🔥` wordmark rather than the new "hot base" mark story.
Do a full pass: refresh the hero/tagline, the Status block, the feature list
(viewer · showcase · share-URLs · 4K-in-browser · CLI presets), the quick-start,
and the screenshots/links — so a first-time visitor lands on an accurate, current
picture of pyr3. Coordinate with `doc-refresh` if run as part of a broader sweep.

## [PYR3-030] parity · M · 🪨 · queued · v1.x — f64 tonemap precision shim for visualize pass

**Filed 2026-05-27 post Phase-C investigator findings.** Pyr3's `visualize_u32.wgsl`
`calc_alpha` + `calc_newrgb` run in GPU f32. The predecessor (the BE 4K parity reference)
runs tonemap in CPU f64. For high-`brightness` / high-`gamma` fixtures (the 248.22289
class) the f32 precision at the HSV-highpow desaturation roundtrip is a non-trivial
contributor to BE-vs-predecessor divergence.

**Why M:** mechanism is clear — promote the per-pixel post-chaos tonemap to a CPU f64
pass between GPU histogram readback and PNG encode. The chaos game still runs in GPU
f32 (massive parallelism win), but the final per-pixel arithmetic is single-threaded
+ tiny + reasonable to do at f64. Estimated 50-100 LOC port from a CPU f64
reference backend.

**Acceptance:** 248.22289 BE-vs-predecessor R drops measurably (target: -5 to -10 R-units
on its own). The FE↔BE quick-mode gate (PYR3-026) thresholds can be tightened post-
calibration.

**Depends on:** [PYR3-029] should land first (chaos-game fix is the bigger lever; f64
tonemap is the precision-floor secondary).

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

## [PYR3-006] infra · S · 🎨 · queued · v1.x — GitHub Actions CI

Build, typecheck, test on push to any branch. Auto-deploy frontend to `gh-pages` on tag push.
Cache `node_modules` for fast turnaround.

## [PYR3-005] cli · S · 🪨 · queued · v1.x — Single-binary CLI distribution

Ship `pyr3` as a single self-contained executable (Node SEA / pkg / similar) so users don't
need `npm install` or `node` installed on their machine. v1.0 ships with `npm run render`
working; post-v1.0 wraps the same `bin/pyr3-render.ts` into a `pyr3` binary. The underneath
must not change — `Phase 0` proves this seam works.

## [PYR3-003] perf · M · 🎚️ · queued · v1.x — GPU perf characterization

Once v1.0 ships, characterize wall-clock per-fixture on FE (Chrome) and BE (Node). Identify
hot paths in WGSL. Decide whether perf work is worth the engineering cost.

**Partial findings landed (v0.29, via PYR3-027):**
- Each chaos dispatch carries **~44 ms fixed overhead** independent of
  sample count (`wallMs ≈ 20 + 44×dispatches`). The GPU is far from
  saturated at 1M samples — a 100M-sample dispatch still totals only
  ~70 ms, i.e. ~0.7 ms of actual compute per 1M samples.
- Implication: **orchestration shape dominates wall-clock**, not raw
  compute. Fat dispatches amortize the fixed cost; the v0.29 decoupled
  orchestrator (`startDecoupledRender`) exploits this.
- FE (Chrome) and BE (Dawn-node) measured the *same* per-dispatch cost
  (44.1 ms ≈ 44.9 ms) — no Chrome-WebGPU IPC penalty at this granularity.
- Bench tooling: `scripts/pyr3-027-be-bench.ts`, `__pyr3Bench` /
  `__pyr3Decoupled` dev hooks in `src/main.ts`.

## [PYR3-048] infra · S · 🔧 · queued · post-v1 — Dev server can't serve the brotli-dec-wasm `.wasm` → `/v1/gen/{gen}/id/{id}` fails under `npm run dev`

**Symptom (observed 2026-05-29):** Loading a corpus sheep via the
share-URL route on the **dev** server (`localhost:5173/v1/gen/247/id/19679`)
fails with `WebAssembly.instantiate(): expected magic word 00 61 73 6d,
found 3c 21 64 6f` (`3c 21 64 6f` = `<!do` = the SPA `index.html`
fallback). The corpus chunk fetches fine; the failure is decoding it.

**Cause:** Chrome has no native `DecompressionStream("brotli")`, so
`src/brotli.ts` falls back to the lazily-imported `brotli-dec-wasm`
package, which fetches its `.wasm` binary. **Vite's dev server doesn't
serve that `.wasm` at the URL the package requests** → 404 → SPA
fallback returns `index.html` → `WebAssembly.instantiate` chokes on the
HTML magic bytes. **Production / `vite build` is unaffected** — the build
emits + fingerprints the wasm correctly (`dist/assets/brotli_dec_wasm_bg-*.wasm`,
`200 application/wasm`), so the live pyr3.app gen/id viewer works, as does
`npm run preview`.

**Why it went unnoticed:** the gen/id route was only ever exercised via
the deployed site / preview, never under `npm run dev` (corpus chunks
are deploy-baked; see `[PYR3-038]`). For local dev testing, chunks are
now copied into gitignored `public/chunks/` (see the `.gitignore` note),
but the wasm-serving gap remains.

**Likely fix:** add `vite-plugin-wasm` (+ `vite-plugin-top-level-await`
if needed) to `vite.config`, or `optimizeDeps.exclude: ['brotli-dec-wasm']`,
or an explicit dev-middleware that serves the package's wasm with
`application/wasm`. Probe which the package's loader expects (it may use
`new URL('…wasm', import.meta.url)`). Dev-only DX; not a ship blocker.

**Files:** `src/brotli.ts:73` (`loadWasmBrotli`), `vite.config.*`.

Filed 2026-05-29 during the v0.29 4K-button verify (local gen/id test).

## [PYR3-043] parity · M · 🪶 · queued · post-v1 — Optional 4K parity gate vs flam3-C

**Filed 2026-05-29.** The legacy 4K parity gate (its reference-fixture dir +
`src/parity-4k.test.ts`) was dropped during the predecessor-reference scrub — it compared
pyr3 BE 4K renders against the predecessor's v1.1 JPG outputs, a non-canonical reference that
the v0.18 flam3-C ground-truth pivot superseded. The native-dim flam3-C rig (`npm run
test:parity`, 25 fixtures) is the canonical gate and is unaffected.

**Not needed for correctness** — a 4K render is the same chaos game + tonemap at higher
sample/pixel counts, so native-dim parity implies 4K parity. A dedicated 4K gate would only
add a narrow regression guard for dim-scaling / oversample / large-buffer bugs. **If wanted:**
render a handful of fixtures through flam3-C at 4K, calibrate per-fixture thresholds (mirrors
the native rig), and ship as a sibling `npm run test:parity-4k`.

## [PYR3-028] parity · S · 🪶 · queued · post-v1 — Deterministic-seed FE↔BE calibration

**Frame (filed 2026-05-27, post v0.15 PYR3-026 ship):** The FE↔BE parity
gate shipped in v0.15 measures R(FE, BE) with both engines using
`Math.random()` seeds (`renderer.ts:164` defaults; `main.ts:84` browser
side; `bin/pyr3-render.ts` CLI side). Empirically observed run-to-run
variance was tiny (< 1%), so R is dominated by systematic engine drift
not RNG noise — but the calibration leaves a small unmeasured noise
margin folded into `feBeThresholdR`'s 50%+2.0 headroom. A cleaner
mid-term move: thread a deterministic seed through both engines (e.g.,
hash of fixture-id) so R(FE, BE) is purely-engine-drift, then re-
calibrate with much tighter thresholds (probably mul=1.1 + add=1.0).

**Why post-v1.0:** The current thresholds work — gate passes, drift
levels are documented, high-R outliers are already on PYR3-017/021's
investigation list. Tighter thresholds would catch smaller regressions
but the v0.15 gate already catches anything visible.

**Next phase:** Add `--seed N` flag to `bin/pyr3-render.ts`; add a
`__pyr3CapturePixels({ seed })` hook variant OR a `__pyr3SetSeed(N)`
dev hook so the test rig can pin both sides to the same seed. Re-run
calibration; tighten thresholds.

## [PYR3-002] feat · XL · 🪨 · someday · post-v1 — Markov-chain flame generation research

Algorithmic research: train a Markov chain on a corpus of "good" Electric Sheep flames, sample
new flames from the chain, evaluate visual quality. Possibly with variation-arm or
parameter-space embeddings. Open research, not a feature ship.

**Depends on:** editor ([PYR3-001]) so generated flames have somewhere to live + be tweaked.

## [PYR3-001] feat · XL · 🪨 · someday · post-v1 — Visual flame editor

Mutator + vault + recents + undo + landing screen + session persistence — essentially
an earlier prototype's scope, in pure TS (no WASM). Framework choice (React / Svelte / Solid) is itself
a load-bearing decision worthy of dueling agents when pulled forward.

**Depends on:** v1.0 ship-gate pass.

**Why much-later:** the editor is large enough to consume the project. Locking the viewer +
share-link + ship-gate first keeps the v1.0 scope honest.

## ✅ Resolved & shipped

_Kept for provenance. Newest first._

## [PYR3-050] feat · L · 🎛️ ✅ **RESOLVED (v0.34, 2026-05-29)** — Viewer quality control (preset ladder + Advanced custom)

The viewer's action bar (v0.33 three-bar chrome) gained quality control. The standalone
🎯 4K button is replaced by a segmented **tier ladder** — `QUALITY_TIERS` in the shared
`src/presets.ts`: Draft (512/q8) · Preview (1024/q16, = legacy `quick`) · Standard
(1920/q50) · High (2560/q100) · 4K (3840/q200, = legacy `4k`). An **Advanced ▾**
disclosure row adds a custom **long-edge** field (native aspect preserved) + an **SPP**
slider with a **live cost estimate** (`≈ W×H · N MB · ✓ fits / ✗ exceeds limit`) reusing
the v0.29 `maxStorageBufferBindingSize` guard — Render is gated on fit (and on
render-in-flight). The resolved **`dims · q · tier`** shows in the info bar and the active
tier highlights. `main.ts` generalized the old `render4K` into `renderQuality(req)` —
resolving dims/SPP via `applyPreset(tierToSpec | customSpec)` (so the math is shared with
the CLI presets) and driving the v0.29 decoupled orchestrator. The chosen quality is
**sticky** — it persists across corpus nav + file loads (the progress bar is the
heavy-render cue), defaulting to Preview for fast cold browsing. 4608 unit (+ tier tests),
review-hardened (Advanced Render now respects `setBusy`), Chrome-verified across tiers +
custom + the live cost estimate. **CLI parity is `[PYR3-051]`** (still open).

## [PYR3-041 / 040 / 039] feat+fix · 🐑 ✅ **RESOLVED (v0.33, 2026-05-29)** — corpus navigation: prev/next/nearest + graceful missing-sheep state

The corpus-navigation trio shipped together on the new three-bar viewer chrome.
A new cached `src/avail-client.ts` (`loadAvail` fetch+decode of
`/chunks/{gen}/avail.flam3idx` + `neighbors()` prev/next/nearest binary search)
wires `src/avail.ts` into the viewer for the first time.

- **PYR3-041** — the action bar shows clickable `‹ prev` / `next ›` *available*
  sheep on every corpus load; navigation uses History `pushState`/`popstate`
  (no reload) via `loadCorpus(gen,id)`. The sparse corpus is now walkable.
- **PYR3-040** — a missing id surfaces the nearest available sheep either side
  (one-click) through the same nav cluster.
- **PYR3-039** — a missing `/v1/gen/{gen}/id/{id}` keeps the full viewer chrome
  with a graceful in-canvas panel: *"Electric Sheep was not found — use ‹ prev
  or next › to jump to a valid flame."* No welcome-flame swap, no "never born"
  wording.

Also: the single viewer bar was split into **① info + ② action** rows (the
render-progress row ③ unchanged) — the shared chrome the quality control
(`[PYR3-050]`) also rides on. Review fixes: absent (404) manifests are cached;
corpus nav serializes against any in-flight render so the URL/nav never desync
from the canvas. 4601 unit (+ avail-client tests) green; Chrome-verified browse
+ miss + recovery.

## [PYR3-020] feat · M · 🐛 ✅ **RESOLVED-BY-REMOVAL (v0.32, 2026-05-29)** — legacy `?flame=` share-link codec removed

The `?flame=<inline-encoded>` share link (whose decode failed on ~6KB+ payloads —
the original bug) is **removed entirely** rather than fixed: it was superseded by the
v0.24 corpus share-URL `/v1/gen/{gen}/id/{id}` (user-directive 2026-05-29). Deleted
`src/url-codec.ts` + its test, the `flame` `LoadIntent` kind + `?flame=` parse in
`src/load-intent.ts` (+ tests), the `case 'flame'` handler + import in `src/main.ts`,
and the now-vestigial `LoadResult.sourceText` field in `src/loader.ts` (it existed only
to feed the encoder). `/v1/flame/{token}` custom-reserved is untouched (separate future
mechanism). VISION + `docs/corpus-share-url.md` updated. typecheck + 4587 unit green.

## [PYR3-045] feat · S · 🐑 ✅ **RESOLVED (v0.31, 2026-05-29)** — Showcase cards link to the viewer via `/v1/gen/{gen}/id/{id}`

Each `/showcase` card now carries a prominent **▶ Open in viewer** pill linking to the
live viewer for that exact sheep via the v0.24 corpus share-URL. `scripts/build-showcase.mjs`
parses the `electricsheep.{gen}.{id}` fixture id and emits a base-relative
`../v1/gen/{gen}/id/{id}` href (leading-zero segments normalized to the canonical numeric
ids the chunk map is keyed by). Thumbnail keeps its 4K-image zoom; the pill is the viewer
affordance. Verified end-to-end in Chrome (card → viewer renders the sheep). Realizes the
click-to-load story (`[PYR3-007]` Chunk 2) on the now-shipped share-URL router.

## [PYR3-044] feat · XS · 🎨 ✅ **RESOLVED (v0.31, 2026-05-29)** — Favicon redesign → the "hot base" mark

The orange-triangle favicon (read as a caution/warning sign) is replaced by the **"hot base"**
mark: a double-arm vortex flame (teardrop body + black attractor-spiral heart) with an
amber→crimson vertical gradient (`#ffbe3e → #bf2408`). Designed via a 5-round
drawing-driven brainstorm (gallery archived in `.remember/verify/`). Shipped as an inline
SVG data-URI (base-independent) across `index.html`, `scripts/build-showcase.mjs`, and the
three `public/help/*.html` pages. The same mark also **replaced every `🔥`/`▲` brand mark**
(viewer wordmark, showcase hero, about-page H1) for one consistent identity. Verified in
Chrome at 16–128 px on light + dark tabs.

## [PYR3-042] feat · S · 🎨 ✅ **RESOLVED (v0.31, 2026-05-29)** — Showcase reachable from the main viewer

The viewer top bar gains a **showcase** link in its left zone (next to `about`, same
internal-nav style), pointing at the base-aware `showcase/` gallery. Pairs with `[PYR3-045]`
(the reverse link) to make viewer ↔ gallery navigation bidirectional. Verified in Chrome.

## [PYR3-047] infra · S · 🔧 ✅ **RESOLVED (2026-05-29)** — `/showcase` 404 under Actions deploy + repo de-bloat

> **✅ Resolved 2026-05-29 (same day as discovered), shipped v0.27.** The
> `/showcase` gallery silently 404'd after the v0.26 CI-deploy switch: it lives
> under gitignored `public/showcase/` (~221M), which the old local `dist/` push
> copied into the artifact but the clean-clone Actions build never has. Fix:
> publish the gallery as a tar Release asset (`showcase-2026-05-29` on
> `MattAltermatt/pyr3`) and have `deploy.yml` fetch→cache→untar it into
> `dist/showcase/` — mirrors the corpus-chunk block; bump `SHOWCASE_RELEASE_TAG`
> to ship a regen. Also de-bloated: `git filter-repo` purged ~402M of orphaned
> binaries (old showcase `*.jpg` + `*.flam3chunk`) from all history, `.git`
> 603M→41M; `gh-pages` deleted. Verified live in Chrome. **Standing rule: deploy
> artifacts ship as Release assets, never committed to git.**

**Discovered 2026-05-29.** Live `pyr3.app/showcase` returned 404 across every path
variant while `/` was fine. Root cause: the v0.26 switch from manual local-`dist`
force-push to the GitHub Actions clean-clone build invalidated the v0.21 "heavy
images gitignored + deploy-only" assumption — gitignored assets never reach the CI
artifact. Surfaced a second dead-weight problem: ~395M of orphaned showcase JPEGs +
corpus chunks sitting in git history from superseded approaches.

## [PYR3-046] infra · XS · 🔧 ✅ **RESOLVED (2026-05-29)** — Bump deploy-workflow actions to Node 24 support

> **✅ Resolved 2026-05-29 (same day as filing).** Bumped to Node-24 majors:
> `checkout@v6`, `setup-node@v6`, `cache@v5`, `upload-pages-artifact@v5`,
> `deploy-pages@v5`. Verified each is `using: node24` (or composite wrapping it) with
> no breaking input changes for our usage; the post-bump deploy run is green with
> **zero** Node-20 deprecation annotations.

**Filed 2026-05-29.** The v0.26 deploy run emitted a non-blocking annotation: the
pinned `actions/{checkout,setup-node,cache,upload-artifact}@v4` run on Node.js 20,
which GitHub forces to Node 24 by **2026-06-16** and removes from runners by
2026-09-16. No breakage today; bump to whatever majors support Node 24 before the
cutoff (or set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` as an interim). Pure
maintenance, low urgency.

## [PYR3-038] infra · M · 🔧 ✅ **RESOLVED (v0.26, 2026-05-29)** — CI deploy automation for corpus chunks

> **✅ Resolved v0.26.** `.github/workflows/deploy.yml` auto-deploys `pyr3.app` on
> push to `main` via `actions/deploy-pages`: build → download the chunk tar from the
> public electric-sheep-fold Release (default `github.token`, no PAT) → bake into
> `dist/chunks` → upload Pages artifact. Pages source flipped branch → "GitHub
> Actions" (domain + HTTPS survived; `gh-pages` kept as rollback). Both sub-decisions
> closed: source = `actions/deploy-pages` (settled by dueling agents), and the ESF
> Release dependency is met (chunk tar published to the `2026-05-23` tag, pinned via
> `CHUNK_RELEASE_TAG`). Verified live end-to-end. See CHANGELOG v0.26.

**Filed 2026-05-29 (user-directive — "we will do that soon").** Automate the
currently-manual build → bake-chunks → force-push-`gh-pages` deploy. Needs: (a) a
published `electric-sheep-fold` Release carrying `corpus-chunks-{date}.tar` so CI can
`gh release download` it (a GitHub write action — user-gated); (b) a Pages-source
decision — keep the `gh-pages`-branch force-push (e.g. `peaceiris/actions-gh-pages`)
or switch to `actions/deploy-pages`. Until then the manual command block (in the
deploy runbook / corpus-share-url notes) is the path.

## [PYR3-037] feat · M · ✅ **RESOLVED (v0.23, 2026-05-28)** — About page rewritten to single-product identity

> **✅ Resolved v0.23 — pulled forward into the FE-polish session.** Rather than
> defer, the user pulled this forward mid-verify. `help/about.html` was rewritten
> from the inherited two-product framing (browser viewer vs a separate desktop
> renderer) into pyr3's real single-product
> identity: **one TypeScript + WebGPU engine, two consumers** (browser viewer +
> headless CLI), in the flam3 lineage. The "pyr3 family" list collapsed to
> **pyr3 / ESF / flam3** (the bogus desktop entry removed), the two-column layout
> now aligns, and outbound links go to electricsheep.org + the flam3 repo. The
> editor/mutator is framed as roadmap, not a separate existing product.

**Filed 2026-05-28 (user-directive during the v1.0 FE-polish brainstorm).** The
v1.0 FE polish pass adds a quiet `about` link to the bar (left zone, between the
🔥 pyr3 wordmark and the flame name) pointing at `help/about.html`. That page is a
Phase-0 wholesale copy from the prior TS+WebGPU viewer — its branding is being corrected to "pyr3"
in the FE-polish pass, but the **content + design were never reconsidered for
pyr3's own v1.0 story** (showcase gallery, flam3-C ground truth, the single-engine/
two-consumers architecture, the Electric Sheep lineage). This entry is a dedicated
session to brainstorm what the About page should actually *say and look like* as
pyr3's public front-door explainer — not just a rename.

**Why its own session:** the FE-polish pass only rebrands the page (mechanical);
the real "what should About communicate, and how should it look" question is a
fresh design problem deserving its own brainstorm + spec. Surfaced here so the
"but eventually" thinking isn't lost.

**Load-bearing finding from the v0.23 rebrand (must fix here):** the mechanical
prior-viewer→pyr3 swap exposed that `about.html` was written around a **two-product
worldview** — the prior viewer = the browser viewer, and a *separate* "pyr3" = a
desktop renderer + editor. After the swap both are
named "pyr3", so the copy is now self-contradictory: the "pyr3 family" list has two
entries both labeled pyr3, and sentences like "the canonical f64 anchor stays in
pyr3 (the desktop renderer)" no longer parse against the single-product reality.
The rebrand left these grammatically valid but semantically wrong (deliberately —
collapsing the framing is content work, not a rename). This redesign MUST collapse
the two-product story into pyr3's actual single-product identity (one TS+WebGPU
engine, two consumers: browser viewer + headless CLI).

**Acceptance:** About page content + layout designed from pyr3's v1.0 narrative
(not inherited from the prior viewer); consistent visual language with the polished
viewer bar; links to showcase gallery + source repos where natural.

## [PYR3-036] chore · M · ✅ **RESOLVED (v0.22, 2026-05-28)** — variation-import safeguards (loud parser + reachability + corpus assertion)

**Filed + shipped 2026-05-28** after the PYR3-034 audit showed a known variation could be
silently dropped at import with nothing going red. Three safeguards in `flame-import.ts` +
`flame-import.test.ts`:
1. **Loud parser** — `KNOWN_PARAM_ATTRS` (derived from `VARIATION_PARAMS`) lets the xform scan
   tell a recognized `<var>_<param>` apart from an attribute it doesn't understand; the latter
   now surfaces in `report.droppedVariations` instead of being silently swallowed.
2. **All-99 reachability test** — every variation in `V` is parsed via a minimal flame and
   asserted recorded with the right index + weight (would have failed loudly on the 6 dropped
   underscore variations).
3. **Curated-corpus assertion** — every `fixtures/flam3-goldens/<id>` parity fixture must import
   with zero dropped/unrecognized attrs (ALLOWLIST documents any genuine unsupported attr).

**Audit findings (read-only sweep over the full electric-sheep-fold corpus, ~166k flames):** the
drop hit **six** variations (`radial_blur`, `gaussian_blur`, `pre_blur`, `super_shape`,
`wedge_julia`, `wedge_sph`), not three. Two genuinely-unsupported attrs surfaced and are
*correctly reported* (not silent): `move` (Apophysis variation pyr3 doesn't implement) and
`secant` (likely an un-aliased name for `secant2`). **Sub-item decided (2026-05-29):** alias
`secant`→`secant2` — it's an un-aliased synonym, so a one-line addition to the alias table
plus a parse-reachability test. Scheduled into the v1.0 cleanup session (bundled with
PYR3-032); non-urgent since no curated fixture uses it.

## [PYR3-035] chore · M · ✅ **RESOLVED (v0.22, 2026-05-28)** — re-rendered the showcase 4K set after the PYR3-034 variation-drop fix

> **✅ Done v0.22.** Re-rendered all **13** affected showcase fixtures (the six underscore
> variations: gaussian_blur/radial_blur/pre_blur + super_shape on 243.06888 & 243.12778) and
> rebuilt the gallery (54 cards). `243.06888` (super_shape) now **surpasses the predecessor
> reference**, which was too dark. Heavy PNGs stay gitignored/deploy-only.


**Filed 2026-05-28 (follows [PYR3-034] fix, v0.22).** The flame-import underscore-variation
drop bug silently zeroed `radial_blur` / `gaussian_blur` / `pre_blur` corpus-wide, so every
pre-fix showcase 4K render of a fixture using one of those variations is WRONG (most visibly
`electricsheep.243.00171`, which lost its entire halo). Re-run
`scripts/render-showcase-v1.0.mjs` (~9 min) to regenerate
`fixtures/showcase-v1.0/<id>.pyr3-4k.png`, then rebuild the gallery (`npm run build:showcase`).
Spot-check affected fixtures against their electricsheep.com references.

**Acceptance:** showcase renders reflect the post-v0.22 engine; no fixture renders as bare
filaments / black due to a dropped variation. (Scope: `git grep -lE
'radial_blur|gaussian_blur|pre_blur'` over the 55 source `.flam3` files names the affected set.)

## [PYR3-034] bug · L · ✅ **RESOLVED (v0.22, 2026-05-28)** — flame-import silently dropped underscore-named variations (`radial_blur`); `243.00171` halo restored

> **✅ RESOLVED v0.22.** Root cause: `flame-import.ts` split every xform attribute name on
> the first `_` (the `<var>_<param>` param convention) BEFORE checking the full name against
> the variation table — so variation names that themselves contain an underscore
> (`radial_blur`, `gaussian_blur`, `pre_blur`, `super_shape`, `wedge_julia`, `wedge_sph`) were split to a non-variation head
> (`radial_blur` → `radial` ∉ V) and **silently dropped**. On 243.00171, xform0 lost its
> `radial_blur=0.5` and ran `linear=0.05` alone, collapsing the orbit onto the spherical
> 2-cycle (0.43% coverage). **Fix:** test `name in V` before the underscore split in
> `parseXformElement`. Coverage 0.43% → 55% (18,501 → 2,346,734 nonzero), matching flam3-C
> within ~1%; 25/25 parity + 4512 unit green; +2 regression tests in `flame-import.test.ts`.
>
> **The precision / df64 framing throughout the rest of this entry was WRONG.** A CPU
> f64-vs-f32 oracle of the exact map gave identical coverage in both precisions — the map was
> missing a variation, not losing precision. df64 NOT needed; GPU-only/f32 stance holds. The
> fma experiments correctly exonerated rounding; the per-iter trace + genome read (radial_blur
> output ≡ `linear × 0.05`, i.e. contributing zero) pinned it. Follow-up: [PYR3-035].

> **Title corrected 2026-05-28** from "pyr3 crushes low-density regions to black" —
> investigation showed the halo is *absent from the histogram* (chaos game), not
> crushed by tonemap. Original symptom framing kept below for the record.
>
> **PRIORITY RAISED → v1.0 BLOCKER (user-directive 2026-05-28):** "the entire goal of v1
> was to get as close to parity with flam3 and the predecessor renderer, and we have to do that." Target
> image: `https://electricsheep.com/archives/generation-243/171/0.jpg`. **df64 (double-float)
> emulation is SANCTIONED** ("if we need to emulate 64 bit, then we do that") — relaxes the
> "GPU only / accept f32 floor" stance for this fix. Next-session plan: see
> [[project-pyr3-034-next-session]] (ordered: fma-contraction test → pyr3-f32 vs predecessor-f32
> trace → port the predecessor's `df64.glsl` to WGSL). All diagnosis on branch `feature/pyr3-034-lowdensity`.

**Symptom (observed 2026-05-28):** pyr3's `--preset 4k` render of
`electricsheep.243.00171` shows ONLY the bright filament skeleton (thin orange/
blue/green lines) on pure black (mean lum 0.68, ~2% non-black). The reference
render — `https://mattaltermatt.github.io/pyr3/v1.0/electricsheep.243.00171.gpu.4k.jpg`
— shows a **rich soft blue halo / nebula filling the whole frame**, with the bright
orange feather nested inside it. pyr3 is dropping the entire low-density glow; only
the high-density structure survives.

**Investigation 2026-05-28 (root cause localized to the chaos game, NOT tonemap):**

Ruled OUT tonemap/DE/gamma and a mis-ported variation:
- **Histogram dump (`npm run hist`, full quality, native dims w/ supersample=3):**
  `nonzero=18460 / total_pixels=4262400` → only **0.43% of buckets are nonzero**.
  `sum_count=24.15e9`, `max_cnt_per_px=1.50e9` (one pixel holds ~6% of ALL samples),
  `mean_cnt_nonzero=1.3e6`. So 24 billion samples land in just 18,460 pixels — the
  trajectory iterates fully but is **confined to a tiny invariant set**; the wide
  halo's low-count pixels are flat ZERO in the histogram.
- Therefore it is NOT tonemap/gamma/DE: density estimation cannot lift bins that are
  zero, and gamma=5 / gamma_threshold=0.01 can't recover absent samples. The earlier
  "low-density crush" framing was wrong — the low-density region is never deposited.
- The flame has 2 xforms: xform1 `radial_blur=0.5` (the blurred-arc halo), xform2
  (dominant, weight 2.5) `spherical=2.25` (the 1/r² core). pyr3 keeps the spherical
  core, loses the radial_blur halo.
- **Verified faithful ports** (so the bug is not a simple formula error):
  `var_radial_blur` matches flam3 `var36` (rndG = w·(4·rand−2), spinvar/zoomvar =
  sin/cos(angle·π/2), RNG draw count + left-to-right order); `var_spherical` matches
  (`p·w/(r²+EPS)`); bad-value handling matches flam3 (`is_bad = NaN || |p|>1e10` →
  reseed to random [−1,1], retry ≤4×, skip splat); camera framing correct (the core
  is positioned as in the reference).

**f32 EXONERATED (2026-05-28):** The reference render is the predecessor's `GpuF32Backend`
— **also f32** — and it paints the full halo. So this is NOT an f32-precision floor;
pyr3 has a *structural divergence* from a working f32 GPU chaos game. (Supersedes the
"f32 floor" hypothesis above.)

**Structural divergence found — pyr3 vs the predecessor's chaos game:**
- **xform pick:** the predecessor uses a cumulative-weight LINEAR SCAN over `pickTable[64]`;
  pyr3 (post-`[PYR3-029]`) uses flam3's 14-bit `xform_distrib` GRAIN table. Different
  pick sequences for the same RNG state.
- **walker color init:** the predecessor seeds color with `rand01()`; pyr3 seeds `0.0` with NO
  rng draw (PYR3-029 Phase-5 change to match flam3's stream). Shifts the whole ISAAC
  stream by one draw per walker vs the predecessor.
- Net: pyr3 was rewritten to **bit-match flam3-C's RNG stream**; the predecessor never was.

**RESOLVED TO DIAGNOSIS (2026-05-28, 4-way render + histogram):**
`.remember/verify/pyr3-034-243-3way.html`.

```
                       nonzero      coverage   mean_cnt/nonzero   halo?
flam3-C (ground truth) 2,373,856    52%        10,133             YES
predecessor GpuF32Backend  (f32 GPU) —          —                  YES
pyr3 current            18,460      0.43%      1.30M              no
pyr3 pre-PYR3-029       18,524      0.43%      1.30M              no
```

- **flam3-C HAS the halo (52% coverage).** Since flam3-C is pyr3's ground truth, pyr3
  is **genuinely broken** here — NOT "correct to ground truth." The predecessor reference is right.
- **PYR3-029 is NOT the cause.** The pre-PYR3-029 engine (commit `5191ee4`, original
  prior-viewer scan + random-color chaos game) renders IDENTICALLY broken (0.43%). Reverting
  the PYR3-029 work does not help — the bug predates it and lives in the **prior viewer's chaos game**.
- **Not f32** (the predecessor's GPU is f32 too). **Not tonemap/DE** (halo absent from histogram).
  **Not a mis-ported variation** (radial_blur/spherical verified).

**Root-cause mechanism (leading, high-confidence):** flam3 and pyr3 distribute the SAME
total samples completely differently — flam3 spreads over ~128× more pixels (2.37M vs
18.5K). flam3 renders in many short **sub-batches**, each starting from a FRESH random
point + short fuse, so it captures the *transient* paths (the halo arcs are transients
on the way to/from the dense attractor). pyr3's prior-viewer walkers run **one long
continuous orbit** (single fuse, then `iters_per_walker` plots) → they settle onto the
dense attractor and never re-traverse the transient halo. Net: pyr3 paints only the
attractor core; flam3 paints attractor + transients.

**Walker-structure theory DISPROVEN empirically (2026-05-28):**
- pyr3 & the predecessor share the SAME budget algorithm + constants (TARGET_WALKERS=1024,
  MIN_ITERS=4096, MAX_ITERS=1048576). For this flame both pick **1024 walkers ×
  92,500 iters** — neither re-fuses periodically (the predecessor's loop is also single-fuse).
- Forcing more/shorter walkers via `pyr3-hist --walkers {16384,65536,262144}` did NOT
  raise coverage — it went 18.5K → ~10K nonzero (worse), and the **1.5e9-counts-in-one-
  pixel spike is invariant to walker count**. So orbit-length / f32-trapping is NOT it.
- pyr3 **correctly discards** out-of-bounds splats (`chaos.wgsl:1843` bounds-check, no
  edge-clamp) → the spike is a legitimate in-bounds dense-core pixel. flam3-C's own max
  is ~1.1e9 — the dense **core is correct in both**. The ONLY difference is halo
  coverage: flam3 hits 2.37M pixels, pyr3 18K.

**Ruled out so far:** f32 precision (predecessor f32 works), tonemap/DE (halo absent from
histogram), variation formulas (radial_blur/spherical text-match flam3), xform-pick
mechanism (pre-PYR3-029 scan logic equally broken), walker count/orbit length (swept),
out-of-bounds clamp (discards correctly), camera (core positioned right).

**Remaining: the trajectory itself explores less than flam3-C's, same RNG budget.**
Only a step-by-step diff will pin it.

**Deep-dive 2026-05-28 (full hypothesis space eliminated):** pyr3's f32 iteration
converges to a ~18K-pixel invariant set; flam3-C AND the predecessor (both f32-capable) fill 2.37M
(52%) — a ~128× attractor-size gap on the SAME 2-xform IFS (xform0 linear+radial_blur,
xform1 linear+spherical w=2.25). Eliminated, each with evidence:
- **picks** — pyr3 82% / flam3 84% spherical over 1000 iters: match (pick mechanism fine).
- **spherical + EPS** — `p·w/(r²+1e-10)` identical in pyr3, the predecessor (`chaos.comp:514`),
  flam3 (`private.h:47`). Verified.
- **variation summation** — trace confirms `pv = spherical(pa) + 0.001·linear(pa)` to the
  digit; both vars summed correctly.
- **bad-value reseed** — `isBad=0` across walker-0's 1000 traced iters; never fires.
- **camera/scale/rotate** — zooming OUT (scale 21.8→4) gave FEWER pixels (2900), so halo
  points are in-frame, not clipped. Not a projection bug.
- **walker count / orbit length** — swept 1024→262144, coverage flat/worse; 1.5e9-in-one-
  pixel invariant. Neither pyr3 nor the predecessor re-fuses (same single-fuse loop).
- **f32 precision class** — the predecessor's `GpuF32Backend` (f32) renders the full halo.
- **out-of-bounds** — pyr3 discards correctly (`chaos.wgsl:1843`), no edge-clamp.

**The gap is emergent f32 dynamics** (pyr3's invariant set ≠ the predecessor's, both f32) — the
only thing not yet bisected, because the decisive tool is BLOCKED:

**BLOCKER — aligned per-iter trace unavailable.** `bin/pyr3-trace.ts` emits the
`[iter pick pax pay pvx_pre pvy_pre pvx pvy isBad]` schema; the local
`flam3-render-32bit-isaac-rngtrace` binary is STALE — it emits the OLD
`[xformPick pvxMag pvyMag isBad drawCount]` format. The current `flam3.c:363` source DOES
emit the new schema (+ `isaac_seed_hex`, `flam3.c:2594`) but isn't compiled.
[[reference-flam3-c-local-build]] warns: "Do not rebuild without reviewing the diff first
— the existing binaries are the canonical reference; the uncommitted .c edits are the spec."

**(A) aligned trace DONE 2026-05-28 — non-diagnostic, here's why:** No rebuild needed —
`flam3-render-32bit-isaac-rngtrace-v0.9` already emits the `pax/pvx_pre` schema + accepts
`isaac_seed_hex`. Ran pyr3-f32 vs flam3-v0.9 with aligned ISAAC. They diverge ~1% by the
first traced (post-200-fuse) iter (pyr3 pax=-2.6016 vs flam3 -2.6262). **But this is f32-vs-
f64 chaotic divergence, NOT a localizable bug:** the working predecessor-f32 engine would
diverge from flam3-f64 identically — a walker-0-vs-f64 trace cannot distinguish the good
f32 engine from the bad one. So the aligned-trace-vs-flam3 approach is a dead end for THIS
bug (it was the right tool for PYR3-029's RNG-stream-alignment question, wrong tool here).

**Sharpened conclusion:** the 128× attractor-SIZE gap (52% vs 0.43%) is NOT typical f32
rounding sensitivity — two valid f32 engines yield similar-size attractors with different
exact pixels, not a 128× size collapse. This implies a **qualitative, likely WGSL-specific
difference** (fma contraction / op-order / a subtle WGSL-vs-GLSL f32 semantic) that makes
pyr3's f32 dynamics fall onto a tiny attractor where the predecessor's f32 stays ergodic.

**Only remaining isolation path:** trace **pyr3-f32 vs predecessor-f32** (both f32) — requires
building + instrumenting the JVM+Vulkan predecessor's `GpuF32Backend` to emit a comparable
per-iter / histogram trace, then diffing. Substantial cross-repo tooling; realistic chance
the root cause is WGSL fma/rounding that is hard to fully control. **Next phase decision:**
- (B) Manual line-by-line pyr3 `chaos.wgsl` vs the predecessor's `chaos.comp` f32-arithmetic audit of
  the full iteration (affine coef→a0/a1 mapping, op order, fma, color/post). Large, no tooling.
- (C) Accept as an f32-attractor casualty: drop `243.00171` + `242.01373` from the curated
  showcase, ship v1.0 without them, leave PYR3-034 open for a dedicated session.

**Next phase (pick one):**
- **(confirm)** Run the existing bilateral RNG trace `bin/pyr3-trace.ts` on this flame
  (pyr3 f32 vs flam3-C f64, seeds aligned) — does the trajectory diverge within a few
  iters as PYR3-029's 02226 trace showed? If yes → confirmed f32-floor, and per
  "GPU only / no CPU path" + the v0.19 accepted-floor decision, the pragmatic
  resolution is **(accept)** drop `243.00171` + `242.01373` from the curated showcase
  as f32 casualties (the showcase auto-skip already hides 242.01373).
- **(only if a broad class)** If a sweep shows MANY showcase flames are similarly
  confined, that's a real v1.0 showcase-quality blocker worth an f64/compensated
  spherical experiment despite the GPU-only guardrail. Quantify first: re-run the
  showcase build's luminance scan + spot-check N fixtures vs their reference URLs
  before committing to engine work.

## [PYR3-033] bug · M · 🐛 ✅ **RESOLVED (v0.30, 2026-05-29)** — flames with >32 xforms render pure black (`MAX_XFORMS` overflow); `electricsheep.242.01373` was the type specimen

> **✅ FIXED v0.30.** Raised `MAX_XFORMS` 32 → 128 (`src/genome.ts`) + matched
> `MAX_XFORMS_U` in `chaos.wgsl` (xaos stride / distrib fallback row) + added a
> flame-import **clamp guard** (`>MAX_XFORMS` xforms → clamp + `report.clampedXforms`
> + `console.warn`, so it degrades to "fewer xforms," never silent-black again).
> `242.01373` (54 xforms) now renders: BE mean-lum **0.00 → 29.6** (flam3-C 23.3),
> FE Chrome shows the blue 6-fold lattice. Verified: 4602 unit (+ buffer-fit
> regression + clamp/guard tests), 25/25 parity, code review clean. Root-cause
> analysis preserved below.

> **✅ ROOT CAUSE FOUND (2026-05-29).** NOT a camera/tonemap/DE issue and NOT
> self-fixed by the v0.22 variation fix — it's a hard **xform-count cap**.
> `MAX_XFORMS = 32` (`src/genome.ts:263`); the chaos xforms buffer is sized
> `(MAX_XFORMS + 1) × XFORM_BYTES` = 33 × 464 = **15312 bytes**. `242.01373` has
> **54 xforms + 1 finalxform**, packing to **25520 bytes** → the `queue.writeBuffer`
> for `pyr3.chaos.xforms` **overflows and Dawn silently rejects the write**
> (`Write range (size: 25520) does not fit in [Buffer "pyr3.chaos.xforms"] size
> (15312)`). The pipeline then iterates against empty/stale xform data → **zero
> samples deposited → pure-black image**, with no error beyond the validation
> log. Confirmed 2026-05-29 via `npm run render` (BE threw the validation error;
> see also FE 4K → black). **flam3-C renders the same flame fine** (698 KB PNG,
> 817 K nonzero buckets) — so this is a genuine pyr3 bug, not a bad showcase pick.

**Impact:** ANY flame with >32 xforms renders black — not just at 4K, at *every*
dim (the cap is on xform count, independent of resolution / oversample).
Rotationally-symmetric Electric Sheep flames routinely exceed 32 (242.01373 is a
6-fold-symmetric flame: ~9 base xforms × 6 rotations). The failure is **silent**
(console validation log only), so other corpus sheep may be quietly black too —
worth a corpus-wide scan for `<xform` count >32 when fixing.

**Fix (queued, not yet done — deferred 2026-05-29 per user):** raise `MAX_XFORMS`
to comfortably cover symmetric flames (e.g. 64 or 128) and confirm the matching
bound in the WGSL chaos shader's xform array + the xform-distribution buffer
(`(MAX_XFORMS + 1) rows × 16384 × u32`, ~528 KB at 32 → scales linearly). Pair
with a **loud guard**: the importer should clamp-or-reject + warn when a genome
exceeds the cap (ties into the PYR3-036 loud-parser safeguard) so this can never
silently black-render again. Add a regression fixture (a >32-xform flame) that
asserts non-black output.

**Original framing (now superseded):** observed v0.21 as a single black 4K
showcase render (mean lum 0.00), auto-excluded by the showcase mean-luminance
gate; hypothesized as camera-off-frame or tonemap/DE collapse. Root-caused
2026-05-29 during the PYR3-025/033 4K re-test probe.

## [PYR3-032] chore · M · ✅ **RESOLVED (2026-05-29)** — Purge predecessor-repo references from the codebase

**✅ Resolved by a working-tree scrub (2026-05-29).** A pass removed all
references to the non-public predecessor projects from the working tree —
docs, source provenance comments, fixture/agent tooling, and manifest source
paths — and excluded internal scaffolding from the public repo. The public
**flam3** lineage (the original C engine) stays. Git history + the CHANGELOG
narrative are left intact as the factual record.

## [PYR3-031] feat · M · ✅ **RESOLVED (v0.23)** · v1.0 — FE cleanup pass before public ship

**✅ FE-cleanup slice done (v0.23):** The v1.0 FE-polish pass rebuilt the top
bar into a single slim row, which swept the vestigial `setLoading` /
status-pulse wiring and the `.pyr3-bar-btn-accent` CSS. The Share button was
removed (url-codec + inbound `?flame=` decoding kept intact). No stale TODOs
remained to clear. The companion brainstorm-and-rebuild of the About page was
tracked separately as `[PYR3-037]` — **also resolved in v0.23**, so this entry is now
fully closed (no residual).

**Filed 2026-05-28 (user-directive during v0.20 impl):** Before pyr3
goes public via the GitHub repo replacement (CLAUDE.md decision #7) and
the showcase gallery ships at `mattaltermatt.github.io/pyr3/v1.0/`,
sweep the browser viewer (`src/main.ts`, `src/ui-bar.ts`,
`src/render-orchestrator.ts`, `index.html`, surrounding modules) for:

- **Dead code** accumulated through v0.x experiments (probe wiring,
  debug panes, removed-feature shims like the deleted 4K button's
  vestiges).
- **Stale comments / TODOs** that reference work now closed (PYR3-017,
  PYR3-021, PYR3-024 — all superseded; PYR3-029 — closed in v0.19).
- **UI affordances** that exist but don't serve v1.0's curated story
  (cycle-palette dev button? overlay panes? hotkeys that aren't
  surfaced anywhere?).
- **CSS / `index.html`** for layout polish before a public eyeball lands.

**Why M:** Scope is "audit + targeted cleanup" not "redesign". One
focused pass through the FE files; identify a punch list; apply each
fix; verify renders still match BE quick-mode at parity-gate
thresholds (must not regress PYR3-026).

**Acceptance:** No regression in `npm run test:parity-fe-be` (25/25
green at v0.19 thresholds); subjective FE QA pass (chrome-devtools-mcp
through 3-5 fixtures including the welcome flame; mute audio; check
console for warnings); deletable code deleted.

**Why v1.0-gating:** Public ship is irreversible reputation-wise. The
cleanup pass is cheap (likely 2-4 hours session) and high-leverage —
shipping with vestigial UI / dead code reads as unfinished.

## [PYR3-029] parity · L · ✅ resolved (f32 floor accepted in v0.19) — Sample-budget + post-chaos pipeline parity audit (root cause of PYR3-017/021/024 divergence)

**v0.19 closure (2026-05-28):** Resolved as **accepted-as-floor**. After
Phases 1–5 ported every flam3-canonical chaos-engine algorithm we could
identify (rand transforms, walker-init RNG draw count, 14-bit
`xform_distrib` table, bilateral RNG-aligned trace), `R(coverage.248.02226)
≈ 29.91` was unchanged. The bilateral trace at `bin/pyr3-trace.ts` proves
picks match at iter 0 when seeds are aligned but trajectories diverge by
iter 1 due to GPU f32 vs CPU f64 precision in the variation kernels.
v0.19 bakes this into the parity contract via the tier-1/tier-2 schema
(see CHANGELOG v0.19): 14 Tier-1 fixtures pass at R<5; 5 Tier-2 fixtures
(247.28068, 244.82986, 243.04616, 245.06687, 02226) pass at `expectedR +
1.0` with documented `engine-precision-drift, not regression` notes. The
Phase 6 framing below stays as a future-research note — if a contributor
ever picks up the per-variation f64 reference impl + variation
bottleneck locate, that work would file a fresh ID. **What would reopen
this:** a successful per-variation f64 reference impl that drops one or
more Tier-2 fixtures into Tier-1 range; that fix would supersede the
v0.19 tier label and tighten the v1.0 contract.

---

**Filed 2026-05-27 post Phase-C investigator findings.** Supersedes the
palette/tonemap/density hypothesis for `[PYR3-017]` / `[PYR3-021]` /
`[PYR3-024]`.

### 🚨 Phase 1 finding (2026-05-28): chaos-game hypothesis falsified

`bin/pyr3-hist.ts` + `scripts/pyr3-029-bucket-diff.mjs` cross-fixture diff
across the 19-fixture parity corpus shows **Pearson 0.030** between
chaos-game chromatic-distribution drift and `baselineR`. 17/19 fixtures
have maxDrift < 3%; the high-R outlier (02226, R=32.62) has only 2.9%
drift; no correlation with R at all. Phase C's claimed `1.442` ratio on
02226 was a raw-sum miscompute — the actual normalized ratio is `1.029`.

Full data: `.remember/tmp/pyr3-029-ratio-table.md` (gitignored).

### Re-framed investigation arc

- ❌ **Walker-init / bad-iter rollback / finalxform RNG / color-contraction**
  (the four sub-hypotheses below) are all deprioritized — they predict
  chaos-game chromatic drift that the diagnostic does NOT see. Phase 1
  also confirmed flam3's `i -= 4 + i += 4` nets `i` unchanged on bad iter,
  matching pyr3's `i -= 1 + i += 1` — the BACKLOG sub-hyp #2 comment was a
  misread of flam3.c:287/320.
- ⚠️ **Sample-budget mismatch is a moderate contributor (Pearson 0.488)
  but not the dominant lever.** pyr3 has 27% more in-bounds splats than
  flam3 on 02226 (because 1024 parallel walkers vs flam3's single chain
  produces tighter attractor coverage). Counter-examples — 247.20817 has
  sampleRatio +34% but R=3.11; 243.04616 has sampleRatio +3% but R=11.55
  — so sample-budget alone can't explain the corpus.
- ❌ **Calibration k2 compensation does NOT fix R.** Sweeping
  `--sample-inflate=0.789..3.0` on 02226 moves R only ~1.3 across the
  4× range; deep in the low-density regime (count × k2 ≈ 0.01) the
  log curve is approximately linear, so k2 changes are not the lever.
- ✅ **The predecessor golden is reasonably faithful to flam3-C.** 3-way R cross-
  check (`pyr3<>flam3`, `golden<>flam3`, `golden<>pyr3`) shows
  `golden<>pyr3 ≈ pyr3<>flam3` always — the predecessor golden is not
  corrupting `baselineR`; pyr3's divergence from flam3-C is real engine
  drift faithfully captured by `baselineR`.

### 🚨 Phase 3 finding (2026-05-28): walker-pool spatial coverage IS the lever

`bin/pyr3-pixel-dump.ts` + `scripts/pyr3-029-pixel-diff.mjs` ran per-pixel
chromatic-histogram diffs on both outlier fixtures + a healthy control.
Pattern is conclusive:

```text
fixture                  R       bothHit   pyr3Only   flam3Only   drift mean
-----------------------  ------  --------  ---------  ----------  ----------
coverage.248.02226       29.92      20.6%   47,465      243,951      0.43
coverage.245.06687       14.59       3.4%    2,427      119,941      0.19
coverage.248.11405        1.36      90.9%   14,656       14,611      0.016    ← healthy control
```

**Smoking gun:** On the broken fixtures, flam3-C hits 1.83×–4.48× more
pixels than pyr3. pyr3's 1024 parallel walkers cluster into a tight
subset of the attractor; flam3-C's single chain wanders broadly. pyr3
then over-deposits on the pixels it does hit (sum_count matches or
exceeds flam3 despite covering far fewer pixels) — concentrated mass
over a smaller spatial set.

The aggregate Phase 1 "chromatic match within 3%" was a spatial-averaging
artifact: per-pixel drift on the broken fixtures is 12–27× the healthy
baseline. High-brightness/low-gamma tonemap (k1=5873 for 02226, 8009 for
245.06687) amplifies the per-pixel divergence into visible R.

This **resurrects sub-hypothesis #1** (walker-pool seed dispersion at
iter=0) which was deprioritized in Phase 1 based on incorrect aggregate
evidence. The 1024 walkers ARE clustering; the single-chain flam3 pattern
IS spatially-wider; this IS the dominant lever for the named outliers.

Verify gallery: `.remember/verify/pyr3-029-phase3-pixel-diff.html`.

### Phase 4 finding (2026-05-28): walker count is NOT the lever

`scripts/pyr3-029-walker-sweep.mjs` re-ran 02226 at four walker counts
with total iter budget held constant (`--walkers=<N>` override on
`bin/pyr3-pixel-dump.ts`):

```text
walkers   bothHit   pyr3Only   flam3Only   driftMean   elapsed
  1024     20.6%      5.1%      26.5%      0.5340      7.3s
   256     20.6%      5.1%      26.5%      0.5342     27.5s
    64     20.6%      5.1%      26.5%      0.5343    107.1s
    16     20.9%      5.3%      26.2%      0.5475    385.0s
```

Coverage stats are **invariant** across a 64× walker reduction. The
walker-pool clustering theory (Phase 3 hypothesis) is **falsified**.
pyr3's chaos chain IS ergodic — even at 16 parallel chains × 28.8M
iters each (matching flam3's per-thread budget more closely), the same
spatial regions remain uncovered. The 4-walker run would push individual
threads past macOS Metal TDR limits and was killed at ~25 min wall.

### Phase 5 (2026-05-28) — bilateral RNG-aligned trace + chaos-engine ports

Built the canonical investigation infrastructure and ported every
flam3-canonical chaos-engine algorithm we could identify.

**Phase 5a — rand transforms** (commit `1dbe721`): pyr3's `rand01` was
using the full 32-bit ISAAC output divided by 2^32. flam3
(`flam3.c:2625-2631`) masks the top 4 bits then divides by 0x0fffffff
(28-bit precision). Added `rand_11` matching `flam3_random_isaac_11`'s
symmetric `[-1, 1]` distribution. Ported byte-exact to chaos.wgsl. R
unchanged but the transforms are now flam3-canonical.

**Phase 5b — bilateral RNG-aligned trace** (commit `944d454`): added a
per-iter trace buffer to chaos.wgsl gated on a `trace_mode` uniform;
walker 0 writes (pick, pa, pv_pre, pv, isBad, color) for the first 1000
post-fuse iters when trace_mode==1. New `bin/pyr3-trace.ts` CLI runs 1
walker × 1000 iters with tracing on, emits flam3 `-rngtrace`-compatible
stderr lines + dumps the pre-init randrsl as hex for direct
`isaac_seed_hex` bilateral alignment with `flam3-render-32bit-isaac-rngtrace`.

**Phase 5b uncovered 3 bilateral-alignment bugs** in the original
investigation protocol:
1. `isaac_seed_hex` was being emitted as little-endian bytes; flam3
   parses each 8-char chunk via `strtoul` as big-endian u32. Fixed.
2. The hex was the POST-irandinit randrsl; flam3 treats the hex as the
   PRE-irandinit seed and runs irandinit itself on the supplied values.
   Fixed by replicating the PCG32 seed-generation path in pyr3-trace.
3. **Walker init was drawing 3 ISAAC u32 (x, y, color), but flam3
   rect.c:449-451 only draws 2** (x, y; color seeded from 0). The 1-draw
   shift propagated forever — pyr3's iter-0 pick was 1 u32 ahead of
   flam3's, producing different picks for ostensibly identical RNG state.
   Fixed in chaos.wgsl.

**Phase 5c — flam3-canonical xform-pick distribution** (commit `944d454`):
pyr3's cumulative weighted-scan algorithm was statistically equivalent
to flam3's table lookup but produced wholly different specific picks
from the same ISAAC state (28-bit vs 14-bit slice of irand). Ported
`flam3_create_chaos_distrib` to `packXformDistrib()` in genome.ts:
`(MAX_XFORMS+1) × 16384 × u32` table encoding (weight × xaos) per-row
cumulative distribution. Replaced the chaos.wgsl pick with the table
lookup `xform_distrib[row*GRAIN + (irand & GRAIN_M1)]`. xaos baked
host-side; the xaos_buffer binding retired.

After all Phase 5 work, bilateral trace shows picks match at iter 0
between pyr3 and flam3 (with bilaterally-aligned ISAAC seed). Trajectories
diverge by iter 1 due to GPU f32 vs CPU f64 precision in the variation
kernels.

**R(coverage.248.02226) ≈ 29.91 throughout Phase 5 — unchanged from the
pre-Phase-5 baseline.** Every algorithm we identified as a candidate
divergence point has been ported. The residual ~30 R is precision-bound,
not algorithm-bound.

### Phase 6 framing — GPU-f32 precision drift

The bilateral trace at `bin/pyr3-trace.ts` proves picks match at iter 0
when seeds are aligned but the chain diverges within a few iters
afterward. With 02226's brightness=22 amplification (k1=5873), small
per-iter precision differences compound into visible R divergence over
460M iters.

Candidate Phase 6 directions (none yet implemented):

1. **🎯 Per-variation f64 reference impl** — port a few high-frequency
   variations (swirl, cell, curve, scry, csch, horseshoe — the dominant
   xforms in 02226) to a TS f64 reference, instrument the bilateral
   trace to also dump pa/pv from this reference, find which variation's
   f32 output drifts most. Locates the precision bottleneck.
2. **🎯 Compensated arithmetic in hot variations** — apply
   double-double or Kahan summation to the highest-impact ops in the
   identified variations (long sums, divisions near singularities).
3. **🎯 Accept the architectural floor** — the GPU-only decision
   (CLAUDE.md "Locked decisions" #4) means f32 precision is a load-bearing
   constraint. For high-brightness fixtures like 02226 (br=22) and
   245.06687 (br=30), pyr3 may simply never achieve sub-5 R against
   flam3-C. The v1.0 ship gate may need a per-fixture threshold tier
   acknowledging this: "low/normal brightness fixtures pass R < 5;
   aggressive-brightness fixtures pass R < 30 with documented engine-
   precision drift."

Full Phase 1-5 data: `.remember/tmp/pyr3-029-ratio-table.md` +
`.remember/tmp/pyr3-029-pixel/` + `.remember/tmp/pyr3-029-walker-sweep/`
(all gitignored). Bilateral trace tools: `bin/pyr3-trace.ts` +
flam3 `isaac_seed_hex` + `prefix=/tmp/flam3-trace-` env var contract.
Diagnostic tools: `bin/pyr3-hist.ts`, `bin/pyr3-pixel-dump.ts`
(`--walkers=N`), `scripts/pyr3-029-bucket-diff.mjs`,
`scripts/pyr3-029-pixel-diff.mjs`, `scripts/pyr3-029-walker-sweep.mjs`,
`bin/pyr3-render.ts --sample-inflate=N`.

### Original Phase-C smoking-gun evidence (now partly superseded)

**Smoking-gun evidence from Phase C investigator:**

- ✅ Palette baking: **bit-identical** (MAD per channel = 0.000 across 256 bins) between
  flam3-C `PYR3_DUMP_PALETTE` dump and pyr3's `bakeLUT(...)` for BOTH 02226 and 22289.
- ✅ Tonemap math: **identical** k1/k2 (5872.96875 / 4.05e-7 for 02226 at qs=10);
  `calc_alpha` + `calc_newrgb` are line-for-line ports of flam3 `palettes.c:274-349`
  and `rect.c:1221`.
- ❌ DE ablation (`--no-de`): minor contributor — Δ +0.09 R for 02226 (estimator_radius=0
  in genome), Δ +2.33 R for 22289 (estimator_radius=11 outlier). Doesn't explain
  R=29.96 / R=44.96.
- ❌ Spatial-filter: ruled out by inspection (faithful port of `filters.c:217-269`).
- 🚨 **Pyr3 chaos-game histogram-deposit ratios diverge from flam3's exactly in the
  per-channel R signature direction** for BOTH fixtures.

**Specific measurements:**

```text
fixture     channel     pyr3 sum    flam3 sum    pyr3/flam3 ratio   R per-channel
----------  ---------   ---------   ----------   ----------------   ----------------
02226       sumG        46.06B      351.5B       1.442 (over)       g=51.40 (heavy)
02226       sumR        31.94B      255.6B       0.910 (under)      r=39.68
02226       sumB        35.09B      272.8B       0.937 (under)      b=39.44
22289       sumR        287.77B     pending      —                  r=73.20 (heavy)
22289       sumG        139.72B     pending      —                  g=40.85
22289       sumB        295.75B     pending      —                  b=65.81 (heavy)
```

The chromatic signature is fixture-specific (over-green for 02226 vs over-red+blue for
22289) because each fixture's variation arms steer the chaos game through different
color-speed-weighted palette regions. But the MECHANISM is shared.

**Sub-hypotheses to bisect (ranked by probable contribution):**

1. **Walker-pool seed dispersion at iter=0** — the 1024 ISAAC walker states may start
   too close together, cluster-biasing initial exploration. Check pyr3's walker-state
   init in `src/chaos.ts` vs flam3's lone-walker init in `flam3.c`. (flam3 has 1
   walker that fuse-iters from a single random seed; pyr3 has 1024 walkers in
   parallel, all starting at independent random points. The parallelism itself
   shouldn't bias — but bad walker dispersion could.)
2. **Bad-iter rollback semantic** — flam3 `i -= 4; continue` nets `i -= 3` (rollback
   3 iter slots); pyr3 `i -= 1; continue` nets `i += 0` (no rollback). Different
   wall-iter consumption profiles. See `src/shaders/chaos.wgsl:1611-1636` vs
   flam3 `flam3.c:262`. Magnitude likely modest (~10% deposit loss for high-bad-rate
   fixtures) — not the dominant factor but contributes.
3. **Per-iter xform-pick RNG draw order** — PYR3-010's 98-arm audit covered the regular
   xform RNG draws (cluster C7/C8 reported clean) but the finalxform opacity-gated
   RNG draw at `chaos.wgsl:1660-1665` was added per `[PYR3-009]` half-port and may
   consume RNG state in a different order than flam3 `flam3.c:336-337`.
4. **Color-contraction `new_z` propagation across bad iters** — `chaos.wgsl:1601`
   computes `new_z = mix(p.z, xform.color, xform.color_speed)` BEFORE the bad-value
   check, so even on bad iters `new_z` reflects the bad xform's color. flam3
   `variations.c:2421-2424` may not propagate xform_color through bad iters.

**Investigation plan:**

1. **Wire pyr3-side `[PYR3-DEBUG] BUCKETS` equivalent** — extend
   `.remember/tmp/dump-hist.mjs` (created by investigator) into a first-class
   `bin/pyr3-hist.ts` that emits `sum_r/g/b/count nonzero/total max_cnt mean_nonzero`
   in the EXACT flam3 stderr line format for direct diff.
2. **Cross-fixture pyr3-vs-flam3 ratio table** — run on all 19 corpus fixtures
   (~5s/fixture). Correlate per-fixture ratio-drift magnitude with per-fixture R.
   Strong correlation → conclusive proof root cause is chaos-game.
3. **Sub-hypothesis bisection** — once smoking gun is confirmed, ablate each sub-
   hypothesis with surgical WGSL changes + re-measure. Each landed ablation = a
   landed parity fix.

**Closes (or substantially reduces R):** `[PYR3-017]`, `[PYR3-021]`, `[PYR3-024]`
once the bisection completes.

**Acceptance:** `coverage.248.02226` R drops below ~5.0 AND 248.22289 R drops below
~10.0 (or both within ~5 of the parity-rig median ~6). No other fixture regresses.

**Phase C scoping evidence at `.remember/tmp/` (gitignored, regen via investigator
re-dispatch):** `probeC-02226-{baseline,no-de}.png`, `probeC-22289-{native,no-de-native}.png`,
`flam3-02226-{palette,tm}.json`, `flam3-02226-stderr.log`,
`flam3-22289-palette.json`, `measure-r.mjs`, `palette-diff.mjs`, `dump-hist.mjs`.

## [PYR3-027] perf · M · 🪶 ✅ **RESOLVED (v0.29, 2026-05-29)** — Why is FE 13× slower than BE for the same render?

**Resolution.** Not Chrome-vs-Dawn, not the rAF yield, not per-chunk
present in any dominant way — it was **pure chunk count**. Each chaos
dispatch carries ~44 ms of *fixed* overhead independent of sample count
(`wallMs ≈ 20 + 44×chunks`); the GPU is nowhere near saturated at 1M
samples. The chunked orchestrator at 4K ran 1887 chunks @ 1M each = 1887×
that fixed cost, while the BE did one `render()`. BE/Dawn-node measured
44.9 ms/dispatch ≈ FE's 44.1 ms — overturning hypotheses #1 (rAF ~0
effect) and #2 (Chrome IPC, false). 100M-sample compute = ~70 ms total.

**Fix shipped (v0.29):** `startDecoupledRender` — decouples display from
dispatch so iteration uses a few dozen *fat* (10M-sample) dispatches
(amortizing the 44 ms across far more work) while a display loop presents
on a steady frame cadence. Wired to the viewer's 🎯 4K button; the hero
renders at 4K in ~2.7 s. See CHANGELOG v0.29. The original investigation
frame is preserved below for history.

---

**Frame (observed 2026-05-27, PYR3-023 probe):** On the 3 fixtures
where FE 4K completed (before the button was removed), the FE took
79-164s to render what the BE produced in 12-19s — a **5.7× to 13.5×
wall-clock gap for the same engine, same fixture, same 4096-long-edge
dims**. Now that FE doesn't do 4K, this gap is academic for the v1.0
ship gate, but the underlying ratio probably persists at quick-mode
dims (just hidden by the small absolute wall-clock — quick mode is
~1s on FE so 13× is still only ~13s; not painful enough to notice).
**Worth understanding before any FE-perf improvement work** —
otherwise we'd chase the wrong knob.

**Hypotheses (unverified, ranked by probable contribution):**

1. **Per-chunk `requestAnimationFrame` yield in
   `render-orchestrator.ts:107`.** At 1887 chunks × 16ms compositor
   tick = ~30s of pure rAF overhead per 4K render (~15-20% of FE's
   163s on 247.19679). BE has no rAF — runs all chunks back-to-back.
   The yield is necessary for UI responsiveness (cancel button,
   progress bar updates) — but might be over-frequent. Could batch:
   yield every K chunks instead of every chunk.
2. **Chrome WebGPU implementation overhead vs Dawn-direct.** Chrome's
   WebGPU sits behind a `--use-mock-keychain` style IPC boundary
   between the renderer process and the GPU process; every
   `device.queue.submit` is an IPC round-trip. Dawn-node skips this
   entirely. Hard to measure without a Chromium-internal trace.
3. **Per-chunk `present()` call (`render-orchestrator.ts:88`).** FE
   defaults `presentAfterEachChunk=true` so the canvas refreshes
   mid-render (the visitor sees the flame refine live). That's an
   extra DE + visualize pass + canvas swap-chain submit per chunk.
   At 1887 chunks: 1887 extra DE+visualize passes. BE sets
   `presentAfterEachChunk=false` (one final present at the end). Easy
   to A/B: render an FE fixture with `presentAfterEachChunk: false`
   and measure.
4. **`SAMPLES_PER_CHUNK = 1_000_000` too small for FE.** Bumping it
   to 5M-10M would reduce chunks from 1887 → 188 (10×), proportionally
   reducing rAF + present overhead. Tradeoff: less responsive cancel
   button + worse progress granularity. Trivial knob to try.

**Next phase:** Hypothesis 3 is the easiest A/B test. Render the same
fixture FE-side with `presentAfterEachChunk: true` vs `false`,
measure the delta. If it's most of the gap, the fix is making it
configurable (or only presenting every K chunks). The other
hypotheses can be measured incrementally from there. **Not v1.0
work** — interactive FE quick-mode renders are ~1s so the user
doesn't feel the gap; investigation can wait.

**Files of interest:**
- `src/render-orchestrator.ts:25` — `SAMPLES_PER_CHUNK`
- `src/render-orchestrator.ts:69,87` — `presentEach` toggle
- `src/render-orchestrator.ts:107` — the `requestAnimationFrame` yield
- `bin/pyr3-render.ts` — BE call site (single `renderer.render()`,
  no orchestrator)
- `scripts/pyr3-023-be-render-4k.mjs` — BE 4K wrapper (canonical
  apples-to-apples reference)

Filed 2026-05-27 post-PYR3-023 probe + FE-4K-removal pivot.

## [PYR3-025] gpu · M · 🪨 ✅ **RESOLVED (v0.29, 2026-05-29)** — Chrome WebGPU 4K renderer-tab-kill class (insurance investigation)

> **✅ RESOLVED by v0.29.** Both crash fixtures were re-tested through the
> new decoupled 🎯 4K button (2026-05-29 probe): **244.36880 → 3.18s** and
> **248.22289 → 4.68s**, each building cleanly to 3840×2160, no tab crash,
> both visually correct. The chunked orchestrator's per-chunk DE+visualize
> at 4K (hundreds of passes) was the trigger; the decoupled path runs DE
> **once at the end** (cheap DE-off previews during the build), which
> sidesteps it. The `estimator_radius=11` DE-parameter correlation is
> consistent with that read. No further work — the crash class is gone with
> the orchestrator that caused it. Original investigation frame preserved
> below.

**Frame:** During PYR3-023 probe, 2/5 sampled showcase fixtures
(244.36880 + 248.22289) reproducibly crashed the Chrome renderer tab
within ~30-45s of clicking the (then) 🎯 Render 4K button. Same
fixtures rendered fine on BE in 14-19s at the same 4096-long-edge dims.

**Reframed (v0.29, PYR3-027 findings + 4K button re-added):** the crash
is **NOT the chaos dispatch** — that holds steady at ~70 ms even at
100M-samples/dispatch, and the v0.29 decoupled 🎯 4K button now renders
the hero at 4K in ~2.7s with no crash. The two original crash fixtures
(244.36880, 248.22289) share `estimator_radius=11` (typical 1–3) and high
`brightness` — both **DE (density-estimation) parameters**. The remaining
suspect is the **4K DE+visualize pass / histogram memory pressure**, not
iteration. The decoupled path runs DE *once* at the end (cheap DE-off
previews mid-build), so if DE-at-4K is the trigger it now fires once
rather than per-chunk. **Re-test the two fixtures via the new 🎯 4K
button** as the next step — they may now complete, or crash only on the
final DE present (which would localize it precisely).

Distinguishing trait on 244.36880: `brightness="24.7609"` (3-5× typical),
`estimator_radius="11"` (typical 1-3), `scale="355.352"` (large).
248.22289 not yet inspected — start with comparing those three fields
across all 5 probe fixtures.

**Next phase:** repro 244.36880 4K crash via chrome-devtools-mcp, capture
`chrome://gpu` state + tracing during crash, identify if it's a Chrome
WebGPU implementation issue (file Chromium bug) or a budget pressure
that pyr3 could detect + skip (e.g., clamp `estimator_radius` against
canvas dims). The probe gallery
(`.remember/verify/pyr3-023-4k-probe.html`) is the artifact this
investigation extends.

Filed 2026-05-27 post-PYR3-023 probe pivot.

## [PYR3-024] parity · S · ✅ **RESOLVED (v0.22, 2026-05-28)** — `248.22289` BE 4K visual divergence — fixed by the PYR3-034 underscore-variation-drop fix

> **✅ RESOLVED v0.22.** This was the worst BE divergence in the corpus (R=44.96) and was
> flagged to "fold into PYR3-029" as a precision-floor casualty. It turned out to be a
> *dropped-variation* bug, not precision: the PYR3-034 fix (`name in V` check before the
> underscore split in `flame-import.ts`) restored the missing variation and dropped
> **248.22289 4K R 44.96 → 5.57** (CHANGELOG v0.22). No further work — closed. The historical
> Phase-B/C scoping below is preserved for context.

**Symptom (observed 2026-05-27, PYR3-023 probe):** Pyr3 BE 4K render of
`electricsheep.248.22289` completes cleanly (~19s wall, no crash, dims
correct) but diverges substantially from the predecessor's
`SHOWCASE_4K` JPG reference.

**Scoping pass measured 2026-05-27 (Phase B):**

- pyr3 BE @ 3840×2160 native (post-alignment to the predecessor's SHOWCASE_4K)
- **R(pyr3-BE, predecessor) = 44.96** — worst BE divergence in corpus
  (worse than 248.02226's PYR3-021 residual R=29.96)
- per-channel: **r=73.20**, g=40.85, **b=65.81** — red+blue heavy
- per-region: br=77.91, bl=61.28, tr=51.97, tl=48.65 — bottom-right bias
- Eyeball gallery: `.remember/verify/pyr3-024-divergence.html`
- Probe script: `scripts/pyr3-024-probe.mjs`

**Per-channel signature differs from 248.02226 (red+blue vs green).**
Different palette signatures → likely don't share the EXACT palette-
baking divergence shape, but both look like upstream-stage divergences
(palette/tonemap/density) rather than per-arm chaos-game bugs.

**Genome traits worth probing:**
- `brightness=29.06` (very high, typical 15–25) — tonemap heavy lifting
- `gamma=3.575` (high) — palette baking AND tonemap gamma-sensitive
- `estimator_radius=11` (outlier, typical 1–3) — shared with the FE-crash
  fixture 244.36880
- `palette_interpolation=hsv_circular` (common; 5 other fixtures use it
  and pass parity at low R, so not the cause on its own)

**Phase C investigator landed 2026-05-27:** all four hypothesis-class
probes (palette / tonemap / density / spatial-filter) **RULED OUT** for
both 248.22289 AND 248.02226. Root cause located in the chaos-game
histogram-deposit divergence — see `[PYR3-029]`. Per-channel signatures
differ (r+b vs g) because variation-arm sets differ, but mechanism is
shared.

**Resolution path:** folds into `[PYR3-029]` chaos-walker-coverage
audit. This entry stays open as a tracking ID for 248.22289 specifically;
will close when PYR3-029's bisection lands and the fixture R drops below
~10.

Filed 2026-05-27 post-PYR3-023 probe pivot; scoped Phase B 2026-05-27;
folded into PYR3-029 Phase C 2026-05-27.

## [PYR3-023] gpu · M · ✅ resolved (corpus expansion + --preset 4k landed in v0.20) — BE 4K parity gate vs the predecessor

**v0.20 closure (2026-05-28):** Resolved. v0.20 graduates the BE 4K
parity rig to first-class infrastructure: `scripts/pyr3-023-be-render-4k.mjs`
deleted; `bin/pyr3-render.ts --preset 4k` is the canonical 4K render
path (`src/presets.ts` owns the spec). `fixtures/predecessor-4k-refs/meta.json`
harmonized to the v0.19 tier-aware schema (`baselineR` → `expectedR`).
The 5-fixture 4K showcase regression gate runs green via
`npm run test:parity-4k`. The remaining v1.0 4K-related work — the
**public showcase gallery** at `mattaltermatt.github.io/pyr3/v1.0/` —
is `[PYR3-007]`, a distinct artifact (separate v1.0 ship-gate entry,
not a residual of this one).

---

**Pivot 2026-05-27** — user directive after the probe found FE 4K
crashes Chrome ~40% of the time + runs 13× slower than BE: **FE no
longer supports 4K**; the 🎯 Render 4K button was removed in this
session's follow-on edit. **BE is the v1.0 4K renderer.** The crash
class moved to PYR3-025 (post-v1 investigation); the 248.22289 BE
visual divergence moved to PYR3-024 (folds into PYR3-021); the FE↔BE
parity invariant became PYR3-026 (its own v1.0 entry). PYR3-023 now
focuses narrowly on the BE-vs-predecessor 4K ship gate.

**Reversal 2026-05-29 (v0.29)** — the "13× slower" was diagnosed
(PYR3-027) as pure chunk count, not a Chrome/engine limit. The FE 🎯 4K
button is **re-added**, now driven by the decoupled orchestrator at
oversample-1 (a few dozen fat dispatches instead of 1887 chunks); the
hero renders at 4K in ~2.7s. A `maxStorageBufferBindingSize` guard
handles GPUs that can't fit the histogram. The two original crash
fixtures still need re-testing under the new path — see PYR3-025.

**Original probe findings** (preserved as load-bearing context for
the BE 4K parity work this entry now drives) — see
`.remember/verify/pyr3-023-4k-probe.html` for the gallery and
`.remember/tmp/pyr3-023-results.jsonl` for raw metrics.

**Empirical findings — 5 showcase fixtures, FE + BE @ 4096 long-edge:**

```text
fixture     FE wall    BE wall    FE/BE ratio    category
----------  --------   --------   -----------    ---------------
247.19679    163.6 s    12.39 s     13.2×        OK
248.31324    159.0 s    11.75 s     13.5×        OK
243.09081     78.9 s    13.73 s      5.7×        OK
244.36880    CRASH      14.06 s      —           FE_CRASH_BE_OK
248.22289    CRASH      19.08 s      —           FE_CRASH_BE_OK_VISUAL_WRONG ⚠️
```

**⚠️ 248.22289 BE render is visually OFF vs the predecessor reference**
(user-flagged 2026-05-27 from probe gallery). Render completed cleanly
in 19s, dims correct, but composition/colors diverge from the predecessor's
4K JPG. **This is a SEPARATE bug from the FE crash.** Filed for own
investigation as part of the post-probe fix scope — fold into PYR3-021
upstream-stage hunt (already open for `coverage.248.02226` upstream
divergence; similar shape, may share root cause) OR file a fresh entry
once the divergence shape is bisected. See
`.remember/verify/pyr3-023-4k-probe.html` row 5 for the side-by-side.

**Headline:** 5/5 succeed on the BE (Dawn-node CLI) in 12-19s.
**3/5 succeed on the FE** (Chrome/Vite WebGPU) in 79-164s — **13× slower
than BE for the same engine, same fixture, same 4096-long-edge config.**
**2/5 fixtures (244.36880, 248.22289) crash the Chrome renderer tab**
within ~30-45s of clicking 🎯 Render 4K (page silently resets to
about:blank, no preserved console messages, no WebGPU validation error
captured). Both crashes are reproducible. **Same fixtures render fine on
BE in 14-19s at the same 4096 dims, ruling out genome-level pathology.**

**Hypotheses (re-ranked from filed):**

- 🔴 **NEW PRIMARY: Chrome WebGPU process budget / OOM / watchdog.** The
  FE_CRASH_BE_OK category isolates the failure to Chrome's WebGPU
  hosting (renderer process memory limit, GPU process watchdog timeout,
  or browser-side accumulated state) rather than the engine itself. BE
  succeeds at identical settings → engine is healthy. Both crashing
  fixtures share outlier traits: **244.36880** declares
  `brightness="24.7609"` (3-5× typical 4-8), `estimator_radius="11"`
  (typical 1-3), and `scale="355.352"` (large). The huge brightness +
  estimator-radius combination likely stresses the visualize pass's
  spatial filter or density-estimator allocations beyond what Chrome's
  per-tab limits accept. **248.22289 not yet inspected for the same
  outlier traits** but expected to share a similar profile (separate
  follow-up bisection probe needed).
- 🟡 **Apples-to-oranges with the predecessor: 4096 vs 3840 long-edge.** The predecessor's
  `SHOWCASE_4K` preset uses
  `TARGET_4K_LONG_EDGE = 3840`. Pyr3's `FULL_MAX_DIM = 4096` renders
  13.78% more pixels per fixture. This delta is not the crash cause (BE
  at 4096 succeeds for all 5), but it IS a real v1.0 parity-rig
  blocker: pixel-level R-compare against predecessor JPGs at 3840 is
  impossible without aligning. **Aligning pyr3 to 3840 is a one-line
  prerequisite for any 4K parity rig** and may also partially reduce
  the Chrome budget pressure (smaller buffer footprint).
- ❌ **Iteration-count overflow** — RULED OUT. BE uses the same
  `renderer.render` code path at the same 4096-long-edge dims and
  produces correct output in 12-19s. The math holds.
- ❌ **Genome rescale at 4K** — RULED OUT. Same reason: BE applies the
  identical sizeScale + scale multiply via
  `scripts/pyr3-023-be-render-4k.mjs`'s pre-processing (a faithful
  mirror of `src/main.ts:renderInMode('4k')`) and produces valid
  renders.
- ❌ **Canvas swap-chain reconfigure failure** — RULED OUT. The
  successful FE renders for 247.19679 / 248.31324 / 243.09081
  reconfigure to 4096×2304 (and 4096×3031) and complete cleanly.

**v1.0-blocking because:** user clarified 2026-05-27 that the v1.0
showcase (PYR3-007) is **4K-on-click**, not quick-mode-on-click. With
2/5 sampled showcase fixtures crashing on the user-facing FE button,
the showcase landing experience is broken for ~40% of the curated set
until the FE crash class is fixed.

**FE/BE 13× wall-clock gap (orthogonal finding):**
On successful renders, FE takes 79-164s vs BE's 12-19s for the same
work. BE does all chunks in one go (no per-chunk rAF yield); FE's
`render-orchestrator.ts:107` `requestAnimationFrame` yield adds ~16ms
of compositor-loop overhead per chunk and at 1887 chunks for a 4K
16:9 fixture, that's ~30s of pure rAF overhead. Plus Chrome's WebGPU
implementation is slower than Dawn-direct. **The 13× gap will hurt the
showcase UX even on fixtures that don't crash** — landing on a 2-3
minute render with no perceptual progress is bad. Likely needs a
larger `SAMPLES_PER_CHUNK` (currently 1M; could go to 5-10M) and/or
fewer rAF yields.

**Next-phase scope (BE 4K parity gate — V1.0 SHIP GATE):**

1. **Align BE 4K long-edge to the predecessor's 3840.** Change
   `scripts/pyr3-023-be-render-4k.mjs`'s `FULL_MAX_DIM = 4096 → 3840`
   so pyr3 BE renders match the predecessor's `SHOWCASE_4K` preset
   pixel-for-pixel in dimensions. Probably promote the wrapper into a
   first-class CLI flag (`--preset showcase-4k` or `--size-scale auto-4k`)
   instead of leaving it as a one-off script. (Mirrors the predecessor's
   `Preset.SHOWCASE_4K` enum.)
2. **Build the BE 4K parity rig.** Mirror the 19-fixture parity rig but
   at 4K dims, comparing pyr3 BE PNG output vs predecessor JPG
   references (`fixtures/predecessor-4k-refs/`). R-thresholds need separate
   calibration against the JPG noise floor (lossier than the existing
   PNG-vs-PNG rig). Showcase fixtures (54 in the predecessor's set)
   become candidates; start with the 5 already probed.
3. **Fix any divergences surfaced** by the rig. Resolve PYR3-024
   (248.22289 visual off) + roll PYR3-021 fixes into the cycle.
4. **Ship as a regression-gated `npm run test:parity-4k`** target,
   sibling of `test:parity`. CI doesn't run it (no headless GPU); local
   developers run it before any engine-touching PR.

**Files of interest:**
- `scripts/pyr3-023-be-render-4k.mjs` — BE 4K wrapper (graduate to CLI
  flag or first-class `bin/` script)
- the predecessor renderer's `Preset.SHOWCASE_4K`
- `src/parity.test.ts` — existing parity rig shape to clone
- `fixtures/predecessor-4k-refs/` — 5 predecessor JPG references already
  fetched; expand as needed
- `.remember/verify/pyr3-023-4k-probe.html` — the eyeball-verify
  gallery from the probe phase

**Closed (moved to follow-on entries):**
- ~~FE 4K crash class~~ → **PYR3-025** (no longer v1.0-blocking).
- ~~248.22289 BE visual divergence~~ → **PYR3-024** (folds into
  PYR3-021).
- ~~FE↔BE parity at quick-mode dims~~ → **PYR3-026** (separate v1.0
  invariant).

Filed 2026-05-27 (v0.13 stop); probed 2026-05-27 (post-v0.13);
re-scoped post-pivot 2026-05-27 (FE 4K button removed). Critical-path
v1.0 work for the next ship cycle.

## [PYR3-022] parser · S · 🪨 ✅ **RESOLVED (v0.28, 2026-05-29)** — Default-palette fallback when `<palette>` is missing

> **✅ Resolved v0.28 (option B — no stop-gap).** Ported flam3's full 701-palette
> library: `scripts/gen-flam3-palettes.mjs` bakes `flam3-palettes.xml` into
> `src/flam3-palettes-data.ts` (RGB bytes, base64, lossless, sync `atob` decode —
> seam-clean for both consumers). `src/flam3-palettes.ts` `getLibraryStops(index)`
> decodes on demand. `flame-import.ts` fallback chain: inline block → library
> palette via `<flame palette="N">` → PYRE; the substitution is surfaced loudly in
> `report.paletteFallback` (never silent — PYR3-034 lesson), replacing the old
> throw. Roundtrip-verified (palette 0 → 185,234,235) + 4 parser fallback tests.

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

## [PYR3-021] parity · M · ✅ resolved (superseded by PYR3-029) — Upstream-stage investigation pivot — RULED OUT

**SUPERSEDED 2026-05-27 by `[PYR3-029]`.** Phase C investigator ran the
4 hypothesis-class probes (palette / tonemap / density / spatial-filter)
on both 248.02226 AND 248.22289 and **conclusively ruled out** all four
upstream stages:

- Palette baking: **bit-identical** (MAD per channel = 0.000 across 256
  bins) between flam3-C `PYR3_DUMP_PALETTE` and pyr3's `bakeLUT(...)`.
- Tonemap: identical k1/k2 (5872.96875 / 4.05e-7); calc_alpha + calc_newrgb
  are line-for-line ports of flam3 `palettes.c:274-349` and `rect.c:1221`.
- Density: --no-de ablation Δ +0.09 R for 02226 (estimator_radius=0),
  Δ +2.33 for 22289 — minor contributor.
- Spatial-filter: ruled out by inspection (faithful port of `filters.c`).

**Actual root cause: chaos-game histogram-deposit divergence** — see
`[PYR3-029]` for the full evidence + investigation plan. Pyr3 chaos-game
sample-deposit ratios diverge from flam3 in EXACTLY the per-channel R
signature direction for both fixtures.

Originally filed 2026-05-27 (v0.13). Closed 2026-05-27 post-Phase-C.

## [PYR3-017] parity · M · ✅ resolved (superseded by PYR3-029) — `coverage.248.02226` systematic-brightness divergence

**SUPERSEDED 2026-05-27 by `[PYR3-029]`.** Phase C investigator located
the root cause in the **chaos-game histogram-deposit ratios** (not
palette/tonemap/density/spatial-filter as PYR3-021 hypothesized).
Pyr3's per-channel deposit sums diverge from flam3 exactly in the
direction of this fixture's green-skewed R signature (g=46.06B vs
flam3's 351.5B; pyr3/flam3 G ratio 1.442 vs R ratio 0.910).
See `[PYR3-029]` for full investigation plan + sub-hypothesis bisection.
The historical investigation below is preserved for context — many of
its ruled-out hypotheses informed the Phase C probe targeting.

---

**Symptom (observed 2026-05-27, v0.11):** `coverage.248.02226` was the
worst R outlier in the 19-fixture parity set (R=32.62; next-worst was
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
predecessor per-arm references, not the 248.02226 fixture itself.

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

## [PYR3-013] feat · L · ✅ **CLOSED (superseded by PYR3-007, v0.21)** — Showcase gallery (mirror the predecessor's v1.1)

> **✅ CLOSED — superseded.** This was the original (broad) showcase-gallery idea. The public
> `/showcase` gallery shipped in v0.21 under `[PYR3-007]` (static masonry, 55 fixtures, JPEG
> tiers, `.flame` downloads, attribution, render-time pills). The remaining gallery-adjacent
> work — gallery→viewer click-to-load — lives as `[PYR3-007]` Chunk 2 (deferred post-v1 with
> `[PYR3-020]`). Nothing actionable survives here. Historical scoping preserved below.

User-facing reference: <https://mattaltermatt.github.io/pyr3/v1.1/>. A curated
multi-flame HTML gallery (3-column layout: flam3-C ref / pyr3 BE / pyr3 FE)
that visitors land on to see what pyr3 actually renders. ~50-150 flames, pulled
from the Electric Sheep Fold corpus + the predecessor's parity test resources
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
1. Build flam3-C locally (the predecessor's parity tree carries flam3-C source +
   build scripts) so we can golden whatever fixture lands in the showcase. Without
   this we're capped at the 16 fixtures already golden'd.
2. Curate fixture list — likely lift the predecessor's `v1.0-showcase.txt` shape
   as a starting point. Some fixtures live in the ESF corpus (`electric-sheep-fold/`
   `corpus/`), some in the predecessor's parity test resources. Path-resolution
   layer needed.
3. Decide hosting: GitHub Pages branch `gh-pages` (mirror the predecessor's pattern
   via adapted `render-showcase.sh`), or shipped as `dist/showcase/`.
4. Render harness — batch invoke `bin/pyr3-render.ts` per fixture; FE side
   needs a chrome-devtools-mcp orchestration script (or pre-rendered PNG only).

**Dependency:** v1.0 ship-gate pass.

## [PYR3-008] gpu · S · 🪨 ✅ **RESOLVED (v0.28, 2026-05-29)** — Decouple chaos.ts oversample from genome

> **✅ Resolved v0.28.** `oversample` is now a required field on `ChaosConfig`,
> set from `pipelines.oversample` (the authority) at `createChaosPass` time; the
> dispatch reads `config.oversample` instead of `genome.oversample`, eliminating
> the divergence class. Regression test (`src/chaos.test.ts`) drives a mock GPU
> device, varies `genome.oversample`, and asserts the splat-scale uniform uses the
> pipeline value. Mirrors how the density pass already takes oversample explicitly.

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

## [PYR3-007] feat · L · 🪨 · ✅ gallery shipped v0.21 (Chunk 1) · v1.0 — Public showcase gallery

A curated gallery of pyr3-rendered showcase flames so visitors have
something visual to land on. Lives at **`/showcase`** (NOT the root —
root `/` is the FE viewer).

**✅ Chunk 1 shipped (v0.21, 2026-05-28):** Static masonry gallery built
by `scripts/build-showcase.mjs` into `public/showcase/` (gitignored,
gh-pages-only). Brainstormed properly (visual companion) — design spec at
`docs/superpowers/specs/2026-05-28-v1.0-showcase-gallery-design.md`. The
remaining gallery-adjacent work (click-to-load) is **Chunk 2**, deferred
post-v1 with `[PYR3-020]`.

**De-bundled from `[PYR3-031]` (2026-05-28):** The original "ships
together with the FE cleanup pass" directive was split — the gallery is a
new static page (`/showcase`), the FE cleanup is the root viewer's own
chunk (`[PYR3-031]`, Chunk 3). They no longer share enough surface to
warrant one pass.

**Landing reversal (2026-05-28):** The "Unversioned URL" note below
originally meant the *root* would BE the showcase. Reversed — root `/` =
viewer, `/showcase` = gallery. The unversioned principle still holds for
`/showcase` (no predecessor-style `/v1.0/` dirs).

**Pre-discussed design directions (locked or near-locked 2026-05-28):**

- **Unversioned URL.** `mattaltermatt.github.io/pyr3/` shows the
  latest showcase — no `/v1.0/`, `/v1.1/` like the predecessor (museum
  approach). Live site. Manifest JSON carries the date + pyr3 commit
  for traceability.
- **Render time, no comparison.** Per-fixture pill shows pyr3 BE 4K
  wall-clock (e.g. `~10s`). Don't compare against the predecessor or flam3-C —
  comparison framing makes pyr3 read as "the second one" when it's
  the primary renderer.
- **Click-to-load is the differentiator.** Clicking a showcase thumb
  loads the flame into pyr3 FE viewer at quick-mode (1024 long-edge —
  4K crashes Chrome per PYR3-025). Static 4K PNG download offered
  separately. "The renderer IS the showcase" — the predecessor's gallery is
  static, pyr3's is interactive.
- **About / what-is-this** — required. 50-word lede explaining
  pyr3's lineage (flam3 → pyr3) + link to GitHub.
- **Permalink per fixture** — `#electricsheep.247.19679` anchors so
  specific fixtures are shareable.
- **Source `.flame` download per fixture** — cheap differentiator;
  visitors can render in any flam3-compatible viewer.
- **Hardware + version banner** at top — pyr3 version + render date
  + hardware + total render time.
- **Mobile responsive** — single column below 768px.

**Brainstorm gaps to resolve next session:**

1. Click-to-load UX details — current tab vs new tab vs overlay?
   Pre-loaded vs lazy? Loading state UX?
2. Aggregate banner copy / tone — what's the voice?
3. Thumbnail strategy — load 4K PNG lazy? Pre-resize to a thumb
   variant? Click-to-zoom modal?
4. Layout — grid (responsive columns) vs single-column scroll?
5. Whether `[PYR3-020]` (share-link decode bug, >6KB URL fails)
   blocks click-to-load — likely yes; folded into this scope.

**Out of scope for v1.0:**
- Per-fixture genome metadata (brightness/gamma/xform list) — defer.
- Search / filter — 55 fixtures fit on one scrollable page.
- Versioned URLs — explicit anti-decision.

**Render artifacts already produced this session (2026-05-28):**

- All 55 fixtures rendered at `--preset 4k` via
  `scripts/render-showcase-v1.0.mjs`. Wall-clock ~10s/fixture, 9 min
  total. Output: `fixtures/showcase-v1.0/<id>.pyr3-4k.png` (gitignored
  due to ~110MB total size).
- Manifest at `fixtures/showcase-v1.0/_manifest.json` carrying source
  paths + render times per fixture (committed — lookup table for the
  gallery builder).
- Verify gallery script at
  `scripts/build-showcase-v1.0-gallery.mjs` — current shape is
  2-column (predecessor JPG ref vs pyr3 render) for "are they rendered?"
  validation; will be SUPERSEDED by the brainstorm-locked gallery
  shape (no predecessor column, render-time pills, click-to-load) in the
  v1.0 session.

**Depends on:** `[PYR3-031]` FE cleanup pass (bundled — they share
the FE surface area; ship together).

## [PYR3-004] gpu · S · 🪨 ✅ **RESOLVED (2026-05-29)** — Expand variation set audit

> **✅ Resolved by audit (2026-05-29), no code.** pyr3's variation table `V`
> (`src/variations.ts`) holds **exactly 99 entries, indices 0–98** (linear→mobius)
> — the complete canonical flam3 set — and PYR3-036's reachability test already
> asserts every entry survives import. `gdoffs` (named below as the gap) is **not a
> flam3 variation** (flam3-C's own source defines no such name); it was a
> predecessor-specific artifact whose framing died with the v0.25 scrub. Audit
> conclusion: variation set complete + guarded; nothing to port.

**Filed (original framing, now obsolete):** The prior TS+WebGPU viewer's README claims 99
variations; the JVM predecessor shipped 98/99 with `gdoffs` as the gap. Audit which 99 the
prior viewer has, confirm completeness, port any missing arms.
