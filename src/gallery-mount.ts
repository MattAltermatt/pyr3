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
import { type FilterSpec, filterSpecEquals } from './gallery-filter';
import { PRESET_WEIGHTS, DEFAULT_SCORE_WEIGHTS, type ScoreWeights } from './feature-score';
import type { FeatureIndex } from './feature-index-client';
import type { FeatureRecord } from './feature-index';
import { COLORS } from './ui-tokens';

export interface SheepRef {
  gen: number;
  id: number;
}

/**
 * Sentinel upper bound when the manifest is unavailable. Without it,
 * mashing `›` from a manifest-failure state would push unbounded history
 * entries (each rendering 9 empty cells). 99999 is large enough that a
 * legitimate `?p=N` URL never trips it, small enough that the bounded
 * history is reachable.
 */
export const MAX_SAFE_PAGE = 99999;

/**
 * Clamp a requested gallery page into [1, totalPages]. When totalPages is
 * 0 or negative (manifest unavailable / empty corpus) the request passes
 * through with a floor of 1 and a ceiling of MAX_SAFE_PAGE — main.ts's
 * mount path treats that as "render page 1 with whatever cells resolve"
 * rather than hard-failing, but the sentinel prevents unbounded `›` mashing.
 */
export function clampGalleryPage(requested: number, totalPages: number): number {
  const max = totalPages > 0 ? totalPages : MAX_SAFE_PAGE;
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
 * Pick a uniformly-random sheep from the full corpus. Walks the manifest
 * to compute totals + locates the chosen index. Returns null when the
 * manifest is unavailable. Used by the gallery's 🎲 pill (#50).
 *
 * Probability is exactly uniform over all genome ids present in the
 * manifest — equal weight to every sheep regardless of which gen holds it.
 * `randFn` defaults to `Math.random` but is injectable for deterministic tests.
 */
export async function randomSheep(
  randFn: () => number = Math.random,
  loadAvail: LoadAvailFn = defaultLoadAvail,
  loadManifest: LoadManifestFn = defaultLoadManifest,
): Promise<SheepRef | null> {
  const manifest = await loadManifest();
  if (manifest === null) return null;
  let total = 0;
  for (const entry of manifest.gens) total += entry.count;
  if (total === 0) return null;
  const target = Math.floor(randFn() * total);
  let seen = 0;
  for (const entry of manifest.gens) {
    if (target < seen + entry.count) {
      // Target lives in this gen; resolve to the id by walking the gen's
      // avail list (sorted ascending). loadAvail caches per-gen so a
      // burst of dice rolls within a session reuses the same array.
      const ids = await loadAvail(entry.gen);
      if (ids.length === 0) return null;
      const idx = target - seen;
      if (idx < 0 || idx >= ids.length) return null;
      return { gen: entry.gen, id: ids[idx] as number };
    }
    seen += entry.count;
  }
  return null;
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

  // Walk identically to pageOfSheep: iterate manifest.gens IN ORDER (which
  // is descending — newest gens first); accumulate `loadAvail(gen).length`
  // per non-target gen; locate target id within target gen's avail. The
  // previous logic used `entry.gen < gen` to mean "already-counted gens",
  // which is correct ONLY for ascending manifests — wrong for the project's
  // newest-first manifest (Bug 2026-06-04: hero 247/19679 was landing on
  // p/4278 of 198/0734x flames because gens 246, 245, ... were wrongly
  // counted as "before" the target gen 247).
  let seen = 0;
  for (const entry of manifest.gens) {
    const ids = await loadAvail(entry.gen);
    if (entry.gen === gen) {
      const idx = ids.indexOf(id);
      if (idx < 0) return 1;
      return Math.floor((seen + idx) / perPage) + 1;
    }
    seen += ids.length;
  }
  return 1;
}

// ── Filtered master-list + page helpers (#49) ──────────────────────────
//
// When a FilterSpec is active, the gallery walks a feature-index-backed
// master list instead of the canonical manifest walk above. Filtering +
// sorting happens once per spec; consecutive page navigations within the
// same spec are a single Array.slice on the cached master list.

export interface FilteredPageDeps {
  index: FeatureIndex;
}

interface MasterListCache {
  spec: FilterSpec;
  refs: SheepRef[];
}

let masterCache: MasterListCache | null = null;

/** Test-only: clear the master-list cache so consecutive tests don't see each
 *  other's filtered lists. Production code never calls. */
export function _resetMasterListCache(): void {
  masterCache = null;
}

function buildMasterList(index: FeatureIndex, spec: FilterSpec): SheepRef[] {
  // First pass: filter — variation AND semantics, xform range bounds.
  const passing: FeatureRecord[] = [];
  index.forEachRecord((rec) => {
    // xforms is a discrete count → inclusive [min, max]. The continuous stat
    // axes use half-open [min, max) so the filter matches the floor-based
    // histogram buckets + brush upper edge (see gallery-facets.ts passesFilters). (#257)
    if (rec.xforms < spec.xformMin) return;
    if (spec.xformMax !== null && rec.xforms > spec.xformMax) return;
    if (rec.coverage < spec.coverageMin) return;
    if (spec.coverageMax !== null && rec.coverage >= spec.coverageMax) return;
    if (rec.entropy < spec.entropyMin) return;
    if (spec.entropyMax !== null && rec.entropy >= spec.entropyMax) return;
    if (rec.colorVar < spec.colorVarMin) return;
    if (spec.colorVarMax !== null && rec.colorVar >= spec.colorVarMax) return;
    if (rec.meanLum < spec.meanLumMin) return;
    if (spec.meanLumMax !== null && rec.meanLum >= spec.meanLumMax) return;
    for (const v of spec.vars) {
      if (!rec.variations.includes(v)) return;
    }
    passing.push(rec);
  });
  // Second pass: sort. `time` lives on the index's natural (gen↑, id↑)
  // order — desc reverses to (gen↓, id↓). The named-stat presets sort by
  // their respective FeatureRecord field; `interest` by interestScore.
  // Direction `desc` = highest-score first; `asc` = lowest-score first.
  // Ties break ascending by (gen, id) regardless of direction for a
  // stable, predictable secondary order.
  const dirSign = spec.sortDir === 'asc' ? -1 : 1;
  if (spec.sort === 'time') {
    if (spec.sortDir === 'desc') {
      // desc-time = reverse-chronological (newest first); the natural index
      // walk yielded asc-time, so reverse in place.
      passing.reverse();
    }
  } else {
    // Resolve the effective ScoreWeights for this sort:
    //   - 'interest' → DEFAULT_SCORE_WEIGHTS (the tunable balanced tuple)
    //   - 'coverage'/'entropy'/'colorVar'/'meanLum' → their one-hot preset
    //     (interestScore degenerates to the named stat — `meanLum`'s preset
    //     is {0,0,0,1}, giving score = -(1-meanLum) = meanLum - 1, sort-equiv
    //     to sorting by meanLum directly since constants don't shift order)
    //   - 'custom' → spec.weights or DEFAULT_SCORE_WEIGHTS when null
    let effectiveWeights: ScoreWeights;
    if (spec.sort === 'custom') {
      effectiveWeights = spec.weights ?? DEFAULT_SCORE_WEIGHTS;
    } else if (spec.sort === 'interest') {
      effectiveWeights = DEFAULT_SCORE_WEIGHTS;
    } else {
      // One of the named-stat presets — coverage/entropy/colorVar/meanLum
      effectiveWeights = PRESET_WEIGHTS[spec.sort];
    }
    // Use the raw weighted sum (NOT interestScore's clamped [0,1] result)
    // so sort order is preserved for one-hot presets. e.g. meanLum's preset
    // {0,0,0,1} gives raw = meanLum - 1 (negative for all meanLum<1); the
    // clamp in interestScore would collapse every record to 0 + destroy the
    // ordering. Constants don't affect sort, so the raw sum sorts identically
    // to interestScore for non-pathological cases.
    const w = effectiveWeights;
    const scoreOf = (r: FeatureRecord): number => {
      const raw =
        w.coverage * r.coverage
        + w.entropy * r.entropy
        + w.colorVar * r.colorVar
        - w.dimPenalty * (1 - r.meanLum);
      return Number.isFinite(raw) ? raw : 0;
    };
    passing.sort((a, b) => {
      const dA = scoreOf(a);
      const dB = scoreOf(b);
      if (dB !== dA) return (dB - dA) * dirSign;
      if (a.gen !== b.gen) return a.gen - b.gen;
      return a.id - b.id;
    });
  }
  const out: SheepRef[] = [];
  for (const r of passing) out.push({ gen: r.gen, id: r.id });
  return out;
}

function getMasterList(index: FeatureIndex, spec: FilterSpec): SheepRef[] {
  if (masterCache && filterSpecEquals(masterCache.spec, spec)) {
    return masterCache.refs;
  }
  const refs = buildMasterList(index, spec);
  masterCache = { spec, refs };
  return refs;
}

/** Return the refs for `page` (1-indexed) under the given filter, sliced
 *  from a per-process cached master list. The master list is rebuilt only
 *  when `spec` changes; page nav within the same spec is a single slice. */
export async function pageOfSheepFiltered(
  page: number,
  perPage: number,
  spec: FilterSpec,
  deps: FilteredPageDeps,
): Promise<SheepRef[]> {
  if (page < 1 || perPage < 1) return [];
  const master = getMasterList(deps.index, spec);
  const start = (page - 1) * perPage;
  return master.slice(start, start + perPage);
}

/** Find the page (1-indexed) that contains the given {gen, id} flame under
 *  the active filter+sort. Walks the cached master list (same as
 *  pageOfSheepFiltered slices) so the returned page matches what the
 *  gallery actually displays. Returns 1 when the flame isn't in the
 *  filtered set (degrade gracefully).
 *
 *  Bug fix 2026-06-04: the unfiltered pageForSheep walked manifest.gens
 *  in native order, but the live gallery uses pageOfSheepFiltered with
 *  default sort `time desc` — different walks, different pages. */
export function pageForSheepFiltered(
  gen: number,
  id: number,
  perPage: number,
  spec: FilterSpec,
  deps: FilteredPageDeps,
): number {
  if (perPage < 1) return 1;
  const master = getMasterList(deps.index, spec);
  const idx = master.findIndex(r => r.gen === gen && r.id === id);
  if (idx < 0) return 1;
  return Math.floor(idx / perPage) + 1;
}

/** Total pages for the given filter spec. 0 when the filter matches no
 *  records (drives the empty-state UX). */
export function totalPagesFiltered(
  spec: FilterSpec,
  perPage: number,
  deps: FilteredPageDeps,
): number {
  if (perPage < 1) return 0;
  const master = getMasterList(deps.index, spec);
  return Math.ceil(master.length / perPage);
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
// #103 Phase 4 Task 4.2 — 3×3 square tiles + `<gen>/<id>` link below.
// Each tile is a `.pyr3-tile-wrap` (also carrying the legacy
// `.pyr3-gallery-cell` class so the orchestrator's empty / loading /
// missing state classes apply without rewriting the wave-fill code).
// `aspect-ratio: 1` lives on the wrap so the WHOLE tile is square (image +
// label below combined would otherwise drift off-square as the label adds
// vertical height); the canvas inherits the wrap's square shape via
// width:100% + height-driven layout. ID label sits beneath, monospace,
// in `COLORS.text.dim`; hover transitions to `COLORS.flame.top`.
const CELL_STYLE = `
.pyr3-gallery-grid {
  display:grid;
  grid-template-columns:repeat(3, 1fr);
  gap:26px;
  padding:28px;
  /* Width derived from viewport height so the 3×3 grid (tiles + labels +
     gaps + padding) always fits within the gallery zone, no scroll. The
     grid zone has height = viewport - topbar(44) - inforow(48) = vh-92.
     For 3 rows of squareTile + 10px label-gap + 14px label-height + 26px
     row-gap + 28px padding, the per-row contribution is
     squareTile + (10+14+26 or 28-bottom-padding). Solving gives a max
     width upper bound of vh-164 — capped at 1200px on wide viewports. */
  max-width:min(1200px, calc(100vh - 164px));
  width:100%;
  box-sizing:border-box;
  margin:0 auto;
}
.pyr3-tile-wrap, .pyr3-gallery-cell {
  display:flex; flex-direction:column; gap:10px;
  text-decoration:none; color:inherit; position:relative;
}
.pyr3-tile-wrap canvas, .pyr3-gallery-cell canvas {
  width:100%; aspect-ratio:1; background:#000; border-radius:2px; display:block;
}
.pyr3-tile-wrap.empty canvas, .pyr3-tile-wrap.missing canvas,
.pyr3-gallery-cell.empty canvas, .pyr3-gallery-cell.missing canvas {
  background:#15151a; border:1px solid #2a2a30;
}
.pyr3-tile-id, .pyr3-gallery-cell-label {
  font-family:ui-monospace, monospace; font-size:12px;
  color:${COLORS.text.dim}; text-align:center;
  transition: color 0.15s ease;
}
.pyr3-tile-wrap:hover .pyr3-tile-id,
.pyr3-gallery-cell:hover .pyr3-gallery-cell-label {
  color:${COLORS.flame.top};
}
.pyr3-tile-wrap.missing .pyr3-tile-id,
.pyr3-gallery-cell.missing .pyr3-gallery-cell-label {
  color:#555; font-style:italic;
}
.pyr3-tile-wrap:hover canvas, .pyr3-gallery-cell:hover canvas {
  outline:1px solid ${COLORS.flame.top}; outline-offset:2px;
}
.pyr3-gallery-cell-loading {
  position:absolute; left:0; right:0; top:0; aspect-ratio:1;
  display:none; align-items:center; justify-content:center;
  background:${COLORS.bg.page}; border-radius:2px;
  font-family:ui-monospace, monospace; font-size:11px; color:#666;
  pointer-events:none;
  animation: pyr3-gallery-loading-pulse 1.4s ease-in-out infinite;
}
.pyr3-tile-wrap.loading .pyr3-gallery-cell-loading,
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
  // #103 Phase 4 Task 4.2 — carry both the new `.pyr3-tile-wrap` class and
  // the legacy `.pyr3-gallery-cell` class so the orchestrator's state
  // classes (`.empty`, `.loading`, `.missing`) continue to apply without
  // rewriting the wave-fill code. New consumers should target
  // `.pyr3-tile-wrap` + `.pyr3-tile-id`; legacy callers stay green.
  root.className = 'pyr3-tile-wrap pyr3-gallery-cell empty';
  root.target = '_blank';
  root.rel = 'noopener noreferrer';
  // The wrap auto-sizes to canvas + gap + label (no aspect-ratio: 1 on the
  // wrap itself — that would clip the label outside the wrap's square box
  // and push it past the grid bounds). The CANVAS owns the square shape
  // via `aspect-ratio: 1` in CELL_STYLE; the wrap is a flex column that
  // naturally grows to `canvasHeight + gap + labelHeight`. The grid's
  // `max-width: calc(100vh - 164px)` keeps the whole 3×3 inside the
  // viewport for the no-scroll layout.

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
  // Carry both classes for the same dual-contract reason as the wrap above.
  label.className = 'pyr3-tile-id pyr3-gallery-cell-label';
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
  /** Feature index for the filtered ref-resolution path (#49). When BOTH this
   *  and `initialFilter` are present, runWave resolves refs via
   *  pageOfSheepFiltered. When either is absent, runWave falls back to the
   *  unfiltered pageOfSheep walk (test/offline/default-filter path). */
  index?: FeatureIndex;
  /** Initial FilterSpec for filtered ref-resolution (#49). See `index` above. */
  initialFilter?: FilterSpec;
}

export interface GalleryMountHandle {
  /** Switch to `page`. When `nextFilter` is provided and differs from the
   *  mount's current filter, the mount adopts the new filter BEFORE running
   *  the wave — the per-process master-list cache in pageOfSheepFiltered
   *  rebuilds automatically on the spec change. */
  setPage(page: number, nextFilter?: FilterSpec): Promise<void>;
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
  // #103 Phase 4 Task 4.2 — inline-style the 3-col grid + 26px gap + 28px
  // padding contract so the layout-snapshot test asserts without depending
  // on the stylesheet attaching first. The CSS rule above mirrors these
  // for any subclassed consumer.
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
  grid.style.gap = '26px';
  grid.style.padding = '28px';
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

  // Filtered-path closure state (#49). When both `index` and a filter are
  // available, runWave uses pageOfSheepFiltered; otherwise it falls back to
  // the canonical unfiltered pageOfSheep walk. setPage(page, nextFilter) can
  // swap currentFilter mid-flight; the master-list cache in
  // pageOfSheepFiltered keys on the spec and auto-rebuilds when it changes.
  let currentFilter: FilterSpec | undefined = deps.initialFilter;

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

    const refs = (deps.index !== undefined && currentFilter !== undefined)
      ? await pageOfSheepFiltered(
          page,
          GALLERY_PAGE_SIZE,
          currentFilter,
          { index: deps.index },
        )
      : await pageOfSheep(
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
    async setPage(newPage, nextFilter) {
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
      // Adopt the new filter BEFORE kicking the wave. The master-list cache
      // in pageOfSheepFiltered rebuilds automatically when the spec changes.
      if (nextFilter !== undefined) {
        if (currentFilter === undefined || !filterSpecEquals(currentFilter, nextFilter)) {
          currentFilter = nextFilter;
        }
      }
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
