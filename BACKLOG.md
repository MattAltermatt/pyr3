# 🗃️ pyr3 Backlog

Authoritative registry of open tasks. Every open task carries a `[PYR3-NNN]` ID (required) and
best-effort flags (optional): `category · size · sigil · status · milestone`.

Forward-only — shipped work lives in [CHANGELOG.md](CHANGELOG.md). Strategic narrative +
current cycle lives in [ROADMAP.md](ROADMAP.md).

> **Next ID: PYR3-038** — increment when creating a new entry. Never reuse, even for
> shipped/removed tasks.

## [PYR3-037] feat · M · 🪨 · queued · v1.x — Brainstorm + rebuild the About page (`help/about.html`)

**Filed 2026-05-28 (user-directive during the v1.0 FE-polish brainstorm).** The
v1.0 FE polish pass adds a quiet `about` link to the bar (left zone, between the
🔥 pyr3 wordmark and the flame name) pointing at `help/about.html`. That page is a
Phase-0 wholesale copy from pyr3-peek — its branding is being corrected to "pyr3"
in the FE-polish pass, but the **content + design were never reconsidered for
pyr3's own v1.0 story** (showcase gallery, flam3-C ground truth, the single-engine/
two-consumers architecture, the Electric Sheep lineage). This entry is a dedicated
session to brainstorm what the About page should actually *say and look like* as
pyr3's public front-door explainer — not just a rename.

**Why its own session:** the FE-polish pass only rebrands the page (mechanical);
the real "what should About communicate, and how should it look" question is a
fresh design problem deserving its own brainstorm + spec. Surfaced here so the
"but eventually" thinking isn't lost.

**Acceptance:** About page content + layout designed from pyr3's v1.0 narrative
(not inherited from pyr3-peek); consistent visual language with the polished
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
`secant` (likely an un-aliased name for `secant2`). **Open sub-item:** decide whether to alias
`secant`→`secant2` (deferred — no curated fixture uses it).

## [PYR3-035] chore · M · ✅ **RESOLVED (v0.22, 2026-05-28)** — re-rendered the showcase 4K set after the PYR3-034 variation-drop fix

> **✅ Done v0.22.** Re-rendered all **13** affected showcase fixtures (the six underscore
> variations: gaussian_blur/radial_blur/pre_blur + super_shape on 243.06888 & 243.12778) and
> rebuilt the gallery (54 cards). `243.06888` (super_shape) now **surpasses the kotlin v1.1
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
> was to get as close to parity with flam3 and pyr3-kotlin, and we have to do that." Target
> image: `https://electricsheep.com/archives/generation-243/171/0.jpg`. **df64 (double-float)
> emulation is SANCTIONED** ("if we need to emulate 64 bit, then we do that") — relaxes the
> "GPU only / accept f32 floor" stance for this fix. Next-session plan: see
> [[project-pyr3-034-next-session]] (ordered: fma-contraction test → pyr3-f32 vs kotlin-f32
> trace → port kotlin's `df64.glsl` to WGSL). All diagnosis on branch `feature/pyr3-034-lowdensity`.

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

**f32 EXONERATED (2026-05-28):** The reference render is kotlin's `GpuF32Backend`
— **also f32** — and it paints the full halo. So this is NOT an f32-precision floor;
pyr3 has a *structural divergence* from a working f32 GPU chaos game. (Supersedes the
"f32 floor" hypothesis above.)

**Structural divergence found — pyr3 vs kotlin chaos game:**
- **xform pick:** kotlin uses a cumulative-weight LINEAR SCAN over `pickTable[64]`;
  pyr3 (post-`[PYR3-029]`) uses flam3's 14-bit `xform_distrib` GRAIN table. Different
  pick sequences for the same RNG state.
- **walker color init:** kotlin seeds color with `rand01()`; pyr3 seeds `0.0` with NO
  rng draw (PYR3-029 Phase-5 change to match flam3's stream). Shifts the whole ISAAC
  stream by one draw per walker vs kotlin.
- Net: pyr3 was rewritten to **bit-match flam3-C's RNG stream**; kotlin never was.

**RESOLVED TO DIAGNOSIS (2026-05-28, 4-way render + histogram):**
`.remember/verify/pyr3-034-243-3way.html`.

```
                       nonzero      coverage   mean_cnt/nonzero   halo?
flam3-C (ground truth) 2,373,856    52%        10,133             YES
kotlin GpuF32Backend   (f32 GPU)    —          —                  YES
pyr3 current            18,460      0.43%      1.30M              no
pyr3 pre-PYR3-029       18,524      0.43%      1.30M              no
```

- **flam3-C HAS the halo (52% coverage).** Since flam3-C is pyr3's ground truth, pyr3
  is **genuinely broken** here — NOT "correct to ground truth." The kotlin reference is right.
- **PYR3-029 is NOT the cause.** The pre-PYR3-029 engine (commit `5191ee4`, original
  peek-era scan + random-color chaos game) renders IDENTICALLY broken (0.43%). Reverting
  the PYR3-029 work does not help — the bug predates it and lives in the **peek-era chaos game**.
- **Not f32** (kotlin's GPU is f32 too). **Not tonemap/DE** (halo absent from histogram).
  **Not a mis-ported variation** (radial_blur/spherical verified).

**Root-cause mechanism (leading, high-confidence):** flam3 and pyr3 distribute the SAME
total samples completely differently — flam3 spreads over ~128× more pixels (2.37M vs
18.5K). flam3 renders in many short **sub-batches**, each starting from a FRESH random
point + short fuse, so it captures the *transient* paths (the halo arcs are transients
on the way to/from the dense attractor). pyr3's peek-era walkers run **one long
continuous orbit** (single fuse, then `iters_per_walker` plots) → they settle onto the
dense attractor and never re-traverse the transient halo. Net: pyr3 paints only the
attractor core; flam3 paints attractor + transients.

**Walker-structure theory DISPROVEN empirically (2026-05-28):**
- pyr3 & kotlin share the SAME budget algorithm + constants (TARGET_WALKERS=1024,
  MIN_ITERS=4096, MAX_ITERS=1048576). For this flame both pick **1024 walkers ×
  92,500 iters** — neither re-fuses periodically (kotlin's loop is also single-fuse).
- Forcing more/shorter walkers via `pyr3-hist --walkers {16384,65536,262144}` did NOT
  raise coverage — it went 18.5K → ~10K nonzero (worse), and the **1.5e9-counts-in-one-
  pixel spike is invariant to walker count**. So orbit-length / f32-trapping is NOT it.
- pyr3 **correctly discards** out-of-bounds splats (`chaos.wgsl:1843` bounds-check, no
  edge-clamp) → the spike is a legitimate in-bounds dense-core pixel. flam3-C's own max
  is ~1.1e9 — the dense **core is correct in both**. The ONLY difference is halo
  coverage: flam3 hits 2.37M pixels, pyr3 18K.

**Ruled out so far:** f32 precision (kotlin f32 works), tonemap/DE (halo absent from
histogram), variation formulas (radial_blur/spherical text-match flam3), xform-pick
mechanism (pre-PYR3-029 scan logic equally broken), walker count/orbit length (swept),
out-of-bounds clamp (discards correctly), camera (core positioned right).

**Remaining: the trajectory itself explores less than flam3-C's, same RNG budget.**
Only a step-by-step diff will pin it.

**Deep-dive 2026-05-28 (full hypothesis space eliminated):** pyr3's f32 iteration
converges to a ~18K-pixel invariant set; flam3-C AND kotlin (both f32-capable) fill 2.37M
(52%) — a ~128× attractor-size gap on the SAME 2-xform IFS (xform0 linear+radial_blur,
xform1 linear+spherical w=2.25). Eliminated, each with evidence:
- **picks** — pyr3 82% / flam3 84% spherical over 1000 iters: match (pick mechanism fine).
- **spherical + EPS** — `p·w/(r²+1e-10)` identical in pyr3, kotlin (`chaos.comp:514`),
  flam3 (`private.h:47`). Verified.
- **variation summation** — trace confirms `pv = spherical(pa) + 0.001·linear(pa)` to the
  digit; both vars summed correctly.
- **bad-value reseed** — `isBad=0` across walker-0's 1000 traced iters; never fires.
- **camera/scale/rotate** — zooming OUT (scale 21.8→4) gave FEWER pixels (2900), so halo
  points are in-frame, not clipped. Not a projection bug.
- **walker count / orbit length** — swept 1024→262144, coverage flat/worse; 1.5e9-in-one-
  pixel invariant. Neither pyr3 nor kotlin re-fuses (same single-fuse loop).
- **f32 precision class** — kotlin `GpuF32Backend` (f32) renders the full halo.
- **out-of-bounds** — pyr3 discards correctly (`chaos.wgsl:1843`), no edge-clamp.

**The gap is emergent f32 dynamics** (pyr3's invariant set ≠ kotlin's, both f32) — the
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
f64 chaotic divergence, NOT a localizable bug:** the working kotlin-f32 engine would
diverge from flam3-f64 identically — a walker-0-vs-f64 trace cannot distinguish the good
f32 engine from the bad one. So the aligned-trace-vs-flam3 approach is a dead end for THIS
bug (it was the right tool for PYR3-029's RNG-stream-alignment question, wrong tool here).

**Sharpened conclusion:** the 128× attractor-SIZE gap (52% vs 0.43%) is NOT typical f32
rounding sensitivity — two valid f32 engines yield similar-size attractors with different
exact pixels, not a 128× size collapse. This implies a **qualitative, likely WGSL-specific
difference** (fma contraction / op-order / a subtle WGSL-vs-GLSL f32 semantic) that makes
pyr3's f32 dynamics fall onto a tiny attractor where kotlin's f32 stays ergodic.

**Only remaining isolation path:** trace **pyr3-f32 vs kotlin-f32** (both f32) — requires
building + instrumenting pyr3-kotlin's JVM+Vulkan `GpuF32Backend` to emit a comparable
per-iter / histogram trace, then diffing. Substantial cross-repo tooling; realistic chance
the root cause is WGSL fma/rounding that is hard to fully control. **Next phase decision:**
- (B) Manual line-by-line pyr3 `chaos.wgsl` vs kotlin `chaos.comp` f32-arithmetic audit of
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

## [PYR3-033] bug · S · 🐛 · queued · v1.x — `electricsheep.242.01373` renders pure black at `--preset 4k`

**Symptom (observed 2026-05-28):** `electricsheep.242.01373.pyr3-4k.png` is a
completely black 3840×2841 image (mean luminance 0.00, 0% non-black pixels, 46KB
on disk) despite the render running 5.4s without error. Surfaced during the v0.21
showcase build; auto-excluded from the gallery by the new mean-luminance gate in
`scripts/build-showcase.mjs` (so this is cosmetic-for-now, not gallery-blocking).

**Hypothesis (unverified):** Either (a) the fixture genome projects entirely
outside the camera at the `--preset 4k` framing (3840 long-edge, q=200,
oversample=1) — a camera/scale issue, not engine; or (b) a chaos-game/tonemap
degenerate case for this specific genome (zero-weight xforms, all-NaN trajectory,
or a brightness/gamma collapse). It is the ONLY pure-black render of the 55.

**Next phase:** render it through the FE viewer at quick-mode + via `npm run
render` at native dims and compare — does it produce output at other dims? Check
the source `.flam3` xform weights. Compare against flam3-C output for the same
fixture (does flam3-C also render it black?). If flam3-C renders it fine, it's a
pyr3 bug; if flam3-C is also black, the fixture is simply a bad showcase pick —
drop it from the curated set.

## [PYR3-032] chore · M · 🪨 · partially done (FE-facing slice in v0.23) · v1.0 — Purge predecessor-repo references from the codebase

**✅ FE-facing slice done (v0.23):** Layer 1's public-facing FE surface is
clean — the three `help/*.html` pages were rebranded "pyr3-peek" → "pyr3", and
FE source comments referencing the predecessor repos were swept during the
`[PYR3-031]` slim-bar rebuild. **The functional purge stays open:** fixture
manifest `source:` paths (Layer 2), `fixtures/kotlin-*` renames + parity-infra
agent defs (Layer 5), engine `Port: pyr3-kotlin` provenance comments (Layer 3),
and the internal dev-doc / CLAUDE.md `Port:` convention decision (Layer 4) are
all still to do.

**Filed 2026-05-28 (user-directive).** Remove all references to the dead
predecessor repos — **`flam3-kotlin` (not a real project name), `pyr3-kotlin`,
`pyr3-peek`, `pyr3-rust`** — so public pyr3 stands on its own (lineage to
**flam3**, the original C engine, is legitimate and STAYS). The showcase was
already cleaned in v0.21 (`scripts/build-showcase.mjs` lede); this entry is the
rest of the codebase, scoped "everything" next session.

**~165 references across ~30 tracked files, by layer (survey 2026-05-28):**
1. **Public-facing — do first.** `help/about.html`, `help/webgpu.html`,
   `help/ifs-and-render-cost.html` are still titled/branded **"pyr3-peek"**
   (wholesale-copy leftover from Phase 0 — egregious for a public ship);
   `README.md`, `VISION.md`.
2. **Manifest source paths (FUNCTIONAL).** `fixtures/showcase-v1.0/_manifest.json`
   `source:` fields point at `…/pyr3-kotlin/parity/.../*.flam3` (28 hits). The
   same sheep live in `electric-sheep-fold/corpus/<minor>/<bucket>/` — re-point
   there (see [[reference-kotlin-v11-renders]] for the path pattern) and re-verify
   `scripts/render-showcase-v1.0.mjs` + `build-showcase.mjs` still resolve them.
3. **Source provenance comments.** `Port: pyr3-kotlin …` in `src/compare.ts:3`,
   `src/serialize.ts:153`, `src/shaders/chaos.wgsl:1720`; "pyr3-peek couldn't
   crack" in `src/main.ts:204`.
4. **Internal dev docs.** `CLAUDE.md` Lineage section + the `Port:` commit
   convention (decide what replaces it), `ROADMAP.md`, `BACKLOG.md`, `NOTICE.md`
   (⚠️ keep legally-required flam3/GPL attribution), `docs/superpowers/specs/*`,
   `docs/flam3-local-build.md`.
5. **Parity infra (FUNCTIONAL).** `fixtures/kotlin-goldens/`,
   `fixtures/kotlin-4k-refs/`, `.claude/agents/{wgsl-parity-reviewer,flame-fixture-investigator}.md`
   reference pyr3-kotlin as the parity source. Renaming touches the ship-gate
   tooling — rename + rewire + re-run `npm run test:parity*` to confirm green.

**⚠️ Conflicts to resolve at the top of the sweep (don't silently blow past):**
- `CHANGELOG.md` is documented append-only ship history with `Port:` citations —
  decide whether to rewrite history or leave it as the factual record (recommend:
  leave history; stop *new* citations).
- The `Port: pyr3-kotlin <ref>` commit-message convention in CLAUDE.md needs a
  replacement or removal decision.
- Ground truth already pivoted kotlin→flam3-C (v0.18), so the `kotlin-*` fixture
  names are arguably already misnomers — good moment to rename to `flam3c-*` or similar.

**Acceptance:** `git grep -i -E 'flam3-kotlin|pyr3-kotlin|pyr3-peek|pyr3-rust'`
returns only deliberate, documented exceptions (if any); parity rig still green;
help pages branded "pyr3"; no broken fixture/agent wiring.

## [PYR3-031] feat · M · 🪨 · ✅ done (FE-cleanup slice, v0.23) · v1.0 — FE cleanup pass before public ship

**✅ FE-cleanup slice done (v0.23):** The v1.0 FE-polish pass rebuilt the top
bar into a single slim row, which swept the vestigial `setLoading` /
status-pulse wiring and the `.pyr3-bar-btn-accent` CSS. The Share button was
removed (url-codec + inbound `?flame=` decoding kept intact). No stale TODOs
remained to clear. The companion brainstorm-and-rebuild of the About page is
tracked separately as `[PYR3-037]`.

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

## [PYR3-030] parity · M · 🪨 · queued · v1.x — f64 tonemap precision shim for visualize pass

**Filed 2026-05-27 post Phase-C investigator findings.** Pyr3's `visualize_u32.wgsl`
`calc_alpha` + `calc_newrgb` run in GPU f32. Kotlin v1.1 (the BE 4K parity reference)
runs tonemap in CPU f64. For high-`brightness` / high-`gamma` fixtures (the 248.22289
class) the f32 precision at the HSV-highpow desaturation roundtrip is a non-trivial
contributor to BE-vs-kotlin divergence.

**Why M:** mechanism is clear — promote the per-pixel post-chaos tonemap to a CPU f64
pass between GPU histogram readback and PNG encode. The chaos game still runs in GPU
f32 (massive parallelism win), but the final per-pixel arithmetic is single-threaded
+ tiny + reasonable to do at f64. Estimated 50-100 LOC port from
`/Users/matt/dev/MattAltermatt/pyr3-kotlin/core/src/main/kotlin/pyr3/core/CpuF64Backend.kt`.

**Acceptance:** 248.22289 BE-vs-kotlin R drops measurably (target: -5 to -10 R-units
on its own). The FE↔BE quick-mode gate (PYR3-026) thresholds can be tightened post-
calibration.

**Depends on:** [PYR3-029] should land first (chaos-game fix is the bigger lever; f64
tonemap is the precision-floor secondary).

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
- ✅ **Kotlin golden is reasonably faithful to flam3-C.** 3-way R cross-
  check (`pyr3<>flam3`, `golden<>flam3`, `golden<>pyr3`) shows
  `golden<>pyr3 ≈ pyr3<>flam3` always — the kotlin golden is not
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



## [PYR3-027] perf · M · 🪶 · investigation · post-v1 — Why is FE 13× slower than BE for the same render?

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

## [PYR3-025] gpu · M · 🪨 · investigation · post-v1 — Chrome WebGPU 4K renderer-tab-kill class (insurance investigation)

**Frame:** During PYR3-023 probe, 2/5 sampled showcase fixtures
(244.36880 + 248.22289) reproducibly crashed the Chrome renderer tab
within ~30-45s of clicking the (now-removed) 🎯 Render 4K button. Same
fixtures rendered fine on BE in 14-19s at the same 4096-long-edge dims.
**No longer v1.0-blocking** since the FE 4K button is gone (PYR3-023
pivot), but the failure class is interesting engine-health signal —
might surface at lower dims too if the visualize-pass budget grows.

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

## [PYR3-024] parity · S · 🪨 · investigation · v1.x — `248.22289` BE 4K visual divergence vs kotlin v1.1

**Symptom (observed 2026-05-27, PYR3-023 probe):** Pyr3 BE 4K render of
`electricsheep.248.22289` completes cleanly (~19s wall, no crash, dims
correct) but diverges substantially from the kotlin v1.1
`SHOWCASE_4K` JPG reference.

**Scoping pass measured 2026-05-27 (Phase B):**

- pyr3 BE @ 3840×2160 native (post-alignment to kotlin's SHOWCASE_4K)
- **R(pyr3-BE, kotlin v1.1) = 44.96** — worst BE divergence in corpus
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

## [PYR3-023] gpu · M · ✅ resolved (corpus expansion + --preset 4k landed in v0.20) — BE 4K parity gate vs kotlin v1.1

**v0.20 closure (2026-05-28):** Resolved. v0.20 graduates the BE 4K
parity rig to first-class infrastructure: `scripts/pyr3-023-be-render-4k.mjs`
deleted; `bin/pyr3-render.ts --preset 4k` is the canonical 4K render
path (`src/presets.ts` owns the spec). `fixtures/kotlin-4k-refs/meta.json`
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
focuses narrowly on the BE-vs-kotlin 4K ship gate.

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

**⚠️ 248.22289 BE render is visually OFF vs kotlin v1.1 reference**
(user-flagged 2026-05-27 from probe gallery). Render completed cleanly
in 19s, dims correct, but composition/colors diverge from the kotlin
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
- 🟡 **Apples-to-oranges with kotlin: 4096 vs 3840 long-edge.** Kotlin's
  `SHOWCASE_4K` preset (`pyr3-kotlin/cli/.../Preset.kt:39-49`) uses
  `TARGET_4K_LONG_EDGE = 3840`. Pyr3's `FULL_MAX_DIM = 4096` renders
  13.78% more pixels per fixture. This delta is not the crash cause (BE
  at 4096 succeeds for all 5), but it IS a real v1.0 parity-rig
  blocker: pixel-level R-compare against kotlin JPGs at 3840 is
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

1. **Align BE 4K long-edge to kotlin's 3840.** Change
   `scripts/pyr3-023-be-render-4k.mjs`'s `FULL_MAX_DIM = 4096 → 3840`
   so pyr3 BE renders match kotlin's `SHOWCASE_4K` preset
   pixel-for-pixel in dimensions. Probably promote the wrapper into a
   first-class CLI flag (`--preset showcase-4k` or `--size-scale auto-4k`)
   instead of leaving it as a one-off script. (Mirrors kotlin's
   `Preset.SHOWCASE_4K` enum at `pyr3-kotlin/cli/.../Preset.kt:39-49`.)
2. **Build the BE 4K parity rig.** Mirror the 19-fixture parity rig but
   at 4K dims, comparing pyr3 BE PNG output vs kotlin v1.1 JPG
   references (`fixtures/kotlin-4k-refs/`). R-thresholds need separate
   calibration against the JPG noise floor (lossier than the existing
   PNG-vs-PNG rig). Showcase fixtures (54 in kotlin's v1.1 set)
   become candidates; start with the 5 already probed.
3. **Fix any divergences surfaced** by the rig. Resolve PYR3-024
   (248.22289 visual off) + roll PYR3-021 fixes into the cycle.
4. **Ship as a regression-gated `npm run test:parity-4k`** target,
   sibling of `test:parity`. CI doesn't run it (no headless GPU); local
   developers run it before any engine-touching PR.

**Files of interest:**
- `scripts/pyr3-023-be-render-4k.mjs` — BE 4K wrapper (graduate to CLI
  flag or first-class `bin/` script)
- pyr3-kotlin's `Preset.SHOWCASE_4K` — `cli/.../Preset.kt:39-49`
- `src/parity.test.ts` — existing parity rig shape to clone
- `fixtures/kotlin-4k-refs/` — 5 kotlin v1.1 JPG references already
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
`/showcase` (no kotlin-style `/v1.0/` dirs).

**Pre-discussed design directions (locked or near-locked 2026-05-28):**

- **Unversioned URL.** `mattaltermatt.github.io/pyr3/` shows the
  latest showcase — no `/v1.0/`, `/v1.1/` like kotlin (museum
  approach). Live site. Manifest JSON carries the date + pyr3 commit
  for traceability.
- **Render time, no comparison.** Per-fixture pill shows pyr3 BE 4K
  wall-clock (e.g. `~10s`). Don't compare against kotlin or flam3-C —
  comparison framing makes pyr3 read as "the second one" when it's
  the primary renderer.
- **Click-to-load is the differentiator.** Clicking a showcase thumb
  loads the flame into pyr3 FE viewer at quick-mode (1024 long-edge —
  4K crashes Chrome per PYR3-025). Static 4K PNG download offered
  separately. "The renderer IS the showcase" — kotlin's gallery is
  static, pyr3's is interactive.
- **About / what-is-this** — required. 50-word lede explaining
  pyr3's lineage (flam3 → flam3-kotlin → pyr3) + link to GitHub.
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
  2-column (kotlin JPG ref vs pyr3 render) for "are they rendered?"
  validation; will be SUPERSEDED by the brainstorm-locked gallery
  shape (no kotlin column, render-time pills, click-to-load) in the
  v1.0 session.

**Depends on:** `[PYR3-031]` FE cleanup pass (bundled — they share
the FE surface area; ship together).
