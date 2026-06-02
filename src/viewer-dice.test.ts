import { describe, it, expect, beforeEach } from 'vitest';
import {
  partitionPools,
  pickFromPools,
  pickSurpriseFlame,
  buildPools,
  _resetDicePoolCache,
  ELITE_FRACTION,
  EXPLORE_BOTTOM_EXCLUDE,
  ELITE_BIAS,
  type DicePools,
} from './viewer-dice';
import type { SheepRef, FeatureRecord } from './feature-index';
import type { FeatureIndex } from './feature-index-client';

function ref(gen: number, id: number): SheepRef {
  return { gen, id };
}

function makeRefs(n: number): SheepRef[] {
  return Array.from({ length: n }, (_, i) => ref(Math.floor(i / 1000), i % 1000));
}

describe('partitionPools', () => {
  it('empty input → empty pools', () => {
    expect(partitionPools([])).toEqual({ elite: [], explore: [] });
  });

  it('top ELITE_FRACTION goes to elite; bottom EXPLORE_BOTTOM_EXCLUDE is dropped', () => {
    const refs = makeRefs(1000);
    const { elite, explore } = partitionPools(refs);
    expect(elite.length).toBe(Math.floor(1000 * ELITE_FRACTION));
    expect(explore.length).toBe(Math.floor(1000 * (1 - EXPLORE_BOTTOM_EXCLUDE)) - elite.length);
    // elite is the head of the descending list
    expect(elite[0]).toEqual(refs[0]);
    // explore starts right after elite
    expect(explore[0]).toEqual(refs[elite.length]);
    // bottom EXPLORE_BOTTOM_EXCLUDE is dropped — the very last ref isn't in explore
    expect(explore[explore.length - 1]).not.toEqual(refs[refs.length - 1]);
  });

  it('tiny input (1 ref) → elite has it; explore empty', () => {
    const r = [ref(1, 1)];
    const { elite, explore } = partitionPools(r);
    expect(elite).toEqual(r);
    expect(explore).toEqual([]);
  });
});

describe('pickFromPools', () => {
  const pools: DicePools = {
    elite: [ref(1, 1), ref(1, 2), ref(1, 3)],
    explore: [ref(2, 1), ref(2, 2), ref(2, 3), ref(2, 4)],
  };

  it('both pools empty → null', () => {
    expect(pickFromPools({ elite: [], explore: [] }, () => 0)).toBeNull();
  });

  it('rng < ELITE_BIAS picks from elite', () => {
    // First call (pool choice): 0.0 < 0.8 → elite. Second call (index): 0 → first.
    const calls = [0.0, 0.0];
    const rng = () => calls.shift()!;
    expect(pickFromPools(pools, rng)).toEqual(ref(1, 1));
  });

  it('rng ≥ ELITE_BIAS picks from explore', () => {
    // First call (pool choice): 0.9 ≥ 0.8 → explore. Second call: 0.999 → last.
    const calls = [0.9, 0.999];
    const rng = () => calls.shift()!;
    expect(pickFromPools(pools, rng)).toEqual(ref(2, 4));
  });

  it('falls back to elite when explore is empty even with high rng', () => {
    const onlyElite: DicePools = { elite: pools.elite, explore: [] };
    const calls = [0.99, 0]; // wants explore, falls back to elite
    const rng = () => calls.shift()!;
    expect(pickFromPools(onlyElite, rng)).toEqual(ref(1, 1));
  });

  it('falls back to explore when elite is empty even with low rng', () => {
    const onlyExplore: DicePools = { elite: [], explore: pools.explore };
    const calls = [0.0, 0]; // wants elite, falls back to explore
    const rng = () => calls.shift()!;
    expect(pickFromPools(onlyExplore, rng)).toEqual(ref(2, 1));
  });
});

// Build a fake FeatureIndex from explicit (gen, id, coverage) triples.
// Score depends only on coverage when entropy/colorVar/meanLum are constant,
// so this gives us deterministic score-ordering for buildPools tests.
function fakeIndex(rows: Array<{ gen: number; id: number; coverage: number }>): FeatureIndex {
  const records: FeatureRecord[] = rows.map((r) => ({
    gen: r.gen,
    id: r.id,
    variations: [],
    xforms: 4,
    coverage: r.coverage,
    meanLum: 0.5,
    entropy: 0.5,
    colorVar: 0.5,
  }));
  return {
    schemaVersion: 1,
    corpusTag: 'fake',
    recordCount: records.length,
    has: () => false,
    get: () => null,
    filter: () => [],
    forEachRecord: (visitor) => {
      for (const r of records) {
        const cont = visitor(r);
        if (cont === false) return;
      }
    },
  };
}

describe('buildPools', () => {
  it('empty index → empty pools', () => {
    expect(buildPools(fakeIndex([]))).toEqual({ elite: [], explore: [] });
  });

  it('sorts by interestScore descending, then partitions', () => {
    // 10 rows with increasing coverage → score increases with coverage.
    const rows = Array.from({ length: 10 }, (_, i) => ({
      gen: 1,
      id: i,
      coverage: i / 10,
    }));
    const pools = buildPools(fakeIndex(rows));
    // Elite (top 10% of 10 = 1 entry) is the highest-coverage row (id=9).
    expect(pools.elite).toEqual([{ gen: 1, id: 9 }]);
    // Explore drops the bottom 5% (0 entries with floor(10 * 0.05)=0), so it
    // covers ids 8..0 (descending).
    expect(pools.explore[0]).toEqual({ gen: 1, id: 8 });
  });
});

describe('pickSurpriseFlame (integration with cache)', () => {
  beforeEach(() => {
    _resetDicePoolCache();
  });

  it('loads the index once + caches pools across calls', async () => {
    let loadCount = 0;
    const idx = fakeIndex([
      { gen: 1, id: 1, coverage: 0.9 },
      { gen: 1, id: 2, coverage: 0.5 },
      { gen: 1, id: 3, coverage: 0.1 },
    ]);
    const loader = async () => {
      loadCount++;
      return idx;
    };
    const a = await pickSurpriseFlame(() => 0, loader);
    const b = await pickSurpriseFlame(() => 0, loader);
    expect(loadCount).toBe(1);
    expect(a).toEqual(b);
  });

  it('returns null when the index is empty', async () => {
    const empty = fakeIndex([]);
    expect(await pickSurpriseFlame(Math.random, async () => empty)).toBeNull();
  });
});

describe('tuning constants — load-bearing values stay in expected bands', () => {
  it('ELITE_FRACTION is between 1% and 25%', () => {
    expect(ELITE_FRACTION).toBeGreaterThanOrEqual(0.01);
    expect(ELITE_FRACTION).toBeLessThanOrEqual(0.25);
  });
  it('EXPLORE_BOTTOM_EXCLUDE is between 0% and 25%', () => {
    expect(EXPLORE_BOTTOM_EXCLUDE).toBeGreaterThanOrEqual(0);
    expect(EXPLORE_BOTTOM_EXCLUDE).toBeLessThanOrEqual(0.25);
  });
  it('ELITE_BIAS is between 0.5 and 1.0', () => {
    expect(ELITE_BIAS).toBeGreaterThanOrEqual(0.5);
    expect(ELITE_BIAS).toBeLessThanOrEqual(1.0);
  });
});
