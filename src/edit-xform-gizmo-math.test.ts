// src/edit-xform-gizmo-math.test.ts
//
// O/X/Y triangle gizmo math (#394/#395). The gizmo is origin-anchored to match the
// decomposition panel (position = (c,f) = O). Four handles: O (move), x/y axis tips
// (axis-locked scale by default, free with Shift), rotate (rigid spin about O).
import { describe, it, expect } from 'vitest';
import {
  handleAnchors,
  rotateAnchor,
  isDegenerate,
  hitTestHandle,
  applyMove,
  applyAxisDrag,
  applyRotate,
  snapWorld,
  snapAngleDeg,
  type RawAffine,
} from './edit-xform-gizmo-math';

const IDENT: RawAffine = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
// A representative non-trivial affine: scaleX 0.6, scaleY 0.5, no shear/rotation,
// position (c,f) = (0.2, -0.3).
const R: RawAffine = { a: 0.6, b: 0, c: 0.2, d: 0, e: 0.5, f: -0.3 };

describe('handleAnchors', () => {
  it('places O at (c,f), x at apply(1,0), y at apply(0,1)', () => {
    const h = handleAnchors(R, 0.5);
    expect(h.O).toEqual({ x: 0.2, y: -0.3 });
    expect(h.x).toEqual({ x: 0.8, y: -0.3 }); // a+c, d+f
    expect(h.y).toEqual({ x: 0.2, y: 0.2 });  // b+c, e+f
  });
});

describe('rotateAnchor + isDegenerate', () => {
  it('sits a fixed length out from O, opposite the box centroid', () => {
    const O = { x: R.c, y: R.f };
    const an = rotateAnchor(R, 0.5);
    expect(Math.hypot(an.x - O.x, an.y - O.y)).toBeCloseTo(0.5, 6);
    // centroid is up-right of O (positive a,e) → handle points down-left.
    expect(an.x).toBeLessThan(O.x);
    expect(an.y).toBeLessThan(O.y);
  });
  it('isDegenerate true only when both axes collapse', () => {
    expect(isDegenerate(R)).toBe(false);
    expect(isDegenerate({ a: 0, b: 0, c: 1, d: 0, e: 0, f: 1 })).toBe(true);
    expect(isDegenerate({ a: 0, b: 0.5, c: 1, d: 0, e: 0, f: 1 })).toBe(false); // Y still alive
  });
});

describe('hitTestHandle', () => {
  it('returns the nearest handle within the screen-px radius', () => {
    const anchors = handleAnchors(IDENT, 0.5);
    const proj = (p: { x: number; y: number }) => ({ x: p.x * 100, y: p.y * 100 });
    // O is world (0,0) → screen (0,0). A click at (3,-2) within 12px hits it.
    expect(hitTestHandle({ x: 3, y: -2 }, anchors, proj, 12)).toBe('O');
    // x tip world (1,0) → screen (100,0).
    expect(hitTestHandle({ x: 101, y: 1 }, anchors, proj, 12)).toBe('x');
    expect(hitTestHandle({ x: 9999, y: 9999 }, anchors, proj, 12)).toBeNull();
  });
});

describe('applyMove', () => {
  it('sets only c,f (position follows the cursor); basis untouched', () => {
    const n = applyMove(R, { x: 5, y: 6 });
    expect([n.a, n.b, n.d, n.e]).toEqual([R.a, R.b, R.d, R.e]);
    expect([n.c, n.f]).toEqual([5, 6]);
  });
});

describe('applyAxisDrag', () => {
  it('x locked: pure scale along the axis — no shear/rotation, position + Y fixed', () => {
    // axis is +x; cursor off-axis (y component) must be ignored.
    const n = applyAxisDrag(R, 'x', { x: R.c + 1.0, y: R.f + 0.4 }, false);
    expect([n.c, n.f, n.b, n.e]).toEqual([R.c, R.f, R.b, R.e]);
    expect(n.d).toBeCloseTo(0, 6);   // no shear into the X basis
    expect(n.a).toBeCloseTo(1.0, 6); // |X| = projection onto +x
  });
  it('x free (Shift): tip follows cursor exactly → (a,d) = cursor − O', () => {
    const n = applyAxisDrag(R, 'x', { x: R.c + 1.0, y: R.f + 0.4 }, true);
    expect(n.a).toBeCloseTo(1.0, 6);
    expect(n.d).toBeCloseTo(0.4, 6);
    expect([n.c, n.f, n.b, n.e]).toEqual([R.c, R.f, R.b, R.e]);
  });
  it('locked drag on a ZERO-length axis is a no-op — does NOT silently go free (review #1)', () => {
    // X axis collapsed (a=d=0) but Y alive → not flagged by isDegenerate.
    const collapsedX: RawAffine = { a: 0, b: 0.5, c: 0.2, d: 0, e: 0.5, f: -0.3 };
    const n = applyAxisDrag(collapsedX, 'x', { x: collapsedX.c + 1, y: collapsedX.f + 0.4 }, false);
    expect([n.a, n.d]).toEqual([0, 0]); // held collapsed, NOT free-set to (1, 0.4)
    expect([n.b, n.e, n.c, n.f]).toEqual([0.5, 0.5, 0.2, -0.3]); // everything else untouched
  });

  it('y locked: pure scale along the Y axis; position + X fixed', () => {
    const n = applyAxisDrag(R, 'y', { x: R.c + 0.3, y: R.f + 1.0 }, false);
    expect([n.c, n.f, n.a, n.d]).toEqual([R.c, R.f, R.a, R.d]);
    expect(n.b).toBeCloseTo(0, 6);   // axis was +y → no shear into Y basis
    expect(n.e).toBeCloseTo(1.0, 6);
  });
});

describe('applyRotate', () => {
  it('rotates the basis about O by the pointer-angle delta; position + scale fixed', () => {
    const O = { x: R.c, y: R.f };
    // grab at +x of O, drag to +y of O → +90°.
    const n = applyRotate(R, { x: O.x + 1, y: O.y }, { x: O.x, y: O.y + 1 });
    expect([n.c, n.f]).toEqual([R.c, R.f]);              // position fixed
    expect(Math.hypot(n.a, n.d)).toBeCloseTo(0.6, 6);    // scaleX preserved
    expect(Math.hypot(n.b, n.e)).toBeCloseTo(0.5, 6);    // scaleY preserved
    // +90° of (a=0.6,d=0): a→0, d→0.6.
    expect(n.a).toBeCloseTo(0, 6);
    expect(n.d).toBeCloseTo(0.6, 6);
  });
});

describe('snap', () => {
  it('snapWorld rounds each axis to the step', () => {
    expect(snapWorld({ x: 0.27, y: -0.31 }, 0.1)).toEqual({ x: 0.3, y: -0.3 });
  });
  it('snapAngleDeg rounds to the angle step', () => {
    expect(snapAngleDeg(37, 15)).toBe(30);
    expect(snapAngleDeg(38, 15)).toBe(45);
  });
});
