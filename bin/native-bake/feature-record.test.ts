// bin/native-bake/feature-record.test.ts
import { describe, it, expect } from 'vitest';
import { genomeVariationIndices, buildFeatureRecord } from './feature-record';
import { V } from '../../src/variations';
import type { Genome } from '../../src/genome';

function g(varNames: string[]): Genome {
  return {
    xforms: [{ variations: varNames.map((name) => ({ name, weight: 1 })) }],
  } as unknown as Genome;
}

describe('feature-record', () => {
  it('maps variation names to catalog indices', () => {
    const idxs = genomeVariationIndices(g(['linear']));
    expect(idxs).toContain(V.linear);
  });

  it('dedups + ignores unknown variation names', () => {
    const idxs = genomeVariationIndices(g(['linear', 'linear', 'not_a_real_variation']));
    expect(idxs).toEqual([V.linear]);
  });

  it('builds a record carrying gen/id/xforms/stats', () => {
    const rec = buildFeatureRecord(1, 5, g(['linear']), {
      coverage: 0.4, meanLum: 0.3, entropy: 0.6, colorVar: 0.2,
    });
    expect(rec.gen).toBe(1);
    expect(rec.id).toBe(5);
    expect(rec.xforms).toBe(1);
    expect(rec.variations).toContain(V.linear);
    expect(rec.coverage).toBeCloseTo(0.4, 5);
  });
});
