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

/** Golden-ratio (Fibonacci) spiral as a polyline, fit to the content rect (#402).
 *  A logarithmic spiral r = e^(bθ) with b = ln(φ)/(π/2), so r grows by φ every
 *  quarter-turn. The tight inner end is the spiral's pole — the "eye" the user
 *  composes the flame core onto. `orient` (0..3) flips the spiral about the rect
 *  center across the X and/or Y axis, giving the 4 quadrant orientations. */
export function goldenSpiralPoints(r: Rect, orient: number): Array<[number, number]> {
  const PHI = (1 + Math.sqrt(5)) / 2;
  const b = Math.log(PHI) / (Math.PI / 2);
  const TH_MAX = Math.PI * 4; // two full turns reads as a recognisable nautilus
  const STEPS = 200;
  const raw: Array<[number, number]> = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i <= STEPS; i++) {
    const th = (i / STEPS) * TH_MAX;
    const rad = Math.exp(b * th);
    const x = Math.cos(th) * rad, y = Math.sin(th) * rad;
    raw.push([x, y]);
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  // Fit the spiral's bbox inside the rect (uniform scale, centered), then apply
  // the orientation flip about the rect center.
  const sw = maxX - minX, sh = maxY - minY;
  const scale = Math.min(r.w / sw, r.h / sh);
  const ox = r.x + (r.w - sw * scale) / 2 - minX * scale;
  const oy = r.y + (r.h - sh * scale) / 2 - minY * scale;
  const flipX = orient === 1 || orient === 2;
  const flipY = orient === 2 || orient === 3;
  const ccx = r.x + r.w / 2, ccy = r.y + r.h / 2;
  return raw.map(([x, y]) => {
    let px = ox + x * scale, py = oy + y * scale;
    if (flipX) px = 2 * ccx - px;
    if (flipY) py = 2 * ccy - py;
    return [px, py];
  });
}

/** #403 — resolve the spokes fold: in auto mode use the genome's symmetry order
 *  (when present), otherwise the manual stepper. Pure so it's testable without a
 *  2D context (which happy-dom doesn't provide). */
export function resolveSpokeFold(p: ComposePrefs, symmetryFold: number | null): number {
  return (p.spokesAuto ? symmetryFold : null) ?? p.spokeFold;
}

/** Whether any compose guide is selected, independent of the master toggle.
 *  Single source of truth for the guide set so adding a guide (#402 spiral)
 *  can't drift between callers. */
export function anyComposeGuideSelected(p: ComposePrefs): boolean {
  return p.thirds || p.center || p.grid || p.rings || p.spokes || p.goldenSpiral;
}

/** Whether any guide should currently draw: master on AND at least one selected.
 *  Reused by the chrome's active-dot so the button and the canvas agree. */
export function composeShows(p: ComposePrefs): boolean {
  return p.composeOn && anyComposeGuideSelected(p);
}

export interface ComposeOverlayCallbacks {
  getPrefs: () => ComposePrefs;
  /** Letterbox-corrected content rect in host-element CSS px (top-left origin). */
  getContentRect: () => Rect;
  /** #403 — the genome's rotational-symmetry order, or null when none. Drives
   *  the spokes "auto" mode; omit (or return null) to always use spokeFold. */
  getSymmetryFold?: () => number | null;
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
  /** Two-pass stroke of a connected polyline (the golden spiral, #402). */
  function strokePolyline(pts: Array<[number, number]>): void {
    if (!ctx || pts.length < 2) return;
    for (const pass of [{ c: HALO, w: 3 }, { c: LINE, w: 1 }]) {
      ctx.strokeStyle = pass.c; ctx.lineWidth = pass.w;
      ctx.beginPath();
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
      ctx.stroke();
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
    if (p.spokes) {
      // #403 — auto mode snaps the fold to the genome's rotational symmetry
      // order, falling back to the manual stepper when there's no symmetry.
      strokeLines(spokeLines(r, resolveSpokeFold(p, cb.getSymmetryFold?.() ?? null)));
    }
    if (p.goldenSpiral) strokePolyline(goldenSpiralPoints(r, p.spiralOrient));
  }

  resizeBacking();
  draw();

  return {
    draw,
    resize(): void { resizeBacking(); draw(); },
    destroy(): void { canvas.remove(); },
  };
}
