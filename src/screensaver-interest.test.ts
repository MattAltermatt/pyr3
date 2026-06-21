import { describe, it, expect } from 'vitest';
import {
  isInteresting,
  buildInterestPool,
  MIN_POOL,
  type InterestLevel,
} from './screensaver-interest';
import type { SheepFeatures, SheepRef } from './feature-index';

const rec = (o: Partial<SheepFeatures>): SheepFeatures => ({
  variations: [],
  xforms: 3,
  coverage: 0.3,
  meanLum: 0.2,
  entropy: 0.6,
  colorVar: 0.3,
  ...o,
});

describe('isInteresting', () => {
  it('off keeps everything, even a dead render', () => {
    expect(isInteresting(rec({ coverage: 0, meanLum: 0, entropy: 0, colorVar: 0 }), 'off')).toBe(true);
  });

  it('normal culls near-empty, dark, and structureless; keeps a healthy flame', () => {
    expect(isInteresting(rec({ coverage: 0.001 }), 'normal')).toBe(false); // near-empty
    expect(isInteresting(rec({ meanLum: 0.0 }), 'normal')).toBe(false); // dead/dark
    expect(isInteresting(rec({ entropy: 0.05 }), 'normal')).toBe(false); // flat
    expect(isInteresting(rec({}), 'normal')).toBe(true);
  });

  it('aggressive additionally requires strong coverage/entropy/colorVar', () => {
    // each individually below an aggressive floor but above normal floors
    expect(isInteresting(rec({ coverage: 0.05 }), 'aggressive')).toBe(false);
    expect(isInteresting(rec({ entropy: 0.30 }), 'aggressive')).toBe(false);
    expect(isInteresting(rec({ colorVar: 0.02 }), 'aggressive')).toBe(false);
    // a strong flame passes
    expect(isInteresting(rec({ coverage: 0.5, entropy: 0.7, colorVar: 0.4 }), 'aggressive')).toBe(true);
  });

  it('the same mildly-dull flame survives normal but not aggressive', () => {
    const dull = rec({ coverage: 0.05, entropy: 0.30, colorVar: 0.05 });
    expect(isInteresting(dull, 'normal')).toBe(true);
    expect(isInteresting(dull, 'aggressive')).toBe(false);
  });
});

// Fake FeatureIndex.filter: counts how many synthetic records pass the
// predicate. We hand it a fixed population and let the real isInteresting
// predicate decide membership, so the fallback ladder is exercised end-to-end.
function fakeFilter(population: SheepFeatures[]) {
  return (pred: (rec: SheepFeatures) => boolean): SheepRef[] =>
    population.filter(pred).map((_, i) => ({ gen: 0, id: i }));
}

describe('buildInterestPool floor-fallback', () => {
  it('relaxes a starved level toward off', () => {
    // Population: MIN_POOL+10 strong flames, MIN_POOL-1 of which are only
    // "normal"-grade (fail aggressive). At aggressive the pool would be tiny,
    // so it must relax to normal (or off) to clear MIN_POOL.
    const strong = Array.from({ length: 5 }, () => rec({ coverage: 0.5, entropy: 0.7, colorVar: 0.4 }));
    const normalGrade = Array.from({ length: MIN_POOL + 50 }, () => rec({ coverage: 0.05, entropy: 0.30, colorVar: 0.05 }));
    const pop = [...strong, ...normalGrade];

    const aggro = buildInterestPool(fakeFilter(pop), 'aggressive');
    // 5 strong < MIN_POOL → fall to normal, which passes all (strong+normalGrade)
    expect(aggro.appliedLevel).toBe('normal');
    expect(aggro.refs.length).toBe(pop.length);
  });

  it('off always returns the full population', () => {
    const pop = Array.from({ length: 1000 }, () => rec({ coverage: 0, meanLum: 0, entropy: 0 }));
    const r = buildInterestPool(fakeFilter(pop), 'off');
    expect(r.appliedLevel).toBe('off');
    expect(r.refs.length).toBe(1000);
  });

  it('keeps the requested level when it clears MIN_POOL', () => {
    const strong = Array.from({ length: MIN_POOL + 5 }, () => rec({ coverage: 0.5, entropy: 0.7, colorVar: 0.4 }));
    const r = buildInterestPool(fakeFilter(strong), 'aggressive');
    expect(r.appliedLevel).toBe('aggressive');
    expect(r.refs.length).toBe(strong.length);
  });

  it('falls all the way to off when even normal starves', () => {
    const fewDull = Array.from({ length: 3 }, () => rec({ coverage: 0.05, entropy: 0.30, colorVar: 0.05 }));
    const r = buildInterestPool(fakeFilter(fewDull), 'normal' as InterestLevel);
    expect(r.appliedLevel).toBe('off');
    expect(r.refs.length).toBe(3);
  });
});
