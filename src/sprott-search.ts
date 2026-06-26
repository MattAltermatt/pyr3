// src/sprott-search.ts
//
// #470 Slice 2 — CPU Lyapunov auto-search for Sprott quadratic attractors.
// Mirrors the var_sprott_poly map math (Slice 1); pure CPU, no GPU in the gate.
// Rolls random 12-coeff maps, keeps the chaotic-but-bounded + non-sparse ones,
// and builds a single-xform Sprott genome for the Creator wall.
import type { Genome, Xform } from './genome';
import { V, type Variation } from './variations';
import { generateRandomGenome } from './edit-seed';

/** 🎚️ Sacrosanct chaos-band tuning — probe-validated (2026-06-26, 99.2% f32
 *  survival; COV_MIN 8000 → ~33% of LE-vetted pass). Changing any value is a
 *  gameplay-tuning edit: ask first. */
export const SPROTT_SEARCH = {
  LE_MIN: 0.05,          // largest-Lyapunov "chaotic" threshold
  ESCAPE: 1e6,           // bounded check
  WARMUP: 1000,          // LE-estimate burn-in
  ITER: 12000,           // LE-estimate sample length
  COV_MIN: 8000,         // min distinct cells on a 220² grid
  COV_GRID: 220,
  COV_ITERS: 60000,
  SPROTT_FRACTION: 0.2,  // share of a Creator batch that is Sprott
  // Search-persistence cap (NOT a chaos-band threshold — doesn't change which
  // attractors qualify, only how long we try before falling back to a flame).
  // Accept rate is ~0.6% (LE-pass 1.9% × cov-pass 33%) → avg ~160 rolls; 600
  // keeps the give-up rate ~2%, so a fraction=0.2 wall lands ~0.2 Sprott/tile.
  MAX_VET_ROLLS: 600,
} as const;

// One map step. c[0]=const x, c[1..5]=x-row (x,x²,xy,y,y²), c[6]=const y, c[7..11]=y-row.
function step(c: number[], x: number, y: number): [number, number] {
  return [
    c[0]! + c[1]! * x + c[2]! * x * x + c[3]! * x * y + c[4]! * y + c[5]! * y * y,
    c[6]! + c[7]! * x + c[8]! * x * x + c[9]! * x * y + c[10]! * y + c[11]! * y * y,
  ];
}

/** Largest Lyapunov exponent via tangent-vector growth. -Infinity if it escapes. */
export function lyapunov(c: number[]): number {
  let x = 0.05, y = 0.05, dx = 1e-6, dy = 0, lsum = 0, n = 0;
  const { WARMUP, ITER, ESCAPE } = SPROTT_SEARCH;
  for (let i = 0; i < WARMUP + ITER; i++) {
    const j00 = c[1]! + 2 * c[2]! * x + c[3]! * y;
    const j01 = c[3]! * x + c[4]! + 2 * c[5]! * y;
    const j10 = c[7]! + 2 * c[8]! * x + c[9]! * y;
    const j11 = c[9]! * x + c[10]! + 2 * c[11]! * y;
    const ndx = j00 * dx + j01 * dy, ndy = j10 * dx + j11 * dy;
    const norm = Math.hypot(ndx, ndy);
    if (!Number.isFinite(norm) || norm === 0) return -Infinity;
    if (i >= WARMUP) { lsum += Math.log(norm); n++; }
    dx = ndx / norm; dy = ndy / norm;
    [x, y] = step(c, x, y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > ESCAPE || Math.abs(y) > ESCAPE) return -Infinity;
  }
  return lsum / n;
}

/** Post-warmup point cloud of the attractor (shared by coverage + viewport). */
function sampleCloud(c: number[]): [number, number][] {
  const { COV_ITERS, ESCAPE } = SPROTT_SEARCH;
  let x = 0.05, y = 0.05;
  const pts: [number, number][] = [];
  for (let i = 0; i < COV_ITERS; i++) {
    [x, y] = step(c, x, y);
    if (!Number.isFinite(x) || Math.abs(x) > ESCAPE) break;
    if (i > 300) pts.push([x, y]);
  }
  return pts;
}

/** Distinct grid cells the attractor fills (richness proxy). */
export function coverage(c: number[]): number {
  const pts = sampleCloud(c);
  const G = SPROTT_SEARCH.COV_GRID;
  if (pts.length < 500) return 0;
  let a = Infinity, b = -Infinity, d = Infinity, e = -Infinity;
  for (const [px, py] of pts) { a = Math.min(a, px); b = Math.max(b, px); d = Math.min(d, py); e = Math.max(e, py); }
  const sx = (G - 1) / (b - a || 1), sy = (G - 1) / (e - d || 1), cells = new Set<number>();
  for (const [px, py] of pts) cells.add(Math.floor((px - a) * sx) * G + Math.floor((py - d) * sy));
  return cells.size;
}

const SPROTT_FIT_MARGIN = 0.85;

/** Viewport framing the attractor's dense core (1–99 percentile bbox). Self-
 *  contained on purpose: `computeFitViewport`'s no-jitter CPU sampler COLLAPSES
 *  ~40% of vetted Sprott attractors (#443) → null → fallback, diluting the
 *  feature. This percentile bbox framed all 3 Slice-1 fixtures correctly. */
export function sprottViewport(c: number[], fitW: number, fitH: number): { scale: number; cx: number; cy: number } | null {
  const pts = sampleCloud(c);
  if (pts.length < 500) return null;
  const xs = pts.map((p) => p[0]).sort((m, n) => m - n);
  const ys = pts.map((p) => p[1]).sort((m, n) => m - n);
  const lo = (s: number[]) => s[Math.floor(s.length * 0.01)]!;
  const hi = (s: number[]) => s[Math.floor(s.length * 0.99)]!;
  const x0 = lo(xs), x1 = hi(xs), y0 = lo(ys), y1 = hi(ys);
  const range = Math.max(x1 - x0, y1 - y0);
  if (!Number.isFinite(range) || range < 1e-3) return null;
  return { scale: (SPROTT_FIT_MARGIN * Math.min(fitW, fitH)) / range, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/** Roll random 12-coeff maps until one passes both gates, or give up (null). */
export function vetSprottCoeffs(rng: () => number, maxRolls: number = SPROTT_SEARCH.MAX_VET_ROLLS): number[] | null {
  for (let r = 0; r < maxRolls; r++) {
    const c = Array.from({ length: 12 }, () => -1.2 + 2.4 * rng());
    if (lyapunov(c) > SPROTT_SEARCH.LE_MIN && coverage(c) > SPROTT_SEARCH.COV_MIN) return c;
  }
  return null;
}

/** Build the single Sprott xform: identity pre-affine, sprott_poly w=1 with the
 *  10 linear+quadratic coeffs, post-affine translate carrying the 2 constants. */
export function sprottXform(c: number[], color: number): Xform {
  const v: Variation = {
    index: V.sprott_poly, weight: 1,
    param0: c[1], param1: c[2], param2: c[3], param3: c[4], param4: c[5],
    param5: c[7], param6: c[8], param7: c[9], param8: c[10], param9: c[11],
  };
  return {
    a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
    weight: 1, color, colorSpeed: 0,
    variations: [v],
    post: { a: 1, b: 0, c: c[0]!, d: 0, e: 1, f: c[6]! },
  };
}

/** Vet → build a Sprott genome reusing the random recipe's palette/tonemap/density.
 *  Returns null on give-up (caller falls back to a normal flame) or unfittable. */
export function generateSprottGenome(rng: () => number, fitW = 1024, fitH = 1024): Genome | null {
  const coeffs = vetSprottCoeffs(rng);
  if (!coeffs) return null;
  const vp = sprottViewport(coeffs, fitW, fitH);
  if (!vp) return null;                     // coverage gate makes this ~never fire
  const g = generateRandomGenome(rng);     // inherit vibrant palette / tonemap / density
  g.symmetry = undefined;                  // single deterministic map — no symmetry expansion
  g.xforms = [sprottXform(coeffs, rng())];
  g.scale = vp.scale; g.cx = vp.cx; g.cy = vp.cy;
  return g;
}
