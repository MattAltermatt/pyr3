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
npm run render <in.flam3> <out.png>                # BE CLI render at genome-native dims (tsx ESM)
npm run render -- --long-edge 1024 --quality 16 <in> <out>   # explicit output sizing (the `--preset` alias was removed in #436 — nothing hidden on the CLI; --long-edge/--quality force the long edge / SPP, --max-dim N caps)
npm run render -- --oversample 2 <in> <out>                  # supersampling: render internal histogram at N× linear then box-downsample to output → spatial AA + sub-pixel detail (flam3 `supersample`; overrides genome.oversample, 1=off). Total samples are per OUTPUT pixel (constant in N), so DE + downsample recover density
npm run render -- --long-edge 3840 --quality 200 <in> <out>  # 4K reference (the old `--preset 4k`)
npm run render -- --format png8|png16|exr|exr-linear <in> <out>  # output format (default png8): png8/png16=display-referred PNG (what you see) · exr=display image stored as linear-light 32f OpenEXR → opens looking like the editor in any viewer (sRGB_to_linear of the display pixels; uncompressed) · exr-linear=ADVANCED raw scene-referred linear HDR (pre-log/pre-gamma, huge range — tonemap in post) (#334)
npm run render -- --transparent <in> <out>         # transparent background for png8/png16 (no effect on exr) (#334)
npm run render -- --color-mode flow <in> <out>              # velocity/flow-map coloring (#459): color each splat by its per-iteration displacement — direction → hue, log-saturated magnitude → brightness. Works on ANY flame; a render-time VIEWING mode (not a genome field). Tune with `--flow-strength F` (0..1 blend over the palette, default 1) and `--flow-scale F` (magnitude log-saturation, default 2). Default `--color-mode palette` is the normal render
npm run render -- --color-mode trap-distance --trap-kind point|circle|line <in> <out>   # trap-distance coloring (#460): color each splat by its INSTANTANEOUS distance to a trap shape, mapped through the flame's gradient → glowing contours that hug the shape. A render-time VIEWING mode (not a genome field), like flow. Geometry: `--trap-center X,Y` · `--trap-radius R` (circle) · `--trap-angle DEG` (line). Falloff: `--trap-mode glow` (single contour, `--trap-falloff F`) or `rings` (repeating bands, `--trap-freq N`). Blend via `--trap-strength S` (0..1, default 1). NB: instantaneous distance, NOT min-over-orbit (that smears in the chaos-game accumulation model)
npm run render -- --xform-blend 0.5 <in> <out>              # interpolated xform fields (#456): with prob λ=0.5 each chaos-game iteration blends a SECOND xform's OUTPUT into the splat (pv = mix(pv_A, pv_B, t), t~U(0,1)) → soft morphing attractors / a continuum of in-between shapes. A GENOME field (Genome.xformBlend, λ∈[0,1]), animatable through the timeline like rotate. λ=0 = off → byte-identical to the discrete IFS (26/26 parity fixtures untouched). Edit live via the editor Scene lens "xform blend" slider. Partner B is whole-set + xaos-invisible; primary A owns prev_xform/opacity/DC/colour-base
npm run render -- --color-mode phase <in> <out>             # Phase / Polar domain-coloring (#465): read each splat point as a complex number z = (x,y) and color it by arg(z) → hue with log|z| → brightness contour rings — the classic complex-domain-coloring look. A render-time VIEWING mode (not a genome field), like flow/trap. Tune with `--phase-strength S` (0..1 blend over the palette, default 1) and `--phase-freq F` (log-modulus ring frequency, default 1; **0 = pure phase field**, no rings). atan2 is angle-bounded (no Dawn trig cliff). NB: phase-TINTED density, not a plane-filling f(z) portrait — true f-orbit phase semantics only hold on a single-xform / identity-affine complex-map genome
npm run bundle:cli render                           # produce build/.tmp/pyr3-render.cjs (esbuild bundle)
npm run smoke:cli                                   # end-to-end smoke for the bundled CJS
npm run build:cli render                            # produce ./build/pyr3-render — standalone SEA binary (~155 MB)
npm run serve                                       # `pyr3 serve` — local CLI host w/ Dawn-node backend rendering (lifts the 200-q browser cap; #201)
npm run animate <in.flam3> <out-dir>                # headless keyframe-animation render — companion to the /animate viewer (#209)
npm run animate -- <in> <out-dir>                   #   env: width=W height=H (absolute output dims, long-edge rescale; #274) · resume=1 (skip frames already on disk; #275) · nsteps=N (motion-blur sub-frames/frame; DEFAULT 1 — NOT the imported ntemporal_samples, which is up-to-1000 for ESF/timeline; #294)
npm run build:cli:serve                             # produce ./build/pyr3-serve — standalone SEA (bundles the render + animate subcommands)
npm run bake:natives                                # ingest pyr3-native flames into the gen-1000 gallery surface (#435). DEFAULT src is now `~/pyr3-flames/json` (the curated library from `flames:ingest`); pass `-- --src <dir>` to override. Accepts `.png` w/ embedded `pyr3` genome AND raw `.pyr3.json`; idempotent (canonical-genome-hash ledger → stable ids + dedup; a PNG and its `.pyr3.json` twin collapse to one); commit public/chunks/1000 + public/chunks/pyr3-*.* + flames/pyr3-natives/ledger.json
# --- ~/pyr3-flames curate + publish pipeline (the user's own flames → the live gallery) ---
npm run flames:ingest                               # Pass 1/3: incoming/ → json/<id>.pyr3.json (id = gallery ledger id, 5-pad bare). Default match-only + dry-run; `-- --add-new` mints new ids for not-yet-gallery flames; `-- --apply` writes+deletes consumed sources. Writes RAW parsed pyr3-JSON (never genomeToJson — ids can't drift)
npm run flames:backfill                             # Pass 2: materialize any ledger id missing from json/ from the committed chunks (`-- --apply`); throws on hash/id drift (skips the `_v` chunk sentinel)
npm run flames:render                               # Pass 4: HQ reference renders json/<id>.pyr3.json → renders/<id>.{png,exr} (default 3840px long-edge, q2000, png16 16-bit master, oversample 2 supersampling). RESUMABLE — skips ids already rendered, atomic .tmp→rename so Ctrl-C never leaves a corrupt file; per-render progress [n/total] · remaining · measured ETA. Flags: `-- --long-edge N --quality N --oversample N --format png16|png8|exr|exr-linear --limit N`
# Pass 3 (recurring publish): the /pyr3-publish-flames skill — flames:ingest --add-new → bake:natives → typecheck+test → commit → push → verify pyr3.app
```

The nav is **7 top menus** (#264, expanded in #420, Creator added in #437) — the row is **left-aligned**
right after the `pyr3` brand (#420 retired the old centered grid + the brand-cluster
About link): **Viewer** · **Editor** (`/editor` — direct
link; the old Gradient page `/gradient` was retired in #372 and now redirects
to `/editor`, where the gradient editor is an in-lens overlay) · **Creator** (#437 —
direct link to `/creator` (route renamed from `/surprise`, which now redirects
here), promoted out of the Discover dropdown) · **Animate ▾** (Timeline `/animate` · Screensaver
`/screensaver`) · **Flame Gallery ▾** (#340 — was "ESF": Browse `/browse` +
`/browse/gen/N/id/M` · Gallery `/gallery` · Electric Sheep Fold ↗ source repo; the
`/esf/*` prefix was flattened to `/browse` + `/gallery` in #449 — old `/esf/*`
URLs redirect at boot via `src/route-redirects.ts`). The
gallery is the ESF corpus PLUS **pyr3-native originals under reserved gen 1000** (#435) —
gen 1000 > every ESF gen, so under the gallery's newest-first order the natives **lead page 1**.
Natives are pyr3-JSON-in-chunk (not flam3 XML; `src/corpus-genome-codec.ts` sniffs which), their
gens + feature-index entries are merged client-side from committed `public/chunks/pyr3-*.*`
sidecars (the ESF Release tar clobbers `gens.json`/`features.flam3idx` on deploy), and they're
filterable by variation like any sheep. **On-wire the gen is the integer 1000** (chunk paths,
feature records), but **every user-facing surface maps it to `pyr3`** — gallery labels, the viewer
URL `/browse/gen/pyr3/id/M`, tab title, and nav pills — via `src/native-gen.ts`
(`formatGenLabel` / `parseGenSegment`, which still accepts the numeric form). Add more with
`npm run bake:natives` (see Quick commands).
**Discover ▾** (#420 — exploration only: Showcase · Variations `/variations`) ·
**Help ▾** (#420 — learn/reference: **How flames work** `/how-it-works` — the #347
interactive scrollytelling guide (chaos-game step-through + xform/variation/final-xform/colour
demos, all CPU Canvas2D reusing the real `src/variations.ts`/`affine-decompose.ts` math;
alias `/howitworks` redirects to it) · Direct-color variations (`/help/direct-color-variations.html`)
· Render cost & quality (`/help/ifs-and-render-cost.html`) · WebGPU (`/help/webgpu.html`)
· About `/about`). The four static help pages share `public/help/help.css` + a branded
header (#406). Routes are **flat** (the `/v1/` prefix was dropped;
old `/v1/*` URLs redirect at boot via `src/route-redirects.ts`). The basic
viewer (`/viewer`, also bare `/`) opens/views any flame (📂 Open + Save, no
Surprise/loop); the corpus browser (`/browse`) is the ESF + pyr3-native viewer
(Surprise + loop, no file open). Flames move between surfaces only via the explicit **✏️ Edit
this flame** button — never an implicit transfer-on-navigate.

**Mobile is consumption-only (#66).** On a mobile viewport (`isMobile()` in
`src/mobile.ts` — viewport width ≤ 820px, or a coarse pointer just past it) the
app strips down to *looking at* flames; creation surfaces are removed. The nav
shows only **Viewer · Creator · Flame Gallery · Discover · Help** — **Editor**,
**Animate**, and **Screensaver** are dropped from the menu, and direct
navigation to those URLs mounts a lightweight "needs a bigger screen"
interstitial (`src/mobile-interstitial.ts`) instead of the heavy surface (no GPU
acquired). **Creator** stays, but a tile tap-through routes to the **viewer**
(not the editor) via the same pending-transfer seam. Kept pages also shed
creation/tuning chrome on mobile: the viewer drops the whole PREVIEW/RENDER bar
(tier · quality · size · format · Save Render) + ✏️ Edit, keeping 📂 Open +
🧬 Save Flame; Creator drops the GENERATE/VARIATIONS steering bars + undo/redo
(keeps 🎲 Reroll + the wall); the gallery drops the ⚙ filter drawer. The engine
(`createRenderer`/WGSL) is untouched — this is a pure presentation-layer branch.

The `pyr3` global command (via `npm link`) boots
`pyr3 serve`, whose backend exposes `/api/render` + `/api/animate` (SSE-
streamed) for renders past the browser's quality cap. `/api/animate` accepts
**either** a `.flam3` multi-keyframe animation (`flame_xml`) **or** a built
timeline (`timeline_json`, the `/animate` 📤 Export sequence button in
timeline mode — fps × duration framing, absolute quality, index-named frames; #227).
Both export paths accept absolute output dimensions via the `/animate` chrome's
`SIZE_PRESETS` dropdown (HD/2K/4K/square/portrait + Custom W×H) → `out_width`/
`out_height` (long-edge rescale, drives the live preview + export; #274), and
`resume` to skip frames already on disk (default-on FE checkbox / CLI `resume=1`;
crash-safe temp-rename writes; #275).

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

Markov-chain flame generation (#36) stays a deferred research arc. The visual editor (`/editor`)
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
  milestone IS a ship gate: when every issue in it closes, tag the release. **v1.0 → v1.12
  have all shipped** (latest: `v1.12.0` on 2026-06-24 — the **Mobile rework** milestone (#13)
  closed: the #66 consumption-only mobile overhaul — viewport-gated nav, creation surfaces
  routed to lightweight interstitials, per-page chrome stripping, responsive gallery;
  `v1.11.0` on 2026-06-19 — the **Editor IA rework** milestone (#27)
  closed: the 4-lens editor redesign (XForm · Scene · Color · Output), xform reorder (#335),
  one consolidated Color lens (#358), in-lens gradient editor retiring `/gradient` (#372), and the
  6-tier affordance/control-consistency pass (#373); `v1.10.0` on 2026-06-14 was the **More
  variations** milestone (#16): novel warp families V317–V322 growing the catalog to **323**
  (V0..V322); `v1.9.0` was
  the **Animation** milestone — the timeline sequencer (#227) plus keyframe interp / motion /
  easing / frame export, 29 issues; `v1.8.0` the bug-sweep cluster; `v1.7.0` the More Variations
  Marathon). **Apophysis and JWildfire** (#6 — plugin pack #114, importer parity sweep #17,
  Color Curves #116, gradient editor #115) and **More variations** (#16) are both now **closed**.
  Active themed milestones: **Binary distribution** (#15 — `npm run build:cli render` shipped
  2026-06-06; Windows from-source render path #287 shipped 2026-06-20; cross-platform verify
  #126 + standalone Windows `.exe` SEA #399 still open),
  **Viewer / editor UX & presets**, **Color grading & scopes**, **evolving flame creation**,
  **future research**, and **Mobile rework** (#13 — #66 mobile overhaul). No Project
  board — milestone-only planning.
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

## Variation porting: correct over faithful (2026-06-11 pivot)

When porting a variation from a **third-party source** (Apophysis / JWildfire /
xyrus02 / etc. — any source that is **not** the flam3-C parity rig), **prefer the
mathematically-correct form over verbatim reproduction of a source bug or typo.**
This supersedes the old "faithful verbatim port, quirks included" pattern (e.g. the
bwraps V107 "ports verbatim" framing) for these third-party ports.

- **Document the deliberate correction at the code site** with a note that names the
  source typo and says **"do not restore parity by reverting"** — both the TS oracle
  (`src/variations.ts`) and the GPU site (`src/shaders/chaos.wgsl`). Canonical example:
  `var_curl2` (#234) keeps the correct pure complex cubic `Im` and warns against
  re-introducing the `curl2.h` `c3` typo.
- **Provenance comments must be honest.** A comment claiming "matches `<source>`" when
  the code deliberately deviates is a maintenance hazard (it invites a future "parity
  restore" that re-adds the bug). Say what the code actually does and why.

**Scope boundary — this does NOT touch the flam3-C ground truth.** The v1.0 ship gate
(26-fixture BE-vs-flam3-C parity rig + goldens, `npm run test:parity`; FE↔BE at quick-mode
dims) stays the canonical *measurement* contract. We still match flam3-C within R tolerance
there — we do **not** deviate from flam3-C even where flam3-C itself has a quirk. "Be
correct" applies only to exotic third-party variation ports that have no flam3-C reference.

This pivot re-frames several open issues toward "correct, not faithful" (re-evaluate when
worked, don't bulk-rework): #233 (var_parallel weight), #246 (param-domain divergences),
#245 (provenance-comment honesty).

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
8. **Variation param cap = 10.** The engine caps per-variation parameter slots at 10 to keep the WGSL `Variation` struct perfectly aligned to 3 `vec4`s (48 bytes), maximizing memory bandwidth in the `chaos.wgsl` inner loop. Complex JWildfire variations (like `cell2`, or future 17+ param L-tier entries) are supported by feature-subsetting the least impactful sliders rather than expanding the engine's seam.

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
  `linkedom` `DOMParser` shim (for `.flame` XML parsing — was `happy-dom`; swapped in #125
  to drop ~14 MB from the bundled CJS), then calls the same `createRenderer()`. The same
  module dual-modes between the tsx-driven `npm run render` path and the SEA-bundled
  `./build/pyr3-render` binary (#31) — Dawn-node is bundled as a SEA asset and extracted
  to `~/.cache/pyr3/dawn-<sha>.node` on first launch.
- BE 4K: `bin/pyr3-render.ts --long-edge 3840 --quality 200` renders the 4K
  reference (force-rescale to a 3840 long edge, q200, oversample 1 — reference
  SHOWCASE_4K-matched, what `scripts/render-showcase-v1.0.mjs` runs). The hidden
  `--preset {quick|4k|…}` alias was removed in #436 (nothing hidden on the CLI —
  explicit `--long-edge`/`--quality`/`--max-dim` only); `src/presets.ts`'s
  `applyPreset` still does the aspect-preserving rescale behind those flags.

Any code that breaks this seam should be loudly questioned before landing.

## Editor settings affordance vocabulary (#373)

The `/editor` panel (and any future settings surface) uses a shared **6-tier
affordance vocabulary** — see [`docs/ui-affordance-system.md`](docs/ui-affordance-system.md).
Tiers: lens tab · section header (filled bar + 3px `--structure` left-rule) ·
group divider (borderless caption) · **action expander** (orange accent-bar,
`buildExpander` in `src/edit-primitives.ts` + `.pyr3-aff-expander` in
`src/edit-ui.ts`) · inline value (scrubby, dashed-underline base; panel fields
are boxed via `.pyr3-edit-num`) · help icon (`infoIcon` in `src/help-text.ts`,
stamps `data-help-key`). Adopt by class, not copy-paste.

## Editor affine decomposition (`/editor` xforms v2)

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
compiler-folded, masking the cliff).

**A second corruption cliff: f32 `tanh` (#262, 2026-06-10).** Dawn's f32
`tanh` returns NaN for `|x| ≳ 1e3` (the naive
`(eˣ−e⁻ˣ)/(eˣ+e⁻ˣ)` form overflows its `exp` terms), which silently
propagates and can mask an otherwise-correct trig fix. Route any non-pre-clamped `tanh` of a coord/coef-scaled value
through `safe_tanh` in `chaos.wgsl` (arg-clamp to `±TANH_SAFE_MAX`;
lossless, since `tanh` is already saturated to ±1 well before then). The
accompanying **Dawn math-hazard audit** (#262) swept every transcendental
in `chaos.wgsl` and found exactly **two** value-corruption cliffs worth
wrapping — the trig range cliff (#72) and this `tanh` NaN. Everything else
is a *domain* NaN (e.g. `sqrt`/`log`/`pow` of an out-of-domain arg), which
**self-heals via the chaos kernel's bad-value retry loop** — do NOT add
`safe_*` wrappers for those; a wrapper there only hides the retry and can
bias the attractor. New transcendentals get a wrapper only if they corrupt
a *valid* input (like trig/tanh), not if they merely reject an invalid one.

The other 4 tier-2 fixtures are not
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
- WGSL shaders: `src/shaders/{chaos,density,noise_perlin,visualize_u32,visualize_f32}.wgsl`

## Live pages to audit

- https://pyr3.app/
- https://pyr3.app/help/about.html
- https://pyr3.app/help/direct-color-variations.html
- https://pyr3.app/help/ifs-and-render-cost.html
- https://pyr3.app/help/webgpu.html
- https://pyr3.app/showcase/

