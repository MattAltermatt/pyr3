// src/sprott-search.ts
//
// #470 Slice 2 — CPU Lyapunov auto-search for Sprott quadratic attractors.
// Mirrors the var_sprott_poly map math (Slice 1); pure CPU, no GPU in the gate.
// Rolls random 12-coeff maps, keeps the chaotic-but-bounded + non-sparse ones,
// and builds a single-xform Sprott genome for the Creator wall.
//
// The Lyapunov / coverage / viewport / genome machinery lives in the map-agnostic
// `attractor-search.ts` core (shared with #466 Hopalong + #467 Gumowski-Mira).
// This module is the Sprott-specific config: the 12-coeff quadratic step + its
// Jacobian, the roll range, and the 12-coeff → 10-param + post-affine packing.
import type { Genome, Xform } from './genome';
import { V, type Variation } from './variations';
import * as core from './attractor-search';

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

/** Sprott's attractor-search config — reproduces the original numerics exactly
 *  (cloud warmup 300, minPts 500, percentile-bbox framing) so the core gives
 *  byte-identical results to the pre-refactor module. */
const SPROTT_CFG: core.AttractorConfig = {
  lyapWarmup: SPROTT_SEARCH.WARMUP,
  lyapIter: SPROTT_SEARCH.ITER,
  escape: SPROTT_SEARCH.ESCAPE,
  cloudWarmup: 300,
  covIters: SPROTT_SEARCH.COV_ITERS,
  covGrid: SPROTT_SEARCH.COV_GRID,
  minPts: 500,
  fitMargin: 0.85,
  fitPctLo: 0.01,
  fitPctHi: 0.99,
  fitMinRange: 1e-3,
};

// One map step. c[0]=const x, c[1..5]=x-row (x,x²,xy,y,y²), c[6]=const y, c[7..11]=y-row.
function sprottStep(c: number[]): core.StepFn {
  return (x, y) => [
    c[0]! + c[1]! * x + c[2]! * x * x + c[3]! * x * y + c[4]! * y + c[5]! * y * y,
    c[6]! + c[7]! * x + c[8]! * x * x + c[9]! * x * y + c[10]! * y + c[11]! * y * y,
  ];
}
function sprottJac(c: number[]): core.JacobianFn {
  return (x, y) => [
    c[1]! + 2 * c[2]! * x + c[3]! * y,
    c[3]! * x + c[4]! + 2 * c[5]! * y,
    c[7]! + 2 * c[8]! * x + c[9]! * y,
    c[9]! * x + c[10]! + 2 * c[11]! * y,
  ];
}

/** Largest Lyapunov exponent via tangent-vector growth. -Infinity if it escapes. */
export function lyapunov(c: number[]): number {
  return core.lyapunov(sprottStep(c), sprottJac(c), SPROTT_CFG);
}

/** Distinct grid cells the attractor fills (richness proxy). */
export function coverage(c: number[]): number {
  return core.coverage(sprottStep(c), SPROTT_CFG);
}

/** Viewport framing the attractor's dense core (1–99 percentile bbox). */
export function sprottViewport(c: number[], fitW: number, fitH: number): { scale: number; cx: number; cy: number } | null {
  return core.attractorViewport(sprottStep(c), SPROTT_CFG, fitW, fitH);
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
  return core.buildAttractorGenome(rng, (color) => sprottXform(coeffs, color), sprottStep(coeffs), SPROTT_CFG, fitW, fitH);
}
