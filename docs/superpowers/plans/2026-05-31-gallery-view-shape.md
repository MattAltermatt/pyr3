# Gallery view shape — Implementation Plan (#47)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/v1/gallery/p/N` — a 3×3 grid of live pyr3 Draft renders, page-by-9 nav, contextual entry from the viewer, click-through to viewer, browser-back returns to gallery page.

**Architecture:** Single-SPA inline extension of `main.ts`. New `LoadIntent` kind `'gallery'` dispatches to a new `mountGallery()` that swaps the DOM shape (hides the canvas, shows a 9-cell grid) and runs a wave-fill orchestrator over the same shared `Renderer` + WebGPU device the viewer uses. The renderer is taught to repoint its canvas between cell renders. The gallery's top bar mirrors the viewer's bar with `‹ page N of M ›` centered.

**Tech Stack:** TypeScript, WebGPU, Vite, Vitest. Same toolchain as the viewer — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-31-gallery-view-shape-design.md` (locked, brainstorm-output)
**Branch:** `feature/issue-47-gallery-view-shape` (already created)
**Issue:** #47 (v1.2 milestone)

---

## File structure

```text
file                              role
-------------------------------   ----------------------------------------------
src/load-intent.ts                URL grammar — adds /v1/gallery + /v1/gallery/p/N
                                  + helpers galleryUrl(), pageForSheep()
src/load-intent.test.ts           +gallery URL parse/roundtrip cases
src/renderer.ts                   small surface — setCanvas(ctx) lets one
                                  Renderer drive different cells in sequence
src/gallery-mount.ts              NEW — page math + DOM grid + wave-fill
                                  orchestrator + cancellation + nav handlers
src/gallery-mount.test.ts         NEW — pure-logic tests (no DOM/WebGPU):
                                  pageForSheep, page-of-9 enumeration,
                                  wave-fill ordering against a mocked renderer,
                                  cancellation behavior
src/ui-bar.ts                     +gallery text link in viewer bar's left zone
                                  +mountGalleryBar() variant — same chrome with
                                  ‹ page N of M › centered
index.html                        +<div id="pyr3-gallery"> sibling of <canvas>;
                                  hidden by default
src/main.ts                       +dispatch on kind === 'gallery'
                                  +contextual page computation on gallery-link
                                   click in the viewer
src/corpus-bounds.ts              REUSED — resolveCorpusNeighbors gives the
                                  cross-gen walk for page-of-9 enumeration
```

Two new files; five modified; one reused.

---

## Phase 1 — Foundation (URL + engine seam)

### Task 1: URL grammar + page-math helpers

**Why this is the first task and must run inline:** locks the contract every downstream task uses (`LoadIntent.gallery`, `galleryUrl`, `pageForSheep`). If the shape changes after Task 3 starts, downstream rework cascades.

**Files:**
- Modify: `src/load-intent.ts` (add `'gallery'` kind, helpers, parse cases)
- Modify: `src/load-intent.test.ts` (parse + roundtrip + malformed)

- [ ] **Step 1: Extend `LoadIntent` + `parseLoadIntent`**

Add to the discriminated union:
```typescript
| { kind: 'gallery'; page: number }
```

Inside `parseLoadIntent`, after the existing `sub === 'gen'` block, add a `'gallery'` branch under the `parts[0] === 'v1'` guard:

```typescript
} else if (sub === 'gallery') {
  // /v1/gallery → page 1 (canonical default)
  if (parts.length === 2) {
    return { kind: 'gallery', page: 1 };
  }
  // /v1/gallery/p/{page}
  if (
    parts.length === 4 &&
    parts[2] === 'p' &&
    isNonNegInt(parts[3]!) &&
    Number(parts[3]) >= 1
  ) {
    return { kind: 'gallery', page: Number(parts[3]) };
  }
  // Anything else (e.g. /v1/gallery/p/0, /v1/gallery/p/abc) falls through to default
}
```

- [ ] **Step 2: Add `galleryUrl(page)` and `pageForSheep(...)` helpers**

In `src/load-intent.ts`, alongside the existing `corpusUrl`:

```typescript
/** Canonical share URL for a gallery page. page=1 produces the bare URL
 *  (`/v1/gallery`); page>1 includes the `/p/N` suffix. Round-trip via
 *  parseLoadIntent guaranteed (covered in load-intent.test.ts). */
export function galleryUrl(page: number): string {
  if (page <= 1) return `${import.meta.env.BASE_URL}v1/gallery`;
  return `${import.meta.env.BASE_URL}v1/gallery/p/${page}`;
}

/** GALLERY_PAGE_SIZE = 9 (3×3 grid). The single source of truth — used by
 *  pageForSheep, gallery-mount, and any future page-math callers. */
export const GALLERY_PAGE_SIZE = 9;

/** Which gallery page contains the (gen, id) sheep under canonical corpus
 *  order. Returns 1 when the sheep is the first in corpus order. Used by
 *  the viewer's gallery link to navigate contextually. corpusIndex is the
 *  0-based position in the cross-gen walk; the caller (main.ts) computes
 *  it via corpus-bounds. */
export function pageForCorpusIndex(corpusIndex: number, perPage = GALLERY_PAGE_SIZE): number {
  return Math.floor(corpusIndex / perPage) + 1;
}
```

(Note: `pageForSheep(gen, id)` lives in `gallery-mount.ts` or `main.ts` because it needs the cross-gen walker; this helper takes a pre-computed index so `load-intent.ts` stays free of corpus-fetch concerns.)

- [ ] **Step 3: Add tests in `src/load-intent.test.ts`**

```typescript
describe('parseLoadIntent — gallery', () => {
  it('parses /v1/gallery as page 1', () => {
    expect(parseLoadIntent({ pathname: '/v1/gallery' }))
      .toEqual({ kind: 'gallery', page: 1 });
  });

  it('parses /v1/gallery/p/27', () => {
    expect(parseLoadIntent({ pathname: '/v1/gallery/p/27' }))
      .toEqual({ kind: 'gallery', page: 27 });
  });

  it('rejects /v1/gallery/p/0 (1-indexed) as default', () => {
    expect(parseLoadIntent({ pathname: '/v1/gallery/p/0' }))
      .toEqual({ kind: 'default' });
  });

  it('rejects /v1/gallery/p/abc as default', () => {
    expect(parseLoadIntent({ pathname: '/v1/gallery/p/abc' }))
      .toEqual({ kind: 'default' });
  });

  it('rejects /v1/gallery/junk/p/3 as default', () => {
    expect(parseLoadIntent({ pathname: '/v1/gallery/junk/p/3' }))
      .toEqual({ kind: 'default' });
  });
});

describe('galleryUrl', () => {
  it('page 1 produces bare URL', () => {
    expect(galleryUrl(1)).toMatch(/v1\/gallery$/);
  });

  it('page 27 produces /p/27 suffix', () => {
    expect(galleryUrl(27)).toMatch(/v1\/gallery\/p\/27$/);
  });

  it('roundtrips through parseLoadIntent', () => {
    for (const page of [1, 2, 27, 5778]) {
      const url = galleryUrl(page);
      const parsed = parseLoadIntent({ pathname: new URL(url, 'http://x/').pathname });
      expect(parsed).toEqual({ kind: 'gallery', page });
    }
  });
});

describe('pageForCorpusIndex', () => {
  it.each([
    [0, 1], [8, 1], [9, 2], [17, 2], [18, 3], [243, 28],
  ])('index %i → page %i', (idx, expected) => {
    expect(pageForCorpusIndex(idx)).toBe(expected);
  });
});
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck && npm test -- --run src/load-intent.test.ts
```

Expected: typecheck clean, all `gallery` + `pageForCorpusIndex` + `galleryUrl` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/load-intent.ts src/load-intent.test.ts
git commit -m "feat(load-intent): /v1/gallery grammar + page-math helpers"
```

---

### Task 2: Renderer canvas repoint

**Why:** the gallery needs one `Renderer` + one WebGPU device to drive 9 different cell canvases sequentially. Verify whether `createRenderer()` already supports this or needs a small surface addition.

**Files:**
- Modify: `src/renderer.ts` (probably: new `setCanvas(ctx)` method; or document that repoint already works)
- Modify: `src/renderer.test.ts` (or add new test for canvas swapping if one doesn't exist)

- [ ] **Step 1: Read `src/renderer.ts` to determine the current canvas-binding contract**

The createRenderer signature today is `createRenderer(device, format, opts)`. Confirm whether the canvas context is bound at construction or per-render. If bound at construction → add a `setCanvas(ctx: GPUCanvasContext)` method that swaps the context without re-allocating GPU buffers; if per-render → no change needed and this task degrades to "add a test confirming the contract."

- [ ] **Step 2: Add the surface or the test**

If adding `setCanvas`:

```typescript
// In Renderer (renderer.ts)
/** Repoint the renderer at a different presentation canvas context.
 *  Used by the gallery wave-fill orchestrator to drive 9 cell canvases
 *  from one device. GPU buffers/pipelines are retained; only the present
 *  target swaps. The new context must use the same device + format. */
setCanvas(ctx: GPUCanvasContext): void {
  // existing internal state ← ctx
}
```

If no change needed, document the existing behavior with a comment block.

- [ ] **Step 3: Test**

Add a test that:
1. Creates a Renderer
2. Renders to canvas A
3. Repoints to canvas B
4. Renders again
5. Asserts both canvases received non-empty pixel data and that no GPU resources leaked (use existing test patterns in `renderer.test.ts` if any; otherwise write a focused unit test against a mock device).

If the existing test suite doesn't cover the renderer directly (it's a higher-level module), the test can live in `gallery-mount.test.ts` as part of the orchestrator's mocked-renderer flow — note this in the commit message.

- [ ] **Step 4: Verify**

```bash
npm run typecheck && npm test
```

Expected: all existing tests green, new renderer-repoint test green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer.ts src/renderer.test.ts  # or wherever the test landed
git commit -m "feat(renderer): support canvas repoint for gallery wave-fill"
```

---

## Phase 2 — Gallery surface (mount + DOM + orchestrator)

### Task 3: Gallery page-math + corpus walker (pure logic)

**Why:** the orchestrator needs `pageOfSheep(page) → array of 9 (gen, id) tuples` and the reverse `pageForSheep(currentGen, currentId) → page` for contextual entry. Both are pure functions over `corpus-bounds.ts`'s cross-gen walker — straightforward to unit-test without DOM/WebGPU.

**Files:**
- Create: `src/gallery-mount.ts` (initial — just the pure helpers; DOM + orchestrator come in Task 4)
- Create: `src/gallery-mount.test.ts`

- [ ] **Step 1: Add pure helpers**

```typescript
// src/gallery-mount.ts (initial scaffold)
import { GALLERY_PAGE_SIZE } from './load-intent';
import { loadGensManifest, resolveCorpusNeighbors } from './corpus-bounds';

export interface SheepRef { gen: number; id: number; }

/** Resolve the 9 SheepRefs for a 1-indexed gallery page.
 *  Walks corpus order (gens ascending, ids ascending within gen) and
 *  slices [(page-1)*9, page*9). Trailing pages may yield <9 if the
 *  corpus tail is short — caller renders empty cells for the gap. */
export async function pageOfSheep(page: number, perPage = GALLERY_PAGE_SIZE): Promise<SheepRef[]> {
  // implementation walks resolveCorpusNeighbors starting from (firstGen, firstId)
  // and advancing perPage*(page-1) steps, then collecting perPage refs.
  // See existing pattern in corpus-bounds.ts for the walker primitive.
}

/** Which 1-indexed gallery page contains (gen, id) under canonical corpus
 *  order. Used by the viewer's gallery-link click for contextual entry. */
export async function pageForSheep(gen: number, id: number, perPage = GALLERY_PAGE_SIZE): Promise<number> {
  // Walks from corpus start, counting steps until (gen, id) is hit. Returns
  // floor(count / perPage) + 1. For typical pages near the corpus tail this
  // is O(corpus); acceptable for a one-shot click. If perf becomes an issue,
  // resolveCorpusNeighbors can support direct index lookup later.
}
```

- [ ] **Step 2: Write tests**

```typescript
// src/gallery-mount.test.ts
import { describe, it, expect, vi } from 'vitest';
import { pageOfSheep, pageForSheep } from './gallery-mount';

// Mock corpus-bounds with a small synthetic corpus:
//   gen 100: [10, 20, 30, 40, 50]
//   gen 101: [11, 22, 33]
// → canonical order: (100,10) (100,20) (100,30) (100,40) (100,50)
//                    (101,11) (101,22) (101,33)
// 8 sheep total; perPage=3 → 3 pages (last has 2)

vi.mock('./corpus-bounds', () => ({ /* synthetic walker stub */ }));

describe('pageOfSheep', () => {
  it('page 1 returns first 3 sheep', async () => {
    expect(await pageOfSheep(1, 3)).toEqual([
      { gen: 100, id: 10 }, { gen: 100, id: 20 }, { gen: 100, id: 30 },
    ]);
  });

  it('page 2 crosses gens at the boundary', async () => {
    expect(await pageOfSheep(2, 3)).toEqual([
      { gen: 100, id: 40 }, { gen: 100, id: 50 }, { gen: 101, id: 11 },
    ]);
  });

  it('page 3 returns trailing partial page', async () => {
    expect(await pageOfSheep(3, 3)).toEqual([
      { gen: 101, id: 22 }, { gen: 101, id: 33 },
    ]);
  });
});

describe('pageForSheep', () => {
  it.each([
    [100, 10, 1], [100, 30, 1], [100, 40, 2], [101, 22, 3],
  ])('(%i, %i) → page %i', async (gen, id, expected) => {
    expect(await pageForSheep(gen, id, 3)).toBe(expected);
  });
});
```

- [ ] **Step 3: Verify**

```bash
npm run typecheck && npm test -- --run src/gallery-mount.test.ts
```

Expected: typecheck clean, all `pageOfSheep` + `pageForSheep` tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/gallery-mount.ts src/gallery-mount.test.ts
git commit -m "feat(gallery): page-math + corpus-walker helpers"
```

---

### Task 4: Wave-fill orchestrator + DOM grid (INLINE — touches Renderer + DOM)

**Why inline:** wires the Renderer (Task 2) to live `<canvas>` elements in real Chrome — needs the lead session for the eventual Chrome verify in Task 9, and the orchestration logic involves async cancellation patterns that benefit from interactive debugging if anything misbehaves.

**Files:**
- Modify: `src/gallery-mount.ts` (add `mountGallery()` exported function — DOM construction + orchestrator)
- Modify: `src/gallery-mount.test.ts` (add orchestrator tests with a mock Renderer)

- [ ] **Step 1: Add the DOM builder + wave-fill orchestrator**

Sketch:

```typescript
export interface GalleryMountDeps {
  renderer: Renderer;            // Shared with the viewer (one device)
  container: HTMLElement;        // <div id="pyr3-gallery">
  fetchGenome: (gen: number, id: number) => Promise<Genome>;
  draftTier: QualityTier;        // QUALITY_TIERS[0] from presets.ts
}

export interface GalleryMountHandle {
  setPage(page: number): Promise<void>;
  cancel(): void;
  destroy(): void;
}

export async function mountGallery(page: number, deps: GalleryMountDeps): Promise<GalleryMountHandle> {
  // 1. Empty `container`; build grid div + 9 cell wrappers (each: <a><canvas></a><label>)
  // 2. Resolve sheep refs via pageOfSheep(page)
  // 3. Wire each cell's <a href> to corpusUrl(gen, id) — clicks navigate, browser handles history
  // 4. Run wave-fill: for each cell in order:
  //      - check cancelled flag; bail if set
  //      - fetch genome (deps.fetchGenome)
  //      - apply draft tier
  //      - renderer.setCanvas(cell's GPUCanvasContext)
  //      - await render completion
  //      - on completion, mark cell as ready
  //    On error per cell: render empty cell + "(missing)" label, continue.
  // 5. Return a handle with setPage (cancels current wave, starts new), cancel(), destroy()
}
```

- [ ] **Step 2: Add orchestrator tests**

Mock the Renderer + fetchGenome and assert:

```typescript
describe('mountGallery — orchestration', () => {
  it('paints 9 cells in top-left → bottom-right order', async () => {
    // Mock renderer records render order; assert sequence is cell 0..8.
  });

  it('cancels in-flight wave when setPage is called', async () => {
    // Start page 1; immediately call setPage(2); assert page-1 wave aborts
    // before all 9 cells complete; page-2 wave completes.
  });

  it('handles per-cell genome 404 by emitting a (missing) cell', async () => {
    // Mock fetchGenome to throw on cell 3; assert cells 0,1,2 paint normally,
    // cell 3 shows missing-label, cells 4..8 continue.
  });

  it('exposes the page in the gallery bar', async () => {
    // Render at page 27; assert container's "page N of M" element reads "27".
  });
});
```

- [ ] **Step 3: Verify**

```bash
npm run typecheck && npm test -- --run src/gallery-mount.test.ts
```

Expected: typecheck clean, all orchestrator tests pass. Tests use mocked renderer — no real WebGPU required.

- [ ] **Step 4: Commit**

```bash
git add src/gallery-mount.ts src/gallery-mount.test.ts
git commit -m "feat(gallery): DOM grid + wave-fill orchestrator with cancellation"
```

---

## Phase 3 — Chrome integration

### Task 5: ui-bar.ts — gallery link + gallery bar variant

**Files:**
- Modify: `src/ui-bar.ts` (add `gallery` link in left zone of viewer bar; new `mountGalleryBar()` variant)
- Modify: `src/ui-bar.test.ts` (or whichever test file exercises the bar)

- [ ] **Step 1: Add the `gallery` link in the viewer bar's left zone**

In `mountBar()`'s left-zone construction, after the existing `showcase` link, add:

```typescript
// Sibling of `showcase` — both point at gallery-like surfaces (curated /showcase
// vs the full corpus). Click navigates to /v1/gallery/p/N for the page
// containing the currently-displayed sheep (computed in main.ts; the link's
// href is set/updated each time the corpus position changes).
const galleryLink = el('a', 'pyr3-bar-link');
galleryLink.textContent = 'gallery';
galleryLink.href = galleryUrl(1); // updated by main.ts when corpus position is known
leftZone.appendChild(galleryLink);
```

Expose a `setGalleryHref(page: number)` method on `BarHandle` so `main.ts` can update it as the user navigates within the viewer.

- [ ] **Step 2: Add `mountGalleryBar()` variant**

A separate exported function that mounts the gallery's top bar:

```typescript
export interface GalleryBarOpts {
  page: number;
  totalPages: number;
  onPrevPage(): void;
  onNextPage(): void;
}

export function mountGalleryBar(root: HTMLElement, opts: GalleryBarOpts): GalleryBarHandle {
  // Same left/center/right zone shape as the viewer bar, but center contains:
  //   ‹ prev   ·   page N of M   ·   next ›
  // Right zone keeps WebGPU pill + fork + more-flames octocats.
  // Left zone keeps wordmark + about; the `gallery` link is omitted (we're
  // already in the gallery) and a `viewer` link (← back to viewer) is added.
}
```

- [ ] **Step 3: Add tests**

Cover at minimum:
- `mountBar` left zone contains a `gallery` element with the right href.
- `setGalleryHref(27)` updates the href to `/v1/gallery/p/27`.
- `mountGalleryBar` center contains a `page N of M` element + prev/next pills calling the right callbacks.
- The DOM is built via `createElement + textContent` only — no `innerHTML` (the existing repo invariant).

- [ ] **Step 4: Verify**

```bash
npm run typecheck && npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/ui-bar.ts src/ui-bar.test.ts
git commit -m "feat(ui-bar): gallery link in viewer + gallery-bar variant"
```

---

### Task 6: main.ts dispatch + index.html container (INLINE — Chrome-verify-adjacent)

**Why inline:** wires the new dispatch, manages DOM show/hide between viewer and gallery, computes contextual entry on click. This is the "click it in Chrome and watch it work" moment — best done in the lead session so we can hit Chrome MCP if anything misbehaves.

**Files:**
- Modify: `src/main.ts` (dispatch `kind === 'gallery'`; contextual computation; show/hide)
- Modify: `index.html` (add `<div id="pyr3-gallery">`)

- [ ] **Step 1: Add the gallery container to `index.html`**

```html
<!-- Sibling of the existing <canvas>; hidden by default, shown when
     parseLoadIntent returns {kind: 'gallery', ...}. mountGallery builds
     the 3×3 cell DOM inside this div. -->
<div id="pyr3-gallery" hidden></div>
```

- [ ] **Step 2: Extend `main()` dispatch**

After `parseLoadIntent(location)`:

```typescript
const intent = parseLoadIntent(location);

if (intent.kind === 'gallery') {
  // Hide canvas; show gallery container.
  canvas.hidden = true;
  galleryDiv.hidden = false;

  // Unmount viewer bar; mount gallery bar.
  viewerBar.destroy();
  const totalPages = await computeTotalPages(); // floor(corpusSize / 9) + 1
  const galleryBar = mountGalleryBar(barRoot, {
    page: intent.page,
    totalPages,
    onPrevPage: () => navigateGallery(intent.page - 1),
    onNextPage: () => navigateGallery(intent.page + 1),
  });

  const handle = await mountGallery(intent.page, {
    renderer, container: galleryDiv,
    fetchGenome: fetchFlameXmlByGenId, // shared with the viewer
    draftTier: QUALITY_TIERS[0],
  });

  // Wire ‹/› → handle.setPage + history.pushState
  // ...
  return;
}

// Existing viewer dispatch (corpus / default / gen-list / etc.) unchanged.
```

Add `navigateGallery(page)` helper that:
- Clamps to `[1, totalPages]`; if out of range, calls `history.replaceState` with the clamped URL.
- Calls `history.pushState({}, '', galleryUrl(page))`.
- Calls `handle.setPage(page)`.

- [ ] **Step 3: Contextual entry — update the viewer's `gallery` link**

In the viewer's load-corpus path (`kind === 'corpus'`), after the genome paints, compute the contextual page and set the link:

```typescript
const contextualPage = await pageForSheep(intent.gen, intent.id);
viewerBar.setGalleryHref(contextualPage);
```

Run this on initial corpus load AND on each prev/next nav (the current sheep changes).

- [ ] **Step 4: Handle popstate**

```typescript
window.addEventListener('popstate', () => {
  // Re-parse, re-dispatch. The existing viewer popstate handler is the
  // template; extend it to handle 'gallery' the same way (unmount current
  // surface, mount the new one).
});
```

- [ ] **Step 5: Verify (tests)**

```bash
npm run typecheck && npm test
```

Then manually start the dev server and Chrome-verify in the next task. For now, confirm:
- Typecheck clean.
- All tests green (including the dispatch wiring — if tests cover main.ts at all; if not, defer to Chrome verify).

- [ ] **Step 6: Commit**

```bash
git add src/main.ts index.html
git commit -m "feat(gallery): main.ts dispatch + index.html container + contextual entry"
```

---

## Phase 4 — Edges + polish

### Task 7: Edge cases (404 / out-of-range / debounce)

**Files:**
- Modify: `src/gallery-mount.ts` (cell 404 handler — already sketched in Task 4; out-of-range clamp; debounce)
- Modify: `src/main.ts` (out-of-range URL `replaceState`)
- Modify: `src/gallery-mount.test.ts` (tests for each)

- [ ] **Step 1: Cell 404 — confirm Task 4's handler renders the missing-cell state correctly**

The orchestrator should already catch fetch errors per cell. Verify the UI is right: empty/dark cell + `(missing)` label in place of `gen/id`. Add explicit test if not already covered.

- [ ] **Step 2: Page out-of-range clamp**

In `navigateGallery(page)` (Task 6):
- If `page < 1`: clamp to 1; `history.replaceState` to `galleryUrl(1)`.
- If `page > totalPages`: clamp to `totalPages`; `history.replaceState` to `galleryUrl(totalPages)`.

Add a test in `gallery-mount.test.ts` that asserts a request for page 0 or page 99999 results in the clamped page loading.

- [ ] **Step 3: Debounce ‹/› rapid-fire**

If three ‹/› events arrive in <100ms, coalesce to the last one. Implementation: a small debouncer around `navigateGallery`. Test: synthesize 5 rapid `next` events; assert only the final page mounts.

- [ ] **Step 4: Verify**

```bash
npm run typecheck && npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/gallery-mount.ts src/main.ts src/gallery-mount.test.ts
git commit -m "feat(gallery): cell-404 / out-of-range clamp / ‹/› debounce"
```

---

## Phase 5 — Review + verify

### Task 8: Code review (fresh reviewer agent)

**Why this is a phase, not a step:** required by CLAUDE.md — "Multi-step plans include code-review as second-to-last phase before final verification — dispatch a fresh reviewer agent (no implementation bias)."

- [ ] **Step 1: Dispatch the reviewer**

In the lead session (NOT in a subagent — this skill is for the parent), invoke:

```text
Agent({
  description: "Review gallery view shape",
  subagent_type: "feature-dev:code-reviewer",
  prompt: "Review the gallery-view-shape branch (feature/issue-47-gallery-view-shape).
  Spec: docs/superpowers/specs/2026-05-31-gallery-view-shape-design.md.
  Plan: docs/superpowers/plans/2026-05-31-gallery-view-shape.md.
  Branch is N commits ahead of main; full diff: `git diff main...HEAD`.
  Look for: correctness bugs (URL grammar edge cases, race conditions
  in wave-fill cancellation, history-state correctness), code quality
  issues (DRY violations, missing tests, ambiguous naming), adherence
  to pyr3 conventions (createElement + textContent only, single-engine-
  two-consumers seam, no environment branching). Report findings as
  high-confidence issues only — skip nits."
})
```

- [ ] **Step 2: Address review findings**

For each high-confidence finding, fix in place and commit. Findings that are stylistic / low-confidence → skip (per the reviewer's filtering).

- [ ] **Step 3: Verify review issues are resolved**

```bash
npm run typecheck && npm test
```

- [ ] **Step 4: Commit (one or more, depending on findings)**

```bash
git commit -m "fix(gallery): address review findings — <one-line summary>"
```

---

### Task 9: Final verify — typecheck, tests, Chrome MCP visual

**Why inline:** Chrome MCP tool isn't available to subagents (CLAUDE.md memory). This is the gallery-specific verify gate per the spec.

- [ ] **Step 1: Full local gate**

```bash
npm run typecheck && npm test
```

Expected: all clean. Parity rig (`npm run test:parity`) is NOT required for this feature — the render path is unchanged.

- [ ] **Step 2: Start dev server in background + Chrome verify**

```bash
npm run dev &
```

Hand the user the URL: `http://localhost:5173/v1/gallery` (no `?mute=1` — pyr3 has no audio).

Drive Chrome MCP through the visual contract per the spec's verification list:
1. Bare `/v1/gallery` loads page 1 with 9 cells (gradient placeholders appear; live renders complete in ~2-3s wave fill).
2. Click `›` → page 2 loads; cells repaint; URL becomes `/v1/gallery/p/2`.
3. Rapid `›` mash → debounce kicks in; only final page mounts.
4. Click cell 5 → viewer opens at the right `gen/id`; back-button → returns to gallery on the same page.
5. From viewer at `247/19679`, click `gallery` link in the bar → lands on the page containing `247/19679`.
6. Fresh `/v1/gallery/p/27` bookmark load → page 27 renders correctly.
7. `/v1/gallery/p/0` → clamps to page 1, URL replaced.

- [ ] **Step 3: Hand off to user for manual approval**

Per CLAUDE.md "User-verify before FF-merge": after Claude's automated + Chrome MCP pass, surface the dev URL + the verify checklist to the user. Wait for explicit go.

- [ ] **Step 4: FF-merge gate (separate explicit user ask)**

Per CLAUDE.md memory `feedback-explicit-ship-approval.md`: do NOT FF-merge without a separate explicit user go. Surface readiness; wait.

When approved:
```bash
git switch main
git merge --ff-only feature/issue-47-gallery-view-shape
git push origin main
```

Then close #47 via `/pyr3-issue-close 47`.

---

## Out-of-scope (do not implement here)

Filters / sort modes (#49), feature index (#48), gallery dice (#50), interestingness scoring, find-similar/clustering, hover previews, keyboard shortcuts, page-transition animations, localStorage persistence — all flagged in the spec's "Out of scope" section and tracked as their own issues.

---

_Plan produced via `superpowers:writing-plans` skill, 2026-05-31. Spec sibling at `docs/superpowers/specs/2026-05-31-gallery-view-shape-design.md`. Next: pick execution mode + start Task 1._
