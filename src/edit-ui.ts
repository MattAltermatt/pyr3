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

  // ── Top bar (panel-internal): action buttons only. The editable flame
  // name + nick live in the page-level #pyr3-bar (mountEditBar in ui-bar.ts).
  const topbar = document.createElement('div');
  topbar.className = 'pyr3-edit-topbar';

  const buttonRow = document.createElement('div');
  buttonRow.className = 'pyr3-edit-buttons';
  const rerollBtn = makeButton('🎲 reroll', () => callbacks.onReroll?.());
  const openBtn = makeButton('📂 open', () => callbacks.onOpenFile?.());
  const saveBtn = makeButton('💾 save', () => callbacks.onSaveFile?.());
  const pngBtn = makeButton('🖼️ render PNG', () => callbacks.onRenderPng?.());
  buttonRow.append(rerollBtn, openBtn, saveBtn, pngBtn);
  topbar.appendChild(buttonRow);

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
}
.pyr3-edit-canvas-host canvas {
  max-width: 100%;
  max-height: 100%;
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
`;
