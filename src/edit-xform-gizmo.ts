// pyr3 — /editor on-canvas affine gizmo overlay (#350 Phase 2.3). SEAM_EXEMPT.
//
// A single 2D canvas layered over the WebGPU preview. Draws the selected
// xform's unit-square handles in WORLD space (projected through the live
// camera, so it tracks pan/zoom/rotate) and lets the user drag them to edit
// the affine. One 2D canvas (no per-handle DOM) sidesteps the #283 mid-drag
// rebuild hazard.
//
// Interaction (§4.6): the mousedown listener attaches to the *preview canvas*
// (passed as `eventCanvas`) in the CAPTURE phase, so it runs before
// attachPanZoom's bubble-phase mousedown. A press ON a handle of the selected
// xform claims the drag (stopPropagation → pan never starts); a press anywhere
// else does nothing and pan proceeds. The overlay canvas itself stays
// pointer-events:none so it never steals events. Edits write the raw a..f
// matrix through onLiveEdit (slow-lane re-iterate); the debounced history
// commit rides onLiveEdit's onPathChange, so the whole drag is one undo entry.

import { worldToScreen, screenToWorld, worldPerCssPx, type Camera, type Viewport } from './edit-camera-projection';
import type { GizmoPrefs } from './edit-state';
import {
  handleAnchors, hitTestHandle, applyMove, applyCornerDrag, applyRotate, applyEdgeDrag, EDGE_SIDE,
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
const EDGE_HIT_PX = 8;
const COL_ROTATE = '#3ad17a';
const COL_HANDLE: Record<string, string> = {
  center: '#ffd23a', rotate: COL_ROTATE,
  cornerBL: '#ff8c1a', cornerBR: '#ff8c1a', cornerTR: '#ff8c1a', cornerTL: '#ff8c1a',
  // Edge midpoint dots: X edges (left/right) pink, Y edges (top/bottom) blue.
  edgeRight: '#ff5fa2', edgeLeft: '#ff5fa2', edgeTop: '#3aa1ff', edgeBottom: '#3aa1ff',
};
// Gridlines are drawn as a dark underlay + light overlay so they read on BOTH
// black and bright-orange flames (a single faint white line vanished on bright
// areas — #350 follow-up). Origin axes are brighter.
const GRID_HALO = 'rgba(0,0,0,0.38)';
const GRID_COL = 'rgba(255,255,255,0.34)';
const GRID_AXIS_HALO = 'rgba(0,0,0,0.5)';
const GRID_AXIS = 'rgba(255,255,255,0.62)';
const GRID_LABEL = 'rgba(255,255,255,0.78)';
const GRID_LABEL_HALO = 'rgba(0,0,0,0.7)';
// Squares mirror the panel mini-viz (edit-xform-viz.ts): orange = input unit
// square, blue = the affine's image (output). The handles sit on the output.
const COL_OUTPUT_SQUARE = '#3aa1ff';
const COL_INPUT_SQUARE = '#ff8c1a';

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
  canvas.style.pointerEvents = 'none'; // never steals events; eventCanvas owns mousedown
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  // grabAffine = the affine snapshot at mousedown; ALL drags compute from it
  // (absolute, not accumulated) so rotation/scale can't compound across frames.
  let active: { handle: HandleId; grabWorld: Vec2; grabAffine: RawAffine; index: number; pointerWorld?: Vec2 } | null = null;
  let shiftHeld = false;

  function vp(): Viewport { return cb.getViewport(); }
  function cam(): Camera { return cb.getCamera(); }
  function project(w: Vec2): Vec2 { return worldToScreen(w, cam(), vp()); }
  function unproject(s: Vec2): Vec2 { return screenToWorld(s, cam(), vp()); }

  /** Element-relative CSS coords from a mouse event (host == overlay rect). */
  function localPt(ev: MouseEvent): Vec2 {
    const rect = host.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function snapping(): boolean { return cb.getPrefs().snapEnabled || shiftHeld; }
  function maybeSnapWorld(p: Vec2): Vec2 {
    return snapping() ? snapWorld(p, cb.getPrefs().snapStep) : p;
  }

  /** Rotate the linear part by `t` rad about the affine's fixed center. */
  function rotateColumnsAbout(r: RawAffine, t: number): RawAffine {
    const ctr = applyAffine(r, 0.5, 0.5);
    const cos = Math.cos(t), sin = Math.sin(t);
    const a = cos * r.a - sin * r.d;
    const d = sin * r.a + cos * r.d;
    const b = cos * r.b - sin * r.e;
    const e = sin * r.b + cos * r.e;
    return { a, b, d, e, c: ctr.x - (a * 0.5 + b * 0.5), f: ctr.y - (d * 0.5 + e * 0.5) };
  }

  function resize(): void {
    const rect = host.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
  }

  function drawGrid(): void {
    if (!ctx) return;
    const v = vp();
    // Adaptive step: aim for a labelled line roughly every ~95 screen px.
    const wpx = worldPerCssPx(cam(), v);
    const step = niceStep(wpx * 95);
    if (!(step > 0)) return;
    const c0 = unproject({ x: 0, y: 0 });
    const c1 = unproject({ x: v.rectWidth, y: v.rectHeight });
    const minX = Math.min(c0.x, c1.x), maxX = Math.max(c0.x, c1.x);
    const minY = Math.min(c0.y, c1.y), maxY = Math.max(c0.y, c1.y);
    const kx0 = Math.floor(minX / step), kx1 = Math.ceil(maxX / step);
    const ky0 = Math.floor(minY / step), ky1 = Math.ceil(maxY / step);
    // Safety cap against a runaway zoom.
    if (kx1 - kx0 > 400 || ky1 - ky0 > 400) return;

    // Each line: thicker dark halo first, then a bright line on top.
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
    label('0', 3, v.rectHeight - 4); // origin marker, bottom-left
  }

  function draw(): void {
    const index = cb.getSelectedIndex();
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const prefs = cb.getPrefs();
    // Flame mode: the gizmo + grid are fully hidden (you're composing).
    if (!prefs.editOnCanvas) return;
    if (prefs.showWorldGrid) drawGrid();
    if (index < 0) return; // final xform: no gizmo
    const r = cb.getAffine(index);
    if (!r || !Number.isFinite(r.a + r.b + r.c + r.d + r.e + r.f)) return;
    const anchors = handleAnchors(r);
    // INPUT unit square [0,1]² (orange, dashed) — the mini-viz reference.
    const inSq: Vec2[] = ([[0, 0], [1, 0], [1, 1], [0, 1]] as const).map(([x, y]) => project({ x, y }));
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = COL_INPUT_SQUARE; ctx.lineWidth = 1.2;
    ctx.beginPath(); inSq.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath(); ctx.stroke();
    ctx.restore();
    // OUTPUT square = image of the unit square under the affine (blue, solid),
    // matching the mini-viz's blue output square. The handles sit on this.
    const sq: Vec2[] = [anchors.cornerBL, anchors.cornerBR, anchors.cornerTR, anchors.cornerTL].map(project);
    ctx.strokeStyle = COL_OUTPUT_SQUARE; ctx.lineWidth = 1.8;
    ctx.beginPath(); sq.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath(); ctx.stroke();
    // Rotate stalk. While actively dragging the rotate handle, draw the stalk +
    // dot UNDER the cursor (so it tracks the pointer, not its far circle).
    const c = project(anchors.center);
    const rot = (active?.handle === 'rotate' && active.pointerWorld)
      ? project(active.pointerWorld) : project(anchors.rotate);
    ctx.strokeStyle = COL_ROTATE; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(rot.x, rot.y); ctx.stroke();
    // Grab handles (edit-on-canvas guaranteed here — flame mode returned early).
    (Object.keys(anchors) as HandleId[]).forEach((id) => {
      const s = (id === 'rotate' && active?.handle === 'rotate' && active.pointerWorld)
        ? project(active.pointerWorld) : project(anchors[id]);
      ctx.fillStyle = COL_HANDLE[id] ?? '#fff';
      ctx.beginPath(); ctx.arc(s.x, s.y, id === 'center' ? 6 : 5, 0, Math.PI * 2); ctx.fill();
    });
  }

  function readoutFor(r: RawAffine): string {
    const ctr = applyAffine(r, 0.5, 0.5);
    const rotDeg = (Math.atan2(r.d, r.a) * 180 / Math.PI).toFixed(1);
    const sx = Math.hypot(r.a, r.d).toFixed(3);
    const sy = Math.hypot(r.b, r.e).toFixed(3);
    return `pos ${ctr.x.toFixed(3)}, ${ctr.y.toFixed(3)}   rot ${rotDeg}°   scale ${sx}, ${sy}`;
  }

  function onMouseDown(ev: MouseEvent): void {
    if (ev.button !== 0) return;
    if (!cb.getPrefs().editOnCanvas) return;
    const index = cb.getSelectedIndex();
    if (index < 0) return;
    const r = cb.getAffine(index);
    if (!r) return;
    const lp = localPt(ev);
    // Dots take priority; then the edge SEGMENTS (grab anywhere along an edge).
    const hit = hitTestHandle(lp, r, project, HIT_RADIUS_PX) ?? hitTestEdge(lp, r);
    if (!hit) return; // not on a handle → let pan have it
    ev.stopPropagation(); // claim the drag before pan starts
    ev.preventDefault();
    shiftHeld = ev.shiftKey;
    active = { handle: hit, grabWorld: unproject(lp), grabAffine: { ...r }, index };
  }

  /** Distance from a point to a line segment, all in screen px. */
  function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
    const vx = b.x - a.x, vy = b.y - a.y;
    const wx = p.x - a.x, wy = p.y - a.y;
    const len2 = vx * vx + vy * vy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
    return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
  }

  /** Hit-test the four edge segments (screen space); nearest within EDGE_HIT_PX. */
  function hitTestEdge(screenPt: Vec2, r: RawAffine): HandleId | null {
    const an = handleAnchors(r);
    const bl = project(an.cornerBL), br = project(an.cornerBR);
    const tr = project(an.cornerTR), tl = project(an.cornerTL);
    const edges: Array<[HandleId, Vec2, Vec2]> = [
      ['edgeRight', br, tr], ['edgeLeft', bl, tl], ['edgeTop', tl, tr], ['edgeBottom', bl, br],
    ];
    let best: HandleId | null = null, bestD = EDGE_HIT_PX;
    for (const [id, a, b] of edges) {
      const d = distToSeg(screenPt, a, b);
      if (d <= bestD) { bestD = d; best = id; }
    }
    return best;
  }

  function onMouseMove(ev: MouseEvent): void {
    if (!active) return;
    shiftHeld = ev.shiftKey;
    // Compute from the GRAB snapshot, not the live (already-mutated) affine, so
    // each frame applies the absolute transform from the original — no compound.
    const r = active.grabAffine;
    const pointer = maybeSnapWorld(unproject(localPt(ev)));
    active.pointerWorld = pointer; // for under-cursor rotate drawing
    const prefs = cb.getPrefs();
    const handle = active.handle;
    let next: RawAffine;
    // Direct manipulation: the grabbed handle tracks the cursor.
    if (handle === 'center') {
      next = applyMove(r, pointer);
    } else if (handle === 'rotate') {
      // The handle rides under the cursor's ANGLE (radius preserved); we draw
      // it at the cursor so it tracks the pointer instead of whipping around
      // its far circle (#350 rotate feel).
      next = applyRotate(r, active.grabWorld, pointer);
      if (snapping()) {
        const deg = Math.atan2(next.d, next.a) * 180 / Math.PI;
        const snapped = snapAngleDeg(deg, prefs.snapAngleStep);
        next = rotateColumnsAbout(next, (snapped - deg) * Math.PI / 180);
      }
    } else if (handle === 'edgeRight' || handle === 'edgeLeft' || handle === 'edgeTop' || handle === 'edgeBottom') {
      next = applyEdgeDrag(r, EDGE_SIDE[handle], pointer); // axis-constrained
    } else {
      next = applyCornerDrag(r, handle, pointer); // corners — free resize
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
