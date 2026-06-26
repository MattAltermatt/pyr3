// src/attractor-search.ts
//
// Map-agnostic CPU auto-search core for single-map strange attractors. Extracted
// from the #470 Sprott search (sprott-search.ts) so #466 Hopalong + #467
// Gumowski-Mira reuse the same Lyapunov / coverage / viewport / genome machinery.
// Pure CPU, no GPU. A map supplies a StepFn (current point → next point) and,
// for the analytic Lyapunov gate, a JacobianFn. The numerics here reproduce the
// original Sprott search EXACTLY (probe-validated seeds, warmups, percentile-bbox
// framing) so refactoring Sprott onto this core is behaviour-preserving.
import type { Genome, Xform } from './genome';
import { generateRandomGenome } from './edit-seed';

export type StepFn = (x: number, y: number) => [number, number];
/** 2x2 Jacobian [∂x'/∂x, ∂x'/∂y, ∂y'/∂x, ∂y'/∂y] at (x,y). */
export type JacobianFn = (x: number, y: number) => [number, number, number, number];

export interface AttractorConfig {
  lyapWarmup: number;   // Lyapunov-estimate burn-in
  lyapIter: number;     // Lyapunov-estimate sample length
  escape: number;       // bounded-check threshold
  cloudWarmup: number;  // sampleCloud discards the first `cloudWarmup` points
  covIters: number;     // sampleCloud iteration count
  covGrid: number;      // coverage grid resolution (covGrid² cells)
  minPts: number;       // below this many cloud points → coverage 0 / viewport null
  fitMargin: number;    // viewport fill fraction
  fitPctLo: number;     // lower percentile for the framing bbox
  fitPctHi: number;     // upper percentile for the framing bbox
  fitMinRange: number;  // collapse guard — null viewport below this extent
}

/** Largest Lyapunov exponent via tangent-vector growth. -Infinity if it escapes.
 *  Requires an analytic Jacobian → smooth maps only (e.g. Sprott, Gumowski-Mira;
 *  NOT Hopalong, whose √|·| derivative is singular). Seeds match the original
 *  Sprott search (x=y=0.05, tangent dx=1e-6). */
export function lyapunov(step: StepFn, jac: JacobianFn, cfg: AttractorConfig): number {
  let x = 0.05, y = 0.05, dx = 1e-6, dy = 0, lsum = 0, n = 0;
  for (let i = 0; i < cfg.lyapWarmup + cfg.lyapIter; i++) {
    const [j00, j01, j10, j11] = jac(x, y);
    const ndx = j00 * dx + j01 * dy, ndy = j10 * dx + j11 * dy;
    const norm = Math.hypot(ndx, ndy);
    if (!Number.isFinite(norm) || norm === 0) return -Infinity;
    if (i >= cfg.lyapWarmup) { lsum += Math.log(norm); n++; }
    dx = ndx / norm; dy = ndy / norm;
    [x, y] = step(x, y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > cfg.escape || Math.abs(y) > cfg.escape) return -Infinity;
  }
  return lsum / n;
}

/** Post-warmup point cloud of the attractor (shared by coverage + viewport).
 *  Matches the original Sprott sampleCloud: seed 0.05, break on non-finite or
 *  |x|>escape, keep points after `cloudWarmup`. */
function sampleCloud(step: StepFn, cfg: AttractorConfig): [number, number][] {
  let x = 0.05, y = 0.05;
  const pts: [number, number][] = [];
  for (let i = 0; i < cfg.covIters; i++) {
    [x, y] = step(x, y);
    if (!Number.isFinite(x) || Math.abs(x) > cfg.escape) break;
    if (i > cfg.cloudWarmup) pts.push([x, y]);
  }
  return pts;
}

/** Distinct grid cells the attractor fills (richness proxy). 0 if too sparse. */
export function coverage(step: StepFn, cfg: AttractorConfig): number {
  const pts = sampleCloud(step, cfg);
  const G = cfg.covGrid;
  if (pts.length < cfg.minPts) return 0;
  let a = Infinity, b = -Infinity, d = Infinity, e = -Infinity;
  for (const [px, py] of pts) { a = Math.min(a, px); b = Math.max(b, px); d = Math.min(d, py); e = Math.max(e, py); }
  const sx = (G - 1) / (b - a || 1), sy = (G - 1) / (e - d || 1), cells = new Set<number>();
  for (const [px, py] of pts) cells.add(Math.floor((px - a) * sx) * G + Math.floor((py - d) * sy));
  return cells.size;
}

/** Viewport framing the attractor's dense core (percentile bbox). Self-contained:
 *  the editor's no-jitter CPU fit COLLAPSES ~40% of vetted attractors (#443), so
 *  this percentile bbox is used instead. Null if too sparse or collapsed. */
export function attractorViewport(
  step: StepFn, cfg: AttractorConfig, fitW: number, fitH: number,
): { scale: number; cx: number; cy: number } | null {
  const pts = sampleCloud(step, cfg);
  if (pts.length < cfg.minPts) return null;
  const xs = pts.map((p) => p[0]).sort((m, n) => m - n);
  const ys = pts.map((p) => p[1]).sort((m, n) => m - n);
  const lo = (s: number[]): number => s[Math.floor(s.length * cfg.fitPctLo)]!;
  const hi = (s: number[]): number => s[Math.floor(s.length * cfg.fitPctHi)]!;
  const x0 = lo(xs), x1 = hi(xs), y0 = lo(ys), y1 = hi(ys);
  const range = Math.max(x1 - x0, y1 - y0);
  if (!Number.isFinite(range) || range < cfg.fitMinRange) return null;
  return { scale: (cfg.fitMargin * Math.min(fitW, fitH)) / range, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/** Vet → frame → build a single-xform attractor genome, inheriting a random
 *  recipe's palette/tonemap/density. `buildXform(color)` packs the (already-vetted)
 *  map into one xform; `step` re-samples the cloud for framing. The rng draw order
 *  (generateRandomGenome, then one rng() for color) matches the original Sprott
 *  generator so fixed-seed output is unchanged. Null on unfittable framing. */
export function buildAttractorGenome(
  rng: () => number, buildXform: (color: number) => Xform, step: StepFn,
  cfg: AttractorConfig, fitW: number, fitH: number,
): Genome | null {
  const vp = attractorViewport(step, cfg, fitW, fitH);
  if (!vp) return null;
  const g = generateRandomGenome(rng);     // inherit vibrant palette / tonemap / density
  g.symmetry = undefined;                  // single deterministic map — no symmetry expansion
  g.xforms = [buildXform(rng())];
  g.scale = vp.scale; g.cx = vp.cx; g.cy = vp.cy;
  return g;
}
