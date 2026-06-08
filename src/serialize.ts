// Phase 5a — `.pyr3.json` schema (version 1) and round-trip serialization.
//
// JSON external shape uses named variation + named params. Internal Variation
// shape stays positional (matches GPU pack layout); translation lives here.
//
// Forward-compat: Phase 5b will add optional `finalxform`; Phase 5c will add
// optional `symmetry`. Neither requires a version bump (additive optional fields).

import { type Genome, type Symmetry, type Xform, type Pyr3Size, type SpatialFilter, type ChannelCurves, isSpatialFilterShape } from './genome';
import { type Tonemap, DEFAULT_TONEMAP } from './tonemap';
import { type Density, MAX_RAD_CAP, MIN_CURVE, MAX_CURVE } from './density';
import {
  type Variation,
  type VariationIndex,
  V,
  VARIATION_NAMES,
} from './variations';
import { type ColorStop, type PaletteMode } from './palette';

export const PYR3_JSON_VERSION = 1;

export interface Pyr3JsonV1 {
  version: 1;
  name: string;
  viewport: { scale: number; cx: number; cy: number };
  palette: {
    name: string;
    stops: ColorStop[];
    hue?: number;
    mode?: PaletteMode;
  };
  xforms: Pyr3JsonXform[];
  finalxform?: Pyr3JsonFinalxform;
  symmetry?: { kind: 'rotational' | 'dihedral'; n: number };
  density?: { maxRad: number; minRad: number; curve: number };
  tonemap?: Pyr3JsonTonemap;
  /** Phase 9-rotate: camera rotation in degrees CCW (matches flam3 `<flame rotate="N">`).
   *  Omitted from JSON when 0 / undefined (additive, no version bump). */
  rotate?: number;
  /** Phase 9-cal-B: target samples per pixel (matches flam3 `<flame quality=N>`).
   *  Omitted from JSON when undefined (additive, no version bump). */
  quality?: number;
  /** Phase 9-supersample-real: super-resolution multiplier (matches flam3
   *  `<flame supersample="N">`). Omitted from JSON when undefined or 1. */
  oversample?: number;
  /** Phase 9-size: optional render dimensions (matches flam3 `<flame size="W H">`).
   *  Both must be positive integers. Omitted when undefined (additive). */
  size?: Pyr3Size;
  /** Phase 9-filter: optional spatial AA Gaussian filter. Omitted when undefined
   *  (additive). Only `'gaussian'` shape supported in v1. */
  spatialFilter?: SpatialFilter;
  /** Phase 9-bg-palmode: flam3 `<flame background="R G B">`. Each component
   *  in [0,1]. Omitted when undefined. */
  background?: [number, number, number];
  /** Phase 9-bg-palmode: flam3 `<flame palette_mode="step|linear">`.
   *  Omitted when undefined. */
  paletteMode?: PaletteMode;
  /** Issue #116 — post-tonemap Color Curves. Omitted when all 5 channels
   *  are identity (parity invariant: serialized field absence ≡ identity
   *  ≡ shader branches off ≡ byte-identical to no-curves render). */
  channelCurves?: ChannelCurves;
  hslAdjust?: { hue: number; sat: number; light: number };
}

export type Pyr3JsonFinalxform = Omit<Pyr3JsonXform, 'weight'>;

/** Phase 9a — flam3-canonical tone-map params. All fields optional in JSON;
 *  missing fields fill from DEFAULT_TONEMAP at load time. */
export interface Pyr3JsonTonemap {
  gamma?: number;
  vibrancy?: number;
  highlightPower?: number;
  brightness?: number;
  gammaThreshold?: number;
}

export interface Pyr3JsonXform {
  weight: number;
  color: number;
  colorSpeed: number;
  affine: { a: number; b: number; c: number; d: number; e: number; f: number };
  variations: Pyr3JsonVariation[];
  /** Phase 9d — render-only weighting (0..1). Omitted when 1.0. */
  opacity?: number;
  /** Phase 9d — per-source weight multipliers for next-xform pick. Omitted when undefined. */
  xaos?: number[];
  /** Phase 9c — per-xform post-affine. Omitted when undefined (no post). */
  post?: { a: number; b: number; c: number; d: number; e: number; f: number };
  /** Editor-only on/off toggle. Omitted unless explicitly false. */
  active?: boolean;
}

export interface Pyr3JsonVariation {
  name: string;
  weight: number;
  params?: Record<string, number>;
  /** Editor-only on/off toggle. Omitted unless explicitly false. */
  active?: boolean;
}

/** Per-variation positional-param schema. Each entry maps variation name →
 *  ordered list of param names corresponding to (param0..param5). Variations
 *  not listed here are parameterless.
 *
 *  Phase 9b extension (2026-05-12): seam grew from 2 → 6 slots to support
 *  `pdj` (4 params) and unblock blob/ngon/wedge/cpow/curve/etc. The flam3
 *  attribute name in `.flame` XML is `${varName}_${paramSuffix}` (e.g.
 *  `pdj_a`, `julian_power`), and the JSON params object uses the same key. */
export const VARIATION_PARAMS: Record<string, string[]> = {
  julian: ['power', 'dist'],
  disc2: ['rot', 'twist'],
  pdj: ['a', 'b', 'c', 'd'],
  // Phase 9b Batch B param-bearing kernels. Names match flam3's `.flame`
  // attribute suffix convention (`rings2_val`, `fan2_x`, etc.).
  rings2: ['val'],
  fan2: ['x', 'y'],
  perspective: ['angle', 'dist'],
  bipolar: ['shift'],
  curl: ['c1', 'c2'],
  rectangles: ['x', 'y'],
  // Phase 9b Batch C — 3-4 param kernels consuming vars_extra (param2/3).
  // Names match flam3 attribute suffix convention.
  blob: ['low', 'high', 'waves'],
  ngon: ['sides', 'power', 'circle', 'corners'],
  wedge: ['angle', 'hole', 'count', 'swirl'],
  cpow: ['r', 'i', 'power'],
  curve: ['xamp', 'yamp', 'xlength', 'ylength'],
  // Phase 9b Batch D — only the param-bearing RNG kernels need entries here.
  // The 0-param RNG kernels (noise/blur/gaussian_blur/arch/square/rays/blade/
  // twintrian) live in V but have no params to map.
  radial_blur: ['angle'],
  juliascope: ['power', 'dist'],
  // Phase 9b Batch G param-bearing kernels.
  bent2: ['x', 'y'],
  cell: ['size'],
  escher: ['beta'],
  modulus: ['x', 'y'],
  split: ['xsize', 'ysize'],
  splits: ['x', 'y'],
  stripes: ['space', 'warp'],
  whorl: ['inside', 'outside'],
  flux: ['spread'],
  // Phase 9b Batch H param-bearing kernels.
  popcorn2: ['x', 'y', 'c'],
  lazysusan: ['x', 'y', 'spin', 'twist', 'space'],
  waves2: ['scalex', 'freqx', 'scaley', 'freqy'],
  oscilloscope: ['frequency', 'amplitude', 'damping', 'separation'],
  separation: ['x', 'xinside', 'y', 'yinside'],
  auger: ['freq', 'weight', 'scale', 'sym'],
  wedge_sph: ['angle', 'hole', 'count', 'swirl'],
  super_shape: ['rnd', 'm', 'n1', 'n2', 'n3', 'holes'],
  flower: ['petals', 'holes'],
  conic: ['eccentricity', 'holes'],
  parabola: ['height', 'width'],
  pie: ['slices', 'rotation', 'thickness'],
  wedge_julia: ['angle', 'count', 'power', 'dist'],
  // Phase 9b Batch K — mobius (8 params).
  mobius: ['re_a', 'im_a', 're_b', 'im_b', 're_c', 'im_c', 're_d', 'im_d'],
  // #114 — DC (direct-color) variation params. JWildfire .flame XML
  // serializes these as `dc_perlin_scale`, `dc_perlin_octaves`, etc. —
  // the standard `${var}_${param}` convention.
  // dc_linear and dc_cylinder are 0-param (no entries needed; absence
  // means "no params", consistent with linear/spherical/etc.).
  dc_perlin: ['scale', 'octaves', 'color_seed'],
  dc_gridout: ['cells'],
  // #114 batch 1 — post-flam3 plugin pack. Names match the JWildfire +
  // Apophysis attribute conventions (e.g. `cpow2_r`, `loonie2_sides`).
  cpow2: ['r', 'a', 'divisor', 'range'],
  cpow3: ['r', 'd', 'divisor', 'spread'],
  loonie2: ['sides', 'star', 'circle'],
  epispiral: ['n', 'thickness', 'holes'],
  // #114 batch 2a — Worley/Voronoi cellular family.
  bwraps: ['cellsize', 'space', 'gain', 'inner_twist', 'outer_twist'],
  crackle: ['cellsize', 'power', 'distort', 'scale'],
  // #114 batch 2b-a — JWildfire S-tier first half. loonie3 + glynnia
  // are 0-param (no entries). Z-axis params dropped from falloff
  // family per pyr3's 2D-only engine; mul_c + invert dropped from
  // falloff/falloff2 to fit the 8-slot seam (kept on falloff3 since
  // its blur-type=0+shape=0 default-mode port is the most parameter-
  // light of the three).
  juliaq: ['power', 'divisor'],
  falloff: ['scatter', 'mindist', 'mul_x', 'mul_y', 'x0', 'y0'],
  falloff2: ['scatter', 'type', 'mul_x', 'mul_y', 'x0', 'y0', 'mindist'],
  falloff3: ['scatter', 'mul_x', 'mul_y', 'x0', 'y0', 'mindist', 'invert'],
  // #114 batch 2b-b — S-tier kaleidoscope/circle family. petal is
  // 0-param (no entry). loc was originally scoped here but dropped —
  // no varLoc.pas in Apophysis 7X core or JWildfire (see V table
  // comment in src/variations.ts).
  collideoscope: ['a', 'num'],
  circlize: ['hole'],
  circlize2: ['hole'],
  eswirl: ['in', 'out'],
  // #114 batch 2b-c — Xyrus02 mid-tier + hexes cellular. juni was
  // originally scoped here but dropped — it requires xform-affine
  // context (vp->a..f) + a Z-axis coordinate that pyr3's 2D-only
  // apply_variation seam doesn't expose. See V table comment in
  // src/variations.ts.
  bcircle: ['scale', 'borderwidth'],
  curl2: ['c1', 'c2', 'c3'],
  murl: ['c', 'power'],
  stwins: ['distort'],
  hexes: ['cellsize', 'power', 'rotate', 'scale'],
  // #114 batch 2b-d — Xyrus02 X-family + blur_circle. Final #114
  // batch. xtrb is at the 6-param tightness ceiling (would need 8 if
  // we tried to expose all canonical xtrb fields; pyr3 ships the
  // canonical 6 and uses precalc inside the kernel for the 18 derived
  // values). gridout is 0-param (no entry). xcurl2 has its own polynomial
  // shape DIFFERENT from V121 `curl2` despite the suffix — see the V
  // table comment in src/variations.ts. xhyperbol's 6 params encode
  // a 2x3 affine the iterate runs through inside the kernel.
  xheart: ['xheart_angle', 'xheart_ratio'],
  xhyperbol: ['m00', 'm01', 'm10', 'm11', 'm20', 'm21'],
  xcurl2: ['c1', 'c2', 'c3'],
  xtrb: ['xtrb_power', 'xtrb_dist', 'xtrb_radius', 'xtrb_width', 'xtrb_a', 'xtrb_b'],
  blur_circle: ['hole'],
  // #120 batch B1 — M-tier port flagship. bipolar2 = Brad Stefanov's
  // 9-param rework of base bipolar. JWildfire param names verbatim.
  bipolar2: ['shift', 'a', 'b', 'c', 'd', 'e', 'f1', 'g1', 'h'],
  // #120 batch B2 — bubble2 (2D projection of JWildfire 3D Bubble2Func).
  // JWildfire ships 3 params (x, y, z); pyr3 drops the z param/output
  // per the 2D-only convention (same precedent as the #114 falloff
  // family). Param names left unprefixed since JWildfire uses bare 'x'
  // / 'y' / 'z' — the import alias maps will still pick them up cleanly.
  bubble2: ['x', 'y'],
  // #120 batch B3 — inverse hyperbolic family (all 0-param).
  acosh: [],
  arcsinh: [],
  arctanh: [],
  acoth: [],
  acosech: [],
  arcsech2: [],
  // #120 batch B3.5 — cell2 6-param N/S asymmetric subset. Param names
  // are pyr3-specific (the JWildfire source uses 16 per-quadrant params
  // we don't ship here); the importer alias map handles JWildfire's
  // cell2_space_ya / cell2_space_xa convention by mapping the first
  // matching pair onto pyr3's space_north_y / space_north_x.
  cell2: ['size', 'a', 'space_north_x', 'space_north_y', 'space_south_x', 'space_south_y'],
  // #120 batch B4 — Xyrus02 + Lu-Kout remainders.
  curl_sp: ['pow', 'c1', 'c2', 'sx', 'sy'],                // dropped JWildfire's `dc` (color-output param)
  murl2: ['c', 'power'],
  lissajous: ['tmin', 'tmax', 'a', 'b', 'c', 'd', 'e'],
  spirograph: ['a', 'b', 'd', 'tmin', 'tmax', 'ymin', 'ymax', 'c1', 'c2'],
  waffle: ['slices', 'xthickness', 'ythickness', 'rotation'],
  // #120 batch B5 — Glynn-set family. phi1/phi2 are in DEGREES (JWildfire convention).
  glynnSim1: ['radius', 'radius1', 'phi1', 'thickness', 'pow', 'contrast'],
  glynnSim2: ['radius', 'thickness', 'contrast', 'pow', 'phi1', 'phi2'],
  glynnSim3: ['radius', 'thickness', 'contrast', 'pow'],
  // #120 batch B6 — Faber/Xyrus02/zephyrtronium novelties.
  flipy: [],                                             // 0 params
  eclipse: ['shift'],
  barycentroid: ['a', 'b', 'c', 'd'],
  chunk: ['a', 'b', 'c', 'd', 'e', 'f', 'mode'],
  // #121 L-tier batch L1 — JWildfire 2D long tail. ennepers + erf
  // are 0-param (no entries needed; absence means "no params").
  // JWildfire param names verbatim where applicable.
  circus: ['scale'],
  asteria: ['alpha'],
  clifford_js: ['a', 'b', 'c', 'd'],
  devil_warp: ['a', 'b', 'effect', 'warp', 'rmin', 'rmax'],
  voron: ['k', 'step', 'num', 'xseed', 'yseed'],
  // #121 L-tier batch L2 — chrysanthemum is 0-param (no entry needed).
  // henon is the 3-param TyrantWave map. atan has mode (int 0..2) +
  // stretch. cardioid has a single curve param. bcollide has num (int
  // 1+) and a (clamped [0,1]). bsplit has x/y shifts. bulge has N=power.
  henon: ['a', 'b', 'c'],
  atan: ['mode', 'stretch'],
  cardioid: ['a'],
  bcollide: ['num', 'a'],
  bsplit: ['x', 'y'],
  bulge: ['N'],
  // #121 L-tier batch L3 — circleblur is 0-param (no entry needed).
  // JWildfire param names verbatim except where pyr3 convention differs.
  checks: ['x', 'y', 'size', 'rnd'],
  circular: ['angle', 'seed'],
  circular2: ['angle', 'seed', 'xx', 'yy'],
  corners: ['x', 'y', 'mult_x', 'mult_y', 'x_power', 'y_power', 'xy_power_add', 'log_mode', 'log_base'],
  // #121 L-tier batch L4 — idisc is 0-param (no entry needed). p/q/n
  // are int params clamped at unpack (matches JWildfire's limitIntVal).
  fibonacci2: ['sc', 'sc2'],
  hypertile: ['p', 'q', 'n'],
  hypertile1: ['p', 'q'],
  hypertile2: ['p', 'q'],
  // #121 L-tier batch L5 — hole `inside` is int (0/1 toggle). line is
  // 2D projection of JWildfire's 3D base shape (drops z component).
  hole: ['a', 'inside'],
  kaleidoscope: ['pull', 'rotate', 'line_up', 'x', 'y'],
  layered_spiral: ['radius'],
  linear_t: ['powX', 'powY'],
  line: ['delta', 'phi'],
  // #121 L-tier batch L6 — unpolar is 0-param (no entry needed).
  // JWildfire param names verbatim.
  ovoid: ['x', 'y'],
  phoenix_julia: ['power', 'dist', 'x_distort', 'y_distort'],
  shredrad: ['n', 'width'],
  // #121 L-tier batch L7 — JWildfire param names verbatim.
  vogel: ['n', 'scale'],
  yin_yang: ['radius', 'ang1', 'ang2', 'dual_t', 'outside'],
  squish: ['power'],
  target: ['even', 'odd', 'size'],
  // #121 L-tier batch L8 — holesq is 0-param (no entry needed). lace_js
  // is also 0-param (RNG-only). hole2 inside + shape are int toggles.
  funnel: ['effect'],
  hole2: ['a', 'b', 'c', 'd', 'inside', 'shape'],
  julia_outside: ['re_div', 'im_div', 'mode'],
  fourth: ['spin', 'space', 'twist', 'x', 'y'],
  // #121 L-tier batch L9 — rays1/rays2/rays3 are 0-param (no entry).
  pulse: ['freqx', 'freqy', 'scalex', 'scaley'],
  // #121 L-tier batch L10 — tancos + twoface are 0-param (no entry).
  e_julia: ['power'],
  // #121 L-tier batch L11. butterfly already shipped V67 — skipped.
  cannabis_curve_wf: ['filled'],
  e_collide: ['num', 'a'],
  e_mod: ['radius', 'distance'],
  // #121 L-tier batch L12. inv_squircular is 0-param.
  intersection: ['xwidth', 'xtilesize', 'xmod1', 'xmod2', 'xheight', 'yheight', 'ytilesize', 'ymod1', 'ymod2', 'ywidth'],
  // #121 L-tier batch L13. JWildfire param names verbatim.
  lozi: ['a', 'b', 'c'],
  hypershift: ['shift', 'stretch'],
  hex_modulus: ['size'],
  // #121 L-tier batch L14 (final). JWildfire param names verbatim.
  boarders2: ['c', 'left', 'right'],
  b_mod: ['radius', 'distance'],
  b_transform: ['rotate', 'power', 'move', 'split'],
  parallel: ['x1width', 'x1tilesize', 'x1mod1', 'x1mod2', 'x1height', 'x1move', 'x2width', 'x2tilesize', 'x2mod1', 'x2mod2'],  // 10 params (drops x2height, x2move to fit seam)
  // #133 — Conformal & complex-analytic warps (V220+). Original (not in
  // JWildfire) variations. Pyr3-specific param names since JWildfire has
  // no reference.
  newton: ['n'],
  blaschke: ['a_re', 'a_im'],
  cayley: ['s'],
  complex_gamma: ['scale'],
  lambert_w: ['iters'],
  standard_map: ['k'],
  de_jong: ['a', 'b', 'c', 'd'],
  ikeda: ['u'],
  box_fold: ['limit'],
  sphere_fold: ['rmin', 'rmax'],
  mandelbox_step: ['scale', 'rmin', 'rmax', 'cx', 'cy'],
  kifs_fold: ['n', 'offset'],
  logistic_map: ['r'],
  superellipse: ['a', 'b', 'n'],
  limacon: ['a', 'b'],
  epicycloid: ['k'],
  catenary: ['a'],
  tractrix: [],
};

// v0.13 — per-variation default values for params that a .flame may omit.
// Canonical match against flam3-C `initialize_xforms()` (variations.c).
// Each list MUST be the same length + order as VARIATION_PARAMS[arm].
// Missing entries → all-0 fallback at the call site (legacy pre-v0.13 behavior;
// only correct for arms whose canonical default is genuinely zero, which is
// most of the 38 parameterized arms).
//
// Surfaced by the A.2 audit (2026-05-27 default-value parity sweep). 17 of
// 38 parameterized arms had non-zero canonical defaults that pyr3 was
// silently zeroing, producing degenerate renders for .flame files that
// elided those attrs (e.g. `julian="0.5"` with no `julian_power` → power=0
// in pyr3 vs power=1 in flam3-C / the predecessor).
export const VARIATION_DEFAULTS: Record<string, readonly number[]> = {
  curl: [1, 0],                              // c1=1, c2=0
  julian: [1, 1],                            // power=1, dist=1
  rectangles: [1, 1],                        // x=1, y=1
  juliascope: [1, 1],                        // power=1, dist=1
  blob: [0, 1, 1],                           // low, high=1, waves=1
  pie: [6, 0, 0.5],                          // slices=6, rotation, thickness=0.5
  ngon: [5, 3, 1, 2],                        // sides=5, power=3, circle=1, corners=2
  conic: [1, 0],                             // eccentricity=1, holes
  // pyr3 slot order: [frequency, amplitude, damping, separation]
  // — NOT flam3-C's parser attr ordering (separation-first).
  oscilloscope: [Math.PI, 1, 0, 1],          // frequency=π, amplitude=1, damping, separation=1
  curve: [0, 0, 1, 1],                       // xamp, yamp, xlength=1, ylength=1
  cell: [1],                                 // size=1
  // pyr3 slot order: [freq, weight, scale, sym]
  auger: [1, 0.5, 1, 0],                     // freq=1, weight=0.5, scale=1, sym
  super_shape: [0, 0, 1, 1, 1, 0],           // rnd, m, n1=1, n2=1, n3=1, holes
  bent2: [1, 1],                             // x=1, y=1
  wedge: [0, 0, 1, 0],                       // angle, hole, count=1, swirl
  wedge_julia: [0, 1, 1, 0],                 // angle, count=1, power=1, dist
  wedge_sph: [0, 0, 1, 0],                   // angle, hole, count=1, swirl
  cpow: [1, 0, 1],                           // r=1, i, power=1
  // #114 batch 1 — JWildfire-canonical defaults.
  cpow2: [1, 0, 1, 1],                       // r=1, a, divisor=1, range=1
  cpow3: [1, 1, 1, 1],                       // r=1, d=1, divisor=1, spread=1
  loonie2: [4, 0.15, 0.25],                  // sides=4, star=0.15, circle=0.25
  epispiral: [6, 0, 1],                      // n=6, thickness, holes=1
  // #114 batch 2a — JWildfire-canonical defaults.
  bwraps: [1, 0, 1, 0, 0],                   // cellsize=1, space, gain=1, inner_twist, outer_twist
  crackle: [1, 0.2, 1, 1],                   // cellsize=1, power=0.2, distort=1, scale=1
  // #114 batch 2b-a — JWildfire-canonical defaults. juliaq's JWF
  // default is a random power 2..7; pyr3 picks power=3/divisor=2 as
  // a visually-active centered default (matches the canonical julia2
  // showcase shape). The falloff trio's JWF UI defaults match here
  // 1:1 (scatter=1, mindist=0.5, mul_*=1, x0=y0=0). For falloff2 the
  // type=0 default reproduces the simplest (and most-rendered) of the
  // three branches; users discover types 1/2 via the catalog slider.
  juliaq: [3, 2],                            // power=3, divisor=2
  falloff: [1, 0.5, 1, 1, 0, 0],             // scatter=1, mindist=0.5, mul_x=1, mul_y=1, x0, y0
  falloff2: [1, 0, 1, 1, 0, 0, 0.5],         // scatter=1, type=0, mul_x=1, mul_y=1, x0, y0, mindist=0.5
  falloff3: [1, 1, 1, 0, 0, 0.5, 0],         // scatter=1, mul_x=1, mul_y=1, x0, y0, mindist=0.5, invert
  // #114 batch 2b-b — JWildfire-canonical defaults. circlize/circlize2
  // ship JWF's UI defaults (hole=0.40 / 0.0 respectively); collideoscope
  // ships JWF's class-level defaults a=0.20, num=1 (JWF's randomize()
  // picks num∈[1,10] at random — pyr3 picks the deterministic lower
  // bound for the visually-active centered scaffold). eswirl ships
  // JWF's class defaults in=1.2, out=0.2.
  collideoscope: [0.20, 1],                  // a=0.20, num=1
  circlize: [0.40],                          // hole=0.40
  circlize2: [0.0],                          // hole=0.0
  eswirl: [1.2, 0.2],                        // in=1.2, out=0.2
  // #114 batch 2b-c — Xyrus02-canonical defaults. bcircle ships
  // borderwidth=0 (deterministic disk path; the RNG random-circle path
  // activates when the user dials borderwidth up). curl2 ships
  // c1=1, c2=c3=0 (= flam3's `curl` shape — additive growth from
  // c2/c3 is discoverable). murl ships c=0.1, power=1 — matches
  // JWildfire's class-level defaults more nicely than the Xyrus02
  // source's c=0 (no warp) / power=2 baseline; gives a visually
  // active scaffold without a degenerate division. stwins ships
  // distort=1 (Xyrus02 default). hexes ships the JWF class defaults
  // cellsize=1, power=1, rotate=0.166, scale=1.
  bcircle: [1.0, 0.0],                       // scale=1, borderwidth=0
  curl2: [1.0, 0.0, 0.0],                    // c1=1, c2, c3
  circlecrop: [0.55, 0.0, 0.0, 0.0, 0.0],    // radius, x, y, scatter_area, zero
  murl: [0.1, 1],                            // c=0.1, power=1
  stwins: [1.0],                             // distort=1
  hexes: [1.0, 1.0, 0.166, 1.0],             // cellsize=1, power=1, rotate=0.166, scale=1
  // #114 batch 2b-d — Xyrus02-canonical defaults. xheart ships
  // angle=ratio=0 (Xyrus02 baseline: rotation = π/4, ratio multiplier =
  // 6). xhyperbol ships the identity affine (m00=m11=1, others=0; the
  // Xyrus02 default). xcurl2 ships c1=c2=c3=0 — that's the source's
  // VAR_REAL default, but at all zeros the (re,im)=(1,0) so the
  // variation reduces to linear (no warp); the catalog scaffold
  // overrides to c1=1 to make the first slider drag visually active.
  // xtrb ships xtrb_power=2 (source default; also the simplest tessellation)
  // + xtrb_dist=1, xtrb_radius=1, xtrb_width=0.5, xtrb_a=xtrb_b=1
  // (Xyrus02 source defaults). blur_circle ships hole=0 (Xyrus02
  // source default; the disc shape is most visible there).
  xheart: [0.0, 0.0],                                // angle, ratio
  xhyperbol: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],         // m00=1, m01, m10, m11=1, m20, m21
  xcurl2: [0.0, 0.0, 0.0],                           // c1, c2, c3
  xtrb: [2, 1.0, 1.0, 0.5, 1.0, 1.0],                // power=2, dist=1, radius=1, width=0.5, a=1, b=1
  blur_circle: [0.0],                                // hole
  // #120 batch B1 — bipolar2 defaults from JWildfire Bipolar2Func.java.
  // Mirrors the base bipolar (V35) when shift=0; the rest of the params
  // are the source's named defaults.
  bipolar2: [0.0, 1.0, 2.0, 0.5, 1.0, 2.0, 0.25, 1.0, 1.0], // shift,a,b,c,d,e,f1,g1,h
  // #120 batch B2 — bubble2. JWildfire defaults x=1, y=1 → at these
  // values bubble2 matches var_bubble (V20) exactly. Visual interest
  // starts when x ≠ y (anisotropic bubble).
  bubble2: [1.0, 1.0],                                     // x, y
  // #120 batch B3 — inverse hyperbolic family (all 0-param).
  acosh: [],
  arcsinh: [],
  arctanh: [],
  acoth: [],
  acosech: [],
  arcsech2: [],
  // #120 batch B3.5 — cell2 defaults from JWildfire (size=0.60, a=1, all
  // space_* = 2). At these defaults pyr3's N/S asymmetric subset gives
  // a symmetric output (north/south scales are equal); varying any of
  // the four space_* sliders independently introduces the asymmetry.
  // cell2 default RETUNED for catalog visibility — JWildfire's (size=0.6,
  // all space_*=2) pushed the output past the catalog camera. (size=0.3,
  // all space_*=1) reduces to a clean y-mirrored cellular tile that
  // stays in view; the user can pull either N/S space pair up to expose
  // the per-hemisphere asymmetry.
  cell2: [0.3, 1.0, 1.0, 1.0, 1.0, 1.0],                  // size, a, space_north_x, space_north_y, space_south_x, space_south_y
  // #120 batch B4 — JWildfire-faithful defaults.
  curl_sp: [1.0, -0.01, 0.03, 0.0, 0.0],                  // pow, c1, c2, sx, sy
  murl2: [0.1, 3.0],                                       // c, power
  lissajous: [-Math.PI, Math.PI, 3.0, 2.0, 0.0, 0.0, 0.0], // tmin, tmax, a, b, c, d, e
  // spirograph default RETUNED — at a=3, b=2, c1=c2=0 the curve traces
  // a circle of radius (a+b)=5, which is far off the catalog camera.
  // Picking smaller a/b + non-zero c1/c2 makes the actual hypotrochoid
  // shape visible at the default camera scale.
  spirograph: [0.5, 0.3, 0.0, -Math.PI, Math.PI, 0.0, 0.0, 0.5, 0.5], // a, b, d, tmin, tmax, ymin, ymax, c1, c2
  waffle: [6.0, 0.5, 0.5, 0.0],                            // slices, xthickness, ythickness, rotation
  // #120 batch B5 — Glynn-set defaults from JWildfire.
  // Glynn-set defaults — user-tuned for the catalog's sierpinski
  // scaffold (replaces JWildfire's defaults which were tuned for a
  // wider input distribution). The exact values come from manual
  // exploration of the live catalog at the post-`a32a655` ship.
  glynnSim1: [0.45, 0.43, 110.0, 0.25, 1.5, 0.5],         // radius, radius1, phi1°, thickness, pow, contrast
  glynnSim2: [0.25, 0.1, 0.5, 1.5, 110.0, 150.0],         // radius (was 1.0), thickness, contrast, pow, phi1°, phi2°
  // glynnSim3 default RETUNED — at JWildfire's radius=1, thickness=0.1
  // (radius1=1.1), all sierpinski walkers fall INSIDE radius1, so the
  // outside branch never fires and contrast/pow have no visible
  // effect (user observation, this session). radius=0.5, thickness=0.2
  // gives radius1=0.7 — sierpinski corners at distance 1.0 fall
  // outside, exposing the contrast/pow gate.
  glynnSim3: [0.5, 0.2, 0.5, 1.3],                         // radius, thickness, contrast, pow
  // #120 batch B6 — JWildfire defaults.
  flipy: [],                                              // 0 params
  eclipse: [0.25],                                        // shift (user-tuned default — pure 0 is degenerate, 0.25 exposes the fold)
  barycentroid: [1.0, 0.0, 0.0, 1.0],                    // a, b, c, d — identity basis (output → ±|p|)
  // chunk default RETUNED — user-picked (e=0.35, f=-0.65) shifts the
  // gate's center off-origin, producing a visually striking sierpinski-
  // clustered pattern rather than the boring full unit disc.
  chunk: [1.0, 0.0, 1.0, 0.0, 0.35, -0.65, 0],           // a, b, c, d, e, f, mode
  // #121 L-tier batch L1 — JWildfire 2D long tail. Defaults match
  // JWildfire's per-variation init values (asteria/clifford_js/
  // devil_warp/voron carry meaningful non-zero defaults). circus
  // default 0.92 = JWildfire default. ennepers + erf are 0-param
  // (no entries needed). voron `num`/`xseed`/`yseed` are int — clamped
  // at unpack inside the WGSL kernel.
  circus: [0.92],                                        // scale=0.92
  asteria: [0.0],                                        // alpha=0 (JWildfire default; catalog default RETUNES to 0.1)
  clifford_js: [-1.4, 1.6, 1.0, 0.7],                    // a, b, c, d — JWildfire defaults (classic Clifford attractor)
  devil_warp: [2.0, 1.0, 1.0, 0.5, -0.24, 100.0],        // a, b, effect, warp, rmin, rmax — JWildfire defaults
  voron: [0.99, 0.25, 1, 3, 7],                          // k, step=0.25, num=1, xseed=3, yseed=7 — JWildfire defaults (catalog default RETUNES step→0.5)
  // #121 L-tier batch L2 — defaults match JWildfire init values.
  henon: [0.5, 1.0, 1.0],                                // a=0.5, b=1, c=1 — TyrantWave defaults
  atan: [0, 1.0],                                        // mode=0 (atan on y only), stretch=1
  cardioid: [1.0],                                       // a=1 — Faber default
  bcollide: [1, 0.0],                                    // num=1, a=0 — Faber defaults (catalog RETUNES num for visibility)
  bsplit: [0.0, 0.0],                                    // x=0, y=0 — Raykoid666 defaults (catalog RETUNES for visibility)
  bulge: [2.0],                                          // N=2 — quadratic radial bulge
  // #121 L-tier batch L3 — JWildfire init values verbatim.
  checks: [3.0, 3.0, 1.0, 0.5],                          // x, y, size, rnd
  circular: [90.0, 0.0],                                 // angle (deg), seed
  circular2: [90.0, 0.0, 12.9898, 78.233],               // angle, seed, xx, yy
  corners: [1.0, 1.0, 1.0, 1.0, 0.75, 0.75, 0, 0, 2.71828],  // x, y, mult_x/y, x/y_power, xy_power_add, log_mode, log_base
  // #121 L-tier batch L4 — JWildfire init values verbatim.
  fibonacci2: [1.0, 1.0],                                // sc, sc2 — Larry Berlin defaults
  hypertile: [3, 7, 1],                                  // p, q, n — Zueuk defaults (canonical hyperbolic tiling)
  hypertile1: [3, 7],                                    // p, q
  hypertile2: [3, 7],                                    // p, q
  // #121 L-tier batch L5 — JWildfire init values verbatim. linear_t and
  // line use 2D-projection only (drop the JWildfire z component).
  hole: [1.0, 0],                                        // a=1, inside=0 — Faber default (outside formula)
  kaleidoscope: [0.0, 1.0, 1.0, 0.0, 0.0],               // pull, rotate, line_up, x, y — Will Evans defaults
  layered_spiral: [1.0],                                 // radius=1 — Will Evans default
  linear_t: [1.2, 0.9],                                  // powX, powY — FractalDesire defaults
  line: [0.0, 0.0],                                      // delta, phi — Nic Anderson defaults
  // #121 L-tier batch L6 — JWildfire init values verbatim.
  ovoid: [0.94, 0.94],                                   // x, y — Faber defaults
  phoenix_julia: [2.0, 1.0, -0.5, 0.0],                  // power, dist, x_distort, y_distort — TyrantWave defaults (power picked sensibly, JWildfire randomizes)
  shredrad: [4.0, 0.5],                                  // n=4, width=0.5 — Zy0rg defaults
  // #121 L-tier batch L7 — JWildfire init values; target uses sensible
  // picks since JWildfire randomizes (M_PI offsets + size).
  vogel: [20, 1.0],                                      // n=20, scale=1 — Ganora defaults
  yin_yang: [0.5, 0.0, 0.0, 1, 0],                       // radius, ang1, ang2, dual_t=1, outside=0 — dark-beam defaults
  squish: [2],                                           // power=2 — Faber default
  target: [0.5, 1.5, 0.5],                               // even, odd, size — sensible (JWildfire randomizes these)
  // #121 L-tier batch L8 — JWildfire init values verbatim.
  funnel: [8],                                           // effect=8 — Raykoid666 default
  hole2: [1.0, 2.0, 1.0, 1.0, 0, 0],                     // a, b, c, d, inside, shape=0 — Faber/Stefanov/Sidwell
  julia_outside: [1.0, 0.0, 0],                          // re_div=1, im_div=0, mode=0 — Whittaker Courtney default
  fourth: [Math.PI, 0.10, 0.20, 0.30, 0.12],             // spin, space, twist, x, y — guagapunyaimel defaults
  // #121 L-tier batch L9 — JWildfire init values verbatim.
  pulse: [2.0, 2.0, 1.0, 1.0],                           // freqx, freqy, scalex, scaley
  // #121 L-tier batch L10 — JWildfire init values verbatim.
  e_julia: [2],                                          // power=2 — Faber default
  // #121 L-tier batch L11 — JWildfire init values verbatim.
  cannabis_curve_wf: [0.85],                             // filled=0.85
  e_collide: [1, 0.0],                                   // num=1, a=0 — Faber defaults
  e_mod: [1.0, 0.0],                                     // radius=1, distance=0 — Faber defaults
  // #121 L-tier batch L12 — JWildfire init values verbatim.
  intersection: [5.0, 0.50, 0.30, 1.0, 0.50, 5.0, 0.50, 0.30, 1.0, 0.50],
  // #121 L-tier batch L13 — JWildfire init values verbatim.
  lozi: [0.5, 1.0, 1.0],
  hypershift: [2.0, 1.0],
  hex_modulus: [1.0],
  // #121 L-tier batch L14 (final) — JWildfire init values verbatim
  // (parallel drops x2height/x2move to fit 10-param seam — hardcoded
  // to JWildfire defaults 0.50/1.0 inside the WGSL kernel).
  boarders2: [0.4, 0.65, 0.35],
  b_mod: [1.0, 0.0],
  b_transform: [0.0, 1, 0.0, 0.0],
  parallel: [5.0, 0.50, 0.30, 1.0, 0.50, 1.0, 5.0, 0.50, 0.30, 1.0],
  // #133 — Conformal & complex-analytic warps (V220+). Original (not in
  // JWildfire); pyr3-chosen defaults match the catalog scaffold conventions.
  newton: [3],                               // n=3 (classical tri-basin)
  blaschke: [-0.75, -0.90],                  // a near boundary → 2-to-1 ferning pattern
  cayley: [0.8],                             // s=0.8 — wider mapped strip near real axis
  complex_gamma: [0.4],                      // scale=0.4 — Γ growth tamed but still visible
  lambert_w: [2],                            // 2 Halley iterations (~10-digit precision)
  standard_map: [0.5],                       // k (stochasticity)
  de_jong: [-2.24, 0.43, -0.65, -2.43],      // Peter de Jong classic
  ikeda: [1.4],                              // u parameter
  box_fold: [0.4],                           // reflection limit
  sphere_fold: [0.5, 1.0],                   // rmin, rmax
  mandelbox_step: [2.0, 0.5, 1.0, 0.0, 0.0], // scale, rmin, rmax, cx, cy
  kifs_fold: [3.0, 0.0],                     // n mirrors, offset
  logistic_map: [3.9],                       // r parameter (chaotic band)
  superellipse: [1.0, 1.0, 2.0],
  limacon: [1.0, 0.5],
  epicycloid: [3.0],
  catenary: [1.0],
  tractrix: [],
};

/** Positional param slot keys on `Variation`. Index `i` ↔ `param${i}`.
 *  Used by serialize / importer to map between the positional in-memory
 *  shape and the named-params on-disk shape. Max 10 slots — see `Variation`
 *  in src/variations.ts. Seam history: 2 → 6 (Phase 9b, multi-param flam3
 *  classics) → 8 (Phase 9b Batch K, mobius=8 params) → 10 (#120, bipolar2=9
 *  params + M-tier port; free wire-up of pre-reserved vars_extra2.zw). */
export const PARAM_KEYS = [
  'param0',
  'param1',
  'param2',
  'param3',
  'param4',
  'param5',
  // Phase 9b Batch K (2026-05-12): seam extended 6 → 8 for mobius (8 params).
  'param6',
  'param7',
  // #120 (2026-06-06): seam extended 8 → 10 for bipolar2 (9 params) + M-tier.
  'param8',
  'param9',
] as const;
export type ParamKey = (typeof PARAM_KEYS)[number];
export const MAX_VARIATION_PARAMS = PARAM_KEYS.length;

export function genomeToJson(g: Genome): Pyr3JsonV1 {
  const palette: Pyr3JsonV1['palette'] = {
    name: g.palette.name,
    stops: g.palette.stops.map((s) => ({ t: s.t, r: s.r, g: s.g, b: s.b })),
  };
  if (g.palette.hue !== undefined) palette.hue = g.palette.hue;
  if (g.palette.mode !== undefined) palette.mode = g.palette.mode;

  const out: Pyr3JsonV1 = {
    version: PYR3_JSON_VERSION,
    name: g.name,
    viewport: { scale: g.scale, cx: g.cx, cy: g.cy },
    palette,
    xforms: g.xforms.map(xformToJson),
  };
  if (g.finalxform) {
    const xj = xformToJson(g.finalxform);
    // Strip weight — meaningless on finalxform.
    const { weight: _ignored, ...rest } = xj;
    out.finalxform = rest;
  }
  if (g.symmetry) {
    out.symmetry = { kind: g.symmetry.kind, n: g.symmetry.n };
  }
  if (g.density) {
    out.density = {
      maxRad: g.density.maxRad,
      minRad: g.density.minRad,
      curve: g.density.curve,
    };
  }
  if (g.tonemap) {
    out.tonemap = {
      gamma: g.tonemap.gamma,
      vibrancy: g.tonemap.vibrancy,
      highlightPower: g.tonemap.highlightPower,
      brightness: g.tonemap.brightness,
      gammaThreshold: g.tonemap.gammaThreshold,
    };
  }
  if (g.rotate !== undefined && g.rotate !== 0) {
    out.rotate = g.rotate;
  }
  if (g.quality !== undefined) {
    out.quality = g.quality;
  }
  if (g.oversample !== undefined && g.oversample > 1) {
    out.oversample = g.oversample;
  }
  if (g.size) {
    out.size = { width: g.size.width, height: g.size.height };
  }
  if (g.spatialFilter) {
    out.spatialFilter = { radius: g.spatialFilter.radius, shape: g.spatialFilter.shape };
  }
  if (g.background) {
    out.background = [g.background[0], g.background[1], g.background[2]];
  }
  if (g.paletteMode !== undefined) {
    out.paletteMode = g.paletteMode;
  }
  // Issue #116 — omit channelCurves when all 5 channels are identity. The
  // shader branches off when activeMask returns 0; omitting from JSON keeps
  // saved files compact and preserves the "untouched" semantics.
  if (g.channelCurves && channelCurvesActive(g.channelCurves)) {
    out.channelCurves = cloneChannelCurves(g.channelCurves);
  }
  // Issue #172 — omit hslAdjust when identity (0, 100, 0).
  if (g.hslAdjust && (g.hslAdjust.hue !== 0 || g.hslAdjust.sat !== 100 || g.hslAdjust.light !== 0)) {
    out.hslAdjust = { hue: g.hslAdjust.hue, sat: g.hslAdjust.sat, light: g.hslAdjust.light };
  }
  return out;
}

function channelCurvesActive(c: ChannelCurves): boolean {
  for (const ch of ['composite', 'r', 'g', 'b', 'luma'] as const) {
    const pts = c[ch];
    if (pts.length !== 2) return true;
    if (pts[0]!.x !== 0 || pts[0]!.y !== 0) return true;
    if (pts[1]!.x !== 1 || pts[1]!.y !== 1) return true;
  }
  return false;
}

function cloneChannelCurves(c: ChannelCurves): ChannelCurves {
  return {
    composite: c.composite.map((p) => ({ x: p.x, y: p.y })),
    r:         c.r.map((p) => ({ x: p.x, y: p.y })),
    g:         c.g.map((p) => ({ x: p.x, y: p.y })),
    b:         c.b.map((p) => ({ x: p.x, y: p.y })),
    luma:      c.luma.map((p) => ({ x: p.x, y: p.y })),
  };
}

function xformToJson(x: Xform): Pyr3JsonXform {
  const out: Pyr3JsonXform = {
    weight: x.weight,
    color: x.color,
    colorSpeed: x.colorSpeed,
    affine: { a: x.a, b: x.b, c: x.c, d: x.d, e: x.e, f: x.f },
    variations: x.variations.map(variationToJson),
  };
  if (x.opacity !== undefined && x.opacity !== 1.0) out.opacity = x.opacity;
  if (x.xaos !== undefined) out.xaos = [...x.xaos];
  if (x.post && !isIdentityPost(x.post)) {
    // Phase 9c: omit identity post from JSON for symmetry with the importer
    // (which drops identity post → undefined) and the rotate=0 / oversample=1
    // patterns. A hand-authored .pyr3.json with explicit identity post still
    // loads + renders correctly (no-op at the WGSL multiply); JSON output
    // collapses for canonical form.
    out.post = { a: x.post.a, b: x.post.b, c: x.post.c, d: x.post.d, e: x.post.e, f: x.post.f };
  }
  if (x.active === false) out.active = false;
  return out;
}

function isIdentityPost(p: NonNullable<Xform['post']>): boolean {
  return p.a === 1 && p.b === 0 && p.c === 0 && p.d === 0 && p.e === 1 && p.f === 0;
}

function variationToJson(v: Variation): Pyr3JsonVariation {
  const name = VARIATION_NAMES[v.index];
  if (name === undefined) {
    throw new Error(`pyr3: variationToJson encountered unknown index ${v.index}`);
  }
  const paramNames = VARIATION_PARAMS[name];
  const out: Pyr3JsonVariation = { name, weight: v.weight };
  if (paramNames !== undefined && paramNames.length > 0) {
    const params: Record<string, number> = {};
    const n = Math.min(paramNames.length, MAX_VARIATION_PARAMS);
    for (let i = 0; i < n; i++) {
      const pn = paramNames[i];
      const pk = PARAM_KEYS[i];
      if (pn === undefined || pk === undefined) continue;
      params[pn] = v[pk] ?? 0;
    }
    out.params = params;
  }
  if (v.active === false) out.active = false;
  return out;
}

/** Parse and validate a `.pyr3.json` payload. Throws on any structural or
 *  semantic violation; the message names the offending field for diagnosis. */
export function genomeFromJson(j: unknown): Genome {
  const root = expectObject(j, 'root');
  const version = root['version'];
  if (version !== PYR3_JSON_VERSION) {
    throw new Error(
      `pyr3: unsupported .pyr3.json version: ${String(version)} (expected ${PYR3_JSON_VERSION})`,
    );
  }
  const name = expectString(root['name'], 'name');
  const viewport = expectObject(root['viewport'], 'viewport');
  const scale = expectNumber(viewport['scale'], 'viewport.scale');
  const cx = expectNumber(viewport['cx'], 'viewport.cx');
  const cy = expectNumber(viewport['cy'], 'viewport.cy');

  const paletteObj = expectObject(root['palette'], 'palette');
  const paletteName = expectString(paletteObj['name'], 'palette.name');
  const stopsRaw = expectArray(paletteObj['stops'], 'palette.stops');
  const stops: ColorStop[] = stopsRaw.map((s, i) => {
    const so = expectObject(s, `palette.stops[${i}]`);
    return {
      t: expectNumber(so['t'], `palette.stops[${i}].t`),
      r: expectNumber(so['r'], `palette.stops[${i}].r`),
      g: expectNumber(so['g'], `palette.stops[${i}].g`),
      b: expectNumber(so['b'], `palette.stops[${i}].b`),
    };
  });
  const palette: Genome['palette'] = { name: paletteName, stops };
  if (paletteObj['hue'] !== undefined) {
    palette.hue = expectNumber(paletteObj['hue'], 'palette.hue');
  }
  if (paletteObj['mode'] !== undefined) {
    const mode = paletteObj['mode'];
    if (mode !== 'linear' && mode !== 'step') {
      throw new Error(
        `pyr3: palette.mode must be 'linear' or 'step', got: ${String(mode)}`,
      );
    }
    palette.mode = mode;
  }

  const xformsRaw = expectArray(root['xforms'], 'xforms');
  // PYR3-065: reject zero-xform genomes to match the XML loader. The chaos
  // game picks transforms from the host-built `xform_distrib` table; with no
  // regular xforms that table is degenerate and nothing is ever deposited (a
  // finalxform-only genome is unrenderable). The XML path already throws here;
  // genomeFromJson previously accepted it, producing a blank render.
  if (xformsRaw.length === 0) {
    throw new Error('pyr3: xforms must contain at least one xform; cannot render');
  }
  const xforms: Xform[] = xformsRaw.map((x, i) => xformFromJson(x, `xforms[${i}]`));

  let finalxform: Xform | undefined;
  if (root['finalxform'] !== undefined) {
    finalxform = finalxformFromJson(root['finalxform'], 'finalxform');
  }

  let symmetry: Symmetry | undefined;
  if (root['symmetry'] !== undefined) {
    const s = expectObject(root['symmetry'], 'symmetry');
    const kind = expectString(s['kind'], 'symmetry.kind');
    if (kind !== 'rotational' && kind !== 'dihedral') {
      throw new Error(
        `pyr3: symmetry.kind must be 'rotational' or 'dihedral', got: ${kind}`,
      );
    }
    const n = expectNumber(s['n'], 'symmetry.n');
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(
        `pyr3: symmetry.n must be a positive integer, got: ${n}`,
      );
    }
    symmetry = { kind, n };
  }

  let density: Density | undefined;
  if (root['density'] !== undefined) {
    const d = expectObject(root['density'], 'density');
    const maxRad = expectNumber(d['maxRad'], 'density.maxRad');
    const minRad = expectNumber(d['minRad'], 'density.minRad');
    const curve = expectNumber(d['curve'], 'density.curve');
    if (maxRad < 0 || maxRad > MAX_RAD_CAP) {
      throw new Error(
        `pyr3: density.maxRad must be in [0, ${MAX_RAD_CAP}], got: ${maxRad}`,
      );
    }
    if (minRad < 0 || minRad > maxRad) {
      throw new Error(
        `pyr3: density.minRad must be in [0, density.maxRad], got: ${minRad} (max=${maxRad})`,
      );
    }
    if (curve < MIN_CURVE || curve > MAX_CURVE) {
      throw new Error(
        `pyr3: density.curve must be in [${MIN_CURVE}, ${MAX_CURVE}], got: ${curve}`,
      );
    }
    density = { maxRad, minRad, curve };
  }

  let tonemap: Tonemap | undefined;
  if (root['tonemap'] !== undefined) {
    const t = expectObject(root['tonemap'], 'tonemap');
    const partial: Partial<Tonemap> = {};
    if (t['gamma'] !== undefined) partial.gamma = expectNumber(t['gamma'], 'tonemap.gamma');
    if (t['vibrancy'] !== undefined) partial.vibrancy = expectNumber(t['vibrancy'], 'tonemap.vibrancy');
    if (t['highlightPower'] !== undefined) partial.highlightPower = expectNumber(t['highlightPower'], 'tonemap.highlightPower');
    if (t['brightness'] !== undefined) partial.brightness = expectNumber(t['brightness'], 'tonemap.brightness');
    if (t['gammaThreshold'] !== undefined) partial.gammaThreshold = expectNumber(t['gammaThreshold'], 'tonemap.gammaThreshold');
    tonemap = { ...DEFAULT_TONEMAP, ...partial };
  }

  const base: Genome = { name, scale, cx, cy, palette, xforms };
  if (finalxform) base.finalxform = finalxform;
  if (symmetry) base.symmetry = symmetry;
  if (density) base.density = density;
  if (tonemap) base.tonemap = tonemap;
  if (root['rotate'] !== undefined) {
    const r = expectNumber(root['rotate'], 'rotate');
    if (!Number.isFinite(r)) {
      throw new Error(`pyr3: rotate must be a finite number, got: ${r}`);
    }
    if (r !== 0) base.rotate = r;
  }
  if (root['quality'] !== undefined) {
    const q = expectNumber(root['quality'], 'quality');
    if (!Number.isFinite(q) || q <= 0) {
      throw new Error(`pyr3: quality must be a positive finite number, got: ${q}`);
    }
    base.quality = q;
  }
  if (root['oversample'] !== undefined) {
    const s = expectNumber(root['oversample'], 'oversample');
    if (!Number.isInteger(s) || s < 1) {
      throw new Error(`pyr3: oversample must be a positive integer, got: ${s}`);
    }
    if (s > 1) base.oversample = s;
  }
  if (root['size'] !== undefined) {
    const s = expectObject(root['size'], 'size');
    const width = expectNumber(s['width'], 'size.width');
    const height = expectNumber(s['height'], 'size.height');
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new Error(`pyr3: size must be positive integers, got: ${width}×${height}`);
    }
    base.size = { width, height };
  }
  if (root['spatialFilter'] !== undefined) {
    const sf = expectObject(root['spatialFilter'], 'spatialFilter');
    const radius = expectNumber(sf['radius'], 'spatialFilter.radius');
    if (!Number.isFinite(radius) || radius <= 0) {
      throw new Error(`pyr3: spatialFilter.radius must be a positive finite number, got: ${radius}`);
    }
    const shape = expectString(sf['shape'], 'spatialFilter.shape');
    if (!isSpatialFilterShape(shape)) {
      throw new Error(`pyr3: unsupported spatialFilter.shape: ${shape}`);
    }
    base.spatialFilter = { radius, shape };
  }
  if (root['background'] !== undefined) {
    const bg = expectArray(root['background'], 'background');
    if (bg.length !== 3) {
      throw new Error(`pyr3: background must be a 3-element array, got length ${bg.length}`);
    }
    const r = expectNumber(bg[0], 'background[0]');
    const g0 = expectNumber(bg[1], 'background[1]');
    const b = expectNumber(bg[2], 'background[2]');
    base.background = [r, g0, b];
  }
  if (root['paletteMode'] !== undefined) {
    const pm = root['paletteMode'];
    if (pm !== 'step' && pm !== 'linear') {
      throw new Error(`pyr3: paletteMode must be 'step' or 'linear', got: ${String(pm)}`);
    }
    base.paletteMode = pm;
  }
  if (root['channelCurves'] !== undefined) {
    base.channelCurves = parseChannelCurves(root['channelCurves'], 'channelCurves');
  }
  if (root['hslAdjust'] !== undefined) {
    const obj = expectObject(root['hslAdjust'], 'hslAdjust');
    base.hslAdjust = {
      hue: Number(obj['hue']) || 0,
      sat: obj['sat'] !== undefined ? Number(obj['sat']) : 100,
      light: Number(obj['light']) || 0,
    };
  }
  return base;
}

function parseChannelCurves(j: unknown, path: string): ChannelCurves {
  const o = expectObject(j, path);
  const channels = ['composite', 'r', 'g', 'b', 'luma'] as const;
  const result = {} as ChannelCurves;
  for (const ch of channels) {
    const arr = expectArray(o[ch], `${path}.${ch}`);
    if (arr.length < 2 || arr.length > 8) {
      throw new Error(`pyr3: ${path}.${ch} must have 2..8 points, got ${arr.length}`);
    }
    const pts = arr.map((p, i) => {
      const pt = expectObject(p, `${path}.${ch}[${i}]`);
      const x = expectNumber(pt['x'], `${path}.${ch}[${i}].x`);
      const y = expectNumber(pt['y'], `${path}.${ch}[${i}].y`);
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        throw new Error(`pyr3: ${path}.${ch}[${i}] out of [0,1]: x=${x} y=${y}`);
      }
      return { x, y };
    });
    for (let i = 1; i < pts.length; i++) {
      if (pts[i]!.x <= pts[i - 1]!.x) {
        throw new Error(`pyr3: ${path}.${ch}[${i}].x not strictly monotonic`);
      }
    }
    result[ch] = pts;
  }
  return result;
}

// #86 — single canonical parse path for both xform and finalxform.
// PYR3-060 root cause: when these two parsers were maintained separately,
// finalxform silently dropped `opacity` on .pyr3.json re-import — exactly
// the bug-class an `isFinal` flag prevents by construction. Only two fields
// differ: finalxforms have no `weight` (pinned to 0) and no `xaos`.
function parseXformBody(j: unknown, path: string, isFinal: boolean): Xform {
  const o = expectObject(j, path);
  const weight = isFinal ? 0 : expectNumber(o['weight'], `${path}.weight`);
  const color = expectNumber(o['color'], `${path}.color`);
  const colorSpeed = expectNumber(o['colorSpeed'], `${path}.colorSpeed`);
  const aff = expectObject(o['affine'], `${path}.affine`);
  const a = expectNumber(aff['a'], `${path}.affine.a`);
  const b = expectNumber(aff['b'], `${path}.affine.b`);
  const c = expectNumber(aff['c'], `${path}.affine.c`);
  const d = expectNumber(aff['d'], `${path}.affine.d`);
  const e = expectNumber(aff['e'], `${path}.affine.e`);
  const f = expectNumber(aff['f'], `${path}.affine.f`);
  const varsRaw = expectArray(o['variations'], `${path}.variations`);
  const variations: Variation[] = varsRaw.map((v, i) =>
    variationFromJson(v, `${path}.variations[${i}]`),
  );
  const out: Xform = { weight, color, colorSpeed, a, b, c, d, e, f, variations };
  if (o['opacity'] !== undefined) {
    const op = expectNumber(o['opacity'], `${path}.opacity`);
    if (op !== 1.0) out.opacity = op;
  }
  if (!isFinal && o['xaos'] !== undefined) {
    const arr = expectArray(o['xaos'], `${path}.xaos`);
    out.xaos = arr.map((v, i) => expectNumber(v, `${path}.xaos[${i}]`));
  }
  if (o['post'] !== undefined) {
    const p = expectObject(o['post'], `${path}.post`);
    out.post = {
      a: expectNumber(p['a'], `${path}.post.a`),
      b: expectNumber(p['b'], `${path}.post.b`),
      c: expectNumber(p['c'], `${path}.post.c`),
      d: expectNumber(p['d'], `${path}.post.d`),
      e: expectNumber(p['e'], `${path}.post.e`),
      f: expectNumber(p['f'], `${path}.post.f`),
    };
  }
  if (o['active'] === false) out.active = false;
  return out;
}

function finalxformFromJson(j: unknown, path: string): Xform {
  return parseXformBody(j, path, true);
}

function xformFromJson(j: unknown, path: string): Xform {
  return parseXformBody(j, path, false);
}

function variationFromJson(j: unknown, path: string): Variation {
  const o = expectObject(j, path);
  const name = expectString(o['name'], `${path}.name`);
  const weight = expectNumber(o['weight'], `${path}.weight`);
  if (!(name in V)) {
    throw new Error(`pyr3: unknown variation name '${name}' at ${path}`);
  }
  const index = V[name as keyof typeof V] as VariationIndex;
  const out: Variation = { index, weight };
  const paramsRaw = o['params'];
  const paramNames = VARIATION_PARAMS[name];
  if (paramsRaw !== undefined && paramNames !== undefined && paramNames.length > 0) {
    const params = expectObject(paramsRaw, `${path}.params`);
    const n = Math.min(paramNames.length, MAX_VARIATION_PARAMS);
    for (let i = 0; i < n; i++) {
      const pn = paramNames[i];
      const pk = PARAM_KEYS[i];
      if (pn === undefined || pk === undefined) continue;
      if (params[pn] !== undefined) {
        out[pk] = expectNumber(params[pn], `${path}.params.${pn}`);
      }
    }
  }
  if (o['active'] === false) out.active = false;
  return out;
}

// --- Tiny validation helpers ---

function expectObject(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`pyr3: expected object at ${path}, got: ${typeOf(v)}`);
  }
  return v as Record<string, unknown>;
}

function expectArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) {
    throw new Error(`pyr3: expected array at ${path}, got: ${typeOf(v)}`);
  }
  return v;
}

function expectString(v: unknown, path: string): string {
  if (typeof v !== 'string') {
    throw new Error(`pyr3: expected string at ${path}, got: ${typeOf(v)}`);
  }
  return v;
}

function expectNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`pyr3: expected finite number at ${path}, got: ${typeOf(v)}`);
  }
  return v;
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
