// pyr3 — /v1/edit UI shell: top bar + collapsible section accordion.
//
// Sections are passed in as `SectionMount` objects (one per genome subtree).
// This module owns ONLY the shell — header layout, collapsible chevrons,
// top-bar buttons. Per-section content (palette picker, xform card,
// sliders) lives in src/edit-section-*.ts modules.

import {
  persistSectionCollapse,
  type EditState,
  type SectionKey,
} from './edit-state';
import { scrubbyInput } from './edit-scrubby-input';
import { COLORS } from './ui-tokens';
import { infoIcon } from './help-text';
import { SETTLE_PRESETS } from './load-intent';

export interface SectionMount {
  key: SectionKey;
  title: string;
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

  host.appendChild(topbar);

  // ── Section accordion ─────────────────────────────────────────────────
  const sectionEls: HTMLElement[] = [];
  const sectionDisposers: Array<() => void> = [];
  for (const sec of sections) {
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
  }

  return {
    destroy(): void {
      // #300 — release section subscriptions BEFORE detaching the DOM, so a
      // rebuild (reroll/open/undo/setSize/…) can't leak settledPixels +
      // document keydown listeners across the editor's lifetime.
      for (const dispose of sectionDisposers) dispose();
      for (const el of sectionEls) el.remove();
      topbar.remove();
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

const EDIT_CSS = `
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
  grid-template-columns: 340px minmax(0, 1fr);
  gap: 8px;
  min-height: 0;
  overflow: hidden;
}
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
.pyr3-scrubby:focus { outline: none; border-color: var(--accent-border, #884a1a); }
.pyr3-scrubby-dragging { border-color: var(--accent, #ff8c1a); }
.pyr3-scrubby-textmode { cursor: text; text-align: right; }
.pyr3-edit-section {
  background: var(--bar-bg-1, #15151a);
  border: 1px solid var(--bar-border, #2a2a30);
  border-radius: 4px;
  margin-bottom: 6px;
  overflow: hidden;
}
.pyr3-edit-section-header {
  background: var(--bar-bg-2, #1a1a20);
  padding: 6px 8px;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 6px;
}
.pyr3-edit-section-header:hover { background: var(--accent-soft, rgba(255, 140, 26, 0.18)); }
.pyr3-edit-chev { color: var(--text-dim, #888); width: 10px; display: inline-block; }
.pyr3-edit-section-title { font-weight: 600; letter-spacing: 0.04em; font-size: 11px; text-transform: uppercase; }
.pyr3-edit-section-body { padding: 8px; }
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
  /* Anchored to the right edge of the left panel. The panel width is
     pinned at 340px in the editor layout; if that ever becomes dynamic,
     promote this to a CSS custom property updated from JS. */
  left: 340px;
  width: 340px;
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
`;
