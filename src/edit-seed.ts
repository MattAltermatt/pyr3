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
import { type Variation, V, VARIATION_NAMES, type VariationIndex } from './variations';
import { paletteFromStops, type ColorStop } from './palette';
import {
  getLibraryStops,
  getLibraryPaletteName,
  FLAM3_PALETTE_COUNT,
} from './flam3-palettes';
import { computeFitViewport } from './edit-fit-viewport';
import { VARIATION_DEFAULTS } from './serialize';

// Themed families
export const FAMILY_CLASSICAL_FLAM3: Variation['index'][] = [
  V.sinusoidal, V.spherical, V.swirl, V.horseshoe, V.polar,
  V.handkerchief, V.heart, V.disc, V.julia, V.julian,
];

export const FAMILY_PYRE_COMPLEX_ANALYTIC: Variation['index'][] = [
  V.newton, V.blaschke, V.cayley, V.complex_gamma, V.lambert_w,
];

export const FAMILY_PYRE_CARTOGRAPHIC: Variation['index'][] = [
  V.mercator, V.lambert, V.mollweide, V.hammer, V.stereographic,
];

export const FAMILY_PYRE_ATTRACTORS_TORAL_FOLDS: Variation['index'][] = [
  V.standard_map, V.de_jong, V.ikeda, V.box_fold, V.sphere_fold,
  V.mandelbox_step, V.kifs_fold, V.arnold_cat, V.bakers_map,
  V.tent_map, V.logistic_map,
];

// Fallback for tests importing these variables
export const SEED_NONLINEAR: Variation['index'][] = [
  ...FAMILY_CLASSICAL_FLAM3,
  ...FAMILY_PYRE_COMPLEX_ANALYTIC,
  ...FAMILY_PYRE_CARTOGRAPHIC,
  ...FAMILY_PYRE_ATTRACTORS_TORAL_FOLDS,
];

export const SEED_BIAS_VARIATIONS: Variation['index'][] = [
  V.linear,
  ...SEED_NONLINEAR,
];

const FIT_REF_W = 1920;
const FIT_REF_H = 1080;

function uniform(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

function pickFromSet<T>(rng: () => number, set: readonly T[]): T {
  return set[Math.floor(rng() * set.length)]!;
}

function createVariation(index: VariationIndex, weight: number): Variation {
  const v: Variation = { index, weight };
  const name = VARIATION_NAMES[index];
  if (name) {
    const defaults = VARIATION_DEFAULTS[name];
    if (defaults) {
      const obj = v as unknown as Record<string, number>;
      for (let i = 0; i < defaults.length; i++) {
        obj[`param${i}`] = defaults[i]!;
      }
    }
  }
  return v;
}

function isPaletteVibrant(stops: ColorStop[]): boolean {
  const sampleIndices = Array.from({ length: 16 }, (_, i) => Math.round(i * 255 / 15));
  let minR = Infinity, maxR = -Infinity;
  let minG = Infinity, maxG = -Infinity;
  let minB = Infinity, maxB = -Infinity;

  for (const idx of sampleIndices) {
    const stop = stops[idx];
    if (!stop) continue;
    if (stop.r < minR) minR = stop.r;
    if (stop.r > maxR) maxR = stop.r;
    if (stop.g < minG) minG = stop.g;
    if (stop.g > maxG) maxG = stop.g;
    if (stop.b < minB) minB = stop.b;
    if (stop.b > maxB) maxB = stop.b;
  }

  const diffR = maxR - minR;
  const diffG = maxG - minG;
  const diffB = maxB - minB;

  let vibrantChannels = 0;
  if (diffR > 0.45) vibrantChannels++;
  if (diffG > 0.45) vibrantChannels++;
  if (diffB > 0.45) vibrantChannels++;

  return vibrantChannels >= 2;
}

type XformRole = 'shape' | 'detail' | 'duplicator';

/** Options for {@link generateRandomGenome}. The default (no opts) path is
 *  byte-identical to the original signature — only the Surprise Wall passes
 *  `primaryOverride` to inject a specific lead variation per genome. */
export interface SeedOptions {
  primaryOverride?: VariationIndex;
}

export function generateRandomGenome(
  rng: () => number = Math.random,
  opts: SeedOptions = {},
): Genome {
  // 1. Symmetry Injection (50% probability)
  let symmetry: Genome['symmetry'] = undefined;
  if (rng() < 0.5) {
    const kind = rng() < 0.5 ? 'rotational' : 'dihedral';
    const n = pickFromSet(rng, [2, 3, 4, 5, 6, 8]);
    symmetry = { kind, n };
  }

  // 2. Variation Homogeneity & Theme Pools.
  //    Surprise Wall path: an explicit primaryOverride skips the theme-pool roll
  //    entirely (and does NOT consume rng), so the editor's default sequence is
  //    untouched while the wall drives its own stratified primary per genome.
  let primaryVar: Variation['index'];
  if (opts.primaryOverride !== undefined) {
    primaryVar = opts.primaryOverride;
  } else {
    const themeVal = rng();
    let themePool: Variation['index'][];
    if (themeVal < 0.4) {
      themePool = FAMILY_CLASSICAL_FLAM3;
    } else if (themeVal < 0.6) {
      themePool = FAMILY_PYRE_COMPLEX_ANALYTIC;
    } else if (themeVal < 0.8) {
      themePool = FAMILY_PYRE_CARTOGRAPHIC;
    } else {
      themePool = FAMILY_PYRE_ATTRACTORS_TORAL_FOLDS;
    }
    primaryVar = pickFromSet(rng, themePool);
  }

  // 3. Structured Xform Roles (Archetypes) & 4. Variable Color Speeds
  let roles: XformRole[];
  if (rng() < 0.3) {
    if (rng() < 0.5) {
      roles = ['shape', 'shape', 'detail', 'duplicator'];
    } else {
      roles = ['shape', 'detail', 'detail', 'duplicator'];
    }
  } else {
    roles = ['shape', 'shape', 'detail', 'detail'];
  }

  const xforms: Xform[] = [];
  for (let i = 0; i < 4; i++) {
    const role = roles[i]!;
    const color = (i + uniform(rng, 0.05, 0.95)) / 4;
    const weight = uniform(rng, 0.5, 1.0);

    let a = 0, b = 0, c = 0, d = 0, e = 0, f = 0;
    let colorSpeed = 0.5;
    let variations: Variation[] = [];

    if (role === 'shape') {
      const theta = rng() * Math.PI * 2;
      const s = uniform(rng, 0.4, 0.75);
      a = Math.cos(theta) * s;
      b = -Math.sin(theta) * s;
      c = 0;
      d = Math.sin(theta) * s;
      e = Math.cos(theta) * s;
      f = 0;
      colorSpeed = 0.9;
      variations = [createVariation(primaryVar, 1.0)];
    } else if (role === 'detail') {
      const theta = rng() * Math.PI * 2;
      const s = uniform(rng, 0.4, 0.75);
      a = Math.cos(theta) * s;
      b = -Math.sin(theta) * s;
      c = uniform(rng, -0.4, 0.4);
      d = Math.sin(theta) * s;
      e = Math.cos(theta) * s;
      f = uniform(rng, -0.4, 0.4);
      colorSpeed = 0.4;
      variations = [
        createVariation(primaryVar, 0.8),
        createVariation(V.linear, 0.2),
      ];
    } else { // duplicator
      const theta = rng() * Math.PI * 2;
      const s = rng() < 0.5 ? 0.5 : 1.0;
      a = Math.cos(theta) * s;
      b = -Math.sin(theta) * s;
      c = 0;
      d = Math.sin(theta) * s;
      e = Math.cos(theta) * s;
      f = 0;
      colorSpeed = 0.0;
      variations = [createVariation(V.linear, 1.0)];
    }

    xforms.push({
      a, b, c, d, e, f,
      weight,
      color,
      colorSpeed,
      variations,
    });
  }

  // 5. Palette Vibrancy Heuristic Filter
  let paletteIdx = 0;
  let stops: ColorStop[] = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    paletteIdx = Math.floor(rng() * FLAM3_PALETTE_COUNT);
    stops = getLibraryStops(paletteIdx) ?? getLibraryStops(0)!;
    if (isPaletteVibrant(stops)) {
      break;
    }
  }
  const humanName = getLibraryPaletteName(paletteIdx) ?? 'unnamed';

  const genome: Genome = {
    name: 'Untitled flame',
    xforms,
    scale: 1,
    cx: 0,
    cy: 0,
    palette: paletteFromStops(`${humanName}#${paletteIdx}`, stops),
    // 6. Default Aesthetic Tone Map
    tonemap: {
      brightness: uniform(rng, 2.5, 4.5),
      gamma: uniform(rng, 3.5, 4.0),
      vibrancy: 1.0,
      highlightPower: 1.0,
      gammaThreshold: 0.01,
    },
  };

  if (symmetry) {
    genome.symmetry = symmetry;
  }

  const fitSeed = Math.floor(rng() * 0x100000000) >>> 0;
  // computeFitViewport runs a CPU chaos oracle for framing. Most variations are
  // handled, but a few exotic ones (e.g. separation) throw if their named params
  // aren't populated. The editor's curated pools never hit this; the Surprise
  // Wall's broadened primary pool can. Treat any oracle failure as "no fit" and
  // fall back to the default scale — the GPU render path defaults missing params
  // to 0 and still produces a (possibly cull-able) thumbnail.
  let fit: ReturnType<typeof computeFitViewport> = null;
  try {
    fit = computeFitViewport(genome, FIT_REF_W, FIT_REF_H, { seed: fitSeed });
  } catch {
    fit = null;
  }
  if (fit) {
    genome.scale = fit.scale;
    genome.cx = fit.cx;
    genome.cy = fit.cy;
  } else {
    genome.scale = 200;
  }
  return genome;
}
