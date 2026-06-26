// src/hopalong-search.ts
//
// #466 Hopalong auto-search. Coverage + bounded ONLY (no Lyapunov): the sqrt(abs)
// has an infinite derivative where its argument crosses zero, so an analytic LE
// spuriously spikes. Hopalong is bounded + chaotic across broad parameter ranges,
// so coverage alone reliably rejects fixed-points / tight cycles (~81% pass at
// COV_MIN 8000 over [-2,2]³). Shares the map-agnostic attractor-search core.
import type { Genome, Xform } from './genome';
import { V } from './variations';
import * as core from './attractor-search';

/** 🎚️ Sacrosanct chaos-band tuning — changing any value is a balance edit (ask
 *  first). Probe-validated 2026-06-26. */
export const HOPALONG_SEARCH = {
  ESCAPE: 1e6,
  COV_MIN: 8000,
  COV_GRID: 220,
  COV_ITERS: 60000,
  FRACTION: 0.1,        // share of the Creator attractor pool (3-way split of ~0.3)
  MAX_VET_ROLLS: 600,
  // Roll ranges. Hopalong is bounded for ~all params, so the range is about look
  // variety, not stability.
  A: [-2, 2] as const, B: [-2, 2] as const, C: [-2, 2] as const,
} as const;

const CFG: core.AttractorConfig = {
  lyapWarmup: 1000, lyapIter: 12000,        // unused (no Lyapunov path) but required
  escape: HOPALONG_SEARCH.ESCAPE,
  cloudWarmup: 300,
  covIters: HOPALONG_SEARCH.COV_ITERS,
  covGrid: HOPALONG_SEARCH.COV_GRID,
  minPts: 500,
  fitMargin: 0.85, fitPctLo: 0.01, fitPctHi: 0.99, fitMinRange: 1e-3,
};

function hopalongStep(a: number, b: number, c: number): core.StepFn {
  return (x, y) => {
    const sx = x > 0 ? 1 : (x < 0 ? -1 : 0);
    return [y - sx * Math.sqrt(Math.abs(b * x - c)), a - x];
  };
}

function roll(rng: () => number, lohi: readonly [number, number]): number {
  return lohi[0] + (lohi[1] - lohi[0]) * rng();
}

/** Build the single Hopalong xform: identity pre/post affine, hopalong w=1 with
 *  the 3 params (a,b,c); no constant offsets ride the affine. */
export function hopalongXform(a: number, b: number, c: number, color: number): Xform {
  return {
    a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
    weight: 1, color, colorSpeed: 0,
    variations: [{ index: V.hopalong, weight: 1, param0: a, param1: b, param2: c }],
  };
}

/** Roll a,b,c until bounded + coverage passes. Null on give-up. */
export function vetHopalongCoeffs(rng: () => number, maxRolls: number = HOPALONG_SEARCH.MAX_VET_ROLLS): number[] | null {
  for (let r = 0; r < maxRolls; r++) {
    const a = roll(rng, HOPALONG_SEARCH.A), b = roll(rng, HOPALONG_SEARCH.B), c = roll(rng, HOPALONG_SEARCH.C);
    if (core.coverage(hopalongStep(a, b, c), CFG) > HOPALONG_SEARCH.COV_MIN) return [a, b, c];
  }
  return null;
}

/** Vet → build a Hopalong genome reusing the random recipe's palette/tonemap/density.
 *  Returns null on give-up or unfittable. */
export function generateHopalongGenome(rng: () => number, fitW = 1024, fitH = 1024): Genome | null {
  const c = vetHopalongCoeffs(rng);
  if (!c) return null;
  return core.buildAttractorGenome(rng, (color) => hopalongXform(c[0]!, c[1]!, c[2]!, color), hopalongStep(c[0]!, c[1]!, c[2]!), CFG, fitW, fitH);
}
