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

const SQRT3_2 = Math.sqrt(3) / 2;

/** Three sierpinski triangle vertices. Xform i contracts halfway toward
 *  corner i, producing the canonical attractor. */
export const SIERPINSKI_CORNERS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [0.5, SQRT3_2],
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
      : [
          { index: V.linear, weight: 1 - w },
          buildVariation(idx, w, params),
        ],
  }));
  return {
    name: `catalog · V${idx}`,
    xforms,
    palette: PYRE_PALETTE,
    scale: 96,
    cx: 0.5,
    cy: SQRT3_2 / 2,
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
