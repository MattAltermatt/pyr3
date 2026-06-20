// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attachXformGizmo } from './edit-xform-gizmo';
import { worldToScreen, type Camera, type Viewport } from './edit-camera-projection';
import type { RawAffine } from './edit-xform-gizmo-math';
import { GIZMO_PREFS_DEFAULT } from './edit-state';

const CAM: Camera = { cx: 0, cy: 0, scale: 200, rotateDeg: 0 };
const VP: Viewport = { rectWidth: 400, rectHeight: 400, intrinsicWidth: 256, intrinsicHeight: 256 };

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

// The center handle is the image of (0.5,0.5); project it to confirm the click point.
const CENTER_SCREEN = worldToScreen({ x: 0.5, y: 0.5 }, CAM, VP); // → (356.25, 356.25)

describe('attachXformGizmo', () => {
  let affine: RawAffine;
  beforeEach(() => { affine = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 }; });

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

  it('claims a handle drag and writes the affine live (edit ON)', () => {
    const { host, eventCanvas } = makeHostAndCanvas();
    const { cb, onLiveEdit, onCommit } = wire(true, 0);
    attachXformGizmo(host, eventCanvas, cb);
    eventCanvas.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, clientX: CENTER_SCREEN.x, clientY: CENTER_SCREEN.y,
    }));
    // Drag +0.1 world in x: +0.1 / worldPerCssPx (256/200/400 = 0.0032) = +31.25 px.
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: CENTER_SCREEN.x + 31.25, clientY: CENTER_SCREEN.y }));
    window.dispatchEvent(new MouseEvent('mouseup', {}));
    expect(onLiveEdit).toHaveBeenCalledWith(0);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(affine.c).toBeCloseTo(0.1, 6); // moved +0.1 in x
    expect(affine.f).toBeCloseTo(0, 6);
  });

  it('does not claim drags when edit is OFF (pan keeps the event)', () => {
    const { host, eventCanvas } = makeHostAndCanvas();
    const { cb, onLiveEdit } = wire(false, 0);
    attachXformGizmo(host, eventCanvas, cb);
    const ev = new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, clientX: CENTER_SCREEN.x, clientY: CENTER_SCREEN.y,
    });
    const stop = vi.spyOn(ev, 'stopPropagation');
    eventCanvas.dispatchEvent(ev);
    window.dispatchEvent(new MouseEvent('mouseup', {}));
    expect(onLiveEdit).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('does not claim a press far from any handle (falls through to pan)', () => {
    const { host, eventCanvas } = makeHostAndCanvas();
    const { cb, onLiveEdit } = wire(true, 0);
    attachXformGizmo(host, eventCanvas, cb);
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 });
    const stop = vi.spyOn(ev, 'stopPropagation');
    eventCanvas.dispatchEvent(ev);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 10 }));
    window.dispatchEvent(new MouseEvent('mouseup', {}));
    expect(onLiveEdit).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('is inert for the final xform (selected = -1)', () => {
    const { host, eventCanvas } = makeHostAndCanvas();
    const { cb, onLiveEdit } = wire(true, -1);
    const g = attachXformGizmo(host, eventCanvas, cb);
    g.draw();
    eventCanvas.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, clientX: CENTER_SCREEN.x, clientY: CENTER_SCREEN.y,
    }));
    window.dispatchEvent(new MouseEvent('mouseup', {}));
    expect(onLiveEdit).not.toHaveBeenCalled();
  });

  it('rotation does NOT compound: repeating the same cursor pos is idempotent', () => {
    const { host, eventCanvas } = makeHostAndCanvas();
    const { cb } = wire(true, 0);
    attachXformGizmo(host, eventCanvas, cb);
    // Rotate handle = apply(0.5,-0.5) → screen via projection.
    const rotScreen = worldToScreen({ x: 0.5, y: -0.5 }, CAM, VP);
    eventCanvas.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, clientX: rotScreen.x, clientY: rotScreen.y,
    }));
    const target = { clientX: CENTER_SCREEN.x - 150, clientY: CENTER_SCREEN.y };
    window.dispatchEvent(new MouseEvent('mousemove', target));
    const after1 = { ...affine };
    // Move to the SAME point twice more — with the compounding bug these would
    // keep rotating; the fix makes them identical to a single application.
    window.dispatchEvent(new MouseEvent('mousemove', target));
    window.dispatchEvent(new MouseEvent('mousemove', target));
    window.dispatchEvent(new MouseEvent('mouseup', {}));
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
      expect(affine[k]).toBeCloseTo(after1[k], 9);
    }
  });
});
