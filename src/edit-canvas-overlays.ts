// pyr3 — /editor screen-fixed canvas-chrome overlays menu (#350 Phase 2.3). SEAM_EXEMPT.
//
// Always-visible chrome pinned to the canvas (does NOT rotate with the world):
// ✏️ edit-on-canvas · ▦ grid · ☐ Snap (+ step) + a live drag readout. Each
// control writes through onChange (which persists the gizmo prefs) and the host
// redraws the gizmo. Buttons are built once; toggles mutate aria-pressed / text
// only — never replaceChildren mid-interaction (#283).

import type { GizmoPrefs } from './edit-state';

export interface CanvasOverlaysCallbacks {
  getPrefs: () => GizmoPrefs;
  onChange: (next: GizmoPrefs) => void;
  /** ⊡ fit — zoom+pan the gizmo layer to show the entire selected xform. */
  onFit?: () => void;
  /** ⊕ center — pan the gizmo layer to the selected xform at the current zoom. */
  onCenter?: () => void;
}
export interface CanvasOverlaysHandle {
  /** Set (or clear with null) the live drag readout. */
  setReadout(text: string | null): void;
  /** Re-sync button pressed-states from prefs (after external change). */
  sync(): void;
  destroy(): void;
}

export function attachCanvasOverlays(host: HTMLElement, cb: CanvasOverlaysCallbacks): CanvasOverlaysHandle {
  const root = document.createElement('div');
  root.className = 'pyr3-edit-canvas-overlays';
  root.style.position = 'absolute';
  root.style.top = '8px';
  root.style.left = '8px';

  function mkToggle(key: 'showWorldGrid' | 'snapEnabled', glyph: string, label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pyr3-edit-overlay-btn';
    btn.dataset.overlay = key === 'showWorldGrid' ? 'grid' : 'snap';
    btn.textContent = `${glyph} ${label}`;
    btn.title = label;
    btn.addEventListener('click', () => {
      const prefs = { ...cb.getPrefs(), [key]: !cb.getPrefs()[key] } as GizmoPrefs;
      cb.onChange(prefs);
      sync();
    });
    return btn;
  }

  // Segmented mode control — `modify: [ flame | xform ]`. flame = pan/zoom the
  // composition; xform = edit the selected xform's handles. Mutually exclusive,
  // so it's obvious which thing the canvas drags affect (#350).
  const modeWrap = document.createElement('div');
  modeWrap.className = 'pyr3-edit-overlay-mode';
  const modeLabel = document.createElement('span');
  modeLabel.className = 'pyr3-edit-overlay-mode-label';
  modeLabel.textContent = 'modify:';
  function mkSeg(label: string, overlay: string, editOnCanvas: boolean): HTMLButtonElement {
    const seg = document.createElement('button');
    seg.type = 'button';
    seg.className = 'pyr3-edit-overlay-seg';
    seg.dataset.overlay = overlay;
    seg.textContent = label;
    seg.addEventListener('click', () => {
      if (cb.getPrefs().editOnCanvas === editOnCanvas) return;
      cb.onChange({ ...cb.getPrefs(), editOnCanvas });
      sync();
    });
    return seg;
  }
  const flameSeg = mkSeg('flame', 'mode-flame', false);
  const xformSeg = mkSeg('xform', 'mode-xform', true);
  modeWrap.append(modeLabel, flameSeg, xformSeg);

  const gridBtn = mkToggle('showWorldGrid', '▦', 'grid');
  const snapBtn = mkToggle('snapEnabled', '☐', 'Snap');

  // Gizmo-layer navigation (never touches the flame composition):
  // ⊡ fit = zoom+pan to show the whole xform · ⊕ center = pan to it at current zoom.
  function mkAction(glyph: string, label: string, overlay: string, fn: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pyr3-edit-overlay-btn';
    btn.dataset.overlay = overlay;
    btn.textContent = `${glyph} ${label}`;
    btn.title = label;
    btn.addEventListener('click', fn);
    return btn;
  }
  const fitBtn = mkAction('⊡', 'fit', 'fit', () => cb.onFit?.());
  const centerBtn = mkAction('⊕', 'center', 'center', () => cb.onCenter?.());

  const stepWrap = document.createElement('label');
  stepWrap.className = 'pyr3-edit-overlay-step';
  stepWrap.textContent = 'step ';
  const stepInput = document.createElement('input');
  stepInput.type = 'number';
  stepInput.min = '0.001';
  stepInput.step = '0.05';
  stepInput.value = String(cb.getPrefs().snapStep);
  stepInput.addEventListener('change', () => {
    const n = Number(stepInput.value);
    if (Number.isFinite(n) && n > 0) cb.onChange({ ...cb.getPrefs(), snapStep: n });
  });
  stepWrap.appendChild(stepInput);

  const readout = document.createElement('div');
  readout.className = 'pyr3-edit-overlay-readout';
  readout.dataset.overlay = 'readout';

  root.append(modeWrap, fitBtn, centerBtn, gridBtn, snapBtn, stepWrap, readout);
  host.appendChild(root);

  function sync(): void {
    const p = cb.getPrefs();
    flameSeg.setAttribute('aria-pressed', String(!p.editOnCanvas));
    xformSeg.setAttribute('aria-pressed', String(p.editOnCanvas));
    gridBtn.setAttribute('aria-pressed', String(p.showWorldGrid));
    snapBtn.setAttribute('aria-pressed', String(p.snapEnabled));
    snapBtn.textContent = `${p.snapEnabled ? '☑' : '☐'} Snap`;
    // fit/center only act on the edit-mode gizmo layer — disable + dim when off.
    for (const b of [fitBtn, centerBtn]) {
      b.disabled = !p.editOnCanvas;
      b.style.opacity = p.editOnCanvas ? '' : '0.4';
    }
    if (document.activeElement !== stepInput) stepInput.value = String(p.snapStep);
  }
  sync();

  return {
    setReadout(text: string | null): void { readout.textContent = text ?? ''; },
    sync,
    destroy(): void { root.remove(); },
  };
}
