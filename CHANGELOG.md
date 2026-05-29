# 📋 pyr3 Changelog

Authoritative ship history. Backward-looking only — forward plans live in
[ROADMAP.md](ROADMAP.md), open tasks in [BACKLOG.md](BACKLOG.md).

Version format: `vMAJOR.MINOR[-suffix]`. Pre-v1.0 versions are unstable scaffolding;
**v1.0** marks the ship gate: pyr3 backend (Node CLI WebGPU) renders matching flam3-C's
output (`flam3-render-32bit-isaac qs=1`) within R tolerance for the curated fixture set;
pyr3 frontend (browser WebGPU) renders matching the backend at quick-mode dims within R
tolerance. (The 2026-05-28 pivot replaced the prior kotlin-v1.1 reference with flam3-C
directly — see v0.18.)

## v0.25 — 2026-05-29 — Predecessor-reference scrub (public-ship prep)

**Outcome:** The working tree is clear of all references to the non-public
predecessor projects (`pyr3-kotlin`, `pyr3-peek`, `pyr3-rust`, and the never-real
`flam3-kotlin`) and of all machine-local absolute paths, so pyr3 stands on its own
for the public GitHub ship. The public **flam3** (Scott Draves) lineage stays; git
history and this changelog's own narrative are deliberately preserved as the
factual record (only the live working tree is scrubbed).

**Scope:**
- **Docs scrubbed in place** — README / VISION / ROADMAP / BACKLOG / CLAUDE + the
  `public/help` pages. The WebGPU help page's two-product "desktop Kotlin/JVM
  renderer" paragraph was removed (pyr3 is single-product, WebGPU-only). `NOTICE.md`
  keeps the legally-required flam3 / Scott-Draves attribution; the two self-authored
  predecessor attribution sections were removed. Bare `kotlin` / `peek` mentions were
  genericized to "the predecessor" / "the prior viewer" while preserving every
  technical fact, R-value, and `[PYR3-NNN]` ID.
- **Internal scaffolding excluded from the public repo** (untracked + gitignored,
  local copies kept): `docs/superpowers/`, `docs/flam3-local-build.md`, and the two
  predecessor-diffing agent defs (`wgsl-parity-reviewer`, `flame-fixture-investigator`).
- **Legacy 4K parity gate dropped** — `fixtures/kotlin-4k-refs/` +
  `fixtures/kotlin-goldens/` + `src/parity-4k.test.ts` + the `test:parity-4k` npm
  script removed. It compared against the predecessor's non-canonical v1.1 JPGs,
  superseded by the v0.18 flam3-C ground-truth pivot. Filed `[PYR3-043]` for an
  optional future 4K-vs-flam3-C gate; the canonical native-dim flam3-C rig is unaffected.
- **Functional rewiring** — the showcase manifest's `source` paths are now portable
  relative `electric-sheep-fold/...` paths; `build-showcase.mjs` +
  `render-showcase-v1.0.mjs` resolve them against an `ESF_ROOT` env (sibling-checkout
  default), and `render-showcase-v1.0.mjs` is now manifest-driven. Dev-script flam3-C
  binary paths moved behind a `FLAM3_BIN` env var.
- Resolves **`[PYR3-032]`** (functional predecessor-purge). A companion hygiene pass
  closed stale entries `[PYR3-024]` / `[PYR3-013]` / `[PYR3-031]` and the `[PYR3-036]`
  secant-alias sub-item.

**Verified:** `git grep -iE 'pyr3-kotlin|pyr3-peek|pyr3-rust|flam3-kotlin'` and
`git grep -in 'kotlin|peek'` return only CHANGELOG-narrative matches; `git grep
'/Users/matt'` returns zero; `npm run typecheck` clean; unit suite 4582 passed;
`npm run test:parity` 25/25 (the lone RPC-heartbeat warning is the known `[PYR3-014]`
cosmetic noise, not a failure).

## v0.24 — 2026-05-29 — Corpus share-URL client: brotli chunk fetch/decode + `/v1` router + apex `pyr3.app`

**Outcome:** Opening `https://pyr3.app/v1/gen/{gen}/id/{id}` now loads and
renders that exact Electric Sheep corpus flame directly in the browser. No
file upload required. Legacy `?flame=<encoded>` links continue to work
unchanged. Live + verified end-to-end on `pyr3.app` (apex custom domain,
Enforce-HTTPS; `github.io/pyr3/` 301-redirects to it).

**How it works (four new modules):**

- **`src/brotli.ts`** — brotli inflate, feature-detected. Native
  `DecompressionStream("brotli")` on Safari 18.4+/Firefox 147+ (zero
  download); **Chromium has no native brotli stream (verified Chrome 148),
  so Chrome/Edge use a code-split `brotli-dec-wasm` decoder (~200 KB, fetched
  only on that path)**. Both consumers (chunk + avail manifest) share the
  decode path. gzip is native everywhere, but brotli is kept for its ~5×
  size win (172 KB vs 832 KB per 256-flame chunk).
- **`src/chunk-fetch.ts`** — chunk-window fetch + flame extraction.
  Computes `chunk_lo = (id // 256) * 256`, fetches
  `/chunks/{gen}/{lo:05d}.flam3chunk` (same-origin, baked into the deploy),
  brotli-decodes the raw bytes, JSON-parses the chunk envelope, and returns
  the raw flam3 XML for the flame at the requested `id`.
- **`src/avail.ts`** — per-gen availability manifest client (byte-conformant
  to ESF's `encode_avail`). Decodes `/chunks/{gen}/avail.flam3idx` (brotli
  delta-varint id list) for "sheep not found" dead-link detection. Decoder
  shipped + tested; viewer wiring deferred (ROADMAP `[PYR3-039..041]`).
- **`src/load-intent.ts`** — extended with a `/v1` path router. Parses
  `location.pathname` (stripping the base prefix) into typed `LoadIntent`
  kinds: `corpus` (`/v1/gen/{gen}/id/{id}`) → chunk-fetch + render;
  `gen-list` / `gen-browse` (reserved — paint the welcome flame for now);
  `custom-reserved` (`/v1/flame/...`); `flame` (legacy `?flame=`); `default`.

All in-app URLs are base-aware (`import.meta.env.BASE_URL`), so the single
codebase serves the **apex `pyr3.app`** (base `/`) and the
`mattaltermatt.github.io/pyr3/` fallback identically — the `/pyr3/`→`/` flip
was a one-line `vite.config.ts` change.

**Deferred (not built):** the `/v1/gen` and `/v1/gen/{gen}` visual browse
gallery (shows the welcome flame for now) and the `/v1/flame/{token}`
custom-flame share form. See [`docs/corpus-share-url.md`](docs/corpus-share-url.md)
for the pyr3-side scope summary and the canonical cross-repo spec pointer.

**Chunk data source:** chunks are produced by the sibling
[electric-sheep-fold](https://github.com/MattAltermatt/electric-sheep-fold)
repo (`sheep-fold chunk` / `release-build` → `corpus-chunks-{date}.tar`) and
baked into the deploy at build time. The `/v1` routes are live once the
bake-at-deploy GH Actions step lands (Phase 3).

## v0.23 — 2026-05-28 — Browser viewer v1.0 FE-polish pass (slim top bar, on-demand progress, dreaming cue, load toast)

**Outcome:** The browser viewer gets its v1.0 chrome. Engine and parity gates
are untouched — this is a frontend-only polish slice. All three rigs stay green.

**Top bar — rebuilt into a single slim row.** 🔥 pyr3 wordmark (→ home) · "about"
link · flame name · "by {nick}"; a centered 📂 Open button; right side carries a
WebGPU status pill plus two GitHub octocat link-chips ("fork it" → the pyr3 repo,
"more flames" → the electric-sheep-fold repo). The rebuild swept the vestigial
`setLoading` / status-pulse wiring and the `.pyr3-bar-btn-accent` CSS.

**Render progress is now an on-demand drop-down detail row** — it appears only
during a render (bar, %, ETA + samples, "Why so long?" link, Cancel) instead of
occupying chrome at rest.

**First-paint "dreaming…" cue** in the canvas zone on cold load, so the empty
canvas reads as intentional rather than broken.

**User-facing toast on `.flame` load failure** — previously console-only; a
malformed or unreadable flame now surfaces a visible error.

**Share-link button removed.** Share is being redesigned in a separate future
session; the url-codec module + inbound `?flame=` link decoding are kept intact.

**help/*.html rebranded** from "pyr3-peek" (Phase-0 wholesale-copy leftover) to
"pyr3" across all three pages.

**About page rewritten (`[PYR3-037]`, pulled forward this session).** The
mechanical rebrand exposed that `about.html` was built around a two-product
worldview — a separate desktop Kotlin/JVM renderer ("Forge", "pyr3 CPU"). It's
now rewritten to pyr3's real single-product identity: one TypeScript + WebGPU
engine, two consumers (browser viewer + headless CLI), in the flam3 lineage. The
"pyr3 family" list collapses to **pyr3 / ESF / flam3** with outbound links to
electricsheep.org and the flam3 repo; the two-column layout now aligns.

**Backlog impact:** closes the **FE-cleanup slice of `[PYR3-031]`** (slim-bar
rebuild swept the dead `setLoading` / status-pulse / `.pyr3-bar-btn-accent` paths;
Share button removed; no stale TODOs remained) and the **FE-facing slice of
`[PYR3-032]`** (help-page branding + FE source comments). The **functional
`[PYR3-032]` purge stays open** — fixture-manifest source paths,
`fixtures/kotlin-*` renames, agent defs, and engine `Port: pyr3-kotlin`
provenance comments are explicitly NOT done. **Resolves `[PYR3-037]`** (the
About-page rewrite above — pulled forward instead of deferred).

## v0.22 — 2026-05-28 — PYR3-034 fixed: underscore-named variations were silently dropped (radial_blur halo)

**Outcome:** `electricsheep.243.00171` renders its full soft-blue halo nebula again.
Chaos-pass coverage jumps **0.43% → 55%** (18,501 → 2,346,734 nonzero buckets),
matching flam3-C's 52% / mean-count-per-pixel (10,234 vs 10,133) within ~1%. The
**v1.0 BLOCKER** [PYR3-034] is cleared.

**Root cause:** `flame-import.ts` split every xform attribute name on the first `_`
to separate variation-from-param (the `<var>_<param>` convention). Variation names
that *themselves* contain an underscore — `radial_blur`, `gaussian_blur`, `pre_blur`,
`super_shape`, `wedge_julia`, `wedge_sph` — were split to a non-variation head
(`radial_blur` → `radial` ∉ V) and **silently
dropped**. On 243.00171, xform0 lost its `radial_blur=0.5` and ran `linear=0.05`
alone, collapsing the orbit onto the spherical 2-cycle — a 128× attractor-size gap.

**Fix:** test `name in V` BEFORE the underscore split in `parseXformElement`'s
attribute walk, so multi-word variation names are recognized as variations; genuine
`<var>_<param>` attrs still fall through to the param branch. +2 regression tests.

**Not a precision floor.** The prior investigation (and the next-session memory) framed
this as a GPU-f32-vs-f64 attractor-precision issue with df64 sanctioned as the fix. That
was wrong: a CPU f64-vs-f32 oracle of the exact map showed *identical* coverage in both
precisions (18.7% each) — proving the map was missing a variation, not losing precision.
df64 NOT needed; the GPU-only/f32 stance holds. The fma/op-order experiments correctly
exonerated rounding; the per-iter trace localized the orbit to a spherical 2-cycle; the
genome read showed radial_blur output ≡ `linear × 0.05` (radial_blur contributing zero),
which pinned it.

**Scope — six variations, not three.** A full corpus attribute audit (PYR3-036) found the
drop hit every underscore-named variation in `V`: `radial_blur`, `gaussian_blur`, `pre_blur`,
`super_shape`, `wedge_julia`, `wedge_sph`. It also resolved **[PYR3-024]**: 248.22289's 4K
divergence (R **44.96 → 5.57**) was this bug, not the f32 floor PYR3-024/029 had assumed.
(coverage.248.02226, the other PYR3-029 outlier, does NOT use a dropped variation and stays.)

**Verified — all three v1.0 ship gates green post-fix:** 25/25 BE-vs-flam3-C parity · 5/5 BE 4K ·
25/25 FE↔BE · 4539 unit (incl. PYR3-036 safeguards) · typecheck clean. **[PYR3-035] done:** all
13 affected showcase fixtures re-rendered + gallery rebuilt (54 cards). Notably, pyr3's
`243.06888` (super_shape) now **surpasses the kotlin v1.1 reference**, which was too dark —
kotlin has its own super_shape issue, reinforcing the v0.18 flam3-C-ground-truth pivot.

**Safeguards ([PYR3-036]):** the parser no longer silently swallows any attribute (unrecognized
underscored attrs surface in the report); an all-99 reachability test asserts every variation
in `V` survives import; a curated-corpus test asserts the parity fixtures drop nothing. Had
these existed, the drop would have been a red test on day one.

## v0.21 — 2026-05-28 — Public `/showcase` gallery (v1.0 Chunk 1)

**Outcome:** A static public showcase gallery is generated into
`public/showcase/` by the new `scripts/build-showcase.mjs`. It presents the
pre-rendered 4K flames (54 of 55 — one degenerate pure-black render auto-skipped,
see `[PYR3-033]`) as a masonry grid (true aspect, no cropping) over
the pyr3 dark theme: hero + lineage lede (flam3 → pyr3), version/hardware/date
banner, and per-card: thumbnail (click → full 4K in a new tab) with an explicit
**⤢ Open 4K** button on the id line, monospace id + permalink anchor, artist
attribution (`nick=` from the source `.flam3`, "artist unknown" fallback), and a
"Rendered at `<W>×<H>` by pyr3 GPU in `<N.N>s`" line (time only, no comparison).
Mobile collapses to a single column below 760px. (`.flame` download +
"from electric-sheep-fold" attribution deferred for now.)

**Why:** This is the first of four chunks decomposing the v1.0 public surface.
The renderer was finished but nothing presented its output. Design locked via a
visual brainstorm this session.

**How:** The script derives two JPEG tiers (`~q90`) per fixture from the
gitignored 4K PNGs — full-res (`<id>.4k.jpg`, ~2–4MB) + a 600px thumbnail
(`~150KB`) — copies each source `.flame`, reads render dims from the PNG IHDR,
and emits a self-contained `index.html` with relative asset paths (gh-pages
base-path agnostic). A mean-luminance gate (computed off the thumb via
`jpeg-js`) auto-skips effectively-black renders so the gallery never shows an
empty card. Each thumbnail carries a persistent "⤢ View 4K" badge (mobile-safe
click affordance) and a permalink `#` before its id. Output lands in `public/showcase/`, which Vite serves at
`/showcase/` in dev and copies to `dist/showcase/` on build — so the heavy
images ride to gh-pages via the build artifact and **never touch `main`**
(`public/showcase/` is gitignored), mirroring how pyr3-kotlin shipped its
showcase. JPEG over WebP for universality; format `~q90` per the kotlin precedent.

**Scope pivots locked this session (supersede earlier `[PYR3-007]` notes):**
root `/` stays the FE viewer (front door); `/showcase` is the gallery (reverses
the original "root = showcase" decision once the viewer's root presence was
recalled); unversioned URL (no kotlin-style `/v1.0/` dirs); **no** gallery→viewer
click-to-load in v1.0 (deferred with `[PYR3-020]` to the post-v1 sharing chunk);
`[PYR3-031]` FE cleanup split out as its own chunk. Verified in Chrome
(masonry/attribution/pill/download/permalink/mobile, console clean) + `npm run
build` dist proof + 4510 tests green. Deploy + Vite `base` wiring is Chunk 4.

## v0.20 — 2026-05-28 — Corpus expansion 19→25 + `--preset {quick,4k}` CLI flag family

**Outcome:** Parity regression gate expands from 19 → 25 fixtures with
a clean **18:7 tier ratio**. The BE 4K parity rig is now first-class
infrastructure via `bin/pyr3-render.ts --preset 4k` (no more wrapper
script). `[PYR3-023]` closes. v0.20 is the final infrastructure ship
before v1.0 (ship-gate green + showcase + FE cleanup + GitHub repo
replacement).

**Why:** Three drivers landed together in one ship:

1. **Corpus diversity** — 19 fixtures was the kotlin parity set's
   mid-cycle coverage. v0.20 adds the 3 untapped kotlin goldens
   (`244.00617`, `244.42746`, `248.23554`) for parity-set completeness,
   plus 3 ESF picks from kotlin's `v1.0-showcase.txt`
   (`electricsheep.247.08620`, `.245.07670`, `.244.59334`) so the
   parity gate watches fixtures users will actually see in the v1.0
   showcase (cross-purpose with `[PYR3-007]`).
2. **CLI flag family** — pre-v0.20, `--quick` was a top-level flag and
   the 4K render path lived in a wrapper script
   (`scripts/pyr3-023-be-render-4k.mjs`). v0.20 consolidates both into
   the `--preset NAME` extension seam so future batch scripts can
   compose presets uniformly. Per CLAUDE.md "no stop-gaps": legacy
   `--quick` is REMOVED, not preserved as a compat shim.
3. **4K meta harmonization** — `fixtures/kotlin-4k-refs/meta.json`
   `baselineR` → `expectedR` to match the v0.19 schema across both
   parity corpora.

**What changed:**

1. **Parity corpus 19 → 25** (`fixtures/flam3-goldens/`):
   ```text
   New Tier-1 (4 fixtures, R<5):
     244.00617              R=0.72  (kotlin lift)
     electricsheep.244.59334 R=1.60  (ESF)
     electricsheep.245.07670 R=2.34  (ESF)
     electricsheep.247.08620 R=3.26  (ESF)

   New Tier-2 (2 fixtures, R≥5, engine-precision-drift band):
     244.42746              R=5.50  (kotlin lift, boundary case)
     248.23554              R=24.12 (kotlin lift, heaviest of the six)

   Final corpus tier ratio: 18:7 (was 14:5 in v0.19).
   ```
2. **`src/presets.ts`** — new module owning preset specs.
   `PresetSpec` carries `mode: 'cap' | 'force'` distinguishing quick
   (cap, no upscale) from 4k (force, always-rescale long-edge to
   3840). `shortEdgeRound: 'round' | 'floor'` preserves per-preset
   rounding (quick uses `Math.round` matching pre-v0.20 FE behavior;
   4k uses `Math.floor` matching kotlin's `Math.floorDiv` in
   `Preset.SHOWCASE_4K`). 16 unit tests.
3. **`bin/pyr3-render.ts`** — argv parsing migrated. `--quick`
   removed. `--preset {quick,4k}` added (mutually exclusive with
   `--max-dim`). Calls `applyPreset()` from the new module.
4. **Test callers migrated:**
   - `src/parity-fe-be.test.ts` — `'--quick'` → `'--preset', 'quick'`.
   - `src/parity-4k.test.ts` — invokes `bin/pyr3-render.ts --preset
     4k` directly (was the wrapper script). 5/5 green at v0.19
     thresholds.
5. **4K meta** (`fixtures/kotlin-4k-refs/meta.json`): `baselineR` →
   `expectedR` per fixture (5 entries). 4K thresholds
   (round(expectedR+2.0)) unchanged.
6. **Deleted:** `scripts/pyr3-023-be-render-4k.mjs` (replaced by
   `--preset 4k`).
7. **Filed:** `[PYR3-031]` (FE cleanup pass for v1.0 ship gate).

**Acceptance:** all 25 parity fixtures pass `npm run test:parity` in
~123s. 5/5 4K showcase fixtures pass `npm run test:parity-4k` via
`--preset 4k`. `npm run test:parity-fe-be` green via `--preset quick`
(swiftshader headless Chromium, ~10 min). `npm run typecheck` + `npm
test` green (4510 + 5 skipped).

**Unblocks v1.0:** ship-gate green check + public showcase
(`[PYR3-007]`) + FE cleanup (`[PYR3-031]`) + GitHub repo replacement
(CLAUDE.md decision #7). v1.0 ships these together.

## v0.19 — 2026-05-28 — Accept the f32 floor: per-fixture threshold tier recalibration

**Outcome:** The parity contract becomes tier-aware. v0.19 bakes the
GPU-f32-vs-CPU-f64 architectural reality (CLAUDE.md decision #4: "GPU
only; no CPU path") into the per-fixture R-tolerance schema so v0.20
(corpus expansion) and v1.0 (ship gate) aren't perpetually gated on
closing a precision floor that the locked engine choices make
unreachable. **PYR3-029 formally closes** here — downgraded from "v1.0
gate-blocker" to "v1.x precision-improvement research" tracked as an
in-entry note on the ✅-resolved BACKLOG entry.

**Why:** PYR3-029 Phase 5 (`944d454`) ported every flam3-canonical
chaos-engine algorithm we could identify — rand transforms, walker-init
RNG draw count, 14-bit `xform_distrib` table, bilateral RNG-aligned
trace. After all that, `R(coverage.248.02226) ≈ 29.91` was unchanged
from the pre-Phase-5 baseline. The bilateral trace at `bin/pyr3-trace.ts`
proves picks match at iter 0 when seeds are aligned but trajectories
diverge by iter 1 due to f32 in the variation kernels compounding over
460M iters at high-brightness amplification. Per VISION's "similar but
not the same" contract, chasing bit-faithful flam3 parity via
compensated arithmetic in WGSL is heroic for marginal payoff.

**What changed (contract-only, no engine changes):**

1. **`meta.json` schema (19 fixtures + 4K showcase):**
   - `baselineR` → `expectedR`; `feBeBaselineR` → `feBeExpectedR` (semantic
     rename — "baseline" implied a regression-from-zero floor; "expected" is
     honest about what the value represents).
   - `tier: 1` or `tier: 2` per fixture. Tier-2 = `expectedR ≥ 5.0`
     (mechanical cutoff; the corpus splits cleanly at this threshold).
   - Tier-2 fixtures carry a `notes` field documenting the
     engine-precision-drift band, pointing at PYR3-029 Phase 5/6.
   - `thresholdR = expectedR + 1.0` unchanged (consistent +1.0 absolute
     headroom across both tiers).
2. **Test gates** (`src/parity.test.ts`, `src/parity-fe-be.test.ts`,
   `src/parity-4k.test.ts`): tier-aware failure messages. A tier-2
   regression reads as "Tier-2 fixture <id> R=X exceeded thresholdR=Y —
   engine-precision-drift floor regressed"; a tier-1 regression reads
   simply as a tier-1 breach (real bug shape).
3. **Calibration scripts** (`scripts/regen-flam3c-goldens.mjs`,
   `scripts/build-flam3c-pivot-verify-html.mjs`): updated to emit the
   v0.19 schema; the HTML verify gallery now surfaces a tier pill per
   fixture next to the R pill.

**Tier breakdown (19-fixture parity corpus):**

```text
Tier-1 (14 fixtures, R < 5.0)
  244.57686             0.42
  coverage.248.11405    1.36
  coverage.247.31007    1.52
  coverage.248.19873    1.58
  248.11268             2.00
  coverage.248.25196    2.19
  244.82270             2.21
  248.04487             2.32
  coverage.248.24236    2.70
  247.29388             3.01
  coverage.247.20817    3.10
  coverage.245.00381    4.43
  244.00016             4.55
  coverage.248.33248    4.93

Tier-2 (5 fixtures, R ≥ 5.0 — engine-precision-drift band)
  coverage.247.28068    5.16
  244.82986             8.98
  coverage.243.04616   11.56
  coverage.245.06687   14.59
  coverage.248.02226   29.92
```

**Tier breakdown (5-fixture 4K showcase, vs kotlin v1.1 JPGs):** 2 tier-1
(247.19679 R=2.78, 244.36880 R=3.24), 3 tier-2 (248.31324 R=6.14,
243.09081 R=7.36, 248.22289 R=44.96). 4K thresholds use `round(expectedR
+ 2.0)` (JPG noise floor headroom); field-name harmonization defers to
v0.20.

**Acceptance:** all 19 parity fixtures pass `npm run test:parity` under
the v0.19 schema (14 tier-1 at `R < expectedR + 1.0` and tier ceiling
`< 5.0`; 5 tier-2 at `R ≤ expectedR + 1.0`). Typecheck + `npm test` green.

**Unblocks:** v0.20 corpus expansion (20–50 fixtures) and v1.0 ship-gate
acceptance / GitHub repo replacement. PYR3-029 closes (Phase 6 precision
research stays as an in-entry future-research note; if it ever resumes,
the work would file a fresh ID).

**Migration script:** `scripts/pyr3-v019-tier-migrate.mjs` (one-shot,
idempotent — kept committed for posterity and as the documentation of
the rename rule).

## v0.18 — 2026-05-28 — Ground-truth pivot: kotlin v1.1 → flam3-C goldens

**Outcome:** Strategic pivot. The 19-fixture BE parity rig's goldens
were originally lifted from `pyr3-kotlin/parity/goldens/` — kotlin's
own v1.x parity captures. The 2026-05-28 pivot replaced those with
direct `flam3-render-32bit-isaac qs=1` output, seeded deterministically
via `isaac_seed=<fixture-id>` so regens are reproducible.

**Why:** PYR3-029 Phase 2 (`v0.17` follow-on, same session) 3-way
R-comparison surfaced that kotlin goldens were close to flam3-C
(typically R<5) but carried a port-specific offset. For high-R
fixtures the offset was small relative to engine drift, but it
nonetheless conflated kotlin's port choices with pyr3's measured
parity. flam3-C is the canonical lineage source of truth (the
project explicitly states "similar but not the same as flam3-C") —
measuring against kotlin instead introduced a layer of indirection
that obscured the real question.

**Mechanism:**
- New script `scripts/regen-flam3c-goldens.mjs`: renders each fixture
  via the local flam3-C reference binary with fixed
  `isaac_seed=<id>` for determinism; replaces `golden.png`; recomputes
  `baselineR` as mean over 3 pyr3 runs; rewrites `meta.json` with the
  new baseline + `thresholdR = baselineR + 1.0` headroom + a `source`
  field naming the flam3-C invocation.
- `bin/pyr3-render.ts` gains `--sample-inflate=N` as a permanent PYR3-029
  diagnostic flag (scales the `totalSamples` passed to `deriveCalibration`).
- Docs (VISION, ROADMAP, CLAUDE, README) updated: v1.0 ship gate now reads
  "BE parity vs flam3-C," not "BE 4K parity vs kotlin v1.1."

**Net effect on baselines:** Most fixtures shifted by < 1 R (well within
the 1.0 headroom on the prior thresholds). A few fixtures with smaller
kotlin-vs-flam3 offsets saw baselines drop slightly; others rose
modestly. No new failures introduced.

**Acceptance:** `npm run test:parity` green against the regenerated
goldens; all 19 fixtures pass their new thresholds.

## v0.17 — 2026-05-27 — PYR3-023 BE 4K parity gate (2/2 v1.0 ship gates infrastructure shipped)

**Outcome:** Second v1.0 ship gate's regression-gate INFRASTRUCTURE
shipped. `npm run test:parity-4k` runs all kotlin-v1.1-JPG-referenced
showcase fixtures through pyr3 BE @ 3840 long-edge (matched to kotlin's
`SHOWCASE_4K` preset) and R-compares against the JPG ref directly.
5 fixtures probed; **4/5 render within or below the 19-fixture
BE-vs-flam3 median R~6:**

```text
fixture                  R       verdict
-----------------------  ------  -----------------------------
electricsheep.247.19679  2.78    🟢 CLEAN — the README hero
electricsheep.244.36880  3.24    🟢 CLEAN
electricsheep.248.31324  6.14    🟢 CLEAN
electricsheep.243.09081  7.36    🟢 CLEAN
electricsheep.248.22289  44.96   🔴 PYR3-029 outlier (chaos-game)
```

**Headline:** The hero fixture `electricsheep.247.19679` matches kotlin
v1.1 4K at R=2.78 — well inside the noise floor. v1.0's "this is what
pyr3 renders" canonical example is solidly aligned.

**Mechanism:**

1. **Dim alignment fix** in `scripts/pyr3-023-be-render-4k.mjs`: changed
   short-edge rounding from `Math.round()` → `Math.floor(maxDim * short /
   long)` to match kotlin's integer division. Caught a 1-px mismatch on
   243.09081 (pyr3 2842 vs kotlin 2841) that would have false-failed the
   gate.
2. **Vitest gate** `src/parity-4k.test.ts`: discovers `.flam3` sources
   in `fixtures/showcase-probe-sources/` that have matching JPG refs in
   `fixtures/kotlin-4k-refs/`. Per-fixture: spawnSync the 4K wrapper,
   decode JPG via `jpeg-js`, R-compare, write diff PNG, assert R ≤
   `kotlin4kThresholdR` (null = record-only).
3. **Per-fixture thresholds** in `fixtures/kotlin-4k-refs/meta.json`
   (separate from the 19-fixture parity rig metas since this is the
   showcase-set subset). Calibrated at measured+2.0 for the 4 clean
   fixtures; intentionally loose at +2.0 (=47) for 248.22289 pending
   PYR3-029 chaos-game fix.
4. **Toggle:** `VITEST_INCLUDE_PARITY_4K=1`. Run-to-run variance < 0.01
   R at this sample-count class (3B samples per fixture); single-run
   calibration adequate.

**v1.0 ship gate status (both gates):**

- ✅ **FE↔BE parity at quick-mode dims** (PYR3-026, v0.15) — 19/19
  gated, R median ~6, infra complete.
- ✅ **BE 4K parity vs kotlin v1.1** (PYR3-023, v0.17) — 5/5 gated,
  4/5 clean, 1 outlier blocked on PYR3-029 chaos-game fix. Infra
  complete; calibration tightens after PYR3-029 lands.

**Remaining v1.0 work before SHIP:**

- **PYR3-029** chaos-walker-coverage audit (4-sub-hypothesis bisection
  on `chaos.wgsl`). Closes 248.22289 + likely tightens 243.09081 +
  248.31324. Closes PYR3-017/021/024 cluster.
- Expand 5 → ~20-50 fixtures in the 4K parity set (curate from kotlin's
  v1.1 corpus).

**Files:**

- `src/parity-4k.test.ts` — new Vitest gate (5 fixtures, jpeg-js)
- `scripts/pyr3-023-be-render-4k.mjs` — dim-rounding fix
  (Math.round → Math.floor of long*ratio integer math)
- `scripts/pyr3-023-4k-build-html.mjs` — eyeball gallery builder
- `scripts/pyr3-023-probe-build-html.mjs` — renamed from v0.14's
  pyr3-023-build-html.mjs (preserves the FE+BE+kotlin probe HTML
  builder; distinct purpose from the 4K parity rig)
- `fixtures/kotlin-4k-refs/meta.json` — per-fixture thresholds
- `fixtures/showcase-probe-sources/electricsheep.247.19679.flam3` —
  staged (the README hero fixture)
- `fixtures/showcase-probe-sources/electricsheep.248.31324.flam3` —
  staged
- `vitest.config.ts` — `VITEST_INCLUDE_PARITY_4K` toggle
- `package.json` — `test:parity-4k` script
- `.gitignore` — exclude `kotlin-4k-refs/*.pyr3-be-4k.png` +
  `kotlin-4k-refs/*.fe-be-diff.png` (regenerated each run)

## v0.16 — 2026-05-27 — PYR3-021/017/024 → 029 root cause located (chaos game, not upstream stages)

**Outcome:** Major research finding from the Phase C
`flame-fixture-investigator` dispatch. The cluster of long-standing
parity divergences on `coverage.248.02226` (PYR3-017 since v0.11, R=29.96
post-v0.13) and `electricsheep.248.22289` (PYR3-024, R=44.96 BE-vs-kotlin
v1.1) **was hypothesized to live in palette baking / tonemap / density /
spatial-filter** (PYR3-021). All four upstream-stage hypotheses ruled
out empirically with bit-identical / line-for-line evidence. Root cause
located one stage upstream: **the chaos game itself** (`chaos.wgsl`)
produces sample-deposit ratios that diverge from flam3 in exactly the
per-channel R signature direction for both fixtures. Same mechanism,
fixture-specific chromatic manifestation (over-green on 02226; over-
red+blue on 22289). Filed as `[PYR3-029]` — chaos-walker-coverage parity
audit. PYR3-017, PYR3-021 closed (superseded). PYR3-024 folded into
PYR3-029. Filed `[PYR3-030]` (f64 tonemap precision shim) as a secondary
post-029 precision-floor item.

**Empirical evidence (Phase C, both fixtures):**

```text
test                          02226                       22289
----------------------------  --------------------------  --------------------------
palette baking diff           MAD=0.000 (bit-identical)   MAD=0.000 (bit-identical)
tonemap k1/k2 math            identical to flam3          identical to flam3
DE ablation (--no-de)         Δ +0.09 R (radius=0)        Δ +2.33 R (radius=11)
spatial-filter inspection     faithful port               faithful port
🚨 chaos histogram ratio       g=1.442 (vs flam3 1.376)    r+b dominate (g half)
🚨 per-channel R signature     g=51.4 (matches over-G)    r=73.2 b=65.8 (matches r+b)
```

**Sub-hypotheses to bisect under PYR3-029 (ranked):**

1. Walker-pool seed dispersion at iter=0 (1024 ISAAC walkers may start
   too clustered, biasing initial exploration)
2. Bad-iter rollback semantic (flam3 `i -= 4; continue` nets `i -= 3`;
   pyr3 `i -= 1; continue` nets `i += 0` — different wall-iter
   consumption profiles)
3. Per-iter xform-pick RNG draw order (finalxform opacity-gated RNG
   draw at `chaos.wgsl:1660-1665` may consume in different order than
   flam3 `flam3.c:336-337`)
4. Color-contraction `new_z` propagation across bad iters

**Phase B sub-deliverable** (commit `1168656`): PYR3-023 step 1 pulled
forward — `scripts/pyr3-023-be-render-4k.mjs` aligned `FULL_MAX_DIM`
4096 → 3840 to match kotlin v1.1 `SHOWCASE_4K` preset. New
`scripts/pyr3-024-probe.mjs` measures pyr3-BE vs kotlin v1.1 JPG
directly (jpeg-js dep added). Eyeball gallery at
`.remember/verify/pyr3-024-divergence.html`.

**Files:**

- `BACKLOG.md` — PYR3-029 (chaos audit) + PYR3-030 (f64 tonemap shim)
  filed; PYR3-017 + PYR3-021 marked superseded; PYR3-024 folded into
  PYR3-029.
- `scripts/pyr3-023-be-render-4k.mjs` — `FULL_MAX_DIM` 4096 → 3840.
- `scripts/pyr3-024-probe.mjs` — pyr3 BE vs kotlin JPG R-compare rig.
- `scripts/pyr3-024-build-html.mjs` — eyeball gallery builder.
- `package.json` — `jpeg-js` dep added.

## v0.15 — 2026-05-27 — PYR3-026 FE↔BE quick-mode parity gate

**Outcome:** First of two v1.0 ship gates closed. Browser viewer (FE) and
Node CLI (BE) now have a regression-gated R-compare at quick-mode dims
(1024 long-edge, quality=16 SPP, oversample=1). Both engines render the
same 19 parity fixtures; the gate asserts `R(FE, BE) ≤ feBeThresholdR`
per fixture. Trigger: `npm run test:parity-fe-be` (toggled via
`VITEST_INCLUDE_PARITY_FE_BE=1`).

**Mechanism:**

1. **BE side:** new `--quick` and `--max-dim N` flags on
   `bin/pyr3-render.ts` mirror `src/main.ts` `rerender()`'s quick-mode
   math (size-cap + quality clamp + oversample=1 + scale rescale). Lets
   the CLI produce pixel-matched outputs vs FE.
2. **FE side:** new `window.__pyr3LoadFlame(text)` dev hook (mirrors
   the existing `__pyr3CapturePixels` hook in `src/main.ts`). Serializes
   loads behind an internal queue so the test rig's
   `__pyr3LoadFlame(A); __pyr3LoadFlame(B)` sequence doesn't hit
   `loadFromFile`'s in-flight rejection.
3. **Test rig:** `src/parity-fe-be.test.ts` clones `src/parity.test.ts`
   shape — discovers fixtures by directory scan, per-fixture spawns BE
   via `spawnSync`, drives FE via Playwright (Node API, not
   `@playwright/test`) + headless Chromium WebGPU (swiftshader software
   adapter, deterministic, ~3-5× slower than hardware but stable in
   CI/local). Writes per-fixture FE+BE PNGs + a diff PNG for the
   eyeball gallery.
4. **Calibration:** 2-run baseline measurement → variance < 1% across
   FE↔BE → thresholds set as `max(R) × 1.5 + 2.0` (generous; future
   tightening filed as follow-up). Per-fixture `feBeBaselineR` +
   `feBeThresholdR` stored in `meta.json`.

**R distribution (post-calibration, 19 fixtures):**

```text
best:   244.57686 + coverage.245.06687     R ≈ 0.46    thr 2.7
median:                                    R ≈ 6
worst:  coverage.247.28068                 R ≈ 19.40   thr 31.1
        coverage.243.04616                 R ≈ 19.28   thr 30.9
        coverage.248.33248                 R ≈ 15.78   thr 25.7
```

The high-R outliers (coverage.243.04616, coverage.247.28068, coverage.
248.33248) overlap with PYR3-018's FE-vs-flam3 sweep highs — these are
FE-side engine drift that exists in both FE↔flam3 and FE↔BE
comparisons. **Folds into the post-v1.0 deterministic-seed FE↔BE
calibration follow-up** (filed in BACKLOG).

**Wall-clock:** ~10 min for the full 19-fixture suite under swiftshader.
Local-only gate (no CI), runnable before merging any engine-touching PR.

**Files:**

- `bin/pyr3-render.ts` — `--quick`, `--max-dim N` flags
- `src/main.ts` — `__pyr3LoadFlame` dev hook, queue-serialized
- `src/parity-fe-be.test.ts` — new Vitest gate (19 tests, Playwright)
- `src/compare.ts` — R metric reused unchanged
- `scripts/pyr3-026-calibrate.mjs` — multi-run R aggregator →
  per-fixture `feBeThresholdR` in `meta.json`
- `scripts/pyr3-026-build-html.mjs` — eyeball gallery at
  `.remember/verify/pyr3-026-fe-be.html`
- `vitest.config.ts` — `VITEST_INCLUDE_PARITY_FE_BE` toggle
- `package.json` — `test:parity-fe-be` script + Playwright dep
- `fixtures/flam3-goldens/*/meta.json` — `feBeBaselineR` +
  `feBeThresholdR` per fixture

## v0.14 — 2026-05-27 — PYR3-023 probe + FE 4K removal pivot (BE-only 4K)

**Outcome:** Probed pyr3's `🎯 Render 4K` button against 5 kotlin v1.1
showcase fixtures via chrome-devtools-mcp + a fresh BE 4K wrapper. The
empirical finding pivoted the v1.0 strategy: **FE no longer supports
4K**; BE is the v1.0 4K renderer + ship-gate vehicle.

**Probe results — 5 showcase fixtures, FE + BE @ 4096 long-edge:**

```text
fixture     FE wall    BE wall    FE/BE ratio    category
----------  --------   --------   -----------    ---------------
247.19679    163.6 s    12.39 s     13.2×        OK
248.31324    159.0 s    11.75 s     13.5×        OK
243.09081     78.9 s    13.73 s      5.7×        OK
244.36880    CRASH      14.06 s      —           FE_CRASH_BE_OK
248.22289    CRASH      19.08 s      —           FE_CRASH_BE_OK + visual divergence
```

**The three load-bearing findings:**

1. **5/5 BE renders complete in 12-19s.** Engine is healthy at 4K.
2. **2/5 fixtures (244.36880, 248.22289) reproducibly crash the Chrome
   renderer tab** within ~30-45s of clicking `🎯 Render 4K` (page
   resets to `about:blank`, no preserved console messages). Same
   fixtures render fine on BE at identical 4096 dims → failure is
   Chrome-WebGPU-host-environment-specific, not an engine bug.
3. **FE/BE wall-clock gap = 13×** on the 3 fixtures that don't crash
   (79-164s FE vs 12-19s BE). Per-chunk rAF yields in
   `render-orchestrator.ts:107` + Chrome WebGPU overhead. Bad
   showcase UX even on the working fixtures.

**The pivot (user directive 2026-05-27):**

> "Should the front end support 4k, or should it support 'high' quality?
> ... I am not going to wait around 3 minutes for something I know takes
> 12 seconds. For now, remove the 'render 4K' button."

Following kotlin's v1.1 showcase pattern (pre-rendered static JPGs
served via gh-pages — the browser never renders 4K live), pyr3 FE is now
**interactive at quick-mode dims only** (1024 long-edge, 16 SPP).
4K renders happen via BE CLI (`bin/pyr3-render.ts` +
`scripts/pyr3-023-be-render-4k.mjs` wrapper). PYR3-007 showcase becomes
a curated static gallery of BE-rendered 4K assets, mirroring kotlin's
gh-pages layout.

**FE changes shipped:**

- `src/ui-bar.ts` — removed `onRender4K` from `BarOpts`, removed
  `renderBtn` from `Tier2` + creation site + busy/loading toggles + the
  row.append list.
- `src/main.ts` — removed `FULL_MAX_DIM/SPP/OVERSAMPLE` constants,
  removed `RenderMode` type, collapsed `renderInMode(mode)` →
  `rerender()` (only quick-mode logic remains; the `mode === '4k'`
  branches deleted as dead code). The `__pyr3CapturePixels` +
  `__pyr3LastHandle` dev hooks remain (still used by PYR3-018-style FE
  parity probing).

**Apples-to-apples baseline pinned to kotlin (for the BE 4K parity
rig — PYR3-023 next phase):**

```text
kotlin SHOWCASE_4K preset (pyr3-kotlin/cli/.../Preset.kt:39-49):
  TARGET_4K_LONG_EDGE   3840 px
  sizeScale             3840 / max(W, H)
  gpuQualityScale       1.0          (no per-pixel SPP compensation)
  --quality (showcase)  200          (overrides genome.quality)

pyr3 BE current (scripts/pyr3-023-be-render-4k.mjs):
  long-edge             4096 px      ← misaligns by 256 px (6.67% per edge)
  sizeScale             4096 / max(W, H)
  oversample            1
  SPP cap               200          (matches kotlin)
```

The 4096 → 3840 alignment is the first concrete fix in PYR3-023's
next-phase scope.

**BACKLOG re-scoped (3 new entries, 1 narrowed):**

- `[PYR3-023]` narrowed from "4K rendering failures + 4K-parity gate"
  to **"BE 4K parity gate vs kotlin v1.1 (V1.0 SHIP GATE)"** — the
  FE 4K work is gone; only the BE-vs-kotlin work remains.
- `[PYR3-024]` (new) — `248.22289` BE 4K visual divergence (folds
  into PYR3-021's upstream-stage hunt).
- `[PYR3-025]` (new, post-v1) — Chrome FE 4K renderer-tab-kill class
  insurance investigation. No longer v1.0-blocking; the failure
  surface is real and might surface elsewhere.
- `[PYR3-026]` (new, v1.0) — FE↔BE parity invariant at quick-mode
  dims. The FE-side half of the v1.0 ship gate now that FE no longer
  does 4K.

**Files touched:**

- `src/ui-bar.ts` — FE button removal (4 small surgical edits)
- `src/main.ts` — caps + RenderMode + renderInMode collapsed
- `BACKLOG.md` — PYR3-023 narrowed; PYR3-024/025/026 filed; next-ID
  bumped 024 → 027
- `README.md` — `## Status` block refreshed v0.11 → v0.14
- `ROADMAP.md` — v0.14 added to shipped table
- `.gitignore` — `fixtures/pyr3-4k-renders/` +
  `fixtures/showcase-probe-sources/` excluded (large derived /
  verbatim-copy)
- `scripts/pyr3-023-be-render-4k.mjs` (new) — BE 4K wrapper mirroring
  FE's `renderInMode('4k')` math; will graduate to a first-class CLI
  flag in PYR3-023's next phase
- `scripts/pyr3-023-build-html.mjs` (new) — 4-column eyeball-verify
  builder (meta+category / kotlin v1.1 JPG / pyr3 FE / pyr3 BE)
- `fixtures/kotlin-4k-refs/` (new tracked) — 5 kotlin v1.1 4K JPGs
  (244.36880, 243.09081, 248.22289 + symlink-style copies of
  247.19679 + 248.31324 from kotlin-goldens/) — reference fixtures
  for the upcoming BE 4K parity rig

**Tests:** `npm test` 4494/4499 (no regression vs v0.13). `npm run
typecheck` clean.

**Verification:** Chrome at http://localhost:5173/?mute=1 shows the bar
with only `📂 Open .flame` + `🔗 Share link` buttons; welcome flame
paints cleanly; zero console errors. Probe gallery at
`.remember/verify/pyr3-023-4k-probe.html` (gitignored) for the
eyeball-verify record.

**Out of scope (folded into BACKLOG):**

- The BE 4K parity rig itself — PYR3-023 next phase.
- The 4096 → 3840 alignment — first item in PYR3-023's next phase.
- The Chrome FE crash root cause — PYR3-025 (post-v1).
- The 13× FE/BE wall-clock gap — moot now that FE doesn't do 4K, but
  filed implicitly inside PYR3-025 as adjacent context.

## v0.13 — 2026-05-27 — Phase 3 cycle 5: 98-arm audit + 3 parity-completeness fixes ([PYR3-010] complete, +3 ships)

**Outcome:** Three load-bearing parity-completeness fixes shipped in
one bundle, driven by the v0.12 fan-out audit + two follow-up audits:

1. **`var_fan` WGSL `floor → trunc`** — fixes the one confirmed bug
   across 98 arms (FE/BE Euclidean-mod-vs-fmod divergence on negative
   `phi+dy`).
2. **`VARIATION_DEFAULTS` table** (port from
   `pyr3-kotlin/flam3/.../Flam3Parser.kt:348-390`) — closes a regression
   in pyr3's v0.1 peek-copy: 17 of 38 parameterized arms had non-zero
   canonical defaults (`julian_power=1`, `pie_slices=6`,
   `ngon_sides=5`, `oscope_frequency=π`, etc.) that pyr3 was silently
   zeroing whenever `.flame` XML omitted the attribute.
3. **Alias normalization** in `flame-import.ts` — adds `mobius`
   shorthand (`Re_A`..`Im_D`) and `oscope_*` prefix-alias coverage,
   matching flam3-C's parser at `parser.c:1136-1152` + `:1228-1243`.

**The 8-cluster A.2 audit (run via parallel `wgsl-parity-reviewer`
subagents):**

98 arms split across 8 clusters of ~12. Aggregate result:

```text
cluster   match  minor-diff  bisection  bug   total
--------  -----  ----------  ---------  ----  -----
C1         8       5          0         0      13
C2         9       3          0         0      12
C3         8       3          0         1      12   ← var_fan
C4        10       2          0         0      12
C5        12       0          0         0      12
C6         9       3          0         0      12
C7        11       1          0         0      12
C8        12       1          0         0      13
--------  -----  ----------  ---------  ----  -----
TOTAL     79      18          0         1      98
```

The 18 minor-diffs are all documented intentional deviations (FMA
contractions in kotlin vs plain mul+add, single-biased `r = sqrt+EPS`
modernizations in spiral/hyperbolic/diamond family, WGSL f32 clamps in
edisc/elliptic, `cpow` `|power|` signed-floor, etc.) — none require
porting. **The arm-engine is effectively clean.**

**Follow-up audits A + B (default-value + flame-import coverage):**

Audit A (default-value parity) found 17 of 38 parameterized arms with
non-zero kotlin/flam3-C defaults that pyr3 was zeroing. Audit B
(`flame-import.ts` XML attribute coverage) found 39 of 41 arms
complete; 2 partial (mobius `Re_A` shorthand + oscilloscope `oscope_*`
prefix). Both fixed in this ship.

**Per-fixture BE parity R deltas:**

```text
fixture                    pre     post    Δ
-------------------------- ------- ------- -------
coverage.248.02226         32.62   29.96   -2.66 🟢
244.82270                   3.32    3.33   +0.02
all other 17 fixtures      <same>  <same>  |Δ|≤0.02
```

The PYR3-017 fixture (the worst outlier in the parity suite, mystery
across investigations from v0.7 → v0.12) dropped 8% on the new defaults
alone. Residual R=29.96 still ~10× the suite average — fold into
`[PYR3-021]` (upstream-stage investigation pivot — palette / tonemap /
density / spatial-filter; the variation-arm hypothesis is fully ruled
out by the audit).

The other 18 fixtures all showed Δ within run noise (|Δ| ≤ 0.02),
because their `.flame` XMLs already supplied explicit values for every
parameterized arm's params. The defaults fix is silent for these but
will matter for any future fixture that elides params (Apophysis
exports, JWildfire variants, hand-authored .flame files).

**Files touched:**

- `src/serialize.ts:152` — new `VARIATION_DEFAULTS` table (port from kotlin)
- `src/flame-import.ts` — `ATTR_NAME_ALIASES` + `VAR_PREFIX_ALIASES` +
  `normalizeAttrName()` helper; refactored `parseXformElement` walker
  to consume a normalized `Map<string,string>`; `readVariationParams`
  now applies defaults for unspecified params
- `src/shaders/chaos.wgsl:535` — `var_fan` `floor → trunc`

**Tests:** `npm test` 4494/4499 (no regression). `npm run test:parity`
19/19 (all within thresholds, mostly unchanged within noise + the one
PYR3-017 drop).

**Follow-up backlog filed:**

- `[PYR3-021]` — PYR3-017 upstream-stage investigation pivot (palette /
  tonemap / density / spatial-filter probes via the local flam3 binary's
  `PYR3_DUMP_*` dump channels).
- `[PYR3-022]` — Default-palette fallback when `<flame>` lacks any
  palette block. Pyr3's parser throws; flam3-C falls back to its
  700-palette library. Low priority but a v1.0 parser-completeness gap.

**Closed:** `[PYR3-010]` 98-arm audit (completed via the v0.12 8-cluster
fan-out; only bug shipped here).

## v0.12 — 2026-05-27 — Phase 3 cycle 4: FE parity sweep + capture-hook engine API ([PYR3-018] shipped)

**Outcome:** First end-to-end FE-vs-flam3-C-golden parity measurement
across all 19 fixtures, gated on a new dev-only engine API
(`window.__pyr3CapturePixels`) that bypasses the WebGPU canvas
swap-chain readback limitation. 19/19 FE renders captured; eyeball
verify gallery at `.remember/verify/pyr3-018-fe-sweep.html`.

**The mechanism** (new `src/main.ts:97-159`):

WebGPU canvas swap-chain textures don't survive `drawImage(canvas)` or
`toDataURL()` — they're single-frame-presented to the compositor and
then conceptually consumed. The new hook mirrors the CLI's readback
path (`bin/pyr3-render.ts:99-122`): allocate an offscreen RGBA texture
with `COPY_SRC` usage, re-present the existing accumulated histogram
into it via `renderer.present()` (no re-iteration — chaos game state
is preserved between presents), `copyTextureToBuffer` → `mapAsync` →
strip row padding → swap BGRA→RGBA if the canvas format is
`bgra8unorm` (Chrome's preferred on macOS).

```ts
(window as any).__pyr3CapturePixels = async (): Promise<{
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  format: GPUTextureFormat;
}> => { /* ... */ };
```

Guarded by `import.meta.env.DEV` — production builds don't expose it.
Consistent with the existing `__pyr3LastHandle` dev hook precedent.

**The sweep harness** (new `scripts/pyr3-018-fe-collect.ts`,
`scripts/pyr3-018-build-html.mjs`):

Per fixture: chrome-devtools-mcp `upload_file` drives the 📂 Open
button → wait for `__pyr3LastHandle.promise` → call
`__pyr3CapturePixels()` → POST capture JSON to disk → Node-side
collector computes R + per-channel + per-region drift, writes the
FE-render PNG + an 8× visibility-scaled diff PNG, emits one-line
JSON metrics. Aggregated 19 results feed the HTML builder, which
produces a dark-theme 3-column gallery (golden / FE / diff) per
fixture with R pills colour-coded by Δ vs the BE baseline.

**The 19-fixture FE-R distribution** (sorted by Δ FE−BE):

```text
fixture                  dims       FE-R   BE-base  Δ      note
-----------------------  ---------  -----  -------  -----  --------
coverage.247.28068       800×592    15.04   5.17    +9.87
coverage.248.33248       800×592    12.94   4.92    +8.02
coverage.245.00381       800×592    11.96   4.42    +7.54
coverage.243.04616       800×592    18.70  11.55    +7.15
coverage.248.25196       800×592     8.02   2.18    +5.84
244.82986                800×592    15.37   9.90    +5.47
coverage.248.19873       800×592     5.25   1.58    +3.67
coverage.247.31007       800×592     5.17   1.52    +3.65
244.82270                800×592     6.77   3.32    +3.45
coverage.248.11405       800×592     4.72   1.36    +3.36
247.29388                800×592     5.95   3.00    +2.95
248.04487                800×592     5.14   2.32    +2.82
coverage.248.24236       1024×576    5.44   2.71    +2.73  subnative
coverage.247.20817       800×592     5.72   3.11    +2.61
248.11268                800×592     4.21   2.00    +2.21
coverage.248.02226       1024×576   34.27  32.62    +1.65  subnative
244.57686                800×592     1.27   0.45    +0.82
244.00016                800×592     4.34   3.98    +0.36
coverage.245.06687       1024×576   14.81  14.58    +0.23  subnative
```

All FE-R > BE-baseline, as expected — FE's quick-mode SPP cap
(`QUICK_MAX_SPP=16`) vs BE's genome-declared quality (~q=2000) is a
~125× sample-count gap → ~11× noise floor on the R metric. Most Δ
land in +2..+5 (consistent with the noise hypothesis). Six fixtures
show Δ > +5; these are the priority bisection candidates for the
PYR3-010 98-arm audit. Three fixtures (the 1280×720 ones — capped to
1024×576 by `QUICK_MAX_DIM`) had goldens nearest-neighbor downscaled
for the R compare.

**Findings (load-bearing):**

1. **Spec-correct gate.** The sweep measures FE-vs-flam3-C-golden
   directly, matching the v1.0 ship-gate definition. FE-vs-BE direct
   comparison is filed as `[PYR3-019]` (3-way verify) — useful but
   not the v1.0 acceptance criterion per the design spec §3
   determinism contract.
2. **WebGPU canvas readback is single-frame.** PYR3-018's original
   BACKLOG recipe (`evaluate_script` → `canvas.toDataURL`) returned
   all-black RGBA empirically because the swap-chain texture is gone
   by the time readback runs. The capture-hook approach is the
   architecturally correct fix and will be re-used for any future FE
   parity probe (PYR3-010 audit, PYR3-019 3-way verify).
3. **No FE-specific bugs surfaced in the sweep.** The Δ distribution
   is consistent with the noise-floor hypothesis; no fixture shows
   geometry/composition divergence beyond what BE already exhibits.
   PYR3-010 per-arm audit is the next gate.

**Bugs surfaced during the sweep (now in BACKLOG):**

- `[PYR3-019]` (new): 3-way FE+BE+golden verify HTML — user-requested
  as the right shape for future parity probes.
- `[PYR3-020]` (new): `?flame=` share-link decode fails with "Failed
  to fetch" for the ~6.6KB payload from `247.29388.flam3`. Repro is
  hard-coded into pyr3's share-link path; sweep proceeded via the 📂
  Open button. Real regression worth closing before v1.0.

**Test harness updates:**

- `scripts/pyr3-018-fe-collect.ts` (new) — per-fixture FE capture →
  R-compute → PNG + diff PNG side-effects.
- `scripts/pyr3-018-build-html.mjs` (new) — aggregates the JSONL
  results into the verify HTML.
- `.gitignore` — added `pyr3-fe-render.png` + `pyr3-fe-diff.png`
  (regenerated each sweep, alongside the BE equivalents).
- No engine-test regression: `npm test` 4494/4499 still green
  (`__pyr3CapturePixels` only mounts in DEV, no production-build
  surface change).

**Out of scope (folded into follow-up entries):**

- Re-rendering the 1280×720 fixtures at native dims (FE quick caps).
  The collector's golden-downscale handles the comparison, but a
  proper "FE parity mode" that bypasses `QUICK_MAX_DIM` is its own
  scope decision — likely needs a follow-up BACKLOG entry filed
  during PYR3-010 audit cycles.
- Threshold-tightening pass (B option from the big-swing menu) —
  deferred to a future rehash round per "ship light first."

**Verification:** Eyeball gallery at
`.remember/verify/pyr3-018-fe-sweep.html` shows all 19 fixtures
geometrically matching their goldens; the diff PNGs reveal the noise
floor as expected (high-frequency speckle, not low-frequency
divergence). Chrome screenshot at
`.remember/tmp/pyr3-018-html-preview.png`.

## v0.11.1 — 2026-05-27 — Test-split + README v0.11 refresh ([PYR3-012] shipped)

**Outcome:** `npm test` now runs the unit suite only (~1s wall, 4494/4499
green); the 19-fixture flam3-C parity suite moves behind
`npm run test:parity` (~91s wall, 19/19 green). `npm run test:all` runs
both. README's `## Status` block refreshed from stale "v0.7 — Phase 2
shipped" to "v0.11 — Phase 3 mid-flight" with the three Phase 3 cycles
named.

**The mechanism** (new `vitest.config.ts`):
```ts
const includeParity = process.env.VITEST_INCLUDE_PARITY === '1';
export default defineConfig({
  test: {
    exclude: [
      'node_modules/**',
      'dist/**',
      ...(includeParity ? [] : ['src/parity.test.ts']),
    ],
  },
});
```

`package.json` scripts:
- `test`         → `vitest run` (parity excluded)
- `test:parity`  → `VITEST_INCLUDE_PARITY=1 vitest run src/parity.test.ts`
- `test:all`     → `VITEST_INCLUDE_PARITY=1 vitest run`

**Why:** Pre-split `npm test` quietly invoked the 91s WebGPU parity
harness, making casual inner-loop test runs cost a full coffee break.
On any host without a Dawn-capable GPU (CI, Docker, contributor laptops
without WebGPU support) the parity tests would also fail non-cleanly.
PYR3-012 was filed by Phase 2 code review for exactly this DX hit.

**Bonus:** README Quick Start now names the three test entrypoints with
realistic wall-clock expectations instead of "full unit + parity suite"
(which was always misleading and grew more so).

**Verification:** `npm test` runs in 1.1s wall (was 89s+); `npm run
test:parity` 19/19 green in 91s; `npm run test:all` produces the union.

## v0.11 — 2026-05-27 — Opacity-clamp serialization hardening ([PYR3-016] shipped)

**Outcome:** Clamp `Xform.opacity` to flam3-spec'd [0, 1] at the GPU
serialization boundary (`genome.ts:packXformInto`). Defensive hardening
against malformed `.flame` input that passes `flame-import.ts` finiteness
validation but carries out-of-range values. Valid flames are unaffected
(all 19 parity fixtures use opacity ∈ {0, 0.39, 0.61904, 0.73, 1.0}).

**The change** (`src/genome.ts:281`):
```ts
buf[o + 10] = Math.max(0, Math.min(1, x.opacity ?? 1.0));
```
Zero perf cost. Prevents WGSL-implementation-defined `u32()` of negative
weights at `opacity < 0`, and histogram-bucket-overflow at `opacity > 1`
(post-PYR3-015, `weight = opacity * 255.0` so the count channel would
accumulate > 255 per hit if unclamped).

**Tests:** 4 new tests in `serialize.test.ts` cover the clamp at the
public `packXforms` boundary (in-range, negative-clamped, >1-clamped,
undefined→1 default). 4494/4499 tests pass.

Surfaced by code-review subagent on the PYR3-015 branch.

## v0.10 — 2026-05-27 — Phase 3 cycle 2: regular-xform alpha-scaling ([PYR3-015] shipped)

**Outcome:** Replaced the v0.9-era probabilistic splat-skip in `chaos.wgsl`
with deterministic per-xform alpha-scaling — flam3's actual
`adjust_percentage` semantic. **19/19 parity fixtures pass with all deltas
|ΔR| < 0.01 vs v0.9 baselines** — statistically equivalent to splat-skip
across the buffer, but deterministic (no RNG draw, no skip-vs-deposit
branching) and cleaner gradients at low SPP. No baseline recalibration
needed. Closes the regular-xform half of the v1.x-C-opacity port that
PYR3-009 started.

**The change** (`src/shaders/chaos.wgsl`):

Inside the `if (i >= u.fuse)` splat block, removed the `if (opacity < 1.0)`
→ `if (rand01() >= opacity) continue;` stochastic skip and replaced it with
a deterministic `weight = opacity * 255.0` that scales BOTH the rgb and
count (alpha) channels of the histogram deposit. opacity=0 → zero deposit
(rgb=0, count=0, no contribution); opacity=1 → full deposit (matches the
old fast-path); intermediate values deposit proportionally. Trajectory
update is unaffected — only the histogram contribution is gated, matching
v0.9 splat-skip's chaos-game-state contract.

**Mid-cycle bug-and-fix (worth surfacing):**

First impl (`cd3e6f5`) scaled only the rgb channels per the BACKLOG
recipe — and regressed `coverage.248.33248` R 4.92 → 8.57. Root cause:
that fixture has an `opacity="0"` xform; depositing count=255 with rgb=0
creates a "ghost density" region the tonemap reads as legitimate dark
pixels. Fix (`f99868e`): scale the count channel by opacity too, making
the full deposit weight linear in opacity. With count-scaling, all 19
fixtures returned to within |ΔR| < 0.01 of v0.9 baselines. The BACKLOG
recipe was incomplete on this point; updated PYR3-015's archived rationale
in this entry instead.

**Per-fixture R (representative sample — full 19/19 in
`.remember/tmp/v0.10-parity-post-fix.log`):**

| Fixture | v0.9 baseline | v0.10 R | Δ | Note |
|---|---|---|---|---|
| `coverage.248.33248` | 4.9229 | 4.9250 | +0.002 | `opacity="0"` xform — caught the count-scaling bug |
| `coverage.248.24236` | 2.7065 | 2.6988 | −0.008 | BACKLOG-flagged regression-risk #2; held |
| `coverage.248.11405` | 1.3610 | 1.3582 | −0.003 | PYR3-009 win held |
| `coverage.248.25196` | 2.1809 | 2.1844 | +0.004 | PYR3-009 win held |
| `coverage.248.02226` | 32.6200 | 32.6267 | +0.007 | biggest R outlier; mystery unchanged |
| other 14 | (baseline) | (~same, <0.01) | flat | within run noise |

**Documentation sync:** Updated `src/genome.ts:34-41` `Xform.opacity` field
comment to describe the alpha-scaling contract (was still describing v0.9
splat-skip). Surfaced by code-review subagent.

**Follow-up backlog:**

- **`[PYR3-016]`** (new): opacity-clamp hardening in `genome.ts:277`
  serialization layer. `flame-import.ts:350` validates finiteness but not
  range. A malformed `.flame` with `opacity` outside [0, 1] would reach the
  shader and cause WGSL-implementation-defined `u32()` of negative values
  or histogram-bucket overflow on `opacity > 1`. Defensive hardening; no
  effect on valid flames. Surfaced by code-review subagent.

**Perf note:** Replaces a stochastic branch + RNG draw per iter with a
deterministic multiply on the hot path. Net should be neutral-to-faster;
no formal perf gate at this stage.

## v0.9 — 2026-05-27 — Phase 3 cycle 1: finalxform-opacity gate ([PYR3-009] shipped — half-port)

**Outcome:** Ported kotlin's finalxform-only opacity gate to `chaos.wgsl`'s
finalxform block. **R dropped ~81% on both [PYR3-009] reference fixtures**
without regressing any of the other 17. First Phase-3 "iterate-toward-v1.0"
cycle: hypothesis → implementation → measurement → ship.

**Per-fixture R deltas (post-PYR3-009 vs v0.8 baseline):**

| Fixture | Pre R | Post R | Delta | Note |
|---|---|---|---|---|
| **coverage.248.11405** | 7.5131 | **1.3610** | **−6.15 (−81.9%)** | finalxform op=0.73 — `[PYR3-009]` ref |
| **coverage.248.25196** | 11.3177 | **2.1809** | **−9.14 (−80.7%)** | finalxform op=0.39 — `[PYR3-009]` ref |
| all other 17 | (baseline) | (~same, < 0.02) | flat | within run noise |

Both [PYR3-009] reference fixtures' thresholds tightened: 248.11405 8.51 →
2.50, 248.25196 12.32 → 3.50. Other 17 fixtures' thresholds unchanged.

**The change** (`src/shaders/chaos.wgsl`):

Inside the finalxform block (`if (u.final_xform_idx >= 0)`), gate the lens
application by `fxf.color_params.z` (= opacity). RNG draw is short-circuited
when `opacity == 1.0` per `flam3.c:336-337` — preserves RNG-determinism for
the common opaque-finalxform case. When the gate fails, `splat_p` stays at
`p_pre_final` (the pre-lens default), so the deposit lands at the pre-
finalxform position — mirrors flam3's behavior of leaving `q[]` unchanged
when the opacity gate fails (`flam3.c:335-341`). WGSL `||` isn't spec-
guaranteed short-circuit; nested-if keeps `rand01` unconsumed when
`opacity == 1.0`. Port: `pyr3-kotlin core/src/main/kotlin/pyr3/core/CpuF64Backend.kt:566-585`.

**Mid-cycle discovery (worth noting):**

A first pass also removed the existing per-regular-xform splat-skip block
(treating it as redundant with the new finalxform gate). That regressed two
fixtures (coverage.248.24236, coverage.248.33248) with regular xforms at
opacity < 1 — they rely on the splat-skip as a coarse stand-in for flam3's
actual regular-xform behavior (alpha-scaling via `adjust_percentage`,
`variations.c:2044`, kotlin's PYR3-035 equivalent). Restored the splat-skip;
ship is the finalxform-half port only. Splat-skip is sample-noisier but
statistically equivalent to alpha-scaling (opacity=0 → no splat = no color;
opacity=0.5 → ½ samples = ½ accumulated color); the destination port lives
in a separate, larger fix.

**Follow-up backlog:**

- **`[PYR3-015]`** (new): regular-xform opacity → alpha-scaling per
  `flam3`'s `adjust_percentage` path (kotlin's PYR3-035 equivalent). Current
  splat-skip stand-in is correct on average but noisier at low SPP than
  proper alpha-scaling would be. Larger fix — touches tonemap path, not just
  the chaos-game shader.

**Closes:** `[PYR3-009]` (the finalxform half — the spec was specifically
finalxform-only gating; the per-regular-xform path is a separate entry now).

## v0.8 — 2026-05-27 — Parity fixture set expanded 3 → 19 ([PYR3-011] shipped)

**Outcome:** 16 more flam3-C goldens lifted from `pyr3-kotlin/parity/goldens/`
without needing to build flam3-C locally — kotlin already had `flame.png` (the
flam3-C-binary golden, per its `bakeOrLoad` cache contract) for 16 fixtures we
hadn't pulled yet. Parity rig now covers 19 fixtures spanning a much wider R
distribution (0.45 → 32.62), which gives Phase 3 fixes proper triangulation.

**Fixtures added (16):**

| ID | Dims | baselineR | thresholdR | Notes |
|---|---|---|---|---|
| 244.00016 | 800×592 | 3.98 | 5.00 | low-quality fixture (q=5), fast render |
| 244.57686 | 800×592 | **0.45** | 1.45 | best parity in the set |
| 244.82270 | 800×592 | 3.32 | 4.32 | |
| 244.82986 | 800×592 | 9.90 | 10.90 | |
| coverage.243.04616 | 800×592 | 11.55 | 12.55 | |
| coverage.245.00381 | 800×592 | 4.42 | 5.42 | |
| coverage.245.06687 | 1280×720 | 14.58 | 15.58 | quadrant skew (br=43.90) |
| coverage.247.20817 | 800×592 | 3.11 | 4.11 | |
| coverage.247.28068 | 800×592 | 5.17 | 6.17 | |
| coverage.247.31007 | 800×592 | 1.52 | 2.52 | |
| coverage.248.02226 | 1280×720 | **32.62** | 33.62 | highest divergence — Phase 3 priority |
| coverage.248.11405 | 800×592 | 7.51 | 8.51 | **finalxform op=0.73 — `[PYR3-009]` ref** |
| coverage.248.19873 | 800×592 | 1.58 | 2.58 | |
| coverage.248.24236 | 1280×720 | 2.71 | 3.71 | |
| coverage.248.25196 | 800×592 | 11.32 | 12.32 | **finalxform op=0.39 — `[PYR3-009]` ref** |
| coverage.248.33248 | 800×592 | 4.92 | 5.92 | |

All baselines = mean over 3 deterministic-within-machine runs on M-series +
Dawn-node 2026-05-27; variance < 0.02 per fixture. Thresholds = baseline +
~1.0 (start permissive; tighten in Phase 3).

**Mixed dimensions:** 16 fixtures at 800×592 + 3 at 1280×720. `parity.test.ts`
reads dims from the PNG; no harness changes needed.

**Phase 3 unblocking:**

- `[PYR3-009]` (opacity-gate semantics: finalxform-only vs per-xform-splat)
  now has its reference fixtures (`coverage.248.11405` op=0.73,
  `coverage.248.25196` op=0.39) and both show meaningful R divergence (7.5
  and 11.3 respectively) — the rig will measure whether the kotlin
  finalxform-only port reduces R.
- `coverage.248.02226` at R=32.6 is the biggest signal in the set — worth
  eyeballing its `diff.png` early in Phase 3 to identify the divergence
  shape (likely a tonemap, gamma, or finalxform issue given the cross-
  quadrant variance: bl=71.4 vs br=31.6).

**Closes:** `[PYR3-011]` (was: "expand to 5-7 flames; requires building
flam3-C locally" — turned out neither prereq was needed; lifting from kotlin
covered it).

**Files (16 new fixture dirs):**

`fixtures/flam3-goldens/{244.00016, 244.57686, 244.82270, 244.82986,
coverage.243.04616, coverage.245.00381, coverage.245.06687, coverage.247.20817,
coverage.247.28068, coverage.247.31007, coverage.248.02226, coverage.248.11405,
coverage.248.19873, coverage.248.24236, coverage.248.25196, coverage.248.33248}/`
— each with `golden.png` + `<id>.flam3` + `meta.json`.

**New backlog (surfaced this phase):**

- `[PYR3-014]` Vitest worker RPC timeout on 89s parity suite (cosmetic — all
  tests pass, just emits an "Unhandled Error" log line at the end).

## v0.7 — 2026-05-27 — Phase 2: parity test rig + flam3-C goldens

**Outcome:** Phase 2 acceptance met. The harness produces R scores for
3 fixtures via the BE (Node CLI) path, gated by per-fixture thresholds in
Vitest; the FE (chrome-devtools-mcp + browser) path is lead-driven via
`scripts/fe-parity.ts`. Phase 3 (iterate to v1.0 ship gate) now has the
objective parity signal it needs.

**Shipped pieces:**

- 🧮 **R-metric ported verbatim from kotlin** — `src/compare.ts` exports
  `meanAbsDiffRgba` (scalar gate), `perChannelDrift`, `perRegionDrift`,
  `meanAbsDiffAccumulator`. 19 unit tests. Same validation messages, same
  empty-array semantics, same RGB-alpha-ignored semantics, same load-bearing
  `/ 3.0` in `perRegionDrift`.
  *Port: pyr3-kotlin `parity/src/main/kotlin/pyr3/parity/Compare.kt`.*

- 🖼️ **3 flam3-C goldens lifted from pyr3-kotlin** — `247.29388`, `248.04487`,
  `248.11268` (all 800×592 RGBA). Each fixture: `golden.png` + source `.flam3`
  + `meta.json` carrying `baselineR` + `thresholdR`. Lives under
  `fixtures/flam3-goldens/<id>/`. Building flam3-C locally to add more
  fixtures is deferred to `[PYR3-011]`.

- 🪲 **Two-layer parity output: scalar gate + visual diagnostic** — every
  parity run computes R + per-channel + per-region drift AND writes a
  visibility-scaled `diff.png` to `fixtures/flam3-goldens/<id>/diff.png` so
  the lead can `open` the divergence map in 2 seconds when a fixture fails.
  R alone is spatially blind; the diff PNG closes that gap. New helper at
  `src/diff-image.ts`.

- ⚙️ **BE harness in CI** — `src/parity.test.ts` discovers fixtures, spawns
  `bin/pyr3-render.ts` per fixture via `child_process`, decodes both PNGs,
  computes all four metrics, writes the diff PNG, asserts
  `R ≤ thresholdR` when calibrated. `npm run test:parity` added to scripts.

- 🌐 **FE harness lead-driven (not Vitest)** — `scripts/fe-parity.ts`
  prints a `?flame=v1:<base64>` share URL + step-by-step
  `chrome-devtools-mcp` instructions; reads captured canvas RGBA on stdin
  in `compare` mode and prints FE-R + drift breakdown. Pairs with a
  dev-only `window.__pyr3LastHandle` hook in `src/main.ts` so the MCP
  session can `await` the render before capturing.

- 📐 **Per-fixture R baselines + thresholds calibrated** (mean over 3
  deterministic-within-machine runs on M-series + Dawn-node):

  | Fixture | baselineR | thresholdR | per-channel skew (r/g/b) |
  |---|---|---|---|
  | `247.29388` | 3.0030 | 4.00 | 5.79 / 3.68 / 2.53 |
  | `248.04487` | 2.3248 | 3.32 | 2.87 / 3.12 / 3.31 |
  | `248.11268` | 1.9951 | 3.00 | 2.74 / 2.88 / 2.35 |

  Gate verified live by flipping `248.11268.thresholdR` to `1.50` (below
  baseline) and confirming the expected FAIL; reverted to 3.00.

**Out of scope (deferred):**

- Building flam3-C locally to add more fixtures → `[PYR3-011]`.
- Tightening R thresholds aggressively → Phase 3 iteration.
- `TwoSeedGate` / two-seed noise-floor logic → post-v1.0 if needed.
- FE parity in CI (needs a headless-browser-with-WebGPU CI runner) → out
  of scope for v1.0.

## v0.3 — 2026-05-27 — Phase 1: kotlin-fix audit-port pass (no code changes — pyr3-peek was already aligned)

**Outcome:** 11 of 12 enumerated kotlin GPU / parser / variation fixes from
v0.10 → v1.x-E are either already present in pyr3-peek's source or
structurally non-applicable. The "audit-port" phase reduces to a
documented audit + 1 follow-up investigation.

**Audit table:**

| kotlin ref | what | status in pyr3 |
|---|---|---|
| v0.28b | DE u32 signedness (`DensityEstimator.kt`) | **N/A** — WGSL `array<u32>` + `f32(hist[i])` is structurally unsigned; the kotlin/JVM `IntArray[i].toLong()` sign-extension bug class cannot manifest in WGSL |
| v0.32 | `TonemapPass` u32 signedness | **N/A** — same reason as v0.28b |
| v0.36-A | EDISC `acos` / `sqrt` precision-crater clamp | **ALREADY PORTED** (`chaos.wgsl:957-960`, attributed to "Batch F wgsl-shader-reviewer fix") |
| v0.36-H | sub-ulp ±5e-7 walker jitter (fractalapple class) | **ALREADY PORTED** (`chaos.wgsl:1714-1725`, explicit `Port: pyr3 chaos.comp:2580-2599` reference) |
| v1.x-E | DE + spatial filter on GPU readback path | **ARCHITECTURALLY EQUIVALENT** — peek's `visualize_u32.wgsl` + `visualize_f32.wgsl` both bake Gaussian spatial-collapse into the fragment shader (lines 139-160); no separate `TonemapPass` vs `PostProcessPipeline` split exists, the equivalent of v1.x-E's fix is the design |
| v0.27 | k2 supersample² fix in calibration | **ALREADY PORTED** (`calibration.ts:16-17, 41` — `oversampleSq` in k2 numerator per `rect.c:936-937`) |
| v0.21 | `pre_blur` variation (V=97) | **ALREADY PORTED** (`chaos.wgsl:1362-1363` "V=97 pre_blur handled pre-switch in 2-pass loop") |
| v0.19 | xaos transition matrix + background color | **ALREADY PORTED** (`genome.ts:43` xaos field + `chaos.wgsl:55,124` xaos_buffer pack) |
| v0.5 | per-xform post-affine | **ALREADY PORTED** (`genome.ts:44` "Phase 9c" + `chaos.wgsl:92-95` post0 vec4f slot) |
| v0.14a | parser: palette-by-index, hue, multi-value color, float-rgb | **ALREADY PORTED** (`palette.ts:20,28,34-40,75-77` hue rotation; `flame-import.ts:445` hue attr) |
| v0.14b | HSV highlight-power desaturation | **ALREADY PORTED** (`visualize_u32.wgsl:79-104` calc_newrgb with rgb2hsv branch) |
| v0.29.1 | PaletteEntry Int → Double widening | **N/A** — JS `number` is always f64; no Int/Double mismatch class exists in TS |
| v0.29.3 | NaN-propagation defense (Xform init guard) | **ALREADY PORTED** (`flame-import.ts` 5+ `Number.isFinite` guards at parse sites) |
| v1.x-C-opacity | finalxform opacity gate | ⚠️ **DIFFERENT SEMANTICS** — peek implements per-xform splat-skip opacity gating (`chaos.wgsl:1727-1738`, "Phase 9d probabilistic splat skip"); kotlin implements finalxform-only flam3-faithful gating with `rand01 < opacity`. Both have merit. Filed as `[PYR3-009]` for empirical investigation against fixtures with `finalxform opacity < 1` (kotlin's reference: `coverage.248.11405` op=0.73, `coverage.248.25196` op=0.39 — neither in our current fixture set). |

**Variation count:** 98 `var_*` functions in `chaos.wgsl`, matching kotlin's
"98/99 shipped, `gdoffs` is the JWildfire/Apophysis-only gap" claim from
pyr3-kotlin VISION.

**Skipped (JVM-specific, not portable):**
- v0.31, v0.33, v0.34, v0.34.1, v0.35 — `Math.fma`, Pair allocation,
  `StrictMath` vs `Math`, JVM inlining flags
- v0.36-B...G, v0.36-I, v0.37-A/B, v0.38 — AutoRoute, kotlin showcase
  harness, bench infra
- v1.x-D-pivot, v1.x-D, v1.x-A, v1.x-B-revival, v1.x-C-cpu-progress —
  docs / strategy / CPU-path work

**Follow-up BACKLOG opened:**
- `[PYR3-009]` Opacity-gate semantics investigation (finalxform-only vs
  per-xform-splat) — empirical comparison against kotlin's
  `coverage.248.11405` reference flame.
- `[PYR3-010]` Variation-arm bit-parity audit — sweep all 98 arms in
  `variations.ts` + `chaos.wgsl` against kotlin's port for any
  algorithmic divergence (kotlin has known bilateral-probe data for
  many).

**Why the audit lands as a doc-only ship rather than a stream of ports:**
Per CLAUDE.md "Audit backlog items before bundling — pulling N backlog
entries into a polish phase → verify each is actually unshipped against
current code first." Audit before code. The user named "different maths
involved, signed/unsigned" as a specific concern; both signedness fixes
turn out N/A in TS+WGSL by language semantics, which is itself
load-bearing context worth pinning. This is exactly the surface the
audit was designed to surface.

## v0.2 — 2026-05-27 — Camera-zoom bug fix (the one pyr3-peek couldn't crack)

**One-line fix in `src/main.ts` closes the long-standing "camera looks zoomed
in, stuck right at the middle point" symptom in the browser viewer.**

**Symptom:** browser quick-mode renders of Electric Sheep flames that declare
`supersample > 1` in their XML showed an extreme-close-up of the central
attractor instead of the full composition. CLI renders of the same flames
worked correctly. pyr3-peek's owner could not isolate the cause across
multiple sessions.

**Root cause:** `chaos.ts:173-174` computes the WGSL `scale` uniform as
`g.scale * g.oversample`, reading `oversample` from the **genome**, not from
the pipeline configuration. In quick mode `main.ts` builds the pipeline at
`oversample=1` and rescales `g.scale` to fit the canvas — but it left
`g.oversample` at the genome's declared `supersample` (typically 4 for ES
flames). Result: the WGSL uniform = `rescaled_scale × 4` — a 4× over-zoom in
projection, exactly the "stuck at middle" symptom.

**Fix:** `renderGenome.oversample = targetOversample` so the genome's
oversample stays aligned with the pipeline's configured oversample.

**Diagnostic process (symptom-before-hypothesis):**
1. Pulled kotlin v1.1 4K reference (`fixtures/kotlin-goldens/electricsheep.247.19679.v1.1.gpu.4k.jpg`)
2. CLI render at genome-native 1280×720 oversample=4 q=2000 — **matches kotlin
   reference visually** (12.32s wall, 1.2 MB PNG). Engine works.
3. CLI render at browser params (1024×576 oversample=1 q=16, via hand-edited
   .flame) — **still matches kotlin composition** at lower quality. So
   neither quality nor supersample/oversample alone causes the symptom.
4. Compared CLI's `renderer.render()` vs browser's
   `reset+iterate+present` chain — same internal API.
5. Grep for `g.oversample` usage — single occurrence in `chaos.ts:173`,
   reading from genome.

**Verification:** Chrome reload at `localhost:5173/?mute=1` shows
`electricsheep.247.19679` rendering with the correct diagonal sweep + dense
filament fill, matching kotlin v1.1 reference. `npm test` 4471/4471 green.
`npm run typecheck` clean. Screenshot at `.phase1-fe-fixed-orig-orch.png`.

**Follow-up:** `[PYR3-008]` — refactor chaos.ts to take oversample from
the pipeline (defensive against future host setup bugs of the same shape).

This is the load-bearing precondition for Phase 1's broader kotlin-fix
audit-port pass: with the camera now correct, all subsequent visual
comparisons FE-vs-flam3 will be meaningful.

## v0.1 — 2026-05-27 — Phase 0: TS+WGPU engine basis

- **Copied pyr3-peek wholesale** into this repo: `src/` (engine + 5 WGSL shaders + 15 Vitest
  suites), `bin/` (`pyr3-render.ts` CLI + `pyr3-bench.ts` + `flame-to-json.ts` + WGSL loader
  hook), `scripts/`, `tests/`, `fixtures/`, `help/`, `index.html`, `vite.config.ts`,
  `tsconfig.json`, `package.json` + `package-lock.json`.
- **Renamed** package `pyr3-peek` → `pyr3`, version `0.0.0` → `0.1.0`, description updated to
  reflect dual-consumer scope (browser + headless CLI from one engine).
- **Stripped peek-specific identifiers** across 7 files (`src/main.ts` log prefixes,
  `src/ui-bar.ts` wordmark, `index.html` `<title>`, `src/genome.ts` + `src/load-intent.ts`
  comments, two test-fixture strings). All `console.*` output now reads `pyr3: ...`.
- **Verified end-to-end:** `npm install` (67 packages) · `npm test` (4471 passed, 5 skipped,
  0 failed across 15 test files in 620 ms) · `npm run typecheck` (clean) · `npm run render
  fixtures/electricsheep.247.12151.flam3` (PNG written in 5.22s on M-series, oversample=4,
  800×592) · `npm run dev` + Chrome verify at `http://localhost:5173/?mute=1` (welcome
  flame `electricsheep.247.19679` renders correctly, no console errors).
- **Lineage attribution:** every source file carrying peek's TS+WGSL inherits its history
  per NOTICE.md; fresh git history, peek is not a remote.
- Known minor: Node prints `DeprecationWarning: module.register() is deprecated` from the
  WGSL loader hook during CLI render — non-fatal, queued for cleanup.

## v0.0 — 2026-05-27 — Project genesis

- Initial 6-doc structure seeded: `VISION` · `ROADMAP` · `BACKLOG` · `CHANGELOG` · `CLAUDE`
  · `README` + `NOTICE` + `LICENSE` (GPL-3.0-or-later).
- Locked decisions captured in
  [`docs/superpowers/specs/2026-05-27-pyr3-design.md`](docs/superpowers/specs/2026-05-27-pyr3-design.md):
  TS + WebGPU + Vite + Node + `webgpu` npm (dawn-gpu/node-webgpu), GPU-only, one-engine /
  two-consumers, "similar but not the same" R-tolerance contract vs flam3-C.
- Runtime pick `Node + webgpu npm` backed by parallel-dispatched research agents (vs Deno,
  Bun, `@kmamal/gpu`) per CLAUDE.md "dueling agents for load-bearing decisions" rule.
- Lineage documented: TS+WGSL basis to be Phase-0-copied from
  [pyr3-peek](https://github.com/MattAltermatt/pyr3-peek); GPU/parser/variation fixes
  audit-ported from [pyr3-kotlin](https://github.com/MattAltermatt/pyr3) during Phase 1.
- BACKLOG seeded with `[PYR3-001]` through `[PYR3-007]` (editor, Markov research, perf,
  variation audit, single-binary CLI, CI, showcase gallery).
- Local git identity: `MattAltermatt`. GPL-3.0-or-later. `main` as default branch.
- No engine code yet — `Phase 0` (copy pyr3-peek) begins next session.
