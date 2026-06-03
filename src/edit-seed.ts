// pyr3 — procedural seed generator for the /v1/edit page.
//
// Produces a fresh, visually-friendly Genome from an injectable rng so tests
// stay deterministic. Mirrored from the parked evolve-seed pattern on
// feature/issue-73-evolve-page; later cleanup can DRY them when evolve
// un-parks.

import { type Genome, type Xform } from './genome';
import { type Variation, V } from './variations';
import { getLibraryStops, FLAM3_PALETTE_COUNT } from './flam3-palettes';

// Curated variation subset. Avoids cell-shocking the user with var_pre_blur /
// var_gaussian_blur / var_noise on the first frame.
const SEED_VARIATIONS: number[] = [
  V.linear, V.sinusoidal, V.spherical, V.swirl, V.horseshoe,
  V.polar, V.heart, V.disc, V.spiral, V.hyperbolic, V.diamond,
  V.ex, V.julia, V.bent, V.waves, V.fisheye,
];

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function randomXform(rng: () => number): Xform {
  const v = pick(rng, SEED_VARIATIONS);
  const variations: Variation[] = [
    { index: v as Variation['index'], weight: 0.4 + rng() * 0.6 },
  ];
  return {
    a: -1 + rng() * 2,
    b: -1 + rng() * 2,
    c: -0.5 + rng() * 1,
    d: -1 + rng() * 2,
    e: -1 + rng() * 2,
    f: -0.5 + rng() * 1,
    weight: 0.4 + rng() * 0.6,
    color: rng(),
    colorSpeed: 0.5,
    // opacity left undefined — defaults to 1; the serializer round-trip drops
    // explicit 1 values, so omitting here keeps save→reopen byte-identical.
    variations,
  };
}

export function generateRandomGenome(rng: () => number = Math.random): Genome {
  const xformCount = 2 + Math.floor(rng() * 3); // 2..4
  const xforms: Xform[] = [];
  for (let i = 0; i < xformCount; i++) xforms.push(randomXform(rng));
  const paletteIdx = Math.floor(rng() * FLAM3_PALETTE_COUNT);
  const stops = getLibraryStops(paletteIdx) ?? [];
  return {
    name: 'Untitled flame',
    xforms,
    scale: 200,
    cx: 0,
    cy: 0,
    palette: {
      name: `flame #${paletteIdx}`,
      stops,
    },
  };
}
