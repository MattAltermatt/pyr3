// Gallery surface mount + page-math helpers (#47).
//
// Page-math layer for the /v1/gallery/p/N grid. The canonical corpus order is
// "gens ascending, ids ascending within gen" — the same walk the cross-gen
// neighbor resolver in corpus-bounds.ts uses for prev/next. These helpers
// compose `loadGensManifest` + a per-gen `loadAvail` into bulk slice + lookup
// without reaching into private state.
//
// Both fetchers are injectable so unit tests can pass synthetic corpora —
// matches the testability shape of resolveCorpusNeighbors in corpus-bounds.ts.
//
// Task 4 will extend this module with the DOM grid + wave-fill orchestrator;
// this file stays pure-logic only for now (no DOM, no WebGPU).
//
// Note on cost: pageOfSheep / pageForSheep walk gens sequentially calling
// loadAvail per gen. loadAvail caches per-gen at the avail-client layer, so
// repeated calls within a session are cheap; the first hit of a fresh gen
// fetches an avail manifest (~few KB). For pageForSheep on a sheep late in
// the corpus this can be O(gens) fetches on first paint — acceptable for a
// one-shot contextual-entry click.

import { corpusUrl, GALLERY_PAGE_SIZE } from './load-intent';
import { loadAvail as defaultLoadAvail } from './avail-client';
import { loadGensManifest as defaultLoadManifest, type GensManifest } from './corpus-bounds';
import type { Genome } from './genome';
import { applyPreset, tierToSpec, type QualityTier } from './presets';
import {
  startChunkedRender as defaultStartRender,
  type OrchestratorOpts,
  type RunHandle,
} from './render-orchestrator';
import type { Renderer } from './renderer';

export interface SheepRef {
  gen: number;
  id: number;
}

/**
 * Clamp a requested gallery page into [1, totalPages]. When totalPages is
 * 0 or negative (manifest unavailable / empty corpus) the request passes
 * through with a floor of 1 — main.ts's mount path treats that as "render
 * page 1 with whatever cells resolve" rather than hard-failing.
 */
export function clampGalleryPage(requested: number, totalPages: number): number {
  const max = totalPages > 0 ? totalPages : Number.POSITIVE_INFINITY;
  const floored = Math.max(1, Math.floor(requested));
  return Math.min(max, floored);
}

/**
 * Wrap a function so consecutive calls within `delayMs` coalesce: only the
 * final call inside the window actually fires, with the arguments from that
 * last call. Used to suppress runaway re-renders on rapid ‹/› mashing — the
 * intermediate page numbers are discarded, only the settled target renders.
 *
 * Timing is via `setTimeout`, so this is exercised under happy-dom in tests
 * without faking timers (the test drives it with real awaits).
 */
export function coalesce<T extends (...args: never[]) => unknown>(
  fn: T,
  delayMs: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Parameters<T> | null = null;
  return (...args: Parameters<T>): void => {
    pendingArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const a = pendingArgs;
      pendingArgs = null;
      if (a !== null) fn(...a);
    }, delayMs);
  };
}

/** Coalesce window for rapid ‹/› navigation, ms. Spec: <100ms. */
export const GALLERY_NAV_COALESCE_MS = 100;

/** Per-gen ids fetcher. Signature matches `loadAvail` in avail-client. */
export type LoadAvailFn = (gen: number) => Promise<number[]>;
/** Manifest fetcher. Signature matches `loadGensManifest` in corpus-bounds. */
export type LoadManifestFn = () => Promise<GensManifest | null>;

/**
 * Resolve the SheepRefs for a 1-indexed gallery page under canonical corpus
 * order. Returns up to `perPage` refs; trailing pages can yield fewer when the
 * corpus runs out (callers render empty cells for the gap). Returns [] when
 * the manifest is unavailable or `page < 1`.
 */
export async function pageOfSheep(
  page: number,
  perPage = GALLERY_PAGE_SIZE,
  loadAvail: LoadAvailFn = defaultLoadAvail,
  loadManifest: LoadManifestFn = defaultLoadManifest,
): Promise<SheepRef[]> {
  if (page < 1 || perPage < 1) return [];
  const manifest = await loadManifest();
  if (manifest === null) return [];

  const skip = (page - 1) * perPage;
  const out: SheepRef[] = [];
  let seen = 0;

  for (const entry of manifest.gens) {
    const ids = await loadAvail(entry.gen);
    if (ids.length === 0) continue;

    // Skip whole gens that fall entirely before the page window.
    if (seen + ids.length <= skip) {
      seen += ids.length;
      continue;
    }

    // Start index inside this gen — non-negative because of the guard above.
    const startInGen = Math.max(0, skip - seen);
    for (let i = startInGen; i < ids.length && out.length < perPage; i++) {
      out.push({ gen: entry.gen, id: ids[i] as number });
    }
    seen += ids.length;
    if (out.length >= perPage) break;
  }

  return out;
}

/**
 * Which 1-indexed gallery page contains (gen, id) under canonical corpus
 * order. Powers the viewer's `gallery` link contextual entry. Returns 1 when
 * the sheep is not found in the corpus (degrades to page-1 rather than
 * throwing — the gallery still mounts on a real page).
 */
export async function pageForSheep(
  gen: number,
  id: number,
  perPage = GALLERY_PAGE_SIZE,
  loadAvail: LoadAvailFn = defaultLoadAvail,
  loadManifest: LoadManifestFn = defaultLoadManifest,
): Promise<number> {
  if (perPage < 1) return 1;
  const manifest = await loadManifest();
  if (manifest === null) return 1;

  let seen = 0;
  for (const entry of manifest.gens) {
    if (entry.gen < gen) {
      // Whole gen lies before the target — count via the manifest's own
      // `count` field so a cold lookup is one network fetch (the target's
      // avail) instead of O(gens). The manifest's count is the contract for
      // total ids per gen; avail-list length is allowed to lag in sparse
      // corpora, so trusting count keeps the index aligned with what the
      // gallery's pageOfSheep walk produces.
      seen += entry.count;
      continue;
    }
    if (entry.gen > gen) {
      // Target gen isn't in the manifest at all — degrade to page 1.
      return 1;
    }
    // entry.gen === gen — locate id within this gen's avail list.
    const ids = await loadAvail(entry.gen);
    const idx = ids.indexOf(id);
    if (idx < 0) return 1;
    return Math.floor((seen + idx) / perPage) + 1;
  }
  return 1;
}

// ── Wave-fill orchestrator + DOM grid (Task 4) ──────────────────────────
//
// Mount a 3×3 gallery surface in `container`. The shared Renderer renders
// each cell in turn (wave fill: top-left → bottom-right), repointing its
// presentation target between cells via the per-cell GPUCanvasContext.
// Cells start as empty placeholders; each transitions to a live render as
// the wave reaches it, or to "(missing)" when its genome fetch fails.
//
// Cancellation semantics (load-bearing for rapid ‹/› flipping):
//   - `cancel()` sets a flag + cancels the in-flight per-cell render
//   - `setPage(N)` cancels, awaits the prior wave to settle, then restarts
//   - `destroy()` cancels + empties the container DOM
// Reset between waves: the cancelled flag is cleared inside setPage before
// the new runWave starts, so a fresh wave doesn't see the stale cancel.
//
// All side-effecting dependencies (renderer, startRender, fetchGenome,
// loadAvail, loadManifest) are injectable — the orchestrator tests pass
// stubs and never touch real WebGPU.

const CELL_STYLE_ID = 'pyr3-gallery-styles';
// max-width math: each row is cell_h + label (~18px) + row-gap (12px). Three
// rows + outer padding (16px×2) fit in viewport_h when
// grid_w + 122 ≤ viewport_h (cells are square: cell_h = (grid_w - 24)/3).
// Constrain by min(content cap, height-derived width) so the whole 3×3 fits
// without scrolling at any viewport size — the surface design (#47).
const CELL_STYLE = `
.pyr3-gallery-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; padding:16px; max-width:min(1200px, calc(100vh - 122px)); width:100%; box-sizing:border-box; margin:0 auto; }
.pyr3-gallery-cell { display:flex; flex-direction:column; gap:4px; text-decoration:none; color:inherit; position:relative; }
.pyr3-gallery-cell canvas { width:100%; aspect-ratio:1; background:#000; border-radius:2px; display:block; }
.pyr3-gallery-cell.empty canvas, .pyr3-gallery-cell.missing canvas { background:#15151a; border:1px solid #2a2a30; }
.pyr3-gallery-cell-label { font-family:ui-monospace, monospace; font-size:11px; color:#888; text-align:center; }
.pyr3-gallery-cell.missing .pyr3-gallery-cell-label { color:#555; font-style:italic; }
.pyr3-gallery-cell:hover canvas { outline:1px solid #ff8c1a; outline-offset:2px; }
.pyr3-gallery-cell-loading {
  position:absolute; left:0; right:0; top:0; aspect-ratio:1;
  display:none; align-items:center; justify-content:center;
  background:#0a0a0c; border-radius:2px;
  font-family:ui-monospace, monospace; font-size:11px; color:#666;
  pointer-events:none;
  animation: pyr3-gallery-loading-pulse 1.4s ease-in-out infinite;
}
.pyr3-gallery-cell.loading .pyr3-gallery-cell-loading { display:flex; }
@keyframes pyr3-gallery-loading-pulse {
  0%, 100% { opacity: 0.85; }
  50%      { opacity: 0.55; }
}
`;

function ensureGalleryStyles(): void {
  if (document.getElementById(CELL_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = CELL_STYLE_ID;
  style.textContent = CELL_STYLE;
  document.head.appendChild(style);
}

interface CellHandle {
  root: HTMLAnchorElement;
  canvas: HTMLCanvasElement;
  ctx: GPUCanvasContext | null;
  label: HTMLSpanElement;
  /** Show the "loading…" overlay + clear any stale href. Called when a wave
   *  starts (so the prior page's rendered content is visually replaced
   *  instantly instead of waiting for the new render to paint over it),
   *  and re-applied alongside `setRef` while the new render is in flight. */
  setLoading(): void;
  setRef(gen: number, id: number): void;
  /** Remove the loading overlay — called after a successful render lands. */
  clearLoading(): void;
  setEmpty(): void;
  setMissing(gen: number, id: number): void;
}

function buildCell(cellDim: number): CellHandle {
  const root = document.createElement('a');
  root.className = 'pyr3-gallery-cell empty';
  root.target = '_blank';
  root.rel = 'noopener noreferrer';

  const canvas = document.createElement('canvas');
  canvas.width = cellDim;
  canvas.height = cellDim;
  root.appendChild(canvas);

  // Loading overlay — absolutely positioned over the canvas, displayed only
  // when the cell has the `.loading` class. Its purpose is two-fold:
  //   1. obvious "still working" cue per cell while the wave-fill renders
  //   2. instant visual clear on page-switch — the old render is replaced
  //      by the overlay the moment a new wave starts, instead of lingering
  //      until the new render paints over it
  const loading = document.createElement('span');
  loading.className = 'pyr3-gallery-cell-loading';
  loading.textContent = 'loading…';
  root.appendChild(loading);

  const label = document.createElement('span');
  label.className = 'pyr3-gallery-cell-label';
  root.appendChild(label);

  // getContext returns null in non-WebGPU environments (e.g. jsdom test
  // runs). Production mount is gated by checkWebGPU upstream, so a null
  // here in prod is an outright bug — handled at the configure site.
  const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null;

  return {
    root,
    canvas,
    ctx,
    label,
    setLoading() {
      root.removeAttribute('href');
      root.classList.add('loading');
      root.classList.remove('empty', 'missing');
      // Keep any existing label — once setRef lands the gen/id text is
      // already in place, just hidden behind the overlay. If setLoading is
      // called before refs resolve (page-switch transient), label stays
      // whatever the prior page had; the overlay covers it visually.
    },
    setRef(gen, id) {
      root.href = corpusUrl(gen, id);
      label.textContent = `${gen}/${String(id).padStart(5, '0')}`;
      root.classList.remove('empty', 'missing');
      // The wave-fill calls setLoading() before setRef, so .loading stays;
      // it's cleared by clearLoading() after the render lands.
    },
    clearLoading() {
      root.classList.remove('loading');
    },
    setEmpty() {
      root.removeAttribute('href');
      label.textContent = '';
      root.classList.add('empty');
      root.classList.remove('missing', 'loading');
    },
    setMissing(gen, id) {
      root.removeAttribute('href');
      label.textContent = `${gen}/${String(id).padStart(5, '0')} (missing)`;
      root.classList.add('missing');
      root.classList.remove('empty', 'loading');
    },
  };
}

export interface GalleryMountDeps {
  renderer: Renderer;
  device: GPUDevice;
  format: GPUTextureFormat;
  container: HTMLElement;
  fetchGenome: (gen: number, id: number) => Promise<Genome | null>;
  draftTier: QualityTier;
  /** Injectable for tests; defaults to render-orchestrator's chunked render. */
  startRender?: (opts: OrchestratorOpts) => RunHandle;
  /** Injectable for tests + offline; defaults to avail-client.loadAvail. */
  loadAvail?: LoadAvailFn;
  /** Injectable for tests + offline; defaults to corpus-bounds.loadGensManifest. */
  loadManifest?: LoadManifestFn;
}

export interface GalleryMountHandle {
  setPage(page: number): Promise<void>;
  cancel(): void;
  destroy(): void;
}

/**
 * Mount a 3×3 gallery surface in `deps.container`, render the cells for
 * `initialPage` via wave-fill, and return a handle for page changes /
 * cancellation / teardown. Returns once the DOM is built; the per-cell
 * renders run asynchronously in the background.
 */
export async function mountGallery(
  initialPage: number,
  deps: GalleryMountDeps,
): Promise<GalleryMountHandle> {
  ensureGalleryStyles();

  const cellDim = deps.draftTier.longEdge;
  const startRender = deps.startRender ?? defaultStartRender;

  deps.container.replaceChildren();
  const grid = document.createElement('div');
  grid.className = 'pyr3-gallery-grid';
  deps.container.appendChild(grid);

  const cells: CellHandle[] = [];
  for (let i = 0; i < GALLERY_PAGE_SIZE; i++) {
    const cell = buildCell(cellDim);
    grid.appendChild(cell.root);
    if (cell.ctx !== null) {
      cell.ctx.configure({ device: deps.device, format: deps.format });
    }
    cells.push(cell);
  }

  // Match the renderer's dims to the cell dim once. v1 ships a uniform
  // grid so cells are all the same size; no per-cell resize is needed.
  if (
    deps.renderer.width !== cellDim
    || deps.renderer.height !== cellDim
    || deps.renderer.oversample !== 1
  ) {
    deps.renderer.resize({ width: cellDim, height: cellDim, oversample: 1 });
  }

  const state = {
    cancelled: false,
    currentRun: null as RunHandle | null,
  };

  async function runWave(page: number): Promise<void> {
    // Page-switch clear: flip every cell to the loading overlay BEFORE we
    // await pageOfSheep. The visitor sees the old page replaced instantly
    // (no waiting for the new wave's first render to paint over). This
    // covers the "old cells linger ~2-3s into the new wave" gap (#54).
    for (const cell of cells) cell.setLoading();

    const refs = await pageOfSheep(
      page,
      GALLERY_PAGE_SIZE,
      deps.loadAvail,
      deps.loadManifest,
    );
    if (state.cancelled) return;

    // Attach refs / clear unused cells up-front so labels + links appear
    // immediately. Cells with a ref stay in `.loading` (overlay covering
    // the prior canvas content) until their render lands; cells beyond
    // refs.length go to `.empty`.
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!;
      const ref = refs[i];
      if (ref) cell.setRef(ref.gen, ref.id);
      else cell.setEmpty();
    }

    // Wave fill: one cell at a time, top-left → bottom-right.
    for (let i = 0; i < refs.length; i++) {
      if (state.cancelled) return;
      const cell = cells[i]!;
      const ref = refs[i]!;

      let genome: Genome | null = null;
      try {
        genome = await deps.fetchGenome(ref.gen, ref.id);
      } catch {
        genome = null;
      }
      if (state.cancelled) return;

      if (genome === null) {
        cell.setMissing(ref.gen, ref.id);
        continue;
      }

      const renderGenome = applyPreset(genome, tierToSpec(deps.draftTier));
      const targetSamples = deps.draftTier.spp * cellDim * cellDim;
      // Deterministic per-sheep seed — different cells get different chaos
      // streams even when their (gen, id) tuples are close together.
      const seedBase = ((ref.gen * 100003 + ref.id) >>> 0);

      const handle = startRender({
        renderer: deps.renderer,
        genome: renderGenome,
        outputViewProvider: () =>
          (cell.ctx as GPUCanvasContext).getCurrentTexture().createView(),
        targetSamples,
        seedBase,
        onProgress: () => {},
      });
      state.currentRun = handle;
      const result = await handle.promise;
      state.currentRun = null;
      if (result === 'cancelled') return;
      // Render landed — reveal the canvas by dropping the loading overlay.
      cell.clearLoading();
    }
  }

  let pendingWave: Promise<void> = runWave(initialPage);

  return {
    async setPage(newPage) {
      state.cancelled = true;
      state.currentRun?.cancel();
      try {
        await pendingWave;
      } catch {
        // runWave isolates per-cell errors; an outer reject would indicate
        // a programming bug — swallow so setPage stays restartable.
      }
      state.cancelled = false;
      state.currentRun = null;
      pendingWave = runWave(newPage);
    },
    cancel() {
      state.cancelled = true;
      state.currentRun?.cancel();
    },
    destroy() {
      state.cancelled = true;
      state.currentRun?.cancel();
      deps.container.replaceChildren();
    },
  };
}
