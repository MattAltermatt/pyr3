# pyr3 viewer-chrome v2 — three-bar layout · corpus navigation · quality control

**Date:** 2026-05-29
**Status:** design-locked (brainstorm approved)
**BACKLOG:** `[PYR3-039]` `[PYR3-040]` `[PYR3-041]` (corpus nav) · `[PYR3-050]` (three-bar
restructure + quality control + info-bar readout)

## 1. Goal

Turn the single-bar viewer into a richer, browsable, quality-tunable experience without
breaking the "single engine, two consumers" seam or the GPU-only invariant. Three threads,
one cohesive UI:

1. **Three-bar chrome** — split the one slim bar into ① info/links-out, ② actions,
   ③ render-progress (existing, unchanged).
2. **Corpus navigation** (`[PYR3-039/040/041]`) — no dead ends browsing
   `/v1/gen/{gen}/id/{id}`: prev/next *available* sheep, nearest-neighbor recovery, and a
   graceful in-viewer missing-sheep state with honest wording.
3. **Quality control** (`[PYR3-050]`) — a preset ladder (Draft→4K) + an Advanced
   disclosure for custom resolution/SPP, fenced by a live cost/OOM estimate, with the
   resulting `dims · quality` shown in the info bar.

All UI is built with the existing `createElement`/`textContent` no-`innerHTML` discipline in
`src/ui-bar.ts`. Engine modules stay environment-agnostic; this is FE-only (`src/main.ts`,
`src/ui-bar.ts`, new `src/avail-client.ts`, new quality plumbing into the render path).

## 2. The three-bar layout

`mountBar()` returns a `BarHandle` and currently builds one `.pyr3-bar-row`. v2 builds:

```
① .pyr3-bar-info     identity · current-flame info · links out          (always visible)
   🔥pyr3 · about · showcase · <name> by <nick> · <dims · q · tier>   …  WebGPU ✓ · fork it · more flames
② .pyr3-bar-action   actions                                            (always visible)
   📂 Open · quality:[Draft|Preview|Standard|High|4K] · Advanced▾   …   corpus: ‹ <prev>  <next> ›
   └ .pyr3-bar-advanced  custom resolution + SPP + cost + Render        (only when Advanced open)
③ .pyr3-bar-tier3    render progress                                    (only while rendering; UNCHANGED)
```

- The standalone `🎯 4K` button is **removed** — 4K becomes the top preset tier.
- The info-bar flame readout gains `· <width>×<height> · q<SPP> · <TierName>` after the
  current flame name. Updates whenever the tier/custom render completes.
- Bar ③ (`buildTier3`) is unchanged in content/behavior; it just sits below bar ②.

### BarHandle additions
```ts
interface BarHandle {
  // existing: setMeta, setBusy, showProgress, hideProgress, showToast
  setQuality(q: { width: number; height: number; spp: number; tierLabel: string }): void;
  setCorpusNav(nav: CorpusNav | null): void;   // null → hide nav (e.g. non-corpus flame loaded via Open)
}
interface BarOpts {
  // existing: webgpu, onOpenFile
  onRenderQuality: (q: QualityRequest) => void;   // replaces onRender4K
  onNavigate: (gen: number, id: number) => void;  // corpus prev/next/nearest click
}
```

## 3. Foundation — `src/avail-client.ts`

A small client over the deployed per-gen availability manifests. Pure, cached, FE-usable.
`src/avail.ts` already ships `decodeAvail(bytes) → number[]` and `exists(ids, id)`.

```ts
// Fetch + decode + cache the sorted present-id list for a gen.
//   URL: `${BASE_URL}chunks/${gen}/avail.flam3idx`  (brotli LEB128; same opaque-bytes
//   fetch contract as chunk-fetch.ts — never assume Content-Encoding).
export async function loadAvail(gen: number): Promise<number[]>;   // memoized per gen

// Navigation queries over a decoded sorted list. id need NOT be present.
export function neighbors(ids: number[], id: number): {
  prev: number | null;      // greatest present id < id
  next: number | null;      // smallest present id > id
  nearest: number | null;   // closest present id (ties → lower)
  isPresent: boolean;
};
```

`neighbors` is binary-search over the sorted list (reuse the `exists` bisection shape).
`loadAvail` caches the decoded array in a module-level `Map<number, number[]>` and the
in-flight promise to dedupe concurrent calls. On fetch failure (missing manifest, offline)
it resolves to `[]` → nav simply hides (graceful, never throws into the boot path).

## 4. Corpus navigation (`[PYR3-039/040/041]`)

### Data → UI
On a `corpus` load intent (and after any corpus navigation), `main.ts`:
1. `loadAvail(gen)` for the current gen.
2. `neighbors(ids, id)` → `{prev, next, nearest, isPresent}`.
3. `bar.setCorpusNav({ gen, prev, next })` → renders the ② action-bar nav cluster:
   `‹ <gen>.<prev>` and `<gen>.<next> ›` as clickable pills (omit a side with no neighbor).
   Clicking calls `opts.onNavigate(gen, id)` → pushes `/v1/gen/{gen}/id/{id}` (History
   pushState, no reload) and re-runs the corpus load.

### Missing sheep (`[PYR3-039]` + `[PYR3-040]`)
`resolveLoadIntent` `case 'corpus'` currently, on `FlameNotFound`, calls `showError(...)`
with "never born" wording and **falls back to the welcome flame**. v2:
- Do **not** swap to the welcome flame. Keep the viewer chrome (all three bars).
- Paint a graceful in-canvas state (replaces the old full-screen error fallback for this
  case): centered message —
  > **Electric Sheep was not found** — use ‹ prev or next › to jump to a valid flame.
- The info bar shows `gen <g> · sheep <id> — not in corpus`.
- The ② nav cluster shows `prev`/`next` available (from `neighbors`), so the user is
  visibly "between" two sheep. `nearest` drives which side reads as the obvious jump.
- No "never born" anywhere (PYR3-039 wording rule). Canvas shows no flame (honest: nothing
  to render), not the welcome flame.

`neighbors.nearest` realizes `[PYR3-040]` (one-click to the closest existing id) via the
same nav pills — we do NOT auto-load the nearest (user chooses), per the brainstorm.

### Browsing present sheep (`[PYR3-041]`)
For a present sheep, the same nav cluster shows the adjacent present ids — the corpus is
walkable. `src/avail.ts` (`decodeAvail`) is finally wired into the viewer.

## 5. Quality control (`[PYR3-050]`)

### Tier ladder (preset bundles)
Long-edge dims; short edge derived from the flame's native aspect. All oversample 1
(matches today's presets; FE removed oversample>1 for memory). 🎚️ tunable.

```
tier        longEdge   spp   default
Draft        512        8
Preview      1024       16    ★ (load default — = today's quick mode)
Standard     1920       50
High         2560       100
4K           3840       200         (= today's --preset 4k / old 🎯 4K button)
```

Define in `src/presets.ts` (which already owns `quick`/`4k`) as a `QUALITY_TIERS` array so
FE and CLI share one source of truth. Each tier: `{ name, longEdge, spp, oversample: 1 }`.
The existing `quick`/`4k` CLI presets map onto `Preview`/`4K`.

### Advanced disclosure
"Advanced ▾" toggles bar ②'s sub-row `.pyr3-bar-advanced`:
- **Custom resolution:** a single **long-edge number field** (respects native aspect;
  short edge derived — no W×H distortion). Default-fills the current tier's longEdge.
- **SPP slider:** range ~[4, 400], current value shown as `q<n>`.
- **Cost estimate (live):** `≈ <MB> · ~<s> · ✓ fits GPU | ✗ exceeds limit`. MB from the
  histogram-buffer size for the derived dims (reuse the v0.29 `maxStorageBufferBindingSize`
  guard math); `✗` disables the Render button. Time is a coarse heuristic
  (pixels × spp ÷ throughput-constant).
- **Render button:** dispatches a custom `QualityRequest` through the decoupled orchestrator.

### Render dispatch
```ts
type QualityRequest =
  | { kind: 'tier'; tier: QualityTier }
  | { kind: 'custom'; longEdge: number; spp: number; oversample: 1 };
```
`main.ts` resolves a request → target dims (apply long-edge to native aspect) + SPP, then
drives the **existing v0.29 decoupled orchestrator** (`startDecoupledRender`) toward that
SPP target. Switching tiers re-targets the progressive loop; it does not block. Resolution
changes reallocate the histogram (same path as the current 4K button). On completion,
`bar.setQuality({...})` updates the info-bar readout.

The OOM guard already exists for 4K (storage-limit abort + toast); custom requests run the
same check *before* dispatch and surface it in the cost estimate (pre-flight, not post-fail).

## 6. Files

```
NEW  src/avail-client.ts        loadAvail (cached fetch+decode) + neighbors()
NEW  src/avail-client.test.ts   neighbors() edge cases + loadAvail cache/dedupe (mocked fetch)
EDIT src/presets.ts             QUALITY_TIERS source-of-truth; quick/4k map onto Preview/4K
EDIT src/ui-bar.ts              three-bar build; quality ladder + Advanced row; corpus nav
                                cluster; setQuality/setCorpusNav; remove onRender4K→onRenderQuality
EDIT src/main.ts                wire avail-client into corpus load; missing-sheep in-viewer
                                state (no welcome fallback); onNavigate (pushState); quality
                                request → decoupled orchestrator; info-bar readout
EDIT src/load-intent / router   onNavigate uses History pushState + re-resolve (no reload)
DOCS BACKLOG (039/040/041 + 050 resolve), CHANGELOG, ROADMAP, VISION (browsable corpus)
```

No changes to `src/shaders/*`, the chaos/density/visualize pipeline, or the CLI render path
beyond `presets.ts` sharing `QUALITY_TIERS`. Engine seam intact.

## 7. Error handling

- **Missing avail manifest / offline:** `loadAvail` → `[]` → nav hides; corpus load still
  works for present ids (chunk fetch is independent). Never throws into boot.
- **Missing sheep:** graceful in-viewer state (§4), not welcome-flame swap, not a bare toast.
- **OOM (custom dims too big):** pre-flight cost estimate shows `✗ exceeds limit` and
  disables Render; the post-dispatch guard remains as a backstop (toast).
- **Non-corpus flame (via Open button):** `setCorpusNav(null)` hides nav; quality ladder
  still applies (operates on whatever genome is loaded).

## 8. Testing

- `avail-client.test.ts`: `neighbors()` — id present, id in a gap, id below min, above max,
  empty list, single element; `loadAvail` caching + in-flight dedupe + fetch-failure→`[]`
  (mocked fetch, mirrors `chunk-fetch.test.ts`).
- `presets.test.ts`: `QUALITY_TIERS` invariants (monotone longEdge+spp, Preview/4K match
  the legacy quick/4k values), aspect-derivation math.
- Existing decoupled-orchestrator tests stay green (quality request just sets the target).
- Chrome verify (build+preview, chunks staged): present-sheep nav walks the corpus; missing
  id shows the in-viewer state + correct prev/next; each tier renders + updates the info-bar
  readout; Advanced custom render + cost estimate + OOM `✗` path; render bar still appears
  only during a render.

## 9. Build sequence (phases)

1. **Foundation** — `avail-client.ts` (loadAvail + neighbors) + tests. Pure logic, no UI.
2. **Three-bar restructure** — split `ui-bar.ts` into info/action/render bars; move Open;
   remove 4K button; no behavior change yet beyond layout. Chrome-verify layout.
3. **Corpus nav** (`039/040/041`) — wire avail-client into `main.ts`; nav cluster in bar ②;
   missing-sheep in-viewer state + reword; pushState navigation. Chrome-verify browse + miss.
4. **Quality control** (`050`) — `QUALITY_TIERS` in presets; ladder in bar ②; tier render via
   decoupled orchestrator; info-bar readout. Chrome-verify all tiers.
5. **Advanced disclosure** — custom long-edge + SPP + live cost estimate + OOM gate + Render.
   Chrome-verify custom + OOM path.
6. **Code review + docs + verify gate** — fresh reviewer; BACKLOG/CHANGELOG/ROADMAP/VISION;
   user-verify before FF-merge.

Ships as one arc (likely v0.33), or phases 1–3 (nav) and 4–5 (quality) as two FF-merges if
we want to land the trio first. Decide at plan time.
