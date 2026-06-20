// pyr3 — /editor shared world↔screen camera projection.
//
// Pure math extracted from edit-canvas-nav.ts so the on-canvas gizmo
// (#350 Phase 2.3) can project handle positions world→screen AND un-project
// drag deltas screen→world, sharing the exact transform pan/zoom uses.
//
// The chaos.wgsl viewport transform (see edit-canvas-nav.ts header):
//   dx = wx - cx; dy = wy - cy
//   rx = dx·cosθ − dy·sinθ;  ry = dx·sinθ + dy·cosθ
//   px = rx·scale + W/2;     py = ry·scale + H/2
// In CSS-px space we work through the *contained* (object-fit:contain) rect
// and worldPerCssPx, so the projection is invariant to live-vs-settled canvas
// pixel dims. All inputs are plain numbers — no DOM — so this is unit-testable.

export interface Camera {
  cx: number;
  cy: number;
  /** genome.scale — pixels-per-world-unit at intrinsic dims. */
  scale: number;
  /** genome.rotate, degrees. */
  rotateDeg: number;
}

export interface Viewport {
  /** canvas.getBoundingClientRect() width/height (CSS px). */
  rectWidth: number;
  rectHeight: number;
  /** genome.size dims (the "true" reference, invariant to live canvas state). */
  intrinsicWidth: number;
  intrinsicHeight: number;
}

export interface ContainedRect {
  w: number;
  h: number;
  padX: number;
  padY: number;
}

/** Editor-only workspace view: a non-destructive pan (world units) + zoom on
 *  top of the genome composition camera. NEVER serialized into the genome —
 *  it exists so on-canvas editing can frame an xform without disturbing the
 *  flame's saved composition (#350 follow-up). */
export interface WorkspaceView {
  panX: number;
  panY: number;
  /** Multiplicative zoom on top of genome.scale. 1 = no change. */
  zoom: number;
}

export const IDENTITY_VIEW: WorkspaceView = { panX: 0, panY: 0, zoom: 1 };

/** Compose an editor view onto a camera. The result is the camera the renderer
 *  + gizmo actually use while a view is active; genome fields stay untouched.
 *  Derivation: px = (wx − cx)·scale + W/2. To pan the displayed image by
 *  `panX` world-units at zoom z, shift cx by panX/z and multiply scale by z. */
export function applyViewToCamera(cam: Camera, view: WorkspaceView): Camera {
  return {
    cx: cam.cx + view.panX / view.zoom,
    cy: cam.cy + view.panY / view.zoom,
    scale: cam.scale * view.zoom,
    rotateDeg: cam.rotateDeg,
  };
}

/** object-fit:contain — the actual image rect inside the element (CSS px). */
export function containedRect(vp: Viewport): ContainedRect {
  const intrinsicAspect = vp.intrinsicWidth / Math.max(vp.intrinsicHeight, 1);
  const elementAspect = vp.rectWidth / Math.max(vp.rectHeight, 1);
  let w: number;
  let h: number;
  if (intrinsicAspect > elementAspect) {
    w = vp.rectWidth;
    h = vp.rectWidth / intrinsicAspect;
  } else {
    h = vp.rectHeight;
    w = vp.rectHeight * intrinsicAspect;
  }
  return { w, h, padX: (vp.rectWidth - w) / 2, padY: (vp.rectHeight - h) / 2 };
}

/** World units per CSS pixel under the current camera + display. */
export function worldPerCssPx(cam: Camera, vp: Viewport): number {
  const { w: cw } = containedRect(vp);
  if (cw <= 0 || cam.scale <= 0) return 0;
  return vp.intrinsicWidth / cam.scale / cw;
}

/** World point → CSS-px point relative to the element's top-left corner. */
export function worldToScreen(
  world: { x: number; y: number },
  cam: Camera,
  vp: Viewport,
): { x: number; y: number } {
  const { w, h, padX, padY } = containedRect(vp);
  const wpx = worldPerCssPx(cam, vp);
  if (wpx === 0) return { x: padX + w / 2, y: padY + h / 2 };
  const rad = (cam.rotateDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = world.x - cam.cx;
  const dy = world.y - cam.cy;
  // R(+θ) — inverse of edit-canvas-nav's rotatedToWorld (= R(−θ)).
  const rotDx = cos * dx - sin * dy;
  const rotDy = sin * dx + cos * dy;
  return {
    x: padX + w / 2 + rotDx / wpx,
    y: padY + h / 2 + rotDy / wpx,
  };
}

/** CSS-px point (element-relative) → world point. Inverse of worldToScreen. */
export function screenToWorld(
  screen: { x: number; y: number },
  cam: Camera,
  vp: Viewport,
): { x: number; y: number } {
  const { w, h, padX, padY } = containedRect(vp);
  const wpx = worldPerCssPx(cam, vp);
  if (wpx === 0) return { x: cam.cx, y: cam.cy };
  const rotDx = (screen.x - padX - w / 2) * wpx;
  const rotDy = (screen.y - padY - h / 2) * wpx;
  const rad = (cam.rotateDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // R(−θ) — matches edit-canvas-nav rotatedToWorld.
  return {
    x: cam.cx + (cos * rotDx + sin * rotDy),
    y: cam.cy + (-sin * rotDx + cos * rotDy),
  };
}
