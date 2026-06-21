// Index-only "is this flame worth showing?" predicate for the screensaver
// slideshow. Borrows surprise-cull's spirit (objective, named, tunable
// thresholds) but reads the precomputed corpus feature index — zero renders —
// and, unlike surprise-cull, is allowed to cull "dull", not just degenerate
// (the explicit #355 ask). All SheepFeatures scalar fields are 0..1.
//
// Thresholds are first-pass guesses; calibrate against the live corpus in the
// verify phase (see plan Task 12).
import type { SheepFeatures, SheepRef } from './feature-index';

export type InterestLevel = 'off' | 'normal' | 'aggressive';

// "normal" — drop the confident-boring tier: near-empty, dead/dark, or flat.
export const NORMAL_MIN_COVERAGE = 0.02;
export const NORMAL_MIN_MEANLUM  = 0.01;
export const NORMAL_MIN_ENTROPY  = 0.20;
// "aggressive" — additionally require strong, structured, colourful flames.
export const AGGRO_MIN_COVERAGE  = 0.08;
export const AGGRO_MIN_ENTROPY   = 0.45;
export const AGGRO_MIN_COLORVAR  = 0.10;

export function isInteresting(rec: SheepFeatures, level: InterestLevel): boolean {
  if (level === 'off') return true;
  if (rec.coverage < NORMAL_MIN_COVERAGE) return false;
  if (rec.meanLum  < NORMAL_MIN_MEANLUM)  return false;
  if (rec.entropy  < NORMAL_MIN_ENTROPY)  return false;
  if (level === 'aggressive') {
    if (rec.coverage < AGGRO_MIN_COVERAGE) return false;
    if (rec.entropy  < AGGRO_MIN_ENTROPY)  return false;
    if (rec.colorVar < AGGRO_MIN_COLORVAR) return false;
  }
  return true;
}

// Below this the pool is considered "starved" and we relax strictness so the
// screensaver never runs dry.
export const MIN_POOL = 200;

// Build the slideshow ref pool, relaxing strictness toward 'off' if the chosen
// level starves below MIN_POOL. `filter` is the FeatureIndex.filter method
// (passed in so this stays decoupled from the index client and unit-testable).
export function buildInterestPool(
  filter: (pred: (rec: SheepFeatures) => boolean) => SheepRef[],
  level: InterestLevel,
): { refs: SheepRef[]; appliedLevel: InterestLevel } {
  const ladder: InterestLevel[] = ['aggressive', 'normal', 'off'];
  for (let i = Math.max(0, ladder.indexOf(level)); i < ladder.length; i++) {
    const lvl = ladder[i]!;
    const refs = filter((rec) => isInteresting(rec, lvl));
    if (refs.length >= MIN_POOL || lvl === 'off') return { refs, appliedLevel: lvl };
  }
  // Unreachable in practice (the loop always returns on the 'off' iteration via
  // the `|| lvl === 'off'` guard) but required: TS can't prove the for-loop is
  // exhaustive, so this is the control-flow fallback / defensive net.
  return { refs: filter(() => true), appliedLevel: 'off' };
}
