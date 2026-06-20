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
import {
  containedRect as projContainedRect,
  worldPerCssPx as projWorldPerCssPx,
  applyViewToCamera,
  type Camera,
  type Viewport,
} from './edit-camera-projection';

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

  /** Projection inputs built fresh from live state + the canvas element. */
  function viewport(): Viewport {
    const rect = canvas.getBoundingClientRect();
    const { w: iw, h: ih } = intrinsicDims();
    return { rectWidth: rect.width, rectHeight: rect.height, intrinsicWidth: iw, intrinsicHeight: ih };
  }
  /** The composed (effective) camera the user actually sees — genome
   *  composition with the editor workspace view applied. In normal mode the
   *  view is identity so this equals the genome camera. */
  function camera(): Camera {
    const genomeCam: Camera = { cx: state.genome.cx, cy: state.genome.cy, scale: state.genome.scale, rotateDeg: state.genome.rotate ?? 0 };
    return applyViewToCamera(genomeCam, state.view);
  }

  /** Write a desired EFFECTIVE camera (what the user sees). #350 mode-gate:
   *  - edit-on-canvas OFF → mutate the genome composition (today's behavior).
   *  - edit-on-canvas ON  → solve the workspace view, leaving the saved
   *    composition (genome.cx/cy/scale) untouched (non-destructive look-around). */
  function setEffectiveCamera(cx: number, cy: number, scale: number): void {
    if (!state.gizmo.editOnCanvas) {
      state.genome.cx = cx;
      state.genome.cy = cy;
      state.genome.scale = scale;
      return;
    }
    const z = scale / state.genome.scale;
    state.view = {
      zoom: z,
      panX: (cx - state.genome.cx) * z,
      panY: (cy - state.genome.cy) * z,
    };
  }

  /** Object-fit:contain on the canvas letterboxes the image inside the
   *  element rect. Compute the actual contained dims (CSS px). */
  function containedRect(): { w: number; h: number; padX: number; padY: number } {
    return projContainedRect(viewport());
  }

  /** World units per CSS pixel under the current genome + canvas display. */
  function worldPerCssPx(): number {
    return projWorldPerCssPx(camera(), viewport());
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
    // Anchor the drag to the EFFECTIVE camera (genome in normal mode, composed
    // with the view in edit mode), so the same gesture math drives either.
    const eff = camera();
    dragStart = {
      px: ev.clientX,
      py: ev.clientY,
      cx: eff.cx,
      cy: eff.cy,
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
    // setEffectiveCamera routes this to genome or view per edit mode.
    setEffectiveCamera(dragStart.cx - world.x, dragStart.cy - world.y, camera().scale);
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
    const eff = camera();
    const anchor = { x: eff.cx + wBefore.x, y: eff.cy + wBefore.y };
    // Apply zoom to the EFFECTIVE scale.
    const factor = Math.exp(-ev.deltaY * ZOOM_PER_DELTA_Y);
    let next = eff.scale * factor;
    if (!Number.isFinite(next) || next < MIN_SCALE) next = MIN_SCALE;
    else if (next > MAX_SCALE) next = MAX_SCALE;
    // Apply the new scale first (cx/cy unchanged) so worldPerCssPx reflects it,
    // then re-solve cx/cy to hold the cursor anchor fixed.
    setEffectiveCamera(eff.cx, eff.cy, next);
    const wpxAfter = worldPerCssPx();
    const afterRotDx = (localX - w / 2) * wpxAfter;
    const afterRotDy = (localY - h / 2) * wpxAfter;
    const wAfter = rotatedToWorld(afterRotDx, afterRotDy);
    setEffectiveCamera(anchor.x - wAfter.x, anchor.y - wAfter.y, next);
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
