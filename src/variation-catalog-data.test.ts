import { describe, it, expect } from 'vitest';
import {
  CATALOG_DATA,
  getCatalogDoc,
  sourceForIdx,
} from './variation-catalog-data';
import { V, getDisplayLabel } from './variations';

const SEED_INDICES = [V.linear, V.sinusoidal, V.spherical, V.swirl, V.julian];

describe('CATALOG_DATA seed entries', () => {
  it.each(SEED_INDICES)('has a complete entry for V%i', idx => {
    const doc = getCatalogDoc(idx);
    expect(doc).toBeDefined();
    expect(doc!.name).toBeTruthy();
    expect(doc!.source).toMatch(/^(flam3|dc|jwf)$/);
    expect(doc!.formula).toBeTruthy();
    expect(doc!.blurb).toBeTruthy();
  });

  it('julian declares params with the catalog-specific defaults', () => {
    const julian = getCatalogDoc(V.julian)!;
    expect(julian.params).toHaveLength(2);
    // Catalog uses power=2 (recognizable 2-fold julian); VARIATION_DEFAULTS
    // is [1, 1] which would render as degenerate identity.
    expect(julian.params![0]).toMatchObject({ name: 'power', default: 2 });
    expect(julian.params![1]).toMatchObject({ name: 'dist',  default: 1 });
  });

  it('linear has a warpFn that is identity', () => {
    const linear = getCatalogDoc(V.linear)!;
    expect(linear.warpFn!(0.7, -0.3)).toEqual([0.7, -0.3]);
  });

  it('sinusoidal warpFn matches its formula', () => {
    const sin = getCatalogDoc(V.sinusoidal)!;
    const [x, y] = sin.warpFn!(1.5, -0.5);
    expect(x).toBeCloseTo(Math.sin(1.5));
    expect(y).toBeCloseTo(Math.sin(-0.5));
  });
});

describe('sourceForIdx classification', () => {
  it('classifies flam3 range', () => {
    expect(sourceForIdx(V.linear)).toBe('flam3');
    expect(sourceForIdx(V.mobius)).toBe('flam3');
  });
  it('classifies DC family', () => {
    expect(sourceForIdx(V.dc_linear)).toBe('dc');
    expect(sourceForIdx(V.dc_cylinder)).toBe('dc');
  });
  it('classifies JWildfire ports', () => {
    expect(sourceForIdx(V.cpow2)).toBe('jwf');
    expect(sourceForIdx(V.epispiral)).toBe('jwf');
  });
});

describe('getDisplayLabel mapping', () => {
  it('maps flam3 original range 0..98 to V0..V98', () => {
    expect(getDisplayLabel(0)).toBe('V0');
    expect(getDisplayLabel(98)).toBe('V98');
  });

  it('maps JWildfire/DC port range 99..219 to JWF0..JWF120', () => {
    expect(getDisplayLabel(99)).toBe('JWF0');
    expect(getDisplayLabel(219)).toBe('JWF120');
  });

  it('maps Pyre novel/custom range 220..257 to P0..P37', () => {
    expect(getDisplayLabel(220)).toBe('P0');
    expect(getDisplayLabel(257)).toBe('P37');
  });
});

describe('CATALOG_DATA shape invariants', () => {
  it('every entry idx is unique', () => {
    const idxs = CATALOG_DATA.map(d => d.idx);
    expect(new Set(idxs).size).toBe(idxs.length);
  });

  it('each entry source matches sourceForIdx(idx)', () => {
    for (const doc of CATALOG_DATA) {
      expect(doc.source).toBe(sourceForIdx(doc.idx));
    }
  });

  it('parameterized entries declare at least one param', () => {
    for (const doc of CATALOG_DATA) {
      if (doc.params !== undefined) expect(doc.params.length).toBeGreaterThan(0);
    }
  });

  it('has a complete entry for every variation V0-V106', () => {
    for (let idx = 0; idx <= V.crackle; idx++) {
      const doc = getCatalogDoc(idx);
      expect(doc, `V${idx} missing`).toBeDefined();
      expect(doc!.formula, `V${idx} formula empty`).toBeTruthy();
      expect(doc!.blurb, `V${idx} blurb empty`).toBeTruthy();
    }
  });
});
