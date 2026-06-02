// #16 — PYR3-029 #3: table-driven xform-pick distribution. Pure-TS test against
// the hand-computed cumulative-scan reference in src/genome.ts::packXformDistrib.
// No GPU needed. The companion GPU smoke (kernel actually consumes the table at
// the right index) lives in src/chaos-rng.gpu.test.ts.

import { describe, expect, it } from 'vitest';
import {
  CHOOSE_XFORM_GRAIN,
  MAX_XFORMS,
  packXformDistrib,
  type Genome,
  type Xform,
} from './genome';
import { PYRE_PALETTE } from './palette';
import { linear } from './variations';

// Build a minimal Genome with N xforms of the given weights and optional xaos
// rows. Mirrors the flat Xform shape from src/genome.ts (a,b,c,d,e,f scalars,
// not affine matrices) — identity affine + linear variation across all xforms
// since we're only exercising the pick table.
function makeGenome(weights: number[], xaos?: number[][]): Genome {
  const xforms: Xform[] = weights.map((w, i) => ({
    a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
    weight: w,
    color: 0,
    colorSpeed: 0.5,
    variations: [linear(1)],
    xaos: xaos?.[i],
  }));
  return {
    name: 't',
    xforms,
    scale: 10,
    cx: 0,
    cy: 0,
    palette: PYRE_PALETTE,
  };
}

describe('#16 — PYR3-029 #3: packXformDistrib (no xaos)', () => {
  it('two equal-weight xforms split the GRAIN evenly', () => {
    const genome = makeGenome([1, 1]);
    const buf = new Uint32Array(packXformDistrib(genome));
    // Row 0 (prev_xform = 0). With equal weights, the cumulative `r >= t`
    // scan in packXformDistrib flips j from 0 to 1 at index = GRAIN/2.
    const row0 = buf.subarray(0, CHOOSE_XFORM_GRAIN);
    const half = CHOOSE_XFORM_GRAIN >>> 1;
    expect(row0[0]).toBe(0);
    expect(row0[half - 1]).toBe(0);
    expect(row0[half]).toBe(1);
    expect(row0[CHOOSE_XFORM_GRAIN - 1]).toBe(1);

    // Fallback row (no prior xform sentinel) is at rowIdx = MAX_XFORMS.
    const rowFallback = buf.subarray(
      MAX_XFORMS * CHOOSE_XFORM_GRAIN,
      (MAX_XFORMS + 1) * CHOOSE_XFORM_GRAIN,
    );
    expect(rowFallback[half - 1]).toBe(0);
    expect(rowFallback[half]).toBe(1);
  });

  it('asymmetric weights [3, 1] bias the GRAIN by the 3:1 ratio', () => {
    const genome = makeGenome([3, 1]);
    const buf = new Uint32Array(packXformDistrib(genome));
    const row0 = buf.subarray(0, CHOOSE_XFORM_GRAIN);
    let count0 = 0, count1 = 0;
    for (let i = 0; i < CHOOSE_XFORM_GRAIN; i++) {
      if (row0[i] === 0) count0++;
      else if (row0[i] === 1) count1++;
    }
    // Expect counts within 1 of the ideal 3:1 split (rounding from dr scan).
    const expected0 = (3 / 4) * CHOOSE_XFORM_GRAIN;
    const expected1 = (1 / 4) * CHOOSE_XFORM_GRAIN;
    expect(Math.abs(count0 - expected0)).toBeLessThanOrEqual(1);
    expect(Math.abs(count1 - expected1)).toBeLessThanOrEqual(1);
    expect(count0 + count1).toBe(CHOOSE_XFORM_GRAIN);
  });
});

describe('#16 — PYR3-029 #3: packXformDistrib (with xaos)', () => {
  it('xaos row 0 → [1, 1] preserves the unconditional 50/50 split', () => {
    const genome = makeGenome([1, 1], [[1, 1], [1, 1]]);
    const buf = new Uint32Array(packXformDistrib(genome));
    const row0 = buf.subarray(0, CHOOSE_XFORM_GRAIN);
    const half = CHOOSE_XFORM_GRAIN >>> 1;
    expect(row0[half - 1]).toBe(0);
    expect(row0[half]).toBe(1);
  });

  it('xaos row 0 → [1, 0] forces all picks from row 0 to fn 0 only; row 1 stays 50/50', () => {
    // After prev_xform=0, xaos[0] = [1, 0] zeros the weight of xform 1, so
    // every slot in row 0 must point at fn 0. Row 1 uses xaos[1] = [1, 1]
    // (equal weights again).
    const genome = makeGenome([1, 1], [[1, 0], [1, 1]]);
    const buf = new Uint32Array(packXformDistrib(genome));
    const row0 = buf.subarray(0, CHOOSE_XFORM_GRAIN);
    for (let i = 0; i < CHOOSE_XFORM_GRAIN; i++) {
      expect(row0[i]).toBe(0);
    }
    const row1 = buf.subarray(CHOOSE_XFORM_GRAIN, 2 * CHOOSE_XFORM_GRAIN);
    const half = CHOOSE_XFORM_GRAIN >>> 1;
    expect(row1[half - 1]).toBe(0);
    expect(row1[half]).toBe(1);
  });
});
