// pyr3 — /editor mini affine viz.
//
// Draws the xform as the flam3-native O/X/Y triangle — the same representation as the
// on-canvas gizmo (#350; redesign #394/#395): a faint footprint parallelogram (the unit
// square's image) with O (position) + the two axis tips (X, Y). Static teaching aid in the
// xform detail pane. Pure 2D canvas — no engine coupling.

import type { RawAffine } from './affine-decompose';

export type { RawAffine };

export interface XformVizHandle {
  /** Redraw immediately. Caller invokes after every affine field edit. */
  draw(): void;
  /** Detach and zero the canvas. Optional but tidy on card teardown. */
  destroy(): void;
}

const COL_O = '#ff8c1a';        // origin = position
const COL_X = '#ff5fa2';        // x-axis tip
const COL_Y = '#3aa1ff';        // y-axis tip
const COL_FOOTPRINT = 'rgba(150, 150, 160, 0.45)';
const COL_FOOTPRINT_FILL = 'rgba(120, 120, 135, 0.10)';
const COL_AXIS = 'rgba(255, 255, 255, 0.10)';

/** Attach a mini viz to a canvas. `getAffine` is called fresh on every draw() so the
 *  caller can drive updates by mutating live state. */
export function attachXformViz(
  canvas: HTMLCanvasElement,
  getAffine: () => RawAffine,
): XformVizHandle {
  const ctx = canvas.getContext('2d');

  function draw(): void {
    // Pull the affine FIRST so the call is observable even when the 2D context is
    // unavailable (e.g. happy-dom test environments that return null).
    const r = getAffine();
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const worldScale = Math.min(w, h) / 4; // ~1 world unit = quarter the canvas
    // y-DOWN to match the canvas gizmo + flame render orientation (#350).
    const toScreen = (p: [number, number]): [number, number] => [cx + p[0] * worldScale, cy + p[1] * worldScale];

    // Background axes.
    ctx.strokeStyle = COL_AXIS;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
    ctx.stroke();

    if (!Number.isFinite(r.a + r.b + r.c + r.d + r.e + r.f)) return;
    const apply = (x: number, y: number): [number, number] => [r.a * x + r.b * y + r.c, r.d * x + r.e * y + r.f];
    const sO = toScreen(apply(0, 0));   // O = position
    const sX = toScreen(apply(1, 0));   // x-axis tip
    const sY = toScreen(apply(0, 1));   // y-axis tip
    const sXY = toScreen(apply(1, 1));  // far corner (closes the footprint)

    // Footprint parallelogram (faint dashed) = image of the unit square.
    ctx.beginPath();
    ctx.moveTo(sO[0], sO[1]); ctx.lineTo(sX[0], sX[1]); ctx.lineTo(sXY[0], sXY[1]); ctx.lineTo(sY[0], sY[1]);
    ctx.closePath();
    ctx.fillStyle = COL_FOOTPRINT_FILL; ctx.fill();
    ctx.save();
    ctx.setLineDash([4, 3]); ctx.strokeStyle = COL_FOOTPRINT; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();

    // Axis arms O→X (pink), O→Y (blue).
    ctx.strokeStyle = COL_X; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(sO[0], sO[1]); ctx.lineTo(sX[0], sX[1]); ctx.stroke();
    ctx.strokeStyle = COL_Y; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(sO[0], sO[1]); ctx.lineTo(sY[0], sY[1]); ctx.stroke();

    const dot = (s: [number, number], col: string, rad: number): void => {
      ctx.beginPath(); ctx.arc(s[0], s[1], rad, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    };
    dot(sX, COL_X, 3);
    dot(sY, COL_Y, 3);
    // O — emphasized white ring + orange fill (matches the gizmo).
    ctx.beginPath(); ctx.arc(sO[0], sO[1], 4.5, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    dot(sO, COL_O, 3.5);
  }

  function destroy(): void {
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return { draw, destroy };
}
