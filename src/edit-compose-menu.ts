// pyr3 — /editor compose popover (#364). SEAM_EXEMPT.
//
// A small popover of 5 guide checkboxes + a spokes-fold stepper, opened from the
// canvas-chrome `◈ compose ▾` button. Mounted on document.body (so a transform/
// filter ancestor can't trap the absolute box off-screen, #372) and positioned
// from the anchor's rect. Dismissed on outside mousedown-origin (#283). No
// innerHTML — built with createElement/textContent.

import type { ComposePrefs } from './edit-state';

export interface ComposeMenuCallbacks {
  getPrefs: () => ComposePrefs;
  onChange: (next: ComposePrefs) => void;
}
export interface ComposeMenuHandle {
  toggle(anchor: HTMLElement): void;
  close(): void;
  destroy(): void;
}

const GUIDES: Array<{ key: 'thirds' | 'center' | 'grid' | 'rings' | 'spokes'; label: string }> = [
  { key: 'thirds', label: 'Rule of thirds' },
  { key: 'center', label: 'Center cross' },
  { key: 'grid', label: 'Grid' },
  { key: 'rings', label: 'Concentric rings' },
  { key: 'spokes', label: 'Radial spokes' },
];

export function attachComposeMenu(cb: ComposeMenuCallbacks): ComposeMenuHandle {
  let popover: HTMLElement | null = null;

  function close(): void {
    if (popover) { popover.remove(); popover = null; document.removeEventListener('mousedown', onDocDown, true); }
  }
  // #283 — dismiss on mousedown-origin (a re-render can detach the click target mid-click).
  function onDocDown(ev: MouseEvent): void {
    if (popover && !popover.contains(ev.target as Node)) close();
  }

  function build(anchor: HTMLElement): HTMLElement {
    const p = cb.getPrefs();
    const root = document.createElement('div');
    root.className = 'pyr3-compose-menu';
    root.style.position = 'absolute';

    for (const g of GUIDES) {
      const row = document.createElement('label');
      row.className = 'pyr3-compose-menu-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.guide = g.key;
      box.checked = p[g.key];
      box.addEventListener('change', () => {
        cb.onChange({ ...cb.getPrefs(), [g.key]: box.checked });
      });
      const txt = document.createElement('span');
      txt.textContent = g.label;
      row.append(box, txt);
      root.appendChild(row);
    }

    const foldRow = document.createElement('label');
    foldRow.className = 'pyr3-compose-menu-row';
    const foldTxt = document.createElement('span');
    foldTxt.textContent = 'spokes fold';
    const fold = document.createElement('input');
    fold.type = 'number';
    fold.dataset.fold = 'true';
    fold.min = '2'; fold.max = '12'; fold.step = '1';
    fold.value = String(p.spokeFold);
    fold.addEventListener('change', () => {
      const n = Math.min(12, Math.max(2, Math.round(Number(fold.value) || 6)));
      fold.value = String(n);
      cb.onChange({ ...cb.getPrefs(), spokeFold: n });
    });
    foldRow.append(foldTxt, fold);
    root.appendChild(foldRow);

    const a = anchor.getBoundingClientRect();
    root.style.left = `${a.left + window.scrollX}px`;
    root.style.top = `${a.bottom + window.scrollY + 4}px`;
    return root;
  }

  return {
    toggle(anchor: HTMLElement): void {
      if (popover) { close(); return; }
      popover = build(anchor);
      document.body.appendChild(popover);
      document.addEventListener('mousedown', onDocDown, true);
    },
    close,
    destroy(): void { close(); },
  };
}
