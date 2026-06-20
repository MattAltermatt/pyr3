// pyr3 — pure on-canvas affine gizmo math (#350 Phase 2.3).
//
// Handle anchors live on the affine's image of the unit square (the same
// square edit-xform-viz.ts draws). All functions are DOM-free and operate in
// WORLD space; the overlay module projects to screen via edit-camera-projection.
// The genome's raw a..f matrix stays the source of truth — every drag returns
// a fresh RawAffine.

import type { RawAffine } from './affine-decompose';
export type { RawAffine };

export type HandleId =
  | 'center' | 'rotate'
  | 'cornerBL' | 'cornerBR' | 'cornerTR' | 'cornerTL'
  | 'edgeRight' | 'edgeLeft' | 'edgeTop' | 'edgeBottom';

/** Map an edge handle to its axis side for applyEdgeDrag. */
export const EDGE_SIDE: Record<'edgeRight' | 'edgeLeft' | 'edgeTop' | 'edgeBottom', 'right' | 'left' | 'top' | 'bottom'> = {
  edgeRight: 'right', edgeLeft: 'left', edgeTop: 'top', edgeBottom: 'bottom',
};

export interface Vec2 { x: number; y: number; }

/** apply(x,y) — image of a unit-square point under the affine. */
export function applyAffine(r: RawAffine, x: number, y: number): Vec2 {
  return { x: r.a * x + r.b * y + r.c, y: r.d * x + r.e * y + r.f };
}

/** World positions of every handle for the given affine. Edge handles sit at
 *  the edge midpoints. */
export function handleAnchors(r: RawAffine): Record<HandleId, Vec2> {
  return {
    center: applyAffine(r, 0.5, 0.5),
    // Rotate handle sticks out the screen-TOP of the square (local y=−0.5; the
    // canvas is y-down so local −y draws upward) → "up" at rest (#350 rotate).
    rotate: applyAffine(r, 0.5, -0.5),
    cornerBL: applyAffine(r, 0, 0),
    cornerBR: applyAffine(r, 1, 0),
    cornerTR: applyAffine(r, 1, 1),
    cornerTL: applyAffine(r, 0, 1),
    edgeRight: applyAffine(r, 1, 0.5),
    edgeLeft: applyAffine(r, 0, 0.5),
    edgeTop: applyAffine(r, 0.5, 1),
    edgeBottom: applyAffine(r, 0.5, 0),
  };
}

const HIT_PRIORITY: HandleId[] = ['center', 'rotate', 'cornerBL', 'cornerBR', 'cornerTR', 'cornerTL', 'edgeRight', 'edgeLeft', 'edgeTop', 'edgeBottom'];

/** Nearest handle whose screen distance to `screenPt` is within radiusPx, or null.
 *  `project` maps a world point to a screen-px point (element-relative). */
export function hitTestHandle(
  screenPt: Vec2,
  r: RawAffine,
  project: (w: Vec2) => Vec2,
  radiusPx: number,
): HandleId | null {
  const anchors = handleAnchors(r);
  let best: HandleId | null = null;
  let bestD = radiusPx;
  for (const id of HIT_PRIORITY) {
    const s = project(anchors[id]);
    const d = Math.hypot(s.x - screenPt.x, s.y - screenPt.y);
    if (d <= bestD) { bestD = d; best = id; }
  }
  return best;
}

/** Move: translate the whole affine so its center lands on `newCenter`. */
export function applyMove(r: RawAffine, newCenter: Vec2): RawAffine {
  const cur = applyAffine(r, 0.5, 0.5);
  const dx = newCenter.x - cur.x;
  const dy = newCenter.y - cur.y;
  return { ...r, c: r.c + dx, f: r.f + dy };
}

/** Local unit-square coordinate of each corner handle. */
const CORNER_LOCAL: Record<'cornerBL' | 'cornerBR' | 'cornerTR' | 'cornerTL', [number, number]> = {
  cornerBL: [0, 0], cornerBR: [1, 0], cornerTR: [1, 1], cornerTL: [0, 1],
};

/** Direct-manipulation corner drag: the grabbed corner follows the cursor
 *  exactly, the OPPOSITE corner stays pinned, and the edge DIRECTIONS are
 *  preserved (so it's a free non-uniform resize, no added shear). Solves the
 *  2×2 system `[σx·U σy·V]·[su;sv] = pointer − oppositeCorner` for the edge
 *  scale factors, then rebuilds the affine. */
export function applyCornerDrag(
  r: RawAffine,
  corner: 'cornerBL' | 'cornerBR' | 'cornerTR' | 'cornerTL',
  pointer: Vec2,
): RawAffine {
  const [gx, gy] = CORNER_LOCAL[corner];
  const ox = 1 - gx, oy = 1 - gy;
  const U: Vec2 = { x: r.a, y: r.d };
  const V: Vec2 = { x: r.b, y: r.e };
  const opp = applyAffine(r, ox, oy);
  const sx = gx - ox, sy = gy - oy; // ±1
  const A: Vec2 = { x: sx * U.x, y: sx * U.y };
  const B: Vec2 = { x: sy * V.x, y: sy * V.y };
  const rx = pointer.x - opp.x, ry = pointer.y - opp.y;
  const det = A.x * B.y - A.y * B.x;
  if (Math.abs(det) < 1e-12) return r; // degenerate (collinear edges)
  const su = (rx * B.y - ry * B.x) / det;
  const sv = (A.x * ry - A.y * rx) / det;
  const a = su * U.x, d = su * U.y;
  const b = sv * V.x, e = sv * V.y;
  // O' so the opposite corner stays pinned: O' = opp − (ox·U' + oy·V').
  const c = opp.x - (ox * a + oy * b);
  const f = opp.y - (ox * d + oy * e);
  return { a, b, c, d, e, f };
}

/** Rotate the linear part about the fixed center by (angle(pointer)−angle(grab)). */
export function applyRotate(r: RawAffine, grab: Vec2, pointer: Vec2): RawAffine {
  const ctr = applyAffine(r, 0.5, 0.5);
  const a0 = Math.atan2(grab.y - ctr.y, grab.x - ctr.x);
  const a1 = Math.atan2(pointer.y - ctr.y, pointer.x - ctr.x);
  const t = a1 - a0;
  const cos = Math.cos(t), sin = Math.sin(t);
  // Rotate columns: [a b; d e] ← R(t) · [a b; d e].
  const a = cos * r.a - sin * r.d;
  const d = sin * r.a + cos * r.d;
  const b = cos * r.b - sin * r.e;
  const e = sin * r.b + cos * r.e;
  return { a, b, d, e, c: ctr.x - (a * 0.5 + b * 0.5), f: ctr.y - (d * 0.5 + e * 0.5) };
}

/** Axis-CONSTRAINED edge drag: the grabbed edge slides perpendicular to itself
 *  (along its local axis), the OPPOSITE edge stays pinned, and no shear is
 *  introduced (the edge direction is preserved). The cursor is projected onto
 *  the moving axis, so the edge tracks the cursor's component along that axis.
 *  Right/left edges scale the X basis (a,d); top/bottom scale the Y basis (b,e). */
export function applyEdgeDrag(r: RawAffine, edge: 'right' | 'left' | 'top' | 'bottom', pointer: Vec2): RawAffine {
  if (edge === 'right' || edge === 'left') {
    const ulen = Math.hypot(r.a, r.d);
    if (ulen < 1e-9) return r;
    const ux = r.a / ulen, uy = r.d / ulen; // unit X basis (preserved direction)
    if (edge === 'right') {
      const opp = applyAffine(r, 0, 0.5); // pinned left edge-midpoint
      const len = (pointer.x - opp.x) * ux + (pointer.y - opp.y) * uy; // proj onto Û
      const a = len * ux, d = len * uy;
      return { a, b: r.b, c: opp.x - 0.5 * r.b, d, e: r.e, f: opp.y - 0.5 * r.e };
    }
    const opp = applyAffine(r, 1, 0.5); // pinned right edge-midpoint
    const len = (opp.x - pointer.x) * ux + (opp.y - pointer.y) * uy;
    const a = len * ux, d = len * uy;
    // apply(0,0.5) = opp − U'; O' = apply(0,0.5) − 0.5V.
    return { a, b: r.b, c: opp.x - a - 0.5 * r.b, d, e: r.e, f: opp.y - d - 0.5 * r.e };
  }
  const vlen = Math.hypot(r.b, r.e);
  if (vlen < 1e-9) return r;
  const vx = r.b / vlen, vy = r.e / vlen; // unit Y basis
  if (edge === 'top') {
    const opp = applyAffine(r, 0.5, 0); // pinned bottom edge-midpoint
    const len = (pointer.x - opp.x) * vx + (pointer.y - opp.y) * vy;
    const b = len * vx, e = len * vy;
    return { a: r.a, b, c: opp.x - 0.5 * r.a, d: r.d, e, f: opp.y - 0.5 * r.d };
  }
  const opp = applyAffine(r, 0.5, 1); // pinned top edge-midpoint
  const len = (opp.x - pointer.x) * vx + (opp.y - pointer.y) * vy;
  const b = len * vx, e = len * vy;
  return { a: r.a, b, c: opp.x - b - 0.5 * r.a, d: r.d, e, f: opp.y - e - 0.5 * r.d };
}

/** Round a world point to the snap step on each axis. */
export function snapWorld(p: Vec2, step: number): Vec2 {
  if (!(step > 0)) return p;
  // Snap via 1/step so common decimal steps (0.1, 0.25) round to exact decimals
  // instead of accumulating float error (Math.round(0.27/0.1)*0.1 ≠ 0.3).
  const inv = 1 / step;
  return { x: Math.round(p.x * inv) / inv, y: Math.round(p.y * inv) / inv };
}

/** Round an angle (degrees) to the snap step. */
export function snapAngleDeg(deg: number, step: number): number {
  if (!(step > 0)) return deg;
  return Math.round(deg / step) * step;
}
