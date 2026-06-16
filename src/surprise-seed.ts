// src/surprise-seed.ts
//
// Diverse-batch seed generator for the Surprise Wall. Reuses generateRandomGenome's
// full recipe (4 xforms / role affines / vibrant palette / tonemap / fit-viewport)
// and only injects a stratified primary per genome so a batch spans the catalog.

import { type Genome } from './genome';
import { generateRandomGenome } from './edit-seed';
import { pickStratifiedPrimaries } from './surprise-seed-pool';

/** Generate `n` diverse genomes: stratified primaries → full recipe each. */
export function generateSurpriseBatch(rng: () => number = Math.random, n = 16): Genome[] {
  const primaries = pickStratifiedPrimaries(rng, n);
  return primaries.map((primaryOverride) => generateRandomGenome(rng, { primaryOverride }));
}
