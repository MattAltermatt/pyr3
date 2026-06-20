// pyr3 — /editor on-canvas gradient bar overlay (#372). SEAM_EXEMPT.
//
// Mirrors edit-xform-gizmo.ts: an absolutely-positioned container layered over
// the WebGPU preview, hosting the existing mountPaletteEditor stop-bar near the
// bottom edge. The parametric controls (interpolation / transforms / delete /
// resample) render into a SEPARATE subpanel host via mountPaletteEditor's
// controlsHost option — "spatial on the canvas, parametric in the panel", the
// same split the affine gizmo uses (handles on canvas, affine numbers in panel).
//
// Unlike the gizmo (which stays pointer-events:none and lets the preview own
// mousedown), the bar IS the interaction surface here, so the overlay container
// receives pointer events on the bar itself. It sits ABOVE the gizmo's z so the
// two never fight — and the editor keeps them mutually exclusive anyway via
// state.activeCanvasOverlay (only one is ever attached).

import { mountPaletteEditor, type PaletteEditorHandle } from './palette-editor';
import { type Palette } from './palette';

export interface GradientOverlayCallbacks {
  /** Current palette to seed the bar at attach time. */
  getPalette: () => Palette;
  /** Fired on every live edit (drag / add / delete / recolor) — the editor host
   *  writes it to the genome and runs a slow-lane re-iterate. */
  onChange: (p: Palette) => void;
  /** Subpanel host for the parametric controls region. */
  controlsHost: HTMLElement;
  /** Selected-stop index changed (or -1 cleared) — drives the subpanel readout. */
  onSelect: (idx: number) => void;
  /** #269 — bar hover reports the continuous position t ∈ [0,1] (or null on
   *  leave); point-to-paint tints the flame regions at that gradient index. */
  onHoverT: (t: number | null) => void;
}

export interface GradientOverlayHandle {
  /** Push a new palette into the bar (e.g. after undo/redo or a picker swap). */
  setPalette(p: Palette): void;
  /** Select a stop programmatically (point-to-paint maps a flame click here). */
  selectStop(idx: number): void;
  /** Point-to-paint flame→bar spotlight (HINT_BINS histogram, or null to clear). */
  showHint(hist: Float32Array | null): void;
  destroy(): void;
}

export function attachGradientOverlay(
  host: HTMLElement,
  cb: GradientOverlayCallbacks,
): GradientOverlayHandle {
  const wrap = document.createElement('div');
  wrap.className = 'pyr3-edit-gradient-overlay';
  Object.assign(wrap.style, {
    position: 'absolute',
    left: '11%', right: '11%', bottom: '20px',
    zIndex: '6',
    filter: 'drop-shadow(0 2px 10px rgba(0,0,0,0.6))',
  });
  host.appendChild(wrap);

  const editor: PaletteEditorHandle = mountPaletteEditor(wrap, {
    initial: cb.getPalette(),
    onChange: cb.onChange,
    controlsHost: cb.controlsHost,
    onSelect: cb.onSelect,
    onHoverT: cb.onHoverT,
  });

  return {
    setPalette(p: Palette): void { editor.setPalette(p); },
    selectStop(idx: number): void { editor.selectStop(idx); },
    showHint(hist: Float32Array | null): void { editor.showHint(hist); },
    destroy(): void { editor.destroy(); wrap.remove(); },
  };
}
