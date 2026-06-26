import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { genomeFromJson } from './serialize';
import { computeFitBox } from './edit-fit-viewport';

// #470 — the editor's CPU fit oracle re-sims the genome via ts_var_* to frame it
// on open (#432 fit-on-open). sprott_poly is a standalone attractor, so this is
// the load-bearing reason for the deliberate CPU mirror: without it the oracle
// identity-falls-back and the single identity-affine + post-translate xform
// becomes a drifting point (x→x+c0) that escapes — a garbage frame. This test
// proves the mirror is exercised: the fit box must center ON the attractor.
const CENTERS: Record<number, [number, number]> = {
  1: [-0.297, -0.632],
  2: [-0.445, -0.406],
  3: [0.965, -0.066],
};

describe('sprott_poly editor fit (CPU mirror)', () => {
  for (const n of [1, 2, 3]) {
    it(`frames sprott-${n} on the attractor (not an identity-fallback drift)`, () => {
      const g = genomeFromJson(JSON.parse(readFileSync(`fixtures/sprott-${n}.pyr3.json`, 'utf8')));
      const box = computeFitBox(g);
      expect(box, 'fit oracle returned null (CPU mirror not framing)').not.toBeNull();
      const [cx, cy] = CENTERS[n]!;
      // Within ~1 unit of the attractor's percentile center — far tighter than an
      // identity-drift frame would ever land.
      expect(Math.abs(box!.cx - cx)).toBeLessThan(1.0);
      expect(Math.abs(box!.cy - cy)).toBeLessThan(1.0);
      expect(box!.bbW).toBeGreaterThan(0.1);
      expect(box!.bbH).toBeGreaterThan(0.1);
    });
  }
});
