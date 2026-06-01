import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCORE_WEIGHTS,
  interestScore,
  type ScoreWeights,
} from './feature-score';
import type { SheepFeatures } from './feature-index';

const baseFeatures = (over: Partial<SheepFeatures> = {}): SheepFeatures => ({
  variations: [],
  xforms: 1,
  coverage: 0.5,
  meanLum: 0.5,
  entropy: 0.5,
  colorVar: 0.5,
  ...over,
});

describe('interestScore', () => {
  it('result is always in [0, 1] for valid inputs', () => {
    const samples: SheepFeatures[] = [
      baseFeatures({ coverage: 0, meanLum: 0, entropy: 0, colorVar: 0 }),
      baseFeatures({ coverage: 1, meanLum: 1, entropy: 1, colorVar: 1 }),
      baseFeatures({ coverage: 0.3, meanLum: 0.2, entropy: 0.9, colorVar: 0.7 }),
      baseFeatures({ coverage: 1, meanLum: 0, entropy: 1, colorVar: 1 }),
    ];
    for (const s of samples) {
      const v = interestScore(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('monotonic in coverage (others fixed)', () => {
    const lo = interestScore(baseFeatures({ coverage: 0.1 }));
    const mid = interestScore(baseFeatures({ coverage: 0.5 }));
    const hi = interestScore(baseFeatures({ coverage: 0.9 }));
    expect(lo).toBeLessThan(mid);
    expect(mid).toBeLessThan(hi);
  });

  it('monotonic in entropy (others fixed)', () => {
    const lo = interestScore(baseFeatures({ entropy: 0.1 }));
    const hi = interestScore(baseFeatures({ entropy: 0.9 }));
    expect(hi).toBeGreaterThan(lo);
  });

  it('monotonic in colorVar (others fixed)', () => {
    const lo = interestScore(baseFeatures({ colorVar: 0.1 }));
    const hi = interestScore(baseFeatures({ colorVar: 0.9 }));
    expect(hi).toBeGreaterThan(lo);
  });

  it('increasing meanLum does NOT decrease score (penalty is 1 - meanLum)', () => {
    const dim = interestScore(baseFeatures({ meanLum: 0.1 }));
    const bright = interestScore(baseFeatures({ meanLum: 0.9 }));
    expect(bright).toBeGreaterThanOrEqual(dim);
  });

  it('default-weights sum of positive terms ≤ 1.0 (sanity, keeps score in band)', () => {
    const sum =
      DEFAULT_SCORE_WEIGHTS.coverage +
      DEFAULT_SCORE_WEIGHTS.entropy +
      DEFAULT_SCORE_WEIGHTS.colorVar;
    expect(sum).toBeLessThanOrEqual(1.0 + 1e-9);
  });

  it('non-finite inputs collapse to 0', () => {
    expect(interestScore(baseFeatures({ coverage: NaN }))).toBe(0);
    expect(interestScore(baseFeatures({ entropy: Infinity }))).toBe(0);
    expect(interestScore(baseFeatures({ colorVar: -Infinity }))).toBe(0);
  });

  it('honors custom weight overrides', () => {
    // Coverage-only weighting: score should equal coverage exactly.
    const w: ScoreWeights = { coverage: 1, entropy: 0, colorVar: 0, dimPenalty: 0 };
    expect(interestScore(baseFeatures({ coverage: 0.42 }), w)).toBeCloseTo(0.42, 10);
    // Pure dim-penalty: meanLum=0 → score = -1 clamped to 0; meanLum=1 → 0.
    const wDim: ScoreWeights = { coverage: 0, entropy: 0, colorVar: 0, dimPenalty: 1 };
    expect(interestScore(baseFeatures({ meanLum: 0 }), wDim)).toBe(0);
    expect(interestScore(baseFeatures({ meanLum: 1 }), wDim)).toBe(0);
  });
});
