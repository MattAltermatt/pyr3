import { describe, it, expect } from 'vitest';
import {
  containedRect,
  worldPerCssPx,
  worldToScreen,
  screenToWorld,
  applyViewToCamera,
  IDENTITY_VIEW,
  type Camera,
  type Viewport,
} from './edit-camera-projection';

// A square 400×400 element showing a square 256×256 genome at scale 200,
// camera centered at world origin, no rotation.
const VP: Viewport = { rectWidth: 400, rectHeight: 400, intrinsicWidth: 256, intrinsicHeight: 256 };
const CAM: Camera = { cx: 0, cy: 0, scale: 200, rotateDeg: 0 };

describe('edit-camera-projection', () => {
  it('contains a square genome edge-to-edge in a square element', () => {
    const r = containedRect(VP);
    expect(r.w).toBeCloseTo(400);
    expect(r.h).toBeCloseTo(400);
    expect(r.padX).toBeCloseTo(0);
    expect(r.padY).toBeCloseTo(0);
  });

  it('letterboxes a wide element (padX > 0)', () => {
    const r = containedRect({ ...VP, rectWidth: 800 });
    expect(r.w).toBeCloseTo(400);
    expect(r.padX).toBeCloseTo(200);
  });

  it('maps the camera center to the contained-rect center', () => {
    const p = worldToScreen({ x: CAM.cx, y: CAM.cy }, CAM, VP);
    expect(p.x).toBeCloseTo(200);
    expect(p.y).toBeCloseTo(200);
  });

  it('round-trips world → screen → world for an off-center, rotated camera', () => {
    const cam: Camera = { cx: 0.3, cy: -0.7, scale: 180, rotateDeg: 37 };
    const world = { x: 1.4, y: 0.55 };
    const screen = worldToScreen(world, cam, VP);
    const back = screenToWorld(screen, cam, VP);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
  });

  it('agrees with the documented pan inverse (worldPerCssPx)', () => {
    // worldPerCssPx = intrinsicWidth / scale / containedWidth = 256 / 200 / 400.
    expect(worldPerCssPx(CAM, VP)).toBeCloseTo(256 / 200 / 400, 9);
  });

  it('is consistent with the pan-nav screen→world delta convention', () => {
    // Drag-right (screen +x) at θ=0 should map to world +x.
    const wpx = worldPerCssPx(CAM, VP);
    const center = worldToScreen({ x: 0, y: 0 }, CAM, VP);
    const w = screenToWorld({ x: center.x + 1, y: center.y }, CAM, VP);
    expect(w.x).toBeCloseTo(wpx, 9);
    expect(w.y).toBeCloseTo(0, 9);
  });
});

describe('applyViewToCamera', () => {
  it('identity view returns an equal camera', () => {
    expect(applyViewToCamera(CAM, IDENTITY_VIEW)).toEqual(CAM);
  });

  it('zoom multiplies scale, leaves rotation', () => {
    const out = applyViewToCamera({ ...CAM, rotateDeg: 30 }, { panX: 0, panY: 0, zoom: 2 });
    expect(out.scale).toBeCloseTo(CAM.scale * 2);
    expect(out.rotateDeg).toBe(30);
    expect(out.cx).toBeCloseTo(CAM.cx);
  });

  it('pan offsets cx/cy by panX/zoom', () => {
    const out = applyViewToCamera(CAM, { panX: 0.6, panY: -0.4, zoom: 2 });
    expect(out.cx).toBeCloseTo(CAM.cx + 0.6 / 2);
    expect(out.cy).toBeCloseTo(CAM.cy - 0.4 / 2);
  });

  it('composing a 2× view zoom matches projecting through the composed camera', () => {
    const view = { panX: 0.3, panY: 0.2, zoom: 2 };
    const composed = applyViewToCamera(CAM, view);
    // A world point projects identically whether we pass the composed camera
    // or hand-roll the composition — the view IS just a camera substitution.
    const world = { x: 1.1, y: -0.7 };
    const viaComposed = worldToScreen(world, composed, VP);
    const viaManual = worldToScreen(world, {
      cx: CAM.cx + view.panX / view.zoom,
      cy: CAM.cy + view.panY / view.zoom,
      scale: CAM.scale * view.zoom,
      rotateDeg: CAM.rotateDeg,
    }, VP);
    expect(viaComposed.x).toBeCloseTo(viaManual.x, 9);
    expect(viaComposed.y).toBeCloseTo(viaManual.y, 9);
  });
});
