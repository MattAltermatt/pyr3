import { describe, it, expect } from 'vitest';
import { computeFacetCounts } from './gallery-facets';
import { DEFAULT_FILTER_SPEC, type FilterSpec } from './gallery-filter';
import type { FeatureIndex } from './feature-index-client';
import type { FeatureRecord } from './feature-index';

/** Build an in-memory FeatureIndex stub from a record array — bypasses the
 *  binary format entirely so facets math is tested in isolation. */
function makeIndex(records: FeatureRecord[]): FeatureIndex {
  return {
    schemaVersion: 1,
    corpusTag: 'test',
    recordCount: records.length,
    has: (g, i) => records.some((r) => r.gen === g && r.id === i),
    get: (g, i) => records.find((r) => r.gen === g && r.id === i) ?? null,
    filter: (p) => records.filter(p).map((r) => ({ gen: r.gen, id: r.id })),
    forEachRecord: (visitor) => {
      for (const r of records) {
        if (visitor(r) === false) return;
      }
    },
  };
}

function rec(gen: number, id: number, vars: number[], xforms: number): FeatureRecord {
  return {
    gen, id,
    variations: vars,
    xforms,
    coverage: 0.5, meanLum: 0.5, entropy: 0.5, colorVar: 0.5,
  };
}

/** Stat-axis record builder — vars/xforms held to neutral defaults
 *  (linear variation, 2 xforms) so the stat-axis tests aren't confounded
 *  by variation/xform filtering. */
function recStats(
  gen: number, id: number,
  coverage: number, entropy: number, colorVar: number, meanLum: number,
  vars: number[] = [0], xforms = 2,
): FeatureRecord {
  return {
    gen, id,
    variations: vars,
    xforms,
    coverage, entropy, colorVar, meanLum,
  };
}

describe('computeFacetCounts', () => {
  it('no filter → variation counts are raw corpus counts', () => {
    const idx = makeIndex([
      rec(165, 0, [0, 14], 2), // linear + julia
      rec(165, 1, [14], 3),    // julia
      rec(165, 2, [0], 4),     // linear
    ]);
    const c = computeFacetCounts(idx, DEFAULT_FILTER_SPEC);
    expect(c.variations.get(0)).toBe(2);   // linear in 2 flames
    expect(c.variations.get(14)).toBe(2);  // julia in 2 flames
    expect(c.total).toBe(3);
  });

  it('variation counts apply OTHER active filters (leave-one-out)', () => {
    // With xform filter [3, ∞), only records with xforms≥3 should count.
    const idx = makeIndex([
      rec(165, 0, [0, 14], 2), // dropped by xform filter
      rec(165, 1, [14], 3),    // counted: julia
      rec(165, 2, [0], 4),     // counted: linear
    ]);
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, xformMin: 3 };
    const c = computeFacetCounts(idx, spec);
    expect(c.variations.get(0)).toBe(1);
    expect(c.variations.get(14)).toBe(1);
    expect(c.total).toBe(2);
  });

  it('variation counts do NOT apply the variation filter itself (leave-one-out)', () => {
    // Selecting julia should NOT narrow the variation-axis counts to "only julia"
    // — counts must still show what would happen if a SECOND variation were added.
    const idx = makeIndex([
      rec(165, 0, [0, 14], 2),   // linear + julia
      rec(165, 1, [14, 50], 3),  // julia + spherical
      rec(165, 2, [0], 4),       // linear only — outside the julia subset
    ]);
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, vars: [14] };
    const c = computeFacetCounts(idx, spec);
    // Among julia records (165/0 + 165/1):
    expect(c.variations.get(0)).toBe(1);   // linear AND julia → 165/0
    expect(c.variations.get(50)).toBe(1);  // spherical AND julia → 165/1
    expect(c.variations.get(14)).toBe(2);  // julia itself: count over the julia subset = 2
    expect(c.total).toBe(2);
  });

  it('xform counts apply OTHER active filters but NOT the xform range itself', () => {
    const idx = makeIndex([
      rec(165, 0, [14], 2),
      rec(165, 1, [14], 3),
      rec(165, 2, [14], 4),
      rec(165, 3, [0], 5),  // linear, dropped by julia filter
    ]);
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, vars: [14], xformMin: 3 };
    const c = computeFacetCounts(idx, spec);
    // xform counts should reflect the julia filter but NOT the [3, ∞) cap.
    expect(c.xforms.get(2)).toBe(1);
    expect(c.xforms.get(3)).toBe(1);
    expect(c.xforms.get(4)).toBe(1);
    // total respects ALL filters (julia AND xforms≥3) → 2 records.
    expect(c.total).toBe(2);
  });

  it('xform counts collapse 14+ into bucket key 14', () => {
    const idx = makeIndex([
      rec(165, 0, [0], 13),
      rec(165, 1, [0], 14),
      rec(165, 2, [0], 15),
      rec(165, 3, [0], 30),
    ]);
    const c = computeFacetCounts(idx, DEFAULT_FILTER_SPEC);
    expect(c.xforms.get(13)).toBe(1);
    expect(c.xforms.get(14)).toBe(3);  // 14, 15, 30 all collapse here
  });

  it('stat axes bucket into deciles — boundaries (0.05→0, 0.55→5, 1.0→9)', () => {
    const idx = makeIndex([
      recStats(165, 0, 0.05, 0.05, 0.05, 0.05),
      recStats(165, 1, 0.55, 0.55, 0.55, 0.55),
      recStats(165, 2, 1.0,  1.0,  1.0,  1.0),
      recStats(165, 3, 0.0,  0.0,  0.0,  0.0),
    ]);
    const c = computeFacetCounts(idx, DEFAULT_FILTER_SPEC);
    for (const axis of [c.coverage, c.entropy, c.colorVar, c.meanLum]) {
      expect(axis.get(0)).toBe(2);  // 0.0 and 0.05 → bucket 0
      expect(axis.get(5)).toBe(1);  // 0.55 → bucket 5
      expect(axis.get(9)).toBe(1);  // 1.0 collapses into bucket 9
    }
    expect(c.total).toBe(4);
  });

  it('coverage axis counts apply OTHER active filters (leave-one-out)', () => {
    // entropy filter [0.5, 1.0] should narrow the coverage-axis subset to
    // records with entropy≥0.5; the coverage range itself is excluded.
    const idx = makeIndex([
      recStats(165, 0, 0.15, 0.20, 0.50, 0.50), // dropped by entropy filter
      recStats(165, 1, 0.25, 0.60, 0.50, 0.50), // counted in coverage bucket 2
      recStats(165, 2, 0.85, 0.70, 0.50, 0.50), // counted in coverage bucket 8
    ]);
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, entropyMin: 0.5 };
    const c = computeFacetCounts(idx, spec);
    expect(c.coverage.get(1)).toBeUndefined();  // 0.15 record was filtered out
    expect(c.coverage.get(2)).toBe(1);
    expect(c.coverage.get(8)).toBe(1);
    expect(c.total).toBe(2);
  });

  it('coverage axis does NOT apply the coverage range itself (leave-one-out)', () => {
    // Selecting coverage=[0.5, 1.0] should NOT narrow the coverage-axis
    // counts to "only ≥0.5" — the picker strip must still show low-bucket
    // counts so the user can see what they're excluding.
    const idx = makeIndex([
      recStats(165, 0, 0.15, 0.5, 0.5, 0.5),
      recStats(165, 1, 0.55, 0.5, 0.5, 0.5),
      recStats(165, 2, 0.85, 0.5, 0.5, 0.5),
    ]);
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, coverageMin: 0.5 };
    const c = computeFacetCounts(idx, spec);
    expect(c.coverage.get(1)).toBe(1);  // 0.15 still appears in the strip
    expect(c.coverage.get(5)).toBe(1);
    expect(c.coverage.get(8)).toBe(1);
    expect(c.total).toBe(2);  // total respects the coverage range
  });

  it('variation filter + coverage range narrows coverage-axis counts to that variation', () => {
    const idx = makeIndex([
      recStats(165, 0, 0.15, 0.5, 0.5, 0.5, [14]),     // julia
      recStats(165, 1, 0.55, 0.5, 0.5, 0.5, [14]),     // julia
      recStats(165, 2, 0.85, 0.5, 0.5, 0.5, [0]),      // linear — filtered out
    ]);
    const spec: FilterSpec = {
      ...DEFAULT_FILTER_SPEC,
      vars: [14],
      coverageMin: 0.5,
    };
    const c = computeFacetCounts(idx, spec);
    // Coverage strip shows the julia-only subset, full coverage range
    // (leave-one-out on the coverage range itself).
    expect(c.coverage.get(1)).toBe(1);  // 0.15 julia
    expect(c.coverage.get(5)).toBe(1);  // 0.55 julia
    expect(c.coverage.get(8)).toBeUndefined();  // linear dropped
    expect(c.total).toBe(1);  // julia AND coverage≥0.5 → 165/1 only
  });

  it('total respects all stat-range filters', () => {
    const idx = makeIndex([
      recStats(165, 0, 0.55, 0.55, 0.55, 0.55),  // in range on all axes
      recStats(165, 1, 0.55, 0.55, 0.55, 0.15),  // meanLum out
      recStats(165, 2, 0.55, 0.55, 0.15, 0.55),  // colorVar out
      recStats(165, 3, 0.55, 0.15, 0.55, 0.55),  // entropy out
      recStats(165, 4, 0.15, 0.55, 0.55, 0.55),  // coverage out
    ]);
    const spec: FilterSpec = {
      ...DEFAULT_FILTER_SPEC,
      coverageMin: 0.5, entropyMin: 0.5, colorVarMin: 0.5, meanLumMin: 0.5,
    };
    const c = computeFacetCounts(idx, spec);
    expect(c.total).toBe(1);
  });

  it('variation AND semantic — total respects intersection', () => {
    const idx = makeIndex([
      rec(165, 0, [14], 2),         // julia only
      rec(165, 1, [0, 14], 3),      // linear + julia
      rec(165, 2, [0], 4),          // linear only
    ]);
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, vars: [0, 14] };
    const c = computeFacetCounts(idx, spec);
    expect(c.total).toBe(1);
  });
});
