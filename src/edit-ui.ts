// pyr3 — /v1/edit UI shell: top bar + collapsible section accordion.
//
// Sections are passed in as `SectionMount` objects (one per genome subtree).
// This module owns ONLY the shell — header layout, collapsible chevrons,
// top-bar buttons. Per-section content (palette picker, xform card,
// sliders) lives in src/edit-section-*.ts modules.

import {
  persistSectionCollapse,
  persistActiveLens,
  type EditState,
  type SectionKey,
  type LensKey,
  type SectionGroup,
} from './edit-state';
import { scrubbyInput } from './edit-scrubby-input';
import { COLORS } from './ui-tokens';
import { infoIcon } from './help-text';
import { SETTLE_PRESETS } from './load-intent';

export interface SectionMount {
  key: SectionKey;
  title: string;
  /** Which top-level lens this section belongs to (4-lens IA, #27). */
  lens: LensKey;
  /** Optional sub-group within a lens — renders a static DEFINE→GRADE divider
   *  above the group's first section (Color lens only, #358). */
  group?: SectionGroup;
  /** Build the section into `host`. May return a disposer (#300) — called by
   *  the EditUiHandle.destroy() before the DOM is torn down, to release
   *  cross-DOM subscriptions (state.settledPixelsListeners, document-level
   *  listeners) that removing the section's own nodes would otherwise leak. */
  build(host: HTMLElement, state: EditState, onChange: (path: string) => void): void | (() => void);
}

export interface EditUiHandle {
  destroy(): void;
  /** Update the `settle` scrubby's displayed value WITHOUT firing
   *  onSettleDelayChange — used when the bar's SETTLE ladder writes the
   *  new value, so the panel readout stays in sync without an echo loop. */
  setSettleDelayMs(ms: number): void;
}

export interface EditUiCallbacks {
  onChange: (path: string) => void;
  onReroll?: () => void;
  onOpenFile?: () => void;
  onSaveFile?: () => void;
  onRenderPng?: () => void;
  /** Initial settle-delay value (ms) — shown in the top-bar input. */
  settleDelayMs?: number;
  /** Fires whenever the user changes the settle-delay input. Host pipes
   *  the new value into the live/settle scheduler. */
  onSettleDelayChange?: (ms: number) => void;
}

/** Bucket sections by their lens, preserving order within each lens (#27). */
export function groupByLens(sections: SectionMount[]): Record<LensKey, SectionMount[]> {
  const g: Record<LensKey, SectionMount[]> = { xform: [], scene: [], color: [], output: [] };
  for (const s of sections) g[s.lens].push(s);
  return g;
}

const GROUP_HEADERS: Record<SectionGroup, { label: string; qualifier: string }> = {
  palette: { label: '🎨 Palette', qualifier: 'define what colors exist · pre-render' },
  grading: { label: '🎚️ Grading', qualifier: 'shape the rendered image · post-tonemap' },
};

function buildGroupHeader(group: SectionGroup): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pyr3-edit-group-header';
  const label = document.createElement('span');
  label.className = 'pyr3-edit-group-label';
  label.textContent = GROUP_HEADERS[group].label;
  const qual = document.createElement('span');
  qual.className = 'pyr3-edit-group-qualifier';
  qual.textContent = GROUP_HEADERS[group].qualifier;
  el.append(label, qual);
  return el;
}

export function mountEditUi(
  host: HTMLElement,
  state: EditState,
  sections: SectionMount[],
  callbacks: EditUiCallbacks,
): EditUiHandle {
  ensureEditStyles();
  host.replaceChildren();
  host.classList.add('pyr3-edit-panel');

  // The legacy editor toolbar (open/save buttons, name/nick inputs, reroll/
  // render PNG buttons) was removed in the 2026-06-04 visual overhaul — those
  // affordances now live in the top-bar's info row + action row (see
  // mountEditBar in ui-bar.ts). Only the settle-delay scrubby is preserved
  // here as a power-user knob that didn't migrate to the action row.
  const topbar = document.createElement('div');
  topbar.className = 'pyr3-edit-topbar';

  // Settle delay (ms) — the quiet-time after the last edit before the
  // full-quality render fires. Longer = the LIVE (small-canvas fast) frame
  // stays visible longer for single clicks; shorter = the settled high-
  // quality render arrives sooner. Default 200ms.
  const settleRow = document.createElement('div');
  settleRow.className = 'pyr3-edit-named';
  settleRow.append(document.createTextNode('settle '));

  // SETTLE ladder (#367) — relocated from the editor bar into this panel so
  // both settle controls live together. Quick presets; the scrubby beside it
  // still accepts any off-ladder value. Both write the same field via
  // onSettleDelayChange.
  const settleLadder = document.createElement('div');
  settleLadder.className = 'pyr3-bar-quality-group pyr3-bar-settle-group pyr3-edit-settle-ladder';
  const settleLadderBtns = new Map<number, HTMLButtonElement>();
  function highlightSettleLadder(ms: number): void {
    for (const [v, b] of settleLadderBtns) b.classList.toggle('on', v === ms);
  }

  const settleHandle = scrubbyInput({
    value: callbacks.settleDelayMs ?? 200,
    kind: 'generic',
    minStep: 5,
    min: 0,
    max: 5000,
    format: (v) => String(Math.round(v)),
    ariaLabel: 'settle delay (ms)',
    onInput: (v) => {
      const ms = Math.round(v);
      highlightSettleLadder(ms);
      callbacks.onSettleDelayChange?.(ms);
    },
  });
  settleHandle.el.classList.add('pyr3-edit-settle-input');
  settleHandle.el.style.width = '64px';
  settleHandle.el.title = 'Quiet time after your last edit before the full-quality render fires (ms). Higher = live preview stays visible longer; lower = settled render arrives sooner.';

  for (const ms of SETTLE_PRESETS) {
    const b = document.createElement('button');
    b.className = 'pyr3-bar-quality-btn pyr3-bar-settle-btn';
    b.type = 'button';
    b.textContent = String(ms);
    b.title = `wait ${ms}ms after the last edit before the full-quality render fires`;
    b.onclick = () => {
      settleHandle.setValue(ms); // reflect in the scrubby (no onInput fire)
      highlightSettleLadder(ms);
      callbacks.onSettleDelayChange?.(ms);
    };
    settleLadderBtns.set(ms, b);
    settleLadder.append(b);
  }

  settleRow.append(settleLadder, settleHandle.el, document.createTextNode(' ms'));
  // Visible `?` explainer — the "what is settle?" affordance (#348).
  settleRow.append(infoIcon('render.settle'));
  topbar.appendChild(settleRow);
  highlightSettleLadder(Math.round(callbacks.settleDelayMs ?? 200));

  // #350 — settle + lens tabs stay pinned at the top of the panel (sticky,
  // outside the scroll) so they're always reachable while sections scroll.
  const stickyHead = document.createElement('div');
  stickyHead.className = 'pyr3-edit-stickyhead';
  stickyHead.appendChild(topbar);

  // ── Lens buttons (4-lens IA, #27) ──────────────────────────────────────
  // Four hard top-level lenses. Each section declares its lens; clicking a
  // button shows that lens's sections and hides the rest (display toggle —
  // sections are built ONCE so cross-DOM subscriptions like the Scopes
  // gradedPixels listener survive a lens switch).
  const LENS_LABELS: Array<[LensKey, string]> = [
    ['xform', 'XForm'], ['scene', 'Scene'], ['color', 'Color'], ['output', 'Output'],
  ];
  const lensBar = document.createElement('div');
  lensBar.className = 'pyr3-edit-lensbar';
  const lensBtns = new Map<LensKey, HTMLButtonElement>();
  const lensWraps: Record<LensKey, HTMLElement[]> = { xform: [], scene: [], color: [], output: [] };
  function showLens(lens: LensKey): void {
    state.activeLens = lens;
    for (const [k, b] of lensBtns) b.classList.toggle('on', k === lens);
    for (const k of ['xform', 'scene', 'color', 'output'] as LensKey[]) {
      for (const w of lensWraps[k]) w.style.display = k === lens ? 'block' : 'none';
    }
    persistActiveLens(lens);
  }
  for (const [lens, label] of LENS_LABELS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pyr3-edit-lensbtn';
    b.textContent = label;
    b.dataset.lens = lens;
    b.addEventListener('click', () => showLens(lens));
    lensBtns.set(lens, b);
    lensBar.append(b);
  }
  stickyHead.appendChild(lensBar);
  host.appendChild(stickyHead);

  // ── Section accordion ─────────────────────────────────────────────────
  const sectionEls: HTMLElement[] = [];
  const sectionDisposers: Array<() => void> = [];
  const seenGroups = new Set<string>();
  for (const sec of sections) {
    // #358 — emit a static group divider before the first section of each
    // group (Color lens DEFINE→GRADE). Pushed into lensWraps so it shows/hides
    // with its lens and is removed by destroy().
    if (sec.group && !seenGroups.has(`${sec.lens}:${sec.group}`)) {
      seenGroups.add(`${sec.lens}:${sec.group}`);
      const gh = buildGroupHeader(sec.group);
      host.appendChild(gh);
      sectionEls.push(gh);
      lensWraps[sec.lens].push(gh);
    }

    const wrap = document.createElement('div');
    wrap.className = 'pyr3-edit-section';

    const header = document.createElement('div');
    header.className = 'pyr3-edit-section-header';
    const chev = document.createElement('span');
    chev.className = 'pyr3-edit-chev';
    chev.textContent = state.sectionCollapse[sec.key] ? '▶' : '▼';
    const title = document.createElement('span');
    title.className = 'pyr3-edit-section-title';
    title.textContent = sec.title;
    header.append(chev, title);

    const body = document.createElement('div');
    body.className = 'pyr3-edit-section-body';
    body.style.display = state.sectionCollapse[sec.key] ? 'none' : 'block';

    header.addEventListener('click', () => {
      const collapsed = !state.sectionCollapse[sec.key];
      state.sectionCollapse[sec.key] = collapsed;
      chev.textContent = collapsed ? '▶' : '▼';
      body.style.display = collapsed ? 'none' : 'block';
      // #103 Phase 6 Task 6.4 — persist the collapse map on every toggle so a
      // reload restores the user's open sections. Best-effort; localStorage
      // failures are swallowed inside persistSectionCollapse.
      persistSectionCollapse(state.sectionCollapse);
    });

    const disposer = sec.build(body, state, callbacks.onChange);
    if (disposer) sectionDisposers.push(disposer);
    wrap.append(header, body);
    host.appendChild(wrap);
    sectionEls.push(wrap);
    lensWraps[sec.lens].push(wrap);
  }

  // Activate the persisted lens — shows its sections, hides the rest.
  showLens(state.activeLens);

  return {
    destroy(): void {
      // #300 — release section subscriptions BEFORE detaching the DOM, so a
      // rebuild (reroll/open/undo/setSize/…) can't leak settledPixels +
      // document keydown listeners across the editor's lifetime.
      for (const dispose of sectionDisposers) dispose();
      for (const el of sectionEls) el.remove();
      stickyHead.remove(); // wraps topbar + lensBar (#350 sticky header)
    },
    setSettleDelayMs(ms: number): void {
      // setValue updates the scrubby's display + internal state but does
      // NOT fire onInput, so an external set doesn't loop back through
      // onSettleDelayChange → here → onInput.
      settleHandle.setValue(ms);
      highlightSettleLadder(Math.round(ms));
    },
  };
}

// One-time style injection. Idempotent so HMR doesn't double-inject.
function ensureEditStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('pyr3-edit-styles')) return;
  const style = document.createElement('style');
  style.id = 'pyr3-edit-styles';
  style.textContent = EDIT_CSS;
  document.head.appendChild(style);
}

export const EDIT_CSS = `
.pyr3-edit-root {
  display: grid;
  grid-template-rows: auto 1fr;
  /* #345 — pin the single implicit column to minmax(0,1fr). Without it the
     column defaults to auto and grows to the body max-content width (the 340px
     panel + the canvas intrinsic px), overflowing the viewport at narrow widths
     so the body never shrinks and the canvas crops. This is the OUTER half of
     the fix; the .pyr3-edit-body minmax(0,1fr) track is the inner half. */
  grid-template-columns: minmax(0, 1fr);
  height: 100%;
  width: 100%;
  overflow: hidden;
}
.pyr3-edit-body {
  display: grid;
  /* #345 — minmax(0, 1fr) (not bare 1fr) so the canvas track can shrink BELOW
     the canvas element's intrinsic pixel width. A plain 1fr track defaults to
     min-width:auto, which pins it to the canvas's min-content size (~1024px) and
     overflows the viewport at narrow widths → the flame gets cropped instead of
     fitting. With minmax(0,…) the track collapses and the canvas's
     object-fit:contain (below) scales the flame to fit. */
  /* #27 — panel column width is a drag-resizable per-browser pref (CSS var
     set from state.panelWidth; the resize grip in edit-mount updates it). The
     7px middle track is the grip column. */
  grid-template-columns: var(--pyr3-panel-w, 360px) 7px minmax(0, 1fr);
  gap: 0;
  min-height: 0;
  overflow: hidden;
}
.pyr3-edit-resize-grip {
  cursor: col-resize;
  background: var(--bar-border, #2a2a30);
  border-radius: 2px;
  transition: background 0.12s;
}
.pyr3-edit-resize-grip:hover { background: #3257a8; }
.pyr3-edit-render-mode-bar-host {
  /* render-mode-bar host spans the full editor width above the body row */
}
.pyr3-edit-panel {
  overflow: auto;
  background: var(--bar-bg-3, #0f0f13);
  border-right: 1px solid var(--bar-border, #2a2a30);
  padding: 8px;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 12px;
  color: var(--text, #ddd);
}
.pyr3-edit-canvas-host {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg, ${COLORS.bg.page});
  overflow: hidden;
  position: relative;
  /* #345 — pair with the minmax(0,1fr) track so this flex item can shrink below
     its canvas child's intrinsic width instead of forcing an overflow/crop. */
  min-width: 0;
}
.pyr3-edit-canvas-host canvas {
  /* width:100% + height:100% + object-fit:contain together let the canvas
     scale UP from a small intrinsic size (the live preview at e.g. 384×216)
     to fill the available area while preserving aspect, AND scale DOWN
     from a large intrinsic size (the settled render at 1920×1080) without
     overflowing. max-width:100% alone only caps; doesn't scale up. */
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.pyr3-edit-topbar {
  background: var(--bar-bg-1, #15151a);
  border: 1px solid var(--bar-border, #2a2a30);
  border-radius: 4px;
  padding: 8px;
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pyr3-edit-stickyhead {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bar-bg-3, #0f0f13);
  /* Bleed over the panel's 8px padding so scrolled sections don't peek above
     or beside the pinned header; padding restores the inner gap. */
  margin: -8px -8px 0 -8px;
  padding: 8px;
}
.pyr3-edit-lensbar {
  display: flex;
  gap: 4px;
  margin-bottom: 0;
}
.pyr3-edit-lensbtn {
  flex: 1;
  padding: 7px 2px;
  border: 1px solid var(--bar-border, #3a3a48);
  border-radius: 5px;
  background: var(--bar-bg-2, #1e1e28);
  color: var(--bar-text-dim, #aab);
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
}
.pyr3-edit-lensbtn:hover { border-color: #5a6a9a; }
.pyr3-edit-lensbtn.on {
  background: #3257a8;
  color: #fff;
  border-color: #3257a8;
}
.pyr3-edit-group-header {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 10px 4px 4px;
  margin-top: 4px;
}
.pyr3-edit-group-label {
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text, #ddd);
}
.pyr3-edit-group-qualifier {
  font-size: 10px;
  color: var(--text-dim, #888);
}
.pyr3-edit-named { display: flex; align-items: center; gap: 4px; }
.pyr3-edit-text,
.pyr3-edit-settle-input {
  background: var(--bar-bg-3, #0f0f13);
  color: var(--text, #ddd);
  border: 1px solid var(--bar-border, #2a2a30);
  border-radius: 2px;
  padding: 2px 6px;
  font: inherit;
  flex: 1 1 auto;
  min-width: 0;
}
.pyr3-edit-buttons { display: flex; flex-wrap: wrap; gap: 4px; }
.pyr3-edit-divider {
  border: 0;
  border-top: 1px solid var(--bar-border, #2a2a30);
  margin: 4px 0;
}
.pyr3-edit-btn {
  background: var(--bar-bg-2, #1a1a20);
  color: var(--text, #ddd);
  border: 1px solid var(--bar-border, #2a2a30);
  border-radius: 3px;
  padding: 3px 8px;
  font: inherit;
  cursor: pointer;
}
.pyr3-edit-btn:hover { background: var(--accent-soft, rgba(255, 140, 26, 0.18)); border-color: var(--accent-border, #884a1a); }
.pyr3-scrubby {
  display: inline-block;
  cursor: ew-resize;
  user-select: none;
  -webkit-user-select: none;
  min-width: 40px;
  text-align: right;
  white-space: nowrap;
}
/* The drag-to-edit affordance lives on .pyr3-edit-num (the boxed number field,
   #373 decision B — a 2px accent bottom-rule). This base .pyr3-scrubby rule stays
   layout-only so a non-boxed scrubby doesn't double up. */
.pyr3-scrubby:focus { outline: none; }
.pyr3-scrubby-textmode { cursor: text; text-align: right; }
/* #396 — a row's trailing help icon (label · value · help) must never be shoved
   off the panel's right edge by a wide value. Pin the icon (no shrink) and let
   the scrubby value field yield space instead. The magnitude-aware formatter
   keeps realistic values short enough to stay fully visible; this is the
   last-resort guard for pathologically large values. */
.pyr3-ctrl > [data-help-key] { flex: 0 0 auto; }
.pyr3-ctrl > .pyr3-scrubby { flex: 0 1 auto; min-width: 0; overflow: hidden; }
.pyr3-edit-section {
  background: var(--bar-bg-1, #15151a);
  border: 1px solid var(--bar-border, #2a2a30);
  border-radius: 4px;
  margin-bottom: 6px;
  overflow: hidden;
}
.pyr3-edit-section-header {
  background: #20202a;
  border-left: 3px solid var(--structure, #3257a8);
  padding: 6px 8px;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 6px;
}
.pyr3-edit-section-header:hover { background: var(--accent-soft, rgba(255, 140, 26, 0.18)); }
.pyr3-edit-chev { color: var(--text-dim, #888); width: 10px; display: inline-block; }
.pyr3-edit-section-title { color: #fff; font-weight: 600; letter-spacing: 0.04em; font-size: 11px; text-transform: uppercase; }
.pyr3-edit-section-body { padding: var(--sp, 8px); }
.pyr3-edit-xform-inactive { opacity: 0.55; }
.pyr3-edit-xform-inactive .pyr3-edit-xform-active { opacity: 1; }
.pyr3-edit-var-row.pyr3-edit-var-inactive { opacity: 0.55; }

/* ── Variation picker modal (src/edit-variation-picker.ts) ───────── */
/* Docked to the right of the left edit panel — slides out alongside the
   panel and overlays the flame canvas. Full viewport height, narrow
   width holding 3 tiles per row. No backdrop — flame stays visible to
   the right of the picker for live preview-as-you-click. */
.pyr3-var-picker {
  position: fixed;
  top: 0;
  bottom: 0;
  /* Anchored to the right edge of the resizable left panel (#27 — the panel
     width is the --pyr3-panel-w custom property; +7px for the resize grip
     column). Width tracks the panel so the picker overlays it exactly. */
  left: calc(var(--pyr3-panel-w, 360px) + 7px);
  width: var(--pyr3-panel-w, 360px);
  background: var(--bar-bg-1, #15151a);
  border-right: 1px solid var(--bar-border, #2a2a30);
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  color: var(--text, #ddd);
  font-size: 12px;
}
.pyr3-var-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--bar-border, #2a2a30);
  background: var(--bar-bg-2, #1a1a20);
}
.pyr3-var-head h2 {
  margin: 0;
  font-size: 12px;
  color: var(--text, #ddd);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.pyr3-var-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--bar-border, #2a2a30);
}
.pyr3-var-search {
  flex: 1;
  background: var(--bar-bg-3, #0f0f13);
  border: 1px solid var(--bar-border, #2a2a30);
  color: var(--text, #ddd);
  border-radius: 3px;
  padding: 4px 8px;
  font: inherit;
  font-size: 12px;
}
.pyr3-var-search::placeholder { color: var(--text-dimmer, #666); }
.pyr3-var-body {
  padding: 12px 14px;
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
}
.pyr3-var-section-label {
  color: var(--text-dim, #888);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 12px 0 6px;
}
.pyr3-var-section-label:first-child { margin-top: 0; }
.pyr3-var-grid {
  display: grid;
  /* 3 tiles per row in the docked panel — fits the 340px-wide picker
     comfortably (3 × ~96 + 2 × 6 gap + 28 padding ≈ 328). */
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.pyr3-var-tile {
  background: var(--bar-bg-2, #1a1a20);
  border: 1.5px solid var(--bar-border, #2a2a30);
  border-radius: 4px;
  padding: 5px 4px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  font: inherit;
  color: inherit;
  transition: background 0.08s, border-color 0.08s;
}
.pyr3-var-tile:hover {
  background: var(--bar-bg-3, #0f0f13);
  border-color: var(--accent-border, #884a1a);
}
.pyr3-var-tile.selected {
  border-color: var(--accent, #ff8c1a);
  background: rgba(255, 140, 26, 0.10);
}
.pyr3-var-thumb {
  width: 64px;
  height: 64px;
  background: #07070a;
  border-radius: 2px;
  image-rendering: pixelated;
  display: block;
}
.pyr3-var-name {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 10.5px;
  color: var(--text, #ddd);
  text-align: center;
}
.pyr3-var-category {
  background: var(--bar-bg-2, #1a1a20);
  border: 1px solid var(--bar-border, #2a2a30);
  border-radius: 3px;
  margin-bottom: 6px;
  overflow: hidden;
}
.pyr3-var-category > summary {
  list-style: none;
  cursor: pointer;
  padding: 6px 10px;
  color: var(--text, #ddd);
  font-size: 11px;
  background: var(--bar-bg-1, #15151a);
  user-select: none;
}
.pyr3-var-category > summary::-webkit-details-marker { display: none; }
.pyr3-var-category[open] > summary { border-bottom: 1px solid var(--bar-border, #2a2a30); }
.pyr3-var-category > .pyr3-var-grid { padding: 8px 10px; }

/* #350 Phase 2.3 — on-canvas gizmo: screen-fixed overlays chrome + overlay layer. */
.pyr3-edit-canvas-overlays { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; z-index: 5; }
.pyr3-edit-overlay-btn { font: 12px/1.2 system-ui, sans-serif; padding: 3px 7px; border-radius: 5px;
  background: rgba(20,20,24,0.72); color: #eee; border: 1px solid rgba(255,255,255,0.14); cursor: pointer; }
.pyr3-edit-overlay-btn[aria-pressed="true"] { background: #ff8c1a; color: #1a1206; border-color: #ff8c1a; }
.pyr3-edit-overlay-mode { display: flex; align-items: center; gap: 2px; font: 12px/1.2 system-ui, sans-serif;
  background: rgba(20,20,24,0.72); border: 1px solid rgba(255,255,255,0.14); border-radius: 6px; padding: 2px 4px 2px 6px; }
.pyr3-edit-overlay-mode-label { color: #aaa; margin-right: 3px; }
.pyr3-edit-overlay-seg { font: 12px/1.2 system-ui, sans-serif; padding: 2px 9px; border-radius: 4px;
  background: transparent; color: #ddd; border: 1px solid transparent; cursor: pointer; }
.pyr3-edit-overlay-seg[aria-pressed="true"] { background: #ff8c1a; color: #1a1206; font-weight: 600; }
.pyr3-edit-overlay-step { font: 11px system-ui; color: #ccc; background: rgba(20,20,24,0.72); padding: 2px 6px; border-radius: 5px; }
.pyr3-edit-overlay-step input { width: 52px; margin-left: 4px; }
.pyr3-edit-overlay-readout { font: 11px ui-monospace, monospace; color: #ffd23a; min-height: 14px;
  background: rgba(20,20,24,0.72); padding: 1px 6px; border-radius: 4px; }
.pyr3-edit-gizmo-overlay { z-index: 4; }
/* #364 — compose split control: the compose label (toggle) + caret (picker). */
.pyr3-edit-overlay-split { display: inline-flex; }
.pyr3-edit-overlay-split-main { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.pyr3-edit-overlay-split-caret { border-top-left-radius: 0; border-bottom-left-radius: 0;
  border-left-color: transparent; margin-left: -1px; padding-left: 5px; padding-right: 5px; }
/* #364 — compositional guides: above the WebGPU canvas, below the gizmo. */
.pyr3-edit-compose-overlay { z-index: 3; }
.pyr3-compose-menu { z-index: 50; background: #16181d; border: 1px solid #2a2e37;
  border-radius: 6px; padding: 8px 10px; box-shadow: 0 6px 24px rgba(0,0,0,0.5);
  font: 12px/1.3 system-ui, sans-serif; color: #ddd; min-width: 168px; }
.pyr3-compose-menu-row { display: flex; align-items: center; gap: 7px; padding: 3px 0; cursor: pointer; }
.pyr3-compose-menu-row input[type="number"] { width: 48px; margin-left: auto; }

/* ── Tier-4 action expander — shared accent-bar (docs/ui-affordance-system.md). ──
   The canonical disclosure/action bar (built by buildExpander in
   edit-primitives.ts). Orange border + tint + ▸ chevron so a fold reads as a
   pressable control, not a label. (#373 — generalizes the #358 Generate-ramp.) */
.pyr3-aff-expander { margin: var(--sp, 8px) 0 var(--sp-tight, 4px); }
.pyr3-aff-expander > summary {
  list-style: none;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 8px 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent, #ff8c1a);
  background: var(--accent-soft, rgba(255, 140, 26, 0.12));
  border: 1px solid var(--accent-border, #884a1a);
  border-radius: 5px;
}
.pyr3-aff-expander > summary::-webkit-details-marker { display: none; }
.pyr3-aff-expander > summary::after {
  content: '▸';
  color: var(--accent, #ff8c1a);
  transition: transform 0.12s ease;
}
.pyr3-aff-expander[open] > summary::after { transform: rotate(90deg); }
.pyr3-aff-expander > summary:hover {
  background: var(--accent-soft, rgba(255, 140, 26, 0.2));
  border-color: var(--accent, #ff8c1a);
}
.pyr3-aff-expander-body { padding: 6px 4px 2px; }
`;
