// src/surprise-seed.ts
//
// Diverse-batch seed generator for the Surprise Wall. Reuses generateRandomGenome's
// full recipe (4 xforms / role affines / vibrant palette / tonemap / fit-viewport)
// and only injects a stratified primary per genome so a batch spans the catalog.

import { type Genome } from './genome';
import { generateRandomGenome } from './edit-seed';
import { isAttractorCollapsed } from './edit-fit-viewport';
import { pickStratifiedPrimaries } from './surprise-seed-pool';
import { V } from './variations';
import { generateSprottGenome } from './sprott-search';
import { generateHopalongGenome } from './hopalong-search';
import { generateGmGenome } from './gm-search';

/** Creator-wall attractor pool: with probability `total`, a wall slot becomes a
 *  single-map strange attractor instead of a flame; the type is picked evenly
 *  from `gens`. Default total 0 (empty gens) → non-wall callers + the flame
 *  tests stay pure-flame. The wall passes ATTRACTOR_POOL. (#466/#467; was the
 *  single #470 SPROTT_FRACTION number.) */
export interface AttractorPool {
  total: number;
  gens: Array<(rng: () => number) => Genome | null>;
}
export const ATTRACTOR_POOL: AttractorPool = {
  total: 0.3,
  gens: [generateSprottGenome, generateHopalongGenome, generateGmGenome],
};

/** Single-map attractor variations → their single-xform generator. These cannot
 *  be ordinary multi-xform-flame primaries (they only show their look ALONE on an
 *  identity-affine weight-1 xform), so a `?vars=…` filter routes them to the pool
 *  rather than featuring them as a warp. */
const ATTRACTOR_GENS: Record<number, (rng: () => number) => Genome | null> = {
  [V.sprott_poly]: generateSprottGenome,
  [V.hopalong]: generateHopalongGenome,
  [V.gumowski_mira]: generateGmGenome,
};

/** True if `idx` is a single-map strange-attractor variation. */
export function isAttractorVariation(idx: number): boolean {
  return Object.prototype.hasOwnProperty.call(ATTRACTOR_GENS, idx);
}

/** Resolve the wall's attractor pool from a `/creator?vars=…` deep-link seed:
 *  - no seed (default wall) → the full 0.3 mixed pool.
 *  - exactly one single-map attractor → a focused 100% pool of that attractor, so
 *    `/creator?vars=hopalong` is a wall of fresh auto-searched Hopalong attractors
 *    (NOT hopalong featured as a multi-xform warp).
 *  - any other filter (a normal variation, or a mix) → attractors SUPPRESSED so the
 *    filter is respected and sprott/etc. no longer leak into it (#472). */
export function attractorPoolFor(preferred: number[] | undefined): AttractorPool {
  if (!preferred || preferred.length === 0) return ATTRACTOR_POOL;
  if (preferred.length === 1 && isAttractorVariation(preferred[0]!)) {
    return { total: 1, gens: [ATTRACTOR_GENS[preferred[0]!]!] };
  }
  return { total: 0, gens: [] };
}

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
  // #466/#467 — opt-in attractor pool: empty by default so non-wall callers (and
  // the flame-generation tests) stay pure-flame. The Creator wall passes
  // ATTRACTOR_POOL (sprott + hopalong + gm, ~0.3 split 3 ways).
  pool: AttractorPool = { total: 0, gens: [] },
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
    // #466/#467 — with prob pool.total, emit a single-map strange attractor of an
    // evenly-picked type. The gate rng() is ALWAYS drawn (matching the old #470
    // single-fraction cadence) so the empty-pool default path's rng stream — and
    // therefore every non-wall flame — is byte-identical to before. A give-up
    // (null) or unfittable result falls through to a flame.
    const gate = rng();
    if (pool.gens.length > 0 && gate < pool.total) {
      const pick = pool.gens[Math.min(pool.gens.length - 1, Math.floor(rng() * pool.gens.length))]!;
      const s = pick(rng);
      if (s) return s;
    }
    let g = generateRandomGenome(rng, { primaryOverride, ...opts });
    for (let r = 0; r < MAX_REROLLS && (!isRenderable(g) || isCollapsed(g)); r++) {
      g = generateRandomGenome(rng, { primaryOverride, ...opts });
    }
    return g;
  });
}
