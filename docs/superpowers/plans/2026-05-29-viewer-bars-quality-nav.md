# Viewer-chrome v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Task granularity is **Claude-sized** (each task = a logical increment ending in passing tests + a commit), per the project's CLAUDE.md, not human 2-minute micro-steps.

**Goal:** Restructure the viewer into a three-bar chrome (info · actions · render-progress), wire corpus navigation (prev/next/nearest available sheep + graceful missing-sheep state), and add quality control (preset ladder + Advanced custom resolution/SPP), with a `dims · quality` readout in the info bar.

**Architecture:** New pure `avail-client.ts` (cached fetch+decode of per-gen availability manifests + neighbor search) feeds `main.ts`. `ui-bar.ts` splits its single row into info/action bars (render-progress row unchanged) and grows a quality ladder + Advanced disclosure + corpus-nav cluster. Quality requests drive the existing v0.29 decoupled orchestrator. FE-only; engine seam + GPU-only invariant untouched.

**Tech Stack:** TypeScript, WebGPU, Vitest, Vite. Spec: `docs/superpowers/specs/2026-05-29-viewer-bars-quality-nav-design.md`.

---

## Phase 1 — Foundation: avail-client

### Task 1: `avail-client.ts` (loadAvail + neighbors) + tests

**Files:**
- Create: `src/avail-client.ts`
- Create: `src/avail-client.test.ts`
- Reference: `src/avail.ts` (`decodeAvail`, `exists`), `src/chunk-fetch.ts` (URL + opaque-bytes fetch contract)

- [ ] **Step 1 — Write failing tests** for `neighbors(ids, id)` covering: present id, id in a gap, id below min, id above max, empty list, single element; and `loadAvail` caching + in-flight dedupe + fetch-failure→`[]` (mock `fetch`, mirror `chunk-fetch.test.ts` patterns).

```ts
// src/avail-client.test.ts (shape)
import { neighbors } from './avail-client';
describe('neighbors', () => {
  const ids = [10, 20, 30];
  it('gap id → surrounding present', () => {
    expect(neighbors(ids, 25)).toEqual({ prev: 20, next: 30, nearest: 20, isPresent: false });
  });
  it('present id → flanking present', () => {
    expect(neighbors(ids, 20)).toEqual({ prev: 10, next: 30, nearest: 20, isPresent: true });
  });
  it('below min', () => expect(neighbors(ids, 5)).toEqual({ prev: null, next: 10, nearest: 10, isPresent: false }));
  it('above max', () => expect(neighbors(ids, 99)).toEqual({ prev: 30, next: null, nearest: 30, isPresent: false }));
  it('empty', () => expect(neighbors([], 5)).toEqual({ prev: null, next: null, nearest: null, isPresent: false }));
});
```

- [ ] **Step 2 — Run, verify fail** (`npx vitest run src/avail-client.test.ts`).
- [ ] **Step 3 — Implement** `src/avail-client.ts`:

```ts
import { decodeAvail } from './avail';

const cache = new Map<number, number[]>();
const inflight = new Map<number, Promise<number[]>>();

function availUrl(gen: number): string {
  return `${import.meta.env.BASE_URL}chunks/${gen}/avail.flam3idx`;
}

/** Cached fetch+decode of a gen's sorted present-id list. Fetch failure → []. */
export async function loadAvail(gen: number): Promise<number[]> {
  const hit = cache.get(gen);
  if (hit) return hit;
  const pending = inflight.get(gen);
  if (pending) return pending;
  const p = (async () => {
    try {
      const resp = await fetch(availUrl(gen));
      if (!resp.ok) return [];
      const ids = await decodeAvail(await resp.arrayBuffer());
      cache.set(gen, ids);
      return ids;
    } catch {
      return []; // never throw into the boot path
    } finally {
      inflight.delete(gen);
    }
  })();
  inflight.set(gen, p);
  return p;
}

export interface Neighbors { prev: number | null; next: number | null; nearest: number | null; isPresent: boolean; }

/** Binary-search a sorted id list for the prev/next/nearest present id. id need not be present. */
export function neighbors(ids: number[], id: number): Neighbors {
  if (ids.length === 0) return { prev: null, next: null, nearest: null, isPresent: false };
  // first index with ids[i] >= id
  let lo = 0, hi = ids.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if ((ids[mid] as number) < id) lo = mid + 1; else hi = mid; }
  const atOrAbove = lo;
  const isPresent = atOrAbove < ids.length && ids[atOrAbove] === id;
  const prevIdx = isPresent ? atOrAbove - 1 : atOrAbove - 1;
  const nextIdx = isPresent ? atOrAbove + 1 : atOrAbove;
  const prev = prevIdx >= 0 ? (ids[prevIdx] as number) : null;
  const next = nextIdx < ids.length ? (ids[nextIdx] as number) : null;
  let nearest: number | null;
  if (isPresent) nearest = id;
  else if (prev === null) nearest = next;
  else if (next === null) nearest = prev;
  else nearest = (id - prev) <= (next - id) ? prev : next; // ties → lower
  return { prev, next, nearest, isPresent };
}
```

- [ ] **Step 4 — Run tests green; typecheck.**
- [ ] **Step 5 — Commit** `feat(avail): cached avail-client + neighbor search (PYR3-041 foundation)`.

> ⚠️ INLINE task (lead): first foundational module; locks the avail-client contract the UI + main.ts consume. Pure logic — but lead should write it so the seam is right.

---

## Phase 2 — Three-bar restructure (layout only, no behavior change)

### Task 2: Split `ui-bar.ts` into info bar + action bar; remove the 4K button

**Files:** Modify `src/ui-bar.ts`, `src/main.ts` (rename `onRender4K`→`onRenderQuality` callsite stub).

- [ ] **Step 1** — In `mountBar`, build two rows instead of one:
  - `.pyr3-bar-info` (was the row's left+right zones): wordmark mark · about · showcase · meta-name · spacer · WebGPU pill · fork-it · more-flames.
  - `.pyr3-bar-action` (new): `📂 Open` (moved from center) · a `quality` placeholder slot (filled in Phase 4) · spacer · a `corpus-nav` placeholder slot (filled in Phase 3).
  - Keep `buildTier3` (render-progress row ③) exactly as-is; it still mounts/unmounts on `showProgress`/`hideProgress`, now appended after the action bar.
- [ ] **Step 2** — Remove the `render4kBtn` + `onRender4K` from `BarOpts`; add `onRenderQuality(q: QualityRequest)` and stub it in `main.ts` to call the existing 4K decoupled path with the `4K` tier (temporary, until Phase 4). Keep the app rendering.
- [ ] **Step 3** — Add the two-row CSS (info bar = current `.pyr3-bar-row` style; action bar = `--bar-bg-3`-ish tone, `border-bottom`). Reuse existing tokens.
- [ ] **Step 4** — Typecheck + `npm test` green (no test asserts bar structure today; confirm nothing references `onRender4K`).
- [ ] **Step 5 — Chrome verify** (build+preview): two bars render; Open + (temporary) 4K-via-quality still work; render-progress row still appears during a render, now below the action bar.
- [ ] **Step 6 — Commit** `refactor(ui): split viewer bar into info + action rows (PYR3-050)`.

> ⚠️ INLINE task (lead): structural UI + needs Chrome verify + dev server. Locks the bar DOM shape later tasks extend.

---

## Phase 3 — Corpus navigation (PYR3-039 / 040 / 041)

### Task 3: Corpus-nav cluster in the action bar + wire avail-client

**Files:** Modify `src/ui-bar.ts` (nav cluster + `setCorpusNav`), `src/main.ts` (load avail on corpus intent, pushState navigation).

- [ ] **Step 1** — `ui-bar.ts`: add `setCorpusNav(nav: { gen: number; prev: number|null; next: number|null } | null)`. Renders into the action-bar nav slot: a `‹ <gen>.<prev>` pill and a `<gen>.<next> ›` pill (omit a side that's null; render nothing when `null`). Each pill `onclick` → `opts.onNavigate(gen, id)`. Cache the pill nodes; mutate textContent on update (per the per-frame-replaceChildren+click gotcha in CLAUDE.md — though these update rarely, follow the pattern).
- [ ] **Step 2** — `main.ts`: after a successful `corpus` load, `const ids = await loadAvail(gen); const n = neighbors(ids, id); bar.setCorpusNav({ gen, prev: n.prev, next: n.next });`. For non-corpus loads (Open button, default welcome), `bar.setCorpusNav(null)`.
- [ ] **Step 3** — `main.ts`: implement `onNavigate(gen, id)` → `history.pushState({}, '', \`${BASE_URL}v1/gen/${gen}/id/${id}\`)` then re-run the corpus resolve+render path (extract the corpus-load body into a reusable `loadCorpus(gen, id)`); also handle `popstate` to support back/forward.
- [ ] **Step 4 — Chrome verify:** load a present sheep → nav shows correct adjacent present ids; click next/prev → URL updates (no reload) + new flame renders + nav updates.
- [ ] **Step 5 — Commit** `feat(viewer): corpus prev/next nav via avail-client (PYR3-041)`.

### Task 4: Graceful missing-sheep state + reworded copy (PYR3-039/040)

**Files:** Modify `src/main.ts` (`resolveLoadIntent` corpus case + a missing-sheep painter), `src/ui-bar.ts` (info-bar "not in corpus" meta state).

- [ ] **Step 1** — `main.ts` corpus case: on `FlameNotFound`, do **not** fall back to the welcome flame. Instead: keep chrome, `bar.setMeta` to a "not in corpus" variant (info bar shows `gen <g> · sheep <id> — not in corpus`), `bar.setCorpusNav({gen, prev, next})` from `neighbors`, and paint the canvas message:
  > **Electric Sheep was not found** — use ‹ prev or next › to jump to a valid flame.
  (Reuse/adapt the existing `showError`/fallback DOM, but as an in-viewer panel, not a welcome-flame swap. No "never born" text anywhere.)
- [ ] **Step 2** — Ensure a present→missing→present navigation sequence clears the missing panel correctly (hide it once a real flame renders).
- [ ] **Step 3 — Chrome verify:** `/v1/gen/247/id/123` (missing) → viewer chrome stays, canvas shows the reworded message, nav offers nearest prev/next, clicking jumps to a valid sheep that renders.
- [ ] **Step 4 — Commit** `feat(viewer): graceful missing-sheep state + honest copy (PYR3-039/040)`.

> ⚠️ Tasks 3–4: INLINE (Chrome verify + dev server + History API). Lead-run.

---

## Phase 4 — Quality control: preset ladder

### Task 5: `QUALITY_TIERS` in presets.ts + tests

**Files:** Modify `src/presets.ts`, `src/presets.test.ts` (create if absent).

- [ ] **Step 1 — Write tests:** `QUALITY_TIERS` is length 5, names `['Draft','Preview','Standard','High','4K']`, `longEdge` strictly increasing `[512,1024,1920,2560,3840]`, `spp` strictly increasing `[8,16,50,100,200]`; `Preview` maps to the legacy `quick` values (maxDim 1024, maxSpp 16, mode 'cap') and `4K` to legacy `4k` (3840/200/force).
- [ ] **Step 2 — Run, verify fail.**
- [ ] **Step 3 — Implement:**

```ts
export interface QualityTier { name: string; longEdge: number; spp: number; oversample: 1; mode: 'cap' | 'force'; }

export const QUALITY_TIERS: QualityTier[] = [
  { name: 'Draft',    longEdge: 512,  spp: 8,   oversample: 1, mode: 'cap' },
  { name: 'Preview',  longEdge: 1024, spp: 16,  oversample: 1, mode: 'cap' },   // = legacy `quick`
  { name: 'Standard', longEdge: 1920, spp: 50,  oversample: 1, mode: 'force' },
  { name: 'High',     longEdge: 2560, spp: 100, oversample: 1, mode: 'force' },
  { name: '4K',       longEdge: 3840, spp: 200, oversample: 1, mode: 'force' }, // = legacy `4k`
];
export const DEFAULT_TIER = QUALITY_TIERS[1]!; // Preview

/** Build a PresetSpec from a tier (so applyPreset() handles dims/aspect/quality uniformly). */
export function tierToSpec(t: QualityTier): PresetSpec {
  return { maxDim: t.longEdge, maxSpp: t.spp, oversample: t.oversample,
           shortEdgeRound: t.mode === 'force' ? 'floor' : 'round', mode: t.mode };
}
```

- [ ] **Step 4 — Tests green; typecheck.**
- [ ] **Step 5 — Commit** `feat(presets): QUALITY_TIERS ladder shared by FE/CLI (PYR3-050)`.

> ⚠️ Tasks with pure logic + Vitest (Task 5): SUBAGENT-eligible.

### Task 6: Quality ladder in the action bar + render dispatch + info-bar readout

**Files:** Modify `src/ui-bar.ts` (segmented ladder + `setQuality`), `src/main.ts` (`QualityRequest` resolve → decoupled orchestrator).

- [ ] **Step 1** — Define `type QualityRequest = { kind:'tier'; tier: QualityTier } | { kind:'custom'; longEdge:number; spp:number; oversample:1 }` (export from `presets.ts` or a small `quality.ts`).
- [ ] **Step 2** — `ui-bar.ts`: build the segmented control from `QUALITY_TIERS` in the action-bar quality slot; active tier highlighted; clicking a tier calls `opts.onRenderQuality({kind:'tier', tier})`. Add `setQuality({width,height,spp,tierLabel})` → updates the info-bar meta readout (`· {w}×{h} · q{spp} · {tierLabel}`). Cache nodes; mutate textContent.
- [ ] **Step 3** — `main.ts`: `onRenderQuality(req)` → resolve to dims+spp (tier: `applyPreset(genome, tierToSpec(tier))`; custom: apply long-edge to native aspect + spp), then drive `startDecoupledRender` toward that SPP/dims (same path the old 4K button used; reallocate histogram on dim change). On completion call `bar.setQuality(...)`. Default load renders the `DEFAULT_TIER` (Preview) and sets the readout.
- [ ] **Step 4 — Chrome verify:** each tier renders + the info-bar readout updates; Preview matches today's quick first paint; 4K matches the old button output; switching tiers refines progressively (no freeze).
- [ ] **Step 5 — Commit** `feat(viewer): quality preset ladder + info-bar readout (PYR3-050)`.

> ⚠️ Task 6: INLINE (Chrome verify, decoupled-orchestrator wiring, dev server).

---

## Phase 5 — Advanced disclosure (custom resolution + SPP)

### Task 7: Advanced row — custom long-edge + SPP slider + live cost estimate + OOM gate

**Files:** Modify `src/ui-bar.ts` (Advanced toggle + sub-row), `src/main.ts` (custom QualityRequest), reference the v0.29 `maxStorageBufferBindingSize` guard.

- [ ] **Step 1** — `ui-bar.ts`: an `Advanced ▾` button in the action bar toggles a `.pyr3-bar-advanced` sub-row (mounts/unmounts like the tier3 row): a long-edge number field (default = current tier longEdge), an SPP `<input type=range>` [4,400] showing `q{n}`, a live cost label, and a `Render` button.
- [ ] **Step 2** — Cost estimate helper (pure, testable): given `longEdge` + native aspect → derived `width,height` → histogram bytes (match the v0.29 guard's per-pixel byte math) → `{ mb, fits: bytes <= maxStorageBufferBindingSize }`; time heuristic `pixels*spp/THROUGHPUT`. Add a unit test for the dims-from-longEdge + bytes math. Render button disabled when `!fits` (label shows `✗ exceeds limit`).
- [ ] **Step 3** — `main.ts`: Render → `onRenderQuality({kind:'custom', longEdge, spp, oversample:1})` → same dispatch as Task 6; the pre-flight guard mirrors the cost estimate; the existing post-dispatch storage abort+toast stays as backstop.
- [ ] **Step 4 — Chrome verify:** open Advanced → custom 3840 long-edge + q200 renders + readout updates; push long-edge huge → cost shows `✗` + Render disabled (no tab crash); aspect respected (no distortion).
- [ ] **Step 5 — Commit** `feat(viewer): Advanced custom resolution/SPP with cost+OOM gate (PYR3-050)`.

> ⚠️ Task 7: INLINE (Chrome verify, GPU limits, dev server). Cost-math helper alone is SUBAGENT-eligible if split.

---

## Phase 6 — Review, docs, verify gate

### Task 8: Code review + docs + ship

- [ ] **Step 1** — Dispatch a fresh `feature-dev:code-reviewer` on the full diff (focus: avail-client correctness, History/popstate handling, no-innerHTML discipline, OOM gate, engine seam intact, no dangling 4K-button refs).
- [ ] **Step 2** — Address findings.
- [ ] **Step 3** — Docs: resolve `[PYR3-039/040/041]` + `[PYR3-050]` in BACKLOG (move to Resolved); bump Next ID; CHANGELOG entry (v0.33); ROADMAP shipped row + next-up; VISION "browsable corpus" note. Update README only if quick — else fold into the PYR3-049 overhaul.
- [ ] **Step 4** — Full verify: `npm run typecheck` + `npm test`; build+preview Chrome pass of the whole feature (browse, miss, all tiers, Advanced, OOM).
- [ ] **Step 5** — User-verify-before-FF-merge gate; then FF-merge to main (auto-deploys) + branch cleanup.

---

## Self-review (against the spec)

- **Spec coverage:** three-bar layout → Task 2; avail-client → Task 1; corpus nav (041) → Task 3; missing-sheep + reword (039/040) → Task 4; quality tiers (050) → Tasks 5–6; Advanced custom + cost/OOM → Task 7; info-bar readout (#2) → Tasks 2/6; docs → Task 8. ✔ all covered.
- **Types consistent:** `QualityRequest`, `QualityTier`, `tierToSpec`, `Neighbors`, `setQuality`, `setCorpusNav`, `onRenderQuality`, `onNavigate`, `loadCorpus`, `neighbors`, `loadAvail` used consistently across tasks. ✔
- **No placeholders:** new-module code is complete; UI edits to large existing files are described by responsibility + interface + key snippets (the files are big and line-exact code would be brittle — engineer follows the established `ui-bar.ts` builder patterns). ✔
- **Phasing:** nav (Phases 1–3) and quality (Phases 4–5) are independently shippable — can FF-merge as v0.33a (nav) + v0.33b (quality) if preferred, or one v0.33.
