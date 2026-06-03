// Phase 5a — `.pyr3.json` schema (version 1) and round-trip serialization.
//
// JSON external shape uses named variation + named params. Internal Variation
// shape stays positional (matches GPU pack layout); translation lives here.
//
// Forward-compat: Phase 5b will add optional `finalxform`; Phase 5c will add
// optional `symmetry`. Neither requires a version bump (additive optional fields).

import { type Genome, type Symmetry, type Xform, type Pyr3Size, type SpatialFilter, isSpatialFilterShape } from './genome';
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
}

export interface Pyr3JsonVariation {
  name: string;
  weight: number;
  params?: Record<string, number>;
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
};

/** Positional param slot keys on `Variation`. Index `i` ↔ `param${i}`.
 *  Used by serialize / importer to map between the positional in-memory
 *  shape and the named-params on-disk shape. Max 8 slots (extended 6 → 8 in
 *  Phase 9b Batch K for mobius) — see `Variation` in src/variations.ts. */
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
  return out;
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
  return base;
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
