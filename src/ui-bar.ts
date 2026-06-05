// Top-bar mount + state handle.
//
// Single slim row (v1.0 polish) — three flex zones:
//   · left:   wordmark (→ home) · about · showcase · flame name · "by nick"
//   · center: Open
//   · right:  WebGPU pill · "fork it" octocat · "more flames" octocat
// Plus an optional progress detail row that mounts only during render.
//
// DOM is built with createElement + textContent (never innerHTML) so flame
// names + author nicks from untrusted .flame XML can't smuggle script. The SVG
// octocat is assembled via createElementNS for the same reason.

import { corpusUrl, galleryUrl } from './load-intent';
import { QUALITY_TIERS, type QualityRequest } from './presets';
import { composeSaveFilename } from './save-image';
import { COLORS } from './ui-tokens';
import type { WebGPUStatus } from './webgpu-check';

export interface BarMeta {
  flameName: string;
  authorNick?: string;
  /** Accepted for back-compat; not shown in the v1.0 bar. */
  sourceFilename?: string;
}

export interface BarOpts {
  webgpu: WebGPUStatus;
  onOpenFile: () => void;
  /** Render the current flame at a chosen quality (preset tier or custom dims/SPP)
   *  via the decoupled orchestrator. The default first paint stays Preview. */
  onRenderQuality: (req: QualityRequest) => void;
  /** Navigate to a corpus sheep (prev/next/nearest click in the action bar). */
  onNavigate: (gen: number, id: number) => void;
  /** Estimate a custom render's resolved dims + histogram cost + GPU-fit, given
   *  a long edge + SPP. Drives the Advanced row's live cost readout + OOM gate. */
  estimateCost: (longEdge: number, spp: number) => CostEstimate;
  /** #22: download the current canvas as PNG with the given filename hint. The
   *  bar composes the filename (flame + tier + quality) and hands it down; main
   *  owns the actual canvas.toBlob + anchor-download wiring. */
  onSave: (filename: string) => void;
  /** #23: fired when the user clicks the viewer's 🎲 pill — picks an
   *  interestingness-weighted flame from the corpus (80% from top-10%
   *  elite, 20% from the middle band, bottom 5% excluded) and navigates
   *  to it. Sibling of the gallery 🎲 (uniform across the full corpus). */
  onSurpriseMe: () => void;
  /** #103 Task 1.4: tab clicks in the chrome substrate's tab group route here.
   *  Phase 2 wires the real handler (viewer-only currentFlame transfer rule);
   *  for Phase 1 callers can stub `() => {}`. */
  onTabClick: (surface: TabSurface) => void;
}

/** Resolved cost of a custom render request. */
export interface CostEstimate {
  width: number;
  height: number;
  mb: number;
  fits: boolean;
}

/** Current render's resolved quality, shown in the info bar + used to highlight
 *  the active tier in the ladder. */
export interface QualityReadout {
  width: number;
  height: number;
  spp: number;
  tierLabel: string;
}

/** Adjacent available sheep for the action-bar corpus nav. `prev`/`next` carry
 *  full (gen, id) so the pill can cross gen boundaries at the corpus edges
 *  (#38) — e.g. `/v1/gen/0/id/1` resolves next → first sheep of the first gen.
 *  Either side is null at the genuine corpus boundary. The top-level `gen` is
 *  the anchor gen of the current load (used for context, not for prev/next). */
export interface CorpusNav {
  gen: number;
  prev: { gen: number; id: number } | null;
  next: { gen: number; id: number } | null;
}

export interface ProgressDisplay {
  label: string;
  percent: number;
  etaSeconds: number;
  samples: number;
  onCancel: () => void;
}

export interface BarHandle {
  setMeta(meta: BarMeta): void;
  // Disables the Open button during a load-in-flight.
  setBusy(busy: boolean): void;
  showProgress(p: ProgressDisplay): void;
  hideProgress(): void;
  showToast(text: string): void;
  /** Render the action-bar corpus-nav cluster (prev/next available sheep);
   *  pass null to hide it (non-corpus flame). */
  setCorpusNav(nav: CorpusNav | null): void;
  /** Update the info-bar `dims · quality · tier` readout and highlight the
   *  active tier in the ladder (tierLabel 'Custom' highlights none). */
  setQuality(q: QualityReadout): void;
  /** Show the flame's distinct variation set after the tier label (#5). Pass
   *  the full weight-ordered list; the bar truncates past a few with `+N` and
   *  exposes the complete list on hover. Pass [] to clear. */
  setVariations(names: string[]): void;
  /** Update the viewer bar's `gallery` link to point at the gallery page that
   *  contains the currently-displayed sheep. main.ts computes the contextual
   *  page via pageForCorpusIndex and calls this on each corpus load / nav. */
  setGalleryHref(page: number): void;
}

/** Options for the gallery's top bar variant. */
export interface GalleryBarOpts {
  webgpu: WebGPUStatus;
  /** Current 1-indexed page (drives the `page N of M` label + the prev/next
   *  enabled-at-bounds state). */
  page: number;
  /** Total pages in the corpus walk; 0 means "unknown" — the label shows just
   *  `page N` and next stays enabled. */
  totalPages: number;
  onPrevPage(): void;
  onNextPage(): void;
  /** Fired when the user clicks the 🎲 pill — picks a random page within
   *  the gallery and navigates to it (gallery-internal browse jump). The
   *  symmetric viewer-side dice (#23) is a different surface that draws
   *  from the curated showcase. */
  onRandomPage(): void;
  /** Initial active-axis count for the filter pill's badge (#49). Hidden
   *  when 0. Update at runtime via setActiveAxes() on the handle. */
  activeAxes: number;
  /** Fired when the user clicks the [⚙ filters ▾] pill. main.ts forwards
   *  to the drawer's toggleOpen(). */
  onFilterToggle(): void;
  /** #103 Task 1.4: tab clicks in the chrome substrate's tab group route here. */
  onTabClick: (surface: TabSurface) => void;
}

export interface GalleryBarHandle {
  /** Update the visible page + bounds. totalPages omitted preserves the prior
   *  value (lets a late corpus-size resolve update only the count). */
  setPage(page: number, totalPages?: number): void;
  /** Update the filter pill's badge count (hidden when 0). */
  setActiveAxes(n: number): void;
  /** Remove every DOM node this bar mounted on `root`. main.ts calls this when
   *  swapping back to the viewer bar so the chrome doesn't double-mount. */
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
// "hot base" brand mark (PYR3-044): double-arm vortex flame, amber→crimson
// gradient, black attractor heart. Shipped as a data-URI <img> so it stays
// isolated (no gradient-id collisions) and the bar keeps its no-innerHTML
// invariant. Identical artwork to the favicon in index.html.
const FLAME_MARK_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0' stop-color='%23ffbe3e'/%3E%3Cstop offset='1' stop-color='%23bf2408'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M16 2c4 7 8 9.5 6.5 17C21.4 25.8 11 26.5 9.6 19 8.5 13 13 10 16 2Z' fill='url(%23g)'/%3E%3Cpath d='M16 9.5c3.4 0 4 4 .8 5.2 M16 22c-3.4 0-4-4-.8-5.2' fill='none' stroke='%230a0a0c' stroke-width='2.3' stroke-linecap='round'/%3E%3C/svg%3E";
// Canonical GitHub octocat mark.
const OCTOCAT_PATH =
  'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z';

let stylesInjected = false;

/** Edit-mode bar (#102): a slim variant of the viewer's chrome row used by
 *  `/v1/edit`. Same wordmark / version / nav links / WebGPU pill / octocat
 *  CTAs, with an EDITABLE flame-name input and a live dimensions readout in
 *  place of the viewer's static meta. No quality ladder / Open / Save row —
 *  those affordances live in the editor's left panel. */
export interface EditBarOpts {
  webgpu: WebGPUStatus;
  /** Fires when the user edits the flame-name input. */
  onNameChange: (name: string) => void;
  /** Fires when the user edits the nick input. Empty string → clear. */
  onNickChange: (nick: string) => void;
  /** #103 Task 1.4: tab clicks in the chrome substrate's tab group route here. */
  onTabClick: (surface: TabSurface) => void;
}

export interface EditBarHandle {
  /** Update the flame name + nick display (after open / reroll). */
  setMeta(meta: BarMeta): void;
  /** Update the dimensions readout (after Render-section edits or open). Pass
   *  null for "auto" (no explicit size; saved at preview dims). */
  setDimensions(dims: { width: number; height: number } | null): void;
  /** Show the rendering-in-flight tier3 panel under the bar. Mirrors the
   *  viewer's mountBar showProgress; same DOM + CSS classes. The editor's
   *  render is single-dispatch (no incremental progress), so callers pass
   *  percent=1.0 + a label like "rendering 1920×1080 · q50". */
  showProgress(label: string): void;
  hideProgress(): void;
  destroy(): void;
}

export function mountEditBar(root: HTMLElement, opts: EditBarOpts): EditBarHandle {
  injectStylesOnce();
  root.replaceChildren();
  root.classList.add('pyr3-bar-root');

  // Chrome substrate (#103 Task 1.4): brand + about-link + tabs + WebGPU
  // pill + octocat CTAs. The editor's per-surface content (name/nick inputs
  // + dimensions readout) drops into chrome.middleSlot.
  const chrome = mountBarChrome(root, {
    surface: 'editor',
    webgpu: opts.webgpu,
    onTabClick: opts.onTabClick,
  });

  const infoRow = el('div', 'pyr3-bar-info');
  const infoLeft = el('div', 'pyr3-zone-left');

  // Flame name — editable text input styled to feel like the viewer's bold
  // metaName label. width:auto so it grows with the typed name.
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'pyr3-bar-name-input';
  nameInput.placeholder = 'flame name';
  nameInput.addEventListener('input', () => opts.onNameChange(nameInput.value));

  // Nick — small, after the name with "by" prefix. Always rendered; empty
  // value reads as "no nick set".
  const nickPrefix = el('span', 'pyr3-bar-meta-author');
  nickPrefix.textContent = 'by';
  const nickInput = document.createElement('input');
  nickInput.type = 'text';
  nickInput.className = 'pyr3-bar-nick-input';
  nickInput.placeholder = 'nick';
  nickInput.addEventListener('input', () => opts.onNickChange(nickInput.value));

  // Dimensions — read-only label · `1920×1080` or `auto`.
  const dimsSep = sep();
  const dims = el('span', 'pyr3-bar-quality');

  infoLeft.append(
    nameInput,
    nickPrefix, nickInput,
    dimsSep, dims,
  );

  infoRow.append(infoLeft);
  chrome.middleSlot.append(infoRow);

  // Lazy-built tier3 progress panel (same structure as mountBar's). Pinned
  // under the bar via `position: absolute; top: 100%`.
  let editTier3: Tier3 | null = null;

  return {
    setMeta(meta) {
      // Only overwrite the input if the user isn't currently focused there
      // (otherwise typing gets clobbered by a state-change echo).
      if (document.activeElement !== nameInput) {
        nameInput.value = meta.flameName || '';
      }
      if (document.activeElement !== nickInput) {
        nickInput.value = meta.authorNick ?? '';
      }
    },
    setDimensions(d) {
      dims.textContent = d ? `${d.width}×${d.height}` : 'auto';
    },
    showProgress(label) {
      if (!editTier3) {
        editTier3 = buildTier3();
        // Editor renders are single-dispatch — hide the cancel button +
        // "Why so long?" link (they're viewer-specific affordances). Hide the
        // pct text too since we don't have real progress.
        editTier3.cancel.style.display = 'none';
        editTier3.pct.style.display = 'none';
        const why = editTier3.row.querySelector('.pyr3-tier3-why') as HTMLElement | null;
        if (why) why.style.display = 'none';
        editTier3.eta.style.display = 'none';
        chrome.middleSlot.append(editTier3.row);
      }
      editTier3.label.textContent = label;
      // Full bar = "in progress" (no incremental progress available).
      editTier3.fill.style.width = '100%';
    },
    hideProgress() {
      if (editTier3) {
        editTier3.row.remove();
        editTier3 = null;
      }
    },
    destroy(): void {
      if (editTier3) {
        editTier3.row.remove();
        editTier3 = null;
      }
      chrome.destroy();
      root.classList.remove('pyr3-bar-root');
    },
  };
}

export function mountBar(root: HTMLElement, opts: BarOpts): BarHandle {
  injectStylesOnce();
  root.replaceChildren();
  root.classList.add('pyr3-bar-root');

  // Chrome substrate (#103 Task 1.4): brand + about-link + tabs + WebGPU
  // pill + octocat CTAs. The viewer's per-surface content (info row + action
  // row + Advanced custom-render row) drops into chrome.middleSlot.
  const chrome = mountBarChrome(root, {
    surface: 'viewer',
    webgpu: opts.webgpu,
    onTabClick: opts.onTabClick,
  });

  // ══ bar ① — info / identity ══
  // The chrome above carries brand / about / tabs / WebGPU; this row carries
  // the viewer-specific meta readout (flame name + quality + variations).
  const infoRow = el('div', 'pyr3-bar-info');
  const infoLeft = el('div', 'pyr3-zone-left');
  // setGalleryHref still updates an internal anchor for back-compat. The
  // chrome's gallery tab replaces the visible link, but the BarHandle
  // contract stays (Phase 2 wires real tab-nav via opts.onTabClick + the
  // currentFlame context). The link is created but kept off-DOM so the
  // setter can no-op safely without surprising callers.
  const gallery = el('a', 'pyr3-bar-about') as HTMLAnchorElement;
  gallery.href = galleryUrl(1);
  gallery.textContent = 'gallery';
  const metaName = el('div', 'pyr3-bar-meta-name');
  // Quality readout (PYR3-050): ` · {w}×{h} · q{spp} · {tier}` after the name.
  const metaQuality = el('span', 'pyr3-bar-quality');
  // #5: distinct variation set, ` · linear · julia · radial_blur`, right after
  // the tier label. Set on flame load; truncated past a few names with `+N`.
  const metaVariations = el('span', 'pyr3-bar-variations');
  // Toast rides in the info zone next to the meta name.
  const toast = el('span', 'pyr3-bar-toast');
  infoLeft.append(metaName, metaQuality, metaVariations, toast);

  infoRow.append(infoLeft);

  // ══ bar ② — actions (Open · quality ladder · corpus nav) ══
  const actionRow = el('div', 'pyr3-bar-action');
  const actionLeft = el('div', 'pyr3-zone-actleft');
  const openBtn = button('📂 Open', 'pyr3-bar-btn', opts.onOpenFile);
  // Quality ladder (PYR3-050) — replaces the standalone 🎯 4K button; 4K is its
  // top tier. Each tap requests a render at that tier's dims/SPP.
  const qLabel = el('span', 'pyr3-bar-qlabel');
  qLabel.textContent = 'quality';
  const ladder = el('div', 'pyr3-bar-ladder');
  const tierBtns = new Map<string, HTMLButtonElement>();
  for (const tier of QUALITY_TIERS) {
    const b = document.createElement('button');
    b.className = 'pyr3-tier-btn';
    b.textContent = tier.name;
    b.title = `${tier.longEdge}px long edge · q${tier.spp}`;
    b.onclick = () => opts.onRenderQuality({ kind: 'tier', tier });
    tierBtns.set(tier.name, b);
    ladder.append(b);
  }
  // Advanced ▾ — toggles the custom resolution/SPP sub-row (PYR3-050).
  const advBtn = button('Advanced ▾', 'pyr3-bar-btn', () => toggleAdvanced());
  // #22: 💾 Save — download the current canvas as PNG with a hint filename
  // (flame name + tier/custom quality). Disabled until a render lands and while
  // any render is in flight.
  const saveBtn = button('💾 Save', 'pyr3-bar-btn', () => {
    opts.onSave(composeSaveFilename(currentFlameName, currentQuality));
  });
  saveBtn.disabled = true;
  saveBtn.title = 'Download the current render as a PNG';
  actionLeft.append(openBtn, qLabel, ladder, advBtn, saveBtn);
  // #23: viewer-side 🎲 surprise-me pill. Picks a random flame from the
  // curated showcase set (sibling of the gallery dice #50, which picks from
  // the full corpus). Lives in the action row right-side cluster next to the
  // corpus-nav prev/next pills. Always present — independent of whether the
  // current flame has a corpus nav (a user-loaded file with no corpus context
  // can still dice into the showcase).
  const dicePill = el('a', 'pyr3-nav-pill pyr3-bar-viewer-dice') as HTMLAnchorElement;
  dicePill.href = '#';
  dicePill.textContent = '🎲 surprise me';
  dicePill.title = 'jump to a random interesting flame from the corpus';
  dicePill.onclick = (e) => {
    e.preventDefault();
    if (barBusy) return; // #8: no queuing dice rolls behind a render
    opts.onSurpriseMe();
  };
  // Corpus-nav cluster (filled by setCorpusNav in PYR3-041); right-aligned.
  const navSlot = el('div', 'pyr3-bar-nav');
  actionRow.append(actionLeft, dicePill, navSlot);

  // ══ bar ②b — Advanced custom resolution/SPP (PYR3-050); hidden until toggled ══
  const advRow = el('div', 'pyr3-bar-advanced');
  advRow.hidden = true;
  const advLabel = el('span', 'pyr3-bar-qlabel');
  advLabel.textContent = 'custom';
  const longEdgeInput = document.createElement('input');
  longEdgeInput.type = 'number';
  longEdgeInput.className = 'pyr3-adv-num';
  longEdgeInput.min = '64';
  longEdgeInput.max = '8192';
  longEdgeInput.step = '64';
  longEdgeInput.value = '2048';
  longEdgeInput.title = 'Long edge in px (short edge follows the flame’s aspect)';
  const leUnit = el('span', 'pyr3-adv-unit');
  leUnit.textContent = 'px long edge';
  const sppLabel = el('span', 'pyr3-bar-qlabel');
  sppLabel.textContent = 'spp';
  const sppInput = document.createElement('input');
  sppInput.type = 'range';
  sppInput.className = 'pyr3-adv-range';
  sppInput.min = '4';
  sppInput.max = '400';
  sppInput.step = '1';
  sppInput.value = '100';
  const sppVal = el('span', 'pyr3-adv-sppval');
  const costSpan = el('span', 'pyr3-adv-cost');
  const renderBtn = button('Render', 'pyr3-adv-render', () => {
    opts.onRenderQuality({ kind: 'custom', longEdge: readLongEdge(), spp: readSpp() });
  });
  advRow.append(advLabel, longEdgeInput, leUnit, sppLabel, sppInput, sppVal, costSpan, renderBtn);

  const readLongEdge = (): number => Math.max(1, Math.round(Number(longEdgeInput.value) || 0));
  const readSpp = (): number => Math.max(1, Math.round(Number(sppInput.value) || 0));
  // Render is gated by BOTH a render-in-flight (setBusy) and the cost fit, so
  // it can't interrupt an in-flight tier render or dispatch an OOM request.
  let advBusy = false;
  let lastFits = false;
  const recompute = (): void => {
    const spp = readSpp();
    sppVal.textContent = `q${spp}`;
    const est = opts.estimateCost(readLongEdge(), spp);
    costSpan.textContent = `≈ ${est.width}×${est.height} · ${est.mb.toFixed(0)} MB · ${est.fits ? '✓ fits GPU' : '✗ exceeds limit'}`;
    costSpan.classList.toggle('over', !est.fits);
    lastFits = est.fits;
    renderBtn.disabled = advBusy || !est.fits;
  };
  longEdgeInput.oninput = recompute;
  sppInput.oninput = recompute;
  let advOpen = false;
  const toggleAdvanced = (): void => {
    advOpen = !advOpen;
    advRow.hidden = !advOpen;
    advBtn.textContent = advOpen ? 'Advanced ▴' : 'Advanced ▾';
    if (advOpen) recompute();
  };

  chrome.middleSlot.append(infoRow, actionRow, advRow);

  let tier3: Tier3 | null = null;
  let toastTimeout: ReturnType<typeof setTimeout> | null = null;
  // #8: the corpus-nav pills must go inactive during any load/render so a
  // visitor can't queue a pile of navigations behind a slow (4K) render. Track
  // the live pills + busy state; setBusy and setCorpusNav both reapply it.
  let barBusy = false;
  const navPills: HTMLAnchorElement[] = [];
  const applyNavBusy = (): void => {
    for (const p of navPills) p.classList.toggle('disabled', barBusy);
    // #23: dice pill is permanent (not rebuilt per setCorpusNav), so toggle
    // its .disabled class directly here rather than via navPills.
    dicePill.classList.toggle('disabled', barBusy);
  };
  // #22: latest flame name + quality, so the Save button can compose the
  // download filename on click and gate itself on "is there something to save?".
  let currentFlameName: string | null = null;
  let currentQuality: QualityReadout | null = null;
  const refreshSave = (): void => {
    saveBtn.disabled = barBusy || currentQuality === null;
  };

  return {
    setMeta(meta) {
      renderMetaName(metaName, meta);
      currentFlameName = meta.flameName || null;
      refreshSave(); // #22
    },
    setBusy(busy) {
      advBusy = busy;
      barBusy = busy;
      openBtn.disabled = busy;
      for (const b of tierBtns.values()) b.disabled = busy;
      renderBtn.disabled = busy || !lastFits;
      applyNavBusy(); // #8: grey out + disable ‹ prev / next › while busy
      refreshSave(); // #22: no Save click mid-render
    },
    showProgress(p) {
      if (!tier3) {
        tier3 = buildTier3();
        chrome.middleSlot.append(tier3.row);
      }
      tier3.label.textContent = p.label;
      tier3.fill.style.width = `${Math.round(p.percent * 100)}%`;
      tier3.pct.textContent = `${Math.round(p.percent * 100)}%`;
      tier3.eta.textContent = `~${Math.max(0, Math.round(p.etaSeconds))}s left · ${formatSamples(p.samples)}`;
      tier3.cancel.onclick = p.onCancel;
    },
    hideProgress() {
      if (tier3) {
        tier3.row.remove();
        tier3 = null;
      }
    },
    showToast(text) {
      toast.textContent = text;
      toast.classList.add('visible');
      if (toastTimeout) clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => toast.classList.remove('visible'), 2500);
    },
    setCorpusNav(nav) {
      // Called once per navigation (not per-frame), so replaceChildren is safe
      // w.r.t. the rAF-rebuild click bug.
      navSlot.replaceChildren();
      navPills.length = 0;
      if (!nav) return;
      const pill = (gen: number, id: number, label: string): HTMLAnchorElement => {
        const a = el('a', 'pyr3-nav-pill') as HTMLAnchorElement;
        a.href = corpusUrl(gen, id);
        a.textContent = label;
        a.title = `gen ${gen} · sheep ${id}`;
        a.onclick = (e) => {
          e.preventDefault();
          if (barBusy) return; // #8: no queuing navigations behind a render
          opts.onNavigate(gen, id);
        };
        return a;
      };
      // #38: at the genuine corpus boundary (prev=null below the floor, next=
      // null above the ceiling), keep the ‹ / › pill in the row as a dimmed,
      // non-clickable placeholder. CLAUDE.md "UI must not jump under the
      // cursor": every navigation lands the same slot in the same spot.
      const inactivePill = (label: string, title: string): HTMLAnchorElement => {
        const a = el('a', 'pyr3-nav-pill disabled') as HTMLAnchorElement;
        a.textContent = label;
        a.title = title;
        return a; // intentionally no href / no onclick — pure placeholder
      };
      const fmt = (gen: number, id: number) => `${gen}.${String(id).padStart(5, '0')}`;
      // #38: prev/next pills carry their OWN (gen, id) so the cluster can cross
      // gen boundaries at corpus edges without dead-ending.
      const prevEl = nav.prev !== null
        ? pill(nav.prev.gen, nav.prev.id, `‹ ${fmt(nav.prev.gen, nav.prev.id)}`)
        : inactivePill('‹ start', 'start of corpus');
      const nextEl = nav.next !== null
        ? pill(nav.next.gen, nav.next.id, `${fmt(nav.next.gen, nav.next.id)} ›`)
        : inactivePill('end ›', 'end of corpus');
      navSlot.append(prevEl, nextEl);
      // Only ACTIVE pills track render-busy state; inactive placeholders stay
      // permanently .disabled via the class baked in at creation.
      if (nav.prev !== null) navPills.push(prevEl);
      if (nav.next !== null) navPills.push(nextEl);
      applyNavBusy(); // a nav rebuilt mid-render starts out disabled
    },
    setQuality(q) {
      metaQuality.textContent = ` · ${q.width}×${q.height} · q${q.spp} · ${q.tierLabel}`;
      for (const [name, b] of tierBtns) b.classList.toggle('on', name === q.tierLabel);
      currentQuality = q; // #22
      refreshSave();
    },
    setGalleryHref(page) {
      gallery.href = galleryUrl(page);
    },
    setVariations(names) {
      const MAX_SHOWN = 4;
      if (names.length === 0) {
        metaVariations.textContent = '';
        metaVariations.title = '';
        return;
      }
      const shown = names.slice(0, MAX_SHOWN);
      const extra = names.length - shown.length;
      metaVariations.textContent = ` · ${shown.join(' · ')}${extra > 0 ? ` · +${extra}` : ''}`;
      // Full list on hover, so truncation never hides what the flame uses.
      metaVariations.title = names.join(' · ');
    },
  };
}

// ─── mountBarChrome substrate (#103) ────────────────────────────────────────
// Phase 1 of the visual overhaul extracts the shared chrome (brand + about +
// tabs + WebGPU pill + octocat CTAs) into one DRY primitive. Per-surface mount
// fns (mountBar / mountGalleryBar / mountEditBar / future mountAboutBar) drop
// their info/action rows into chrome.middleSlot. Task 1.4 refactors the
// existing fns to consume this; for now mountBarChrome ships alongside the
// existing chrome builders without disturbing them.

/** Tabs in the top-bar's center cluster. `about` is reserved — it lives in
 *  the left cluster as a link, not a tab — so surface: 'about' renders all
 *  three real tabs in their inactive state. */
export type TabSurface = 'viewer' | 'gallery' | 'editor' | 'about';

export interface ChromeOpts {
  surface: TabSurface;
  webgpu: WebGPUStatus;
  onTabClick: (surface: TabSurface) => void;
}

export interface ChromeHandle {
  /** Drop info-row / action-row content here from per-surface mount fns. */
  middleSlot: HTMLElement;
  destroy: () => void;
}

export function mountBarChrome(root: HTMLElement, opts: ChromeOpts): ChromeHandle {
  injectStylesOnce();

  const bar = el('div', 'pyr3-topbar');

  // Left cluster: brand + about link
  const left = el('div', 'pyr3-left-cluster');
  left.append(buildBrand(), buildAboutLink());

  // Center: tab group (viewer / gallery / editor)
  const tabs = buildTabs(opts.surface, opts.onTabClick);

  // Right cluster: WebGPU pill + fork-it octocat + more-flames octocat
  const right = buildRightCluster(opts.webgpu);

  bar.append(left, tabs, right);
  root.append(bar);

  // Per-surface mount fns drop their info-row / action-row content here.
  const middleSlot = el('div', 'pyr3-middle-slot');
  root.append(middleSlot);

  return {
    middleSlot,
    destroy: () => {
      bar.remove();
      middleSlot.remove();
    },
  };
}

// ─── mountAboutBar (#103 Task 1.5) ──────────────────────────────────────────
// The /about route's top-bar variant. Reuses mountBarChrome and marks the
// existing `.pyr3-about-link` in the left cluster with `.active` so the user
// gets a clear "you are here" cue (about isn't a tab — it lives next to the
// brand). All three real tabs render in their inactive state via
// surface: 'about' on the chrome substrate.

export interface AboutBarOpts {
  webgpu: WebGPUStatus;
  /** #103 Task 1.4: tab clicks in the chrome substrate's tab group route here. */
  onTabClick: (surface: TabSurface) => void;
}

export interface AboutBarHandle {
  destroy: () => void;
}

export function mountAboutBar(root: HTMLElement, opts: AboutBarOpts): AboutBarHandle {
  injectStylesOnce();
  root.classList.add('pyr3-bar-root');

  const chrome = mountBarChrome(root, {
    surface: 'about',
    webgpu: opts.webgpu,
    onTabClick: opts.onTabClick,
  });

  // Highlight the about-link in the left cluster — the only "you are here"
  // affordance on /about, since the tab group has no `about` slot.
  root.querySelector('.pyr3-about-link')?.classList.add('active');

  return {
    destroy: () => {
      chrome.destroy();
      root.classList.remove('pyr3-bar-root');
    },
  };
}

function buildBrand(): HTMLElement {
  const wrap = el('a', 'pyr3-brand') as HTMLAnchorElement;
  wrap.href = import.meta.env.BASE_URL;
  const mark = document.createElement('img');
  mark.className = 'pyr3-brand-mark';
  mark.src = FLAME_MARK_URI;
  mark.alt = '';
  wrap.append(mark, document.createTextNode('pyr3'));
  return wrap;
}

function buildAboutLink(): HTMLElement {
  const a = el('a', 'pyr3-about-link') as HTMLAnchorElement;
  a.href = `${import.meta.env.BASE_URL}about`;
  a.textContent = 'about';
  return a;
}

function buildTabs(active: TabSurface, onClick: (s: TabSurface) => void): HTMLElement {
  const wrap = el('div', 'pyr3-tabs');
  // `about` lives in the left cluster as a link, so surface: 'about' renders
  // all three real tabs in their inactive state.
  const surfaces: Exclude<TabSurface, 'about'>[] = ['viewer', 'gallery', 'editor'];
  for (const s of surfaces) {
    const btn = el('div', 'pyr3-tab' + (s === active ? ' active' : ''));
    btn.dataset.surface = s;
    btn.textContent = s[0]!.toUpperCase() + s.slice(1);
    btn.addEventListener('click', () => onClick(s));
    wrap.append(btn);
  }
  return wrap;
}

function buildRightCluster(webgpu: WebGPUStatus): HTMLElement {
  const wrap = el('div', 'pyr3-right-cluster');
  const webgpuChip = buildWebGPUChip(webgpu);
  const forkCta = buildOctocatCta('fork it', 'pyr3 on github', 'https://github.com/MattAltermatt/pyr3');
  const sheepCta = buildOctocatCta('more flames', 'electric sheep fold', 'https://github.com/MattAltermatt/electric-sheep-fold');
  wrap.append(webgpuChip, forkCta, sheepCta);
  return wrap;
}

function buildWebGPUChip(status: WebGPUStatus): HTMLAnchorElement {
  const a = el('a', 'pyr3-bar-webgpu') as HTMLAnchorElement;
  if (status.available) {
    a.classList.add('ok');
    a.href = `${import.meta.env.BASE_URL}help/webgpu.html#what-is-webgpu`;
    a.textContent = 'WebGPU ✓';
  } else {
    a.classList.add('err');
    a.href = `${import.meta.env.BASE_URL}help/webgpu.html#why-not-working`;
    a.textContent = 'WebGPU ✗ why?';
  }
  return a;
}

function buildOctocatCta(topLabel: string, sub: string, href: string): HTMLAnchorElement {
  const a = el('a', 'pyr3-bar-cta') as HTMLAnchorElement;
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  const top = el('span', 'pyr3-cta-top');
  top.append(octocat(), document.createTextNode(topLabel));
  const arr = el('span', 'pyr3-cta-arr');
  arr.textContent = '↗';
  top.append(arr);
  const tag = el('span', 'pyr3-cta-tag');
  tag.textContent = sub;
  a.append(top, tag);
  return a;
}

function octocat(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.classList.add('pyr3-octocat');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', OCTOCAT_PATH);
  svg.appendChild(path);
  return svg;
}

interface Tier3 {
  row: HTMLElement;
  label: HTMLElement;
  fill: HTMLElement;
  pct: HTMLElement;
  eta: HTMLElement;
  cancel: HTMLButtonElement;
}

function buildTier3(): Tier3 {
  const row = el('div', 'pyr3-bar-tier3');
  const label = el('span', 'pyr3-tier3-label');
  const bar = el('div', 'pyr3-tier3-bar');
  const fill = el('div', 'pyr3-tier3-fill');
  bar.append(fill);
  const pct = el('span', 'pyr3-tier3-pct');
  const eta = el('span', 'pyr3-tier3-eta');
  const why = el('a', 'pyr3-tier3-why') as HTMLAnchorElement;
  why.href = `${import.meta.env.BASE_URL}help/ifs-and-render-cost.html`;
  why.target = '_blank';
  why.rel = 'noopener noreferrer';
  why.textContent = 'Why so long? ↗';
  const cancel = button('✕ Cancel', 'pyr3-tier3-cancel', () => {});
  row.append(label, bar, pct, eta, why, cancel);
  return { row, label, fill, pct, eta, cancel };
}

function renderMetaName(target: HTMLElement, meta: BarMeta): void {
  target.replaceChildren();
  const name = document.createElement('strong');
  name.textContent = meta.flameName || 'Untitled';
  target.append(name);
  if (meta.authorNick) {
    target.append(sep());
    const author = el('span', 'pyr3-bar-meta-author');
    author.textContent = `by ${meta.authorNick}`;
    target.append(author);
  }
}

function sep(): HTMLElement {
  const s = el('span', 'pyr3-bar-sep');
  s.textContent = '·';
  return s;
}

function el(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function button(label: string, className: string, onclick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = className;
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

function formatSamples(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M samples`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K samples`;
  return `${n} samples`;
}

/**
 * Mount the gallery's top bar (parallel to mountBar). Same three-zone chrome
 * shape as the viewer bar, but the center carries page nav (`‹ prev · page N
 * of M · next ›`) instead of the viewer's Open / quality ladder cluster.
 *
 * Kept as a separate exported function rather than a flag on mountBar — the
 * left/right helper composition is shared, but the center cluster and the
 * lifecycle (no flame meta, no quality readout, no progress row) diverge
 * enough that a parallel function reads cleaner than a sea of branching.
 */
export function mountGalleryBar(root: HTMLElement, opts: GalleryBarOpts): GalleryBarHandle {
  injectStylesOnce();
  root.replaceChildren();
  root.classList.add('pyr3-bar-root');

  // Chrome substrate (#103 Task 1.4): brand + about-link + tabs + WebGPU
  // pill + octocat CTAs. The gallery-specific page-nav cluster + filter
  // pill go into chrome.middleSlot.
  const chrome = mountBarChrome(root, {
    surface: 'gallery',
    webgpu: opts.webgpu,
    onTabClick: opts.onTabClick,
  });

  // ══ info row — left (placeholder) / center (page nav) / right (placeholder) ══
  // `pyr3-bar-info-gallery` modifier balances the left/right zones (both
  // flex: 1 1 0) so the center page-nav cluster sits in the visual middle
  // of the row.
  const infoRow = el('div', 'pyr3-bar-info pyr3-bar-info-gallery');
  const infoLeft = el('div', 'pyr3-zone-left');

  // Center zone — page nav cluster. Pinned width on the page label so prev/
  // next don't shift under the cursor as N grows (matches the corpus-nav
  // min-width discipline in the viewer bar). 🎲 dice pill rides at the
  // right end of the cluster — picks a random sheep from the full corpus
  // and opens it in a new tab (matches gallery cell-click behavior).
  const infoCenter = el('div', 'pyr3-bar-gallery-nav');
  const prevPill = el('a', 'pyr3-nav-pill') as HTMLAnchorElement;
  prevPill.textContent = '‹ prev';
  prevPill.title = 'previous page';
  const pageLabel = el('span', 'pyr3-bar-page-label');
  const nextPill = el('a', 'pyr3-nav-pill') as HTMLAnchorElement;
  nextPill.textContent = 'next ›';
  nextPill.title = 'next page';
  const dicePill = el('a', 'pyr3-nav-pill pyr3-bar-gallery-dice') as HTMLAnchorElement;
  dicePill.textContent = '🎲 random page';
  dicePill.title = 'jump to a random page in the gallery';
  // [⚙ filters ▾ (N active)] pill — wired in #49 Phase B. Click toggles the
  // filter drawer that mounts below this bar. Badge hidden when no axes
  // active; setActiveAxes() updates it at runtime.
  const filterPill = el('a', 'pyr3-nav-pill pyr3-bar-filter-pill') as HTMLAnchorElement;
  filterPill.href = '#';
  const filterPillLabel = document.createElement('span');
  filterPillLabel.textContent = '⚙ filters ▾';
  const filterPillBadge = document.createElement('span');
  filterPillBadge.className = 'pyr3-bar-filter-badge';
  filterPill.append(filterPillLabel, filterPillBadge);
  filterPill.title = 'open the gallery filter drawer';
  const renderFilterBadge = (n: number): void => {
    if (n <= 0) {
      filterPillBadge.textContent = '';
      filterPillBadge.style.display = 'none';
    } else {
      filterPillBadge.textContent = `${n} active`;
      filterPillBadge.style.display = '';
    }
  };
  renderFilterBadge(opts.activeAxes);
  filterPill.onclick = (e) => {
    e.preventDefault();
    opts.onFilterToggle();
  };
  infoCenter.append(prevPill, pageLabel, nextPill, dicePill, filterPill);

  // Right zone — placeholder. Chrome substrate carries WebGPU pill + the two
  // octocat CTAs above; this empty zone keeps the centered grid balance.
  const infoRight = el('div', 'pyr3-zone-right');

  infoRow.append(infoLeft, infoCenter, infoRight);
  chrome.middleSlot.append(infoRow);

  let currentPage = opts.page;
  let currentTotal = opts.totalPages;

  const applyBounds = (): void => {
    const atFirst = currentPage <= 1;
    const atLast = currentTotal > 0 && currentPage >= currentTotal;
    prevPill.classList.toggle('disabled', atFirst);
    nextPill.classList.toggle('disabled', atLast);
  };

  const renderLabel = (): void => {
    pageLabel.textContent = currentTotal > 0
      ? `page ${currentPage} of ${currentTotal}`
      : `page ${currentPage}`;
  };

  prevPill.onclick = (e) => {
    e.preventDefault();
    if (prevPill.classList.contains('disabled')) return;
    opts.onPrevPage();
  };
  nextPill.onclick = (e) => {
    e.preventDefault();
    if (nextPill.classList.contains('disabled')) return;
    opts.onNextPage();
  };
  dicePill.onclick = (e) => {
    e.preventDefault();
    opts.onRandomPage();
  };

  renderLabel();
  applyBounds();

  return {
    setPage(page, totalPages) {
      currentPage = page;
      if (totalPages !== undefined) currentTotal = totalPages;
      renderLabel();
      applyBounds();
    },
    setActiveAxes(n) {
      renderFilterBadge(n);
    },
    destroy() {
      chrome.destroy();
      root.classList.remove('pyr3-bar-root');
    },
  };
}

function injectStylesOnce(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = BAR_CSS;
  document.head.appendChild(style);
}

const BAR_CSS = `
.pyr3-bar-root {
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  user-select: none;
  /* #7: positioning context for the render-progress row, which overlays the
     canvas (absolute, top:100%) instead of mounting in flow — so showing/
     hiding it never changes the bar height and the canvas never reflows. */
  position: relative;
}
.pyr3-bar-info, .pyr3-bar-action {
  display: flex; align-items: center;
  padding: 8px 14px; font-size: 12px;
  border-bottom: 1px solid var(--bar-border);
}
.pyr3-bar-info { background: var(--bar-bg-2); }
.pyr3-bar-action { background: var(--bar-bg-3); padding-top: 7px; padding-bottom: 7px; }
.pyr3-zone-left { flex: 1 1 0; display: flex; align-items: center; gap: 8px; min-width: 0; }
.pyr3-zone-right { flex: 0 0 auto; display: flex; align-items: center; gap: 14px; justify-content: flex-end; }
.pyr3-zone-actleft { flex: 1 1 0; display: flex; align-items: center; gap: 8px; }
.pyr3-bar-nav { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
.pyr3-nav-pill {
  font-family: ui-monospace, monospace; font-size: 11px; white-space: nowrap;
  color: var(--accent); text-decoration: none;
  border: 1px solid var(--accent-border); background: var(--accent-soft);
  border-radius: 999px; padding: 2px 10px;
  /* #38: pin the pill width so the row doesn't reflow across corpus boundaries
     — boundary placeholder ('start' / 'end' + arrow) and active labels
     (gen.id + arrow, 10-11 chars) all occupy the same slot. */
  min-width: 10ch; text-align: center;
}
.pyr3-nav-pill:hover { background: var(--accent); color: ${COLORS.bg.page}; }
.pyr3-nav-pill.disabled { opacity: 0.4; pointer-events: none; cursor: not-allowed; }
.pyr3-bar-qlabel { font-size: 9px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.06em; }
.pyr3-bar-ladder { display: inline-flex; border: 1px solid #3a3a42; border-radius: 6px; overflow: hidden; }
.pyr3-tier-btn {
  font-size: 11px; padding: 4px 11px; font-family: inherit; cursor: pointer;
  background: #202026; color: var(--text-muted); border: 0; border-right: 1px solid #3a3a42;
}
.pyr3-tier-btn:last-child { border-right: 0; }
.pyr3-tier-btn:hover:not(:disabled):not(.on) { background: #2a2a30; color: var(--text); }
.pyr3-tier-btn.on { background: var(--accent); color: ${COLORS.bg.page}; font-weight: 600; }
.pyr3-tier-btn:disabled { color: #555; cursor: not-allowed; }
.pyr3-bar-quality { color: var(--accent); font-family: ui-monospace, monospace; font-size: 11px; white-space: nowrap; }
.pyr3-bar-gallery-nav {
  flex: 0 0 auto; display: flex; align-items: center; gap: 10px;
  margin: 0 auto; /* center between left + right flex zones */
}
.pyr3-bar-page-label {
  font-family: ui-monospace, monospace; font-size: 11px; color: var(--text);
  /* Pin a width so the prev/next pills don't reflow as N grows; "page 9999 of
     9999" is the widest reasonable label. */
  min-width: 18ch; text-align: center; white-space: nowrap;
}
.pyr3-bar-gallery-dice {
  /* Pill carries "🎲 random page" — natural width, no min-width pin
     (the .pyr3-nav-pill default of 10ch would clip the label on
     narrow viewports otherwise). */
  min-width: 0;
}
.pyr3-bar-viewer-dice {
  /* #23: viewer-side dice pill carries "🎲 surprise me". Natural width
     like the gallery dice; the 10ch default would clip the label.
     margin-right separates the dice from the prev/next corpus-nav cluster
     so the two functions read as distinct controls. */
  min-width: 0;
  margin-right: 16px;
}
.pyr3-bar-filter-pill {
  /* Pill carries "⚙ filters ▾" + optional "N active" badge. Natural
     width like the dice pill. */
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.pyr3-bar-filter-badge {
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid var(--accent-border);
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  line-height: 1.4;
  /* Hidden by inline style when activeAxes === 0; rules here apply only
     when visible. */
}
.pyr3-bar-info-gallery .pyr3-zone-left,
.pyr3-bar-info-gallery .pyr3-zone-right {
  /* Both zones flex-grow equally so the center page-nav cluster lands in
     the literal middle of the bar (the default viewer bar has zone-right
     as flex: 0 0 auto, which would push the gallery's center off to the
     right whenever left+right have unequal content widths). */
  flex: 1 1 0;
}
.pyr3-bar-info-gallery .pyr3-zone-right { justify-content: flex-end; }
.pyr3-bar-version { color: var(--text-dim); font-size: 10px; font-weight: 400; white-space: nowrap; }
/* /v1/edit bar: editable flame name. Styled to match the viewer's bold
   metaName but accepts focus + typing. Auto-sizes via field-sizing where
   supported; falls back to a fixed character width. */
.pyr3-bar-name-input {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  color: var(--text);
  font: 600 13px ui-sans-serif, system-ui, -apple-system, sans-serif;
  padding: 2px 6px;
  min-width: 12ch;
  field-sizing: content;
}
.pyr3-bar-name-input:hover { border-color: var(--bar-border); }
.pyr3-bar-name-input:focus {
  outline: none;
  background: var(--bar-bg-3);
  border-color: var(--accent-border);
}
.pyr3-bar-nick-input {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  color: var(--text-muted);
  font: 400 11px ui-sans-serif, system-ui, -apple-system, sans-serif;
  padding: 1px 5px;
  min-width: 6ch;
  field-sizing: content;
}
.pyr3-bar-nick-input:hover { border-color: var(--bar-border); }
.pyr3-bar-nick-input:focus {
  outline: none;
  background: var(--bar-bg-3);
  border-color: var(--accent-border);
  color: var(--text);
}
.pyr3-bar-variations {
  color: var(--text-muted); font-family: ui-monospace, monospace; font-size: 11px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
}

.pyr3-bar-advanced {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 14px; font-size: 11px;
  background: var(--bar-bg-3); border-bottom: 1px solid var(--bar-border);
}
.pyr3-bar-advanced[hidden] { display: none; }
.pyr3-adv-num {
  width: 72px; font-family: ui-monospace, monospace; font-size: 11px;
  background: #202026; color: var(--text); border: 1px solid #3a3a42; border-radius: 4px; padding: 3px 6px;
}
.pyr3-adv-unit { font-size: 10px; color: var(--text-dim); }
.pyr3-adv-range { width: 130px; accent-color: var(--accent); }
.pyr3-adv-sppval { font-family: ui-monospace, monospace; font-size: 11px; color: var(--accent); min-width: 36px; }
.pyr3-adv-cost { font-family: ui-monospace, monospace; font-size: 10px; color: var(--text-dim); }
.pyr3-adv-cost.over { color: var(--err); }
.pyr3-adv-render {
  font-size: 11px; padding: 4px 14px; border-radius: 4px; font-family: inherit; font-weight: 600; cursor: pointer;
  background: var(--accent); color: ${COLORS.bg.page}; border: 1px solid var(--accent);
}
.pyr3-adv-render:disabled { background: #2a2118; color: #6b5a44; border-color: #3a3a42; cursor: not-allowed; }

.pyr3-bar-wordmark {
  color: var(--accent); font-weight: 600; text-decoration: none; white-space: nowrap;
  display: inline-flex; align-items: center; gap: 5px;
}
.pyr3-bar-mark { width: 16px; height: 16px; display: block; }
.pyr3-bar-wordmark:hover { text-decoration: underline; }
.pyr3-bar-about { color: var(--text-dim); font-size: 11px; text-decoration: none; white-space: nowrap; }
.pyr3-bar-about:hover { color: var(--text-muted); text-decoration: underline; }
.pyr3-bar-sep { color: var(--text-dim); }
.pyr3-bar-meta-name { color: var(--text); user-select: text; cursor: text; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pyr3-bar-meta-author { color: var(--text-muted); }

.pyr3-bar-webgpu {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 14px; border-radius: 14px; font-size: 12px; font-weight: 500;
  text-decoration: none; white-space: nowrap;
}
.pyr3-bar-webgpu.ok { color: var(--ok); background: rgba(154,255,122,0.10); border: 1px solid rgba(154,255,122,0.5); }
.pyr3-bar-webgpu.err { color: var(--err); background: rgba(255,122,122,0.1); border: 1px solid rgba(255,122,122,0.4); }

.pyr3-bar-cta { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 1px; line-height: 1.15; text-decoration: none; }
.pyr3-cta-top { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); font-size: 12px; font-weight: 500; white-space: nowrap; }
.pyr3-octocat { width: 15px; height: 15px; fill: currentColor; }
.pyr3-cta-arr { font-size: 10px; }
.pyr3-cta-tag { color: var(--text-dim); font-size: 9px; letter-spacing: 0.02em; white-space: nowrap; }
.pyr3-bar-cta:hover .pyr3-cta-top { text-decoration: underline; }

.pyr3-bar-btn {
  font-size: 11px; padding: 4px 14px; border-radius: 3px;
  background: #222; color: var(--text); border: 1px solid #444; cursor: pointer; font-family: inherit;
}
.pyr3-bar-btn:hover:not(:disabled) { background: #2a2a30; }
.pyr3-bar-btn:disabled { background: #1a1a1f; color: #555; border-color: #2a2a30; cursor: not-allowed; }

.pyr3-bar-toast { color: var(--accent); font-size: 10px; opacity: 0; margin-left: 10px; transition: opacity 0.15s ease; }
.pyr3-bar-toast.visible { opacity: 1; }

.pyr3-bar-tier3 {
  /* #7: overlay the top edge of the canvas (pinned just under the bar) rather
     than taking flow height. The opaque background keeps the canvas from
     bleeding through; the shadow reads it as a floating layer. */
  position: absolute; top: 100%; left: 0; right: 0; z-index: 5;
  display: flex; align-items: center; gap: 12px;
  padding: 9px 14px; font-size: 11px;
  background: var(--bar-bg-3); border-bottom: 1px solid var(--bar-border);
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.45);
}
.pyr3-tier3-label { color: #ffb56e; font-weight: 500; white-space: nowrap; }
.pyr3-tier3-bar { flex: 1; height: 8px; min-width: 120px; background: #332215; border-radius: 4px; overflow: hidden; }
.pyr3-tier3-fill { height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent) 0%, #ffb56e 100%); transition: width 0.2s ease; }
.pyr3-tier3-pct { color: #ffb56e; font-weight: 500; white-space: nowrap; }
.pyr3-tier3-eta { color: var(--text-dim); font-size: 10px; white-space: nowrap; }
.pyr3-tier3-why { color: var(--text-dim); font-size: 10px; text-decoration: underline; white-space: nowrap; }
.pyr3-tier3-cancel {
  font-size: 10px; padding: 4px 11px; border-radius: 3px;
  background: #332215; color: #ffb56e; border: 1px solid var(--accent-border);
  font-weight: 500; cursor: pointer; white-space: nowrap; font-family: inherit;
}
.pyr3-tier3-cancel:hover { background: rgba(255,140,26,0.28); }
`;
