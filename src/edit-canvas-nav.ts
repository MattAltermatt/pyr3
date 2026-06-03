// pyr3 — /v1/edit canvas pan + zoom.
//
// Left-drag on the flame canvas pans (cx / cy). Mouse wheel zooms (scale,
// anchored on the cursor so the point under the cursor stays put).
//
// The chaos.wgsl viewport transform is:
//   dx = world_x - cx;  dy = world_y - cy
//   rx = dx cos(θ) - dy sin(θ);  ry = dx sin(θ) + dy cos(θ)
//   px = rx · scale + W/2;       py = ry · scale + H/2
// So decreasing cx shifts content RIGHT on screen, and the inverse rotation
// R(-θ) converts a screen-aligned delta back to world (cx/cy) coords.
//
// Sizing: the canvas displays at CSS dims (object-fit: contain) which differ
// from its intrinsic pixel size; we use the genome.size dims as the "true"
// reference so the conversion is invariant to live vs settled canvas state.

import { type EditState } from './edit-state';

export interface PanZoomCallbacks {
  /** Fired after every cx / cy / scale change (per pointermove / wheel tick).
   *  Hook to the lane scheduler so the renderer re-iterates at live dims. */
  onViewportChange: () => void;
}

export interface PanZoomHandle {
  destroy(): void;
}

/** Zoom factor per scroll-wheel deltaY unit. exp(-100 × 0.001) ≈ 0.905, so
 *  one typical notch (deltaY ≈ ±100) gives ~10.5% zoom — gentle, not jumpy. */
export const ZOOM_PER_DELTA_Y = 0.001;
const MIN_SCALE = 0.001;
const MAX_SCALE = 1_000_000;

export function attachPanZoom(
  canvas: HTMLCanvasElement,
  state: EditState,
  cb: PanZoomCallbacks,
): PanZoomHandle {
  let dragging = false;
  let dragStart: { px: number; py: number; cx: number; cy: number } | null = null;

  function intrinsicDims(): { w: number; h: number } {
    const size = state.genome.size;
    if (size && size.width > 0 && size.height > 0) return { w: size.width, h: size.height };
    return { w: Math.max(1, canvas.width), h: Math.max(1, canvas.height) };
  }

  /** Object-fit:contain on the canvas letterboxes the image inside the
   *  element rect. Compute the actual contained dims (CSS px). */
  function containedRect(): { w: number; h: number; padX: number; padY: number } {
    const rect = canvas.getBoundingClientRect();
    const { w: iw, h: ih } = intrinsicDims();
    const intrinsicAspect = iw / ih;
    const elementAspect = rect.width / Math.max(rect.height, 1);
    let w: number;
    let h: number;
    if (intrinsicAspect > elementAspect) {
      w = rect.width;
      h = rect.width / intrinsicAspect;
    } else {
      h = rect.height;
      w = rect.height * intrinsicAspect;
    }
    return { w, h, padX: (rect.width - w) / 2, padY: (rect.height - h) / 2 };
  }

  /** World units per CSS pixel under the current genome + canvas display. */
  function worldPerCssPx(): number {
    const { w: iw } = intrinsicDims();
    const { w: cw } = containedRect();
    if (cw <= 0) return 0;
    // World width visible = iw / genome.scale (intrinsic_px / pixels_per_world).
    // Displayed at cw CSS px → world per CSS px = (iw / scale) / cw.
    return iw / state.genome.scale / cw;
  }

  /** Inverse-rotate a screen-aligned (rotated-frame) delta back to world. */
  function rotatedToWorld(rotDx: number, rotDy: number): { x: number; y: number } {
    const rotRad = ((state.genome.rotate ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rotRad);
    const sin = Math.sin(rotRad);
    return { x: rotDx * cos + rotDy * sin, y: -rotDx * sin + rotDy * cos };
  }

  function onMouseDown(ev: MouseEvent): void {
    if (ev.button !== 0) return;
    dragging = true;
    dragStart = {
      px: ev.clientX,
      py: ev.clientY,
      cx: state.genome.cx,
      cy: state.genome.cy,
    };
    canvas.style.cursor = 'grabbing';
    ev.preventDefault();
  }

  function onMouseMove(ev: MouseEvent): void {
    if (!dragging || !dragStart) return;
    const cssDx = ev.clientX - dragStart.px;
    const cssDy = ev.clientY - dragStart.py;
    const wpx = worldPerCssPx();
    if (!Number.isFinite(wpx) || wpx === 0) return;
    const world = rotatedToWorld(cssDx * wpx, cssDy * wpx);
    // Drag-right (cssDx > 0) shifts content right on screen → cx decreases.
    state.genome.cx = dragStart.cx - world.x;
    state.genome.cy = dragStart.cy - world.y;
    cb.onViewportChange();
  }

  function endDrag(): void {
    if (!dragging) return;
    dragging = false;
    dragStart = null;
    canvas.style.cursor = 'grab';
  }

  function onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const { w, h, padX, padY } = containedRect();
    if (w <= 0 || h <= 0) return;
    // Cursor coord inside the contained region, origin top-left.
    const localX = (ev.clientX - rect.left) - padX;
    const localY = (ev.clientY - rect.top) - padY;
    // World coord under cursor BEFORE the zoom — the anchor we hold fixed.
    const wpxBefore = worldPerCssPx();
    const beforeRotDx = (localX - w / 2) * wpxBefore;
    const beforeRotDy = (localY - h / 2) * wpxBefore;
    const wBefore = rotatedToWorld(beforeRotDx, beforeRotDy);
    const anchor = { x: state.genome.cx + wBefore.x, y: state.genome.cy + wBefore.y };
    // Apply zoom.
    const factor = Math.exp(-ev.deltaY * ZOOM_PER_DELTA_Y);
    let next = state.genome.scale * factor;
    if (!Number.isFinite(next) || next < MIN_SCALE) next = MIN_SCALE;
    else if (next > MAX_SCALE) next = MAX_SCALE;
    state.genome.scale = next;
    // Re-solve cx / cy so the same cursor → the same anchor world coord.
    const wpxAfter = worldPerCssPx();
    const afterRotDx = (localX - w / 2) * wpxAfter;
    const afterRotDy = (localY - h / 2) * wpxAfter;
    const wAfter = rotatedToWorld(afterRotDx, afterRotDy);
    state.genome.cx = anchor.x - wAfter.x;
    state.genome.cy = anchor.y - wAfter.y;
    cb.onViewportChange();
  }

  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';
  canvas.addEventListener('mousedown', onMouseDown);
  // Move + up listen on window so drags survive crossing outside the canvas.
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', endDrag);
  // passive: false → we can call preventDefault to stop page-scroll.
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return {
    destroy(): void {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', endDrag);
      canvas.removeEventListener('wheel', onWheel);
      canvas.style.cursor = '';
      canvas.style.touchAction = '';
    },
  };
}
