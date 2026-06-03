// pyr3 — symmetry helpers (Phase 5c).
//
// flam3-canonical IFS attractor symmetry: instead of rotating every existing
// xform (which would NOT produce attractor symmetry), we ADD pure
// rotation/reflection xforms to the chaos pick pool. The attractor's
// symmetry emerges because the chaos game randomly picks rotation
// operators alongside user-defined xforms.
//
// Reference: flam3.c:2552-2640 (`flam3_add_symmetry`).

import { type Genome, type Symmetry, type Xform, MAX_XFORMS } from './genome';
import { linear } from './variations';

const ROUND6 = 1e6;
const round6 = (x: number): number => Math.round(x * ROUND6) / ROUND6;

/** Pure-CPU pre-pack expansion. Returns the same `genome` reference when no
 *  expansion is needed (fast path). Otherwise returns a new shallow-cloned
 *  Genome with symmetry xforms appended and `symmetry` cleared (defensive
 *  against accidental double-expansion). The input `genome` is never mutated. */
export function expandGenomeForGPU(genome: Genome): Genome {
  // Active-state zeroing pre-pass. Returns the same genome reference when
  // every xform / variation is active (fast path). Otherwise returns a
  // new genome with inactive entries' weights packed as 0. The user's
  // authored weights in the input genome stay untouched.
  let working = genome;
  const needsZeroing =
    genome.xforms.some(
      x => x.active === false || x.variations.some(v => v.active === false),
    );
  if (needsZeroing) {
    working = {
      ...genome,
      xforms: genome.xforms.map(x => ({
        ...x,
        weight: x.active === false ? 0 : x.weight,
        variations: x.variations.map(v => ({
          ...v,
          weight: v.active === false ? 0 : v.weight,
        })),
      })),
    };
  }

  if (!working.symmetry) return working;
  const extras = generateSymmetryXforms(working.symmetry);
  if (extras.length === 0) return working;
  const total = working.xforms.length + extras.length;
  if (total > MAX_XFORMS) {
    throw new Error(
      `pyr3: symmetry expansion exceeds MAX_XFORMS (${MAX_XFORMS}): ` +
        `${working.xforms.length} source + ${extras.length} generated = ${total}. ` +
        `Reduce source xforms or symmetry n.`,
    );
  }
  return {
    ...working,
    xforms: [...working.xforms, ...extras],
    symmetry: undefined,
  };
}

/** Build the rotation/reflection xforms implied by a symmetry declaration.
 *  Matches flam3.c:2585-2634 exactly:
 *  - dihedral generates a Y-axis-mirroring reflection (a=-1, b=0, d=0, e=1)
 *    at slot 0
 *  - then rotations by k·2π/n for k=1..n-1 in increasing-k order
 *  - color spread (k-1)/(n-2) for n>=3, else 0.0
 *  - color_speed=0, weight=1, single linear(1) variation per generated xform */
export function generateSymmetryXforms(sym: Symmetry): Xform[] {
  const out: Xform[] = [];
  const n = sym.n;

  // n=1 rotational: no extra rotations to add (identity rotation = source xforms).
  // n=1 dihedral: falls through and adds just the reflection (bilateral-only).
  if (sym.kind === 'rotational' && n === 1) return out;

  if (sym.kind === 'dihedral') {
    // Y-axis reflection: flip X. Matches flam3.c:2600-2603.
    out.push(makeIdentityOpXform(-1, 0, 0, 1, /* color */ 1.0));
  }

  // Rotations by k * 2π/n for k = 1..n-1 (CCW, matching flam3).
  const a = (2 * Math.PI) / n;
  for (let k = 1; k < n; k++) {
    const c = round6(Math.cos(k * a));
    const s = round6(Math.sin(k * a));
    // CCW rotation in pyr3's affine layout: new_x = cos*x - sin*y,
    // new_y = sin*x + cos*y → a=cos, b=-sin, d=sin, e=cos.
    // flam3 ref: flam3.c:2628-2631 (after column-vs-row mapping —
    // flam3's c[0][0..1] are pyr3's (a, d) and c[1][0..1] are (b, e),
    // because flam3's apply_xform does `tx = c[0][0]*x + c[1][0]*y`).
    const color = n < 3 ? 0.0 : (k - 1) / (n - 2);
    out.push(makeIdentityOpXform(c, -s, s, c, color));
  }

  return out;
}

function makeIdentityOpXform(
  a: number, b: number, d: number, e: number, color: number,
): Xform {
  return {
    a, b, c: 0,
    d, e, f: 0,
    weight: 1,
    color,
    colorSpeed: 0,
    variations: [linear(1)],
  };
}
