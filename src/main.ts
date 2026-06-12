// pyr3 — viewer entry point.
//
// Boot WebGPU, mount the top bar, paint the default genome, then
// accept .flame files via the bar's Open button. Per the v1 design
// spec (docs/superpowers/specs/2026-05-26-pyr3-direction-design.md):
// no drag-drop, no `L` hotkey, no overlays on the rendered flame.

import { loadAvail, neighbors } from './avail-client';
import { loadGensManifest, resolveCorpusNeighbors } from './corpus-bounds';
import { fetchFlameXml, FlameNotFound } from './chunk-fetch';
import { acquireGpu, initDevice, showError } from './device';
import { parseFlame } from './flame-import';
import {
  clampGalleryPage,
  coalesce,
  GALLERY_NAV_COALESCE_MS,
  mountGallery,
  pageForSheep,
  pageForSheepFiltered,
  totalPagesFiltered,
  type GalleryMountHandle,
} from './gallery-mount';
import {
  DEFAULT_FILTER_SPEC,
  filterSpecEquals,
  type FilterSpec,
} from './gallery-filter';
import { computeFacetCounts } from './gallery-facets';
import {
  activeFilterCount,
  mountFilterDrawer,
  type FilterDrawerHandle,
} from './gallery-filter-ui';
import { loadFeatureIndex } from './feature-index-client';
import { distinctVariationNames, SPIRAL_GALAXY, type Genome } from './genome';
import { genomeToJson } from './serialize';
import { injectPngTextChunk } from './png-text-chunk';
import {
  corpusUrl,
  editorUrlForFlame,
  galleryUrl,
  galleryUrlForFlame,
  GALLERY_PAGE_SIZE,
  HERO_GEN,
  HERO_ID,
  parseLoadIntent,
  viewerUrl,
  type LoadIntent,
} from './load-intent';
import { loadLastFlame, saveLastFlame } from './last-flame-store';
import { getCurrentFlame, setCurrentFlame } from './app-state';
import { writePendingTransfer } from './edit-state';
import { load as loadFileFromUser, type LoadResult } from './loader';
import { createLoadSequencer } from './load-sequencer';
import { applyPreset, DEFAULT_TIER, QUALITY_TIERS, tierToSpec, type PresetSpec, type QualityRequest } from './presets';
import { pickSurpriseFlame } from './viewer-dice';
import { startChunkedRender, startDecoupledRender, type RunHandle } from './render-orchestrator';
import { saveRenderToPng } from './render-save';
import { createRenderer, DEFAULT_FILTER_RADIUS, type Renderer } from './renderer';
import { createEditRenderer } from './edit-render';
import {
  PREVIEW_TIER_LONGEST_EDGE,
  loadPreviewConfig,
  savePreviewConfig,
  type PreviewRenderConfig,
} from './render-mode-config';
import { mountRenderModeBar, type RenderModeBarHandle } from './render-mode-bar';
import { openRenderProgressModal } from './render-progress-modal';
import { parsePreviewOverride } from './load-intent';
import { DEFAULT_WALKER_JITTER, resolveWalkerJitter } from './walker-jitter';
import {
  mountAboutBar,
  mountBar,
  mountGalleryBar,
  type BarHandle,
  type CorpusNav,
  type CostEstimate,
  type GalleryBarHandle,
  type TabSurface,
} from './ui-bar';
import { mountAbout } from './about-mount';
import { checkWebGPU } from './webgpu-check';
import { fetchCapability } from './capability';

// The "welcome flame" — the bundled fixture `/` paints for an instant,
// chunk-free first paint. It's the hero sheep (gen HERO_GEN / id HERO_ID); the
// filename is derived from those constants so the bundled copy can never drift
// from the corpus URL the bare root forwards to. The specific flame was
// hand-picked from the Electric Sheep Fold (ESF) corpus.
const WELCOME_FLAME_URL = `${import.meta.env.BASE_URL}fixtures/electricsheep.${HERO_GEN}.${HERO_ID}.flam3`;

const RENDER_SIZE = 1024;

// Quick-preview render caps. Many .flam3 files (especially Electric
// Sheep / JWildfire pieces) ship with offline-rendering presets:
// `size="4096 4096"`, `quality="1000"`, `oversample="4"` are common.
// Those settings combine to ~256× more GPU work than the quick view
// needs — heavy enough to lock the browser. Quick caps:
//   · max(width, height) ≤ QUICK_MAX_DIM, aspect preserved
//   · quality clamped to QUICK_MAX_SPP
//   · oversample forced to QUICK_OVERSAMPLE
// The 4K render path is BE-only (see bin/pyr3-render.ts --preset 4k;
// the pre-v0.20 wrapper script scripts/pyr3-023-be-render-4k.mjs was
// graduated into src/presets.ts) — FE viewer is interactive at
// quick quality only. PYR3-023 probe found that FE 4K crashes Chrome
// for ~40% of showcase fixtures + runs 13× slower than BE when it
// doesn't crash; the showcase ships as static pre-rendered 4K JPGs
// per the predecessor renderer's pattern.
const QUICK_MAX_DIM = 1024;
const QUICK_MAX_SPP = 16;
const QUICK_OVERSAMPLE = 1;

// #2: name the browser tab after the current flame so a bookmark / shared link
// auto-titles itself. Corpus sheep → `pyr3 — 248/23674`; file-opened flames →
// `pyr3 — <flame name>`; bare default → `pyr3`. Updated on every load + popstate.
function setDocTitle(label: string | null): void {
  document.title = label ? `pyr3 — ${label}` : 'pyr3';
}

// Compact `gen/id` label for the document title (id zero-padded to 5, matching
// the corpus URL + nav-pill formatting).
function corpusTitleLabel(gen: number, id: number): string {
  return `${gen}/${String(id).padStart(5, '0')}`;
}

async function main(): Promise<void> {
  // #201 P0 Task 3 — fire-and-forget capability probe. Null fetch (the
  // gh-pages case) memoizes the safe browser-only default; a `pyr3 serve`
  // host answers with `backend: 'dawn-node'` + `max_quality: null`. The
  // boot wait is non-blocking — we kick off the fetch in parallel with
  // checkWebGPU so first paint isn't delayed.
  const capabilityProbe = fetchCapability();

  const webgpu = await checkWebGPU();
  await capabilityProbe;

  // #65 Tier 1 — walker-jitter knob, gated to DEV.
  //
  // Production builds always use DEFAULT_WALKER_JITTER — no magic URL knob
  // floating in the user-facing surface area. `npm run dev` exposes both
  // the `?jitter=<amp>` URL parser (handy for shareable repro links during
  // investigations) AND the `__pyr3SetJitter(amp)` console hook (hot-swap
  // without page reload). The BE CLI `--jitter` flag is independent of this
  // gate (always available; not user-facing).
  //
  // `let` so the dev hook can mutate it for ad-hoc sweeps.
  let currentWalkerJitter = import.meta.env.DEV
    ? resolveWalkerJitter(window.location.search)
    : DEFAULT_WALKER_JITTER;
  if (import.meta.env.DEV) {
    (window as unknown as {
      __pyr3SetJitter?: (amp: number) => number;
    }).__pyr3SetJitter = (amp: number): number => {
      if (!Number.isFinite(amp) || amp < 0) {
        console.warn(`__pyr3SetJitter: ignoring invalid amplitude ${amp}`);
        return currentWalkerJitter;
      }
      currentWalkerJitter = amp;
      console.log(`pyr3: walker jitter → ${amp}`);
      return amp;
    };
  }

  // First-paint cue ("dreaming…" in index.html) — cleared once the first
  // flame paints, so the visitor sees the engine is alive on a cold load.
  let firstPaintDone = false;
  const clearFirstPaintCue = (): void => {
    if (firstPaintDone) return;
    firstPaintDone = true;
    const cue = document.getElementById('pyr3-firstpaint');
    if (cue) {
      cue.classList.add('hidden');
      setTimeout(() => cue.remove(), 450);
    }
  };

  let openFilePicker: () => void = () => {
    console.warn('pyr3: file picker invoked before canvas init');
  };
  // Forwarding ref: the quality render closure is defined after the bar mounts
  // (it needs the renderer + device), so the ladder calls through this.
  let renderQualityFn: (req: QualityRequest) => void = () => {
    console.warn('pyr3: quality render invoked before canvas init');
  };
  // Forwarding ref: the Advanced row's live cost estimate (needs activeGenome
  // aspect + the device limit, both bound after init).
  let estimateCostFn: (longEdge: number, spp: number) => CostEstimate = () => ({
    width: 0,
    height: 0,
    mb: 0,
    fits: false,
  });
  // Forwarding ref: corpus prev/next nav (PYR3-041) is defined after the load
  // helpers exist; the action-bar pills call through this.
  let navigateCorpus: (gen: number, id: number) => void = () => {
    console.warn('pyr3: corpus navigate invoked before canvas init');
  };
  // Forwarding ref: #22 — the canvas isn't bound until initDevice resolves, so
  // the Save click routes through this shim until the real downloader replaces it.
  let saveCanvas: (filename: string) => void = () => {
    console.warn('pyr3: save invoked before canvas init');
  };

  // #103 Phase 2 Task 2.3 — tab-navigation contract. Reads the path to
  // classify the current surface, then for viewer-origin clicks transfers
  // the app-state.currentFlame context to the destination surface (gallery
  // pages to the flame's corpus page; editor preloads via ?gen=&id=). All
  // other transitions fall through to the bare surface URL.
  const SURFACE_FALLBACK: Record<TabSurface, string> = {
    viewer:      '/',
    gallery:     '/v1/gallery',
    editor:      '/v1/edit',
    gradient:    '/v1/gradient',
    animate:     '/v1/animate',
    about:       '/about',
    screensaver: '/v1/screensaver',
  };
  function currentTabSurface(): TabSurface {
    const p = window.location.pathname;
    if (p === '/v1/gallery' || p.startsWith('/v1/gallery/')) return 'gallery';
    if (p === '/v1/edit' || p.startsWith('/v1/edit/')) return 'editor';
    if (p === '/v1/gradient' || p.startsWith('/v1/gradient/')) return 'gradient';
    if (p === '/v1/animate' || p.startsWith('/v1/animate/')) return 'animate';
    if (p === '/about' || p.startsWith('/about/')) return 'about';
    if (p === '/v1/screensaver' || p.startsWith('/v1/screensaver/')) return 'screensaver';
    // /v1/gen/<gen>/id/<id> deep-links are still the viewer surface; bare
    // `/` and any unrecognized path also resolve to viewer.
    return 'viewer';
  }
  function handleTabClick(target: TabSurface): void {
    const here = currentTabSurface();
    const cf = getCurrentFlame();

    // Bug B (2026-06-04): when the user came from a gallery page (recorded
    // in sessionStorage on every gallery mount), restore that exact page on
    // viewer→gallery — even if the flame they're currently viewing belongs
    // to a different page. Matches user mental model: "Gallery" = back to
    // where I was browsing.
    if (here === 'viewer' && target === 'gallery') {
      try {
        const last = sessionStorage.getItem('pyr3.gallery.lastUrl');
        if (last && last.startsWith('/v1/gallery')) {
          window.location.href = last;
          return;
        }
      } catch { /* sessionStorage blocked — fall through */ }
    }

    // Viewer-only transfer rule: when leaving the viewer with a known flame,
    // carry it into the destination surface. Resolve corpusId from
    // currentFlame first; fall back to parsing the viewer's URL path (the
    // `/v1/gen/<gen>/id/<id>` route) so the transfer is resilient even when
    // currentFlame hasn't been populated yet by the corpus-load callback
    // (Bug A 2026-06-04: user reports landing on bare /v1/gallery from a
    // freshly-loaded deep-link viewer).
    const corpusFromUrl = (() => {
      const m = window.location.pathname.match(/^\/v1\/gen\/(\d+)\/id\/(\d+)\/?$/);
      if (!m) return null;
      return { gen: Number(m[1]), id: Number(m[2]) };
    })();
    const corpusId = cf?.corpusId ?? corpusFromUrl;

    if (here === 'viewer' && target === 'gallery' && corpusId) {
      const { gen, id } = corpusId;
      // The gallery anchor needs the flame's corpus-list index to land on
      // the page containing it. pageForSheepFiltered does that resolution
      // under the live filter+sort (currentFilter) — the unfiltered
      // pageForSheep walks gens in native order, which mismatches the
      // gallery's default time-desc sort and lands on the wrong page on
      // cold-start (no sessionStorage lastUrl). Bound the lookup with a
      // 2000ms timeout so a slow / hung index fetch falls through to the
      // bare /v1/gallery URL instead of stalling — and guard with a
      // `settled` flag so a late resolve doesn't pull the user back to
      // gallery after they've moved on (e.g. clicked another tab).
      let settled = false;
      const onResolve = (page: number): void => {
        if (settled) return;
        settled = true;
        // pageForSheepFiltered returns a 1-indexed page. galleryUrlForFlame
        // expects the 0-indexed corpus list index. Convert by (page - 1) *
        // GALLERY_PAGE_SIZE — close enough to land on the right page (any
        // in-page offset is a cosmetic concern, not a navigational one).
        const approxIndex = (page - 1) * GALLERY_PAGE_SIZE;
        window.location.href = galleryUrlForFlame({ gen, id }, approxIndex);
      };
      const onFallback = (): void => {
        if (settled) return;
        settled = true;
        window.location.href = SURFACE_FALLBACK.gallery;
      };
      setTimeout(onFallback, 2000);
      void ensureFeatureIndex()
        .then((index) => pageForSheepFiltered(gen, id, GALLERY_PAGE_SIZE, currentFilter, { index }))
        .then(onResolve)
        .catch(onFallback);
      return;
    }
    if (here === 'viewer' && target === 'editor') {
      // When the viewer has a genome loaded (corpus OR file-opened), carry it
      // across the navigation via localStorage. The editor's cold-start path
      // (resolveColdStartGenome → consumePendingTransfer) reads this back
      // ahead of WIP / random-reroll. Without this stash, file-opened genomes
      // would be lost on tab click — only the corpusId is in the URL.
      if (cf?.genome) {
        writePendingTransfer({
          genome: cf.genome,
          corpusId: cf.corpusId ?? corpusFromUrl ?? null,
          timestamp: Date.now(),
        });
      }
      window.location.href = editorUrlForFlame(cf?.corpusId ?? corpusFromUrl ?? undefined);
      return;
    }

    // All other transitions: bare surface URL.
    window.location.href = SURFACE_FALLBACK[target];
  }

  // #103 Phase 2 Task 2.5 — /about short-circuit. Like /v1/edit, this route
  // skips the viewer renderer / corpus / gallery setup entirely; the About
  // page is pure content, no GPU device, no canvas. Mount the about-flavored
  // chrome (no tab active, .pyr3-about-link gets `active`) into #pyr3-bar
  // and the page body into #pyr3-canvas-zone. The version + buildDate come
  // from Vite's `define` block (mirrored in vitest.config.ts) so they can't
  // drift from package.json.
  if (window.location.pathname === '/about') {
    const barRoot = document.getElementById('pyr3-bar');
    const bodyRoot = document.getElementById('pyr3-canvas-zone');
    if (!barRoot || !bodyRoot) {
      console.error('pyr3: /about — required DOM nodes (#pyr3-bar / #pyr3-canvas-zone) missing');
      return;
    }
    const aboutBar = mountAboutBar(barRoot, { webgpu, onTabClick: handleTabClick });
    // Hide the canvas + first-paint cue so the About body owns the visible
    // zone (same pattern as the gallery / edit short-circuits).
    const canvas = document.getElementById('pyr3-canvas');
    if (canvas) canvas.hidden = true;
    const firstPaint = document.getElementById('pyr3-firstpaint');
    if (firstPaint) firstPaint.remove();
    // DRY substrate contract — every per-surface bar exposes a `middleSlot`,
    // and the surface's body content lives in it. Drop a scrollable wrapper
    // in the slot so the About content (which can exceed the viewport) gets
    // a defined scroll container instead of pushing the bar around.
    const aboutContainer = document.createElement('div');
    aboutContainer.id = 'pyr3-about';
    Object.assign(aboutContainer.style, {
      overflowY: 'auto',
      // Fill the remaining viewport under the 44px topbar. The bar's
      // `position: sticky` keeps it visible while the body scrolls.
      height: 'calc(100vh - 44px)',
    });
    aboutBar.middleSlot.appendChild(aboutContainer);
    mountAbout(aboutContainer, {
      version: __PYR3_VERSION__,
      buildDate: __BUILD_DATE__,
      // The WebGPUStatus type doesn't carry adapter-info detail; leave gpuInfo
      // undefined so mountAbout's "WebGPU" fallback shows on the chip.
    });
    setDocTitle('about');
    return;
  }

  // #115 — /v1/gradient short-circuit. Bar chrome with the Gradient tab active;
  // the page body lives in the bar's middleSlot. Viewer canvas + first-paint cue
  // hidden so the page owns the zone. #269 — the page now renders the flame, so
  // a GPU device is acquired (best-effort) and passed in.
  if (window.location.pathname === '/v1/gradient' || window.location.pathname.startsWith('/v1/gradient/')) {
    const barRoot = document.getElementById('pyr3-bar');
    const bodyRoot = document.getElementById('pyr3-canvas-zone');
    if (!barRoot || !bodyRoot) {
      console.error('pyr3: /v1/gradient — required DOM nodes missing');
      return;
    }
    const { mountBarChrome } = await import('./ui-bar');
    const chrome = mountBarChrome(barRoot, { surface: 'gradient', webgpu, onTabClick: handleTabClick });
    const canvas = document.getElementById('pyr3-canvas');
    if (canvas) canvas.hidden = true;
    const firstPaint = document.getElementById('pyr3-firstpaint');
    if (firstPaint) firstPaint.remove();
    const gradContainer = document.createElement('div');
    gradContainer.id = 'pyr3-gradient';
    Object.assign(gradContainer.style, {
      position: 'relative',
      height: 'calc(100vh - 44px)',
      overflow: 'auto',
    });
    chrome.middleSlot.appendChild(gradContainer);
    // #269 — acquire a GPU device so the gradient editor can render the flame.
    // Best-effort: if WebGPU is unavailable the page still works palette-only.
    let gradGpu: { device: GPUDevice; format: GPUTextureFormat } | undefined;
    try {
      const { device, format } = await acquireGpu();
      gradGpu = { device, format };
    } catch (err) {
      console.warn('pyr3: /v1/gradient — GPU unavailable, palette-only mode', err);
    }
    const { mountGradientPage } = await import('./gradient-page');
    const gradientHandle = mountGradientPage({ root: gradContainer, ...(gradGpu ?? {}) });
    window.addEventListener('pagehide', () => { gradientHandle.destroy(); }, { once: true });
    setDocTitle('gradient');
    return;
  }

  // #109 — /v1/screensaver short-circuit. Mirrors the /about pattern:
  // mountScreensaverBar into #pyr3-bar; screensaver page body into the
  // middleSlot. Viewer canvas + first-paint cue hidden so the screensaver
  // owns the visible zone. Device + format are pre-acquired here and passed
  // to the screensaver mount so it can run the build-up / slideshow loops.
  if (window.location.pathname === '/v1/screensaver' || window.location.pathname.startsWith('/v1/screensaver/')) {
    const barRoot = document.getElementById('pyr3-bar');
    const bodyRoot = document.getElementById('pyr3-canvas-zone');
    if (!barRoot || !bodyRoot) {
      console.error('pyr3: /v1/screensaver — required DOM nodes missing');
      return;
    }
    const { device: ssDevice, format: ssFormat } = await acquireGpu();
    const { mountScreensaverBar } = await import('./ui-bar');
    const screensaverBar = mountScreensaverBar(barRoot, { webgpu, onTabClick: handleTabClick });
    const canvas = document.getElementById('pyr3-canvas');
    if (canvas) canvas.hidden = true;
    const firstPaint = document.getElementById('pyr3-firstpaint');
    if (firstPaint) firstPaint.remove();
    const ssContainer = document.createElement('div');
    ssContainer.id = 'pyr3-screensaver';
    Object.assign(ssContainer.style, {
      position: 'relative',
      height: 'calc(100vh - 44px)',
      overflow: 'hidden',
    });
    screensaverBar.middleSlot.appendChild(ssContainer);
    const { mountScreensaverPage } = await import('./screensaver-mount');
    const screensaverHandle = mountScreensaverPage({ root: ssContainer, device: ssDevice, format: ssFormat });
    // #113: tear down the picker's thumbnail renderer + in-flight playback
    // before the page unmounts. pagehide fires reliably on full-page nav
    // (current SPA exit path); also positions us for a future in-place
    // SPA route-leave to call screensaverHandle.destroy() the same way.
    window.addEventListener('pagehide', () => { screensaverHandle.destroy(); }, { once: true });
    setDocTitle('screensaver');
    return;
  }

  // P6 #211 — /v1/animate short-circuit. Same pattern as /v1/screensaver:
  // mountAnimateBar into #pyr3-bar; animate page body (canvas + playback
  // scrubber + drop zone) lives in the bar's middleSlot. Viewer canvas hidden
  // so the animate surface owns the visible zone. Device + format pre-acquired
  // here and passed through.
  if (window.location.pathname === '/v1/animate' || window.location.pathname.startsWith('/v1/animate/')) {
    const barRoot = document.getElementById('pyr3-bar');
    const bodyRoot = document.getElementById('pyr3-canvas-zone');
    if (!barRoot || !bodyRoot) {
      console.error('pyr3: /v1/animate — required DOM nodes missing');
      return;
    }
    const { device: animDevice, format: animFormat } = await acquireGpu();
    const { mountAnimateBar } = await import('./ui-bar');
    const animateBar = mountAnimateBar(barRoot, { webgpu, onTabClick: handleTabClick });
    const canvas = document.getElementById('pyr3-canvas');
    if (canvas) canvas.hidden = true;
    const firstPaint = document.getElementById('pyr3-firstpaint');
    if (firstPaint) firstPaint.remove();
    const animContainer = document.createElement('div');
    animContainer.id = 'pyr3-animate';
    Object.assign(animContainer.style, {
      position: 'relative',
      height: 'calc(100vh - 44px)',
      overflow: 'hidden',
      background: '#000',
    });
    animateBar.middleSlot.appendChild(animContainer);
    const { mountAnimatePage } = await import('./animate-mount');
    const animateHandle = mountAnimatePage({ root: animContainer, device: animDevice, format: animFormat });
    window.addEventListener('pagehide', () => { animateHandle.destroy(); }, { once: true });
    setDocTitle('animation');
    return;
  }

  const bar: BarHandle = mountBar(document.getElementById('pyr3-bar')!, {
    webgpu,
    onOpenFile: () => openFilePicker(),
    onRenderQuality: (req) => renderQualityFn(req),
    onNavigate: (gen, id) => navigateCorpus(gen, id),
    estimateCost: (longEdge, spp) => estimateCostFn(longEdge, spp),
    onSave: (filename) => saveCanvas(filename),
    // #103 Phase 3 Task 3.3: 🧬 Save Flame exports the current genome as
    // `.pyr3.json`. `getCurrentFlame()` carries the genome the viewer is
    // displaying — set during every corpus load / file open / surprise pick.
    onSaveFlame: (filename) => {
      const current = getCurrentFlame();
      if (!current) return;
      void import('./save-flame').then(({ saveFlame }) => {
        saveFlame(current.genome, filename);
      });
    },
    onSurpriseMe: () => {
      // #23: pick a flame from the corpus weighted by interestingness +
      // navigate to it. The first click awaits the feature-index load
      // (cached for the gallery too, so usually already in memory);
      // subsequent clicks are sync-cheap. Reuses the existing /v1/gen/...
      // corpus-load path so the dice click is indistinguishable from a
      // manual share-link visit.
      void pickSurpriseFlame().then((pick) => {
        if (pick === null) return;
        navigateCorpus(pick.gen, pick.id);
      });
    },
    // #103 Phase 2 Task 2.3 — chrome substrate tab clicks wire to
    // handleTabClick (viewer-only currentFlame transfer rule above).
    onTabClick: handleTabClick,
  });

  if (!webgpu.available) {
    const detail = webgpu.detail ? `, ${webgpu.detail}` : '';
    console.warn(`pyr3: WebGPU unavailable (reason=${webgpu.reason}${detail})`);
    mountWebGPUFallback();
    bar.setBusy(true);
    return;
  }

  // /v1/edit short-circuits the viewer setup — the editor owns its own bar,
  // canvas, and renderer. We mount the slim /v1/edit chrome bar (mountEditBar)
  // into #pyr3-bar; the rest of main() (viewer renderer, gallery dispatch,
  // corpus nav) doesn't run.
  const initialIntent = parseLoadIntent(window.location.pathname + window.location.search);
  if (initialIntent?.kind === 'edit' || initialIntent?.kind === 'catalog-entry') {
    const { device: editDevice, format: editFormat } = await acquireGpu();
    const editRoot = document.getElementById('pyr3-edit');
    if (!editRoot) {
      console.error('pyr3: #pyr3-edit missing from index.html — editor cannot mount');
      return;
    }
    editRoot.hidden = false;
    document.body.classList.add('pyr3-edit-mode');

    // Forwarding refs: the bar's onNameChange / onNickChange + action-row
    // callbacks need to call into the editor handle, but the editor doesn't
    // exist yet (we need the bar handle first so we can pass onStateChange
    // to the editor).
    let editorRef: {
      setName(n: string): void;
      setNick(n: string): void;
      reroll(): void;
      openFile(): void;
      saveFlame(): void;
      saveRender(): Promise<void>;
      setSize(w: number, h: number): void;
      setQuality(q: number): void;
      setSettleDelayMs(ms: number): void;
      undo(): void;
      redo(): void;
      computeFilenamePreview(template: string): string | null;
    } | null = null;

    // #192 — read the editor's persisted save defaults so the bar's name/by
    // inputs can be seeded with the user's last-typed values at mount. The
    // editor owns the canonical storage at `pyr3.edit.save-defaults` and
    // migrates the pre-#192 `pyr3.edit.nick` key on first read. Persistence
    // on every input change happens entirely on the editor side; main.ts no
    // longer mirrors to localStorage here.
    const initialSaveDefaults = (() => {
      try {
        const raw = localStorage.getItem('pyr3.edit.save-defaults');
        if (raw) {
          const p = JSON.parse(raw);
          if (p && typeof p === 'object' && p._v === 1) {
            return {
              flameName: typeof p.flameName === 'string' ? p.flameName : '',
              flameNick: typeof p.flameNick === 'string' ? p.flameNick : '',
            };
          }
        }
      } catch { /* fall through */ }
      // Migration: pre-#192 nick lived under `pyr3.edit.nick`.
      let migratedNick = '';
      try { migratedNick = localStorage.getItem('pyr3.edit.nick') ?? ''; }
      catch { migratedNick = ''; }
      return { flameName: '', flameNick: migratedNick };
    })();
    // Defaults reused below for editor cold-start (legacy savedNick API).
    const savedNick = initialSaveDefaults.flameNick;

    const { mountEditBar } = await import('./ui-bar');
    const barRoot = document.getElementById('pyr3-bar')!;
    const editBar = mountEditBar(barRoot, {
      webgpu,
      onNameChange: (name) => editorRef?.setName(name),
      onNickChange: (nick) => editorRef?.setNick(nick),
      initialName: initialSaveDefaults.flameName,
      initialNick: initialSaveDefaults.flameNick,
      // #103 Phase 6 Task 6.2 — action row callbacks. Each one routes into an
      // existing editor handler (handleReroll / handleOpenFile /
      // handleSaveFile / handleRenderPng) or a new setter exposed on
      // EditPageHandle.
      onOpenFile: () => editorRef?.openFile(),
      onReroll: () => editorRef?.reroll(),
      onUndo: () => editorRef?.undo(),
      onRedo: () => editorRef?.redo(),
      computePreview: (template) => editorRef?.computeFilenamePreview(template) ?? null,
      onSizeChange: (w, h) => editorRef?.setSize(w, h),
      onQualityChange: (q) => editorRef?.setQuality(q),
      onSettleChange: (ms) => {
        editorRef?.setSettleDelayMs(ms);
        editBar.setSettle(ms);
      },
      onSaveFlame: () => editorRef?.saveFlame(),
      onSave: () => { void editorRef?.saveRender(); },
      // #103 Phase 2 Task 2.3 — editor tab clicks fall through to
      // handleTabClick (no transfer rules apply when leaving editor).
      onTabClick: handleTabClick,
    });

    const { mountEditPage } = await import('./edit-mount');
    const { paletteSection } = await import('./edit-section-palette');
    const { hslSection } = await import('./edit-section-hsl');
    const { curvesSection } = await import('./edit-section-curves');
    const { viewportSection } = await import('./edit-section-viewport');
    const { xformsSection } = await import('./edit-section-xforms');
    const { finalSection } = await import('./edit-section-final');
    const { globalSection } = await import('./edit-section-global');
    const { densitySection } = await import('./edit-section-density');
    const { renderSection } = await import('./edit-section-render');
    // #119 — catalog → editor handoff. When the URL is
    // /v1/edit?from=catalog&v=&w=&p=, build the catalog genome and feed
    // it to the editor as initialGenome. Otherwise mountEditPage falls
    // through to its normal cold-start (pending / wip / reroll).
    const catalogInitialGenome = initialIntent.kind === 'catalog-entry'
      ? (await import('./variation-catalog-scaffold')).buildCatalogGenome(
          initialIntent.entry.idx,
          initialIntent.entry.weight,
          initialIntent.entry.params,
        )
      : undefined;
    const editor = mountEditPage({
      root: editRoot,
      device: editDevice,
      format: editFormat,
      defaultNick: savedNick,
      initialGenome: catalogInitialGenome,
      sections: [
        renderSection,
        paletteSection,
        hslSection,
        curvesSection,
        viewportSection,
        xformsSection,
        finalSection,
        globalSection,
        densitySection,
      ],
      onStateChange: (state) => {
        editBar.setMeta({
          flameName: state.genome.name,
          authorNick: state.genome.nick,
        });
        editBar.setDimensions(state.genome.size ?? null);
        // Mirror size + quality back to the bar's action row so the 📐 Size ▾
        // button label + the active QUALITY pick stay in sync when the user
        // edits W/H/quality in the Render section, or after reroll/open.
        if (state.genome.size) {
          editBar.setSize(state.genome.size.width, state.genome.size.height);
        }
        if (state.genome.quality) {
          editBar.setQuality(state.genome.quality);
        }
        // #192 — the loaded flame's nick (state.genome.nick) is now
        // read-only at this layer: it surfaces in the bar's loaded-source
        // chip via setMeta. The bar's nick input writes only to the
        // editor's save-only defaults (persisted by the editor itself).
        // No localStorage mirror here.
      },
      onProgressShow: (label) => editBar.showProgress(label),
      onProgressHide: () => editBar.hideProgress(),
      onSettleDelayChange: (ms) => editBar.setSettle(ms),
      onHistoryChange: (canUndo, canRedo) => {
        editBar.setUndoEnabled(canUndo);
        editBar.setRedoEnabled(canRedo);
      },
    });
    editorRef = editor;

    // #104 — the editor's first onStateChange echo fires DURING mountEditPage
    // construction (before this assignment), so the bar's preview tail can't
    // resolve the template (computeFilenamePreview routes through editorRef,
    // which was still null). Re-tick setMeta now that editorRef is live so a
    // cold-start with a templated genome.name shows its preview immediately.
    editBar.setMeta({
      flameName: editor.state.genome.name,
      authorNick: editor.state.genome.nick,
    });

    // #108 — keyboard handler scoped to the editor's lifecycle. Cmd/Ctrl+Z
    // undo, Shift+Cmd/Ctrl+Z or Ctrl+Y redo. metaKey || ctrlKey makes both
    // OSes forgiving; Ctrl+Y is gated to non-Mac so we don't intercept any
    // reserved Mac combo. preventDefault stops browser back-step on form
    // controls. Listener is bound to document; removed on tab-away when
    // the editor is destroyed.
    const isMac = /Mac|iPhone|iPad/i.test(navigator.userAgent);
    const onEditorKeydown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // Skip when focus is inside a text-typing element — Cmd-Z in a
      // <input> should undo the typing, not the editor state.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); editor.undo(); }
      else if (key === 'z' && e.shiftKey) { e.preventDefault(); editor.redo(); }
      else if (key === 'y' && !isMac) { e.preventDefault(); editor.redo(); }
    };
    document.addEventListener('keydown', onEditorKeydown);
    const originalDestroy = editor.destroy;
    editor.destroy = () => {
      document.removeEventListener('keydown', onEditorKeydown);
      originalDestroy.call(editor);
    };
    return;
  }

  // #119 — /v1/variations catalog surface. Same early-dispatch pattern as
  // the editor: mount the variations root, hide the viewer chrome, return
  // before the viewer setup runs. The catalog needs a WebGPU device for
  // its live flame previews; acquired here on entry.
  if (initialIntent?.kind === 'variations') {
    const { device: catDevice, format: catFormat } = await acquireGpu();
    const catRoot = document.getElementById('pyr3-variations');
    if (!catRoot) {
      console.error('pyr3: #pyr3-variations missing from index.html — catalog cannot mount');
      return;
    }
    catRoot.hidden = false;
    document.body.classList.add('pyr3-variations-mode');
    const { mountVariationCatalog } = await import('./variation-catalog-mount');
    mountVariationCatalog(catRoot, { device: catDevice, format: catFormat });
    return;
  }

  const { device, context, format, canvas } = await initDevice('pyr3-canvas');
  canvas.width = RENDER_SIZE;
  canvas.height = RENDER_SIZE;

  const renderer: Renderer = createRenderer(device, format, {
    width: RENDER_SIZE,
    height: RENDER_SIZE,
    oversample: QUICK_OVERSAMPLE,
    filterRadius: DEFAULT_FILTER_RADIUS,
  });

  // #22: wire the Save click to a canvas.toBlob download with the bar's
  // suggested filename. The WebGPU canvas's swap-chain texture is read back
  // directly by toBlob (verified in current Chrome — the earlier "not
  // readable post-render" note was stale once WebGPU canvas snapshotting
  // landed). A null blob (toBlob can fail on a clobbered swap-chain) surfaces
  // as a toast rather than a silent no-op.
  //
  // #123 — the resulting PNG carries a `pyr3`-keyed tEXt chunk with the
  // current genome serialized as JSON. Self-describing output; round-trips
  // via a future PNG-import reader.
  saveCanvas = (filename) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        bar.showToast('Save failed — canvas was not snapshottable');
        return;
      }
      let finalBlob: Blob = blob;
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const pyr3Json = JSON.stringify(genomeToJson(activeGenome));
        const withMetadata = injectPngTextChunk(bytes, 'pyr3', pyr3Json);
        finalBlob = new Blob([withMetadata as BlobPart], { type: 'image/png' });
      } catch (err) {
        console.warn('pyr3: PNG metadata injection failed; saving without metadata', err);
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(finalBlob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 0);
    }, 'image/png');
  };

  // #35: `let` (not `const`) so the test rig's `__pyr3SetSeed` dev hook can
  // pin the next render's seed for deterministic FE↔BE parity. All render
  // callsites capture this binding, so the latest value is read at dispatch.
  let seed = (Math.random() * 0xffffffff) >>> 0;
  let activeGenome: Genome = SPIRAL_GALAXY;

  // #176 — render-mode-bar mounts between the chrome bar and the canvas zone
  // in the viewer. Preview side is wired to localStorage (workstation pref);
  // render side mirrors activeGenome.size + activeGenome.quality. 💾 Save
  // Render fires a full-quality render at genome.size × oversample × quality
  // through editRenderer.fullRenderAt with the new progress modal +
  // AbortSignal (parallel to the editor's Save Render flow).
  let viewerPreviewCfg: PreviewRenderConfig = loadPreviewConfig();

  // #176 — viewer's RENDER config is workstation-pref-shaped: independent
  // of activeGenome (loaded flames do NOT reset / override it). Persists to
  // localStorage so the user's HD/Q50 (or whatever they pick) survives page
  // reloads + flame nav. Default = HD 1920×1080 + Q50.
  interface ViewerRenderConfig {
    width: number;
    height: number;
    quality: number;
  }
  const VIEWER_RENDER_CFG_KEY = 'pyr3-viewer-render-config';
  const DEFAULT_VIEWER_RENDER_CFG: ViewerRenderConfig = { width: 1920, height: 1080, quality: 50 };
  function loadViewerRenderConfig(): ViewerRenderConfig {
    try {
      const raw = globalThis.localStorage?.getItem(VIEWER_RENDER_CFG_KEY);
      if (!raw) return DEFAULT_VIEWER_RENDER_CFG;
      const p = JSON.parse(raw);
      if (!p || typeof p !== 'object') return DEFAULT_VIEWER_RENDER_CFG;
      if (p._v !== 1) return DEFAULT_VIEWER_RENDER_CFG;
      const width = Math.max(1, Math.floor(Number(p.width) || 0));
      const height = Math.max(1, Math.floor(Number(p.height) || 0));
      // #201 P0 Task 4 — render-mode-bar enforces the active cap (browser
      // 200 / dawn-node unlimited). This echo-clamp only guards against
      // garbage in localStorage; trust the bar for the upper bound.
      const quality = Math.max(1, Math.round(Number(p.quality) || 50));
      if (!width || !height) return DEFAULT_VIEWER_RENDER_CFG;
      return { width, height, quality };
    } catch {
      return DEFAULT_VIEWER_RENDER_CFG;
    }
  }
  function saveViewerRenderConfig(cfg: ViewerRenderConfig): void {
    try {
      globalThis.localStorage?.setItem(VIEWER_RENDER_CFG_KEY, JSON.stringify({ ...cfg, _v: 1 }));
    } catch (err) {
      console.warn('pyr3: saveViewerRenderConfig failed', err);
    }
  }
  let viewerRenderCfg: ViewerRenderConfig = loadViewerRenderConfig();

  // #176 — track the user-facing flame name so Save Render's filename
  // matches the chrome bar's existing 'Save' filename composition
  // (`electricsheep.{gen}.{id}.pyr3.png`). Updated in applyLoadResult
  // alongside the bar's setMeta call.
  let viewerCurrentFlameName: string | null = null;
  // #176 — URL params (?preview / ?previewQ / ?quick=1) override the
  // persisted config for THIS session only. NOT written back to localStorage.
  {
    const override = parsePreviewOverride(typeof window !== 'undefined' ? window.location.search : '');
    if (override?.tier) viewerPreviewCfg = { ...viewerPreviewCfg, tier: override.tier };
    if (override?.quality !== undefined) viewerPreviewCfg = { ...viewerPreviewCfg, quality: override.quality };
  }
  const viewerEditRenderer = createEditRenderer(renderer, {});
  let viewerRenderInFlight = false;
  let viewerRenderModeBarHandle: RenderModeBarHandle | null = null;

  const renderModeBarHost = document.createElement('div');
  renderModeBarHost.id = 'pyr3-render-mode-bar';
  renderModeBarHost.className = 'pyr3-render-mode-bar-host';
  const appRoot = document.getElementById('pyr3-app')!;
  const canvasZone = document.getElementById('pyr3-canvas-zone')!;
  appRoot.insertBefore(renderModeBarHost, canvasZone);
  // #176 — body class hides the chrome bar's Size + Quality + Save Render
  // (now duplicated by render-mode-bar). CSS selector in index.html.
  document.body.classList.add('pyr3-has-render-mode-bar');

  async function viewerSaveRender(): Promise<void> {
    if (viewerRenderInFlight) return;
    viewerRenderInFlight = true;
    // #176 — render dims + quality come from viewerRenderCfg (workstation
    // pref), NOT activeGenome (which carries the flame's declared values
    // that might be q=2000, dims=800×592, etc). The flame contributes
    // palette / xforms / colorCurves / etc — everything except the OUTPUT
    // SPEC. Scale is rescaled proportionally so the flame fills the same
    // visual fraction of the output canvas it did at its declared dims
    // (applyPreset semantics — works for any output dim).
    const targetW = viewerRenderCfg.width;
    const targetH = viewerRenderCfg.height;
    const targetQuality = viewerRenderCfg.quality;
    const oversample = 1;
    const filterRadius = activeGenome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;
    const qualityLabel = String(targetQuality);
    // Rescale genome.scale: flame was authored for activeGenome.size; now
    // rendering at viewerRenderCfg's dims. Match the long-edge fraction.
    const declSize = activeGenome.size ?? { width: targetW, height: targetH };
    const declMax = Math.max(declSize.width, declSize.height);
    const targetMax = Math.max(targetW, targetH);
    const scaleAdjust = targetMax / declMax;
    const renderGenome: Genome = {
      ...activeGenome,
      size: { width: targetW, height: targetH },
      oversample,
      quality: targetQuality,
      scale: activeGenome.scale * scaleAdjust,
    };

    // Cancel any in-flight viewer render before we resize / re-iterate.
    if (runHandle) {
      runHandle.cancel();
      await runHandle.promise;
      runHandle = null;
      await device.queue.onSubmittedWorkDone();
    }

    const restoreW = renderer.width;
    const restoreH = renderer.height;
    const restoreOversample = renderer.oversample;
    const restoreFilter = renderer.filterRadius;

    // #195 — compute targetSamples up-front so the modal can show
    // `<samples> / <target>` in its iteration readout. (Was computed
    // inside the try block; moved out so the modal opts can carry it.)
    const targetSamples = targetQuality * targetW * targetH;
    const abortCtrl = new AbortController();
    const modal = openRenderProgressModal({
      host: document.body,
      sizeLabel: `${targetW}×${targetH}`,
      qualityLabel,
      targetSamples,
      onCancel: () => abortCtrl.abort(),
    });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    let cancelled = false;
    try {
      // Canvas (= output texture) sits at LOGICAL dims; the renderer's
      // internal histogram + visualize texture get the supersample
      // multiply applied inside renderer.resize.
      canvas.width = targetW;
      canvas.height = targetH;
      renderer.resize({ width: targetW, height: targetH, oversample, filterRadius });
      // Filename: use the SAME source the chrome bar's existing 🧬 Save uses
      // (viewerCurrentFlameName = result.genome.name || sourceBase) — keyed
      // to the corpus path (electricsheep.{gen}.{id}) when the genome.name
      // is missing. Falls back through genome.name → 'pyr3-render'.
      const rawName = viewerCurrentFlameName || renderGenome.name || 'pyr3-render';
      const baseName = rawName.trim().replace(/[^A-Za-z0-9._-]/g, '_') || 'pyr3-render';
      const filename = `${baseName}.pyr3.png`;
      // #201 P0 Task 2 — single Save Render fork point shared with the
      // editor. Helper handles startChunkedRender + AbortSignal bridge +
      // GPU drain + toBlob + injectPngTextChunk + anchor download. Task 7
      // will add the backend fork inside the helper itself.
      const outcome = await saveRenderToPng({
        renderer,
        genome: renderGenome,
        canvas,
        ctx: context,
        device,
        abortSignal: abortCtrl.signal,
        onProgress: (info) => modal.setProgress(info),
        filename,
        metadataJson: JSON.stringify(genomeToJson(renderGenome)),
        targetSamples,
        seedBase: seed,
        walkerJitter: currentWalkerJitter,
      });
      if (outcome === 'cancelled') {
        cancelled = true;
      } else {
        bar.showToast(`💾 Saved ${filename} to Downloads`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`pyr3: viewer Save Render failed — ${msg}`);
      bar.showToast(`Render failed: ${msg}`);
    } finally {
      // Restore the viewer canvas dims so the live preview keeps working.
      canvas.width = restoreW;
      canvas.height = restoreH;
      renderer.resize({
        width: restoreW,
        height: restoreH,
        oversample: restoreOversample,
        filterRadius: restoreFilter,
      });
      modal.close();
      viewerRenderInFlight = false;
      viewerRenderModeBarHandle?.refresh();
      void cancelled;
      // Re-iterate the viewer canvas so the live preview is back to a
      // good state at the restored dims.
      void rerender();
    }
  }

  viewerRenderModeBarHandle = mountRenderModeBar({
    host: renderModeBarHost,
    getPreviewConfig: () => viewerPreviewCfg,
    setPreviewConfig: (cfg) => {
      viewerPreviewCfg = cfg;
      savePreviewConfig(cfg);
      // #176 — tier change re-runs the quick-preview path at the new
      // longest-edge cap (Fast=512 / Balanced=1024 / Sharp=1536).
      // #197 — quality change re-iterates at the new spp target
      // (viewerPreviewCfg.quality, 10–50) via `rerender()` → genome.quality.
      void rerender();
    },
    // #176 — bar reads/writes the workstation-pref ViewerRenderConfig.
    // Decoupled from activeGenome — flame loads do NOT reset the bar.
    // Default HD + Q50; user picks survive page reloads via localStorage.
    getRenderSize: () => ({ width: viewerRenderCfg.width, height: viewerRenderCfg.height }),
    setRenderSize: (size) => {
      viewerRenderCfg = { ...viewerRenderCfg, width: size.width, height: size.height };
      saveViewerRenderConfig(viewerRenderCfg);
      // Aspect-lock — render dim change reshapes the preview canvas to match.
      void rerender();
    },
    getRenderQuality: () => viewerRenderCfg.quality,
    setRenderQuality: (q) => {
      // #201 P0 Task 4 — bar's clampRenderQuality is authoritative for the cap.
      viewerRenderCfg = { ...viewerRenderCfg, quality: Math.max(1, q) };
      saveViewerRenderConfig(viewerRenderCfg);
    },
    onSaveRender: () => viewerSaveRender(),
    canSave: () => !viewerRenderInFlight,
    showToast: (msg) => bar.showToast(msg),
  });

  let runHandle: RunHandle | null = null;
  // #8: true for the duration of a quality-ladder / custom (e.g. 4K) render.
  // Corpus loads track their own in-flight state via the load sequencer; this covers
  // the standalone ladder path so arrow-key / pill nav can't queue behind a
  // heavy render that was started without a flame load.
  let renderInFlight = false;

  // PYR3-018 FE parity sweep: pixel-readback hook (dev-only).
  // The canvas swap-chain texture is single-frame-presented and not
  // readable via drawImage / toDataURL post-render. This hook mirrors
  // the CLI readback (bin/pyr3-render.ts §5): allocate an offscreen
  // texture with COPY_SRC, re-present the existing accumulated
  // histogram into it (renderer.present is cheap; iteration state is
  // preserved), copyTextureToBuffer → mapAsync → return RGBA bytes.
  let lastRenderInfo: { genome: Genome; totalSamples: number } | null = null;
  if (import.meta.env.DEV) {
    (window as unknown as {
      __pyr3CapturePixels?: () => Promise<{ width: number; height: number; rgba: Uint8ClampedArray; format: GPUTextureFormat }>;
    }).__pyr3CapturePixels = async () => {
      if (!lastRenderInfo) {
        throw new Error('__pyr3CapturePixels: no render to capture (load a flame first)');
      }
      const { genome, totalSamples } = lastRenderInfo;
      const W = renderer.width;
      const H = renderer.height;
      const tex = device.createTexture({
        label: 'pyr3.capture.output',
        size: { width: W, height: H },
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      renderer.present({ genome, outputView: tex.createView(), totalSamples, forceDeOff: false });
      const bytesPerPixel = 4;
      const unpaddedBytesPerRow = W * bytesPerPixel;
      const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
      const readBuf = device.createBuffer({
        label: 'pyr3.capture.readback',
        size: bytesPerRow * H,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = device.createCommandEncoder({ label: 'pyr3.capture.encoder' });
      encoder.copyTextureToBuffer(
        { texture: tex },
        { buffer: readBuf, bytesPerRow, rowsPerImage: H },
        { width: W, height: H },
      );
      device.queue.submit([encoder.finish()]);
      await readBuf.mapAsync(GPUMapMode.READ);
      const padded = new Uint8Array(readBuf.getMappedRange().slice(0));
      readBuf.unmap();
      tex.destroy();
      readBuf.destroy();
      // Strip row padding to tight RGBA, swap channels if needed (Chrome's
      // preferred canvas format is bgra8unorm on macOS — our pipeline target
      // matches, but parity comparison + PNG encoding expects RGBA).
      const tight = new Uint8ClampedArray(W * H * 4);
      const swapBR = format === 'bgra8unorm';
      for (let y = 0; y < H; y++) {
        const srcOff = y * bytesPerRow;
        const dstOff = y * unpaddedBytesPerRow;
        if (swapBR) {
          for (let x = 0; x < W; x++) {
            const s = srcOff + x * 4;
            const d = dstOff + x * 4;
            tight[d] = padded[s + 2]!;   // R ← B
            tight[d + 1] = padded[s + 1]!; // G
            tight[d + 2] = padded[s]!;     // B ← R
            tight[d + 3] = padded[s + 3]!; // A
          }
        } else {
          tight.set(padded.subarray(srcOff, srcOff + unpaddedBytesPerRow), dstOff);
        }
      }
      return { width: W, height: H, rgba: tight, format };
    };
  }

  // PYR3-027 perf A/B: drive the orchestrator with explicit knob
  // overrides on the last-rendered genome, holding total GPU samples
  // constant so only orchestration overhead varies. Awaits a full GPU
  // queue drain so wallMs is GPU-finished wall-clock, not JS-queue time.
  // Load a flame before calling. Dev-only.
  if (import.meta.env.DEV) {
    (window as unknown as {
      __pyr3Bench?: (cfg: {
        targetSamples?: number;
        samplesPerChunk?: number;
        presentEach?: boolean;
        yieldEveryNChunks?: number;
      }) => Promise<{ result: string; chunks: number; targetSamples: number; wallMs: number }>;
    }).__pyr3Bench = async (cfg) => {
      if (!lastRenderInfo) {
        throw new Error('__pyr3Bench: no render to bench (load a flame first)');
      }
      // Cancel any in-flight production render so it doesn't contend.
      if (runHandle) {
        runHandle.cancel();
        await runHandle.promise;
        runHandle = null;
      }
      await device.queue.onSubmittedWorkDone();
      const genome = lastRenderInfo.genome;
      const targetSamples = cfg.targetSamples ?? lastRenderInfo.totalSamples;
      const spc = cfg.samplesPerChunk ?? 1_000_000;
      const chunks = Math.max(1, Math.ceil(targetSamples / spc));
      const t0 = performance.now();
      const handle = startChunkedRender({
        renderer,
        genome,
        outputViewProvider: () => context.getCurrentTexture().createView(),
        targetSamples,
        seedBase: seed,
        onProgress: () => {},
        presentAfterEachChunk: cfg.presentEach,
        samplesPerChunk: cfg.samplesPerChunk,
        yieldEveryNChunks: cfg.yieldEveryNChunks,
        walkerJitter: currentWalkerJitter,
      });
      const result = await handle.promise;
      await device.queue.onSubmittedWorkDone();
      const wallMs = performance.now() - t0;
      return { result, chunks, targetSamples, wallMs };
    };
  }

  // PYR3-027 Option 1 prototype: decoupled display/dispatch render driven
  // against the REAL canvas so the refinement is watchable in Chrome.
  // Counts display presents so we can confirm refinement frames land at
  // the display cadence rather than per-dispatch. Dev-only.
  if (import.meta.env.DEV) {
    (window as unknown as {
      __pyr3Decoupled?: (cfg?: {
        targetSamples?: number;
        samplesPerDispatch?: number;
        displayIntervalMs?: number;
        cheapPreview?: boolean;
      }) => Promise<{ result: string; targetSamples: number; wallMs: number }>;
    }).__pyr3Decoupled = async (cfg = {}) => {
      if (!lastRenderInfo) {
        throw new Error('__pyr3Decoupled: no render to drive (load a flame first)');
      }
      if (runHandle) {
        runHandle.cancel();
        await runHandle.promise;
        runHandle = null;
      }
      await device.queue.onSubmittedWorkDone();
      const genome = lastRenderInfo.genome;
      const targetSamples = cfg.targetSamples ?? lastRenderInfo.totalSamples;
      const t0 = performance.now();
      const handle = startDecoupledRender({
        renderer,
        genome,
        outputViewProvider: () => context.getCurrentTexture().createView(),
        targetSamples,
        seedBase: seed,
        onProgress: () => {},
        samplesPerDispatch: cfg.samplesPerDispatch,
        displayIntervalMs: cfg.displayIntervalMs,
        cheapPreview: cfg.cheapPreview,
        walkerJitter: currentWalkerJitter,
      });
      const result = await handle.promise;
      await device.queue.onSubmittedWorkDone();
      const wallMs = performance.now() - t0;
      return { result, targetSamples, wallMs };
    };
  }

  const rerender = async (): Promise<void> => {
    // #241 — refuse to start a preview render while a Save Render is iterating.
    // Only the Save button is disabled during a save; the preview tier/quality
    // buttons + W/H inputs are not, and their setters call `void rerender()`.
    // viewerSaveRender nulls runHandle, so the `if (runHandle)` cancel below
    // wouldn't serialize against it — a mid-save click would resize() to preview
    // dims and start a competing render on the shared pipelines/histogram,
    // corrupting the PNG or triggering a WebGPU validation error. The save's
    // own finally clears viewerRenderInFlight BEFORE its `void rerender()`, so
    // the post-save refresh still runs.
    if (viewerRenderInFlight) return;
    // Cancel any in-flight orchestrator before starting a new one. The
    // promise still settles cleanly (either 'cancelled' or 'completed')
    // so awaiting it serializes the JS side.
    if (runHandle) {
      runHandle.cancel();
      await runHandle.promise;
      runHandle = null;
      // Drain pending GPU before we potentially resize.
      await device.queue.onSubmittedWorkDone();
    }

    // #176 — preview canvas aspect comes from viewerRenderCfg (bar's RENDER
    // dims), NOT activeGenome.size. The bar is now authoritative for output
    // shape: picking 'square' shows preview at 1:1; picking '4K' shows
    // preview at 16:9. Tier cap (Fast=512 / Balanced=1024 / Sharp=1536)
    // determines the longest preview edge.
    const tierCap = PREVIEW_TIER_LONGEST_EDGE[viewerPreviewCfg.tier];
    const renderCfgMaxEdge = Math.max(viewerRenderCfg.width, viewerRenderCfg.height);
    const previewFit = renderCfgMaxEdge > tierCap ? tierCap / renderCfgMaxEdge : 1;
    const targetW = Math.max(1, Math.round(viewerRenderCfg.width * previewFit));
    const targetH = Math.max(1, Math.round(viewerRenderCfg.height * previewFit));
    const targetFilter = activeGenome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;
    // genome.scale adjustment: flame was authored against activeGenome.size,
    // but we're rendering at viewerRenderCfg dims scaled to preview tier.
    // WYSIWYG demands: scale_preview * preview_dim_max = scale_save * save_dim_max,
    // which (since scale_save = scale_authored * save_dim_max / authored_dim_max)
    // simplifies to: scale_preview = scale_authored * preview_dim_max /
    // authored_dim_max.
    const authoredMaxEdge = Math.max(
      activeGenome.size?.width ?? renderCfgMaxEdge,
      activeGenome.size?.height ?? renderCfgMaxEdge,
    );
    const previewMaxEdge = Math.max(targetW, targetH);
    const sizeScale = previewMaxEdge / authoredMaxEdge;

    if (
      targetW !== renderer.width
      || targetH !== renderer.height
      || QUICK_OVERSAMPLE !== renderer.oversample
      || targetFilter !== renderer.filterRadius
    ) {
      canvas.width = targetW;
      canvas.height = targetH;
      renderer.resize({ width: targetW, height: targetH, oversample: QUICK_OVERSAMPLE, filterRadius: targetFilter });
    }

    const renderGenome: Genome = {
      ...activeGenome,
      scale: activeGenome.scale * sizeScale,
      // CRITICAL: keep `genome.oversample` aligned with the pipeline's
      // configured oversample. chaos.ts computes the WGSL scale uniform as
      // `g.scale * g.oversample` — if the pipeline is built at oversample=1
      // but g.oversample stays at the genome's declared supersample
      // (often 4 for ES flames), the projection over-zooms by that factor,
      // producing the "camera stuck at the middle point" over-zoom symptom.
      oversample: QUICK_OVERSAMPLE,
      // #197 — preview iter density comes from viewerPreviewCfg.quality (the
      // 10–50 Q slider in the render-mode bar), NOT activeGenome.quality (which
      // is the flame's declared render-side quality, often 200+ on ES flames).
      // The slider is the user's live speed-vs-grain knob. Already clamped to
      // [10, 50] by loadPreviewConfig + parsePreviewOverride + the bar UI.
      quality: viewerPreviewCfg.quality,
    };
    const targetSamples = (renderGenome.quality ?? QUICK_MAX_SPP) * renderer.width * renderer.height;

    // Tier 3 mounts immediately on render start — visitor always sees
    // "this is working" + "N% / chunk M of K". Hides on completion.
    bar.showProgress({
      label: 'Rendering',
      percent: 0,
      etaSeconds: 0,
      samples: 0,
      onCancel: () => runHandle?.cancel(),
    });

    const handle = startChunkedRender({
      renderer,
      genome: renderGenome,
      outputViewProvider: () => context.getCurrentTexture().createView(),
      targetSamples,
      seedBase: seed,
      onProgress: (info) => {
        bar.showProgress({
          label: 'Rendering',
          percent: info.percent,
          etaSeconds: info.etaSeconds,
          samples: info.samples,
          onCancel: () => runHandle?.cancel(),
        });
      },
      walkerJitter: currentWalkerJitter,
    });
    runHandle = handle;
    if (import.meta.env.DEV) {
      (window as unknown as { __pyr3LastHandle?: RunHandle }).__pyr3LastHandle = handle;
    }
    // PYR3-018 capture hook reads from the post-render histogram via
    // renderer.present(). Stash genome + sample count so the hook can
    // re-present into an offscreen texture without re-iterating.
    lastRenderInfo = { genome: renderGenome, totalSamples: targetSamples };

    try {
      await handle.promise;
    } finally {
      bar.hideProgress();
      clearFirstPaintCue();
      if (runHandle === handle) runHandle = null;
      // Initial/default paint is the Preview tier — reflect it in the readout.
      bar.setQuality({
        width: renderer.width,
        height: renderer.height,
        spp: renderGenome.quality ?? QUICK_MAX_SPP,
        tierLabel: DEFAULT_TIER.name,
      });
    }
  };

  // PYR3-027: render the CURRENT flame at 4K via the decoupled
  // orchestrator, so the visitor can watch a heavy render build
  // progressively in the browser. This is exactly where the decoupled
  // design pays off — fat back-to-back dispatches keep iteration
  // throughput high while the display loop presents the accumulating
  // histogram on a steady frame cadence (cheap DE-off previews
  // mid-build, one full-DE present at the end).
  //
  // 4K @ oversample 1 → histogram = longEdge·shortEdge·4ch·4B. For a
  // 16:9 flame that's ~126 MB; a square flame is ~226 MB. The
  // capability guard below aborts (with a toast) when the device's
  // maxStorageBufferBindingSize can't fit it, rather than crashing the
  // tab. This reverses the PYR3-023 FE-4K removal: that removal was the
  // CHUNKED orchestrator (1887 rAF/present chunks) plus oversample-4
  // (16× the histogram); the decoupled path + oversample 1 avoid both.
  const HIST_BYTES_PER_CELL = 4 * 4; // 4 channels (R,G,B,count) × 4 bytes
  // Render the current flame at a chosen quality — a preset tier or a custom
  // resolution/SPP (PYR3-050). Generalizes the old 4K path: applyPreset()
  // resolves dims/aspect/quality from the request's PresetSpec (so FE + CLI
  // share the math), the capability guard aborts when the histogram won't fit,
  // and the info-bar readout updates on completion. 4K is just the top tier.
  const renderQuality = async (req: QualityRequest): Promise<void> => {
    // Disable the ladder synchronously BEFORE the first await, so a double-tap
    // during the cancel/drain can't spawn a second concurrent render. The
    // renderInFlight flag (also set synchronously) gates corpus nav for #8.
    renderInFlight = true;
    bar.setBusy(true);
    if (runHandle) {
      runHandle.cancel();
      await runHandle.promise;
      runHandle = null;
      await device.queue.onSubmittedWorkDone();
    }

    const spec: PresetSpec = req.kind === 'tier'
      ? tierToSpec(req.tier)
      : { maxDim: req.longEdge, maxSpp: req.spp, oversample: 1, shortEdgeRound: 'floor', mode: 'force' };
    const tierLabel = req.kind === 'tier' ? req.tier.name : 'Custom';

    // applyPreset resolves size (long-edge → native aspect), scale, oversample(1)
    // and capped quality — identical math to the CLI presets.
    const renderGenome = applyPreset(activeGenome, spec);
    // Size-dropdown explicit dims: when the request carries both width AND
    // height (Size presets like square 1080×1080 or iPhone 1290×2796), honor
    // the exact ratio instead of preserving the genome's aspect. The
    // long-edge math in applyPreset already ran above — overwrite its size.
    if (req.kind === 'custom' && req.width != null && req.height != null) {
      renderGenome.size = { width: req.width, height: req.height };
    }
    const targetW = renderGenome.size?.width ?? RENDER_SIZE;
    const targetH = renderGenome.size?.height ?? RENDER_SIZE;
    const spp = renderGenome.quality ?? spec.maxSpp;
    const targetFilter = activeGenome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;

    // Capability guard — never allocate a histogram the GPU can't bind.
    const histBytes = targetW * targetH * HIST_BYTES_PER_CELL;
    const maxBind = device.limits.maxStorageBufferBindingSize;
    if (histBytes > maxBind) {
      const mb = (n: number): string => `${(n / (1024 * 1024)).toFixed(0)} MB`;
      console.warn(
        `pyr3: ${tierLabel} render skipped — histogram ${mb(histBytes)} exceeds this GPU's max storage buffer ${mb(maxBind)}`,
      );
      bar.showToast(`${tierLabel} too large for this GPU (needs ${mb(histBytes)})`);
      bar.setBusy(false); // re-enable — we never started a render
      renderInFlight = false;
      return;
    }

    if (
      targetW !== renderer.width
      || targetH !== renderer.height
      || renderer.oversample !== 1
      || targetFilter !== renderer.filterRadius
    ) {
      canvas.width = targetW;
      canvas.height = targetH;
      renderer.resize({ width: targetW, height: targetH, oversample: 1, filterRadius: targetFilter });
    }

    const targetSamples = spp * renderer.width * renderer.height;
    console.log(
      `pyr3: ${tierLabel} decoupled render — ${renderer.width}×${renderer.height} · q${spp} · ${(targetSamples / 1e6).toFixed(0)}M samples`,
    );

    bar.showProgress({
      label: `Rendering ${tierLabel}`,
      percent: 0,
      etaSeconds: 0,
      samples: 0,
      onCancel: () => runHandle?.cancel(),
    });

    const handle = startDecoupledRender({
      renderer,
      genome: renderGenome,
      outputViewProvider: () => context.getCurrentTexture().createView(),
      targetSamples,
      seedBase: seed,
      onProgress: (info) => {
        bar.showProgress({
          label: `Rendering ${tierLabel}`,
          percent: info.percent,
          etaSeconds: info.etaSeconds,
          samples: info.samples,
          onCancel: () => runHandle?.cancel(),
        });
      },
      walkerJitter: currentWalkerJitter,
    });
    runHandle = handle;
    lastRenderInfo = { genome: renderGenome, totalSamples: targetSamples };

    try {
      await handle.promise;
    } finally {
      bar.hideProgress();
      bar.setBusy(false);
      renderInFlight = false;
      clearFirstPaintCue();
      if (runHandle === handle) runHandle = null;
      bar.setQuality({ width: renderer.width, height: renderer.height, spp, tierLabel });
    }
  };

  // Wire the bar's quality ladder (and a dev-only console hook) to the render
  // closure now that it's defined.
  renderQualityFn = (req) => { void renderQuality(req); };
  if (import.meta.env.DEV) {
    (window as unknown as { __pyr3RenderQuality?: (req: QualityRequest) => Promise<void> }).__pyr3RenderQuality = renderQuality;
  }

  // Advanced-row cost estimate: resolve dims via applyPreset (identical to the
  // render path) then size the histogram against the GPU's binding limit, so
  // the readout/✗-gate matches what renderQuality's guard would decide.
  estimateCostFn = (longEdge, spp) => {
    const spec: PresetSpec = { maxDim: longEdge, maxSpp: spp, oversample: 1, shortEdgeRound: 'floor', mode: 'force' };
    const g = applyPreset(activeGenome, spec);
    const width = g.size?.width ?? RENDER_SIZE;
    const height = g.size?.height ?? RENDER_SIZE;
    const bytes = width * height * HIST_BYTES_PER_CELL;
    return {
      width,
      height,
      mb: bytes / (1024 * 1024),
      fits: bytes <= device.limits.maxStorageBufferBindingSize,
    };
  };

  const applyLoadResult = async (result: LoadResult, sourceLabel: string): Promise<void> => {
    // Resize logic lives in rerender (it depends on the loaded genome's
    // dims); applyLoadResult just updates activeGenome + meta then kicks
    // the render path, which resizes if needed.
    activeGenome = result.genome;
    // #103 Phase 2 Task 2.3 — viewer writes the cross-surface currentFlame
    // context whenever it loads a flame. corpusId is omitted here; loadCorpus
    // refines this entry with its (gen, id) right after this call returns.
    setCurrentFlame({ genome: result.genome });
    // #176 — flame replacement does NOT touch the bar (viewerRenderCfg is
    // workstation pref, independent of activeGenome). User's HD/Q50 (or
    // whatever they picked) survives across surprise-me / corpus nav /
    // file open.
    if (result.kind === 'flame' && result.report) {
      const dropCount = result.report.droppedVariations.length;
      const ignoredCount = result.report.ignoredFields.length;
      const defaulted = result.report.defaultedFields;
      if (dropCount > 0 || ignoredCount > 0 || defaulted.length > 0) {
        console.log(
          `pyr3: import report — ${dropCount} unsupported variations · ${ignoredCount} ignored fields · ${defaulted.length} defaulted fields`,
        );
      }
      // #9: malformed scalars (e.g. NaN center/scale — 286 corpus flames) were
      // substituted with real defaults so the flame still renders. Surface it
      // loudly in-app so the user knows the framing/scale was synthesized.
      if (defaulted.length > 0) {
        const fields = defaulted.map((d) => d.field).join(', ');
        bar.showToast(`Some values were missing (${fields}) — loaded with defaults.`);
      }
    }
    console.log(`pyr3: loaded "${result.genome.name}" from ${sourceLabel}`);
    // Flame-name fallback ladder: XML `name` attr first; then the source
    // file's basename (stripped of .flam3 / .flame); then a sane default.
    // Without this the Save filename would read `imported.png` (or
    // `Untitled.png`) for corpus sheep whose XML lacks `name` — even though
    // the canonical `electricsheep.<gen>.<id>` label is right in the
    // sourceLabel that loadCorpus hands us.
    const sourceBase = sourceLabel.replace(/\.(flam3|flame)$/i, '');
    viewerCurrentFlameName = result.genome.name || sourceBase || 'Untitled';
    bar.setMeta({
      flameName: viewerCurrentFlameName,
      authorNick: result.genome.nick,
      sourceFilename: sourceLabel,
    });
    // #5: surface the flame's distinct variation set after the tier label.
    bar.setVariations(distinctVariationNames(result.genome));
    // #182 — render-mode-bar (viewerRenderCfg + viewerPreviewCfg) is the only
    // authority for viewer canvas dims + quality post-#176. The legacy PYR3-050
    // sticky-quality branch routed through renderQuality(currentQuality), which
    // reads pyr3-prefs (the pre-#176 chrome-bar tier/custom store). Users
    // carrying stale pyr3-prefs from a pre-#176 session saw the bar render at
    // its workstation-pref defaults but the canvas honor the stale custom
    // request — bar and canvas disagreed on first paint. Always route through
    // rerender so the bar wins. Heavy-quality output now lives in 💾 Save
    // Render, which reads viewerRenderCfg directly (line 762).
    await rerender();
  };

  // Graceful corpus missing-sheep panel (PYR3-039). Built once; covers the
  // canvas while keeping all three bars. Hidden whenever a real flame loads.
  const missingPanel = makeMissingPanel();

  // #70: sequencing state (loadInFlight / loadHookQueue / corpusQueue /
  // navLocked) is extracted to src/load-sequencer.ts. `loadFromFileImpl` is
  // the body of a load — re-entrancy guard + GPU drain live in the sequencer.
  const loadFromFileImpl = async (file: File): Promise<void> => {
    missingPanel.hide(); // a real flame is loading — clear any missing state
    bar.setBusy(true);
    try {
      const result = await loadFileFromUser(file);
      await applyLoadResult(result, file.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`pyr3: failed to load ${file.name}: ${msg}`);
      // #9: surface the failure in-viewer (not just the console) with a
      // report-an-issue affordance. The canvas keeps its prior content behind
      // the panel; the bars stay live so the user can navigate away. The raw
      // `msg` stays in the console (logged above) — the panel copy is kept
      // high-level.
      missingPanel.showLoadError(file.name);
    } finally {
      // Clear the first-paint cue even if the (initial) load threw before
      // rerender() ran — otherwise "dreaming…" would stick on a black canvas.
      // Idempotent via the firstPaintDone guard.
      clearFirstPaintCue();
      bar.setBusy(false);
    }
  };
  const sequencer = createLoadSequencer({ device, loadFromFile: loadFromFileImpl });
  const loadFromFile = (file: File): Promise<void> => sequencer.loadFile(file);

  // PYR3-026 FE↔BE parity rig: programmatic flame-load hook (dev-only).
  // Delegates to the load sequencer (#70) so the test rig's
  // `__pyr3LoadFlame(A); __pyr3LoadFlame(B)` sequence serializes through
  // the same chain as the file-picker path.
  if (import.meta.env.DEV) {
    // #35: pin the session seed for deterministic FE↔BE parity. Call BEFORE
    // __pyr3LoadFlame on each fixture so both engines render the same RNG
    // sequence. Truncates to u32 and is sticky until the next call.
    (window as unknown as {
      __pyr3SetSeed?: (n: number) => void;
    }).__pyr3SetSeed = (n: number) => {
      seed = n >>> 0;
    };

    (window as unknown as {
      __pyr3LoadFlame?: (text: string, label?: string) => Promise<void>;
    }).__pyr3LoadFlame = (text, label) => sequencer.enqueueHook(text, label);
  }

  // #203 — a locally-loaded (non-corpus) flame has no gen/id URL, so reflect it
  // as the generic /v1/viewer surface and persist the genome. A refresh on
  // /v1/viewer then rehydrates the same flame (see the cold-start dispatch +
  // src/last-flame-store.ts) instead of bouncing back to the hero sheep.
  // pushState when arriving from a corpus URL (Back returns to that sheep);
  // replaceState when already on /v1/viewer (opening another file doesn't stack
  // redundant history entries that all point at the same single stored flame).
  const routeToViewer = (): void => {
    saveLastFlame(activeGenome);
    const target = viewerUrl();
    if (window.location.pathname === target) {
      history.replaceState({ viewer: true }, '', target);
    } else {
      history.pushState({ viewer: true }, '', target);
    }
  };

  openFilePicker = (): void => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.flame,.flam3,.pyr3.json,.json,.png,image/png';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (file) {
        await loadFromFile(file);
        setNav(null); // user-opened file is not a corpus sheep
        setDocTitle(activeGenome.name || null); // #2: tab named after the flame
        routeToViewer(); // #203: reflect the custom flame in the URL + persist it
      }
      input.remove();
    });
    // Chrome 113+ fires `cancel` when the OS dialog is dismissed without a
    // selection — without this listener, hidden inputs accumulate on cancel.
    input.addEventListener('cancel', () => input.remove());
    document.body.appendChild(input);
    input.click();
  };

  // ── Corpus navigation (PYR3-041) ──
  // Load a sheep by (gen, id) and refresh the action-bar prev/next cluster from
  // the gen's availability manifest. `push` controls History (false for the
  // initial load + popstate; true for in-app nav clicks).
  // Current corpus-nav context (#8): the arrow-key handler reads this to decide
  // whether ←/→ have anywhere to go. Kept in sync with the action-bar pills via
  // setNav — null whenever the loaded flame isn't a corpus sheep.
  let currentNav: CorpusNav | null = null;
  const setNav = (nav: CorpusNav | null): void => {
    currentNav = nav;
    bar.setCorpusNav(nav);
  };

  const updateCorpusNav = async (gen: number, id: number): Promise<void> => {
    // #38: cross-gen resolution lets out-of-corpus URLs (gen=0, gen=999, id past
    // a gen's max) still surface a logical prev/next on the action bar instead
    // of dead-ending. In-gen lookups remain authoritative when both sides exist.
    const { prev, next } = await resolveCorpusNeighbors(
      gen,
      id,
      loadAvail,
      loadGensManifest,
      neighbors,
    );
    setNav({ gen, prev, next });
    // v1.2 contextual gallery entry — the viewer's `gallery` link points at
    // the page containing the current sheep, so flipping into the gallery
    // lands on the neighborhood instead of page 1.
    void pageForSheep(gen, id).then((page) => bar.setGalleryHref(page));
  };

  const loadCorpus = async (gen: number, id: number, push: boolean): Promise<void> => {
    // Wait out any in-flight load (e.g. a multi-second 4K render drain or a
    // file-picker load) BEFORE mutating history — otherwise the sequencer's
    // in-flight guard would silently drop this load while the URL + nav still
    // advanced, desyncing them from the canvas.
    while (sequencer.inFlight()) {
      await new Promise((r) => setTimeout(r, 25));
    }
    if (push) {
      history.pushState({ gen, id }, '', corpusUrl(gen, id));
    }
    // #2: name the tab after the navigated sheep (reflects the coord regardless
    // of whether the flame loads or turns out to be missing).
    setDocTitle(corpusTitleLabel(gen, id));
    let xml: string | null = null;
    try {
      xml = await fetchFlameXml(gen, id);
    } catch (err) {
      // FlameNotFound → graceful in-viewer missing state (PYR3-039/040); a
      // genuine fetch/network error is logged but presents the same panel
      // (nav still lets the user escape) rather than a hard crash.
      if (!(err instanceof FlameNotFound)) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`pyr3: corpus fetch failed for gen ${gen} sheep ${id} — ${msg}`);
      }
      xml = null;
    }

    if (xml === null) {
      // Hero fallback (A2 root-forward): the hero sheep ships as a bundled
      // fixture, so a refresh / Back to its forwarded URL stays instant and
      // dev-safe even when the chunk pipeline is unavailable (PYR3-048). Only the
      // hero gets this — every other id keeps the honest missing-sheep state.
      if (gen === HERO_GEN && id === HERO_ID) {
        const heroFile = await fetchAsFile(WELCOME_FLAME_URL);
        if (heroFile) {
          await loadFromFile(heroFile); // hides the missing panel on success
          // #103 Phase 2 Task 2.3 — tag the bundled hero load with its
          // corpusId so a viewer→editor tab click preloads the right sheep.
          setCurrentFlame({ genome: activeGenome, corpusId: { gen, id } });
          await updateCorpusNav(gen, id);
          return;
        }
      }
      // Keep the chrome; do NOT swap to the welcome flame. Honest wording —
      // we only know it isn't in OUR corpus, not that it "never existed".
      missingPanel.show(gen, id);
      bar.setMeta({ flameName: `gen ${gen} · sheep ${id} — not in corpus` });
      bar.setVariations([]); // no genome loaded → clear any stale variation set
      await updateCorpusNav(gen, id); // offer prev/next available
      return;
    }

    const file = new File([xml], `electricsheep.${gen}.${id}.flam3`, { type: 'text/xml' });
    await loadFromFile(file); // hides the missing panel on success
    // #103 Phase 2 Task 2.3 — refine the just-stored currentFlame entry
    // with its corpus identity. applyLoadResult wrote the bare {genome};
    // we overwrite with the (gen, id) tag so tab-click transfers know
    // this flame is corpus-resolvable.
    setCurrentFlame({ genome: activeGenome, corpusId: { gen, id } });
    await updateCorpusNav(gen, id);
  };
  // Serialize ALL corpus loads through one promise chain so two rapid nav
  // clicks can't both pushState + advance the nav before either renders.
  // The chain + #8 nav lock live in the sequencer (#70).
  const enqueueCorpus = (gen: number, id: number, push: boolean): Promise<void> =>
    sequencer.enqueueCorpus(() => loadCorpus(gen, id, push));
  // #8: a synchronous lock that engages the instant a nav is dispatched and
  // releases only when that load + its render fully settle — so rapid pill
  // clicks or arrow presses can't stack navigations behind the in-flight load.
  // Also refuses while a standalone quality-ladder render (e.g. 4K) is running.
  navigateCorpus = (gen, id) => {
    sequencer.tryNavigateCorpus(() => loadCorpus(gen, id, true), () => renderInFlight);
  };
  // ── Gallery surface state (v1.2 #47) ──
  // When the gallery is active, the viewer bar's DOM is cleared and replaced
  // by the gallery bar; the canvas is hidden and the #pyr3-gallery container
  // takes its place. The shared `renderer` is resized to Draft-tier cell dims
  // (512²) when the gallery mounts. The gallery owns its own cancellation
  // state via galleryHandle.cancel() / setPage().
  let galleryHandle: GalleryMountHandle | null = null;
  let galleryBar: GalleryBarHandle | null = null;
  let galleryTotalPages = 0;
  let currentGalleryPage = 1;
  let currentSurface: 'viewer' | 'gallery' = 'viewer';
  // #49 Phase B: drawer beneath the gallery bar. Mounted in the gallery
  // surface, destroyed on cross-surface nav. Its DOM root is a sibling of
  // the bar root, inserted dynamically so index.html stays viewer-shaped.
  let drawerHandle: FilterDrawerHandle | null = null;
  let drawerRoot: HTMLElement | null = null;
  // #49 Phase B6: banner above the gallery grid, shown only when the current
  // filter narrows the corpus to 0 matches. Inserted as a sibling above
  // galleryDiv (mountGallery would wipe a child of galleryDiv on each
  // wave). main.ts shows/hides it from inside applyFilter.
  let emptyBanner: HTMLElement | null = null;
  // #49 Phase A: live FilterSpec the gallery surface is paging through. Set
  // from the initial URL via parseLoadIntent, mutated by popstate cross-spec
  // navigation, and by applyFilter (the seam Phase B's drawer will call).
  let currentFilter: FilterSpec = DEFAULT_FILTER_SPEC;
  // Lazy-loaded feature index — fetched on first need (gallery mount) and
  // memoized for the rest of the session. Phase A always loads it on the
  // gallery surface (even for the default filter), so totalPagesFiltered
  // shares the same index reference as runWave inside mountGallery.
  let featureIndexPromise: ReturnType<typeof loadFeatureIndex> | null = null;
  const ensureFeatureIndex = (): ReturnType<typeof loadFeatureIndex> => {
    if (featureIndexPromise === null) featureIndexPromise = loadFeatureIndex();
    return featureIndexPromise;
  };

  const galleryFetchGenome = async (gen: number, id: number): Promise<Genome | null> => {
    try {
      const xml = await fetchFlameXml(gen, id);
      return parseFlame(xml).genome;
    } catch (err) {
      // FlameNotFound is expected for sparse-corpus gaps — the cell renders
      // a "(missing)" placeholder. Any other failure is logged but treated
      // the same way so the wave-fill doesn't stall on one bad cell.
      if (!(err instanceof FlameNotFound)) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`pyr3 gallery: fetch ${gen}/${id} failed — ${msg}`);
      }
      return null;
    }
  };

  const computeGalleryTotalPages = async (): Promise<number> => {
    const manifest = await loadGensManifest();
    if (manifest === null) return 0;
    const totalSheep = manifest.gens.reduce((sum, g) => sum + g.count, 0);
    return Math.max(1, Math.ceil(totalSheep / GALLERY_PAGE_SIZE));
  };

  // Debounced commit — rapid ‹/› mashing keeps the bar's page label in
  // sync each click (instant visual feedback) but coalesces the canonical
  // commit (history.pushState + setDocTitle + galleryHandle.setPage) into
  // the final page so the back-stack doesn't fill with intermediate pages
  // that would each trigger a wave-fill on popstate. ≤100ms window.
  const flushGalleryCommit = coalesce((page: number) => {
    // Preserve the active filter on every page-nav — otherwise ‹/› clicks
    // would strip `?coverage=0.5&…` from the URL, lying about what's
    // applied. The grid would still render filtered (closure-captured
    // filter state survives), but a refresh after nav would blow it away.
    history.pushState({}, '', galleryUrl(page, currentFilter));
    setDocTitle(`gallery · p${page}`);
    void galleryHandle?.setPage(page);
  }, GALLERY_NAV_COALESCE_MS);

  const navGallery = (newPage: number): void => {
    if (galleryHandle === null || galleryBar === null) return;
    const clamped = clampGalleryPage(newPage, galleryTotalPages);
    if (clamped === currentGalleryPage) return;
    currentGalleryPage = clamped;
    // Bar label updates immediately so each click looks responsive; the
    // URL + title + render commit on the coalesced final value.
    galleryBar.setPage(clamped, galleryTotalPages);
    flushGalleryCommit(clamped);
  };

  // #49 Phase A seam — wired but not yet reachable from any UI control. The
  // FilterDrawer + sort picker (Phase B/C) will invoke this with the spec
  // they assemble. Keeping the function defined now means Phase B can import
  // it without restructuring main.ts. Early-out on equal specs so accidental
  // re-applies are free; on a real change we pushState (so Back returns to
  // the prior filter), then refresh totalPages + page the mount.
  const applyFilter = (nextFilter: FilterSpec): void => {
    if (filterSpecEquals(currentFilter, nextFilter)) return;
    currentFilter = nextFilter;
    history.pushState({}, '', galleryUrl(1, nextFilter));
    setDocTitle('gallery · p1');
    galleryBar?.setActiveAxes(activeFilterCount(nextFilter));
    drawerHandle?.setFilter(nextFilter);
    void ensureFeatureIndex().then((index) => {
      const counts = computeFacetCounts(index, nextFilter);
      galleryTotalPages = totalPagesFiltered(currentFilter, GALLERY_PAGE_SIZE, { index });
      galleryBar?.setPage(1, galleryTotalPages);
      currentGalleryPage = 1;
      drawerHandle?.setFacetCounts(counts);
      // #103 Phase 5 Task 5.6 — feed the live total into the drawer's footer
      // so "Apply (N matches)" tracks reality. counts.total is the post-
      // filter total (computeFacetCounts already applies every active axis).
      drawerHandle?.setMatchCount(counts.total);
      if (emptyBanner !== null) {
        emptyBanner.style.display = counts.total === 0 ? 'flex' : 'none';
      }
      void galleryHandle?.setPage(1, nextFilter);
    });
  };

  const mountGallerySurface = async (initialPage: number): Promise<void> => {
    // #52: drain any in-flight viewer render before the gallery mount path
    // starts resizing pipelines. Currently the gallery is only entered via
    // URL intent (fresh page) or a full-page <a href> reload, so runHandle
    // is null in practice — but a future inline viewer↔gallery swap would
    // expose this. Mirrors the drain pattern at the bench / loadCorpus paths.
    if (runHandle) {
      runHandle.cancel();
      await runHandle.promise;
      runHandle = null;
    }
    await device.queue.onSubmittedWorkDone();

    // Parse the URL once more here so the FilterSpec the gallery actually
    // mounts with always tracks the live address bar — the caller (the
    // initial-load block at the bottom of main) passes `intent.page` but not
    // `intent.filter`, and a popstate-into-gallery (which today calls
    // location.reload — see the popstate handler) will land here too.
    const intent = parseLoadIntent(location.pathname + location.search);
    currentFilter = intent !== null && intent.kind === 'gallery'
      ? intent.filter
      : DEFAULT_FILTER_SPEC;

    canvas.hidden = true;
    const galleryDiv = document.getElementById('pyr3-gallery');
    if (galleryDiv === null) {
      console.error('pyr3 gallery: #pyr3-gallery missing from index.html');
      return;
    }
    galleryDiv.hidden = false;

    // Swap the bar — the viewer's BarHandle stays in memory but its DOM
    // is gone, so its setters become harmless no-ops until we swap back
    // (which today is via full page reload, not an inline remount).
    const barRoot = document.getElementById('pyr3-bar');
    if (barRoot === null) return;
    barRoot.replaceChildren();

    // Initial page clamped to a floor of 1; the real upper-bound clamp
    // happens after the index resolves below (totalPagesFiltered isn't
    // known yet). totalPages=0 displays "page N" (no "of M") until then.
    currentGalleryPage = Math.max(1, Math.floor(initialPage));
    currentSurface = 'gallery';
    setDocTitle(`gallery · p${currentGalleryPage}`);

    galleryBar = mountGalleryBar(barRoot, {
      webgpu,
      page: currentGalleryPage,
      totalPages: 0,
      onPrevPage: () => navGallery(currentGalleryPage - 1),
      onNextPage: () => navGallery(currentGalleryPage + 1),
      onRandomPage: () => {
        // 🎲 — gallery-internal jump to a random page. Distinct from the
        // viewer's dice (#23) which picks a random sheep + opens viewer.
        // No-op when totalPages is unknown (manifest fetch failed) so a
        // misclick doesn't navigate to a non-canonical URL.
        if (galleryTotalPages <= 0) return;
        const next = Math.floor(Math.random() * galleryTotalPages) + 1;
        navGallery(next);
      },
      activeAxes: activeFilterCount(currentFilter),
      onFilterToggle: () => drawerHandle?.toggleOpen(),
      // #103 Phase 2 Task 2.3 — gallery tab clicks fall through to
      // handleTabClick (no transfer rules apply when leaving gallery).
      onTabClick: handleTabClick,
    });

    // #49 Phase B6 — mount drawer EAGERLY with loading=true, before
    // awaiting the index. On slow networks the visitor sees the drawer
    // outline + a "loading feature index…" banner instead of an empty bar.
    drawerRoot = document.createElement('div');
    drawerRoot.id = 'pyr3-gallery-filter-drawer-root';
    barRoot.insertAdjacentElement('afterend', drawerRoot);
    drawerHandle = mountFilterDrawer(drawerRoot, {
      initialFilter: currentFilter,
      facetCounts: {
        variations: new Map(), xforms: new Map(),
        coverage: new Map(), entropy: new Map(),
        colorVar: new Map(), meanLum: new Map(),
        total: 0,
      },
      onChange: (next) => applyFilter(next),
      loading: true,
    });

    // #49 Phase B6 — empty-state banner. Inserted as a sibling of
    // galleryDiv inside the canvas-zone (galleryDiv is position:absolute
    // overlaying the zone; the banner needs to overlay TOO so it's not
    // hidden behind the 3×3 empty cells). z-index above the grid so it
    // visually reads as the primary message. galleryDiv is wiped on every
    // mountGallery wave, but the banner — its sibling — survives.
    const canvasZone = galleryDiv.parentElement;
    if (emptyBanner === null && canvasZone !== null) {
      emptyBanner = document.createElement('div');
      emptyBanner.id = 'pyr3-gallery-empty-banner';
      const icon = document.createElement('div');
      icon.className = 'pyr3-empty-icon';
      icon.textContent = '∅';
      const headline = document.createElement('div');
      headline.className = 'pyr3-empty-headline';
      headline.textContent = 'no flames match the current filter';
      const hint = document.createElement('div');
      hint.className = 'pyr3-empty-hint';
      hint.append(
        document.createTextNode('try clearing variations or widening the xform range — or hit '),
        Object.assign(document.createElement('kbd'), { textContent: '✕ reset' }),
        document.createTextNode(' above.'),
      );
      emptyBanner.append(icon, headline, hint);
      Object.assign(emptyBanner.style, {
        display: 'none',
        position: 'absolute',
        inset: '0',
        zIndex: '5',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '24px',
        textAlign: 'center',
        fontFamily: 'ui-monospace, monospace',
        color: 'var(--accent, #ff8c1a)',
        background: 'rgba(10, 10, 12, 0.85)',
        pointerEvents: 'none',
      });
      // Inject one-shot styles for the inner pieces so we get bigger
      // typography on the headline + dimmer hint + a glyph block.
      if (document.getElementById('pyr3-empty-banner-styles') === null) {
        const style = document.createElement('style');
        style.id = 'pyr3-empty-banner-styles';
        style.textContent = `
#pyr3-gallery-empty-banner .pyr3-empty-icon { font-size: 48px; line-height: 1; opacity: 0.6; }
#pyr3-gallery-empty-banner .pyr3-empty-headline { font-size: 16px; font-weight: 600; letter-spacing: 0.02em; }
#pyr3-gallery-empty-banner .pyr3-empty-hint { font-size: 12px; color: var(--text-dim, #888); max-width: 36em; }
#pyr3-gallery-empty-banner kbd { background: var(--bar-bg-1, #15151a); border: 1px solid var(--bar-border, #2a2a30); padding: 1px 6px; border-radius: 3px; font-family: inherit; }
`;
        document.head.appendChild(style);
      }
      canvasZone.appendChild(emptyBanner);
    } else if (emptyBanner !== null) {
      emptyBanner.style.display = 'none';
    }

    // Now load the index + compute totals + counts. ensureFeatureIndex
    // memoizes, so subsequent applyFilter calls reuse this promise.
    const index = await ensureFeatureIndex();
    const counts = computeFacetCounts(index, currentFilter);
    galleryTotalPages = totalPagesFiltered(currentFilter, GALLERY_PAGE_SIZE, { index });

    const page = clampGalleryPage(currentGalleryPage, galleryTotalPages);
    // Self-consistency: if the URL contains unrecognized filter tokens
    // (typo'd variation name, malformed xforms, etc.), the parser drops
    // them silently — but the address bar would lie about what's applied.
    // Rewrite to the canonical form so what the visitor sees IS what's
    // actually filtering. Also covers the URL-out-of-range page clamp.
    const canonical = galleryUrl(page, currentFilter);
    if (canonical !== location.pathname + location.search) {
      history.replaceState({}, '', canonical);
    }
    currentGalleryPage = page;
    setDocTitle(`gallery · p${page}`);

    galleryBar.setPage(page, galleryTotalPages);
    drawerHandle.setFacetCounts(counts);
    drawerHandle.setMatchCount(counts.total);
    drawerHandle.setLoading(false);
    if (emptyBanner !== null) {
      emptyBanner.style.display = counts.total === 0 ? 'flex' : 'none';
    }

    // QUALITY_TIERS[0] is the Draft tier (longEdge 512, spp 8) — the
    // intentional gallery cell quality per the spec.
    galleryHandle = await mountGallery(page, {
      renderer,
      device,
      format,
      container: galleryDiv,
      fetchGenome: galleryFetchGenome,
      draftTier: QUALITY_TIERS[0]!,
      index,
      initialFilter: currentFilter,
    });

    clearFirstPaintCue();
  };

  // Back/forward through history. Within a single surface (viewer or gallery)
  // we update in place; a cross-surface popstate triggers a full reload — the
  // cleanest correct path for v1 since the renderer + WebGPU state would need
  // a careful inline teardown otherwise. Cell-click cross-surface navigation
  // is also a full reload by design (anchor href, no preventDefault).
  window.addEventListener('popstate', () => {
    const i = parseLoadIntent(window.location.pathname + window.location.search);
    if (i === null) { window.location.reload(); return; }
    if (currentSurface === 'gallery' && i.kind === 'gallery') {
      // #49: cross-spec popstate (Back/Forward across a filter change) → adopt
      // the new filter + recompute totalPagesFiltered before paging the mount.
      // Same-spec / different-page popstate falls through to the page-only path.
      if (!filterSpecEquals(i.filter, currentFilter)) {
        currentFilter = i.filter;
        currentGalleryPage = i.page;
        setDocTitle(`gallery · p${i.page}`);
        void ensureFeatureIndex().then((index) => {
          galleryTotalPages = totalPagesFiltered(currentFilter, GALLERY_PAGE_SIZE, { index });
          galleryBar?.setPage(i.page, galleryTotalPages);
          void galleryHandle?.setPage(i.page, i.filter);
        });
        return;
      }
      currentGalleryPage = i.page;
      setDocTitle(`gallery · p${i.page}`);
      void galleryHandle?.setPage(i.page);
      galleryBar?.setPage(i.page, galleryTotalPages);
      return;
    }
    if (currentSurface === 'viewer' && i.kind === 'corpus') {
      void enqueueCorpus(i.gen, i.id, false);
      return;
    }
    window.location.reload();
  });

  // #8: ←/→ arrow keys browse the corpus prev/next — the same enqueueCorpus
  // path the action-bar pills drive. No-ops while a text field is focused, when
  // there's no corpus-nav context (file-opened / non-corpus flame), or — via
  // navigateCorpus's lock — while any load/render is in flight. Modifier combos
  // (e.g. ⌘← browser-back) are left to the browser.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    // Gallery mode: arrows page through the grid (same direction as the
    // ‹/› pills). navGallery handles clamping + coalesced render commit.
    if (currentSurface === 'gallery') {
      e.preventDefault();
      navGallery(currentGalleryPage + (e.key === 'ArrowLeft' ? -1 : 1));
      return;
    }
    if (!currentNav) return;
    // #38: prev/next now carry their own (gen, id) so the arrow keys cross
    // gen boundaries the same way the action-bar pills do.
    const target = e.key === 'ArrowLeft' ? currentNav.prev : currentNav.next;
    if (target === null) return;
    e.preventDefault();
    navigateCorpus(target.gen, target.id);
  });

  // Hero fallback shared by the bare-root (`default`) and the empty-/v1/viewer
  // (#203) cold-start branches. Rewrite the address bar to the canonical hero
  // corpus URL so the landing page is real, shareable and nav-wired — but keep
  // painting the BUNDLED fixture for an instant, chunk-free first paint instead
  // of routing through loadCorpus' chunk + brotli-wasm fetch (which would be
  // slower in prod and broken under `npm run dev`, PYR3-048). replaceState (not
  // push) so Back never lands on an entry that just re-forwards. SPIRAL_GALAXY
  // is the safety net if the welcome-fixture fetch fails.
  const loadHeroFallback = async (): Promise<void> => {
    history.replaceState({ gen: HERO_GEN, id: HERO_ID }, '', corpusUrl(HERO_GEN, HERO_ID));
    const heroFile = await fetchAsFile(WELCOME_FLAME_URL);
    if (heroFile) {
      await loadFromFile(heroFile);
      await updateCorpusNav(HERO_GEN, HERO_ID); // wire ‹ › (no-ops to empty if avail unavailable)
      setDocTitle(corpusTitleLabel(HERO_GEN, HERO_ID)); // #2: hero is a corpus sheep
    } else {
      console.warn('pyr3: welcome-flame fetch failed; painting SPIRAL_GALAXY default');
      bar.setMeta({ flameName: SPIRAL_GALAXY.name });
      bar.setVariations(distinctVariationNames(SPIRAL_GALAXY));
      setDocTitle(SPIRAL_GALAXY.name || null);
      await rerender();
    }
  };

  // Resolve initial load from the URL (parseLoadIntent): a /v1/gen/{gen}/id/{id}
  // corpus link (→ loadCorpus, wires nav) or default. Fallback chain is welcome
  // fixture → hardcoded SPIRAL_GALAXY (safety net if fetch fails).
  let intent = parseLoadIntent(window.location.pathname + window.location.search)
    ?? { kind: 'default' as const };
  // #199 — the deferred v1 §12 routes (gen-list / gen-browse / custom-reserved)
  // were superseded by the gallery (#39, 2026-05-30). They previously
  // silently painted the welcome flame with only a console.info — soft UX
  // cliff. Redirect to /v1/gallery (the modern equivalent) so the URL the
  // user lands on is real + shareable + nav-wired, instead of staying on a
  // dead route while a placeholder loads.
  if (
    intent.kind === 'gen-list'
    || intent.kind === 'gen-browse'
    || intent.kind === 'custom-reserved'
  ) {
    console.info(
      `pyr3: ${intent.kind} route is deferred (v1 §12, superseded by #39 gallery)`
      + ' — redirecting to /v1/gallery.',
    );
    history.replaceState(null, '', `${import.meta.env.BASE_URL}v1/gallery`);
    intent = parseLoadIntent(window.location.pathname + window.location.search)
      ?? { kind: 'default' as const };
  }
  if (intent.kind === 'gallery') {
    // Bug B (2026-06-04): persist the gallery URL we land on so a later
    // viewer→Gallery click can restore exactly this page (instead of
    // computing the page containing the just-viewed flame, which is a
    // different mental model from "back to where I was browsing").
    try {
      sessionStorage.setItem(
        'pyr3.gallery.lastUrl',
        window.location.pathname + window.location.search,
      );
    } catch { /* sessionStorage blocked — best-effort only */ }
    await mountGallerySurface(intent.page);
  } else if (intent.kind === 'corpus') {
    await enqueueCorpus(intent.gen, intent.id, false); // initial load: no pushState
  } else if (intent.kind === 'default') {
    await loadHeroFallback();
  } else if (intent.kind === 'viewer') {
    // #203 — /v1/viewer cold start: rehydrate the last-loaded custom flame from
    // the store (a refresh after 📂 Open reloads what the user was viewing). No
    // stored flame (e.g. a shared /v1/viewer link, or storage was cleared) →
    // fall back to the hero sheep, same as bare root.
    const stored = loadLastFlame();
    if (stored) {
      await applyLoadResult({ kind: 'pyr3-json', genome: stored }, stored.name || 'Untitled');
      setNav(null); // rehydrated custom flame is not a corpus sheep
      setDocTitle(activeGenome.name || null);
    } else {
      await loadHeroFallback();
    }
  } else {
    // Deferred views (gen-list / gen-browse / custom-reserved): paint the welcome
    // fixture as a placeholder, keep the URL as-is, no nav (no built gallery yet).
    const initialFile = await resolveLoadIntent(intent);
    if (initialFile) {
      await loadFromFile(initialFile);
      setNav(null); // non-corpus flame → hide nav
      setDocTitle(activeGenome.name || null); // #2
    } else {
      console.warn('pyr3: no initial load resolved; painting SPIRAL_GALAXY default');
      bar.setMeta({ flameName: SPIRAL_GALAXY.name });
      bar.setVariations(distinctVariationNames(SPIRAL_GALAXY));
      setDocTitle(SPIRAL_GALAXY.name || null);
      await rerender();
    }
  }

  console.log(
    `pyr3: ${renderer.width}×${renderer.height} (oversample ${renderer.oversample}), seed=0x${seed.toString(16).padStart(8, '0')} — click 📂 Open .flame in the bar to load a different flame.`,
  );
}

function mountWebGPUFallback(): void {
  const fallback = document.getElementById('pyr3-fallback');
  if (!fallback) return;
  document.body.classList.add('webgpu-unavailable');
  // DOM-build the explainer (createElement + textContent so no
  // innerHTML XSS surface).
  fallback.replaceChildren();
  const h2 = document.createElement('h2');
  h2.textContent = '⚠️ This browser can\'t run WebGPU';
  const p1 = document.createElement('p');
  p1.textContent = "pyr3 renders fractal flames using your GPU through the WebGPU web standard. Your current browser doesn't expose it — so there's no engine here to draw with.";
  const fixP = document.createElement('p');
  fixP.className = 'fix';
  const fixStrong = document.createElement('strong');
  fixStrong.textContent = 'Likely fix: ';
  fixP.append(fixStrong, document.createTextNode('Chrome 113+, Edge 113+, Safari 18+ on macOS Sequoia, or Firefox Nightly. Sometimes a flag toggle, sometimes a GPU-driver update.'));
  const ul = document.createElement('ul');
  for (const item of [
    'Chrome / Edge 113+ (auto-enabled)',
    'Safari 18+ on macOS Sequoia',
    'Firefox Nightly (behind dom.webgpu.enabled in about:config)',
  ]) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.append(li);
  }
  const cta = document.createElement('a');
  cta.className = 'cta';
  cta.href = `${import.meta.env.BASE_URL}help/webgpu.html#why-not-working`;
  cta.textContent = 'Read the full WebGPU help page ↗';
  fallback.append(h2, p1, ul, fixP, cta);
  fallback.hidden = false;
}

interface MissingPanel {
  show(gen: number, id: number): void;
  /** #9 — a real load failure (parse error, malformed genome, fetch error):
   *  paint a visible in-viewer panel with a "report an issue" affordance,
   *  rather than leaving the canvas unchanged with a console-only error. */
  showLoadError(label: string): void;
  hide(): void;
}

const ISSUES_URL = 'https://github.com/MattAltermatt/pyr3/issues';

/** Build the corpus missing-sheep / load-failure overlay once (PYR3-039 + #9).
 *  DOM-built (no innerHTML); covers the canvas, keeps the bars, offers escape
 *  via the nav (missing) or a report-an-issue link (load failure). */
function makeMissingPanel(): MissingPanel {
  const zone = document.getElementById('pyr3-canvas-zone');
  const root = document.createElement('div');
  root.id = 'pyr3-missing';
  root.hidden = true;
  const coord = document.createElement('div');
  coord.className = 'pyr3-missing-coord';
  const msg = document.createElement('div');
  msg.className = 'pyr3-missing-msg';
  const report = document.createElement('a');
  report.className = 'pyr3-missing-report';
  report.href = ISSUES_URL;
  report.target = '_blank';
  report.rel = 'noopener noreferrer';
  report.textContent = 'report an issue ↗';
  report.hidden = true;
  root.append(coord, msg, report);
  zone?.appendChild(root);
  return {
    show(gen, id) {
      coord.textContent = `gen ${gen} · sheep ${id}`;
      msg.textContent =
        'Electric Sheep was not found — use ‹ prev or next › to jump to a valid flame.';
      report.hidden = true; // a missing sheep isn't a bug — nav is the escape
      root.hidden = false;
    },
    showLoadError(label) {
      // Higher-level user-facing copy — the raw parser detail stays in the
      // console (logged at the call site) for debugging / issue reports.
      coord.textContent = label;
      msg.textContent = 'This flame couldn’t be loaded — it may be corrupt or in an unsupported format.';
      report.hidden = false;
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
  };
}

async function resolveLoadIntent(intent: LoadIntent): Promise<File | null> {
  switch (intent.kind) {
    case 'corpus':
      // Corpus leaves (/v1/gen/{gen}/id/{id}) are handled by loadCorpus() (wires
      // nav + the graceful missing state). main routes corpus intents directly,
      // so this is unreachable — fail loud rather than silently returning the
      // wrong (welcome) flame if that invariant is ever broken.
      throw new Error('resolveLoadIntent: corpus intents must go through loadCorpus()');
    case 'gen-list':
    case 'gen-browse':
    case 'custom-reserved':
      // #199 — these deferred routes are now redirected to /v1/gallery at
      // the top of main() before this dispatch runs. Reaching here means
      // the redirect block was bypassed (routing bug) — log loudly + paint
      // welcome as a safe fallback so the page isn't blank.
      console.error(
        `pyr3: ${intent.kind} intent reached resolveLoadIntent — `
        + '#199 gallery redirect was skipped.',
      );
      return fetchAsFile(WELCOME_FLAME_URL);
    case 'gallery':
      // Defensive guard. Gallery intents dispatch via mountGallerySurface()
      // BEFORE this function is called (see the initial-load block at the
      // bottom of main()). Reaching here means the dispatch order was broken
      // — log loudly + paint welcome as a safe fallback so the page isn't
      // blank, but treat it as a bug to fix.
      console.error(`pyr3: gallery intent reached resolveLoadIntent — dispatch order broken (page ${intent.page})`);
      return fetchAsFile(WELCOME_FLAME_URL);
    case 'edit':
    case 'catalog-entry':
    case 'variations':
      // /v1/edit (and the /v1/edit?from=catalog catalog-handoff variant) +
      // /v1/variations all dispatch via their own mount() BEFORE this function
      // is called (see the early-dispatch block at the top of main()).
      // Reaching here is a routing bug — log + paint welcome as a safe fallback
      // so the page isn't blank.
      console.error(`pyr3: ${intent.kind} intent reached resolveLoadIntent — dispatch order broken`);
      return fetchAsFile(WELCOME_FLAME_URL);
    case 'viewer':
      // #203 — /v1/viewer is dispatched directly in main()'s cold-start block
      // (rehydrate from the last-flame store, else hero fallback). Reaching here
      // means that dispatch was bypassed — log + paint welcome as a safe net.
      console.error('pyr3: viewer intent reached resolveLoadIntent — dispatch order broken');
      return fetchAsFile(WELCOME_FLAME_URL);
    case 'default':
      // Bare root is handled directly in main() (replaceState root-forward +
      // bundled fast-paint + nav). Reaching here means routing drifted — fail
      // loud rather than silently painting the placeholder without forwarding.
      throw new Error('resolveLoadIntent: default intent must go through the root-forward path in main()');
  }
}

async function fetchAsFile(path: string): Promise<File | null> {
  try {
    const resp = await fetch(path);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const filename = path.split('/').pop() ?? 'flame';
    return new File([blob], filename, { type: 'text/xml' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`pyr3: failed to fetch ${path} — ${msg}`);
    return null;
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('pyr3 init failed:', err);
  showError(`pyr3: init failed — ${msg}`);
});
