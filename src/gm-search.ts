// src/gm-search.ts
//
// #467 Gumowski-Mira auto-search. Smooth rational map → analytic Lyapunov +
// coverage (like sprott). GM strange attractors live ONLY at negative a, b near 1
// (positive a → stable-spiral origin → collapse). Shares the attractor-search core.
import type { Genome, Xform } from './genome';
import { V } from './variations';
import * as core from './attractor-search';

/** 🎚️ Sacrosanct chaos-band tuning — changing any value is a balance edit (ask
 *  first). Probe-validated 2026-06-26 (~51% vet pass over the negative-a band). */
export const GM_SEARCH = {
  LE_MIN: 0.05,
  ESCAPE: 1e6,
  WARMUP: 1000,
  ITER: 12000,
  COV_MIN: 8000,
  COV_GRID: 220,
  COV_ITERS: 60000,
  FRACTION: 0.1,
  MAX_VET_ROLLS: 600,
  A: [-1, -0.5] as const, B: [0.93, 0.99] as const,
} as const;

const CFG: core.AttractorConfig = {
  lyapWarmup: GM_SEARCH.WARMUP, lyapIter: GM_SEARCH.ITER,
  escape: GM_SEARCH.ESCAPE,
  cloudWarmup: 300,
  covIters: GM_SEARCH.COV_ITERS,
  covGrid: GM_SEARCH.COV_GRID,
  minPts: 500,
  fitMargin: 0.85, fitPctLo: 0.01, fitPctHi: 0.99, fitMinRange: 1e-3,
};

const G = (x: number, a: number): number => a * x + 2 * (1 - a) * x * x / (1 + x * x);
const Gp = (x: number, a: number): number => a + 4 * (1 - a) * x / ((1 + x * x) * (1 + x * x));

function gmStep(a: number, b: number): core.StepFn {
  return (x, y) => {
    const xp = b * y + G(x, a);
    return [xp, -x + G(xp, a)];
  };
}
function gmJac(a: number, b: number): core.JacobianFn {
  return (x, y) => {
    const xp = b * y + G(x, a);
    const gpx = Gp(x, a), gpxp = Gp(xp, a);
    return [gpx, b, -1 + gpxp * gpx, gpxp * b];
  };
}

function roll(rng: () => number, lohi: readonly [number, number]): number {
  return lohi[0] + (lohi[1] - lohi[0]) * rng();
}

/** Build the single GM xform: identity pre/post affine, gumowski_mira w=1, params a,b. */
export function gmXform(a: number, b: number, color: number): Xform {
  return {
    a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
    weight: 1, color, colorSpeed: 0,
    variations: [{ index: V.gumowski_mira, weight: 1, param0: a, param1: b }],
  };
}

/** Roll a,b until Lyapunov-positive + bounded + covered. Null on give-up. */
export function vetGmCoeffs(rng: () => number, maxRolls: number = GM_SEARCH.MAX_VET_ROLLS): number[] | null {
  for (let r = 0; r < maxRolls; r++) {
    const a = roll(rng, GM_SEARCH.A), b = roll(rng, GM_SEARCH.B);
    if (core.lyapunov(gmStep(a, b), gmJac(a, b), CFG) > GM_SEARCH.LE_MIN
        && core.coverage(gmStep(a, b), CFG) > GM_SEARCH.COV_MIN) return [a, b];
  }
  return null;
}

/** Vet → build a GM genome reusing the random recipe's palette/tonemap/density.
 *  Returns null on give-up or unfittable. */
export function generateGmGenome(rng: () => number, fitW = 1024, fitH = 1024): Genome | null {
  const c = vetGmCoeffs(rng);
  if (!c) return null;
  return core.buildAttractorGenome(rng, (color) => gmXform(c[0]!, c[1]!, color), gmStep(c[0]!, c[1]!), CFG, fitW, fitH);
}
