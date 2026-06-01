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

/** The five weighted-sort presets the gallery exposes as named pills.
 *  `time` is NOT in here — it's chronological, not a weighted score.
 *  Each preset name's tuple defines the exact weights the preset applies. */
export type SortPreset = 'interest' | 'coverage' | 'entropy' | 'colorVar' | 'meanLum';

/** Canonical weights for each named preset. `interest` is the tunable
 *  DEFAULT_SCORE_WEIGHTS; the other four are one-hot tuples that reduce
 *  interestScore to a single stat (or 1 - (1 - meanLum) = meanLum - 1 for
 *  meanLum; constants don't affect sort order). Used by gallery-mount to
 *  resolve `spec.sort` → weights, and by gallery-filter-ui to render the
 *  tune panel's "you're matching <preset>" indicator. */
export const PRESET_WEIGHTS: Record<SortPreset, ScoreWeights> = {
  interest: DEFAULT_SCORE_WEIGHTS,
  coverage: { coverage: 1, entropy: 0, colorVar: 0, dimPenalty: 0 },
  entropy:  { coverage: 0, entropy: 1, colorVar: 0, dimPenalty: 0 },
  colorVar: { coverage: 0, entropy: 0, colorVar: 1, dimPenalty: 0 },
  meanLum:  { coverage: 0, entropy: 0, colorVar: 0, dimPenalty: 1 },
};

const WEIGHTS_EPS = 1e-9;

/** Reverse lookup: given a ScoreWeights tuple, return the preset name that
 *  matches it (within `1e-9` per-field tolerance), or `null` if it doesn't
 *  match any preset (UI treats `null` as "custom"). The epsilon absorbs the
 *  round-trip through URL float encoding so a tuple that came back from
 *  parseFloat(v.toFixed(3)) still matches its canonical preset. */
export function weightsToPresetName(w: ScoreWeights): SortPreset | null {
  for (const name of Object.keys(PRESET_WEIGHTS) as SortPreset[]) {
    const p = PRESET_WEIGHTS[name];
    if (
      Math.abs(p.coverage - w.coverage) <= WEIGHTS_EPS
      && Math.abs(p.entropy - w.entropy) <= WEIGHTS_EPS
      && Math.abs(p.colorVar - w.colorVar) <= WEIGHTS_EPS
      && Math.abs(p.dimPenalty - w.dimPenalty) <= WEIGHTS_EPS
    ) {
      return name;
    }
  }
  return null;
}
