// pyr3 — /editor screen-fixed compositional overlays (#364). SEAM_EXEMPT.
//
// A 2D canvas layered over the WebGPU preview, drawing composition guides
// (rule-of-thirds, center cross, grid, concentric rings, radial spokes) in
// SCREEN space relative to the letterbox-corrected content rect. The guides do
// NOT move with the flame (not camera-projected) — they're a fixed viewfinder
// the user composes the attractor against. pointer-events:none; redraws only on
// pref change + resize (no per-frame cost). One 2D canvas, no per-handle DOM.

import type { ComposePrefs } from './edit-state';

export interface Rect { x: number; y: number; w: number; h: number; }
export type Line = [number, number, number, number]; // x0,y0,x1,y1

/** Rule-of-thirds: vertical lines at 1/3,2/3 of width; horizontal at 1/3,2/3 of height. */
export function thirdsLines(r: Rect): Line[] {
  const x1 = r.x + r.w / 3, x2 = r.x + (2 * r.w) / 3;
  const y1 = r.y + r.h / 3, y2 = r.y + (2 * r.h) / 3;
  return [
    [x1, r.y, x1, r.y + r.h], [x2, r.y, x2, r.y + r.h],
    [r.x, y1, r.x + r.w, y1], [r.x, y2, r.x + r.w, y2],
  ];
}

/** N×N grid: n cells per axis → n-1 evenly spaced interior lines per axis. */
export function gridLines(r: Rect, n: number): Line[] {
  const lines: Line[] = [];
  for (let i = 1; i < n; i++) {
    const x = r.x + (r.w * i) / n;
    const y = r.y + (r.h * i) / n;
    lines.push([x, r.y, x, r.y + r.h]);
    lines.push([r.x, y, r.x + r.w, y]);
  }
  return lines;
}

/** Concentric rings: centered, radii at 1/3,2/3,1 of the inscribed radius. */
export function ringRadii(r: Rect): { cx: number; cy: number; radii: [number, number, number] } {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const R = Math.min(r.w, r.h) / 2;
  return { cx, cy, radii: [R / 3, (2 * R) / 3, R] };
}

/** Radial spokes: `fold` lines from center outward to the inscribed radius. */
export function spokeLines(r: Rect, fold: number): Line[] {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const R = Math.min(r.w, r.h) / 2;
  const n = Math.max(2, Math.min(12, Math.round(fold)));
  const lines: Line[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    lines.push([cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
  }
  return lines;
}

/** Whether any guide should currently draw: master on AND at least one selected.
 *  Reused by the chrome's active-dot so the button and the canvas agree. */
export function composeShows(p: ComposePrefs): boolean {
  return p.composeOn && (p.thirds || p.center || p.grid || p.rings || p.spokes);
}

export interface ComposeOverlayCallbacks {
  getPrefs: () => ComposePrefs;
  /** Letterbox-corrected content rect in host-element CSS px (top-left origin). */
  getContentRect: () => Rect;
}
export interface ComposeOverlayHandle {
  draw(): void;
  resize(): void;
  destroy(): void;
}

const HALO = 'rgba(0,0,0,0.45)';
const LINE = 'rgba(255,255,255,0.30)';
const GRID_N = 4; // full-frame grid density (4 cells/axis)

export function attachComposeOverlay(host: HTMLElement, cb: ComposeOverlayCallbacks): ComposeOverlayHandle {
  const canvas = document.createElement('canvas');
  canvas.className = 'pyr3-edit-compose-overlay';
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.pointerEvents = 'none';
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  function resizeBacking(): void {
    const rect = host.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
  }

  /** Two-pass stroke: dark halo under a light line so guides read over any flame. */
  function strokeLines(lines: Line[]): void {
    if (!ctx) return;
    for (const pass of [{ c: HALO, w: 3 }, { c: LINE, w: 1 }]) {
      ctx.strokeStyle = pass.c; ctx.lineWidth = pass.w;
      ctx.beginPath();
      for (const [x0, y0, x1, y1] of lines) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
      ctx.stroke();
    }
  }
  function strokeArcs(cx: number, cy: number, radii: number[]): void {
    if (!ctx) return;
    for (const pass of [{ c: HALO, w: 3 }, { c: LINE, w: 1 }]) {
      ctx.strokeStyle = pass.c; ctx.lineWidth = pass.w;
      for (const rad of radii) { ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke(); }
    }
  }

  function draw(): void {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const p = cb.getPrefs();
    if (!composeShows(p)) return; // master off OR nothing selected (selections preserved)
    const r = cb.getContentRect();
    if (!(r.w > 0 && r.h > 0)) return;
    if (p.grid) strokeLines(gridLines(r, GRID_N));
    if (p.thirds) strokeLines(thirdsLines(r));
    if (p.center) {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      strokeLines([[cx, r.y, cx, r.y + r.h], [r.x, cy, r.x + r.w, cy]]);
    }
    if (p.rings) { const { cx, cy, radii } = ringRadii(r); strokeArcs(cx, cy, radii); }
    if (p.spokes) strokeLines(spokeLines(r, p.spokeFold));
  }

  resizeBacking();
  draw();

  return {
    draw,
    resize(): void { resizeBacking(); draw(); },
    destroy(): void { canvas.remove(); },
  };
}
