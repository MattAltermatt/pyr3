// Pure, DOM-free chaos-game logic for the /how-it-works teaching demos (#347).
// Reuses the engine's real variation kernels (src/variations.ts) and affine
// matrix shape (src/affine-decompose.ts) so the demos cannot drift from what
// the GPU renderer computes. No WebGPU, no DOM — fully unit-testable.

import type { RawAffine } from './affine-decompose';
import { PYRE_PALETTE, bakeLUT } from './palette';
import {
  ts_var_linear, ts_var_sinusoidal, ts_var_spherical, ts_var_swirl, ts_var_polar, ts_var_eyefish,
  ts_var_horseshoe, ts_var_handkerchief, ts_var_heart, ts_var_hyperbolic, ts_var_diamond,
  ts_var_disc, ts_var_bubble, ts_var_butterfly, ts_var_petal, ts_var_loonie, ts_var_scry,
  ts_var_cosine, ts_var_edisc, ts_var_elliptic, ts_var_foci, ts_var_loonie3, ts_var_polar2,
  type VarInput, type VarOutput,
} from './variations';

// Only variations with a pure ({tx,ty,weight}) TS kernel — no params, no RNG —
// can run in these CPU demos; the GPU-only catalog entries are unavailable here.
export type VarKind =
  | 'linear' | 'sinusoidal' | 'spherical' | 'swirl' | 'polar' | 'eyefish'
  | 'horseshoe' | 'handkerchief' | 'heart' | 'hyperbolic' | 'diamond'
  | 'disc' | 'bubble' | 'butterfly' | 'petal' | 'loonie' | 'scry'
  | 'cosine' | 'edisc' | 'elliptic' | 'foci' | 'loonie3' | 'polar2';

export interface DemoXform {
  affine: RawAffine;
  weight: number;
  /** Hue (0..360) for annotated dots — demo-only, not a genome field. */
  hue: number;
  /** Explicit RGB (0..255) for the dot colour — when set, overrides `hue`
   *  (used to match the catalog's PYRE-palette per-xform colours). */
  rgb?: [number, number, number];
  /** Optional single nonlinear bend applied after the affine (§6 base). */
  variation?: { kind: VarKind; weight: number };
  /** Optional variation CHAIN — a flam3 weighted sum applied to the affine
   *  output (Σ varₖ(p)·wₖ). Matches the catalog's linear(1-w)+var(w) mix. */
  chain?: Array<{ kind: VarKind; weight: number }>;
}

/** A whole transform: affine, then an optional variation. Used for the final
 *  xform "lens" (section 6) — a real final xform can carry a variation, which
 *  is what makes it a dramatic global warp rather than a rigid move. */
export interface FinalXform {
  affine: RawAffine;
  variation?: { kind: VarKind; weight: number };
}

export interface DemoFlame {
  xforms: DemoXform[];
  /** The "lens" — applied to every point after its xform (section 6). */
  finalXform?: FinalXform;
}

export interface ChaosState { x: number; y: number; lastXform: number; count: number }
export interface PlottedPoint { x: number; y: number; xform: number }

const VAR_FNS: Record<VarKind, (i: VarInput) => VarOutput> = {
  linear: ts_var_linear,
  sinusoidal: ts_var_sinusoidal,
  spherical: ts_var_spherical,
  swirl: ts_var_swirl,
  polar: ts_var_polar,
  eyefish: ts_var_eyefish,
  horseshoe: ts_var_horseshoe,
  handkerchief: ts_var_handkerchief,
  heart: ts_var_heart,
  hyperbolic: ts_var_hyperbolic,
  diamond: ts_var_diamond,
  disc: ts_var_disc,
  bubble: ts_var_bubble,
  butterfly: ts_var_butterfly,
  petal: ts_var_petal,
  loonie: ts_var_loonie,
  scry: ts_var_scry,
  cosine: ts_var_cosine,
  edisc: ts_var_edisc,
  elliptic: ts_var_elliptic,
  foci: ts_var_foci,
  loonie3: ts_var_loonie3,
  polar2: ts_var_polar2,
};

// PYRE palette baked once → sample at a colour coordinate (0..1) for the same
// per-xform colours the catalog uses (so §5 looks like the /variations tiles).
const PYRE_LUT = bakeLUT(PYRE_PALETTE.stops, PYRE_PALETTE.hue ?? 0, PYRE_PALETTE.mode ?? 'linear');
function paletteRgb(t: number): [number, number, number] {
  const i = Math.max(0, Math.min(255, Math.round(t * 255)));
  return [Math.round(PYRE_LUT[i * 4]! * 255), Math.round(PYRE_LUT[i * 4 + 1]! * 255), Math.round(PYRE_LUT[i * 4 + 2]! * 255)];
}

/** mulberry32 — tiny deterministic PRNG so demos/tests are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function initChaosState(): ChaosState {
  return { x: 0, y: 0, lastXform: -1, count: 0 };
}

/** Cumulative-weight roulette. `r` in [0,1). */
export function pickXform(flame: DemoFlame, r: number): number {
  let total = 0;
  for (const xf of flame.xforms) total += xf.weight;
  let acc = 0;
  const target = r * total;
  for (let i = 0; i < flame.xforms.length; i++) {
    acc += flame.xforms[i]!.weight;
    if (target < acc) return i;
  }
  return flame.xforms.length - 1;
}

function applyAffine(m: RawAffine, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.b * y + m.c, y: m.d * x + m.e * y + m.f };
}

/** One iteration: pick → affine → (variation) → (final affine). Returns the new
 *  point and which xform produced it. */
function advance(flame: DemoFlame, x: number, y: number, rng: () => number): PlottedPoint {
  const xi = pickXform(flame, rng());
  const xf = flame.xforms[xi]!;
  const aff = applyAffine(xf.affine, x, y);
  let out = { x: aff.x, y: aff.y };
  if (xf.chain) {
    // flam3 weighted sum: Σ varₖ(affine_pt)·wₖ (each kernel scales by its weight).
    let sx = 0, sy = 0;
    for (const c of xf.chain) {
      const v = VAR_FNS[c.kind]({ tx: aff.x, ty: aff.y, weight: c.weight });
      sx += v.x; sy += v.y;
    }
    out = { x: sx, y: sy };
  } else if (xf.variation) {
    const v = VAR_FNS[xf.variation.kind]({ tx: aff.x, ty: aff.y, weight: xf.variation.weight });
    out = { x: v.x, y: v.y };
  }
  if (flame.finalXform) {
    const fa = applyAffine(flame.finalXform.affine, out.x, out.y);
    if (flame.finalXform.variation) {
      const v = VAR_FNS[flame.finalXform.variation.kind]({ tx: fa.x, ty: fa.y, weight: flame.finalXform.variation.weight });
      out = { x: v.x, y: v.y };
    } else {
      out = { x: fa.x, y: fa.y };
    }
  }
  return { x: out.x, y: out.y, xform: xi };
}

/** Plot one point: advances state, increments count, records the firing xform. */
export function stepChaos(
  flame: DemoFlame, state: ChaosState, rng: () => number,
): { state: ChaosState; point: PlottedPoint } {
  const p = advance(flame, state.x, state.y, rng);
  return { state: { x: p.x, y: p.y, lastXform: p.xform, count: state.count + 1 }, point: p };
}

/** Warm-up: advance `iters` times WITHOUT plotting (count unchanged) so the
 *  first visible point already lies on the attractor. */
export function runFuse(
  flame: DemoFlame, state: ChaosState, rng: () => number, iters: number,
): ChaosState {
  let { x, y } = state;
  let lastXform = state.lastXform;
  for (let i = 0; i < iters; i++) {
    const p = advance(flame, x, y, rng);
    x = p.x; y = p.y; lastXform = p.xform;
  }
  return { x, y, lastXform, count: state.count };
}

/** Sierpinski triangle: 3 affine contractions, each mapping p → midpoint(p, corner).
 *  Equal weight. Hues mirror the design mockup (A red / B green / C blue). */
const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.95], [0.05, 0.05], [0.95, 0.05],
];
const HUES = [0, 140, 215];
export const SIERPINSKI: DemoFlame = {
  xforms: CORNERS.map(([cx, cy], i) => ({
    affine: { a: 0.5, b: 0, c: cx * 0.5, d: 0, e: 0.5, f: cy * 0.5 },
    weight: 1,
    hue: HUES[i]!,
  })),
};

/** Sierpinski with per-xform weights overridden (section 4 — "which xform fires").
 *  Affines/hues are unchanged; only selection probability shifts. */
export function sierpinskiWithWeights(w0: number, w1: number, w2: number): DemoFlame {
  const w = [w0, w1, w2];
  return { xforms: SIERPINSKI.xforms.map((xf, i) => ({ ...xf, weight: w[i]! })) };
}

/** §5 — render a variation EXACTLY like the /variations catalog tile: the same
 *  centred 3-xform Sierpinski scaffold, the same linear(1-w)+var(w) mix, and the
 *  same PYRE-palette per-xform colours (see buildCatalogGenome in
 *  variation-catalog-scaffold.ts). `weight` is the catalog's mix slider (0..1;
 *  1 = pure variation). The caller pins the catalog view (scale 170, cy 0.2). */
const SQRT3_2 = Math.sqrt(3) / 2;
const CATALOG_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [-SQRT3_2, -0.5], [SQRT3_2, -0.5],
];
export function catalogVariationFlame(kind: VarKind | null, weight = 1): DemoFlame {
  const w = Math.max(0, Math.min(1, weight));
  const xforms: DemoXform[] = CATALOG_CORNERS.map(([vx, vy], i) => {
    const colorCoord = i / 2; // 0, 0.5, 1 — spread across the palette (catalog parity)
    const chain: Array<{ kind: VarKind; weight: number }> =
      !kind || kind === 'linear'
        ? [{ kind: 'linear', weight: 1 }]
        : [{ kind: 'linear', weight: 1 - w }, { kind, weight: w }];
    return {
      affine: { a: 0.5, b: 0, c: 0.5 * vx, d: 0, e: 0.5, f: 0.5 * vy },
      weight: 1 / 3,
      hue: 0,
      rgb: paletteRgb(colorCoord),
      chain,
    };
  });
  return { xforms };
}

