// src/surprise-seed.ts
//
// Diverse-batch seed generator for the Surprise Wall. Reuses generateRandomGenome's
// full recipe (4 xforms / role affines / vibrant palette / tonemap / fit-viewport)
// and only injects a stratified primary per genome so a batch spans the catalog.

import { type Genome } from './genome';
import { generateRandomGenome } from './edit-seed';
import { pickStratifiedPrimaries } from './surprise-seed-pool';

/** Steering params for the Surprise Wall (#surprise-v2). All optional — an empty
 *  object reproduces the original diverse-default batch. */
export interface SurpriseGenParams {
  xformCount?: number | [number, number];
  blendPerXform?: number | [number, number];
  preferred?: number[];
  preferMode?: 'bias' | 'only';
}

// A convergent attractor frames at scale ~40..6000; a divergent one (too few
// contractive maps — e.g. a 2-xform flame with a scale-1.0 duplicator) makes
// computeFitViewport return an enormous scale. Such flames hang the GPU chaos
// kernel (its coords blow up → bad-value retry thrash), so we reject + re-roll
// them here, before any render sees them. (#surprise-v2)
const MAX_SANE_SCALE = 50000;
const MAX_REROLLS = 4;

function isRenderable(g: Genome): boolean {
  return Number.isFinite(g.scale) && Math.abs(g.scale) < MAX_SANE_SCALE;
}

/** Generate `n` diverse genomes: stratified primaries → full recipe each.
 *  `params` steers xform count, per-xform variation blend, and the primary pool.
 *  Divergent genomes (pathological fit-scale) are re-rolled so the render never
 *  hangs on one. */
export function generateSurpriseBatch(
  rng: () => number = Math.random,
  n = 16,
  params: SurpriseGenParams = {},
): Genome[] {
  const primaries = pickStratifiedPrimaries(rng, n, {
    preferred: params.preferred,
    preferMode: params.preferMode,
  });
  const opts = {
    xformCount: params.xformCount,
    blendPerXform: params.blendPerXform,
    preferred: params.preferred,
  };
  return primaries.map((primaryOverride) => {
    let g = generateRandomGenome(rng, { primaryOverride, ...opts });
    for (let r = 0; r < MAX_REROLLS && !isRenderable(g); r++) {
      g = generateRandomGenome(rng, { primaryOverride, ...opts });
    }
    return g;
  });
}
