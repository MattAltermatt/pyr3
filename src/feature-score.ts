// Interestingness score — combines a sheep's four 0..1 stats into one
// 0..1 number the gallery uses for sort-by-interest and the filter UI's
// secondary ranking.
//
// 🎚️ The weights are tunable: they're the gallery's only real "voice"
// for what reads as interesting, and the right balance will emerge once
// the chips ship and real users browse. Living in pyr3 (not the bake
// CLI) means a tuning bump is a one-line PR — no 3-4 hour re-bake.

import type { SheepFeatures } from './feature-index';

export interface ScoreWeights {
  coverage: number;
  entropy: number;
  colorVar: number;
  dimPenalty: number;
}

/** Initial weights — positive sum ≤ 1.0 so the formula lands in 0..1
 *  given inputs already in 0..1. Coverage leads (covering the frame is
 *  the strongest "this is a real flame" signal), entropy + colorVar
 *  reward visual interest, dim images get a small subtractive penalty. */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  coverage: 0.35,
  entropy: 0.30,
  colorVar: 0.25,
  dimPenalty: 0.10,
};

/**
 * Combine the four raw stats into a single 0..1 interestingness score:
 *
 *   score = w.coverage * coverage
 *         + w.entropy  * entropy
 *         + w.colorVar * colorVar
 *         - w.dimPenalty * (1 - meanLum)
 *
 * Result is clamped to [0, 1]. Any non-finite intermediate → 0 so a
 * corrupt feature row never poisons the sort order.
 */
export function interestScore(f: SheepFeatures, w: ScoreWeights = DEFAULT_SCORE_WEIGHTS): number {
  const raw =
    w.coverage * f.coverage +
    w.entropy * f.entropy +
    w.colorVar * f.colorVar -
    w.dimPenalty * (1 - f.meanLum);
  if (!Number.isFinite(raw)) return 0;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}
