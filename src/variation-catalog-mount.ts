// #119 — Variation Catalog page mounter.
//
// Composes the sidebar (variation-catalog-sidebar) with the catalog
// column. Each variation in numeric order gets either a real section
// (if it has a VariationDoc entry) or a stub placeholder (for entries
// authored in later phases). A single shared Renderer drives whichever
// section's flame canvas is currently in the viewport.

import {
  mountSidebar,
  listVariations,
  type SidebarHandle,
} from './variation-catalog-sidebar';
import { mountSection, type SectionHandle } from './variation-catalog-section';
import { getCatalogDoc } from './variation-catalog-data';
import { buildCatalogGenome } from './variation-catalog-scaffold';
import { catalogAnchorSlug, getDisplayLabel } from './variations';
import { createRenderer, type Renderer } from './renderer';
import type { Genome } from './genome';

export interface MountOptions {
  device: GPUDevice;
  format: GPUTextureFormat;
}

export interface MountHandle {
  destroy(): void;
}

const CANVAS_DIM = 384;
// Catalog iteration budget. Conservative because some variations have
// degenerate dynamics that pound a single histogram bucket (e.g. pdj at
// all-zero params collapses to a constant) or trigger high bad-value
// retry rates (e.g. exponential / exp family growing past the f32
// bad-value threshold faster than the chaos game settles). 1M iter/frame
// was reported to freeze laptop GPUs on those sections (#119, 2026-06-06);
// 128k is plenty to converge a 384² catalog tile over a few seconds.
const WALKERS_PER_FRAME = 1024;
const ITERS_PER_WALKER = 128;

export function mountVariationCatalog(host: HTMLElement, opts: MountOptions): MountHandle {
  host.replaceChildren();
  const root = document.createElement('div');
  root.className = 'pyr3-variations-root';

  const sidebarHost = document.createElement('aside');
  sidebarHost.className = 'pyr3-cat-sidebar';
  const catalogHost = document.createElement('main');
  catalogHost.className = 'pyr3-cat-catalog';

  // Build a wrapper per variation in numeric order. Each wrapper holds
  // either a mounted SectionHandle (full content) or a stub placeholder
  // (T7/T8 fill these in).
  const sections = new Map<number, SectionHandle | null>();
  for (const row of listVariations()) {
    const wrap = document.createElement('div');
    wrap.dataset.idx = String(row.idx);
    wrap.id = catalogAnchorSlug(row.idx, row.name);
    catalogHost.append(wrap);

    const doc = getCatalogDoc(row.idx);
    if (doc) {
      const h = mountSection(wrap, doc, {
        onParamsChange: () => {
          // User interaction always wins: if THIS section's slider moved,
          // make it the active iterator immediately. Without this, a
          // visible-but-not-yet-IO-picked section's slider would only
          // update local state without re-rendering — confusing UX.
          if (!active || active.idx !== row.idx) {
            setActive(row.idx);
          } else {
            rebuildActiveGenome();
          }
        },
      });
      sections.set(row.idx, h);
    } else {
      wrap.className = 'pyr3-cat-stub';
      const name = document.createElement('div');
      name.className = 'pyr3-cat-stub-name';
      const nameLabel = document.createElement('span');
      nameLabel.textContent = row.name;
      const vnum = document.createElement('span');
      vnum.className = 'pyr3-cat-stub-vnum';
      vnum.textContent = ` · ${getDisplayLabel(row.idx)}`;
      name.append(nameLabel, vnum);
      const note = document.createElement('div');
      note.className = 'pyr3-cat-stub-note';
      note.textContent = '(content pending — full section coming in a later task)';
      wrap.append(name, note);
      sections.set(row.idx, null);
    }
  }

  root.append(sidebarHost, catalogHost);
  host.append(root);

  // ────────────────────────────────────────────────────────────
  // Live render lane
  // ────────────────────────────────────────────────────────────
  // The Renderer is canvas-agnostic — it accepts a fresh outputView per
  // present() call. We build one Renderer and aim it at whichever
  // section's canvas the IntersectionObserver picks. Section state
  // changes (slider drag) rebuild the genome and reset accumulation.

  // Lazy-init the renderer on first setActive() — keeps structural tests
  // GPU-free (the renderer pulls a real WebGPU device the moment it's
  // created, which happy-dom doesn't provide).
  let renderer: Renderer | null = null;
  function ensureRenderer(): Renderer {
    if (!renderer) {
      renderer = createRenderer(opts.device, opts.format, {
        width: CANVAS_DIM,
        height: CANVAS_DIM,
      });
    }
    return renderer;
  }

  interface ActiveSection {
    idx: number;
    canvas: HTMLCanvasElement;
    ctx: GPUCanvasContext;
    section: SectionHandle;
    genome: Genome;
    totalSamples: number;
  }
  let active: ActiveSection | null = null;
  let rafHandle: number | null = null;

  function rebuildActiveGenome(): void {
    if (!active) return;
    const state = active.section.getState();
    active.genome = buildCatalogGenome(active.idx, state.weight, state.params);
    active.totalSamples = 0;
    ensureRenderer().reset(active.genome);
  }

  function loop(): void {
    if (!active) { rafHandle = null; return; }
    const r = ensureRenderer();
    const seed = (Math.random() * 0xffffffff) >>> 0;
    r.iterate({
      genome: active.genome,
      seed,
      walkers: WALKERS_PER_FRAME,
      itersPerWalker: ITERS_PER_WALKER,
    });
    active.totalSamples += WALKERS_PER_FRAME * ITERS_PER_WALKER;
    let view: GPUTextureView;
    try {
      view = active.ctx.getCurrentTexture().createView();
    } catch (err) {
      // Canvas was destroyed / context lost — pause and wait for the
      // next setActive() to re-attach.
      console.warn('pyr3 catalog: getCurrentTexture failed, pausing', err);
      pauseActive();
      return;
    }
    r.present({ genome: active.genome, outputView: view, totalSamples: active.totalSamples });
    rafHandle = requestAnimationFrame(loop);
  }

  function pauseActive(): void {
    if (active) active.section.setIterating(false);
    active = null;
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  }

  function setActive(idx: number): void {
    if (active && active.idx === idx) return;
    const section = sections.get(idx);
    if (!section) {
      // Stub variation — no flame to render. Pause if we were running.
      pauseActive();
      return;
    }
    if (active) active.section.setIterating(false);
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    const canvas = section.getFlameCanvas();
    canvas.width = CANVAS_DIM;
    canvas.height = CANVAS_DIM;
    const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!ctx) {
      console.warn(`pyr3 catalog: V${idx} canvas has no webgpu context`);
      active = null;
      return;
    }
    ctx.configure({ device: opts.device, format: opts.format, alphaMode: 'opaque' });
    const state = section.getState();
    const genome = buildCatalogGenome(idx, state.weight, state.params);
    ensureRenderer().reset(genome);
    active = { idx, canvas, ctx, section, genome, totalSamples: 0 };
    section.setIterating(true);
    sidebar.setActive(idx);
    rafHandle = requestAnimationFrame(loop);
  }

  // Sync the URL hash to the currently-active section using replaceState
  // (NOT pushState / location.hash assignment — those flood the back-button
  // history with every scrolled-past section). The URL stays shareable and
  // matches what the user is looking at; back button still goes to the
  // page the user came from.
  function syncUrlHashTo(idx: number): void {
    const wrap = catalogHost.querySelector(`[data-idx="${idx}"]`) as HTMLElement | null;
    if (!wrap || !wrap.id) return;
    const target = `#${wrap.id}`;
    if (window.location.hash !== target) {
      window.history.replaceState(null, '', target);
    }
  }

  // IntersectionObserver picks the section closest to viewport center.
  // The catalog scroll container is the root; threshold steps make us
  // re-evaluate at multiple visibility crossings.
  const io = new IntersectionObserver(
    (entries) => {
      let best: IntersectionObserverEntry | null = null;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
      }
      if (best) {
        const idx = Number((best.target as HTMLElement).dataset.idx);
        if (Number.isFinite(idx)) {
          setActive(idx);
          syncUrlHashTo(idx);
        }
      }
    },
    {
      root: catalogHost,
      threshold: [0.25, 0.5, 0.75],
    },
  );
  for (const wrap of catalogHost.querySelectorAll<HTMLElement>('[data-idx]')) {
    io.observe(wrap);
  }

  // Sidebar wiring last (it depends on setActive existing).
  const sidebar: SidebarHandle = mountSidebar(sidebarHost, {
    onJump: (idx) => {
      const target = catalogHost.querySelector(`[data-idx="${idx}"]`) as HTMLElement | null;
      if (target) {
        // Instant jump — over 131 variations a smooth scroll is too long
        // to be useful. Matches deep-link initial load behavior.
        catalogHost.scrollTo({
          top: target.offsetTop - 16,
          behavior: 'auto',
        });
        setActive(idx);
        syncUrlHashTo(idx);
      }
    },
  });

  // ────────────────────────────────────────────────────────────
  // Keyboard navigation
  // ────────────────────────────────────────────────────────────
  // Bindings are global to the page (catalog has no other input focus
  // surface to compete with). The search input swallows arrow keys
  // naturally because they edit the text; we still handle `/` and `Esc`
  // specifically so the catalog feels like a focused-reading surface.

  const ALL_INDICES = listVariations().map((r) => r.idx);
  function jumpRelative(dir: 1 | -1): void {
    const here = active?.idx ?? ALL_INDICES[0]!;
    const cur = ALL_INDICES.indexOf(here);
    if (cur < 0) return;
    const next = ALL_INDICES[Math.max(0, Math.min(ALL_INDICES.length - 1, cur + dir))]!;
    if (next === here) return;
    const target = catalogHost.querySelector(`[data-idx="${next}"]`) as HTMLElement | null;
    if (target) catalogHost.scrollTo({ top: target.offsetTop - 16, behavior: 'auto' });
    setActive(next);
  }

  // ────────────────────────────────────────────────────────────
  // URL hash → initial section + hashchange navigation
  // ────────────────────────────────────────────────────────────
  // The browser's native anchor-scroll fires before this mount finishes
  // imperatively building the section DOM, so `#jwf10-juliaq` lands on the
  // top of the page instead of the section. Read the hash explicitly after
  // mount and after any hashchange.
  function jumpToHash(hash: string): void {
    const id = hash.replace(/^#/, '');
    if (!id) return;
    // Fragments now carry the display-label namespace (#215):
    // `#v12-julia` (flam3) · `#jwf10-juliaq` · `#p43-…`. Resolve by exact
    // section id first.
    let target = catalogHost.querySelector(`[id="${id}"]`) as HTMLElement | null;
    // Backward-compat: pre-#215 deep-links used the raw registry index
    // (`#v109-juliaq` where 109 is the array slot, now labeled JWF10). Old
    // bookmarks / external links fall through to a raw-`v<idx>` lookup so
    // they still resolve. (For flam3 idx ≤ 98 the two coincide, so this
    // only fires for the JWF/P ranges.)
    if (!target) {
      const m = id.match(/^v(\d+)(?:-|$)/);
      if (m) target = catalogHost.querySelector(`[data-idx="${Number(m[1])}"]`) as HTMLElement | null;
    }
    if (!target) return;
    const idx = Number(target.dataset.idx);
    if (!Number.isFinite(idx)) return;
    // No smooth scroll on initial deep-link — jump straight there so the
    // user lands where they expected without a janky animation.
    catalogHost.scrollTo({ top: target.offsetTop - 16, behavior: 'auto' });
    setActive(idx);
  }
  function onHashChange(): void {
    jumpToHash(window.location.hash);
  }
  window.addEventListener('hashchange', onHashChange);
  // Initial deep-link: fire after a microtask so the IntersectionObserver
  // has registered all sections (so the scroll lands cleanly).
  if (window.location.hash) {
    queueMicrotask(() => jumpToHash(window.location.hash));
  }

  function onKey(e: KeyboardEvent): void {
    const focused = document.activeElement;
    const isSearchFocused = focused instanceof HTMLInputElement && focused.classList.contains('pyr3-cat-search');

    if (e.key === '/' && !isSearchFocused) {
      e.preventDefault();
      const searchEl = sidebarHost.querySelector('input.pyr3-cat-search') as HTMLInputElement | null;
      if (searchEl) {
        searchEl.focus();
        searchEl.select();
      }
      return;
    }
    if (e.key === 'Escape' && isSearchFocused) {
      e.preventDefault();
      sidebar.setSearch('');
      (focused as HTMLInputElement).blur();
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isSearchFocused) {
      e.preventDefault();
      jumpRelative(e.key === 'ArrowDown' ? 1 : -1);
    }
  }
  window.addEventListener('keydown', onKey);

  return {
    destroy(): void {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHashChange);
      pauseActive();
      io.disconnect();
      sidebar.destroy();
      sections.forEach((h) => h?.destroy());
      renderer?.destroy();
      host.replaceChildren();
    },
  };
}
