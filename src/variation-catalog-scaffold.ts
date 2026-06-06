// #119 — Variation Catalog scaffold.
//
// Builds a sierpinski-base 3-xform genome with a target variation
// substituted into all three xforms. The slider weight `w` controls the
// linear↔variation mix per xform — at w=1 the variation fully replaces
// linear; at w=0 we render the plain sierpinski. Positional params arrive
// flat from the URL contract (`?p=5,0.7`) and map directly onto
// Variation.param0..param7.

import type { Genome, Xform } from './genome';
import { V, type Variation, type VariationIndex } from './variations';
import { PYRE_PALETTE } from './palette';

// DC variations are color-only (position contribution = 0 in the
// dispatcher for V99/100/101; V102 dc_cylinder has a position too, but
// it's a position OVERRIDE, not an additive offset). Mixing linear at
// (1-w) with a DC at w collapses the walker to the origin at w=1 — both
// visually empty AND severe atomic contention on a single histogram
// bucket. The fix: ALWAYS keep linear at full weight for DC variations,
// and include the DC variation with whatever weight the slider provides
// — only its presence in the chain matters for `dc_flag` (set by the
// packer in genome.ts whenever any DC variation is active, regardless
// of weight). At weight=0 the DC variation still triggers the color
// override path via dc_flag; the slider's effect for DC entries is
// effectively cosmetic for now (see catalog spec follow-up).
const DC_FAMILY: ReadonlySet<number> = new Set<number>([
  V.dc_linear, V.dc_perlin, V.dc_gridout, V.dc_cylinder,
]);

const SQRT3_2 = Math.sqrt(3) / 2;

/** Three sierpinski triangle vertices. Xform i contracts halfway toward
 *  corner i, producing the canonical attractor.
 *
 *  CENTERED at origin (centroid at (0, 0) by symmetry of the three
 *  vertices) so the chaos game samples all four quadrants. Sign-sensitive
 *  variations like V15 bent (`if x<0: x*=2; if y<0: y*=0.5`) require
 *  negative-coord coverage; the original "upper-right" sierpinski
 *  (vertices at (0,0),(1,0),(0.5,√3/2)) lived entirely in positive-x +
 *  positive-y, so those variations were no-ops.
 *
 *  Triangle x-span: [-√3/2, √3/2] ≈ [-0.866, 0.866]
 *  Triangle y-span: [-0.5, 1.0]   (top vertex slightly above origin) */
export const SIERPINSKI_CORNERS: readonly (readonly [number, number])[] = [
  [0, 1],
  [-SQRT3_2, -0.5],
  [SQRT3_2, -0.5],
];

export function buildCatalogGenome(
  idx: number,
  weight: number,
  params: readonly number[],
): Genome {
  const w = Math.max(0, Math.min(1, weight));
  const xforms: Xform[] = SIERPINSKI_CORNERS.map(([vx, vy], i): Xform => ({
    a: 0.5,
    b: 0,
    c: 0.5 * vx,
    d: 0,
    e: 0.5,
    f: 0.5 * vy,
    weight: 1 / 3,
    color: i / 2, // 0, 0.5, 1.0 — spread the three xforms across the palette
    colorSpeed: 0.5,
    variations: idx === V.linear
      ? [{ index: V.linear, weight: 1 }]
      : DC_FAMILY.has(idx)
      ? [
          // Linear always full-weight — DC variations don't drive position.
          { index: V.linear, weight: 1 },
          // DC variation present at slider weight; its presence (not weight)
          // sets dc_flag via the packer, triggering the color-override path.
          buildVariation(idx, w, params),
        ]
      : [
          { index: V.linear, weight: 1 - w },
          buildVariation(idx, w, params),
        ],
  }));
  return {
    name: `catalog · V${idx}`,
    xforms,
    palette: PYRE_PALETTE,
    // Camera: cx=0 centers on the triangle's centroid in x; cy=0.2 lifts
    // the view slightly to account for the y-asymmetric span [-0.5, 1.0].
    // scale=170 sizes the [-0.866, 0.866] x [-0.5, 1.0] triangle to fill
    // ~75% of the 384px catalog canvas, leaving comfortable margin.
    scale: 170,
    cx: 0,
    cy: 0.2,
  };
}

function buildVariation(
  idx: number,
  weight: number,
  params: readonly number[],
): Variation {
  const v: Variation = { index: idx as VariationIndex, weight };
  // Variation seam holds up to 8 positional params (param0..param7); the
  // ordered mapping lives in src/serialize.ts:VARIATION_PARAMS.
  if (params.length > 0) v.param0 = params[0];
  if (params.length > 1) v.param1 = params[1];
  if (params.length > 2) v.param2 = params[2];
  if (params.length > 3) v.param3 = params[3];
  if (params.length > 4) v.param4 = params[4];
  if (params.length > 5) v.param5 = params[5];
  if (params.length > 6) v.param6 = params[6];
  if (params.length > 7) v.param7 = params[7];
  return v;
}
