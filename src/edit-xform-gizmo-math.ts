// pyr3 — pure on-canvas affine gizmo math (#350; O/X/Y triangle redesign #394/#395).
//
// The gizmo is ORIGIN-ANCHORED to match the decomposition panel: position = (c,f) = O,
// the image of the local origin. The affine is presented as the flam3-native triangle —
// O plus the two axis tips — so the three points ARE the matrix: O = (c,f), O→X = (a,d),
// O→Y = (b,e). All functions are DOM-free and operate in WORLD space; the overlay module
// projects to screen via edit-camera-projection. The genome's raw a..f stays the source
// of truth — every drag returns a fresh RawAffine.

import type { RawAffine } from './affine-decompose';
export type { RawAffine };

export type HandleId = 'O' | 'x' | 'y' | 'rotate';

export interface Vec2 { x: number; y: number; }

/** apply(x,y) — image of a unit-square point under the affine. */
export function applyAffine(r: RawAffine, x: number, y: number): Vec2 {
  return { x: r.a * x + r.b * y + r.c, y: r.d * x + r.e * y + r.f };
}

/** Rotate-handle anchor: `lenWorld` out from O, pointing OPPOSITE the box centroid (out the
 *  far side of O) so it never collides with the X/Y tips. The overlay passes
 *  lenWorld = ROT_PX × worldPerCssPx so the on-screen reach is zoom-independent. */
export function rotateAnchor(r: RawAffine, lenWorld: number): Vec2 {
  const O = applyAffine(r, 0, 0);
  const ctr = applyAffine(r, 0.5, 0.5);
  const dx = ctr.x - O.x, dy = ctr.y - O.y;
  const m = Math.hypot(dx, dy) || 1;
  return { x: O.x - (dx / m) * lenWorld, y: O.y - (dy / m) * lenWorld };
}

/** World positions of every handle. */
export function handleAnchors(r: RawAffine, rotateLenWorld: number): Record<HandleId, Vec2> {
  return {
    O: applyAffine(r, 0, 0),
    x: applyAffine(r, 1, 0),
    y: applyAffine(r, 0, 1),
    rotate: rotateAnchor(r, rotateLenWorld),
  };
}

/** No orientation when both axes collapse to ~0 → the caller hides the rotate handle. */
export function isDegenerate(r: RawAffine, eps = 1e-4): boolean {
  return Math.hypot(r.a, r.d) < eps && Math.hypot(r.b, r.e) < eps;
}

/** Nearest handle whose screen distance to `screenPt` is within radiusPx, or null.
 *  `anchors` are precomputed world positions; `project` maps world → element-relative px. */
export function hitTestHandle(
  screenPt: Vec2,
  anchors: Record<HandleId, Vec2>,
  project: (w: Vec2) => Vec2,
  radiusPx: number,
): HandleId | null {
  // O first (it overlaps an axis root at rest), then the axis tips, then rotate.
  const order: HandleId[] = ['O', 'x', 'y', 'rotate'];
  let best: HandleId | null = null;
  let bestD = radiusPx;
  for (const id of order) {
    const s = project(anchors[id]);
    const d = Math.hypot(s.x - screenPt.x, s.y - screenPt.y);
    if (d <= bestD) { bestD = d; best = id; }
  }
  return best;
}

/** Drag O → translate so the position (c,f) lands on the pointer. */
export function applyMove(r: RawAffine, pointer: Vec2): RawAffine {
  return { ...r, c: pointer.x, f: pointer.y };
}

/** Drag an axis tip. Default (free=false): LOCKED to the current axis direction — the
 *  cursor is projected onto the axis, so only that axis's scale changes (pure scale, no
 *  shear/rotation introduced). free=true (Shift): the tip follows the cursor exactly,
 *  freely re-setting (a,d) or (b,e) and so introducing shear/rotation. */
export function applyAxisDrag(r: RawAffine, axis: 'x' | 'y', pointer: Vec2, free: boolean): RawAffine {
  const vx = pointer.x - r.c, vy = pointer.y - r.f; // vector O→cursor
  const u = axis === 'x' ? r.a : r.b;
  const v = axis === 'x' ? r.d : r.e;
  let nu = vx, nv = vy; // free → raw
  if (!free) {
    const len = Math.hypot(u, v);
    if (len >= 1e-9) {
      const hx = u / len, hy = v / len;       // current axis direction (preserved)
      const proj = vx * hx + vy * hy;          // signed length along the axis
      nu = proj * hx; nv = proj * hy;
    } else {
      // Axis has collapsed — no direction to lock to. Hold it unchanged (a locked
      // drag is a no-op) rather than silently falling through to free-mode. To give
      // a zero-length axis a new direction, free-drag it (Shift).
      nu = u; nv = v;
    }
  }
  return axis === 'x' ? { ...r, a: nu, d: nv } : { ...r, b: nu, e: nv };
}

/** Rigid rotate both basis columns about O by the pointer-angle delta. Position (c,f)
 *  fixed — matches the numeric `rotation` field (decomposedToRaw holds translate). */
export function applyRotate(r: RawAffine, grab: Vec2, pointer: Vec2): RawAffine {
  const O = applyAffine(r, 0, 0);
  const t = Math.atan2(pointer.y - O.y, pointer.x - O.x) - Math.atan2(grab.y - O.y, grab.x - O.x);
  const cos = Math.cos(t), sin = Math.sin(t);
  return {
    a: cos * r.a - sin * r.d,
    d: sin * r.a + cos * r.d,
    b: cos * r.b - sin * r.e,
    e: sin * r.b + cos * r.e,
    c: r.c, f: r.f,
  };
}

/** Round a world point to the snap step on each axis. */
export function snapWorld(p: Vec2, step: number): Vec2 {
  if (!(step > 0)) return p;
  const inv = 1 / step;
  return { x: Math.round(p.x * inv) / inv, y: Math.round(p.y * inv) / inv };
}

/** Round an angle (degrees) to the snap step. */
export function snapAngleDeg(deg: number, step: number): number {
  if (!(step > 0)) return deg;
  return Math.round(deg / step) * step;
}
