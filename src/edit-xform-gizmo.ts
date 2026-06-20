// pyr3 — /editor on-canvas affine gizmo overlay (#350; O/X/Y triangle redesign #394/#395).
// SEAM_EXEMPT.
//
// A single 2D canvas layered over the WebGPU preview. Draws the selected xform as the
// flam3-native triangle — O (position) + the two axis tips (X, Y) — in WORLD space
// (projected through the live camera, so it tracks pan/zoom/rotate), plus a distinct
// rotation ring. One 2D canvas (no per-handle DOM) sidesteps the #283 mid-drag rebuild
// hazard.
//
// Interaction (§4.6): the mousedown listener attaches to the *preview canvas* (passed as
// `eventCanvas`) in the CAPTURE phase, so it runs before attachPanZoom's bubble-phase
// mousedown. A press ON a handle of the selected xform claims the drag (stopPropagation →
// pan never starts); a press elsewhere does nothing and pan proceeds. The overlay canvas
// stays pointer-events:none. Edits write the raw a..f matrix through onLiveEdit (slow-lane
// re-iterate); the debounced history commit rides onLiveEdit's onPathChange.
//
// Handles: O = position (drag → translate) · X/Y axis tips (drag → scale along the axis;
// hold Shift to free-move → shear) · rotate ring (drag → rigid spin about O; position +
// scale held). The rotate ring sits a FIXED screen-px length out the far side of O.

import { worldToScreen, screenToWorld, worldPerCssPx, type Camera, type Viewport } from './edit-camera-projection';
import type { GizmoPrefs } from './edit-state';
import {
  handleAnchors, hitTestHandle, isDegenerate, applyMove, applyAxisDrag, applyRotate,
  snapWorld, snapAngleDeg, applyAffine, type RawAffine, type HandleId, type Vec2,
} from './edit-xform-gizmo-math';

export interface GizmoCallbacks {
  /** The selected regular xform index, or -1 for final (gizmo inert). */
  getSelectedIndex: () => number;
  /** Live raw affine of the selected xform, or null if none. */
  getAffine: (index: number) => RawAffine | null;
  /** Commit a new raw affine for the selected xform. */
  setAffine: (index: number, r: RawAffine) => void;
  /** Camera + viewport snapshot (built from genome + canvas rect). */
  getCamera: () => Camera;
  getViewport: () => Viewport;
  /** Current gizmo prefs (editOnCanvas / grid / snap...). */
  getPrefs: () => GizmoPrefs;
  /** Fire after a live drag delta — slow-lane re-iterate (onPathChange('xforms.i')). */
  onLiveEdit: (index: number) => void;
  /** Fire once at drag end. */
  onCommit: () => void;
  /** Live readout during a drag (pos/rot/scale text), or null to clear. */
  onReadout?: (text: string | null) => void;
}

export interface GizmoHandle {
  /** Redraw the overlay (call on viewport/selection/edit change). */
  draw(): void;
  /** Resize the overlay backing canvas to match the host element rect. */
  resize(): void;
  destroy(): void;
}

const HIT_RADIUS_PX = 12;
/** Rotation ring's fixed reach from O, in CSS px (zoom-independent). Exported for tests. */
export const ROT_HANDLE_PX = 60;
const TWO_PI = Math.PI * 2;

const COL_O = '#ff8c1a';        // origin = position
const COL_X = '#ff5fa2';        // x-axis tip
const COL_Y = '#3aa1ff';        // y-axis tip
const COL_ROTATE = '#3ad17a';   // rotation ring
const COL_FOOTPRINT = 'rgba(150,150,160,0.5)';
const COL_LABEL = 'rgba(255,255,255,0.82)';
const COL_LABEL_HALO = 'rgba(0,0,0,0.75)';

// Grid (unchanged from #350).
const GRID_HALO = 'rgba(0,0,0,0.38)';
const GRID_COL = 'rgba(255,255,255,0.34)';
const GRID_AXIS_HALO = 'rgba(0,0,0,0.5)';
const GRID_AXIS = 'rgba(255,255,255,0.62)';
const GRID_LABEL = 'rgba(255,255,255,0.78)';
const GRID_LABEL_HALO = 'rgba(0,0,0,0.7)';

/** Round to a "nice" 1/2/5×10ⁿ step near `raw` — for grid label spacing. */
function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 0;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const frac = raw / base;
  const nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  return nice * base;
}

/** Compact label for a world coordinate (avoids long float tails). */
function fmtCoord(v: number, step: number): string {
  if (Math.abs(v) < step / 2) return '0';
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  return v.toFixed(decimals);
}

export function attachXformGizmo(
  host: HTMLElement,
  eventCanvas: HTMLCanvasElement,
  cb: GizmoCallbacks,
): GizmoHandle {
  const canvas = document.createElement('canvas');
  canvas.className = 'pyr3-edit-gizmo-overlay';
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.pointerEvents = 'none';
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  // grabAffine = the affine snapshot at mousedown; ALL drags compute from it (absolute,
  // not accumulated) so rotation/scale can't compound across frames.
  let active: { handle: HandleId; grabWorld: Vec2; grabAffine: RawAffine; index: number } | null = null;

  function vp(): Viewport { return cb.getViewport(); }
  function cam(): Camera { return cb.getCamera(); }
  function project(w: Vec2): Vec2 { return worldToScreen(w, cam(), vp()); }
  function unproject(s: Vec2): Vec2 { return screenToWorld(s, cam(), vp()); }
  /** Rotate-handle reach in world units = fixed CSS px × world-per-px (zoom-independent). */
  function rotLenWorld(): number { return ROT_HANDLE_PX * worldPerCssPx(cam(), vp()); }

  /** Element-relative CSS coords from a mouse event (host == overlay rect). */
  function localPt(ev: MouseEvent): Vec2 {
    const rect = host.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  // Snapping is governed by the snap pref ONLY. (Shift now means "free-move an axis →
  // introduce shear", so it no longer doubles as a snap modifier.)
  function snapping(): boolean { return cb.getPrefs().snapEnabled; }
  function maybeSnapWorld(p: Vec2): Vec2 {
    return snapping() ? snapWorld(p, cb.getPrefs().snapStep) : p;
  }

  /** Rotate the linear part by `t` rad about O (position held). For snap nudges. */
  function rotateAboutO(r: RawAffine, t: number): RawAffine {
    const cos = Math.cos(t), sin = Math.sin(t);
    return {
      a: cos * r.a - sin * r.d, d: sin * r.a + cos * r.d,
      b: cos * r.b - sin * r.e, e: sin * r.b + cos * r.e,
      c: r.c, f: r.f,
    };
  }

  function resize(): void {
    const rect = host.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
  }

  function drawGrid(): void {
    if (!ctx) return;
    const v = vp();
    const wpx = worldPerCssPx(cam(), v);
    const step = niceStep(wpx * 95);
    if (!(step > 0)) return;
    const c0 = unproject({ x: 0, y: 0 });
    const c1 = unproject({ x: v.rectWidth, y: v.rectHeight });
    const minX = Math.min(c0.x, c1.x), maxX = Math.max(c0.x, c1.x);
    const minY = Math.min(c0.y, c1.y), maxY = Math.max(c0.y, c1.y);
    const kx0 = Math.floor(minX / step), kx1 = Math.ceil(maxX / step);
    const ky0 = Math.floor(minY / step), ky1 = Math.ceil(maxY / step);
    if (kx1 - kx0 > 400 || ky1 - ky0 > 400) return;

    const line = (ax: number, ay: number, bx: number, by: number, axis: boolean): void => {
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.lineWidth = axis ? 3 : 2.4;
      ctx.strokeStyle = axis ? GRID_AXIS_HALO : GRID_HALO;
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.lineWidth = axis ? 1.4 : 1;
      ctx.strokeStyle = axis ? GRID_AXIS : GRID_COL;
      ctx.stroke();
    };
    const label = (text: string, x: number, y: number): void => {
      ctx.font = '10px ui-monospace, monospace';
      ctx.lineWidth = 3; ctx.strokeStyle = GRID_LABEL_HALO; ctx.strokeText(text, x, y);
      ctx.fillStyle = GRID_LABEL; ctx.fillText(text, x, y);
    };

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    for (let k = kx0; k <= kx1; k++) {
      const wx = k * step;
      const a = project({ x: wx, y: minY }); const b = project({ x: wx, y: maxY });
      line(a.x, a.y, b.x, b.y, k === 0);
      if (k !== 0) label(fmtCoord(wx, step), Math.round(a.x) + 2, v.rectHeight - 4);
    }
    for (let k = ky0; k <= ky1; k++) {
      const wy = k * step;
      const a = project({ x: minX, y: wy }); const b = project({ x: maxX, y: wy });
      line(a.x, a.y, b.x, b.y, k === 0);
      if (k !== 0) label(fmtCoord(wy, step), 3, Math.round(a.y) - 2);
    }
    label('0', 3, v.rectHeight - 4);
  }

  function dot(p: Vec2, col: string, rad: number): void {
    if (!ctx) return;
    ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, TWO_PI); ctx.fillStyle = col; ctx.fill();
  }
  function tagLabel(text: string, p: Vec2, dx: number, dy: number): void {
    if (!ctx) return;
    ctx.font = 'bold 12px ui-monospace, monospace';
    ctx.lineWidth = 3; ctx.strokeStyle = COL_LABEL_HALO; ctx.strokeText(text, p.x + dx, p.y + dy);
    ctx.fillStyle = COL_LABEL; ctx.fillText(text, p.x + dx, p.y + dy);
  }

  function draw(): void {
    const index = cb.getSelectedIndex();
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const prefs = cb.getPrefs();
    if (!prefs.editOnCanvas) return; // flame mode: gizmo + grid fully hidden
    if (prefs.showWorldGrid) drawGrid();
    if (index < 0) return; // final xform: no gizmo
    const r = cb.getAffine(index);
    if (!r || !Number.isFinite(r.a + r.b + r.c + r.d + r.e + r.f)) return;
    const an = handleAnchors(r, rotLenWorld());
    const O = project(an.O), X = project(an.x), Y = project(an.y);

    // Footprint parallelogram (faint dashed) — the unit square's image: O, X, apply(1,1), Y.
    const fp = [an.O, an.x, applyAffine(r, 1, 1), an.y].map(project);
    ctx.save();
    ctx.setLineDash([5, 4]); ctx.strokeStyle = COL_FOOTPRINT; ctx.lineWidth = 1.4;
    ctx.beginPath(); fp.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath(); ctx.stroke();
    ctx.restore();

    // Axis arms O→X (pink), O→Y (blue).
    ctx.strokeStyle = COL_X; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(O.x, O.y); ctx.lineTo(X.x, X.y); ctx.stroke();
    ctx.strokeStyle = COL_Y; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(O.x, O.y); ctx.lineTo(Y.x, Y.y); ctx.stroke();

    // Rotation ring (distinct hollow ring + ⟳), out the far side of O. Hidden when degenerate.
    if (!isDegenerate(r)) {
      const RT = project(an.rotate);
      ctx.save();
      ctx.setLineDash([4, 3]); ctx.strokeStyle = COL_ROTATE; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(O.x, O.y); ctx.lineTo(RT.x, RT.y); ctx.stroke();
      ctx.restore();
      ctx.beginPath(); ctx.arc(RT.x, RT.y, 9, 0, TWO_PI); ctx.lineWidth = 2.4; ctx.strokeStyle = COL_ROTATE; ctx.stroke();
      ctx.save();
      ctx.font = 'bold 13px ui-monospace, monospace'; ctx.fillStyle = COL_ROTATE;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⟳', RT.x, RT.y + 1);
      ctx.restore();
    }

    // Axis tips.
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    dot(X, COL_X, 5); tagLabel('X', X, 9, 4);
    dot(Y, COL_Y, 5); tagLabel('Y', Y, 9, 4);
    // O — emphasized white ring + orange fill + label.
    ctx.beginPath(); ctx.arc(O.x, O.y, 8, 0, TWO_PI); ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    dot(O, COL_O, 6); tagLabel('O', O, -16, 16);
  }

  function readoutFor(r: RawAffine): string {
    const O = applyAffine(r, 0, 0);
    const rotDeg = (Math.atan2(r.d, r.a) * 180 / Math.PI).toFixed(1);
    const sx = Math.hypot(r.a, r.d);
    const sy = sx > 1e-12 ? (r.a * r.e - r.b * r.d) / sx : 0;
    return `pos ${O.x.toFixed(3)}, ${O.y.toFixed(3)}   rot ${rotDeg}°   scale ${sx.toFixed(3)}, ${sy.toFixed(3)}`;
  }

  function onMouseDown(ev: MouseEvent): void {
    if (ev.button !== 0) return;
    if (!cb.getPrefs().editOnCanvas) return;
    const index = cb.getSelectedIndex();
    if (index < 0) return;
    const r = cb.getAffine(index);
    if (!r) return;
    const lp = localPt(ev);
    const an = handleAnchors(r, rotLenWorld());
    let hit = hitTestHandle(lp, an, project, HIT_RADIUS_PX);
    if (hit === 'rotate' && isDegenerate(r)) hit = null; // no orientation → no rotate grab
    if (!hit) return; // not on a handle → let pan have it
    ev.stopPropagation();
    ev.preventDefault();
    active = { handle: hit, grabWorld: unproject(lp), grabAffine: { ...r }, index };
  }

  function onMouseMove(ev: MouseEvent): void {
    if (!active) return;
    // Compute from the GRAB snapshot, not the live (already-mutated) affine, so each frame
    // applies the absolute transform from the original — no compounding.
    const r = active.grabAffine;
    const prefs = cb.getPrefs();
    const handle = active.handle;
    // Rotation is snapped by ANGLE (below), not by the world grid — world-snapping
    // the pointer could quantize it onto O and kill the angle. Other handles use it.
    const rawPointer = unproject(localPt(ev));
    const pointer = handle === 'rotate' ? rawPointer : maybeSnapWorld(rawPointer);
    let next: RawAffine;
    if (handle === 'O') {
      next = applyMove(r, pointer);
    } else if (handle === 'x' || handle === 'y') {
      next = applyAxisDrag(r, handle, pointer, ev.shiftKey); // Shift = free (shear)
    } else {
      next = applyRotate(r, active.grabWorld, pointer);
      if (snapping()) {
        const deg = Math.atan2(next.d, next.a) * 180 / Math.PI;
        const snapped = snapAngleDeg(deg, prefs.snapAngleStep);
        next = rotateAboutO(next, (snapped - deg) * Math.PI / 180);
      }
    }
    cb.setAffine(active.index, next);
    cb.onLiveEdit(active.index);
    cb.onReadout?.(readoutFor(next));
    draw();
  }

  function onMouseUp(): void {
    if (!active) return;
    active = null;
    cb.onReadout?.(null);
    cb.onCommit();
  }

  // Capture phase so we beat attachPanZoom's bubble-phase mousedown.
  eventCanvas.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  resize();
  draw();

  return {
    draw,
    resize(): void { resize(); draw(); },
    destroy(): void {
      eventCanvas.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.remove();
    },
  };
}
