// src/surprise-seed.ts
//
// Diverse-batch seed generator for the Surprise Wall. Reuses generateRandomGenome's
// full recipe (4 xforms / role affines / vibrant palette / tonemap / fit-viewport)
// and only injects a stratified primary per genome so a batch spans the catalog.

import { type Genome } from './genome';
import { generateRandomGenome } from './edit-seed';
import { isAttractorCollapsed } from './edit-fit-viewport';
import { pickStratifiedPrimaries } from './surprise-seed-pool';

/** Steering params for the Surprise Wall (#surprise-v2). All optional — an empty
 *  object reproduces the original diverse-default batch. */
export interface SurpriseGenParams {
  xformCount?: number | [number, number];
  blendPerXform?: number | [number, number];
  preferred?: number[];
  preferMode?: 'featured' | 'only';
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

// The mirror image of the divergent guard: a degenerate attractor that COLLAPSES
// to ~a point (every map sharing a contractive fixed point — e.g. all affines
// with c=f=0, the #445 repro shape). It is just as pathological to render: the
// chaos kernel's ~N atomic histogram deposits all land in one cell and serialize,
// so a full-quality render crawls (11–34× slower than a normal flame at the same
// budget; #445). The CPU fit oracle already detects exactly this — computeFitBox
// returns null when the sampled attractor falls below the framing floor on BOTH
// axes (FIT_MIN_EXTENT, the collapse guard from #443) — so we reuse that signal to
// reject + re-roll before any render (editor settle / Save / CLI) inherits the
// genome. A line attractor (one axis ~0) yields a non-null box and is kept — it is
// spread along the other axis, not degenerate. Deterministic (fixed sampler seed).
export function isCollapsed(g: Genome): boolean {
  return isAttractorCollapsed(g);
}

/** Generate `n` diverse genomes: stratified primaries → full recipe each.
 *  `params` steers xform count, per-xform variation blend, and the primary pool.
 *  Divergent genomes (pathological fit-scale) AND degenerate collapse-to-point
 *  genomes (#445 — all atomic deposits serialize on one cell) are re-rolled so no
 *  render ever hangs or crawls on one. */
export function generateSurpriseBatch(
  rng: () => number = Math.random,
  n = 16,
  params: SurpriseGenParams = {},
): Genome[] {
  const primaries = pickStratifiedPrimaries(rng, n, {
    preferred: params.preferred,
    preferMode: params.preferMode,
  });
  // #450 — the preferred set drives the blend pool ONLY in 'only' mode (whole
  // flame restricted to it). In 'featured' mode the lead xform is still forced
  // to a preferred variation (via the stratified primaryOverride above), but
  // blends + other xforms draw from the broad pool → featured + diverse.
  const opts = {
    xformCount: params.xformCount,
    blendPerXform: params.blendPerXform,
    preferred: params.preferMode === 'only' ? params.preferred : undefined,
  };
  return primaries.map((primaryOverride) => {
    let g = generateRandomGenome(rng, { primaryOverride, ...opts });
    for (let r = 0; r < MAX_REROLLS && (!isRenderable(g) || isCollapsed(g)); r++) {
      g = generateRandomGenome(rng, { primaryOverride, ...opts });
    }
    return g;
  });
}
