// #114 — Slot 11 of the per-xform packed buffer carries the DC override
// flag. The chaos kernel reads it as f32; 1.0 means this xform's
// histogram write uses rgb_override instead of palette[color_index].
//
// Contract:
//   - Any DC variation in the chain (active or inactive) → flag = 1.0
//   - No DC variations → flag = 0.0 (the existing palette-indexed path)
//   - Existing genomes are unaffected (no flam3-99 variation is a DC kind)

import { describe, it, expect } from 'vitest';
import { packXforms, XFORM_FLOATS, type Genome, type Xform } from './genome';
import { V, DC_VARIATION_SET, linear, spherical } from './variations';

function xformWith(variations: Xform['variations']): Xform {
  return {
    a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
    weight: 1, color: 0.5, colorSpeed: 0.5,
    opacity: 1,
    variations,
  };
}

function genomeOf(xforms: Xform[]): Genome {
  return {
    name: 'test',
    scale: 1, cx: 0, cy: 0,
    xforms,
    // Tests only exercise packXforms; palette + downstream fields are unused.
  } as unknown as Genome;
}

const DC_FLAG_SLOT = 11;

describe('#114 — dc_flag packing', () => {
  it('packs dc_flag = 0 for a chain with only flam3-99 variations', () => {
    const g = genomeOf([xformWith([linear(1)])]);
    const buf = new Float32Array(packXforms(g));
    expect(buf[DC_FLAG_SLOT]).toBe(0);
  });

  it('packs dc_flag = 0 for an empty chain', () => {
    const g = genomeOf([xformWith([])]);
    const buf = new Float32Array(packXforms(g));
    expect(buf[DC_FLAG_SLOT]).toBe(0);
  });

  it('packs dc_flag = 1 when the chain contains dc_linear', () => {
    const g = genomeOf([xformWith([{ index: V.dc_linear, weight: 1 }])]);
    const buf = new Float32Array(packXforms(g));
    expect(buf[DC_FLAG_SLOT]).toBe(1);
  });

  it('packs dc_flag = 1 for every DC variation kind', () => {
    for (const dcIdx of DC_VARIATION_SET) {
      const g = genomeOf([
        xformWith([{ index: dcIdx as ReturnType<typeof linear>['index'], weight: 1 }]),
      ]);
      const buf = new Float32Array(packXforms(g));
      expect(buf[DC_FLAG_SLOT]).toBe(1);
    }
  });

  it('packs dc_flag = 1 when DC is mixed with non-DC variations', () => {
    const g = genomeOf([
      xformWith([linear(0.5), { index: V.dc_perlin, weight: 1 }, spherical(0.3)]),
    ]);
    const buf = new Float32Array(packXforms(g));
    expect(buf[DC_FLAG_SLOT]).toBe(1);
  });

  it('packs dc_flag = 0 when the only DC variation is active=false', () => {
    // Self-consistency check: hasDc gates on v.active, matching the
    // weight-gate in chaos.wgsl. Without this, a caller that hand-packs
    // a genome (skipping expandGenomeForGPU) would set dc_flag=1 with
    // weight>0, falsely overriding the palette.
    const g = genomeOf([
      xformWith([
        linear(1),
        { index: V.dc_perlin, weight: 1, active: false },
      ]),
    ]);
    const buf = new Float32Array(packXforms(g));
    expect(buf[DC_FLAG_SLOT]).toBe(0);
  });

  it('packs dc_flag = 1 when at least one DC variation is active among multiple', () => {
    const g = genomeOf([
      xformWith([
        { index: V.dc_perlin, weight: 1, active: false },
        { index: V.dc_gridout, weight: 1 },
        { index: V.dc_linear, weight: 1, active: false },
      ]),
    ]);
    const buf = new Float32Array(packXforms(g));
    expect(buf[DC_FLAG_SLOT]).toBe(1);
  });

  it('packs dc_flag independently per xform', () => {
    const g = genomeOf([
      xformWith([linear(1)]),                                  // slot 11: 0
      xformWith([{ index: V.dc_gridout, weight: 1 }]),          // slot XFORM_FLOATS + 11: 1
      xformWith([spherical(1)]),                                // slot 2*XFORM_FLOATS + 11: 0
    ]);
    const buf = new Float32Array(packXforms(g));
    expect(buf[0 * XFORM_FLOATS + DC_FLAG_SLOT]).toBe(0);
    expect(buf[1 * XFORM_FLOATS + DC_FLAG_SLOT]).toBe(1);
    expect(buf[2 * XFORM_FLOATS + DC_FLAG_SLOT]).toBe(0);
  });
});
