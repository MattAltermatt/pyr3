// pyr3 — /v1/edit mini affine viz.
//
// Draws the unit square (orange) and its image after the affine (blue) on a
// small 2D canvas. Used in expanded xform cards as a live "what does this
// affine do?" teaching aid. Pure 2D canvas — no engine coupling.

import type { RawAffine } from './affine-decompose';

export type { RawAffine };

export interface XformVizHandle {
  /** Redraw immediately. Caller invokes after every affine field edit. */
  draw(): void;
  /** Detach and zero the canvas. Optional but tidy on card teardown. */
  destroy(): void;
}

const COLOR_INPUT_STROKE = '#ff8c1a';
const COLOR_INPUT_FILL = 'rgba(255, 140, 26, 0.15)';
const COLOR_OUTPUT_STROKE = '#3aa1ff';
const COLOR_OUTPUT_FILL = 'rgba(58, 161, 255, 0.18)';
const COLOR_AXIS = 'rgba(255, 255, 255, 0.10)';

/** Attach a mini viz to a canvas. `getAffine` is called fresh on every
 *  draw() so the caller can drive updates by mutating live state. */
export function attachXformViz(
  canvas: HTMLCanvasElement,
  getAffine: () => RawAffine,
): XformVizHandle {
  const ctx = canvas.getContext('2d');

  function draw(): void {
    // Pull the affine FIRST so the call is observable even when 2D context is
    // unavailable (e.g. happy-dom test environments that return null).
    const r = getAffine();
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const worldScale = Math.min(w, h) / 4; // ~1 world unit = quarter the canvas
    // y-DOWN to match the canvas gizmo + flame render orientation (#350). The
    // earlier y-up convention mirrored the square vertically vs the canvas.
    const toScreen = (x: number, y: number): [number, number] => [cx + x * worldScale, cy + y * worldScale];

    // Axes
    ctx.strokeStyle = COLOR_AXIS;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();

    // Input unit square
    const square: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
    ctx.fillStyle = COLOR_INPUT_FILL;
    ctx.strokeStyle = COLOR_INPUT_STROKE;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    square.forEach(([x, y], i) => {
      const [px, py] = toScreen(x, y);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Output: image of square under the affine
    if (!Number.isFinite(r.a + r.b + r.c + r.d + r.e + r.f)) return;
    const apply = (x: number, y: number): [number, number] => [r.a * x + r.b * y + r.c, r.d * x + r.e * y + r.f];
    ctx.fillStyle = COLOR_OUTPUT_FILL;
    ctx.strokeStyle = COLOR_OUTPUT_STROKE;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    square.forEach(([x, y], i) => {
      const [wx, wy] = apply(x, y);
      const [px, py] = toScreen(wx, wy);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function destroy(): void {
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return { draw, destroy };
}
