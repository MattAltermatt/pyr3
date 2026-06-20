import { describe, it, expect } from 'vitest';
import { computeFitView } from './edit-fit-handles';
import { applyViewToCamera, worldToScreen, type Camera, type Viewport } from './edit-camera-projection';
import { applyAffine, type RawAffine } from './edit-xform-gizmo-math';

const VP: Viewport = { rectWidth: 400, rectHeight: 400, intrinsicWidth: 256, intrinsicHeight: 256 };
const IDENT: RawAffine = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };

describe('computeFitView', () => {
  it('centers the handle box at the frame center', () => {
    const cam: Camera = { cx: 0, cy: 0, scale: 200, rotateDeg: 0 };
    const view = computeFitView(IDENT, cam, VP);
    const composed = applyViewToCamera(cam, view);
    // Box = the footprint (unit square's image). For identity the corners span
    // [0,1]×[0,1] → center (0.5, 0.5). (Rotate handle excluded from the fit.)
    expect(composed.cx).toBeCloseTo(0.5, 6);
    expect(composed.cy).toBeCloseTo(0.5, 6);
  });

  it('frames every handle inside the contained rect with margin', () => {
    const cam: Camera = { cx: 3, cy: -2, scale: 800, rotateDeg: 17 }; // tight, off-center
    const view = computeFitView(IDENT, cam, VP);
    const composed = applyViewToCamera(cam, view);
    const corners = [
      applyAffine(IDENT, 0, 0), applyAffine(IDENT, 1, 0),
      applyAffine(IDENT, 0, 1), applyAffine(IDENT, 1, 1),
    ];
    for (const p of corners) {
      const s = worldToScreen(p, composed, VP);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(VP.rectWidth);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(VP.rectHeight);
    }
  });

  it('zooms IN for a tiny affine (handles much smaller than the frame)', () => {
    const cam: Camera = { cx: 0, cy: 0, scale: 200, rotateDeg: 0 };
    const tiny: RawAffine = { a: 0.05, b: 0, c: 0, d: 0, e: 0.05, f: 0 };
    const view = computeFitView(tiny, cam, VP);
    expect(view.zoom).toBeGreaterThan(1); // must zoom in to frame a small xform
  });

  it('returns identity for a degenerate (zero-extent) affine', () => {
    const cam: Camera = { cx: 0, cy: 0, scale: 200, rotateDeg: 0 };
    const degenerate: RawAffine = { a: 0, b: 0, c: 0.5, d: 0, e: 0, f: 0.5 };
    expect(computeFitView(degenerate, cam, VP)).toEqual({ panX: 0, panY: 0, zoom: 1 });
  });
});
