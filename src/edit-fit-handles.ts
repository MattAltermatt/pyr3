// pyr3 — compute the editor workspace view that frames an xform's gizmo
// handles (#350 decoupled view, auto-fit-to-edit).
//
// When on-canvas edit turns on, the selected xform's handles must be visible
// regardless of how tightly the flame is composed. This computes a WorkspaceView
// (pan + zoom layered on the composition camera) so the handle bounding box
// sits centered in the contained rect with margin. Pure — no DOM/GPU.

import { handleAnchors, type RawAffine } from './edit-xform-gizmo-math';
import {
  containedRect,
  IDENTITY_VIEW,
  type Camera,
  type Viewport,
  type WorkspaceView,
} from './edit-camera-projection';

/** Fraction of the contained rect (each axis) left as margin around the handle
 *  box. 0.15 → the box fills ~70% of the frame. */
const DEFAULT_MARGIN = 0.15;
const MIN_SPAN = 1e-4; // guard against a degenerate (zero-area) handle box

/** A WorkspaceView that frames `affine`'s handles within the current viewport,
 *  layered on the composition camera `cam`. Returns IDENTITY_VIEW if the handle
 *  box is degenerate (e.g. a pure-translation affine with no extent). */
export function computeFitView(
  affine: RawAffine,
  cam: Camera,
  vp: Viewport,
  marginFraction: number = DEFAULT_MARGIN,
): WorkspaceView {
  const anchors = handleAnchors(affine);
  const pts = Object.values(anchors);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return { ...IDENTITY_VIEW };
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX < MIN_SPAN && spanY < MIN_SPAN) return { ...IDENTITY_VIEW };
  const boxCx = (minX + maxX) / 2;
  const boxCy = (minY + maxY) / 2;

  const { w: cw, h: ch } = containedRect(vp);
  if (cw <= 0 || ch <= 0 || cam.scale <= 0) return { ...IDENTITY_VIEW };
  const usableW = cw * (1 - 2 * marginFraction);
  const usableH = ch * (1 - 2 * marginFraction);

  // World-per-CSS-px needed so each span fits its usable axis; take the larger
  // (more zoomed-out) so BOTH fit. Floor the spans so a thin box still zooms in.
  const wpxX = Math.max(spanX, MIN_SPAN) / usableW;
  const wpxY = Math.max(spanY, MIN_SPAN) / usableH;
  const wpxTarget = Math.max(wpxX, wpxY);

  // effectiveScale = intrinsicWidth / (worldWidthVisible); worldWidthVisible =
  // wpxTarget · cw. zoom is the multiplier on the composition scale.
  const effScaleTarget = vp.intrinsicWidth / (wpxTarget * cw);
  const zoom = effScaleTarget / cam.scale;
  if (!Number.isFinite(zoom) || zoom <= 0) return { ...IDENTITY_VIEW };

  // Center the box: composed cx/cy = boxCx/boxCy ⇒ panX = (boxCx − cam.cx)·zoom.
  return {
    zoom,
    panX: (boxCx - cam.cx) * zoom,
    panY: (boxCy - cam.cy) * zoom,
  };
}
