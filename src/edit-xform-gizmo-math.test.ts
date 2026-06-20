// src/edit-xform-gizmo-math.test.ts
import { describe, it, expect } from 'vitest';
import {
  handleAnchors,
  hitTestHandle,
  applyMove,
  applyCornerDrag,
  applyRotate,
  applyEdgeDrag,
  applyAffine,
  snapWorld,
  snapAngleDeg,
  type RawAffine,
} from './edit-xform-gizmo-math';

const IDENT: RawAffine = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };

describe('handleAnchors', () => {
  it('places center at the image of (0.5,0.5)', () => {
    const h = handleAnchors(IDENT);
    expect(h.center).toEqual({ x: 0.5, y: 0.5 });
    expect(h.cornerBL).toEqual({ x: 0, y: 0 });
    expect(h.cornerTR).toEqual({ x: 1, y: 1 });
    expect(h.edgeRight).toEqual({ x: 1, y: 0.5 });
    expect(h.edgeTop).toEqual({ x: 0.5, y: 1 });
    expect(h.edgeLeft).toEqual({ x: 0, y: 0.5 });
    expect(h.edgeBottom).toEqual({ x: 0.5, y: 0 });
    expect(h.rotate).toEqual({ x: 0.5, y: -0.5 }); // sticks out the top (y-down canvas)
  });
});

describe('hitTestHandle', () => {
  it('returns the nearest handle within the screen-px radius', () => {
    // Pass a world→screen projector that is identity*100 for simplicity.
    const proj = (p: { x: number; y: number }) => ({ x: p.x * 100, y: p.y * 100 });
    // center is world (0.5,0.5) → screen (50,50). A click at (52,49) within 12px hits it.
    expect(hitTestHandle({ x: 52, y: 49 }, IDENT, proj, 12)).toBe('center');
    // A click far from every handle misses.
    expect(hitTestHandle({ x: 9999, y: 9999 }, IDENT, proj, 12)).toBeNull();
  });
});

describe('applyMove', () => {
  it('translates so the center follows the pointer', () => {
    const next = applyMove(IDENT, { x: 2, y: -1 }); // new center world
    // center was (0.5,0.5); move to (2,-1) → c += 1.5, f += -1.5.
    expect(next.c).toBeCloseTo(1.5);
    expect(next.f).toBeCloseTo(-1.5);
    expect(next.a).toBe(1); expect(next.e).toBe(1);
  });
});

describe('applyCornerDrag (direct manipulation)', () => {
  it('puts the grabbed corner under the cursor and pins the opposite corner', () => {
    // Grab cornerTR (world 1,1), drag to (1.7,1.3). TR must land on the cursor;
    // BL (the opposite, world 0,0) must stay pinned.
    const next = applyCornerDrag(IDENT, 'cornerTR', { x: 1.7, y: 1.3 });
    const tr = applyAffine(next, 1, 1);
    expect(tr.x).toBeCloseTo(1.7, 6);
    expect(tr.y).toBeCloseTo(1.3, 6);
    const bl = applyAffine(next, 0, 0);
    expect(bl.x).toBeCloseTo(0, 6);
    expect(bl.y).toBeCloseTo(0, 6);
  });
  it('preserves edge directions (no added shear) for an axis-aligned square', () => {
    const next = applyCornerDrag(IDENT, 'cornerTR', { x: 2, y: 3 });
    // U stays along +x, V along +y → b,d remain 0; a,e scale to hit the corner.
    expect(next.b).toBeCloseTo(0, 6);
    expect(next.d).toBeCloseTo(0, 6);
    expect(next.a).toBeCloseTo(2, 6);
    expect(next.e).toBeCloseTo(3, 6);
  });
  it('pins cornerTR when dragging cornerBL', () => {
    const next = applyCornerDrag(IDENT, 'cornerBL', { x: -0.5, y: -0.5 });
    const bl = applyAffine(next, 0, 0);
    expect(bl.x).toBeCloseTo(-0.5, 6);
    expect(bl.y).toBeCloseTo(-0.5, 6);
    const tr = applyAffine(next, 1, 1);
    expect(tr.x).toBeCloseTo(1, 6); // opposite pinned
    expect(tr.y).toBeCloseTo(1, 6);
  });
});

describe('applyRotate', () => {
  it('rotates the linear part about the center by the pointer-angle delta', () => {
    // Grab rotate handle (0.5,1.5), drag 90° CCW about center (0.5,0.5):
    // from angle +90° to +180°, delta +90°.
    const next = applyRotate(IDENT, { x: 0.5, y: 1.5 }, { x: -0.5, y: 0.5 });
    // a 90° rotation of identity linear part → a≈0,b≈-1,d≈1,e≈0.
    expect(next.a).toBeCloseTo(0, 6);
    expect(next.b).toBeCloseTo(-1, 6);
    expect(next.d).toBeCloseTo(1, 6);
    expect(next.e).toBeCloseTo(0, 6);
    // center fixed.
    expect(next.a * 0.5 + next.b * 0.5 + next.c).toBeCloseTo(0.5);
    expect(next.d * 0.5 + next.e * 0.5 + next.f).toBeCloseTo(0.5);
  });
});

describe('applyEdgeDrag (axis-constrained)', () => {
  it('right edge slides along the X axis; cursor y is IGNORED (no shear); opposite pinned', () => {
    const next = applyEdgeDrag(IDENT, 'right', { x: 2, y: 0.7 });
    const mid = applyAffine(next, 1, 0.5);
    expect(mid.x).toBeCloseTo(2, 6);   // follows cursor x (projection onto X axis)
    expect(mid.y).toBeCloseTo(0.5, 6); // axis-locked: cursor y=0.7 ignored
    expect(next.d).toBeCloseTo(0, 6);  // no shear into the X basis
    const opp = applyAffine(next, 0, 0.5);
    expect(opp.x).toBeCloseTo(0, 6);   // left edge pinned
    expect(opp.y).toBeCloseTo(0.5, 6);
  });
  it('top edge slides along the Y axis; cursor x ignored; opposite pinned', () => {
    const next = applyEdgeDrag(IDENT, 'top', { x: 0.7, y: 2 });
    const mid = applyAffine(next, 0.5, 1);
    expect(mid.x).toBeCloseTo(0.5, 6); // axis-locked
    expect(mid.y).toBeCloseTo(2, 6);
    expect(next.b).toBeCloseTo(0, 6);
    const opp = applyAffine(next, 0.5, 0);
    expect(opp.y).toBeCloseTo(0, 6);   // bottom edge pinned
  });
  it('left edge drag keeps the right edge pinned', () => {
    const next = applyEdgeDrag(IDENT, 'left', { x: -0.5, y: 0.9 });
    const mid = applyAffine(next, 0, 0.5);
    expect(mid.x).toBeCloseTo(-0.5, 6);
    expect(mid.y).toBeCloseTo(0.5, 6); // axis-locked
    const opp = applyAffine(next, 1, 0.5);
    expect(opp.x).toBeCloseTo(1, 6);   // right edge pinned
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
