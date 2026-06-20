// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attachXformGizmo, ROT_HANDLE_PX } from './edit-xform-gizmo';
import { worldToScreen, worldPerCssPx, type Camera, type Viewport } from './edit-camera-projection';
import { rotateAnchor, type RawAffine } from './edit-xform-gizmo-math';
import { GIZMO_PREFS_DEFAULT } from './edit-state';

const CAM: Camera = { cx: 0, cy: 0, scale: 200, rotateDeg: 0 };
const VP: Viewport = { rectWidth: 400, rectHeight: 400, intrinsicWidth: 256, intrinsicHeight: 256 };
const IDENT: RawAffine = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };

// happy-dom: getBoundingClientRect returns zeros; stub a 400×400 rect at origin.
function stub400(el: HTMLElement): void {
  el.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 400, width: 400, height: 400, toJSON() {} }) as DOMRect;
}

function makeHostAndCanvas(): { host: HTMLElement; eventCanvas: HTMLCanvasElement } {
  const host = document.createElement('div');
  stub400(host);
  const eventCanvas = document.createElement('canvas');
  stub400(eventCanvas);
  host.appendChild(eventCanvas);
  return { host, eventCanvas };
}

const WPP = worldPerCssPx(CAM, VP); // ≈ 0.0032 world units / css px
// O (position) handle = image of (0,0). Rotate ring = fixed px out the far side of O.
const O_SCREEN = worldToScreen({ x: 0, y: 0 }, CAM, VP);
const X_SCREEN = worldToScreen({ x: 1, y: 0 }, CAM, VP);
const ROT_SCREEN = worldToScreen(rotateAnchor(IDENT, ROT_HANDLE_PX * WPP), CAM, VP);

function down(canvas: HTMLCanvasElement, x: number, y: number, shiftKey = false): MouseEvent {
  const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, shiftKey });
  canvas.dispatchEvent(ev);
  return ev;
}
function move(x: number, y: number, shiftKey = false): void {
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, shiftKey }));
}
function up(): void { window.dispatchEvent(new MouseEvent('mouseup', {})); }

describe('attachXformGizmo (O/X/Y triangle)', () => {
  let affine: RawAffine;
  beforeEach(() => { affine = { ...IDENT }; });

  function wire(prefsEdit = true, selected = 0) {
    const onLiveEdit = vi.fn();
    const onCommit = vi.fn();
    const cb = {
      getSelectedIndex: () => selected,
      getAffine: () => affine,
      setAffine: (_i: number, r: RawAffine) => { affine = r; },
      getCamera: () => CAM,
      getViewport: () => VP,
      getPrefs: () => ({ ...GIZMO_PREFS_DEFAULT, editOnCanvas: prefsEdit }),
      onLiveEdit, onCommit,
    };
    return { cb, onLiveEdit, onCommit };
  }

  it('mounts an overlay canvas in the host and removes it on destroy', () => {
    const { host, eventCanvas } = makeHostAndCanvas();
    const { cb } = wire();
    const g = attachXformGizmo(host, eventCanvas, cb);
    g.draw();
    expect(host.querySelector('canvas.pyr3-edit-gizmo-overlay')).toBeTruthy();
    g.destroy();
    expect(host.querySelector('canvas.pyr3-edit-gizmo-overlay')).toBeFalsy();
  });

  it('dragging O translates position (c,f); basis untouched', () => {
    const { host, eventCanvas } = makeHostAndCanvas();
    const { cb, onLiveEdit, onCommit } = wire(true, 0);
    attachXformGizmo(host, eventCanvas, cb);
    down(eventCanvas, O_SCREEN.x, O_SCREEN.y);
    // +0.1 world in x = +0.1 / WPP px.
    move(O_SCREEN.x + 0.1 / WPP, O_SCREEN.y);
    up();
    expect(onLiveEdit).toHaveBeenCalledWith(0);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(affine.c).toBeCloseTo(0.1, 6);
    expect(affine.f).toBeCloseTo(0, 6);
    expect([affine.a, affine.b, affine.d, affine.e]).toEqual([1, 0, 0, 1]);
  });

  it('axis-locked X drag is pure scale — no shear (d stays 0)', () => {
    const { host, eventCanvas } = makeHostAndCanvas();
    const { cb } = wire(true, 0);
    attachXformGizmo(host, eventCanvas, cb);
    down(eventCanvas, X_SCREEN.x, X_SCREEN.y);
    move(X_SCREEN.x, X_SCREEN.y + 40); // drag perpendicular, NO shift → locked
    up();
    expect(affine.d).toBeCloseTo(0, 6);
  });

  it('Shift-drag X frees it → introduces shear (d ≠ 0)', () => {
    const { host, eventCanvas } = makeHostAndCanvas();
    const { cb } = wire(true, 0);
    attachXformGizmo(host, eventCanvas, cb);
    down(eventCanvas, X_SCREEN.x, X_SCREEN.y);
    move(X_SCREEN.x, X_SCREEN.y + 40, true); // Shift held → free
    up();
    expect(Math.abs(affine.d)).toBeGreaterThan(0.05);
  });

  it('rotating keeps position (c,f) fixed and changes the basis', () => {
    const { host, eventCanvas } = makeHostAndCanvas();
    const { cb } = wire(true, 0);
    attachXformGizmo(host, eventCanvas, cb);
    down(eventCanvas, ROT_SCREEN.x, ROT_SCREEN.y);
    // grab sits down-left of O; drag the cursor up-right of O → a large angle delta.
    move(O_SCREEN.x + 90, O_SCREEN.y - 90);
    up();
    expect(affine.c).toBeCloseTo(0, 6);
    expect(affine.f).toBeCloseTo(0, 6);
    // basis rotated away from identity
    expect(Math.abs(affine.b) + Math.abs(affine.d)).toBeGreaterThan(0.01);
  });

  it('rotation does NOT compound: repeating the same cursor pos is idempotent', () => {
    const { host, eventCanvas } = makeHostAndCanvas();
    const { cb } = wire(true, 0);
    attachXformGizmo(host, eventCanvas, cb);
    down(eventCanvas, ROT_SCREEN.x, ROT_SCREEN.y);
    const tx = ROT_SCREEN.x - 60, ty = ROT_SCREEN.y + 40;
    move(tx, ty);
    const after1 = { ...affine };
    move(tx, ty);
    move(tx, ty);
    up();
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
      expect(affine[k]).toBeCloseTo(after1[k], 9);
    }
  });

  it('does not claim drags when edit is OFF (pan keeps the event)', () => {
    const { host, eventCanvas } = makeHostAndCanvas();
    const { cb, onLiveEdit } = wire(false, 0);
    attachXformGizmo(host, eventCanvas, cb);
    const ev = down(eventCanvas, O_SCREEN.x, O_SCREEN.y);
    const stop = vi.spyOn(ev, 'stopPropagation');
    up();
    expect(onLiveEdit).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('does not claim a press far from any handle (falls through to pan)', () => {
    const { host, eventCanvas } = makeHostAndCanvas();
    const { cb, onLiveEdit } = wire(true, 0);
    attachXformGizmo(host, eventCanvas, cb);
    const ev = down(eventCanvas, 6, 6);
    const stop = vi.spyOn(ev, 'stopPropagation');
    move(40, 6);
    up();
    expect(onLiveEdit).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('is inert for the final xform (selected = -1)', () => {
    const { host, eventCanvas } = makeHostAndCanvas();
    const { cb, onLiveEdit } = wire(true, -1);
    const g = attachXformGizmo(host, eventCanvas, cb);
    g.draw();
    down(eventCanvas, O_SCREEN.x, O_SCREEN.y);
    up();
    expect(onLiveEdit).not.toHaveBeenCalled();
  });

  it('draw() handles a degenerate affine without throwing (rotate ring hidden)', () => {
    const { host, eventCanvas } = makeHostAndCanvas();
    affine = { a: 0, b: 0, c: 0.1, d: 0, e: 0, f: 0.1 };
    const { cb } = wire(true, 0);
    const g = attachXformGizmo(host, eventCanvas, cb);
    expect(() => g.draw()).not.toThrow();
  });
});
