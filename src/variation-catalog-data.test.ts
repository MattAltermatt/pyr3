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
  it('classifies the dc_* ports as jwf provenance (#222 — DC is a capability, not a source)', () => {
    // dc_linear..dc_cylinder are V99..V102 = JWF0..JWF3 (Neil Slater / JWildfire
    // lineage). Their Direct-Color capability lives in DC_VARIATION_SET, not here.
    expect(sourceForIdx(V.dc_linear)).toBe('jwf');
    expect(sourceForIdx(V.dc_cylinder)).toBe('jwf');
  });
  it('classifies DC-capable pyr3 originals as novel provenance (#222)', () => {
    expect(sourceForIdx(V.newton)).toBe('novel');             // P0 (#133)
    expect(sourceForIdx(V.magnetic_pendulum)).toBe('novel');  // P45 (#138)
    expect(sourceForIdx(V.burning_ship)).toBe('novel');       // P90 (#145)
    expect(sourceForIdx(V.halley)).toBe('novel');             // P93 (#145)
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

  it('maps Pyre novel/custom range 220..265 to P0..P45 (V263 schwarzschild_lensing now filled — #138)', () => {
    expect(getDisplayLabel(220)).toBe('P0');
    expect(getDisplayLabel(261)).toBe('P41');
    expect(getDisplayLabel(263)).toBe('P43');
    expect(getDisplayLabel(265)).toBe('P45');
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

describe('#252 — warp diagram defaults track params[].default', () => {
  // The static warp SVG calls warpFn(x, y) with no params, so a warpFn's
  // arrow-default for an extra param must equal its params[].default — else
  // the static diagram and the live flame (which uses params[].default) show
  // a different figure for the same variation.
  const SAMPLES: [number, number][] = [[0.5, 0.7], [-1.2, 0.4], [0.3, -2.1]];

  it('every warpFn taking extra params uses its params[].default as the arrow-default', () => {
    for (const doc of CATALOG_DATA) {
      if (!doc.warpFn || !doc.params || doc.params.length === 0) continue;
      const defaults = doc.params.map((p) => p.default);
      for (const [sx, sy] of SAMPLES) {
        const noArgs = doc.warpFn(sx, sy);
        // @ts-expect-error — variadic call: warpFns ignore extra args they
        // don't declare; ones that DO declare params must match these.
        const withDefaults = doc.warpFn(sx, sy, ...defaults);
        // JSON.stringify so NaN===NaN (both serialize to null) and we compare
        // shape + value without floating tolerance fuss.
        expect(JSON.stringify(noArgs), `${doc.name} diverges at (${sx},${sy})`)
          .toBe(JSON.stringify(withDefaults));
      }
    }
  });

  it('pdj warpFn uses the curated a=b=c=d=-1 defaults, not the canonical 1.4/1.6/1.0/0.7', () => {
    const pdj = CATALOG_DATA.find((d) => d.name === 'pdj')!;
    const a = -1, b = -1, c = -1, d = -1;
    const [x, y] = [0.5, 0.7];
    const expected = [
      Math.sin(a * y) - Math.cos(b * x),
      Math.sin(c * x) - Math.cos(d * y),
    ];
    const got = pdj.warpFn!(x, y);
    expect(got[0]).toBeCloseTo(expected[0]!, 10);
    expect(got[1]).toBeCloseTo(expected[1]!, 10);
  });

  it('rings2 warpFn uses val=0.45 (params default), not 0.5', () => {
    const rings2 = CATALOG_DATA.find((d) => d.name === 'rings2')!;
    expect(rings2.params!.find((p) => p.name === 'val')!.default).toBe(0.45);
    // val=0.5 and val=0.45 give measurably different output at this radius.
    const got = rings2.warpFn!(1.3, 0.4);
    const val = 0.45;
    const r0 = Math.hypot(1.3, 0.4);
    const r_eps = r0 + 1e-10;
    const dx = val * val + 1e-10;
    const r = r0 - 2.0 * dx * Math.trunc((r0 + dx) / (2.0 * dx)) + r0 * (1.0 - dx);
    expect(got[0]).toBeCloseTo((1.3 / r_eps) * r, 10);
  });

  it('wedge_sph warpFn uses angle=0/count=1 (params default), not 0.6/4', () => {
    const ws = CATALOG_DATA.find((d) => d.name === 'wedge_sph')!;
    expect(ws.params!.find((p) => p.name === 'angle')!.default).toBe(0);
    expect(ws.params!.find((p) => p.name === 'count')!.default).toBe(1);
    // With angle=0/count=1/swirl=0, comp_fac=1 and c*angle=0 → a is unchanged,
    // so the map is a pure radial inversion r_inv·(cos a, sin a).
    const [x, y] = [0.5, 0.7];
    const r0 = Math.hypot(x, y);
    const r_inv = 1.0 / (r0 + 1e-10);
    const a = Math.atan2(y, x);
    const got = ws.warpFn!(x, y);
    expect(got[0]).toBeCloseTo(r_inv * Math.cos(a), 10);
    expect(got[1]).toBeCloseTo(r_inv * Math.sin(a), 10);
  });
});
