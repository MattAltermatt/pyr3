// pyr3 — procedural seed generator for the /v1/edit page.
//
// Produces a fresh, visually-interesting Genome from an injectable rng so
// tests stay deterministic. The original edit-seed (uniform-random affine
// in [-1, 1]) produced lots of degenerate / blank flames because
// uncontrolled affines escape to infinity or collapse to fixed points. The
// recipe below guarantees a real attractor every time:
//
//   1. Contractive affine via rotation × scale ∈ [0.55, 0.88]. Eigenvalues
//      strictly < 1 → bounded orbits → an actual fractal, not a divergence.
//   2. First variation per xform is NON-LINEAR (linear excluded). Pure
//      linear collapses the IFS to a point attractor.
//   3. 1–3 variations per xform with tapered weights (first strong, rest
//      weaker). Denser chains give richer attractors without overwhelming
//      the dominant non-linear shape.
//   4. Four xforms — empirically a sweet spot between "too sparse" (2-3
//      xforms = often striped/linear-looking) and "too noisy" (5+ = mush).
//   5. Auto-fit viewport via computeFitViewport so first paint frames the
//      attractor instead of a pixel-sized speck inside a huge world window.

import { type Genome, type Xform } from './genome';
import { type Variation, V } from './variations';
import { paletteFromStops } from './palette';
import {
  getLibraryStops,
  getLibraryPaletteName,
  FLAM3_PALETTE_COUNT,
} from './flam3-palettes';
import { computeFitViewport } from './edit-fit-viewport';

// First-variation pool: non-linear only. A pure-linear first variation
// reduces the xform to its (contractive) affine, which has no fractal
// structure. Skipping it gives the IFS its non-trivial geometry.
export const SEED_NONLINEAR: Variation['index'][] = [
  V.sinusoidal, V.spherical, V.swirl, V.horseshoe,
  V.polar, V.handkerchief, V.heart, V.disc, V.spiral,
  V.hyperbolic, V.diamond, V.ex, V.julia,
];

// Full bias pool for SECONDARY variations. Includes linear (a low-weight
// linear blend with a non-linear primary often produces interesting,
// slightly-warped attractors).
export const SEED_BIAS_VARIATIONS: Variation['index'][] = [
  V.linear, ...SEED_NONLINEAR,
];

const SEED_XFORM_COUNT = 4;

// Reference canvas for the auto-fit at seed time. Matches the editor's
// default genome.size (1920×1080) so a freshly-rerolled flame looks framed
// on the editor's typical preview/render dims without a manual fit step.
const FIT_REF_W = 1920;
const FIT_REF_H = 1080;

function uniform(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

function pickFromSet<T>(rng: () => number, set: readonly T[]): T {
  return set[Math.floor(rng() * set.length)]!;
}

function buildSeedXform(rng: () => number): Xform {
  // Variation chain — 1 / 2 / 3 with bias toward 2.
  const r = rng();
  const variationCount = r < 0.3 ? 1 : r < 0.8 ? 2 : 3;

  const variations: Variation[] = [];
  const used = new Set<number>();

  // First variation: non-linear, strong weight.
  const firstIdx = pickFromSet(rng, SEED_NONLINEAR);
  used.add(firstIdx);
  variations.push({ index: firstIdx, weight: uniform(rng, 0.7, 1.0) });

  // Additional variations: full bias set, tapered weight. The attempt cap
  // is load-bearing — a constant rng (used in unit tests like
  // edit-state.test.ts's `() => 0.5`) would otherwise repeatedly return the
  // same index forever. After N misses, accept the smaller chain.
  let attempts = 0;
  while (variations.length < variationCount && attempts < 32) {
    attempts++;
    const idx = pickFromSet(rng, SEED_BIAS_VARIATIONS);
    if (used.has(idx)) continue;
    used.add(idx);
    variations.push({ index: idx, weight: uniform(rng, 0.3, 0.7) });
  }

  // Contractive affine: rotation × scale s ∈ [0.55, 0.88]. Mean |λ| < 1
  // keeps the IFS bounded; the small translation breaks symmetry so the
  // four xforms don't all converge on the same fixed point.
  const theta = rng() * Math.PI * 2;
  const s = uniform(rng, 0.55, 0.88);
  const cosT = Math.cos(theta) * s;
  const sinT = Math.sin(theta) * s;
  return {
    a: cosT,
    b: -sinT,
    c: uniform(rng, -0.25, 0.25),
    d: sinT,
    e: cosT,
    f: uniform(rng, -0.25, 0.25),
    weight: uniform(rng, 0.5, 1.0),
    color: rng(),
    colorSpeed: 0.5,
    variations,
  };
}

export function generateRandomGenome(rng: () => number = Math.random): Genome {
  const xforms: Xform[] = [];
  for (let i = 0; i < SEED_XFORM_COUNT; i++) {
    xforms.push(buildSeedXform(rng));
  }
  const paletteIdx = Math.floor(rng() * FLAM3_PALETTE_COUNT);
  const stops = getLibraryStops(paletteIdx) ?? getLibraryStops(0)!;
  const humanName = getLibraryPaletteName(paletteIdx) ?? 'unnamed';

  const genome: Genome = {
    name: 'Untitled flame',
    xforms,
    // Placeholder viewport — overwritten by fit below.
    scale: 1,
    cx: 0,
    cy: 0,
    palette: paletteFromStops(`${humanName}#${paletteIdx}`, stops),
  };

  // Auto-fit the attractor into the editor's default render dims so the
  // freshly-rerolled flame paints framed, not as a speck. The fit sampler
  // is deterministic (seeded from a u32 derived from the rng draws above)
  // so the seed-genome relationship stays pure.
  const fitSeed = Math.floor(rng() * 0x100000000) >>> 0;
  const fit = computeFitViewport(genome, FIT_REF_W, FIT_REF_H, { seed: fitSeed });
  if (fit) {
    genome.scale = fit.scale;
    genome.cx = fit.cx;
    genome.cy = fit.cy;
  } else {
    // Degenerate seed (shouldn't happen with the contractive recipe, but
    // safe fallback so a click of reroll never lands on a broken genome).
    genome.scale = 200;
  }
  return genome;
}
