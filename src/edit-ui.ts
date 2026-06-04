// pyr3 — /v1/edit UI shell: top bar + collapsible section accordion.
//
// Sections are passed in as `SectionMount` objects (one per genome subtree).
// This module owns ONLY the shell — header layout, collapsible chevrons,
// top-bar buttons. Per-section content (palette picker, xform card,
// sliders) lives in src/edit-section-*.ts modules.

import { type EditState, type SectionKey } from './edit-state';

export interface SectionMount {
  key: SectionKey;
  title: string;
  build(host: HTMLElement, state: EditState, onChange: (path: string) => void): void;
}

export interface EditUiHandle {
  destroy(): void;
}

export interface EditUiCallbacks {
  onChange: (path: string) => void;
  onReroll?: () => void;
  onOpenFile?: () => void;
  onSaveFile?: () => void;
  onRenderPng?: () => void;
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

  // ── Single header card: open/save → divider → name/nick → divider →
  // reroll/render PNG. One card, three segments separated by hr dividers.
  const topbar = document.createElement('div');
  topbar.className = 'pyr3-edit-topbar';

  // Segment 1: Open + Save
  const openSaveRow = document.createElement('div');
  openSaveRow.className = 'pyr3-edit-buttons';
  openSaveRow.append(
    makeButton('📂 open', () => callbacks.onOpenFile?.()),
    makeButton('💾 save', () => callbacks.onSaveFile?.()),
  );
  topbar.appendChild(openSaveRow);

  topbar.appendChild(makeDivider());

  // Segment 2: name + nick
  const nameRow = document.createElement('div');
  nameRow.className = 'pyr3-edit-named';
  nameRow.append(document.createTextNode('name '));
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = state.genome.name;
  nameInput.className = 'pyr3-edit-text';
  nameInput.addEventListener('input', () => {
    state.genome.name = nameInput.value;
    callbacks.onChange('name');
  });
  nameRow.append(nameInput);
  topbar.appendChild(nameRow);

  const nickRow = document.createElement('div');
  nickRow.className = 'pyr3-edit-named';
  nickRow.append(document.createTextNode('nick '));
  const nickInput = document.createElement('input');
  nickInput.type = 'text';
  nickInput.value = state.genome.nick ?? '';
  nickInput.className = 'pyr3-edit-text';
  nickInput.addEventListener('input', () => {
    state.genome.nick = nickInput.value || undefined;
    callbacks.onChange('nick');
  });
  nickRow.append(nickInput);
  topbar.appendChild(nickRow);

  topbar.appendChild(makeDivider());

  // Segment 3: reroll + render PNG
  const rerollPngRow = document.createElement('div');
  rerollPngRow.className = 'pyr3-edit-buttons';
  rerollPngRow.append(
    makeButton('🎲 reroll', () => callbacks.onReroll?.()),
    makeButton('🖼️ render PNG', () => callbacks.onRenderPng?.()),
  );
  topbar.appendChild(rerollPngRow);

  host.appendChild(topbar);

  // ── Section accordion ─────────────────────────────────────────────────
  const sectionEls: HTMLElement[] = [];
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
    });

    sec.build(body, state, callbacks.onChange);
    wrap.append(header, body);
    host.appendChild(wrap);
    sectionEls.push(wrap);
  }

  return {
    destroy(): void {
      for (const el of sectionEls) el.remove();
      topbar.remove();
    },
  };
}

function makeDivider(): HTMLHRElement {
  const hr = document.createElement('hr');
  hr.className = 'pyr3-edit-divider';
  return hr;
}

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.className = 'pyr3-edit-btn';
  b.addEventListener('click', onClick);
  return b;
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
  grid-template-columns: 340px 1fr;
  gap: 8px;
  height: 100%;
  width: 100%;
  overflow: hidden;
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
  background: var(--bg, #0a0a0c);
  overflow: hidden;
  position: relative;
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
.pyr3-edit-text {
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
/* No backdrop — the flame canvas stays visible behind. Centered floating
   panel; <div> not <dialog> for happy-dom compat. */
.pyr3-var-picker {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(720px, 96vw);
  max-height: 86vh;
  background: var(--bar-bg-1, #15151a);
  border: 1px solid var(--bar-border, #2a2a30);
  border-radius: 6px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
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
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
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
