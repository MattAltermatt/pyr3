# Gallery view shape — v1.2 design spec

**Issue:** #47 — Gallery view shape — virtualized grid over the full 52k corpus
**Milestone:** `v1.2 - gallery and discovery`
**Date:** 2026-05-31
**Status:** locked via brainstorm; ready for implementation plan

---

## Goal

Add a dedicated **gallery discovery surface** to pyr3, parallel to the viewer.
The architectural call (locked by the user during the v1.2 #21 restructure):
**gallery = discovery surface, viewer = view-only.** Discovery moves out of
the viewer; the gallery is where browsing happens.

## Scope (v1)

**In:**
- A new `/v1/gallery/p/N` route showing a **3×3 grid** of live pyr3 Draft
  renders, 9 sheep per page.
- Page nav (`‹` / `›`) advancing 9 sheep at a time through corpus order.
- Entry from the viewer via a new `gallery` link in the top bar's left zone
  (next to the existing `showcase` link).
- Click a cell → opens that sheep in the viewer (existing
  `/v1/gen/{gen}/id/{id}` route). Browser back returns to the gallery page.
- Contextual entry: the viewer's `gallery` link computes the page containing
  the current sheep and navigates to `/v1/gallery/p/X` (current sheep is
  visible on first paint).

**Out (explicitly deferred to other v1.2 issues / later milestones):**
- Filters by variation / xform count / sort modes → **#49** (gallery
  search/filter affordances)
- Interestingness scoring / "skip-to-interesting" → fold into **#48**
  (feature index) + **#49**
- Find-similar / cluster-by-pattern → deferred, likely v1.3+
- Precomputed thumbnail bundle → not needed; v1 uses live Draft renders
- Virtualization beyond 9 visible cells → not needed at this density
- Gallery's own 🎲 random pill → **#50** (separate, ships in parallel)

## Locked decisions (brainstorm output)

```text
decision                          choice
-------------------------------   ----------------------------------------
grid                              3×3, 9 cells per page
layout                            airy with gaps + small `gen/id` mono
                                  label below each cell (matches /showcase)
top-bar pattern                   mimics the viewer's top bar
                                  (left/center/right zones)
per-cell quality                  Draft tier (longEdge 512, spp 8, oversample 1)
render pacing                     wave fill — sequential top-left → bottom-right;
                                  each cell paints once it completes
page nav                          ‹ prev page · page N of M · next page ›
                                  centered in top bar
entry from viewer                 text link `gallery` in left zone next to
                                  `showcase` (matching style, no icon)
entry behavior                    contextual — pill computes pageForSheep(gen,id)
                                  and navigates to /v1/gallery/p/N
URL grammar                       /v1/gallery        → page 1 (canonical)
                                  /v1/gallery/p/N    → page N (1-indexed)
click-cell behavior               navigate to corpusUrl(gen, id) — viewer
                                  loads as it does today
back-button                       browser history pop returns to gallery page
cancellation                      ‹/› aborts any in-flight cell render
```

## URL grammar (extend `src/load-intent.ts`)

```text
existing:
  /v1/gen                              → {kind: 'gen-list'}
  /v1/gen/{gen}                        → {kind: 'gen-browse', gen}
  /v1/gen/{gen}/id/{id}                → {kind: 'corpus', gen, id}
  /v1/flame/...                        → {kind: 'custom-reserved'}

new:
  /v1/gallery                          → {kind: 'gallery', page: 1}
  /v1/gallery/p/{page}                 → {kind: 'gallery', page: N}
  /v1/gallery/p/0 or non-positive      → fall through to default (malformed)
```

New helpers in `load-intent.ts`:
- `galleryUrl(page: number): string` — base-aware canonical URL.
- `pageForSheep(gen: number, id: number, perPage = 9): number` — computes
  which page contains the (gen, id) tuple under canonical corpus order.
  Built on top of the cross-gen walk in `corpus-bounds.ts`.

`page = 1` produces the bare `/v1/gallery` URL (no `/p/1` suffix) to match
the "canonical default" pattern used by `/v1/gen/.../id/...`.

## Architecture

Single-SPA inline extension of `main.ts`. New `LoadIntent` kind dispatches
to a new `mountGallery()` function that swaps the DOM shape and mounts a
gallery-specific top bar. Reuses the same WebGPU device, first-paint cue,
and error handling.

**Files touched:**

```text
file                              change
-------------------------------   --------------------------------------------
src/load-intent.ts                +grammar (gallery, gallery/p/N)
                                  +LoadIntent kind 'gallery' { page: number }
                                  +helper galleryUrl(page)
                                  +helper pageForSheep(gen, id, perPage)
src/main.ts                       +dispatch on kind === 'gallery'
                                  → calls mountGallery(intent.page)
                                  +contextual page computation when the
                                   viewer's "gallery" link is clicked
src/gallery-mount.ts              NEW: builds 3×3 DOM, runs wave-fill
                                  orchestrator, wires ‹/› navigation
src/renderer.ts                   +canvas-repoint support (one Renderer,
                                  one device, swap target canvas between
                                  renders). Small targeted change — IF the
                                  existing API doesn't already support it,
                                  add a setCanvas(ctx) method.
src/ui-bar.ts                     +'gallery' text link in left zone of the
                                  viewer bar
                                  +mountGalleryBar variant: same layout, with
                                  ‹ page N of M › centered
index.html                        +<div id="pyr3-gallery"> sibling of canvas
                                  (hidden by default; shown when gallery
                                   mounts; canvas hidden then)
src/corpus-bounds.ts              REUSE: resolveCorpusNeighbors already
                                  walks cross-gen; gallery uses it to
                                  enumerate the next 9 (gen, id) tuples
                                  after a given anchor
src/gallery-mount.test.ts         NEW: page math, wave-fill ordering,
                                  cancellation, contextual page computation
src/load-intent.test.ts           +cases for gallery URLs (canonical,
                                   malformed, round-trip)
```

## Data flow per page-load

1. URL `/v1/gallery/p/27` → `parseLoadIntent` returns
   `{kind: 'gallery', page: 27}`.
2. `mountGallery(27)` runs:
   - Hide the viewer `<canvas>`; show the `<div id="pyr3-gallery">` container.
   - Mount the gallery top bar via `ui-bar.ts` (gallery variant with
     ‹ page · next ›).
   - Resolve the 9 `(gen, id)` tuples for page 27 by walking corpus order
     from the appropriate offset (`(page - 1) * 9` items into the corpus).
3. For each of the 9 cells, create a `<canvas>` and append it to the grid
   `<div>` with its `gen/id` label.
4. Wave-fill orchestrator iterates cells in DOM order:
   - Repoint the shared `Renderer` at the cell's canvas.
   - Fetch the genome via `chunk-fetch` (cached per-id by existing layer).
   - Render at Draft tier (`longEdge 512, spp 8`).
   - On completion, move to the next cell.
   - If `‹/›` is pressed mid-flight, signal cancel; current cell aborts;
     fresh wave starts on the new page.
5. Each cell's `<canvas>` is wrapped in an `<a href="/v1/gen/{gen}/id/{id}">`
   for keyboard / right-click / browser-back behavior. Click → standard
   navigation → viewer mounts.

## Render orchestration

- Shared single WebGPU device + single `Renderer` instance for the whole
  page (created at the existing `initDevice` boot in `main.ts`).
- The `Renderer` needs to bind to a different `<canvas>` between cell
  renders. This is the **one targeted renderer change** — depending on
  the current API, either a `setCanvas(ctx: GPUCanvasContext)` method, or
  re-running `configure()` on a new context.
- Per-cell render is a normal Draft render (existing `startChunkedRender`
  or `startDecoupledRender` path; the orchestrator picks; same as viewer
  Draft tier).
- Orchestrator state: `{ activePage, cancelled, currentCellIndex }`.
- `‹/›` handler: set `cancelled = true`, await current cell's abort,
  push new history entry, restart orchestrator on new page.

## Edge cases (one-liners)

- **Cell genome 404** — empty cell with `(missing)` label, continue to
  next cell.
- **Page out of bounds** — clamp to nearest valid page (1 or maxPage),
  `history.replaceState` to corrected URL.
- **Page 1 with corpus order starting mid-gen** — first 9 sheep are the
  first 9 in canonical (gen ascending, id ascending) order. Same walk
  the existing `resolveCorpusNeighbors` produces.
- **WebGPU lost** — same as viewer: `device.ts` `showError`.
- **Click cell mid-render** — cancel that one cell; navigate immediately.
- **Rapid ‹/› spam** — abort current wave, start new one. Coalesce if
  three events arrive in <100ms (debounce).
- **Bookmark of `/v1/gallery/p/27`** — fresh load lands on page 27, no
  context loss.
- **Refresh on `/v1/gallery/p/27`** — same as bookmark.

## Tests

- **`load-intent.test.ts`** — round-trip + malformed cases for
  `/v1/gallery`, `/v1/gallery/p/N`.
- **`gallery-mount.test.ts`** — `pageForSheep`, page-of-9 walk
  enumeration, wave-fill ordering on a mocked renderer, cancellation,
  page-out-of-bounds clamp.
- **Chrome verify (manual)** — visual confirmation:
  - Bare `/v1/gallery` loads page 1 with 9 cells.
  - ‹ / › advances; rapid mash cancels + restarts.
  - Click cell → viewer at expected `gen/id`; back-button returns to
    gallery page.
  - From viewer at `247/19679`, click `gallery` → lands on the page
    containing 247/19679; that cell visible.
  - Wave-fill paints top-left → bottom-right; cells visible as they
    complete.

## Out-of-scope flags (do not implement in this PR)

- Filters / sort / interestingness scoring (see #48, #49)
- Cell hover overlays / preview
- Gallery 🎲 random pill (see #50)
- Keyboard shortcuts for paging (defer to v1.3 polish unless trivial)
- Animation transitions between pages (defer)
- Persisting last-viewed gallery page in localStorage (defer)
- Variable cells-per-page / responsive grid density (defer; 3×3 fixed)

## Dependencies

- None blocking. The renderer canvas-repoint change is the only
  engine-level work; everything else is composition over existing
  primitives (`load-intent`, `corpus-bounds`, `chunk-fetch`, `ui-bar`).

## Verification gate (v1.2 ship contract addition)

A new Chrome verify pass for the gallery surface — separate from the
existing 25-fixture parity gate. Surface gate, not pixel parity.

---

_Spec produced via `superpowers:brainstorming` skill, 2026-05-31. Locked
post-Q4 with user-approved design proposal in the same session. Next:
`writing-plans` to produce the implementation plan._
