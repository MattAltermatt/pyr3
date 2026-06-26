// #119 — Variation Catalog content.
//
// One VariationDoc per variation index. The catalog page consumes this
// in numeric order to render the full V0..V322 set. Every variation has a
// complete entry (asserted in tests).

import {
  V,
  ts_var_billiard_circle,
  ts_var_billiard_stadium,
  ts_var_billiard_sinai,
  ts_var_billiard_polygon,
  ts_var_lorentz_boost,
  ts_var_schwarzschild_lensing,
  ts_var_field_dipole,
  ts_var_magnetic_pendulum,
} from './variations';

export type CatalogSource = 'flam3' | 'jwf' | 'novel';

export interface ParamDoc {
  name: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface VariationDoc {
  idx: number;
  name: string;
  source: CatalogSource;
  /** KaTeX-ready LaTeX (single-line). */
  formula: string;
  /** 1-2 sentence description of the visual character. */
  blurb: string;
  /** Only present for parameterized variations. Order MUST match the
   *  positional mapping in src/serialize.ts:VARIATION_PARAMS — values are
   *  fed straight into Variation.param0..param9 at scaffold-build time. */
  params?: ParamDoc[];
  /** Catalog-specific initial weight slider value. Default 1 (full
   *  substitution). Used for variations like cell + pre_blur where the
   *  best showcase is at weight < 1 — e.g. pre_blur's natural pairing is
   *  ~25% mix-in. Doesn't affect the engine; this is a display knob. */
  defaultWeight?: number;
  /** When true, the catalog hides the weight slider entirely for this
   *  variation. Used for the DC color-only family (V99/V100/V101) whose
   *  position contribution is zero — the slider would do nothing visible
   *  anyway, so removing it avoids the "moving the slider isn't doing
   *  anything" confusion. */
  hideWeight?: boolean;
  /** Deterministic 2D warp impl for the catalog's grid-warp SVG pane.
   *  Omit for RNG-driven variations (the catalog renders a "warp not
   *  applicable" note instead). MUST NOT use Math.random. */
  warpFn?: (x: number, y: number) => [number, number];
}

/** Source category from variation index — pure **provenance**, mirroring
 *  the display-label namespace (V… = flam3, JWF… = JWildfire port, P… =
 *  novel pyr3 original). The Direct-Color *capability* is orthogonal to
 *  provenance — it's a cross-cutting attribute carried by `DC_VARIATION_SET`
 *  and surfaced as the per-section "Direct Color" pill, NOT a source bucket
 *  (#222). So the four dc_* ports (V99..V102 = JWF0..JWF3, Neil Slater /
 *  JWildfire lineage) classify as 'jwf'; newton (V220 = P0, #133),
 *  magnetic_pendulum (V265 = P45, #138) and the escape-time fractals
 *  (V310..V313 = P90..P93, #145) classify as 'novel'. */
export function sourceForIdx(idx: number): CatalogSource {
  if (idx <= V.mobius) return 'flam3';
  if (idx === V.newton) return 'novel';                          // #133 — novel conformal (P0)
  if (idx >= V.blaschke && idx <= 309) return 'novel'; // #133/#134/#130/#129/#140/#135/#139/#149/#136/#150/#138/#131 + #16 marathon V271–V303 + follow-ons V304–V309 (#216/#218/#220/#221)
  if (idx >= V.burning_ship && idx <= V.halley) return 'novel';  // #145 — novel escape-time fractals (P90..P93)
  if (idx === V.lichtenberg) return 'novel';                     // #219 — stateless filament warp (P94)
  if (idx === V.copula_gaussian || idx === V.copula_clayton) return 'novel'; // #217 — copula warps (P95/P96)
  if (idx === V.schwarz_christoffel || idx === V.doyle) return 'novel'; // #154 — conformal pair (P97/P98)
  if (idx === V.quasicrystal || idx === V.penrose) return 'novel'; // #143 — aperiodic-tiling pair (P99/P100)
  if (idx === V.collatz || idx === V.digamma) return 'novel'; // #142 — number-theoretic pair (P101/P102)
  return 'jwf';
}

// #131 — inline complex-math for the modular catalog warpFns (mirror chaos.wgsl,
// including the ±1e18 clamp the WGSL applies to klein_j / weierstrass_p before
// log-compression). Deterministic — no Math.random.
type Cx = [number, number];
const cxmul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cxsqr = (z: Cx): Cx => [z[0] * z[0] - z[1] * z[1], 2 * z[0] * z[1]];
const cxdiv = (a: Cx, b: Cx): Cx => {
  const m = Math.max(b[0] * b[0] + b[1] * b[1], 1e-100);
  return [(a[0] * b[0] + a[1] * b[1]) / m, (a[1] * b[0] - a[0] * b[1]) / m];
};
const cxrecip = (z: Cx): Cx => {
  const m = Math.max(z[0] * z[0] + z[1] * z[1], 1e-100);
  return [z[0] / m, -z[1] / m];
};
const cxexp = (z: Cx): Cx => {
  const e = Math.exp(Math.max(-20, Math.min(20, z[0])));
  return [e * Math.cos(z[1]), e * Math.sin(z[1])];
};
const cxlog = (z: Cx): Cx => [0.5 * Math.log(z[0] * z[0] + z[1] * z[1] + 1e-20), Math.atan2(z[1], z[0])];
const cxpow = (t: Cx, p: Cx): Cx => cxexp(cxmul(p, cxlog(t)));
const clamp1e18 = (v: number): number => Math.max(-1e18, Math.min(1e18, v));

function modUpperHalf(x: number, y: number, imFloor: number): Cx {
  return [x, Math.max(Math.abs(y) + Math.max(imFloor, 0.02), 0.006435)];
}
function modNome(tau: Cx): Cx { return cxexp([-Math.PI * tau[1], Math.PI * tau[0]]); }
function modTheta3(q: Cx): Cx {
  const q2 = cxsqr(q); let qn2 = q; let odd = cxmul(q2, q); let sum: Cx = [q[0], q[1]];
  for (let n = 2; n <= 8; n++) { qn2 = cxmul(qn2, odd); sum = [sum[0] + qn2[0], sum[1] + qn2[1]]; odd = cxmul(odd, q2); }
  return [1 + 2 * sum[0], 2 * sum[1]];
}
function modTheta2(q: Cx): Cx {
  const q2 = cxsqr(q); let term: Cx = [1, 0]; let ev = q2; let sum: Cx = [1, 0];
  for (let n = 1; n <= 7; n++) { term = cxmul(term, ev); sum = [sum[0] + term[0], sum[1] + term[1]]; ev = cxmul(ev, q2); }
  const q14 = cxpow(q, [0.25, 0]); const r = cxmul(q14, sum); return [2 * r[0], 2 * r[1]];
}
// kind: 'theta3' → θ₃(τ); 'lambda' → λ; 'j' → klein j (log-compressed, clamped).
function modularEval(x: number, y: number, imFloor: number, kind: 'theta3' | 'lambda' | 'j'): [number, number] {
  const q = modNome(modUpperHalf(x, y, imFloor));
  if (kind === 'theta3') return modTheta3(q);
  const r = cxdiv(modTheta2(q), modTheta3(q));
  const lam = cxsqr(cxsqr(r));
  if (kind === 'lambda') return lam;
  const lam2 = cxsqr(lam);
  const a: Cx = [1 - lam[0] + lam2[0], -lam[1] + lam2[1]];   // 1 − λ + λ²
  const a3 = cxmul(cxsqr(a), a);
  const numer: Cx = [256 * a3[0], 256 * a3[1]];
  const oml: Cx = [1 - lam[0], -lam[1]];
  const denom = cxmul(lam2, cxsqr(oml));
  const j0 = cxdiv(numer, denom);
  const j: Cx = [clamp1e18(j0[0]), clamp1e18(j0[1])];
  const mag = Math.hypot(j[0], j[1]); const s = Math.log(1 + mag) / Math.max(mag, 1e-12);
  return [s * j[0], s * j[1]];
}
function weierstrassEval(x: number, y: number, o1re: number, o1im: number, o2re: number, o2im: number): [number, number] {
  const z: Cx = [x, y]; let acc = cxrecip(cxsqr(z));
  for (let m = -2; m <= 2; m++) for (let n = -2; n <= 2; n++) {
    if (m === 0 && n === 0) continue;
    const omega: Cx = [m * o1re + n * o2re, m * o1im + n * o2im];
    const t1 = cxrecip(cxsqr([z[0] - omega[0], z[1] - omega[1]]));
    const t2 = cxrecip(cxsqr(omega));
    acc = [acc[0] + t1[0] - t2[0], acc[1] + t1[1] - t2[1]];
  }
  const ac: Cx = [clamp1e18(acc[0]), clamp1e18(acc[1])];
  const mag = Math.hypot(ac[0], ac[1]); const s = Math.log(1 + mag) / Math.max(mag, 1e-12);
  return [s * ac[0], s * ac[1]];
}
function gaussFrac(t: number): number {
  const r = (t < 0 ? -1 : 1) / Math.max(Math.abs(t), 1e-4);
  return r - Math.floor(r);
}

export const CATALOG_DATA: readonly VariationDoc[] = [
  {
    idx: V.linear,
    name: 'linear',
    source: sourceForIdx(V.linear),
    formula: 'V_0(x, y) = (x, y)',
    blurb: 'Identity transform. Passes coordinates through unchanged — the reference baseline. The sierpinski scaffold runs unaltered, so the live pane shows the canonical three-corner attractor every other variation distorts away from.',
    warpFn: (x, y) => [x, y],
  },
  {
    idx: V.sinusoidal,
    name: 'sinusoidal',
    source: sourceForIdx(V.sinusoidal),
    formula: 'V_1(x, y) = (\\sin x, \\sin y)',
    blurb: 'Componentwise sine. Bounds outputs to [-1,1]² regardless of input magnitude — produces folded, woven structure as the chaos game keeps re-entering the same band.',
    warpFn: (x, y) => [Math.sin(x), Math.sin(y)],
  },
  {
    idx: V.spherical,
    name: 'spherical',
    source: sourceForIdx(V.spherical),
    formula: 'V_2(x, y) = \\frac{1}{r^2}(x, y),\\quad r^2 = x^2 + y^2',
    blurb: 'Inversion through the unit circle. Points inside the unit disk map outward and vice versa — produces the characteristic ringed "spherical inversion" glow.',
    warpFn: (x, y) => {
      const r2 = Math.max(x * x + y * y, 1e-4);
      return [x / r2, y / r2];
    },
  },
  {
    idx: V.swirl,
    name: 'swirl',
    source: sourceForIdx(V.swirl),
    formula: 'V_3(x, y) = (x \\sin r^2 - y \\cos r^2,\\; x \\cos r^2 + y \\sin r^2)',
    blurb: 'Radius-dependent rotation. Outer rings rotate faster than inner ones — produces the spiraling "swirl" texture characteristic of high-energy flames.',
    warpFn: (x, y) => {
      const r2 = x * x + y * y;
      const s = Math.sin(r2), c = Math.cos(r2);
      return [x * s - y * c, x * c + y * s];
    },
  },
  {
    idx: V.julian,
    name: 'julian',
    source: sourceForIdx(V.julian),
    formula: 'V_{14}(x, y) = r^{c/n}\\,(\\cos t,\\; \\sin t),\\quad t = \\tfrac{\\phi + 2\\pi \\, \\mathrm{rand}(n)}{n}',
    blurb: 'Generalized Julia — splits each input into n rotationally symmetric branches, picked at random per iteration. The signature flame pattern of countless production flames. Drag power to change branch count; dist controls radial scaling.',
    params: [
      // User-requested catalog default: power=2 (produces the recognizable
      // 2-fold julian symmetry). Diverges from VARIATION_DEFAULTS.julian=[1,1]
      // (which would be degenerate-identity at power=1).
      { name: 'power', default: 2, min: -10, max: 10, step: 1 },
      { name: 'dist',  default: 1, min: -2,  max: 2,  step: 0.05 },
    ],
    // Deterministic branch-0 visualization for the warp diagram at power=2
    // (real chaos game samples randBranch ∈ [0..n-1] per iter; one branch
    // is enough to read the variation's character).
    warpFn: (x, y) => {
      const r = Math.sqrt(x * x + y * y);
      const phi = Math.atan2(y, x);
      const n = 2, c = 1, t = phi / n, rad = Math.pow(r, c / n);
      return [rad * Math.cos(t), rad * Math.sin(t)];
    },
  },
  // ---------------------------------------------------------------------
  // flam3 core continued — V4..V13, V15..V42, V46, V48..V98.
  // ---------------------------------------------------------------------
  {
    idx: V.horseshoe,
    name: 'horseshoe',
    source: sourceForIdx(V.horseshoe),
    formula: 'V_4(x, y) = \\tfrac{1}{r}\\,((x-y)(x+y),\\; 2xy)',
    blurb: 'Squares the input as a complex number and rescales by 1/r. Folds the plane through the origin into a horseshoe-shaped sheet — a classic flame motif for adding curl without losing radial structure.',
    warpFn: (x, y) => {
      const r = Math.hypot(x, y) + 1e-10;
      return [((x - y) * (x + y)) / r, (2 * x * y) / r];
    },
  },
  {
    idx: V.polar,
    name: 'polar',
    source: sourceForIdx(V.polar),
    formula: 'V_5(x, y) = (\\phi/\\pi,\\; r - 1),\\quad \\phi = \\mathrm{atan2}(x, y)',
    blurb: 'Maps to polar coordinates as cartesian outputs — angle on x, radius-minus-one on y. The defining "polar strip" effect that turns radial structure into horizontal bands.',
    warpFn: (x, y) => {
      const phi = Math.atan2(x, y);
      const r = Math.hypot(x, y);
      return [phi / Math.PI, r - 1.0];
    },
  },
  {
    idx: V.handkerchief,
    name: 'handkerchief',
    source: sourceForIdx(V.handkerchief),
    formula: 'V_6(x, y) = r\\,(\\sin(\\phi + r),\\; \\cos(\\phi - r)),\\quad \\phi = \\mathrm{atan2}(x, y)',
    blurb: 'Phase-shift the polar angle by ±r before unfolding. The result is a soft, draped sheet — flam3\'s namesake handkerchief silhouette.',
    warpFn: (x, y) => {
      const phi = Math.atan2(x, y);
      const r = Math.hypot(x, y);
      return [r * Math.sin(phi + r), r * Math.cos(phi - r)];
    },
  },
  {
    idx: V.heart,
    name: 'heart',
    source: sourceForIdx(V.heart),
    formula: 'V_7(x, y) = r\\,(\\sin(\\phi r),\\; -\\cos(\\phi r)),\\quad \\phi = \\mathrm{atan2}(x, y)',
    blurb: 'Multiplies the polar angle by the radius before unfolding. Tight near the origin, splayed outward — produces the unmistakable cardioid-cleavage shape.',
    warpFn: (x, y) => {
      const phi = Math.atan2(x, y);
      const r = Math.hypot(x, y);
      return [r * Math.sin(phi * r), -r * Math.cos(phi * r)];
    },
  },
  {
    idx: V.disc,
    name: 'disc',
    source: sourceForIdx(V.disc),
    formula: 'V_8(x, y) = \\tfrac{\\phi}{\\pi}\\,(\\sin(\\pi r),\\; \\cos(\\pi r)),\\quad \\phi = \\mathrm{atan2}(x, y)',
    blurb: 'Maps the plane onto concentric disc-rings via polar angle × sin/cos of π·r. Tight rings near r=integer, smooth bands elsewhere — a flam3 staple for ringed structure.',
    warpFn: (x, y) => {
      const phi = Math.atan2(x, y);
      const r = Math.hypot(x, y);
      return [(phi / Math.PI) * Math.sin(Math.PI * r), (phi / Math.PI) * Math.cos(Math.PI * r)];
    },
  },
  {
    idx: V.spiral,
    name: 'spiral',
    source: sourceForIdx(V.spiral),
    formula: 'V_9(x, y) = \\tfrac{w}{r}\\,(\\cos\\alpha + \\sin r,\\; \\sin\\alpha - \\cos r),\\; \\alpha = \\mathrm{atan2}(x, y),\\; r = \\sqrt{x^2+y^2}',
    blurb: 'Combines a 1/r radial inversion with sin/cos perturbations at radius r. Produces the characteristic logarithmic spiral arms.',
    warpFn: (x, y) => {
      const r = Math.hypot(x, y) + 1e-10;
      const sina = x / r, cosa = y / r;
      return [(cosa + Math.sin(r)) / r, (sina - Math.cos(r)) / r];
    },
  },
  {
    idx: V.hyperbolic,
    name: 'hyperbolic',
    source: sourceForIdx(V.hyperbolic),
    formula: 'V_{10}(x, y) = (\\sin\\alpha / r,\\; r\\cos\\alpha),\\quad \\sin\\alpha = x/r,\\;\\cos\\alpha = y/r',
    blurb: 'Reciprocal stretch along one polar axis, multiplicative along the other. Produces hyperbolic sheets — sharp near the origin, attenuated at the edges.',
    warpFn: (x, y) => {
      const r = Math.hypot(x, y) + 1e-10;
      const sina = x / r, cosa = y / r;
      return [sina / r, r * cosa];
    },
  },
  {
    idx: V.diamond,
    name: 'diamond',
    source: sourceForIdx(V.diamond),
    formula: 'V_{11}(x, y) = (\\sin\\alpha \\cos r,\\; \\cos\\alpha \\sin r)',
    blurb: 'Couples the polar angle\'s sin/cos with the radial sin/cos. Produces diamond-tile lattices — a clean grid of rotated squares.',
    warpFn: (x, y) => {
      const r = Math.hypot(x, y);
      const r_eps = r + 1e-10;
      const sina = x / r_eps, cosa = y / r_eps;
      return [sina * Math.cos(r), cosa * Math.sin(r)];
    },
  },
  {
    idx: V.ex,
    name: 'ex',
    source: sourceForIdx(V.ex),
    formula: 'V_{12}(x, y) = r\\,(m_0 + m_1,\\; m_0 - m_1),\\; m_0 = \\sin^3(\\phi+r),\\; m_1 = \\cos^3(\\phi-r)',
    blurb: 'Cubes the sinusoidal handkerchief terms before unfolding. Sharpens the soft handkerchief into pinched, faceted ribbons.',
    warpFn: (x, y) => {
      const phi = Math.atan2(x, y);
      const r = Math.hypot(x, y);
      const n0 = Math.sin(phi + r), n1 = Math.cos(phi - r);
      const m0 = n0 * n0 * n0, m1 = n1 * n1 * n1;
      return [r * (m0 + m1), r * (m0 - m1)];
    },
  },
  {
    idx: V.julia,
    name: 'julia',
    source: sourceForIdx(V.julia),
    formula: 'V_{13}(x, y) = \\sqrt{r}\\,(\\cos\\theta,\\; \\sin\\theta),\\quad \\theta = \\tfrac{\\phi}{2} + \\pi \\cdot \\mathrm{rand}(2)',
    blurb: 'Two-branch Julia map — sqrt(r) at half-angle, randomly flipped 180°. The simplest Julia variant; produces the canonical two-lobed self-similar fractal.',
    // Branch 0 deterministic for the warp diagram — the second branch
    // is a 180° rotation of the first.
    warpFn: (x, y) => {
      const phi = Math.atan2(x, y);
      const r = Math.sqrt(Math.hypot(x, y));
      const theta = phi * 0.5;
      return [r * Math.cos(theta), r * Math.sin(theta)];
    },
  },
  {
    idx: V.bent,
    name: 'bent',
    source: sourceForIdx(V.bent),
    formula: 'V_{15}(x, y) = (\\,x<0?\\,2x:x,\\; y<0?\\,y/2:y\\,)',
    blurb: 'Piecewise rescale by sign of each component — stretches the third quadrant horizontally and squashes its vertical, leaving the first quadrant untouched. Asymmetric bend characteristic of early flam3 art.',
    warpFn: (x, y) => [x < 0 ? x * 2.0 : x, y < 0 ? y * 0.5 : y],
  },
  {
    idx: V.waves,
    name: 'waves',
    source: sourceForIdx(V.waves),
    formula: 'V_{16}(x, y) = (\\,x + b\\sin(y/c^2),\\; y + e\\sin(x/f^2)\\,)',
    blurb: 'Perturbs each coordinate by a sine of the other, with amplitudes/frequencies drawn from the xform\'s own affine (b/c/e/f). Produces the woven, oscillating texture for which it\'s named.',
    warpFn: (x, y) => {
      // Visualization uses an arbitrary affine (b=0.4, c=0.5, e=0.4, f=0.5)
      // since the chaos pane has no affine of its own. Captures the character.
      const b = 0.4, c = 0.5, e = 0.4, f = 0.5;
      return [
        x + b * Math.sin(y / (c * c + 1e-10)),
        y + e * Math.sin(x / (f * f + 1e-10)),
      ];
    },
  },
  {
    idx: V.fisheye,
    name: 'fisheye',
    source: sourceForIdx(V.fisheye),
    formula: 'V_{17}(x, y) = \\tfrac{2}{r+1}\\,(y, x)',
    blurb: 'Wide-angle lens warp with an intentional x/y swap (flam3 spec). Squeezes the far field into a small disc around the origin; the swap rotates the result 90°.',
    warpFn: (x, y) => {
      const r = 2.0 / (Math.hypot(x, y) + 1.0);
      return [r * y, r * x];
    },
  },
  {
    idx: V.popcorn,
    name: 'popcorn',
    source: sourceForIdx(V.popcorn),
    formula: 'V_{18}(x, y) = (\\,x + c\\sin(\\tan 3y),\\; y + f\\sin(\\tan 3x)\\,)',
    blurb: 'Each coordinate is jittered by a tan-nested sin of the other axis — the tan singularities produce sharp pops. Reads the xform\'s c/f affine for amplitude.',
    warpFn: (x, y) => {
      const c = 0.5, f = 0.5;
      return [
        x + c * Math.sin(Math.tan(3.0 * y)),
        y + f * Math.sin(Math.tan(3.0 * x)),
      ];
    },
  },
  {
    idx: V.eyefish,
    name: 'eyefish',
    source: sourceForIdx(V.eyefish),
    formula: 'V_{19}(x, y) = \\tfrac{2}{r+1}\\,(x, y)',
    blurb: 'Fisheye without the axis swap — pure wide-angle lens. Compresses the far field radially toward the origin.',
    warpFn: (x, y) => {
      const r = 2.0 / (Math.hypot(x, y) + 1.0);
      return [r * x, r * y];
    },
  },
  {
    idx: V.bubble,
    name: 'bubble',
    source: sourceForIdx(V.bubble),
    formula: 'V_{20}(x, y) = \\tfrac{4}{r^2 + 4}\\,(x, y)',
    blurb: 'Wraps the plane onto the surface of a sphere, projected back to 2D. Compresses everything radially into a unit-disc-shaped "bubble"; outside points get pulled inward.',
    warpFn: (x, y) => {
      const k = 1.0 / (0.25 * (x * x + y * y) + 1.0);
      return [k * x, k * y];
    },
  },
  {
    idx: V.cylinder,
    name: 'cylinder',
    source: sourceForIdx(V.cylinder),
    formula: 'V_{21}(x, y) = (\\sin x,\\; y)',
    blurb: 'Wraps x onto the unit circle via sin while preserving y. Produces vertical bands of repeated structure — like the plane rolled around a cylinder.',
    warpFn: (x, y) => [Math.sin(x), y],
  },
  {
    idx: V.disc2,
    name: 'disc2',
    source: sourceForIdx(V.disc2),
    formula: 'V_{22}(x, y) = \\tfrac{\\phi}{\\pi}\\,(\\sin t + c_a,\\; \\cos t + s_a),\\; t = \\pi\\,\\mathrm{rot}(x+y)',
    blurb: 'Disc warp with extra rotation and twist parameters. The disc bands rotate by rot×π and shear by twist — extends disc with controllable spin.',
    params: [
      // User-curated defaults — non-zero rot+twist produces the
      // characteristic disc2 spiral fan instead of degenerate disc.
      { name: 'rot',   default: 1, min: -5, max: 5, step: 0.05 },
      { name: 'twist', default: 1, min: -5, max: 5, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const rot = 1, twist = 1;
      const TAU = 2 * Math.PI;
      const timespi = rot * Math.PI;
      let cosadd = Math.cos(twist) - 1.0;
      let sinadd = Math.sin(twist);
      if (twist > TAU) { const k = 1 + twist - TAU; cosadd *= k; sinadd *= k; }
      else if (twist < -TAU) { const k = 1 + twist + TAU; cosadd *= k; sinadd *= k; }
      const t = timespi * (x + y);
      const sinr = Math.sin(t), cosr = Math.cos(t);
      const r = Math.atan2(x, y) / Math.PI;
      return [(sinr + cosadd) * r, (cosr + sinadd) * r];
    },
  },
  {
    idx: V.pdj,
    name: 'pdj',
    source: sourceForIdx(V.pdj),
    formula: 'V_{23}(x, y) = (\\sin(a y) - \\cos(b x),\\; \\sin(c x) - \\cos(d y))',
    blurb: 'Peter de Jong attractor map — four-parameter trigonometric coupling. Generates organic, looping shell-like attractors; small tweaks to a/b/c/d produce dramatically different forms.',
    params: [
      // Catalog-specific defaults: the canonical Peter de Jong attractor
      // values (a=1.4, b=1.6, c=1.0, d=0.7). flam3 has no entry in
      // VARIATION_DEFAULTS for pdj, so the importer falls back to all-zero
      // — but all-zero collapses the variation to (-1,-1) for every input,
      // pounding a single histogram bucket with severe atomic contention
      // (reported to freeze laptops on Apple Silicon, #119 2026-06-06).
      // User-curated defaults: a=b=c=d=-1 produces a recognizable
      // four-fold attractor figure. (Earlier rev used the canonical
      // a=1.4, b=1.6, c=1.0, d=0.7 to escape the all-zero degeneracy;
      // these values keep the same non-degenerate property.)
      { name: 'a', default: -1, min: -3, max: 3, step: 0.05 },
      { name: 'b', default: -1, min: -3, max: 3, step: 0.05 },
      { name: 'c', default: -1, min: -3, max: 3, step: 0.05 },
      { name: 'd', default: -1, min: -3, max: 3, step: 0.05 },
    ],
    warpFn: (x, y) => {
      // #252 — must match params[].default (a=b=c=d=-1), not the canonical
      // 1.4/1.6/1.0/0.7, so the static diagram shows the same figure as the
      // live flame. (Aligning the diagram, not retuning the slider default.)
      const a = -1, b = -1, c = -1, d = -1;
      const nx1 = Math.cos(b * x), nx2 = Math.sin(c * x);
      const ny1 = Math.sin(a * y), ny2 = Math.cos(d * y);
      return [ny1 - nx1, nx2 - ny2];
    },
  },
  {
    idx: V.exponential,
    name: 'exponential',
    source: sourceForIdx(V.exponential),
    formula: 'V_{24}(x, y) = e^{x-1}\\,(\\cos(\\pi y),\\; \\sin(\\pi y))',
    blurb: 'Complex exponential of (x−1) + iπy. Wraps the plane onto exponential horns whose pitch is set by π — distinct from V53 exp (no π scaling on y).',
    warpFn: (x, y) => {
      const dx = Math.exp(x - 1.0);
      const dy = Math.PI * y;
      return [dx * Math.cos(dy), dx * Math.sin(dy)];
    },
  },
  {
    idx: V.power,
    name: 'power',
    source: sourceForIdx(V.power),
    formula: 'V_{25}(x, y) = r^{\\sin\\alpha}\\,(\\cos\\alpha,\\; \\sin\\alpha)',
    blurb: 'Raises r to the power of sin(angle) — a self-modifying radial scale that creates clouds of soft, organic structure.',
    warpFn: (x, y) => {
      const r = Math.hypot(x, y) + 1e-10;
      const sina = x / r, cosa = y / r;
      const k = Math.pow(r, sina);
      return [k * cosa, k * sina];
    },
  },
  {
    idx: V.cosine,
    name: 'cosine',
    source: sourceForIdx(V.cosine),
    formula: 'V_{26}(x, y) = (\\cos(\\pi x)\\cosh y,\\; -\\sin(\\pi x)\\sinh y)',
    blurb: 'Complex cosine with π-scaled real part. Wraps horizontally with period 2; vertically expands hyperbolically.',
    warpFn: (x, y) => {
      const a = x * Math.PI;
      return [Math.cos(a) * Math.cosh(y), -Math.sin(a) * Math.sinh(y)];
    },
  },
  {
    idx: V.tangent,
    name: 'tangent',
    source: sourceForIdx(V.tangent),
    formula: 'V_{27}(x, y) = (\\sin x / \\cos y,\\; \\tan y)',
    blurb: 'Real tan via sin(x)/cos(y) on the x output, tan(y) on the y. Singular at cos(y)=0; the chaos-game retry path handles the asymptotes.',
    warpFn: (x, y) => [Math.sin(x) / Math.cos(y), Math.tan(y)],
  },
  {
    idx: V.secant2,
    name: 'secant2',
    source: sourceForIdx(V.secant2),
    formula: 'V_{28}(x, y) = (x,\\; 1/\\cos r \\pm 1),\\; r = w\\sqrt{x^2+y^2}',
    blurb: 'Passes x through unchanged; y becomes the secant of the (weighted) radius, with sign-dependent ±1 offset. Produces sharp horizontal bands at sec singularities.',
    warpFn: (x, y) => {
      const w = 1.0;
      const r = w * Math.hypot(x, y);
      const cr = Math.cos(r);
      const icr = 1.0 / cr;
      return [x, cr < 0 ? icr + 1.0 : icr - 1.0];
    },
  },
  {
    idx: V.cross,
    name: 'cross',
    source: sourceForIdx(V.cross),
    formula: 'V_{29}(x, y) = \\sqrt{1/(x^2-y^2)^2}\\,(x, y)',
    blurb: 'Rescales each point by 1/|x²−y²|. Singular along the diagonals y = ±x — produces a bright cross-shaped attractor with thin diagonal cuts.',
    warpFn: (x, y) => {
      const s = x * x - y * y;
      const r = Math.sqrt(1.0 / (s * s + 1e-10));
      return [x * r, y * r];
    },
  },
  {
    idx: V.rings,
    name: 'rings',
    source: sourceForIdx(V.rings),
    formula: 'V_{30}(x, y) = r\\,(\\cos\\alpha,\\; \\sin\\alpha),\\; r = ((r_0+c^2)\\bmod 2c^2) - c^2 + r_0(1-c^2)',
    blurb: 'Modulo-wraps the radial coordinate into rings whose spacing comes from the xform\'s affine c. Produces concentric ring structure preserving angular position.',
    warpFn: (x, y) => {
      const c = 0.5;
      const r0 = Math.hypot(x, y);
      const r_eps = r0 + 1e-10;
      const sina = x / r_eps, cosa = y / r_eps;
      const dx = c * c + 1e-10;
      const r = ((r0 + dx) % (2 * dx)) - dx + r0 * (1.0 - dx);
      return [r * cosa, r * sina];
    },
  },
  {
    idx: V.fan,
    name: 'fan',
    source: sourceForIdx(V.fan),
    formula: 'V_{31}(x, y) = r\\,(\\cos a,\\; \\sin a),\\; a = \\phi \\pm \\tfrac{dx}{2}',
    blurb: 'Folds polar angle through a periodic wedge — like a paper fan opening. Step width comes from the xform\'s c affine; offset from f.',
    warpFn: (x, y) => {
      const c = 0.5, f = 0.0;
      const dx = Math.PI * (c * c + 1e-10);
      const dy = f;
      const dx2 = 0.5 * dx;
      const phi = Math.atan2(x, y);
      const r = Math.hypot(x, y);
      const t = phi + dy - dx * Math.trunc((phi + dy) / dx);
      const a = t > dx2 ? phi - dx2 : phi + dx2;
      return [r * Math.cos(a), r * Math.sin(a)];
    },
  },
  {
    idx: V.rings2,
    name: 'rings2',
    source: sourceForIdx(V.rings2),
    formula: 'V_{32}(x, y) = r\\,(\\sin\\alpha,\\; \\cos\\alpha),\\quad r = r_0 - 2dx\\,\\lfloor(r_0+dx)/(2dx)\\rfloor + r_0(1-dx)',
    blurb: 'Like rings but with an explicit val parameter setting ring spacing (vs reading c). Output axes swap vs rings.',
    params: [
      { name: 'val', default: 0.45, min: -3, max: 3, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const val = 0.45; // #252 — match params[].default (was 0.5)
      const r0 = Math.hypot(x, y);
      const r_eps = r0 + 1e-10;
      const sina = x / r_eps, cosa = y / r_eps;
      const dx = val * val + 1e-10;
      const r = r0 - 2.0 * dx * Math.trunc((r0 + dx) / (2.0 * dx)) + r0 * (1.0 - dx);
      return [sina * r, cosa * r];
    },
  },
  {
    idx: V.fan2,
    name: 'fan2',
    source: sourceForIdx(V.fan2),
    formula: 'V_{33}(x, y) = r\\,(\\sin a,\\; \\cos a),\\; dx = \\pi(x^2+\\epsilon),\\; a = \\phi \\pm dx/2',
    blurb: 'Fan with explicit x/y parameters (vs reading the xform affine). x sets the wedge width, y the rotational offset. Axes swap vs fan.',
    params: [
      { name: 'x', default: 0.5, min: -3, max: 3, step: 0.05 },
      { name: 'y', default: 0.5, min: -3, max: 3, step: 0.05 },
    ],
    warpFn: (X, Y) => {
      const x = 0.5, y = 0.5;
      const phi = Math.atan2(X, Y);
      const r = Math.hypot(X, Y);
      const dx = Math.PI * (x * x + 1e-10);
      const dx2 = 0.5 * dx;
      const t = phi + y - dx * Math.trunc((phi + y) / dx);
      const a = t > dx2 ? phi - dx2 : phi + dx2;
      return [r * Math.sin(a), r * Math.cos(a)];
    },
  },
  {
    idx: V.perspective,
    name: 'perspective',
    source: sourceForIdx(V.perspective),
    formula: 'V_{34}(x, y) = \\tfrac{1}{d - y\\sin\\theta}\\,(d\\,x,\\; d\\cos\\theta\\,y),\\; \\theta = \\tfrac{\\pi}{2}\\,\\mathrm{angle}',
    blurb: 'Projects the plane through a virtual camera tilted by angle, at distance dist. Lower edges recede; upper edges loom — classic perspective foreshortening.',
    params: [
      { name: 'angle', default: 0.24, min: -1, max: 1, step: 0.02 },
      { name: 'dist',  default: 1,    min: -5, max: 5, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const angle = 0.24, dist = 1;
      const ha = angle * (Math.PI * 0.5);
      const vsin = Math.sin(ha);
      const vfcos = dist * Math.cos(ha);
      const t = 1.0 / (dist - y * vsin);
      return [dist * x * t, vfcos * y * t];
    },
  },
  {
    idx: V.bipolar,
    name: 'bipolar',
    source: sourceForIdx(V.bipolar),
    formula: 'V_{35}(x, y) = \\tfrac{2}{\\pi}\\,\\big(\\tfrac{1}{4}\\ln\\tfrac{t+2x}{t-2x},\\; \\tfrac{1}{2}\\mathrm{atan2}(2y, x^2+y^2-1) - \\tfrac{\\pi}{2}\\,\\mathrm{shift}\\big),\\; t = x^2+y^2+1',
    blurb: 'Bipolar coordinates — maps the plane onto two foci. A log-warped horizontal slab plus angular wrapping; the shift parameter rolls the angular phase.',
    params: [
      { name: 'shift', default: 0, min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const shift = 0;
      const HALF_PI = Math.PI * 0.5;
      const TWO_OVER_PI = 2.0 / Math.PI;
      const x2y2 = x * x + y * y;
      const t = x2y2 + 1.0;
      const x2 = 2.0 * x;
      const ps = -HALF_PI * shift;
      let yo = 0.5 * Math.atan2(2.0 * y, x2y2 - 1.0) + ps;
      if (yo > HALF_PI) yo = -HALF_PI + ((yo + HALF_PI) % Math.PI);
      else if (yo < -HALF_PI) yo = HALF_PI - ((HALF_PI - yo) % Math.PI);
      return [0.25 * TWO_OVER_PI * Math.log((t + x2) / (t - x2)), TWO_OVER_PI * yo];
    },
  },
  {
    idx: V.curl,
    name: 'curl',
    source: sourceForIdx(V.curl),
    formula: 'V_{36}(x, y) = \\tfrac{1}{R^2+I^2}\\,(xR + yI,\\; yR - xI),\\; R = 1 + c_1 x + c_2(x^2 - y^2),\\; I = c_1 y + 2c_2 xy',
    blurb: 'Complex-rational warp parameterised by linear and quadratic curl coefficients. Bends the plane around without singularities — used to add organic twist to chains.',
    params: [
      { name: 'c1', default: 1, min: -2, max: 2, step: 0.05 },
      { name: 'c2', default: 0, min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const c1 = 1, c2 = 0;
      const re = 1.0 + c1 * x + c2 * (x * x - y * y);
      const im = c1 * y + 2.0 * c2 * x * y;
      const r = 1.0 / (re * re + im * im);
      return [(x * re + y * im) * r, (y * re - x * im) * r];
    },
  },
  {
    idx: V.rectangles,
    name: 'rectangles',
    source: sourceForIdx(V.rectangles),
    formula: 'V_{37}(x, y) = ((2\\lfloor x/p_x\\rfloor + 1)p_x - x,\\; (2\\lfloor y/p_y\\rfloor + 1)p_y - y)',
    blurb: 'Tiles the plane into rectangular cells and mirrors each cell about its center. Zero on an axis is pass-through; otherwise produces a hard grid of reflected tiles.',
    params: [
      { name: 'x', default: 1, min: -3, max: 3, step: 0.05 },
      { name: 'y', default: 1, min: -3, max: 3, step: 0.05 },
    ],
    warpFn: (X, Y) => {
      const px = 1, py = 1;
      const ox = (2.0 * Math.floor(X / px) + 1.0) * px - X;
      const oy = (2.0 * Math.floor(Y / py) + 1.0) * py - Y;
      return [ox, oy];
    },
  },
  {
    idx: V.blob,
    name: 'blob',
    source: sourceForIdx(V.blob),
    formula: 'V_{38}(x, y) = r\\,(\\sin\\alpha,\\; \\cos\\alpha),\\; r = r_0\\big(\\text{low} + (\\text{high}-\\text{low})\\,\\tfrac{1+\\sin(\\text{waves}\\cdot \\phi)}{2}\\big)',
    blurb: 'Modulates the radius by a sinusoid of the polar angle — produces lobed, blob-like attractors with a controllable number of waves.',
    params: [
      { name: 'low',   default: 0.30, min: 0, max: 2, step: 0.05 },
      { name: 'high',  default: 1.30, min: 0, max: 2, step: 0.05 },
      { name: 'waves', default: 5,    min: 1, max: 16, step: 1 },
    ],
    warpFn: (x, y) => {
      const low = 0.3, high = 1.3, waves = 5;
      const r0 = Math.hypot(x, y);
      const r_eps = r0 + 1e-10;
      const sina = x / r_eps, cosa = y / r_eps;
      const a = Math.atan2(x, y);
      const r = r0 * (low + (high - low) * (0.5 + 0.5 * Math.sin(waves * a)));
      return [sina * r, cosa * r];
    },
  },
  {
    idx: V.ngon,
    name: 'ngon',
    source: sourceForIdx(V.ngon),
    formula: 'V_{39}(x, y) = \\mathrm{amp}\\,(x, y),\\; \\mathrm{amp} = \\tfrac{\\text{corners}(1/\\cos\\phi - 1) + \\text{circle}}{r^{\\text{power}}}',
    blurb: 'N-sided polygonal attractor — bends the plane onto a regular polygon\'s symmetry. corners controls vertex spikiness; circle blends toward a smooth disc.',
    params: [
      { name: 'sides',   default: 5, min: 2, max: 16, step: 1 },
      { name: 'power',   default: 3, min: -10, max: 10, step: 0.1 },
      { name: 'circle',  default: 1, min: -2, max: 2, step: 0.05 },
      { name: 'corners', default: 2, min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const sides = 5, power = 3, circle = 1, corners = 2;
      const sumsq = x * x + y * y;
      const r_factor = Math.pow(sumsq, power / 2.0);
      const theta = Math.atan2(y, x);
      const b = (2 * Math.PI) / sides;
      let phi = theta - b * Math.floor(theta / b);
      if (phi > b / 2) phi -= b;
      const amp = (corners * (1.0 / (Math.cos(phi) + 1e-10) - 1.0) + circle) / (r_factor + 1e-10);
      return [x * amp, y * amp];
    },
  },
  {
    idx: V.wedge,
    name: 'wedge',
    source: sourceForIdx(V.wedge),
    formula: 'V_{40}(x, y) = (r + \\text{hole})\\,(\\cos a,\\; \\sin a),\\; a = (\\phi + \\text{swirl}\\cdot r)(1 - \\tfrac{\\text{angle}\\cdot\\text{count}}{2\\pi}) + c\\cdot\\text{angle}',
    blurb: 'Polar wedges with adjustable angle, count, and a central hole. swirl tilts each wedge along its radial axis — produces fan-blade attractors.',
    params: [
      { name: 'angle', default: 0.01, min: -Math.PI, max: Math.PI, step: 0.05 },
      { name: 'hole',  default: 0.24, min: -1, max: 1, step: 0.02 },
      { name: 'count', default: 1,    min: 1, max: 16, step: 1 },
      { name: 'swirl', default: 0.20, min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const angle = 0.01, hole = 0.24, count = 1, swirl = 0.20;
      const r0 = Math.hypot(x, y);
      let a = Math.atan2(y, x) + swirl * r0;
      const ONE_OVER_PI = 1.0 / Math.PI;
      const c = Math.floor((count * a + Math.PI) * ONE_OVER_PI * 0.5);
      const comp_fac = 1 - angle * count * ONE_OVER_PI * 0.5;
      a = a * comp_fac + c * angle;
      const r = r0 + hole;
      return [r * Math.cos(a), r * Math.sin(a)];
    },
  },
  {
    idx: V.cpow,
    name: 'cpow',
    source: sourceForIdx(V.cpow),
    formula: 'V_{41}(x, y) = e^{c\\ln r - d\\,\\phi}\\,(\\cos\\theta,\\; \\sin\\theta),\\; \\phi = \\mathrm{atan2}(y, x),\\; \\theta = c\\,\\phi + d\\ln r + \\tfrac{2\\pi n}{\\text{power}},\\; c = r_{\\text{param}}/\\text{power},\\; d = i_{\\text{param}}/\\text{power},\\; n \\in [0, |\\text{power}|)',
    blurb: 'Complex power r^(c+di) with random angular branching. Generates logarithmic-spiral attractors; r/i set the complex exponent\'s real/imag parts, power the branch count.',
    params: [
      { name: 'r',     default: 1, min: -3, max: 3, step: 0.05 },
      { name: 'i',     default: 0, min: -3, max: 3, step: 0.05 },
      { name: 'power', default: 2, min: -10, max: 10, step: 1 },
    ],
    warpFn: (x, y) => {
      const r_p = 1, i_p = 0, power = 2;
      const a = Math.atan2(y, x);
      const sumsq = x * x + y * y;
      const lnr = 0.5 * Math.log(sumsq);
      const vc = r_p / power;
      const vd = i_p / power;
      const ang = vc * a + vd * lnr; // branch 0
      const m = Math.exp(vc * lnr - vd * a);
      return [m * Math.cos(ang), m * Math.sin(ang)];
    },
  },
  {
    idx: V.curve,
    name: 'curve',
    source: sourceForIdx(V.curve),
    formula: 'V_{42}(x, y) = (\\,x + x_a e^{-y^2/x_l^2},\\; y + y_a e^{-x^2/y_l^2}\\,)',
    blurb: 'Adds Gaussian-falloff bumps along each axis — produces gentle bulges parameterized independently per axis. Good for adding organic, non-singular curl.',
    params: [
      { name: 'xamp',    default: 0.20, min: -2, max: 2, step: 0.05 },
      { name: 'yamp',    default: 0.20, min: -2, max: 2, step: 0.05 },
      { name: 'xlength', default: 0.30, min: 0.05, max: 5, step: 0.05 },
      { name: 'ylength', default: 0.30, min: 0.05, max: 5, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const xamp = 0.2, yamp = 0.2, xlen = 0.3, ylen = 0.3;
      const pc_xlen = Math.max(xlen * xlen, 1e-20);
      const pc_ylen = Math.max(ylen * ylen, 1e-20);
      return [
        x + xamp * Math.exp((-y * y) / pc_xlen),
        y + yamp * Math.exp((-x * x) / pc_ylen),
      ];
    },
  },
  // RNG-driven (no warpFn).
  {
    idx: V.noise,
    name: 'noise',
    source: sourceForIdx(V.noise),
    formula: 'V_{43}(x, y) = r_1\\,(x\\cos\\theta,\\; y\\sin\\theta),\\; \\theta = 2\\pi r_0',
    blurb: 'Scatters each input radially by a random factor along a random angle. A pure noise-cloud generator — useful for soft glows and blur passes.',
  },
  {
    idx: V.blur,
    name: 'blur',
    source: sourceForIdx(V.blur),
    formula: 'V_{44}(x, y) = r_1\\,(\\cos\\theta,\\; \\sin\\theta),\\; \\theta = 2\\pi r_0',
    blurb: 'Generates a uniform disc of radius w, independent of input position. The simplest blur source — useful for filling soft background fields.',
  },
  {
    idx: V.gaussian_blur,
    name: 'gaussian_blur',
    source: sourceForIdx(V.gaussian_blur),
    formula: 'V_{45}(x, y) = w\\,(r_1+r_2+r_3+r_4-2)\\,(\\cos\\theta,\\; \\sin\\theta),\\; \\theta = 2\\pi r_5,\\; r_{1..5} \\sim U[0, 1)',
    blurb: 'Gaussian-distributed scatter around origin via central limit theorem (sum of four uniform [0,1) minus 2). Produces a soft, bell-shaped cloud.',
  },
  {
    idx: V.arch,
    name: 'arch',
    source: sourceForIdx(V.arch),
    formula: 'V_{46}(x, y) = w\\,(\\sin\\alpha,\\; \\sin^2\\alpha / \\cos\\alpha),\\; \\alpha = w\\,\\pi\\,r_0,\\; r_0 \\sim U[0,1)',
    blurb: 'Draws random arches via sin and tan-shaped scaling. The output traces tan-singular arch curves — bright at sin·tan singularities.',
  },
  {
    idx: V.radial_blur,
    name: 'radial_blur',
    source: sourceForIdx(V.radial_blur),
    formula: 'V_{47}(x, y) = r\\,(\\cos(\\phi + s\\cdot G),\\; \\sin(\\phi + s\\cdot G)) + (z\\cdot G - 1)\\,(x,y),\\; s = \\sin(\\tfrac{\\pi}{2}\\text{angle}),\\; z = \\cos(\\tfrac{\\pi}{2}\\text{angle}),\\; G = w\\,(u_1+u_2+u_3+u_4 - 2)',
    blurb: 'Tangential + radial Gaussian blur — angle controls the spin/zoom ratio. A staple flame finisher that softens hard structure without destroying it.',
    params: [
      { name: 'angle', default: 0, min: -1, max: 1, step: 0.02 },
    ],
  },
  // juliascope deterministic branch-0 warp.
  {
    idx: V.juliascope,
    name: 'juliascope',
    source: sourceForIdx(V.juliascope),
    formula: 'V_{48}(x, y) = r\\,(\\cos\\theta,\\; \\sin\\theta),\\; \\theta = \\tfrac{\\pm\\phi + 2\\pi n}{\\text{power}},\\; r = (x^2+y^2)^{\\text{dist}/(2\\,\\text{power})}',
    blurb: 'Like julian, but the parity of the random branch flips the sign of the input angle — produces mirrored fractal lobes the regular julian can\'t reach.',
    params: [
      { name: 'power', default: 2, min: -10, max: 10, step: 1 },
      { name: 'dist',  default: 1, min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const power = 2, dist = 1;
      const phi = Math.atan2(y, x);
      const sumsq = x * x + y * y;
      // Branch t_rnd=0 — even, so the (t_rnd & 1) === 0 path applies.
      const tmpr = phi / power;
      const r = Math.pow(sumsq, dist / power / 2.0);
      return [r * Math.cos(tmpr), r * Math.sin(tmpr)];
    },
  },
  {
    idx: V.square,
    name: 'square',
    source: sourceForIdx(V.square),
    formula: 'V_{49}(x, y) = (r_0 - 0.5,\\; r_1 - 0.5)',
    blurb: 'Generates a uniform square of side w, independent of input position. The cartesian analogue of blur — fills a flat tile.',
  },
  {
    idx: V.rays,
    name: 'rays',
    source: sourceForIdx(V.rays),
    formula: 'V_{50}(x, y) = \\tan(\\pi w r_0) \\cdot \\tfrac{w^2}{r^2+\\epsilon}\\,(\\cos x,\\; \\sin y),\\; r_0 \\sim U[0,1)',
    blurb: 'Beam-like radial rays at random angles, scaled by 1/r². Produces god-ray attractors radiating from the origin.',
  },
  {
    idx: V.blade,
    name: 'blade',
    source: sourceForIdx(V.blade),
    formula: 'V_{51}(x, y) = x\\,(\\cos r + \\sin r,\\; \\cos r - \\sin r),\\; r = w r_0 \\sqrt{x^2+y^2}',
    blurb: 'Sinusoidally folds at random scaled radii — slices the plane into knife-edge bands. The y output reads x (not y); intentional flam3 behavior.',
  },
  {
    idx: V.twintrian,
    name: 'twintrian',
    source: sourceForIdx(V.twintrian),
    formula: 'V_{52}(x, y) = x\\,(d,\\; d - \\pi \\sin r),\\; d = \\log_{10}\\sin^2 r + \\cos r',
    blurb: 'Two-arm trigonal attractor with log-decade falloff. Like blade with a logarithmic envelope — produces twisted, glowy arms.',
  },
  // Batch E transcendentals — V53..V66.
  {
    idx: V.exp,
    name: 'exp',
    source: sourceForIdx(V.exp),
    formula: 'V_{53}(x, y) = e^x\\,(\\cos y,\\; \\sin y)',
    blurb: 'Plain complex exponential — different from V24 exponential (which adds (x−1) shift + π·y scaling). Produces exponentially flared lobes.',
    warpFn: (x, y) => {
      const e = Math.exp(x);
      return [e * Math.cos(y), e * Math.sin(y)];
    },
  },
  {
    idx: V.log,
    name: 'log',
    source: sourceForIdx(V.log),
    formula: 'V_{54}(x, y) = (\\tfrac{1}{2}\\ln(x^2+y^2),\\; \\mathrm{atan2}(y, x))',
    blurb: 'Complex logarithm — wraps the plane onto an infinite vertical strip. Inverse companion to V53 exp.',
    warpFn: (x, y) => {
      const sumsq = x * x + y * y + 1e-10;
      return [0.5 * Math.log(sumsq), Math.atan2(y, x)];
    },
  },
  {
    idx: V.sin,
    name: 'sin',
    source: sourceForIdx(V.sin),
    formula: 'V_{55}(x, y) = (\\sin x \\cosh y,\\; \\cos x \\sinh y)',
    blurb: 'Complex sine. Periodic horizontally, exponentially expanding vertically — produces braided sinusoidal strands.',
    warpFn: (x, y) => [Math.sin(x) * Math.cosh(y), Math.cos(x) * Math.sinh(y)],
  },
  {
    idx: V.cos,
    name: 'cos',
    source: sourceForIdx(V.cos),
    formula: 'V_{56}(x, y) = (\\cos x \\cosh y,\\; -\\sin x \\sinh y)',
    blurb: 'Complex cosine — 90° phase shift of V55 sin. Same braided periodic-meets-hyperbolic structure.',
    warpFn: (x, y) => [Math.cos(x) * Math.cosh(y), -Math.sin(x) * Math.sinh(y)],
  },
  {
    idx: V.tan,
    name: 'tan',
    source: sourceForIdx(V.tan),
    formula: 'V_{57}(x, y) = \\tfrac{1}{\\cos 2x + \\cosh 2y}\\,(\\sin 2x,\\; \\sinh 2y)',
    blurb: 'Complex tangent. Singular along strips where cos(2x) ≈ −cosh(2y) — bad-value retry handles asymptotes. Distinct from V27 tangent (real ratio).',
    warpFn: (x, y) => {
      const den = 1.0 / (Math.cos(2 * x) + Math.cosh(2 * y));
      return [den * Math.sin(2 * x), den * Math.sinh(2 * y)];
    },
  },
  {
    idx: V.sec,
    name: 'sec',
    source: sourceForIdx(V.sec),
    formula: 'V_{58}(x, y) = \\tfrac{2}{\\cos 2x + \\cosh 2y}\\,(\\cos x \\cosh y,\\; \\sin x \\sinh y)',
    blurb: 'Complex secant — reciprocal of complex cosine. Periodic horizontal bands with vertical hyperbolic expansion.',
    warpFn: (x, y) => {
      const den = 2.0 / (Math.cos(2 * x) + Math.cosh(2 * y));
      return [den * Math.cos(x) * Math.cosh(y), den * Math.sin(x) * Math.sinh(y)];
    },
  },
  {
    idx: V.csc,
    name: 'csc',
    source: sourceForIdx(V.csc),
    formula: 'V_{59}(x, y) = \\tfrac{2}{\\cosh 2y - \\cos 2x}\\,(\\sin x \\cosh y,\\; -\\cos x \\sinh y)',
    blurb: 'Complex cosecant — reciprocal of complex sine. Sharp at the zeros of sin; smooth elsewhere.',
    warpFn: (x, y) => {
      const den = 2.0 / (Math.cosh(2 * y) - Math.cos(2 * x));
      return [den * Math.sin(x) * Math.cosh(y), -den * Math.cos(x) * Math.sinh(y)];
    },
  },
  {
    idx: V.cot,
    name: 'cot',
    source: sourceForIdx(V.cot),
    formula: 'V_{60}(x, y) = \\tfrac{1}{\\cosh 2y - \\cos 2x}\\,(\\sin 2x,\\; -\\sinh 2y)',
    blurb: 'Complex cotangent — reciprocal of complex tangent. Singular along the 1D line y=0 wherever sin(2x)=0 (x = nπ/2), since cosh(0) − cos(2x) = 1 − cos(2x) → 0 there; not a 2D lattice.',
    warpFn: (x, y) => {
      const den = 1.0 / (Math.cosh(2 * y) - Math.cos(2 * x));
      return [den * Math.sin(2 * x), -den * Math.sinh(2 * y)];
    },
  },
  {
    idx: V.sinh,
    name: 'sinh',
    source: sourceForIdx(V.sinh),
    formula: 'V_{61}(x, y) = (\\sinh x \\cos y,\\; \\cosh x \\sin y)',
    blurb: 'Complex hyperbolic sine. Exponentially expanding horizontally, periodic vertically — the hyperbolic dual of V55 sin.',
    warpFn: (x, y) => [Math.sinh(x) * Math.cos(y), Math.cosh(x) * Math.sin(y)],
  },
  {
    idx: V.cosh,
    name: 'cosh',
    source: sourceForIdx(V.cosh),
    formula: 'V_{62}(x, y) = (\\cosh x \\cos y,\\; \\sinh x \\sin y)',
    blurb: 'Complex hyperbolic cosine. 90° phase shift of V61 sinh — same hyperbolic-horizontal / periodic-vertical pattern.',
    warpFn: (x, y) => [Math.cosh(x) * Math.cos(y), Math.sinh(x) * Math.sin(y)],
  },
  {
    idx: V.tanh,
    name: 'tanh',
    source: sourceForIdx(V.tanh),
    formula: 'V_{63}(x, y) = \\tfrac{1}{\\cos 2y + \\cosh 2x}\\,(\\sinh 2x,\\; \\sin 2y)',
    blurb: 'Complex hyperbolic tangent. Saturates toward ±1 horizontally, periodic vertically.',
    warpFn: (x, y) => {
      const den = 1.0 / (Math.cos(2 * y) + Math.cosh(2 * x));
      return [den * Math.sinh(2 * x), den * Math.sin(2 * y)];
    },
  },
  {
    idx: V.sech,
    name: 'sech',
    source: sourceForIdx(V.sech),
    formula: 'V_{64}(x, y) = \\tfrac{2}{\\cos 2y + \\cosh 2x}\\,(\\cos y \\cosh x,\\; -\\sin y \\sinh x)',
    blurb: 'Complex hyperbolic secant — reciprocal of cosh. Sharp pillars along the y axis, soft falloff outward.',
    warpFn: (x, y) => {
      const den = 2.0 / (Math.cos(2 * y) + Math.cosh(2 * x));
      return [den * Math.cos(y) * Math.cosh(x), -den * Math.sin(y) * Math.sinh(x)];
    },
  },
  {
    idx: V.csch,
    name: 'csch',
    source: sourceForIdx(V.csch),
    formula: 'V_{65}(x, y) = \\tfrac{2}{\\cosh 2x - \\cos 2y}\\,(\\sinh x \\cos y,\\; -\\cosh x \\sin y)',
    blurb: 'Complex hyperbolic cosecant — reciprocal of sinh. Singular at the origin; periodic shifts vertically.',
    warpFn: (x, y) => {
      const den = 2.0 / (Math.cosh(2 * x) - Math.cos(2 * y));
      return [den * Math.sinh(x) * Math.cos(y), -den * Math.cosh(x) * Math.sin(y)];
    },
  },
  {
    idx: V.coth,
    name: 'coth',
    source: sourceForIdx(V.coth),
    formula: 'V_{66}(x, y) = \\tfrac{1}{\\cosh 2x - \\cos 2y}\\,(\\sinh 2x,\\; \\sin 2y)',
    blurb: 'Complex hyperbolic cotangent — reciprocal of tanh. Asymptotes to ±1; singular at the periodic zeros of sinh.',
    warpFn: (x, y) => {
      const den = 1.0 / (Math.cosh(2 * x) - Math.cos(2 * y));
      return [den * Math.sinh(2 * x), den * Math.sin(2 * y)];
    },
  },
  // Batch F — 0-param.
  {
    idx: V.butterfly,
    name: 'butterfly',
    source: sourceForIdx(V.butterfly),
    formula: 'V_{67}(x, y) = k\\,(x,\\; 2y),\\; k = \\tfrac{4}{\\sqrt{3\\pi}}\\sqrt{|xy|/(x^2+4y^2)}',
    blurb: 'Butterfly-shaped attractor — pinched along the x axis with a flam3 magic-normalization constant. Produces a clean lemniscate silhouette.',
    warpFn: (x, y) => {
      const wx = 1.3029400317411197908970256609023;
      const y2 = y * 2.0;
      const r = wx * Math.sqrt(Math.abs(y * x) / (1e-10 + x * x + y2 * y2));
      return [r * x, r * y2];
    },
  },
  {
    idx: V.edisc,
    name: 'edisc',
    source: sourceForIdx(V.edisc),
    formula: 'V_{68}(x, y) = \\tfrac{1}{11.57}\\,(\\cosh u \\cos v,\\; \\sinh u \\sin v),\\; (u, v) = \\text{elliptic disc coords}',
    blurb: 'Elliptic disc — wraps the plane onto bispherical coordinates. The flam3 magic constant 11.57 normalizes to unit disc; produces a soft ellipsoidal warp.',
    warpFn: (x, y) => {
      const sumsq = x * x + y * y;
      const tmp = sumsq + 1.0;
      const tmp2 = 2.0 * x;
      const r1 = Math.sqrt(tmp + tmp2);
      const r2 = Math.sqrt(Math.max(tmp - tmp2, 0));
      const xmax = (r1 + r2) * 0.5;
      const a1 = Math.log(xmax + Math.sqrt(Math.max(xmax - 1.0, 0)));
      const a2 = -Math.acos(Math.max(-1, Math.min(1, x / xmax)));
      const w = 1.0 / 11.57034632;
      let snv = Math.sin(a1);
      const csv = Math.cos(a1);
      const snhu = Math.sinh(a2);
      const cshu = Math.cosh(a2);
      if (y > 0.0) snv = -snv;
      return [w * cshu * csv, w * snhu * snv];
    },
  },
  {
    idx: V.elliptic,
    name: 'elliptic',
    source: sourceForIdx(V.elliptic),
    formula: 'V_{69}(x, y) = \\tfrac{2}{\\pi}\\,(\\mathrm{atan2}(x/x_\\text{max},\\, \\sqrt{b}),\\; \\pm\\ln(x_\\text{max} + \\sqrt{x_\\text{max}-1})),\\; x_\\text{max} = \\tfrac{1}{2}(\\sqrt{(r^2+1)+2x} + \\sqrt{(r^2+1)-2x}),\\; b = 1 - (x/x_\\text{max})^2,\\; r^2 = x^2 + y^2,\\; \\text{sign} = \\text{sign}(y)',
    blurb: 'Elliptic coordinates — maps the plane to a half-strip via Jacobi-elliptic functions. Sign of y picks the upper/lower branch.',
    warpFn: (x, y) => {
      const sumsq = x * x + y * y;
      const tmp = sumsq + 1.0;
      const x2 = 2.0 * x;
      const xmax = 0.5 * (Math.sqrt(tmp + x2) + Math.sqrt(Math.max(tmp - x2, 0)));
      const a = x / xmax;
      const b_raw = 1.0 - a * a;
      const ssx_raw = xmax - 1.0;
      const b = b_raw < 0 ? 0 : Math.sqrt(b_raw);
      const ssx = ssx_raw < 0 ? 0 : Math.sqrt(ssx_raw);
      const w = 1.0 / (Math.PI * 0.5);
      const yLog = w * Math.log(xmax + ssx);
      return [w * Math.atan2(a, b), y > 0 ? yLog : -yLog];
    },
  },
  {
    idx: V.foci,
    name: 'foci',
    source: sourceForIdx(V.foci),
    formula: 'V_{70}(x, y) = \\tfrac{1}{e^x/2 + e^{-x}/2 - \\cos y}\\,((e^x - e^{-x})/2,\\; \\sin y)',
    blurb: 'Bipolar coordinates centered on two foci. Pinches the plane between two points; produces almond-shaped attractors.',
    warpFn: (x, y) => {
      const expx = Math.exp(x) * 0.5;
      const expnx = 0.25 / expx;
      const tmp = 1.0 / (expx + expnx - Math.cos(y));
      return [tmp * (expx - expnx), tmp * Math.sin(y)];
    },
  },
  {
    idx: V.loonie,
    name: 'loonie',
    source: sourceForIdx(V.loonie),
    formula: 'V_{71}(x, y) = \\begin{cases} \\sqrt{w^2/r^2 - 1}\\,(x, y) & r < w \\\\ (x, y) & \\text{else}\\end{cases}',
    blurb: 'Inverts the unit disc onto itself via a circular branch. Inside the disc gets pulled outward; outside passes through — produces a sharp circular cutout.',
    warpFn: (x, y) => {
      const r2 = x * x + y * y;
      const w2 = 1.0;
      if (r2 < w2 && r2 > 0) {
        const r = Math.sqrt(w2 / r2 - 1.0);
        return [r * x, r * y];
      }
      return [x, y];
    },
  },
  {
    idx: V.polar2,
    name: 'polar2',
    source: sourceForIdx(V.polar2),
    formula: 'V_{72}(x, y) = \\tfrac{1}{\\pi}\\,(\\mathrm{atan2}(x, y),\\; \\tfrac{1}{2}\\ln(x^2+y^2))',
    blurb: 'Like polar but the radial output is log r rather than r−1. Stretches large-radius input far less; tight near the origin.',
    warpFn: (x, y) => {
      const sumsq = x * x + y * y;
      const p2v = 1.0 / Math.PI;
      return [p2v * Math.atan2(x, y), (p2v / 2.0) * Math.log(sumsq + 1e-10)];
    },
  },
  {
    idx: V.scry,
    name: 'scry',
    source: sourceForIdx(V.scry),
    formula: 'V_{73}(x, y) = \\tfrac{1}{r(r^2 + 1/w)}\\,(x, y)',
    blurb: 'Crystal-ball scry inversion. Strongly compresses points outside the unit circle, leaving the inside mostly intact — produces glassy lens distortion.',
    warpFn: (x, y) => {
      const sumsq = x * x + y * y;
      const sqrtSumsq = Math.sqrt(sumsq);
      const w = 1;
      const r = 1.0 / (sqrtSumsq * (sumsq + 1.0 / (w + 1e-10)) + 1e-10);
      return [x * r, y * r];
    },
  },
  // Batch G — 1-2 param.
  {
    idx: V.bent2,
    name: 'bent2',
    source: sourceForIdx(V.bent2),
    formula: 'V_{74}(x, y) = (\\,x<0?\\,x\\cdot x_p:x,\\; y<0?\\,y\\cdot y_p:y\\,)',
    blurb: 'Parameterized bent — x and y scale factors apply only to negative inputs. Generalizes V15 bent\'s fixed (2, 0.5) scaling.',
    params: [
      { name: 'x', default: 1.35, min: -3, max: 3, step: 0.05 },
      { name: 'y', default: 1.35, min: -3, max: 3, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const bx = 1.35, by = 1.35;
      const nx = x < 0 ? x * bx : x;
      const ny = y < 0 ? y * by : y;
      return [nx, ny];
    },
  },
  {
    idx: V.cell,
    name: 'cell',
    source: sourceForIdx(V.cell),
    formula: 'V_{75}(x, y) = (\\Delta_x + X\\cdot \\text{size},\\; -(\\Delta_y + Y\\cdot \\text{size}))',
    blurb: 'Tiles the plane into cells of fixed size and reshuffles each cell to a new global position based on signed quadrant. Produces a checkerboard-shuffle tiling.',
    // User-curated: weight=0.07 + size=0.40 — the natural showcase weight
    // for cell is small (full-weight cell at default size produces a
    // single bright stamp; the mix with linear at small weight shows the
    // tile-shuffle structure clearly).
    defaultWeight: 0.07,
    params: [
      { name: 'size', default: 0.40, min: 0.1, max: 4, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const size = 0.40;
      const inv = 1.0 / size;
      let X = Math.floor(x * inv);
      let Y = Math.floor(y * inv);
      const dx = x - X * size;
      const dy = y - Y * size;
      if (Y >= 0) {
        if (X >= 0) { Y *= 2; X *= 2; } else { Y *= 2; X = -(2 * X + 1); }
      } else {
        if (X >= 0) { Y = -(2 * Y + 1); X *= 2; } else { Y = -(2 * Y + 1); X = -(2 * X + 1); }
      }
      return [dx + X * size, -(dy + Y * size)];
    },
  },
  {
    idx: V.escher,
    name: 'escher',
    source: sourceForIdx(V.escher),
    formula: 'V_{76}(x, y) = e^{v_c \\ln r - v_d \\phi}\\,(\\cos\\theta,\\; \\sin\\theta),\\; \\phi = \\mathrm{atan2}(y, x),\\; \\theta = v_c\\,\\phi + v_d \\ln r,\\; v_c = (1+\\cos\\beta)/2,\\; v_d = \\sin\\beta/2',
    blurb: 'Escher-style logarithmic spiral parameterised by beta. Like cpow but without the random branch — produces a single, deterministic spiral arm.',
    params: [
      { name: 'beta', default: -0.49, min: -Math.PI, max: Math.PI, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const beta = -0.49;
      const a = Math.atan2(y, x);
      const sumsq = x * x + y * y + 1e-10;
      const lnr = 0.5 * Math.log(sumsq);
      const seb = Math.sin(beta);
      const ceb = Math.cos(beta);
      const vc = 0.5 * (1.0 + ceb);
      const vd = 0.5 * seb;
      const m = Math.exp(vc * lnr - vd * a);
      const n = vc * a + vd * lnr;
      return [m * Math.cos(n), m * Math.sin(n)];
    },
  },
  {
    idx: V.modulus,
    name: 'modulus',
    source: sourceForIdx(V.modulus),
    formula: 'V_{77}(x, y) = (f(x, x_p),\\; f(y, y_p)),\\; f(t, p) = \\begin{cases} t - 2p\\lfloor(t+p)/(2p)\\rfloor & |t| > p \\\\ t & |t| \\le p \\end{cases}',
    blurb: 'Wraps each coordinate into a parameterized strip. Outside the strip, mirrors back inward — like a sawtooth on each axis.',
    params: [
      { name: 'x', default: 0.65, min: 0.05, max: 3, step: 0.05 },
      { name: 'y', default: 0.25, min: 0.05, max: 3, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const mx = 0.65, my = 0.25;
      const xr = 2 * mx, yr = 2 * my;
      let outX: number;
      if (x > mx) outX = -mx + ((x + mx) % xr);
      else if (x < -mx) outX = mx - ((mx - x) % xr);
      else outX = x;
      let outY: number;
      if (y > my) outY = -my + ((y + my) % yr);
      else if (y < -my) outY = my - ((my - y) % yr);
      else outY = y;
      return [outX, outY];
    },
  },
  {
    idx: V.split,
    name: 'split',
    source: sourceForIdx(V.split),
    formula: 'V_{78}(x, y) = (\\pm x,\\; \\pm y),\\; \\text{sign by } \\cos(x x_s\\pi)\\text{ and }\\cos(y y_s\\pi)',
    blurb: 'Flips the sign of each axis based on the sign of cos on the other axis × π × size. Produces hard-edge symmetric tilings.',
    params: [
      { name: 'xsize', default: -0.80, min: -3, max: 3, step: 0.05 },
      { name: 'ysize', default: -0.80, min: -3, max: 3, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const xs = -0.8, ys = -0.8;
      const outY = Math.cos(x * xs * Math.PI) >= 0 ? y : -y;
      const outX = Math.cos(y * ys * Math.PI) >= 0 ? x : -x;
      return [outX, outY];
    },
  },
  {
    idx: V.splits,
    name: 'splits',
    source: sourceForIdx(V.splits),
    formula: 'V_{79}(x, y) = (\\,x \\pm x_p,\\; y \\pm y_p\\,)',
    blurb: 'Pushes each axis outward by ±param based on sign. Splits the plane into four quadrants spaced apart — leaves a gap at the origin.',
    params: [
      { name: 'x', default: 0.15, min: -2, max: 2, step: 0.05 },
      { name: 'y', default: 0.15, min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const sx = 0.15, sy = 0.15;
      const outX = x >= 0 ? x + sx : x - sx;
      const outY = y >= 0 ? y + sy : y - sy;
      return [outX, outY];
    },
  },
  {
    idx: V.stripes,
    name: 'stripes',
    source: sourceForIdx(V.stripes),
    formula: 'V_{80}(x, y) = (\\,\\delta_x(1-s) + \\lfloor x\\rceil,\\; y + \\delta_x^2 \\cdot w\\,),\\; \\delta_x = x - \\lfloor x\\rceil',
    blurb: 'Snaps x to the nearest integer with a compressible offset; warps y by the square of that offset. Produces vertical stripe attractors.',
    params: [
      { name: 'space', default: -0.58, min: -1, max: 1, step: 0.02 },
      { name: 'warp',  default: 0.30,  min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const space = -0.58, warp = 0.30;
      const roundx = Math.floor(x + 0.5);
      const offsetx = x - roundx;
      return [offsetx * (1.0 - space) + roundx, y + offsetx * offsetx * warp];
    },
  },
  {
    idx: V.whorl,
    name: 'whorl',
    source: sourceForIdx(V.whorl),
    formula: 'V_{81}(x, y) = w\\,r\\,(\\cos a,\\; \\sin a),\\; \\phi = \\mathrm{atan2}(y, x),\\; a = \\begin{cases} \\phi + \\text{inside}/(w - r) & r < w \\\\ \\phi + \\text{outside}/(w - r) & r \\ge w \\end{cases},\\; r = \\sqrt{x^2+y^2}',
    blurb: 'Radius-dependent angular twist with separate inside/outside knobs at the unit circle (r=1). Produces tight inner curls relaxing into wider outer spirals.',
    params: [
      { name: 'inside',  default: -0.10, min: -2, max: 2, step: 0.05 },
      { name: 'outside', default: -0.10, min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      // `threshold` is the unit-circle radius the WGSL kernel uses to
      // switch between inside/outside knobs — NOT the variation weight
      // (which the catalog applies separately via the genome). Avoid
      // calling this `w` so it doesn't alias with the WGSL `w` (weight).
      const inside = -0.10, outside = -0.10, threshold = 1;
      const r = Math.hypot(x, y);
      const baseAng = Math.atan2(y, x);
      const a = r < threshold
        ? baseAng + inside  / (threshold - r + 1e-10)
        : baseAng + outside / (threshold - r - 1e-10);
      return [r * Math.cos(a), r * Math.sin(a)];
    },
  },
  {
    idx: V.flux,
    name: 'flux',
    source: sourceForIdx(V.flux),
    formula: 'V_{82}(x, y) = \\bar{r}\\,(\\cos\\bar{a},\\; \\sin\\bar{a}),\\; \\bar{r} = (2+s)\\sqrt[4]{(y^2+(x+w)^2)/(y^2+(x-w)^2)}',
    blurb: 'Magnetic-flux-style splay around two foci on the x axis. spread controls the bulge factor — produces winged, flowing structure.',
    params: [
      { name: 'spread', default: -1.10, min: -3, max: 3, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const spread = -1.10, w = 1;
      const xpw = x + w, xmw = x - w;
      const tysq = y * y;
      const avgr = (2 + spread) * Math.sqrt(Math.sqrt(tysq + xpw * xpw) / Math.sqrt(tysq + xmw * xmw + 1e-10));
      const avga = (Math.atan2(y, xmw) - Math.atan2(y, xpw)) * 0.5;
      return [avgr * Math.cos(avga), avgr * Math.sin(avga)];
    },
  },
  // Batch H — 3-4 param.
  {
    idx: V.popcorn2,
    name: 'popcorn2',
    source: sourceForIdx(V.popcorn2),
    formula: 'V_{83}(x, y) = (\\,x + x_p\\sin(\\tan(y c)),\\; y + y_p\\sin(\\tan(x c))\\,)',
    blurb: 'Like V18 popcorn but with explicit amplitude and frequency parameters (vs reading the xform affine). c sets tan frequency.',
    params: [
      { name: 'x', default: 0.35, min: -2, max: 2, step: 0.05 },
      { name: 'y', default: 0.35, min: -2, max: 2, step: 0.05 },
      { name: 'c', default: 2.10, min: -5, max: 5, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const px = 0.35, py = 0.35, pc = 2.10;
      return [
        x + px * Math.sin(Math.tan(y * pc)),
        y + py * Math.sin(Math.tan(x * pc)),
      ];
    },
  },
  {
    idx: V.lazysusan,
    name: 'lazysusan',
    source: sourceForIdx(V.lazysusan),
    formula: 'V_{84}(x, y) = \\begin{cases} (r\\cos a + l_x,\\; r\\sin a - l_y) & r < w \\\\ ((1+\\text{space}/r)(x - l_x) + l_x,\\; (1+\\text{space}/r)(y + l_y) - l_y) & r \\ge w \\end{cases},\\; a = \\mathrm{atan2}(y - l_y, x - l_x) + \\text{spin} + \\text{twist}(w - r),\\; r = |(x - l_x, y + l_y)|',
    blurb: 'Spinning lazysusan platter centered at (x, y). Inside the disc r<w, rotates by spin+twist·(w−r); outside, pushes radially by space. Five params.',
    params: [
      { name: 'x',     default: 0,    min: -2, max: 2, step: 0.05 },
      { name: 'y',     default: 0,    min: -2, max: 2, step: 0.05 },
      { name: 'spin',  default: 0.16, min: -Math.PI, max: Math.PI, step: 0.05 },
      { name: 'twist', default: 0.21, min: -Math.PI, max: Math.PI, step: 0.05 },
      { name: 'space', default: 0,    min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const lx = 0, ly = 0, spin = 0.16, twist = 0.21, space = 0, w = 1;
      const X = x - lx, Y = y + ly;
      let r = Math.hypot(X, Y);
      if (r < w) {
        const a = Math.atan2(Y, X) + spin + twist * (w - r);
        r = r;
        return [r * Math.cos(a) + lx, r * Math.sin(a) - ly];
      }
      r = 1.0 + space / (r + 1e-10);
      return [r * X + lx, r * Y - ly];
    },
  },
  {
    idx: V.waves2,
    name: 'waves2',
    source: sourceForIdx(V.waves2),
    formula: 'V_{85}(x, y) = (\\,x + s_x\\sin(y f_x),\\; y + s_y\\sin(x f_y)\\,)',
    blurb: 'V16 waves with explicit scale + frequency parameters per axis. Decouples amplitude from the xform\'s affine, giving direct control over the texture.',
    params: [
      { name: 'scalex', default: 0.30, min: -2, max: 2, step: 0.05 },
      { name: 'freqx',  default: 1.20, min: 0,  max: 16, step: 0.1 },
      { name: 'scaley', default: 0.30, min: -2, max: 2, step: 0.05 },
      { name: 'freqy',  default: 1.20, min: 0,  max: 16, step: 0.1 },
    ],
    warpFn: (x, y) => {
      const sx = 0.30, fx = 1.20, sy = 0.30, fy = 1.20;
      return [x + sx * Math.sin(y * fx), y + sy * Math.sin(x * fy)];
    },
  },
  {
    idx: V.oscilloscope,
    name: 'oscilloscope',
    source: sourceForIdx(V.oscilloscope),
    formula: 'V_{86}(x, y) = (x,\\; \\pm y),\\; t = A\\cos(2\\pi f x) + s,\\; \\text{flip if } |y|\\le t',
    blurb: 'Threshold-flip y based on a damped oscillator trace t(x). Points inside the trace envelope flip vertically — produces an oscilloscope-like waveform mask.',
    params: [
      { name: 'frequency',  default: Math.PI, min: 0, max: 16, step: 0.1 },
      { name: 'amplitude',  default: 1, min: 0, max: 4, step: 0.05 },
      { name: 'damping',    default: 0, min: 0, max: 4, step: 0.05 },
      { name: 'separation', default: 1, min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const freq = Math.PI, amp = 1, damping = 0, sep = 1;
      const tpf = 2 * Math.PI * freq;
      const t = damping === 0
        ? amp * Math.cos(tpf * x) + sep
        : amp * Math.exp(-Math.abs(x) * damping) * Math.cos(tpf * x) + sep;
      return [x, Math.abs(y) <= t ? -y : y];
    },
  },
  {
    idx: V.separation,
    name: 'separation',
    source: sourceForIdx(V.separation),
    formula: 'V_{87}(x, y) = (\\,\\pm(\\sqrt{x^2+s_x^2} \\mp x x_i),\\; \\pm(\\sqrt{y^2+s_y^2} \\mp y y_i)\\,)',
    blurb: 'Pushes each axis outward from origin with a smooth radial offset — separation params control distance, inside params control inward pull on near-origin points.',
    params: [
      { name: 'x',        default: 0.10, min: -2, max: 2, step: 0.05 },
      { name: 'xinside',  default: 0,    min: -2, max: 2, step: 0.05 },
      { name: 'y',        default: 0.15, min: -2, max: 2, step: 0.05 },
      { name: 'yinside',  default: 0,    min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const sx = 0.10, sxi = 0, sy = 0.15, syi = 0;
      const sx2 = sx * sx, sy2 = sy * sy;
      const outX = x > 0
        ? Math.sqrt(x * x + sx2) - x * sxi
        : -(Math.sqrt(x * x + sx2) + x * sxi);
      const outY = y > 0
        ? Math.sqrt(y * y + sy2) - y * syi
        : -(Math.sqrt(y * y + sy2) + y * syi);
      return [outX, outY];
    },
  },
  {
    idx: V.auger,
    name: 'auger',
    source: sourceForIdx(V.auger),
    formula: 'V_{88}(x, y) = (\\,x + \\text{sym}(\\Delta_x - x),\\; \\Delta_y\\,)',
    blurb: 'Drill-bit auger — sinusoidally perturbs each axis with amplitude proportional to |coordinate|. freq sets pitch; sym blends between auger and pass-through on x.',
    params: [
      { name: 'freq',   default: 1,   min: 0, max: 8, step: 0.05 },
      { name: 'weight', default: 0.5, min: -2, max: 2, step: 0.05 },
      { name: 'scale',  default: 1,   min: -2, max: 2, step: 0.05 },
      { name: 'sym',    default: 0,   min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const freq = 1, ww = 0.5, scale = 1, sym = 0;
      const s = Math.sin(freq * x);
      const t = Math.sin(freq * y);
      const dy = y + ww * (scale * s / 2.0 + Math.abs(y) * s);
      const dx = x + ww * (scale * t / 2.0 + Math.abs(x) * t);
      return [x + sym * (dx - x), dy];
    },
  },
  {
    idx: V.wedge_sph,
    name: 'wedge_sph',
    source: sourceForIdx(V.wedge_sph),
    formula: 'V_{89}(x, y) = (1/r + \\text{hole})\\,(\\cos a,\\; \\sin a),\\; a \\text{ as in } V_{40}',
    blurb: 'Spherical-inversion wedge — V40 wedge but with 1/r instead of r. Produces wedge structure radiating outward from the origin rather than around it.',
    params: [
      { name: 'angle', default: 0, min: -Math.PI, max: Math.PI, step: 0.05 },
      { name: 'hole',  default: 0, min: -1, max: 1, step: 0.02 },
      { name: 'count', default: 1, min: 1, max: 16, step: 1 },
      { name: 'swirl', default: 0, min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      // #252 — match params[].default (angle=0, count=1); was angle=0.6, count=4.
      const angle = 0, hole = 0, count = 1, swirl = 0;
      const r0 = Math.hypot(x, y);
      const r_inv = 1.0 / (r0 + 1e-10);
      let a = Math.atan2(y, x) + swirl * r_inv;
      const ONE_OVER_PI = 1.0 / Math.PI;
      const c = Math.floor((count * a + Math.PI) * ONE_OVER_PI * 0.5);
      const comp_fac = 1 - angle * count * ONE_OVER_PI * 0.5;
      a = a * comp_fac + c * angle;
      const r = r_inv + hole;
      return [r * Math.cos(a), r * Math.sin(a)];
    },
  },
  // Batch I — RNG-driven 3-4 params (mostly no warpFn).
  {
    idx: V.super_shape,
    name: 'super_shape',
    source: sourceForIdx(V.super_shape),
    formula: 'V_{90}(x, y) = \\frac{(\\text{rnd}\\cdot r_0 + (1-\\text{rnd})r - \\text{holes})(|\\cos\\theta|^{n_2} + |\\sin\\theta|^{n_3})^{-1/n_1}}{r}(x, y)',
    blurb: 'Superformula attractor — Gielis\'s generalization of the n-sided polygon. Generates organic, flower- and shell-like silhouettes from six parameters.',
    params: [
      { name: 'rnd',   default: 0, min: 0, max: 1, step: 0.05 },
      { name: 'm',     default: 2, min: 0, max: 16, step: 0.5 },
      { name: 'n1',    default: 1, min: 0.1, max: 16, step: 0.1 },
      { name: 'n2',    default: 1, min: 0.1, max: 16, step: 0.1 },
      { name: 'n3',    default: 1, min: 0.1, max: 16, step: 0.1 },
      { name: 'holes', default: 0, min: -2, max: 2, step: 0.05 },
    ],
  },
  {
    idx: V.flower,
    name: 'flower',
    source: sourceForIdx(V.flower),
    formula: 'V_{91}(x, y) = \\tfrac{(r_0 - \\text{holes})\\cos(\\text{petals}\\,\\theta)}{r}(x, y)',
    blurb: 'Floral attractor — petals lobes around the origin, holes blanks the center. Pure RNG-modulated radial scaling.',
    params: [
      { name: 'petals', default: 3,     min: 0, max: 12, step: 1 },
      { name: 'holes',  default: -0.60, min: -2, max: 2, step: 0.05 },
    ],
  },
  {
    idx: V.conic,
    name: 'conic',
    source: sourceForIdx(V.conic),
    formula: 'V_{92}(x, y) = \\tfrac{(r_0 - \\text{holes})\\,\\text{ecc}}{(1 + \\text{ecc}\\,\\cos\\theta)\\,r}(x, y)',
    blurb: 'Conic-section attractor — eccentricity sets ellipse/parabola/hyperbola character. holes blanks the focus region.',
    params: [
      { name: 'eccentricity', default: 1, min: 0, max: 4, step: 0.05 },
      { name: 'holes',        default: 0, min: -2, max: 2, step: 0.05 },
    ],
  },
  {
    idx: V.parabola,
    name: 'parabola',
    source: sourceForIdx(V.parabola),
    formula: 'V_{93}(x, y) = (h\\sin^2 r\\cdot r_0,\\; w\\cos r\\cdot r_1)',
    blurb: 'Parabolic trace — sin²(r) on x, cos(r) on y, each multiplied by an independent random sample. Produces parabolic-arc clouds.',
    params: [
      { name: 'height', default: 0.55, min: -2, max: 2, step: 0.05 },
      { name: 'width',  default: 0.55, min: -2, max: 2, step: 0.05 },
    ],
  },
  {
    idx: V.pie,
    name: 'pie',
    source: sourceForIdx(V.pie),
    formula: 'V_{94}(x, y) = r\\,(\\cos a,\\; \\sin a),\\; a = \\text{rot} + 2\\pi(sl + r_1\\text{thick})/\\text{slices}',
    blurb: 'Pie-chart slicer — picks a random slice, then a random angle and radius within it. Independent of input position; like blur but with slice-of-circle support.',
    params: [
      { name: 'slices',    default: 6,   min: 2, max: 16, step: 1 },
      { name: 'rotation',  default: 0,   min: -Math.PI, max: Math.PI, step: 0.05 },
      { name: 'thickness', default: 0.5, min: 0, max: 1, step: 0.02 },
    ],
  },
  {
    idx: V.boarders,
    name: 'boarders',
    source: sourceForIdx(V.boarders),
    formula: 'V_{95}(x, y) = w\\,\\begin{cases} (\\hat x + \\tfrac{u}{2},\\; \\hat y + \\tfrac{v}{2}) & r_0 \\ge 0.75 \\\\ (\\hat x + \\tfrac{u}{2} + \\tfrac{s_u}{4},\\; \\hat y + \\tfrac{v}{2} + s_u\\tfrac{v}{4u}) & r_0 < 0.75,\\; |u| \\ge |v| \\\\ (\\hat x + \\tfrac{u}{2} + s_v\\tfrac{u}{4v},\\; \\hat y + \\tfrac{v}{2} + \\tfrac{s_v}{4}) & \\text{else} \\end{cases},\\; \\hat x = \\mathrm{round}(x),\\, \\hat y = \\mathrm{round}(y),\\, u = x-\\hat x,\\, v = y-\\hat y,\\, s_u = \\mathrm{sgn}(u),\\, s_v = \\mathrm{sgn}(v),\\, r_0 \\sim U[0,1)',
    blurb: 'Snaps inputs onto cell borders or centers based on a 75/25 random gate. Produces sharp-edged rectangular borders around integer cells.',
  },
  {
    idx: V.wedge_julia,
    name: 'wedge_julia',
    source: sourceForIdx(V.wedge_julia),
    formula: 'V_{96}(x, y) = r\\,(\\cos a,\\; \\sin a),\\; r = (x^2+y^2)^{\\text{dist}/(2p)},\\; a = (\\phi + 2\\pi n)/p \\cdot \\text{cf} + c\\cdot\\text{angle}',
    blurb: 'Julian crossed with wedge — random Julia branch then wedge-fold the resulting angle. Produces wedge attractors with Julia-style self-similarity.',
    params: [
      { name: 'angle', default: 0.01, min: -Math.PI, max: Math.PI, step: 0.05 },
      { name: 'count', default: 1,    min: 1, max: 16, step: 1 },
      { name: 'power', default: 1,    min: -10, max: 10, step: 1 },
      { name: 'dist',  default: 0.25, min: -2, max: 2, step: 0.05 },
    ],
  },
  // Batch J — pre_blur (RNG-only).
  {
    idx: V.pre_blur,
    name: 'pre_blur',
    source: sourceForIdx(V.pre_blur),
    formula: 'V_{97}(x, y) = (x, y) + r_g\\,(\\cos(2\\pi r_4),\\; \\sin(2\\pi r_4)),\\; r_g = w(r_0+r_1+r_2+r_3-2)',
    blurb: 'Special-case structural variation — mutates the chain INPUT position with a Gaussian blur before the rest of the xform runs. Used to soften incoming jitter.',
    // pre_blur's natural showcase weight is small — at weight=1 the random
    // pre-jitter dominates the iteration, masking the rest of the chain.
    defaultWeight: 0.24,
  },
  // Batch K — mobius.
  {
    idx: V.mobius,
    name: 'mobius',
    source: sourceForIdx(V.mobius),
    formula: 'V_{98}(x, y) = \\frac{a\\,p + b}{c\\,p + d},\\; p = x + iy,\\; a, b, c, d \\in \\mathbb{C}',
    blurb: 'Möbius transformation — the most general conformal map of the plane. Eight params for the complex coefficients of a, b, c, d. Produces beautiful, structure-preserving warps.',
    params: [
      { name: 're_a', default: 0.15,  min: -3, max: 3, step: 0.05 },
      { name: 'im_a', default: 0.15,  min: -3, max: 3, step: 0.05 },
      { name: 're_b', default: 0.15,  min: -3, max: 3, step: 0.05 },
      { name: 'im_b', default: 0,     min: -3, max: 3, step: 0.05 },
      { name: 're_c', default: 0,     min: -3, max: 3, step: 0.05 },
      { name: 'im_c', default: -0.35, min: -3, max: 3, step: 0.05 },
      { name: 're_d', default: 0,     min: -3, max: 3, step: 0.05 },
      { name: 'im_d', default: 0,     min: -3, max: 3, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const re_a = 0.15, im_a = 0.15, re_b = 0.15, im_b = 0;
      const re_c = 0, im_c = -0.35, re_d = 0, im_d = 0;
      const re_u = re_a * x - im_a * y + re_b;
      const im_u = re_a * y + im_a * x + im_b;
      const re_v = re_c * x - im_c * y + re_d;
      const im_v = re_c * y + im_c * x + im_d;
      const rad_v = 1.0 / (re_v * re_v + im_v * im_v + 1e-10);
      return [
        rad_v * (re_u * re_v + im_u * im_v),
        rad_v * (im_u * re_v - re_u * im_v),
      ];
    },
  },
  // ---------------------------------------------------------------------
  // DC (direct-color) family — V99..V102. These override per-scatter RGB
  // from spatial position (no palette lookup). Position warp is identity
  // for dc_linear / dc_perlin / dc_gridout; dc_cylinder warps like V21.
  // ---------------------------------------------------------------------
  {
    idx: V.dc_linear,
    name: 'dc_linear',
    source: sourceForIdx(V.dc_linear),
    formula: 'JWF_{0}(x, y) = (x, y);\\quad \\text{RGB} = \\mathrm{clamp}(\\tfrac{1}{2} + \\tfrac{1}{2}(x, y, -\\tfrac{1}{2}(x+y)))',
    blurb: 'Direct-color identity — passes position through, overrides RGB linearly from (x, y). Red rises with x, green with y, blue from −(x+y)/2; clamped to [0, 1].',
    hideWeight: true,
    warpFn: (x, y) => [x, y],
  },
  {
    idx: V.dc_perlin,
    name: 'dc_perlin',
    source: sourceForIdx(V.dc_perlin),
    formula: 'JWF_{1}(x, y) = (x, y);\\quad \\text{hue} = \\tfrac{1}{2}(1 + \\text{fBm}(p, \\text{octaves}, \\text{scale})) + \\text{seed}',
    blurb: 'Direct-color from a 2D Perlin fBm noise field. Position passes through unchanged; hue from noise, saturation 1, lightness 0.55. seed rotates the hue cycle.',
    hideWeight: true,
    params: [
      // `scale` here is actually fBm spatial FREQUENCY — higher values
      // produce finer noise. JWildfire kept the historical `scale` name;
      // we mirror it for compat with imported flames. (#169 — renaming
      // would require a Genome serialization migration.)
      { name: 'scale',      default: 1.0, min: 0.1, max: 8, step: 0.1 },
      { name: 'octaves',    default: 4,   min: 1,   max: 8, step: 1 },
      { name: 'color_seed', default: 0,   min: 0,   max: 1, step: 0.02 },
    ],
    warpFn: (x, y) => [x, y],
  },
  {
    idx: V.dc_gridout,
    name: 'dc_gridout',
    source: sourceForIdx(V.dc_gridout),
    formula: 'JWF_{2}(x, y) = (x, y);\\quad \\text{RGB} = \\mathrm{hash}(\\lfloor x\\cdot n\\rfloor,\\; \\lfloor y\\cdot n\\rfloor)',
    blurb: 'Direct-color from a hashed grid of cells. Each integer cell gets a random RGB triple; produces a pixelated, tile-mosaic coloring.',
    hideWeight: true,
    params: [
      { name: 'cells', default: 8, min: 1, max: 32, step: 1 },
    ],
    warpFn: (x, y) => [x, y],
  },
  {
    idx: V.dc_cylinder,
    name: 'dc_cylinder',
    source: sourceForIdx(V.dc_cylinder),
    formula: 'JWF_{3}(x, y) = w\\,(\\sin x,\\; y);\\quad \\text{hue spirals along } x,\\; \\text{lightness modulates with } y',
    blurb: 'Direct-color cylinder — V21 position warp plus position-derived HSL. Hue cycles along x via sin; lightness modulates by tanh(y/2).',
    // dc_cylinder is in ZERO_POSITION_DC_VARIATIONS but DOES warp position non-trivially
    // (unlike V99 dc_linear / V100 dc_perlin / V101 dc_gridout which are
    // identity-warp + color-only). So `hideWeight` is intentionally
    // absent — the weight slider matters for the sin-warp magnitude.
    // (#169 — sibling DC entries hide the slider because their warp is
    // identity.)
    warpFn: (x, y) => [Math.sin(x), y],
  },
  // ---------------------------------------------------------------------
  // JWildfire plugin pack — V103..V106. #114 batch 1.
  // ---------------------------------------------------------------------
  {
    idx: V.cpow2,
    name: 'cpow2',
    source: sourceForIdx(V.cpow2),
    formula: 'JWF_{4}(x, y) = e^{c/2 \\cdot \\ln r^2 - d \\cdot a}\\,(\\cos\\theta,\\; \\sin\\theta),\\; \\text{range-driven RNG branching}',
    blurb: 'Numbered variant of V41 cpow by Peter Sdobnov (Zueuk). Adds a range parameter that controls how many randomized angular branches are sampled — produces denser spiral attractors.',
    params: [
      { name: 'r',       default: 1,    min: -3, max: 3, step: 0.05 },
      { name: 'a',       default: 0,    min: -3, max: 3, step: 0.05 },
      { name: 'divisor', default: 0.50, min: -10, max: 10, step: 0.5 },
      { name: 'range',   default: 1,    min: 1, max: 8, step: 1 },
    ],
  },
  {
    idx: V.cpow3,
    name: 'cpow3',
    source: sourceForIdx(V.cpow3),
    formula: 'JWF_{5}(x, y) = e^{c/2 \\cdot \\ln r^2 - d \\cdot a}\\,(\\cos\\theta,\\; \\sin\\theta),\\; \\text{log-distributed branch picker}',
    blurb: 'Log-distribution branch picker variant of cpow2, by Peter Sdobnov. spread controls the angular branch distribution; produces wide, fanned-out spirals.',
    params: [
      { name: 'r',       default: 1.15, min: -3, max: 3, step: 0.05 },
      { name: 'd',       default: 1,    min: -3, max: 3, step: 0.05 },
      { name: 'divisor', default: 1,    min: -10, max: 10, step: 0.5 },
      { name: 'spread',  default: 1,    min: 0, max: 4, step: 0.05 },
    ],
  },
  {
    idx: V.loonie2,
    name: 'loonie2',
    source: sourceForIdx(V.loonie2),
    formula: 'JWF_{6}(x, y) = \\sqrt{w^2/r_n^2 - 1}\\,(x, y),\\; r_n = n\\text{-sided loonie radius blended with circle}',
    blurb: 'N-sided loonie variant by dark-beam. sides sets polygon count; star blends a star shape; circle blends in a circular component. Generalizes V71 loonie\'s circular cutout.',
    params: [
      { name: 'sides',  default: 4,    min: 2, max: 16, step: 1 },
      { name: 'star',   default: 0.15, min: -1, max: 1, step: 0.02 },
      { name: 'circle', default: 0.25, min: -1, max: 1, step: 0.02 },
    ],
    warpFn: (x, y) => {
      const sides_f = 4, star = 0.15, circle = 0.25, w = 1;
      const sides = Math.max(1, Math.min(16, Math.floor(sides_f)));
      const a = (2 * Math.PI) / sides;
      const sina = Math.sin(a), cosa = Math.cos(a);
      const sins = Math.sin(-star * Math.PI * 0.5);
      const coss = Math.cos(star * Math.PI * 0.5);
      const sinc = Math.sin(circle * Math.PI * 0.5);
      const cosc = Math.cos(circle * Math.PI * 0.5);
      const sqrvvar = w * w;
      let xrt = x, yrt = y;
      let r2 = xrt * coss + Math.abs(yrt) * sins;
      const circle_r = Math.sqrt(xrt * xrt + yrt * yrt);
      for (let i = 0; i < sides - 1; i++) {
        const swp = xrt * cosa - yrt * sina;
        yrt = xrt * sina + yrt * cosa;
        xrt = swp;
        r2 = Math.max(r2, xrt * coss + Math.abs(yrt) * sins);
      }
      r2 = r2 * cosc + circle_r * sinc;
      r2 = sides > 2 ? r2 * r2 : Math.abs(r2) * r2;
      if (r2 > 0.0 && r2 < sqrvvar) {
        const r = Math.sqrt(Math.abs(sqrvvar / r2 - 1.0));
        return [r * x, r * y];
      } else if (r2 < 0.0) {
        const r = 1.0 / Math.sqrt(Math.abs(sqrvvar / r2) - 1.0 + 1e-10);
        return [r * x, r * y];
      }
      return [x, y];
    },
  },
  {
    idx: V.epispiral,
    name: 'epispiral',
    source: sourceForIdx(V.epispiral),
    formula: 'JWF_{7}(x, y) = t\\,(\\cos\\theta,\\; \\sin\\theta),\\; t = -\\text{holes} + 1/\\cos(n\\theta)\\;[\\cdot r_0\\text{thickness}]',
    blurb: 'Polar epicycloid via 1/cos(n·θ), by cyberxaos (Apophysis 7X.15C). n sets petal count; thickness adds RNG-modulated band; holes carves out the center.',
    params: [
      { name: 'n',         default: 6,    min: 1, max: 16, step: 1 },
      { name: 'thickness', default: 0.20, min: 0, max: 2, step: 0.05 },
      { name: 'holes',     default: 1,    min: -2, max: 2, step: 0.05 },
    ],
  },
  // #114 batch 2a — Worley/Voronoi cellular family.
  {
    idx: V.bwraps,
    name: 'bwraps',
    source: sourceForIdx(V.bwraps),
    formula: 'JWF_{8}\\ \\text{(gist)}:\\ c = \\text{cell-grid centre of } p;\\ \\ell = p-c;\\ \\text{if } |\\ell|^2 > r^2 \\text{ identity, else } \\ell \\mathrel{*}= g_2,\\; \\ell \\mathrel{*}= \\tfrac{\\rho}{|\\ell|^2/4 + 1},\\; \\theta = \\theta_{in}(1-f) + \\theta_{out}f,\\; p \\to w\\,(c + R(\\theta)\\,\\ell);\\quad g_2 = \\tfrac{g^2}{\\text{cellsize}},\\; \\rho = r/\\max(b,\\,\\epsilon),\\; f = |\\ell|^2/r^2',
    blurb: 'Bubble-wrap lattice (Apophysis 7X / JWildfire). Cellular grid where each cell carries a circular "bubble" — inside, the point gets hyperbolically pulled toward the bubble center with an inner/outer twist; outside, it passes through. Produces the soap-bubble / lens-array texture.',
    params: [
      { name: 'cellsize',     default: 1,     min: 0.1, max: 4, step: 0.05 },
      { name: 'space',        default: 0,     min: 0,   max: 2, step: 0.05 },
      { name: 'gain',         default: 1,     min: 0,   max: 4, step: 0.05 },
      { name: 'inner_twist',  default: -1.04, min: -Math.PI, max: Math.PI, step: 0.05 },
      { name: 'outer_twist',  default:  0.71, min: -Math.PI, max: Math.PI, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const cellsize = 1, space = 0, gain = 1, inner_twist = -1.04, outer_twist = 0.71;
      const radius = 0.5 * (cellsize / (1 + space * space));
      const _g2 = (gain * gain) / cellsize + 1e-6;
      let max_bubble = _g2 * radius;
      if (max_bubble > 2.0) max_bubble = 1.0;
      else max_bubble *= 1.0 / ((max_bubble * max_bubble) / 4.0 + 1.0);
      const _r2 = radius * radius;
      const _rfactor = radius / Math.max(max_bubble, 1e-30);
      const cx = (Math.floor(x / cellsize) + 0.5) * cellsize;
      const cy = (Math.floor(y / cellsize) + 0.5) * cellsize;
      let lx = x - cx;
      let ly = y - cy;
      if (lx * lx + ly * ly > _r2) return [x, y];
      lx *= _g2;
      ly *= _g2;
      const r_dist = _rfactor / ((lx * lx + ly * ly) / 4.0 + 1.0);
      lx *= r_dist;
      ly *= r_dist;
      const r_frac = (lx * lx + ly * ly) / Math.max(_r2, 1e-30);
      const theta = inner_twist * (1 - r_frac) + outer_twist * r_frac;
      const st = Math.sin(theta), ct = Math.cos(theta);
      return [cx + ct * lx + st * ly, cy - st * lx + ct * ly];
    },
  },
  {
    idx: V.crackle,
    name: 'crackle',
    source: sourceForIdx(V.crackle),
    formula: 'JWF_{9}: U = \\text{blurr}\\cdot(\\sin\\theta, \\cos\\theta);\\; L = \\text{voronoi cell-boundary distance};\\; p \\to \\text{centre} + (U - \\text{centre})\\cdot \\frac{L^{\\text{power}}\\cdot s}{L}',
    blurb: "Voronoi-cell scatter (Neil Slater / \"slobo777\", ported from JWildfire CrackleFunc). Each iter samples a new point U on a unit-radius blurred circle, finds U's voronoi cell among 9 perturbed centres around floor(U/(c/2)), then scales U's offset from the centre by L^power · scale (L = boundary-relative distance). distort > 0 perturbs cell centres via 2D perlin noise (pyr3 substitutes JWildfire's 3D simplex — see NOTICE.md). 4 RNG calls/iter.",
    params: [
      { name: 'cellsize', default: 1,   min: 0.1, max: 4, step: 0.05 },
      { name: 'power',    default: 0.2, min: -2,  max: 2, step: 0.05 },
      { name: 'distort',  default: 0,   min: 0,   max: 4, step: 0.05 },
      { name: 'scale',    default: 1,   min: 0,   max: 4, step: 0.05 },
    ],
    // RNG-using (input-blur replaces p with U each iter) — no warpFn.
  },
  // #114 batch 2b-a — JWildfire S-tier first half.
  {
    idx: V.juliaq,
    name: 'juliaq',
    source: sourceForIdx(V.juliaq),
    formula: 'JWF_{10}(x, y) = r^{q/2p}\\,(\\cos a,\\; \\sin a),\\; a = \\tfrac{q}{p}\\,\\theta + n\\tfrac{2\\pi}{p},\\; n \\in [0, |p|)',
    blurb: 'Generalized julia by Peter Sdobnov (Zueuk). divisor q decouples rotation step from branch count p — produces denser or sparser julia-style attractors at fractional ratios than V14 julian can reach. RNG selects the branch index each iterate; the catalog "warp" diagram is omitted since the visual signal is the per-branch superposition.',
    params: [
      { name: 'power',   default: 3, min: 2, max: 8,  step: 1 },
      { name: 'divisor', default: 2, min: 1, max: 8,  step: 1 },
    ],
  },
  {
    idx: V.glynnia,
    name: 'glynnia',
    source: sourceForIdx(V.glynnia),
    formula: 'JWF_{11}(x, y) = \\begin{cases} \\tfrac{w\\sqrt{2}}{2}(\\sqrt{r+x},\\; -\\tfrac{y}{\\sqrt{r+x}}) & r\\geq 1,\\, \\text{coin}>0.5 \\\\ \\tfrac{w}{\\sqrt{r(y^2+(r+x)^2)}}(r+x,\\; y) & r\\geq 1,\\, \\text{coin}\\leq 0.5 \\\\ \\text{mirrored sign inside disk} \\end{cases}',
    blurb: 'Glynn-inspired bipolar warp by eralex61. Coin-flips between a √(r+x) split and a 1/√(...) split, with mirrored signs inside the unit disk — produces the four-leaf clover and arc-pair textures characteristic of the Apophysis 7X glynn family. The diagram shows the dominant outside-disk, coin>0.5 branch — the other three branches superimpose at render time.',
    warpFn: (x, y) => {
      const vvar2 = Math.SQRT2 * 0.5;
      const r = Math.sqrt(x * x + y * y);
      // Dominant branch: r>=1, coin>0.5 — the most visually-loaded leaf.
      const inner = r + x;
      if (inner <= 1e-30) return [x, y];
      const d = Math.sqrt(inner);
      return [vvar2 * d, -(vvar2 / d) * y];
    },
  },
  {
    idx: V.loonie3,
    name: 'loonie3',
    source: sourceForIdx(V.loonie3),
    formula: 'JWF_{12}(x, y) = w\\sqrt{w^2/r_2 - 1}\\,(x, y),\\; r_2 = (x^2+y^2)^2/x^2 \\text{ if } x>\\varepsilon\\text{, else identity}',
    blurb: 'Half-plane gated loonie variant by dark-beam. Like V71 loonie but uses (r²/x)² as the radius proxy when x is positive, identity branch outside — produces a sharp asymmetric cutout that the symmetric loonie/loonie2 family lacks.',
    warpFn: (x, y) => {
      const w = 1;
      const sqrvvar = w * w;
      const SMALL_EPSILON = 1e-30;
      let r2 = 2 * sqrvvar;
      if (x > SMALL_EPSILON) {
        const num = x * x + y * y;
        const q = num / x;
        r2 = q * q;
      }
      if (r2 < sqrvvar) {
        const r = Math.sqrt(sqrvvar / r2 - 1.0);
        return [r * x, r * y];
      }
      return [x, y];
    },
  },
  {
    idx: V.falloff,
    name: 'falloff',
    source: sourceForIdx(V.falloff),
    formula: 'JWF_{13}(x, y) = w\\,((x, y) + d\\,(\\mu_x r_0,\\; \\mu_y r_1)),\\; d = \\max(0,(|p - p_0| - m)\\,r_{max}),\\; r_{max} = 0.04\\,\\text{scatter},\\; r_{0,1} \\sim U[0,1)',
    blurb: 'Distance-weighted random scatter by Xyrus02 (JWildfire Falloff2 type=0 path). Outside the mindist radius around (x0,y0), each iterate gets a random displacement that grows with distance — produces a soft-edged "halo" around the center point. Z-axis params (mul_z, z0) and the color/invert flags dropped to fit pyr3\'s 2D 8-slot seam; the type=1 (radial) and type=2 (gaussian) branches live on the sibling V113 falloff2.',
    // Catalog defaults diverge from JWildfire baseline (scatter=1, muls=1)
    // to produce a visible halo against the sierpinski scaffold — kernel
    // bakes a 0.04*scatter scale, so JWF defaults render imperceptibly
    // close to V0 linear. scatter=5 + asymmetric muls + max upped to 20
    // reveals falloff's signature scatter halo around the attractor.
    params: [
      { name: 'scatter', default: 5,   min: 0,  max: 20, step: 0.5  },
      { name: 'mindist', default: 0.2, min: 0,  max: 4,  step: 0.05 },
      { name: 'mul_x',   default: 1.5, min: -4, max: 4,  step: 0.05 },
      { name: 'mul_y',   default: 0.8, min: -4, max: 4,  step: 0.05 },
      { name: 'x0',      default: 0,   min: -4, max: 4,  step: 0.05 },
      { name: 'y0',      default: 0,   min: -4, max: 4,  step: 0.05 },
    ],
  },
  {
    idx: V.falloff2,
    name: 'falloff2',
    source: sourceForIdx(V.falloff2),
    formula: 'JWF_{14} = w\\,\\begin{cases} (x,y) + d(\\mu_x r_0,\\mu_y r_1) & \\text{type}=0 \\\\ r_\\text{abs}(\\cos\\varphi,\\sin\\varphi),\\; \\varphi = \\mathrm{atan2}(y,x) + \\mu_y d r_1 & \\text{type}=1 \\\\ (x,y) + \\mu \\cdot d r_0 \\cos(d r_1 2\\pi)(\\cos d r_2\\pi,\\sin d r_2 \\pi) & \\text{type}=2 \\end{cases},\\; d = \\max(0, (|p-p_0|-m)\\,r_{max})',
    blurb: 'Three-branch falloff by Xyrus02 (JWildfire Falloff2Func). type=0 reproduces V112 falloff; type=1 rotates each iterate around the ORIGIN (not (x0,y0)) by a d-weighted angle, with d still measured to (x0,y0); type=2 scatters inside a gaussian-shaped angular shell. Z-axis params + invert + mul_c dropped per pyr3\'s 2D 8-slot seam.',
    // Catalog defaults: type=2 (gaussian shell) is more visually
    // distinctive against the sierpinski scaffold than type=0 (= V112);
    // scatter=5 with max=20 mirrors V112's `rmax = 0.04 * scatter`
    // kernel scaling so the shell is visible.
    params: [
      { name: 'scatter', default: 5,   min: 0,  max: 20, step: 0.5  },
      { name: 'type',    default: 2,   min: 0,  max: 2,  step: 1    },
      { name: 'mul_x',   default: 1,   min: -4, max: 4,  step: 0.05 },
      { name: 'mul_y',   default: 1,   min: -4, max: 4,  step: 0.05 },
      { name: 'x0',      default: 0,   min: -4, max: 4,  step: 0.05 },
      { name: 'y0',      default: 0,   min: -4, max: 4,  step: 0.05 },
      { name: 'mindist', default: 0.2, min: 0,  max: 4,  step: 0.05 },
    ],
  },
  {
    idx: V.falloff3,
    name: 'falloff3',
    source: sourceForIdx(V.falloff3),
    formula: 'JWF_{15}(x, y) = w\\,((x, y) + \\mu\\,d r_0\\cos(d r_1\\,2\\pi)\\,(\\cos(d r_2 \\pi),\\; \\sin(d r_2 \\pi))),\\; d = \\max(0, (|p-p_0|-m)\\,r_{max}),\\; r_{0,1,2} \\sim U[-0.5, 0.5)',
    blurb: 'Gaussian-shell falloff by JWildfire AbstractFalloff3Func, blur_type=0 (gaussian) + blur_shape=0 (circle) default-mode port. Scatters each iterate inside a 2π·π angular shell scaled by the circle-distance — produces a soft-shell glow around (x0,y0). invert=1 flips inside/outside. The blur_type 1/2 (radial/log) and blur_shape 1 (square) selectors, along with Z-axis params + alpha + mul_c, dropped to fit pyr3\'s 2D 8-slot seam.',
    // Catalog defaults: same kernel `rmax = 0.04 * scatter` scaling as
    // V112/V113 — JWF baseline (scatter=1) is invisible against the
    // sierpinski scaffold. scatter=5 + max=20 reveals the gaussian shell.
    params: [
      { name: 'scatter', default: 5,   min: 0,  max: 20, step: 0.5  },
      { name: 'mul_x',   default: 1,   min: -4, max: 4,  step: 0.05 },
      { name: 'mul_y',   default: 1,   min: -4, max: 4,  step: 0.05 },
      { name: 'x0',      default: 0,   min: -4, max: 4,  step: 0.05 },
      { name: 'y0',      default: 0,   min: -4, max: 4,  step: 0.05 },
      { name: 'mindist', default: 0.2, min: 0,  max: 4,  step: 0.05 },
      { name: 'invert',  default: 0,   min: 0,  max: 1,  step: 1    },
    ],
  },
  // #114 batch 2b-b — S-tier kaleidoscope/circle family.
  {
    idx: V.collideoscope,
    name: 'collideoscope',
    source: sourceForIdx(V.collideoscope),
    formula: 'JWF_{16}(x, y) = r\\,(\\cos a^{*},\\; \\sin a^{*}),\\; a^{*} = \\text{fold}_{2n}(\\theta, a)',
    blurb: 'Kaleidoscope-collide by Michael Faber (JWildfire). Folds the polar angle into 2·num pie slices with alternating-sign offsets — two adjacent slices "collide" in mirror-image, producing the eponymous splayed-petal pattern. JWF\'s class default a=0.20, num=1 (with randomize() spreading num∈[1,10]).',
    // Catalog defaults: num=5 produces the canonical kaleidoscope rosette
    // (JWF's class-default num=1 is mostly symmetric-pair; randomize()
    // spreads num∈[1,10], so num=5 is a typical "wild" pick).
    params: [
      { name: 'a',   default: 0.45, min: 0, max: 1,  step: 0.01 },
      { name: 'num', default: 5,    min: 1, max: 10, step: 1 },
    ],
    warpFn: (x, y) => {
      const num = 5;
      const a_param = 0.45;
      const kn_pi = num / Math.PI;
      const pi_kn = Math.PI / num;
      const ka = Math.PI * a_param;
      const ka_kn = ka / num;
      let a = Math.atan2(y, x);
      const r = Math.sqrt(x * x + y * y);
      if (a >= 0.0) {
        const alt = Math.trunc(a * kn_pi);
        if (alt % 2 === 0) {
          a = alt * pi_kn + ((ka_kn + a) % pi_kn);
        } else {
          a = alt * pi_kn + ((-ka_kn + a) % pi_kn);
        }
      } else {
        const alt = Math.trunc(-a * kn_pi);
        if (alt % 2 !== 0) {
          a = -(alt * pi_kn + ((-ka_kn - a) % pi_kn));
        } else {
          a = -(alt * pi_kn + ((ka_kn - a) % pi_kn));
        }
      }
      return [r * Math.cos(a), r * Math.sin(a)];
    },
  },
  {
    idx: V.circlize,
    name: 'circlize',
    source: sourceForIdx(V.circlize),
    formula: 'JWF_{17}(x, y) = (r\\cos a,\\; r\\sin a),\\; r = \\tfrac{4w}{\\pi}\\,\\text{side} + h,\\; a = \\tfrac{\\pi}{4}\\,\\tfrac{\\text{perim}}{\\text{side}} - \\tfrac{\\pi}{4}',
    blurb: 'Square → circle perimeter map by Michael Faber (JWildfire). Each iterate picks the dominant axis (the L∞-norm "side"), computes its position along the unit square\'s perimeter, then maps that perimeter → polar angle and side → radius. Note the canonical JWF quirk: the `hole` offset is intentionally NOT scaled by the variation weight (the corrected sibling circlize2 fixes this).',
    params: [
      { name: 'hole', default: 0.40, min: -1, max: 1, step: 0.01 },
    ],
    warpFn: (x, y) => {
      const w = 1;
      const hole = 0.40;
      const var4_PI = w / (Math.PI / 4);
      const absx = Math.abs(x);
      const absy = Math.abs(y);
      let perimeter: number;
      let side: number;
      if (absx >= absy) {
        if (x >= absy) perimeter = absx + y;
        else perimeter = 5.0 * absx - y;
        side = absx;
      } else {
        if (y >= absx) perimeter = 3.0 * absy - x;
        else perimeter = 7.0 * absy + x;
        side = absy;
      }
      if (side === 0) return [0, 0];
      const r = var4_PI * side + hole;
      const a = (Math.PI / 4) * perimeter / side - Math.PI / 4;
      return [r * Math.cos(a), r * Math.sin(a)];
    },
  },
  {
    idx: V.circlize2,
    name: 'circlize2',
    source: sourceForIdx(V.circlize2),
    formula: 'JWF_{18}(x, y) = w(\\text{side}+h)\\,(\\cos a,\\; \\sin a),\\; a = \\tfrac{\\pi}{4}\\,\\tfrac{\\text{perim}}{\\text{side}} - \\tfrac{\\pi}{4}',
    blurb: 'Companion variation to V116 circlize by Michael Faber (Angle Pack). Same square → circle perimeter parameterization, but the radius is w·(side+h) instead of (4w/π)·side+h — the `hole` offset IS scaled by the weight here, correcting the sibling\'s quirk. Produces a more uniform ring at non-zero hole.',
    // Catalog default hole=0.25 produces a clear annulus that
    // visually contrasts with V116 circlize (hole=0.40) — both ring,
    // both readable; the difference highlights the corrected weight
    // scaling that distinguishes circlize2 from its sibling.
    params: [
      { name: 'hole', default: 0.25, min: -1, max: 1, step: 0.01 },
    ],
    warpFn: (x, y) => {
      const w = 1;
      const hole = 0.25;
      const absx = Math.abs(x);
      const absy = Math.abs(y);
      let perimeter: number;
      let side: number;
      if (absx >= absy) {
        if (x >= absy) perimeter = absx + y;
        else perimeter = 5.0 * absx - y;
        side = absx;
      } else {
        if (y >= absx) perimeter = 3.0 * absy - x;
        else perimeter = 7.0 * absy + x;
        side = absy;
      }
      if (side === 0) return [0, 0];
      const r = w * (side + hole);
      const a = (Math.PI / 4) * perimeter / side - Math.PI / 4;
      return [r * Math.cos(a), r * Math.sin(a)];
    },
  },
  {
    idx: V.eswirl,
    name: 'eswirl',
    source: sourceForIdx(V.eswirl),
    formula: 'JWF_{19}(x, y) = w\\,(\\cosh\\mu\\cos\\nu^{*},\\; \\sinh\\mu\\sin\\nu^{*}),\\; \\nu^{*} = \\nu + \\mu\\cdot o + i/\\mu',
    blurb: 'Extended swirl by Michael Faber (JWildfire "eSeries"). Converts (x, y) to elliptic coords (μ, ν), twists ν by (μ·out + in/μ), then maps back — the in/μ term creates a strong inward spiral, the μ·out term a gentler outward one. Default in=1.2, out=0.2 strikes the canonical "smooth flow" balance.',
    params: [
      { name: 'in',  default: 1.2, min: 0, max: 4, step: 0.05 },
      { name: 'out', default: 0.2, min: 0, max: 4, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const w = 1;
      const in_p = 1.2;
      const out_p = 0.2;
      const tmp = y * y + x * x + 1.0;
      const tmp2 = 2.0 * x;
      const r1_in = tmp + tmp2;
      const r2_in = tmp - tmp2;
      const r1_sqrt = r1_in > 0 ? Math.sqrt(r1_in) : 0;
      const r2_sqrt = r2_in > 0 ? Math.sqrt(r2_in) : 0;
      let xmax = (r1_sqrt + r2_sqrt) * 0.5;
      if (xmax < 1.0) xmax = 1.0;
      const mu = Math.acosh(xmax);
      let t = x / xmax;
      if (t > 1.0) t = 1.0;
      else if (t < -1.0) t = -1.0;
      let nu = Math.acos(t);
      if (y < 0) nu = -nu;
      const mu_safe = mu === 0 ? 1e-30 : mu;
      const nu_warp = nu + mu * out_p + in_p / mu_safe;
      return [w * Math.cosh(mu) * Math.cos(nu_warp), w * Math.sinh(mu) * Math.sin(nu_warp)];
    },
  },
  {
    idx: V.petal,
    name: 'petal',
    source: sourceForIdx(V.petal),
    formula: 'JWF_{20}(x, y) = w\\cos x\\,((\\cos x \\cos y)^3,\\; (\\sin x \\cos y)^3)',
    blurb: 'Lobed-petal attractor by Raykoid666 (JWildfire). Cubes the (cos x · cos y) and (sin x · cos y) products, then modulates by cos x — produces the eponymous radially-symmetric petal lobes when paired with linear-family co-variations. Parameter-free; weight controls the overall lobe size.',
    warpFn: (x, y) => {
      const a = Math.cos(x);
      const cxcy = Math.cos(x) * Math.cos(y);
      const sxcy = Math.sin(x) * Math.cos(y);
      const bx = cxcy * cxcy * cxcy;
      const by = sxcy * sxcy * sxcy;
      return [a * bx, a * by];
    },
  },
  // #114 batch 2b-c — Xyrus02 mid-tier + hexes cellular.
  {
    idx: V.bcircle,
    name: 'bcircle',
    source: sourceForIdx(V.bcircle),
    formula: 'JWF_{21}(x, y) = \\begin{cases} w\\,(sx, sy) & r \\leq 1 \\\\ w\\omega\\,(\\cos\\theta, \\sin\\theta) & r > 1 \\end{cases}',
    blurb: 'Bordered-circle projection by Xyrus02 (Apophysis plugin pack). Inside the scale-adjusted unit disk, the iterate passes through verbatim; outside, it gets snapped onto the unit circle (or — when `borderwidth ≠ 0` — onto a random-radius shell just outside it). At borderwidth=0 the deterministic disk path produces a clean filled circle; non-zero borderwidth adds a halo. RNG path activates only for borderwidth ≠ 0.',
    // Catalog defaults: scale=2 shrinks the inside-disk region so the
    // sierpinski corners spill onto the bcircle perimeter; borderwidth=0.4
    // activates the RNG halo so the outside snaps to a randomized shell
    // — produces a visible bordered-disk silhouette instead of plain
    // sierpinski.
    params: [
      { name: 'scale',       default: 2.0, min: 0.1, max: 4,    step: 0.05 },
      { name: 'borderwidth', default: 0.4, min: 0,   max: 1,    step: 0.05 },
    ],
    warpFn: (x, y) => {
      const scale = 2.0;
      // borderwidth=0 path is deterministic; the catalog scaffold renders
      // exactly that shape (inside-disk passthrough + outside-disk
      // identity-zero). Non-zero-bw users see the RNG halo only at runtime.
      if (x === 0 && y === 0) return [0, 0];
      const xs = x * scale;
      const ys = y * scale;
      const r = Math.sqrt(xs * xs + ys * ys);
      if (r <= 1.0) return [xs, ys];
      return [0, 0];
    },
  },
  {
    idx: V.curl2,
    name: 'curl2',
    source: sourceForIdx(V.curl2),
    formula: 'JWF_{22}(x, y) = \\tfrac{w}{|p(z)|^2}\\,(x\\,\\Re p + y\\,\\Im p,\\; y\\,\\Re p - x\\,\\Im p),\\; p(z) = c_3 z^3 + c_2 z^2 + c_1 z + 1',
    blurb: 'Cubic-polynomial complex inverse by Xyrus02 / Georg Kiehne. The c1-only path collapses to flam3\'s classic `curl`; non-zero c2 and c3 add quadratic and cubic shaping, producing the eponymous "tighter scroll" / "double bend" silhouettes. Defaults c1=1, c2=c3=0 reproduce the standard curl shape; users discover the richer family by dialing c2/c3 up.',
    // Catalog defaults: c1=1, c2=0.5, c3=0.3 lights up the full cubic
    // polynomial — non-zero c2/c3 reveal the eponymous "tighter scroll"
    // and "double bend" curl2 silhouettes that distinguish this from
    // the c1-only classic curl shape.
    params: [
      { name: 'c1', default: 1.0, min: -2, max: 2, step: 0.05 },
      { name: 'c2', default: 0.5, min: -2, max: 2, step: 0.05 },
      { name: 'c3', default: 0.3, min: -1, max: 1, step: 0.02 },
    ],
    warpFn: (x, y) => {
      const c1 = 1.0;
      const c2 = 0.5;
      const c3 = 0.3;
      const cc2 = 2 * c2;
      const cc3 = 3 * c3;
      const x2 = x * x;
      const x3 = x2 * x;
      const y2 = y * y;
      const y3 = y2 * y;
      const re = c3 * x3 - cc3 * x * y2 + c2 * x2 - c2 * y2 + c1 * x + 1.0;
      const im = cc3 * x2 * y - c3 * y3 + cc2 * x * y + c1 * y;
      const denom = re * re + im * im;
      if (denom === 0) return [0, 0];
      const r = 1.0 / denom;
      return [(x * re + y * im) * r, (y * re - x * im) * r];
    },
  },
  {
    idx: V.murl,
    name: 'murl',
    source: sourceForIdx(V.murl),
    formula: 'JWF_{23}(x, y) = \\tfrac{w(c+1)}{|1 + r e^{ip\\theta}|^2 + \\epsilon}\\,((x\\,\\Re,\\; y\\,\\Im) + (y\\,\\Im,\\; -x\\,\\Re)),\\; r = c\\,(x^2+y^2)^{p/2}',
    blurb: 'Polar-power murl by Peter Sdobnov (Zueuk), ported into JWildfire by chronologicaldot. The polar angle is multiplied by an integer power and a complex-inverse blend through (re, im) folds back to Cartesian — produces the "spiraling braid" look characteristic of murl-family flames. Defaults c=0.1, power=1 give a gentle deterministic spiral; higher power values multiply the angular folding.',
    // Catalog defaults: power=3, c=0.3 produces the characteristic
    // murl-family braid silhouette (power=1, c=0.1 from JWF baseline is
    // close to identity — barely distinguishable from V0 linear).
    params: [
      { name: 'c',     default: 0.3, min: -1, max: 2, step: 0.05 },
      { name: 'power', default: 3,   min: 1,  max: 8, step: 1 },
    ],
    warpFn: (x, y) => {
      const c_in = 0.3;
      const power: number = 3;
      const c = power !== 1 ? c_in / (power - 1) : c_in;
      const p2 = power / 2.0;
      const vp = 1.0 * (c + 1);
      const a = Math.atan2(y, x) * power;
      const sina = Math.sin(a);
      const cosa = Math.cos(a);
      const r = c * Math.pow(x * x + y * y, p2);
      const re = r * cosa + 1;
      const im = r * sina;
      const r1 = vp / (re * re + im * im + 1e-29);
      return [r1 * (x * re + y * im), r1 * (y * re - x * im)];
    },
  },
  {
    idx: V.stwins,
    name: 'stwins',
    source: sourceForIdx(V.stwins),
    formula: 'JWF_{24}(x, y) = w(x, y) + \\frac{(s_x^2 - s_y^2)\\sin(2\\pi\\,d\\,(s_x+s_y))}{s_x^2 + s_y^2}\\,(1, 1),\\; s = 0.05\\,wp',
    blurb: 'Twin-sine ratio by Xyrus02 (Apophysis plugin pack). Mixes a (x²−y²)·sin(2π·distort·(x+y)) / (x²+y²) component back into both x and y in lockstep — produces the characteristic "diagonal pinch" pattern. The fixed 0.05 scale factor prevents overlap at distort=1 (source comment). Canonical name in the Xyrus02 source is `stwin`; pyr3 follows the plugin directory name `stwins` per survey doc + community alignment.',
    params: [
      { name: 'distort', default: 1.0, min: 0, max: 4, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const w = 1;
      const distort = 1.0;
      const mult = 0.05;
      const sx = x * w * mult;
      const sy = y * w * mult;
      const x2 = sx * sx;
      const y2 = sy * sy;
      const xpy = sx + sy;
      const xn = x2 - y2;
      const xd = x2 + y2;
      const result_num = xn * Math.sin(2 * Math.PI * distort * xpy);
      const divident = xd === 0 ? 1 : xd;
      const result = result_num / divident;
      return [w * x + result, w * y + result];
    },
  },
  {
    idx: V.hexes,
    name: 'hexes',
    source: sourceForIdx(V.hexes),
    formula: 'JWF_{25}(x, y) = w\\,(P_0 + R\\cdot(D_x\\cos\\phi + D_y\\sin\\phi,\\, -D_x\\sin\\phi + D_y\\cos\\phi)),\\; \\phi = 2\\pi r',
    blurb: 'Hex-grid voronoi warp by Neil Slater / slobo777, via JWildfire. Breaks the plane into a hexagonal lattice, finds the closest hex center to each iterate, then applies a per-cell power scaling + rotation expressed via voronoi-edge distance. The "rosette removal" blend at the cell edge (L ∈ [0.5, 0.8]) smooths the transition between closest-vs-second-closest-hex regions. Defaults cellsize=1, power=1, rotate=0.166 (≈ π/19), scale=1 reproduce JWildfire\'s class-level shape.',
    params: [
      { name: 'cellsize', default: 1.0,   min: 0.1, max: 4, step: 0.05 },
      { name: 'power',    default: 1.0,   min: 0,   max: 4, step: 0.05 },
      { name: 'rotate',   default: 0.166, min: 0,   max: 1, step: 0.01 },
      { name: 'scale',    default: 1.0,   min: 0.1, max: 4, step: 0.05 },
    ],
    warpFn: (x, y) => {
      // Catalog uses fixed defaults — cellsize=1 always, so the source's
      // cellsize==0 guard is dead code here. Kernel preserves the guard.
      const cellsize = 1.0;
      const power = 1.0;
      const rotate = 0.166;
      const scale = 1.0;
      const SQRT3 = 1.7320508075688772935;
      const a_hex = 1.0 / 3.0;
      const b_hex = SQRT3 / 3.0;
      const c_hex = -1.0 / 3.0;
      const d_hex = SQRT3 / 3.0;
      const a_cart = 1.5;
      const b_cart = -1.5;
      const c_cart = SQRT3 / 2.0;
      const d_cart = SQRT3 / 2.0;
      const rotSin = Math.sin(rotate * 2 * Math.PI);
      const rotCos = Math.cos(rotate * 2 * Math.PI);
      const s = cellsize;
      const hx0 = Math.floor((a_hex * x + b_hex * y) / s);
      const hy0 = Math.floor((c_hex * x + d_hex * y) / s);
      let bestD2 = Infinity;
      let q = 0;
      for (let di = -1; di < 2; di++) {
        for (let dj = -1; dj < 2; dj++) {
          const cx = (a_cart * (hx0 + di) + b_cart * (hy0 + dj)) * s;
          const cy = (c_cart * (hx0 + di) + d_cart * (hy0 + dj)) * s;
          const dx = cx - x;
          const dy = cy - y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; q = (di + 1) * 3 + (dj + 1); }
        }
      }
      const hx = hx0 + (Math.floor(q / 3) - 1);
      const hy = hy0 + ((q % 3) - 1);
      const cc = (hxi: number, hyi: number): [number, number] =>
        [(a_cart * hxi + b_cart * hyi) * s, (c_cart * hxi + d_cart * hyi) * s];
      const P0 = cc(hx, hy);
      const ring: [number, number][] = [
        cc(hx, hy + 1),
        cc(hx + 1, hy + 1),
        cc(hx + 1, hy),
        cc(hx, hy - 1),
        cc(hx - 1, hy - 1),
        cc(hx - 1, hy),
      ];
      const vor = (Ux: number, Uy: number): number => {
        let ratiomax = -1e20;
        for (const Pp of ring) {
          const PmQx = Pp[0] - P0[0];
          const PmQy = Pp[1] - P0[1];
          if (PmQx === 0 && PmQy === 0) { if (1 > ratiomax) ratiomax = 1; continue; }
          const ratio = 2 * ((Ux - P0[0]) * PmQx + (Uy - P0[1]) * PmQy) / (PmQx * PmQx + PmQy * PmQy);
          if (ratio > ratiomax) ratiomax = ratio;
        }
        return ratiomax;
      };
      const L1 = vor(x, y);
      const DXo = x - P0[0];
      const DYo = y - P0[1];
      const trgL = Math.pow(L1 + 1e-30, power) * scale;
      const Vx0 = DXo * rotCos + DYo * rotSin;
      const Vy0 = -DXo * rotSin + DYo * rotCos;
      const L2 = vor(Vx0 + P0[0], Vy0 + P0[1]);
      const L = Math.max(L1, L2);
      let R: number;
      if (L < 0.5) R = trgL / L1;
      else if (L > 0.8) R = trgL / L2;
      else R = ((trgL / L1) * (0.8 - L) + (trgL / L2) * (L - 0.5)) / 0.3;
      return [Vx0 * R + P0[0], Vy0 * R + P0[1]];
    },
  },
  // #114 batch 2b-d — Xyrus02 X-family + blur_circle (FINAL #114 batch).
  {
    idx: V.xheart,
    name: 'xheart',
    source: sourceForIdx(V.xheart),
    formula: 'JWF_{26}(x, y) = w\\,R(\\alpha)\\,\\left(\\tfrac{4x}{r^2+4},\\; \\tfrac{6+2\\rho}{r^2+4}\\,y\\right)\\cdot \\sigma,\\; \\alpha = \\tfrac{\\pi}{4}(1 + \\tfrac{\\theta}{2}),\\; \\sigma = \\mathrm{sign}(x_{\\mathrm{rot}})',
    blurb: 'Extended heart by Xyrus02 (Apophysis plugin pack). Folds the iterate through a (4/r²+4, rat/r²+4) projection then rotates by a θ-driven angle, then re-mirrors y when the rotated x is non-positive — producing the characteristic heart-curve attractor. Defaults angle=ratio=0 give the Xyrus02 baseline (rotation = π/4, ratio multiplier = 6); higher angle pushes the heart toward a tilted lobe, higher ratio elongates the bottom point.',
    params: [
      { name: 'xheart_angle', default: 0.0, min: -2, max: 2, step: 0.05 },
      { name: 'xheart_ratio', default: 0.0, min: -2, max: 4, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const angle = 0.0;
      const ratio = 0.0;
      const PI = Math.PI;
      const ang = PI / 4 + (0.5 * (PI / 4) * angle);
      const cosa = Math.cos(ang);
      const sina = Math.sin(ang);
      const rat = 6 + 2 * ratio;
      let r2_4 = x * x + y * y + 4;
      if (r2_4 === 0) r2_4 = 1;
      const bx = 4 / r2_4;
      const by = rat / r2_4;
      const xRot = cosa * (bx * x) - sina * (by * y);
      const yRot = sina * (bx * x) + cosa * (by * y);
      if (xRot > 0) return [xRot, yRot];
      return [xRot, -yRot];
    },
  },
  {
    idx: V.xhyperbol,
    name: 'xhyperbol',
    source: sourceForIdx(V.xhyperbol),
    formula: 'JWF_{27}(x, y) = \\tfrac{w}{|z\'|^2 + \\epsilon}\\,(\\cos\\alpha, \\sin\\alpha),\\; z\' = M\\cdot\\tfrac{z}{|z|^2 + \\epsilon} + t,\\; \\alpha = \\arg z\'',
    blurb: 'Extended hyperbolic by Xyrus02 (Apophysis plugin pack). Composes a unit-disc inversion (z → z/|z|²) with a 2x3 affine M·(·) + t — then emits a |z\'|⁻² reflection of the affine\'d direction. Defaults M = identity (m00=m11=1) give the simplest hyperbolic shape; non-zero m20/m21 translate the inversion center.',
    params: [
      { name: 'm00', default: 1.0, min: -2, max: 2, step: 0.05 },
      { name: 'm01', default: 0.0, min: -2, max: 2, step: 0.05 },
      { name: 'm10', default: 0.0, min: -2, max: 2, step: 0.05 },
      { name: 'm11', default: 1.0, min: -2, max: 2, step: 0.05 },
      { name: 'm20', default: 0.0, min: -2, max: 2, step: 0.05 },
      { name: 'm21', default: 0.0, min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const m00 = 1.0;
      const m01 = 0.0;
      const m10 = 0.0;
      const m11 = 1.0;
      const m20 = 0.0;
      const m21 = 0.0;
      const EPS = 1e-10;
      const r = 1 / (x * x + y * y + EPS);
      const xi = x * r;
      const yi = y * r;
      const re = m00 * xi + m01 * yi + m20;
      const im = m10 * xi + m11 * yi + m21;
      const alpha = Math.atan2(im, re) + 2 * Math.PI;
      const sa = Math.sin(alpha);
      const ca = Math.cos(alpha);
      const rsq = re * re + im * im;
      const xout = rsq * ca;
      const yout = rsq * sa;
      const rinv = 1 / (xout * xout + yout * yout + EPS);
      return [xout * rinv, yout * rinv];
    },
  },
  {
    idx: V.xcurl2,
    name: 'xcurl2',
    source: sourceForIdx(V.xcurl2),
    formula: 'JWF_{28}(x, y) = \\tfrac{w}{re^2 + im^2}\\,(x\\,re + y\\,im,\\; y\\,re + x\\,im),\\; re = 1 + c_1 x + c_2(x^2-y^2) + c_3(x^3 - 3x)',
    blurb: 'Older / alternate curl² by Xyrus02 (the source\'s own header reads "old, probably wrong version of curl2") — but the visual character differs from V121 `curl2` (Georg Kiehne), so pyr3 ships both. Polynomial shape: re mixes linear + (x²−y²) + (x³−3x) terms with c1/c2/c3 weights, im mixes the conjugate trio. Note the `y·re + x·im` SUM in the output (not the standard Cartesian-inverse SIGN flip in V121). Catalog defaults to c1=1 (linear path active) so the first slider drag produces a visible response.',
    params: [
      { name: 'c1', default: 1.0, min: -2, max: 2, step: 0.05 },
      { name: 'c2', default: 0.0, min: -2, max: 2, step: 0.05 },
      { name: 'c3', default: 0.0, min: -1, max: 1, step: 0.02 },
    ],
    warpFn: (x, y) => {
      const c1 = 1.0;
      const c2 = 0.0;
      const c3 = 0.0;
      const x2 = x * x;
      const y2 = y * y;
      const x3 = x2 * x;
      const re = 1 + c1 * x + c2 * (x2 - y2) + c3 * (x3 - 3 * x);
      const im = c1 * y + c2 * (2 * x * y) + c3 * (3 * x * y - 1);
      const denom = re * re + im * im;
      if (denom === 0) return [0, 0];
      const r = 1 / denom;
      return [(x * re + y * im) * r, (y * re + x * im) * r];
    },
  },
  {
    idx: V.xtrb,
    name: 'xtrb',
    source: sourceForIdx(V.xtrb),
    formula: 'JWF_{29}(x, y) = w\\,r\'\\,(\\cos\\phi, \\sin\\phi),\\; r\' = (in_x^2 + in_y^2)^{c_N},\\; \\phi = \\tfrac{\\arctan(in_y, in_x) + 2\\pi k}{p}',
    blurb: 'TriBorders by Xyrus02 — builds a dual tessellation on a triangular grid (the way `boarders` does on a square grid) using trilinear coordinates. Six params shape the triangle (radius, a, b for angle), the border blend (width), the angle-modulo (power), and the radial reach (dist). RNG drives both the width-blend branch and the power-modulo index. Defaults reproduce the Xyrus02 source baseline (power=2, equilateral-ish triangle, width=0.5).',
    params: [
      { name: 'xtrb_power',  default: 2,   min: 1,   max: 8, step: 1 },
      { name: 'xtrb_dist',   default: 1.0, min: 0.1, max: 2, step: 0.05 },
      { name: 'xtrb_radius', default: 1.0, min: 0.1, max: 2, step: 0.05 },
      { name: 'xtrb_width',  default: 0.5, min: 0,   max: 1, step: 0.05 },
      { name: 'xtrb_a',      default: 1.0, min: 0.1, max: 2, step: 0.05 },
      { name: 'xtrb_b',      default: 1.0, min: 0.1, max: 2, step: 0.05 },
    ],
    // RNG-driven — no warpFn. The catalog renders "warp not applicable"
    // for the static SVG diagram; live flame still iterates.
  },
  {
    idx: V.gridout,
    name: 'gridout',
    source: sourceForIdx(V.gridout),
    formula: 'JWF_{30}(x, y) = w\\,(x + \\delta_x, y + \\delta_y),\\; (\\delta_x, \\delta_y) \\in \\{(\\pm 1, 0), (0, \\pm 1)\\}\\; \\text{by quadrant}',
    blurb: 'Grid quantization by Xyrus02 (authors Michael + Joel Faber). Snaps the iterate by ±1 along x or y depending on which integer-grid quadrant (rint(x), rint(y)) it falls into — stair-step / cubist look. NOT the same as pyr3\'s V101 `dc_gridout` (that\'s a color variation; this is a pure position warp). 0 params: dial the variation weight instead.',
    warpFn: (x, y) => {
      const rx = x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
      const ry = y >= 0 ? Math.floor(y + 0.5) : Math.ceil(y - 0.5);
      let dx = 0;
      let dy = 0;
      if (ry <= 0) {
        if (rx > 0) {
          if (-ry >= rx) dx = 1; else dy = 1;
        } else {
          if (ry <= rx) dx = 1; else dy = -1;
        }
      } else {
        if (rx > 0) {
          if (ry >= rx) dx = -1; else dy = 1;
        } else {
          if (ry > -rx) dx = -1; else dy = -1;
        }
      }
      return [x + dx, y + dy];
    },
  },
  {
    idx: V.blur_circle,
    name: 'blur_circle',
    source: sourceForIdx(V.blur_circle),
    formula: 'JWF_{31}(x, y) = (r\\cos\\phi, r\\sin\\phi),\\; r = \\tfrac{4w}{\\pi}\\,s + \\text{hole},\\; \\phi = \\tfrac{\\pi}{4}\\,\\tfrac{p_s}{s} - \\pi',
    blurb: 'Disc-uniform blur by Xyrus02 (Apophysis plugin pack). Uniformly samples a unit square, runs a square→circle perimeter parameterization (same family as circlize / circlize2), then emits onto a hole-offset circle. Input iterate is ignored — the variation\'s output is purely RNG-driven. The 4/π scale factor matches a unit-disc area density; non-zero hole adds a concentric annulus offset.',
    params: [
      { name: 'hole', default: 0.0, min: -1, max: 1, step: 0.05 },
    ],
    // RNG-driven (input p is ignored, output is pure RNG) — no warpFn.
  },
  // #120 batch B1 — M-tier port flagship. bipolar2 = Brad Stefanov's
  // 9-param rework of base bipolar (V35) — first user of the post-#120
  // expanded 10-param seam. Source: JWildfire Bipolar2Func.java
  // (LGPL-2.1+, see NOTICE.md).
  {
    idx: V.bipolar2,
    name: 'bipolar2',
    source: sourceForIdx(V.bipolar2),
    formula: 'JWF_{32}(x, y) = \\left(\\tfrac{2 f_1}{\\pi}\\log\\tfrac{t+bx}{t-bx},\\; \\tfrac{2h}{\\pi}\\,y\'\\right),\\; t = g_1(x^2+y^2)+a,\\; y\' = c\\,\\mathrm{atan2}(e\\,y,\\; g_1(x^2+y^2)-d) - \\tfrac{\\pi}{2}\\,\\text{shift}',
    blurb: 'Bipolar with variables added by Brad Stefanov. Generalizes the V35 bipolar formula by exposing the radius scale (g1), the inner offsets (a, d), the affine pre-multiplies on x and y (b, e), the meridian split (c), and the two output scales (f1 for the log channel, h for the angular channel). At defaults (shift=0, a=1, b=2, c=0.5, d=1, e=2, f1=0.25, g1=1, h=1) it traces a sibling of base bipolar with a slightly different aspect ratio. Tuning a < 0 or d > x²+y² can flip the quotient sign — the variation short-circuits to (0,0) when that happens, matching JWildfire\'s early-return.',
    params: [
      { name: 'shift', default: 0.0, min: -2, max: 2, step: 0.05 },
      { name: 'a', default: 1.0, min: -3, max: 3, step: 0.05 },
      { name: 'b', default: 2.0, min: -3, max: 3, step: 0.05 },
      { name: 'c', default: 0.5, min: -2, max: 2, step: 0.05 },
      { name: 'd', default: 1.0, min: -3, max: 3, step: 0.05 },
      { name: 'e', default: 2.0, min: -3, max: 3, step: 0.05 },
      { name: 'f1', default: 0.25, min: -1, max: 1, step: 0.05 },
      { name: 'g1', default: 1.0, min: -2, max: 2, step: 0.05 },
      { name: 'h', default: 1.0, min: -2, max: 2, step: 0.05 },
    ],
    // Deterministic — pure function of (p, params). Plot the warp at the
    // default param set; the guard branch (returns (0,0) when f/g <= 0) is
    // honored exactly the same way the WGSL kernel does, so the grid will
    // visibly snap to the origin on the affected cells.
    warpFn: (x, y) => {
      const HALF_PI = Math.PI * 0.5;
      const TWO_OVER_PI = 2.0 / Math.PI;
      // defaults: shift=0, a=1, b=2, c=0.5, d=1, e=2, f1=0.25, g1=1, h=1
      const x2y2 = x * x + y * y;
      const t = x2y2 + 1.0;
      const x2 = 2.0 * x;
      let yv = 0.5 * Math.atan2(2.0 * y, x2y2 - 1.0);
      if (yv > HALF_PI) yv = -HALF_PI + ((yv + HALF_PI) % Math.PI);
      else if (yv < -HALF_PI) yv = HALF_PI - ((HALF_PI - yv) % Math.PI);
      const fnum = t + x2;
      const gnum = t - x2;
      if (gnum === 0 || fnum / gnum <= 0) return [0, 0];
      return [0.25 * TWO_OVER_PI * Math.log(fnum / gnum), TWO_OVER_PI * yv];
    },
  },
  // #120 batch B2 — bubble2 (2D projection of JWildfire 3D Bubble2Func).
  // Source: "bubble2 from FracFx" (LGPL-2.1+, NOTICE.md).
  {
    idx: V.bubble2,
    name: 'bubble2',
    source: sourceForIdx(V.bubble2),
    formula: 'JWF_{33}(x, y) = \\left(\\tfrac{w x_s\\,x}{(x^2+y^2)/4 + 1},\\; \\tfrac{w y_s\\,y}{(x^2+y^2)/4 + 1}\\right)',
    blurb: 'Numbered variant of bubble (V20) by FracFx. Folds the plane into a unit sphere just like bubble, but with independent x/y axis scales. At x_scale = y_scale = 1 it matches bubble exactly; non-matching scales stretch the bubble along an axis, producing an anisotropic lens. Drops the z-channel and z param from the JWildfire source (pyr3 is 2D-only).',
    params: [
      { name: 'x', default: 1.0, min: -2, max: 2, step: 0.05 },
      { name: 'y', default: 1.0, min: -2, max: 2, step: 0.05 },
    ],
    // Deterministic — pure function of (p, x_scale, y_scale). At the
    // defaults x=y=1 this is identical to var_bubble (V20)'s warp.
    warpFn: (x, y) => {
      const r = 1.0 / (0.25 * (x * x + y * y) + 1.0);
      return [x * r, y * r];
    },
  },
  // ============================================================
  // #120 batch B3 — inverse hyperbolic family (V133–V138).
  // Sources: JWildfire AcoshFunc / ArcsinhFunc / ArctanhFunc /
  // AcothFunc / AcosechFunc / Arcsech2Func (LGPL-2.1+, NOTICE.md).
  // Authors: Whittaker Courtney (acosh / acoth / acosech, based on
  // hyperbolic variations by Tatyana Zabanova + DarkBeam), Tatyana
  // Zabanova 2017 / DarkBeam 2018 (arcsinh / arctanh / arcsech2).
  // ============================================================
  {
    idx: V.acosh,
    name: 'acosh',
    source: sourceForIdx(V.acosh),
    formula: 'JWF_{34}(z) = \\pm\\tfrac{2w}{\\pi}\\,\\log\\!\\left(z + \\sqrt{z^2 - 1}\\right),\\; z = x + iy',
    blurb: 'Complex inverse hyperbolic cosine, scaled by w·2/π. Output sign is flipped 50/50 per iteration — the chaos game accumulates both branches across walkers, producing the mirrored fold characteristic of Whittaker Courtney\'s hyperbolic ports of Tatyana Zabanova\'s designs.',
    // RNG-driven (50/50 sign flip) → no warpFn.
  },
  {
    idx: V.arcsinh,
    name: 'arcsinh',
    source: sourceForIdx(V.arcsinh),
    formula: 'JWF_{35}(z) = \\tfrac{2w}{\\pi}\\,\\log\\!\\left(z + \\sqrt{z^2 + 1}\\right),\\; z = x + iy',
    blurb: 'Complex inverse hyperbolic sine, scaled by w·2/π. Deterministic; the parent curve of the inverse hyperbolic family. Tatyana Zabanova 2017 / DarkBeam 2018.',
    warpFn: (x, y) => {
      // z² + 1
      const z2 = [x * x - y * y + 1.0, 2.0 * x * y] as [number, number];
      // sqrt(z² + 1) — JWildfire exact formula
      const rad = Math.hypot(z2[0], z2[1]);
      const sb = z2[1] < 0 ? -1 : 1;
      const sqRe = Math.sqrt(Math.max(0.5 * (rad + z2[0]), 0));
      const sqIm = sb * Math.sqrt(Math.max(0.5 * (rad - z2[0]), 0));
      const sx = x + sqRe;
      const sy = y + sqIm;
      const mag2 = sx * sx + sy * sy + 1e-20;
      const TWO_OVER_PI = 2.0 / Math.PI;
      return [0.5 * Math.log(mag2) * TWO_OVER_PI, Math.atan2(sy, sx) * TWO_OVER_PI];
    },
  },
  {
    idx: V.arctanh,
    name: 'arctanh',
    source: sourceForIdx(V.arctanh),
    formula: 'JWF_{36}(z) = \\tfrac{2w}{\\pi}\\,\\log\\!\\left(\\tfrac{z + 1}{1 - z}\\right),\\; z = x + iy',
    blurb: 'Inverse hyperbolic tangent variant. The 1/2 factor that would make this exactly arctanh is absorbed by JWildfire — the result is effectively 2·atanh(z), scaled by w·2/π. Maps the open unit disk onto a horizontal strip; characteristic asymmetric pull toward x = ±1.',
    warpFn: (x, y) => {
      // (z + 1) / (1 - z)
      const num_re = x + 1.0, num_im = y;
      const den_re = 1.0 - x, den_im = -y;
      const m2 = Math.max(den_re * den_re + den_im * den_im, 1e-100);
      const q_re = (num_re * den_re + num_im * den_im) / m2;
      const q_im = (num_im * den_re - num_re * den_im) / m2;
      const mag2 = q_re * q_re + q_im * q_im + 1e-20;
      const TWO_OVER_PI = 2.0 / Math.PI;
      return [0.5 * Math.log(mag2) * TWO_OVER_PI, Math.atan2(q_im, q_re) * TWO_OVER_PI];
    },
  },
  {
    idx: V.acoth,
    name: 'acoth',
    source: sourceForIdx(V.acoth),
    formula: 'JWF_{37}(z) = \\tfrac{2w}{\\pi}\\,\\mathrm{Flip}\\!\\left(\\tfrac{1}{2}\\log\\!\\tfrac{1/z + 1}{1 - 1/z}\\right),\\; z = x + iy',
    blurb: 'Complex inverse hyperbolic cotangent. Computes atanh(1/z), then swaps real and imaginary (JWildfire\'s Flip() — re↔im exchange), and scales by w·2/π. Deterministic; the Flip rotates the strip atanh produces by 90° onto a vertical band.',
    warpFn: (x, y) => {
      // 1/z = z* / |z|²
      const m2z = Math.max(x * x + y * y, 1e-100);
      const rz_re = x / m2z, rz_im = -y / m2z;
      // (rz + 1) / (1 - rz)
      const num_re = rz_re + 1.0, num_im = rz_im;
      const den_re = 1.0 - rz_re, den_im = -rz_im;
      const m2 = Math.max(den_re * den_re + den_im * den_im, 1e-100);
      const q_re = (num_re * den_re + num_im * den_im) / m2;
      const q_im = (num_im * den_re - num_re * den_im) / m2;
      // 0.5 * log(q)
      const mag2 = q_re * q_re + q_im * q_im + 1e-20;
      const lg_re = 0.5 * 0.5 * Math.log(mag2);
      const lg_im = 0.5 * Math.atan2(q_im, q_re);
      // Flip + scale 2/π
      const TWO_OVER_PI = 2.0 / Math.PI;
      return [lg_im * TWO_OVER_PI, lg_re * TWO_OVER_PI];
    },
  },
  {
    idx: V.acosech,
    name: 'acosech',
    source: sourceForIdx(V.acosech),
    formula: 'JWF_{38}(z) = \\pm\\tfrac{2w}{\\pi}\\,\\mathrm{Flip}\\!\\left(\\log\\!\\left(1/z + \\sqrt{1/z^2 - 1}\\right)\\right),\\; z = x + iy',
    blurb: 'Complex inverse hyperbolic cosecant. Computes acosh(1/z), flips re↔im, then scales by w·2/π and applies a 50/50 sign flip. The Recip step turns the chaos game inside-out around the unit circle before the acosh fold.',
    // RNG-driven (50/50 sign flip) → no warpFn.
  },
  {
    idx: V.arcsech2,
    name: 'arcsech2',
    source: sourceForIdx(V.arcsech2),
    formula: 'JWF_{39}(z) = \\tfrac{2w}{\\pi}\\,\\log\\!\\left(\\tfrac{1}{z} + \\sqrt{\\tfrac{1}{z^2} - 1}\\right) + \\text{asymmetric tail}',
    blurb: 'Inverse hyperbolic secant by Tatyana Zabanova 2017 / DarkBeam 2018. Deterministic. After the standard arcsech computation, an asymmetric ±1 tail is added to py and the sign of px is flipped, based on whether the scaled log\'s imaginary part is negative — produces a stark mirrored pair of arcs.',
    warpFn: (x, y) => {
      // 1/z
      const m2z = Math.max(x * x + y * y, 1e-100);
      const rz_re = x / m2z, rz_im = -y / m2z;
      // sqrt(rz - 1) via JWildfire formula
      const a_re = rz_re - 1.0, a_im = rz_im;
      const a_rad = Math.hypot(a_re, a_im);
      const a_sb = a_im < 0 ? -1 : 1;
      const aSqRe = Math.sqrt(Math.max(0.5 * (a_rad + a_re), 0));
      const aSqIm = a_sb * Math.sqrt(Math.max(0.5 * (a_rad - a_re), 0));
      // sqrt(rz + 1)
      const b_re = rz_re + 1.0, b_im = rz_im;
      const b_rad = Math.hypot(b_re, b_im);
      const b_sb = b_im < 0 ? -1 : 1;
      const bSqRe = Math.sqrt(Math.max(0.5 * (b_rad + b_re), 0));
      const bSqIm = b_sb * Math.sqrt(Math.max(0.5 * (b_rad - b_re), 0));
      // sqrt(rz+1) * sqrt(rz-1)
      const m_re = bSqRe * aSqRe - bSqIm * aSqIm;
      const m_im = bSqRe * aSqIm + bSqIm * aSqRe;
      // rz + sqrt(rz²-1)
      const s_re = rz_re + m_re;
      const s_im = rz_im + m_im;
      // log
      const mag2 = s_re * s_re + s_im * s_im + 1e-20;
      const TWO_OVER_PI = 2.0 / Math.PI;
      const lg_re = 0.5 * Math.log(mag2) * TWO_OVER_PI;
      const lg_im = Math.atan2(s_im, s_re) * TWO_OVER_PI;
      // Asymmetric tail
      if (lg_im < 0) return [lg_re, lg_im + 1.0];
      return [-lg_re, lg_im - 1.0];
    },
  },
  // ============================================================
  // #120 batch B3.5 — cell2 (V139). 6-param N/S asymmetric subset
  // of JWildfire's 16-param Cell2Func.java (Brad Stefanov, "Cell in
  // the Apophysis Plugin Pack" + Stefanov's per-quadrant variables).
  // Source LGPL-2.1+, NOTICE.md. The full 16-param surface is parked
  // on #127 (per-variation seam-expand decision).
  // ============================================================
  {
    idx: V.cell2,
    name: 'cell2',
    source: sourceForIdx(V.cell2),
    formula: 'JWF_{40}(x, y) = w\\big(d_x + s_x\\cdot\\text{size},\\; -(d_y + s_y\\cdot\\text{size})\\big),\\; d = p - \\lfloor p\\cdot\\tfrac{a}{\\text{size}}\\rfloor\\cdot\\text{size}',
    blurb: 'Numbered variant of cell (V75) by Brad Stefanov. Snaps the iterate to a square grid (size · a-tuned cell pitch), then scales the cell coordinate per-hemisphere — `space_north_*` for y ≥ 0, `space_south_*` for y < 0 — producing a top/bottom-different cellular tile that\'s the visual signature of cell2 vs cell. pyr3 ships a **6-param subset** of JWildfire\'s 16-param source: the per-quadrant E/W asymmetry, per-quadrant position offsets, and RNG mirror flags are dropped; see issue #127 if the full surface ever matters. At the defaults (size=0.6, a=1, all space_*=2), the output is N/S symmetric; varying any of the four space_* sliders introduces the asymmetric look.',
    params: [
      { name: 'size',          default: 0.3, min: 0.05, max: 2.0, step: 0.05 },
      { name: 'a',             default: 1.0, min: 0.1,  max: 3.0, step: 0.05 },
      { name: 'space_north_x', default: 1.0, min: -3,   max: 3,   step: 0.05 },
      { name: 'space_north_y', default: 1.0, min: -3,   max: 3,   step: 0.05 },
      { name: 'space_south_x', default: 1.0, min: -3,   max: 3,   step: 0.05 },
      { name: 'space_south_y', default: 1.0, min: -3,   max: 3,   step: 0.05 },
    ],
    // Deterministic in the 6-param subset (the dropped mirror flags
    // were the only RNG source in JWildfire's full version).
    warpFn: (x, y) => {
      const size = 0.3, a = 1.0;
      const space_north_x = 1.0, space_north_y = 1.0;
      const space_south_x = 1.0, space_south_y = 1.0;
      const safe_size = Math.abs(size) < 1e-30 ? 1e-30 : size;
      const inv = a / safe_size;
      const cx = Math.floor(x * inv);
      const cy = Math.floor(y * inv);
      const dx = x - cx * safe_size;
      const dy = y - cy * safe_size;
      let sx = cx, sy = cy;
      if (sy >= 0) {
        sy = sy * space_north_y;
        sx = sx * space_north_x;
      } else {
        sy = -space_south_y * sy;
        sx = sx * space_south_x;
      }
      return [dx + sx * safe_size, -(dy + sy * safe_size)];
    },
  },
  // ============================================================
  // #120 batch B4 — Xyrus02 + Lu-Kout remainders (V140–V144).
  // Sources: JWildfire CurlSpFunc / Murl2Func / LissajousFunc /
  // SpirographFunc / WaffleFunc (LGPL-2.1+, NOTICE.md). Authors:
  // Xyrus02 (curl_sp), Peter Sdobnov "Zueuk" / Nic Anderson (murl2),
  // Jed Kelsey "Lu-Kout" (lissajous / spirograph / waffle).
  // ============================================================
  {
    idx: V.curl_sp,
    name: 'curl_sp',
    source: sourceForIdx(V.curl_sp),
    formula: 'JWF_{41}(x, y) = \\tfrac{w}{c}\\big(x\'\\,\\mathrm{re} + y\'\\,\\mathrm{im},\\; y\'\\,\\mathrm{re} - x\'\\,\\mathrm{im}\\big),\\; x\' = |x|^{\\rho}\\mathrm{sgn}(x),\\; \\rho = \\text{pow}',
    blurb: 'Spherical-curl variant by Xyrus02. Takes signed odd powers of both coords (so negative bases stay defined), then applies a complex-curl polynomial with magnitude reduction. pyr3 ships 5 of the 6 source params — `dc` was a color-output knob that pyr3\'s chain doesn\'t expose for non-DC variations.',
    params: [
      { name: 'pow', default: 1.0,   min: 0.1, max: 3.0, step: 0.05 },
      { name: 'c1',  default: -0.01, min: -1,  max: 1,   step: 0.01 },
      { name: 'c2',  default: 0.03,  min: -1,  max: 1,   step: 0.01 },
      { name: 'sx',  default: 0.0,   min: -1,  max: 1,   step: 0.05 },
      { name: 'sy',  default: 0.0,   min: -1,  max: 1,   step: 0.05 },
    ],
    warpFn: (x, y) => {
      // All literal defaults — runtime guards (power==0, etc) live in the
      // WGSL kernel where actual user params can be zero.
      const c1 = -0.01, c2 = 0.03, sx = 0.0, sy = 0.0;
      const power = 1.0;
      const power_inv = 1.0 / power;
      const c2_x2 = 2.0 * c2;
      const xp = Math.pow(Math.abs(x), power) * Math.sign(x);
      const yp = Math.pow(Math.abs(y), power) * Math.sign(y);
      const d = xp * xp - yp * yp;
      const s1a = c1 * xp + c2 * d;
      const re = Math.sqrt(s1a * s1a + sx * sx) * (s1a > 0 ? 1 : -1) + 1.0;
      const s2a = c1 * yp + c2_x2 * xp * yp;
      const im = Math.sqrt(s2a * s2a + sy * sy) * (s2a > 0 ? 1 : -1);
      const c = Math.pow(Math.abs(re * re + im * im), power_inv);
      const r = 1.0 / Math.max(c, 1e-30);
      return [(xp * re + yp * im) * r, (yp * re - xp * im) * r];
    },
  },
  {
    idx: V.murl2,
    name: 'murl2',
    source: sourceForIdx(V.murl2),
    formula: 'JWF_{42}(x, y) = \\tfrac{w\\,(c+1)^{2/n}}{r_1^2}\\big(x\\cdot\\Re + y\\cdot\\Im,\\; y\\cdot\\Re - x\\cdot\\Im\\big),\\; n = \\text{power}',
    blurb: 'Numbered companion to murl (V122) by Peter Sdobnov ("Zueuk"), transcribed from C by Nic Anderson. Computes a polar-power lift (radius^n · cos/sin of n·θ + 1), then maps through complex (·)^(1/n) and divides by radius squared. Produces tightly-wound spiral attractors that read as "curled" cellular cuts of the plane.',
    params: [
      { name: 'c',     default: 0.1, min: -1, max: 2, step: 0.05 },
      { name: 'power', default: 3.0, min: 2,  max: 8, step: 1    },
    ],
    warpFn: (x, y) => {
      // Literal defaults c=0.1, power=3 → all guards inert.
      const c = 0.1;
      const safe_pow = 3.0;
      const p2 = safe_pow * 0.5;
      const invp = 1.0 / safe_pow;
      const cp1 = c + 1.0;
      const vp = Math.pow(Math.abs(cp1), 2.0 * invp) * (cp1 >= 0 ? 1 : -1);
      const a1 = Math.atan2(y, x) * safe_pow;
      const r0 = c * Math.pow(Math.abs(x * x + y * y), p2);
      const re0 = r0 * Math.cos(a1) + 1.0;
      const im0 = r0 * Math.sin(a1);
      const r1 = Math.pow(Math.abs(re0 * re0 + im0 * im0), invp);
      const a2 = Math.atan2(im0, re0) * 2.0 * invp;
      const re1 = r1 * Math.cos(a2);
      const im1 = r1 * Math.sin(a2);
      const rl = vp / Math.max(r1 * r1, 1e-30);
      return [rl * (x * re1 + y * im1), rl * (y * re1 - x * im1)];
    },
  },
  {
    idx: V.lissajous,
    name: 'lissajous',
    source: sourceForIdx(V.lissajous),
    formula: 'JWF_{43}(x, y) = w\\big(\\sin(a t + d) + c t + e u,\\; \\sin(b t) + c t + e u\\big),\\; t,u \\sim \\mathrm{rand}',
    blurb: 'Lissajous-curve sampler by Jed Kelsey (Lu-Kout). Picks t uniformly from [tmin, tmax] and a small y-jitter; emits a point on the parametric curve (sin(at+d), sin(bt)) with a shared linear drift (c·t + e·u). Visually iconic — the chaos game samples along the full curve since the input coord is ignored.',
    params: [
      { name: 'tmin', default: -Math.PI, min: -10, max: 10, step: 0.1  },
      { name: 'tmax', default: Math.PI,  min: -10, max: 10, step: 0.1  },
      { name: 'a',    default: 3.0,      min: 1,   max: 10, step: 0.1  },
      { name: 'b',    default: 2.0,      min: 1,   max: 10, step: 0.1  },
      { name: 'c',    default: 0.0,      min: -1,  max: 1,  step: 0.05 },
      { name: 'd',    default: 0.0,      min: -Math.PI, max: Math.PI, step: 0.05 },
      { name: 'e',    default: 0.0,      min: -0.5, max: 0.5, step: 0.05 },
    ],
    // RNG-driven (2 rand01 draws) → no warpFn.
  },
  {
    idx: V.spirograph,
    name: 'spirograph',
    source: sourceForIdx(V.spirograph),
    formula: 'JWF_{44}(x, y) = w\\big((a+b)\\cos t - c_1\\cos((a+b)t/b) + d\\cos t + u,\\; \\text{sin analog}\\big)',
    blurb: 'Classic spirograph (hypotrochoid) curve sampler by Jed Kelsey (Lu-Kout). Combines a large circle of radius (a+b) with a smaller rotating component scaled by c₁/c₂, plus an optional d-scaled circular drift and a y-jitter. Input coord is ignored — output texture comes entirely from the parametric curve + RNG. Nine params fill our seam exactly.',
    params: [
      // Catalog defaults RETUNED for visibility: at a=3, b=2, c1=c2=0
      // the curve is a circle of radius 5 — off the catalog camera.
      // Smaller a/b + non-zero c1/c2 surfaces the actual hypotrochoid.
      { name: 'a',    default: 0.5,        min: 0,    max: 10,   step: 0.05 },
      { name: 'b',    default: 0.3,        min: 0.05, max: 10,   step: 0.05 },
      { name: 'd',    default: 0.0,        min: -2,   max: 2,    step: 0.05 },
      { name: 'tmin', default: -Math.PI,   min: -10,  max: 10,   step: 0.1  },
      { name: 'tmax', default: Math.PI,    min: -10,  max: 10,   step: 0.1  },
      { name: 'ymin', default: 0.0,        min: -2,   max: 2,    step: 0.05 },
      { name: 'ymax', default: 0.0,        min: -2,   max: 2,    step: 0.05 },
      { name: 'c1',   default: 0.5,        min: -2,   max: 2,    step: 0.05 },
      { name: 'c2',   default: 0.5,        min: -2,   max: 2,    step: 0.05 },
    ],
    // RNG-driven (2 rand01 draws) → no warpFn.
  },
  {
    idx: V.waffle,
    name: 'waffle',
    source: sourceForIdx(V.waffle),
    formula: 'JWF_{45}(x, y) = w\\,\\big(\\cos\\theta \\cdot a + \\sin\\theta \\cdot \\rho,\\; -\\sin\\theta \\cdot a + \\cos\\theta \\cdot \\rho\\big),\\; \\theta = \\text{rotation},\\; (a, \\rho) \\sim \\text{mode-}n(\\text{slices},\\, x_t,\\, y_t)',
    blurb: 'Rotated waffle / grid sampler by Jed Kelsey (Lu-Kout). Picks one of 5 cell-placement modes per call (RNG-heavy: ~3 rand01 draws per mode), then emits a point inside the chosen cell of a uniform grid (slice count = `slices`). Input coord is ignored. `rotation` rotates the entire grid; `xthickness` / `ythickness` control how "thick" the waffle bars are.',
    params: [
      { name: 'slices',     default: 6,   min: 1, max: 20, step: 1    },
      { name: 'xthickness', default: 0.5, min: 0, max: 1,  step: 0.05 },
      { name: 'ythickness', default: 0.5, min: 0, max: 1,  step: 0.05 },
      { name: 'rotation',   default: 0.0, min: -Math.PI, max: Math.PI, step: 0.05 },
    ],
    // RNG-driven (5 modes + nested rand draws) → no warpFn.
  },
  // ============================================================
  // #120 batch B5 — Glynn-set family (V145–V147). Source: JWildfire
  // GlynnSim1/2/3 Func (LGPL-2.1+, NOTICE.md), all by eralex61
  // (deviantart.com/eralex61). 2D siblings; GlynnSim2B (26 params,
  // full 3D shears + color modes) is deferred.
  // ============================================================
  {
    idx: V.glynnSim1,
    name: 'glynnSim1',
    source: sourceForIdx(V.glynnSim1),
    formula: 'JWF_{46}: \\text{inside radius} \\to \\text{circle at}\\;(\\text{radius}\\cos\\phi_1, \\text{radius}\\sin\\phi_1);\\; \\text{outside} \\to \\text{passthrough or }\\alpha^2\\text{ inversion}',
    blurb: 'Most elaborate of eralex61\'s Glynn-set trio. Inside the radius, emits a random point on a thickness-shaped circle offset by (radius·cos φ₁, radius·sin φ₁). Outside, randomly either passes the iterate through, applies the α² circle inversion (α = radius/r), or — if either result lands back inside the inner-circle bubble — re-emits an inner circle point. The contrast and pow params control the passthrough probability.',
    params: [
      // Catalog defaults user-tuned for visibility at the sierpinski
      // scaffold (replaces JWildfire's radius=1, radius1=0.1, thick=0.1).
      { name: 'radius',    default: 0.45,  min: 0.1, max: 2.0, step: 0.05 },
      { name: 'radius1',   default: 0.43,  min: 0.01, max: 1.0, step: 0.01 },
      { name: 'phi1',      default: 110.0, min: -180, max: 180, step: 1 },
      { name: 'thickness', default: 0.25,  min: 0,   max: 1,   step: 0.05 },
      { name: 'pow',       default: 1.5,   min: 0.1, max: 3.0, step: 0.05 },
      { name: 'contrast',  default: 0.5,   min: 0,   max: 1,   step: 0.05 },
    ],
    // RNG-driven → no warpFn.
  },
  {
    idx: V.glynnSim2,
    name: 'glynnSim2',
    source: sourceForIdx(V.glynnSim2),
    formula: 'JWF_{47}: \\text{inside radius} \\to \\text{arc at}\\;\\phi\\in[\\phi_1, \\phi_2];\\; \\text{outside} \\to \\text{passthrough or }\\alpha^2\\text{ inversion}',
    blurb: 'eralex61\'s arc-emitting GlynnSim variant. Inside the radius, emits a point on an angular arc bounded by [φ₁, φ₂] (in degrees), with radius scattered across [radius, radius+thickness] via a γ-tightened envelope. Outside the radius, same passthrough-vs-α²-inversion decision as glynnSim1 but without the re-emit check — simpler and faster.',
    params: [
      // Catalog default for radius RETUNED (was 1.0) — smaller radius
      // tucks the inner arc emit into the sierpinski's visible window.
      { name: 'radius',    default: 0.25,  min: 0.1, max: 2.0, step: 0.05 },
      { name: 'thickness', default: 0.1,   min: 0,   max: 1,   step: 0.05 },
      { name: 'contrast',  default: 0.5,   min: 0,   max: 1,   step: 0.05 },
      { name: 'pow',       default: 1.5,   min: 0.1, max: 3.0, step: 0.05 },
      { name: 'phi1',      default: 110.0, min: -180, max: 180, step: 1 },
      { name: 'phi2',      default: 150.0, min: -180, max: 180, step: 1 },
    ],
    // RNG-driven → no warpFn.
  },
  {
    idx: V.glynnSim3,
    name: 'glynnSim3',
    source: sourceForIdx(V.glynnSim3),
    formula: 'JWF_{48}: \\text{inside }r_1 \\to \\text{circle at }r_1\\text{ or }r_2;\\; \\text{outside} \\to \\text{passthrough or }\\alpha^2\\text{ inversion}',
    blurb: 'Simplest GlynnSim. Uses two computed radii r₁ = radius+thickness and r₂ = radius²/r₁, picking one or the other on each inner-circle emit via a γ-weighted coin flip. Visually creates concentric ring pairs rather than the offset-bubble effect of glynnSim1/2. **Note:** `contrast` and `pow` only gate the OUTSIDE-radius branch (passthrough vs α² inversion); at large `radius` most walkers fall inside r₁ = radius + thickness and never reach that branch — pull `radius` down to expose contrast/pow.',
    params: [
      // Catalog defaults RETUNED (was radius=1, thickness=0.1). With the
      // sierpinski scaffold's extent ~1, radius=1 swallowed all walkers
      // inside r₁=1.1 and the contrast/pow gate never fired. radius=0.5,
      // thickness=0.2 puts r₁=0.7 inside the sierpinski extent so corners
      // fall outside, exposing the gate.
      { name: 'radius',    default: 0.5, min: 0.1, max: 2.0, step: 0.05 },
      { name: 'thickness', default: 0.2, min: 0,   max: 1,   step: 0.05 },
      { name: 'contrast',  default: 0.5, min: 0,   max: 1,   step: 0.05 },
      { name: 'pow',       default: 1.3, min: 0.1, max: 3.0, step: 0.05 },
    ],
    // RNG-driven → no warpFn.
  },
  // ============================================================
  // #120 batch B6 — Faber/Xyrus02/zephyrtronium novelties
  // (V148–V151). Sources: JWildfire FlipYFunc (Michael Faber),
  // EclipseFunc (Faber), BarycentroidFunc (Xyrus02), ChunkFunc
  // (zephyrtronium via Brad Stefanov). All LGPL-2.1+, NOTICE.md.
  // All deterministic → all have warpFn.
  // ============================================================
  {
    idx: V.flipy,
    name: 'flipy',
    source: sourceForIdx(V.flipy),
    formula: 'JWF_{49}(x, y) = \\begin{cases} w\\,(x, -y) & x > 0 \\\\ w\\,(x, y) & x \\le 0 \\end{cases}',
    blurb: 'Asymmetric y-axis flip by Michael Faber. The simplest variation in pyr3 — zero params. When x > 0 the y-coord is negated; when x ≤ 0 it passes through. Mirrors the right half of any shape vertically while leaving the left half alone.',
    warpFn: (x, y) => {
      const ys = x > 0 ? -1 : 1;
      return [x, y * ys];
    },
  },
  {
    idx: V.eclipse,
    name: 'eclipse',
    source: sourceForIdx(V.eclipse),
    formula: 'JWF_{50}(x, y) = \\begin{cases} w\\,(x + \\mathrm{shift}\\cdot w,\\; y) & |y| \\le w,\\; |x| \\le c_2,\\; |x + \\mathrm{shift}\\cdot w| < c_2 \\\\ w\\,(-x,\\; y) & |y| \\le w,\\; |x| \\le c_2,\\; |x + \\mathrm{shift}\\cdot w| \\ge c_2 \\\\ w\\,(x,\\; y) & \\text{otherwise} \\end{cases},\\; c_2 = \\sqrt{\\max(w^2 - y^2,\\,0)}',
    blurb: 'Branchy ellipse fold by Michael Faber. Inside the strip |y| ≤ w the variation computes the half-width c₂ = √(w² − y²) and either passes x through, shifts it by `shift·w`, or negates it depending on which sub-region the iterate lands in. Outside the strip, plain passthrough. Distinctive eclipse-crescent silhouettes around the strip boundary.',
    params: [
      // Catalog default shift RETUNED from 0.0 — at shift=0 the fold is
      // degenerate; shift=0.25 surfaces the characteristic cascade.
      { name: 'shift', default: 0.25, min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const w = 1.0, shift = 0.25;
      if (Math.abs(y) <= w) {
        const c2 = Math.sqrt(Math.max(w * w - y * y, 0));
        let ox: number;
        if (Math.abs(x) <= c2) {
          const xs = x + shift * w;
          ox = Math.abs(xs) >= c2 ? -w * x : w * xs;
        } else {
          ox = w * x;
        }
        return [ox, w * y];
      }
      return [w * x, w * y];
    },
  },
  {
    idx: V.barycentroid,
    name: 'barycentroid',
    source: sourceForIdx(V.barycentroid),
    formula: 'JWF_{51}(x, y) = w\\,(\\sqrt{u^2 + x^2}\\cdot\\mathrm{sgn}(u),\\; \\sqrt{v^2 + y^2}\\cdot\\mathrm{sgn}(v)),\\; (u, v) = \\text{barycentric}(p; v_0=(a,b), v_1=(c,d))',
    blurb: 'Barycentric-coordinate fold by Xyrus02. Treats (a, b) and (c, d) as two basis vectors of a triangle anchored at the origin; computes the barycentric coordinates (u, v) of the iterate; emits a sign-preserving magnitude blend with the input coords. At the identity basis (a=d=1, b=c=0) reduces to (±|p|·sign(p), ±|p|·sign(p)).',
    params: [
      { name: 'a', default: 1.0, min: -2, max: 2, step: 0.05 },
      { name: 'b', default: 0.0, min: -2, max: 2, step: 0.05 },
      { name: 'c', default: 0.0, min: -2, max: 2, step: 0.05 },
      { name: 'd', default: 1.0, min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const a = 1.0, b = 0.0, c = 0.0, d = 1.0;
      const dot00 = a * a + b * b;
      const dot01 = a * c + b * d;
      const dot02 = a * x + b * y;
      const dot11 = c * c + d * d;
      const dot12 = c * x + d * y;
      const denom = dot00 * dot11 - dot01 * dot01;
      if (Math.abs(denom) < 1e-30) return [x, y];
      const invDenom = 1.0 / denom;
      const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
      const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
      const um = Math.sqrt(u * u + x * x) * Math.sign(u);
      const vm = Math.sqrt(v * v + y * y) * Math.sign(v);
      return [um, vm];
    },
  },
  {
    idx: V.chunk,
    name: 'chunk',
    source: sourceForIdx(V.chunk),
    formula: 'JWF_{52}: r = w(ax^2 + bxy + cy^2 + dx + ey + f),\\; \\text{emit }p\\text{ if mode-gate fires, else }(0,0)',
    blurb: 'Quadratic-form spatial gate by zephyrtronium (via Brad Stefanov). Computes a weight-scaled quadratic at the iterate; emits the unscaled input coord when the gate condition holds (mode 0: r ≤ 0 — inside the conic section; mode 1: r > 0 — outside), else contributes (0, 0). At the defaults (a=c=1, b=d=e=0, f=-1, mode=0) the gate selects everything inside the unit circle, producing a clean disc cutout.',
    params: [
      // Catalog defaults RETUNED — (e=0, f=-1) was a boring unit-disc
      // gate. (e=0.35, f=-0.65) shifts the gate off-origin producing
      // a striking sierpinski-clustered pattern.
      { name: 'a',    default: 1.0,   min: -2, max: 2, step: 0.05 },
      { name: 'b',    default: 0.0,   min: -2, max: 2, step: 0.05 },
      { name: 'c',    default: 1.0,   min: -2, max: 2, step: 0.05 },
      { name: 'd',    default: 0.0,   min: -2, max: 2, step: 0.05 },
      { name: 'e',    default: 0.35,  min: -2, max: 2, step: 0.05 },
      { name: 'f',    default: -0.65, min: -2, max: 2, step: 0.05 },
      { name: 'mode', default: 0,     min: 0,  max: 1, step: 1    },
    ],
    warpFn: (x, y) => {
      const a = 1.0, b = 0.0, c = 1.0, d = 0.0, e = 0.35, f = -0.65;
      const mode = 0;
      const r = a * x * x + b * x * y + c * y * y + d * x + e * y + f;
      if (mode === 0 && r <= 0) return [x, y];
      // mode-1 branch removed via narrowing — mode is literal 0 here
      return [0, 0];
    },
  },
  // ============================================================
  // #121 batch L1 — JWildfire 2D long tail (V152..V158).
  // ennepers (Raykoid666), erf (zephyrtronium / dark-beam), circus
  // (Michael Faber), asteria (dark-beam), clifford_js (Paul Bourke /
  // JWF), devil_warp (dark-beam), voron (eralex61). All 2D, all
  // deterministic except asteria (1 RNG call per iter).
  // ============================================================
  {
    idx: V.ennepers,
    name: 'ennepers',
    source: sourceForIdx(V.ennepers),
    formula: 'JWF_{53}(x, y) = w\\,(x - x^3/3,\\; y - y^3/3) + (xy^2,\\; yx^2)',
    blurb: 'Polynomial fold by Raykoid666 derived from the Enneper minimal surface 2D projection. The trailing (xy², yx²) coupling sits outside the amount multiplication — that\'s the JWildfire quirk; the result is a lattice-like distortion that pulls inward near origin and balloons at the extremes.',
    warpFn: (x, y) => {
      const w = 1.0;
      const ox = w * (x - (x * x * x) / 3.0) + x * y * y;
      const oy = w * (y - (y * y * y) / 3.0) + y * x * x;
      return [ox, oy];
    },
  },
  {
    idx: V.erf,
    name: 'erf',
    source: sourceForIdx(V.erf),
    formula: 'JWF_{54}(x, y) = w\\,(\\mathrm{erf}(x),\\; \\mathrm{erf}(y))',
    blurb: 'Per-component error function by zephyrtronium (implemented by dark-beam). Smoothly saturates the coords toward ±1 as |x| or |y| grows past ~2; for |x|<1 acts roughly linearly. Pure squashing — no rotation, no shear.',
    warpFn: (x, y) => {
      // A&S 7.1.26 — same poly used in WGSL.
      const erf = (z: number): number => {
        const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
        const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
        const s = z >= 0 ? 1 : -1;
        const az = Math.abs(z);
        const t = 1.0 / (1.0 + p * az);
        const poly = (((((a5 * t) + a4) * t + a3) * t + a2) * t + a1) * t;
        return s * (1.0 - poly * Math.exp(-az * az));
      };
      return [erf(x), erf(y)];
    },
  },
  {
    idx: V.circus,
    name: 'circus',
    source: sourceForIdx(V.circus),
    formula: "V_{154}(x, y) = w\\,r'\\,(\\cos a,\\; \\sin a),\\quad r' = \\begin{cases} r\\cdot s & r \\leq 1 \\\\ r / s & r > 1 \\end{cases}",
    blurb: 'Polar dual-scale by Michael Faber. Inside the unit circle the radius is multiplied by `scale`; outside, by `1/scale`. The phase angle is preserved, so circles map to circles — but the inside-vs-outside discontinuity at r=1 produces a striking concentric-ring boundary.',
    params: [
      // Catalog default RETUNED — JWildfire's 0.92 makes a clean but
      // sparse sierpinski; 1.25 fills out the gasket and surfaces the
      // characteristic ring-banding inside the r=1 boundary. The .flame
      // importer default stays at JWildfire 0.92 (see VARIATION_DEFAULTS
      // in serialize.ts) — this only changes the catalog scaffold seed.
      { name: 'scale', default: 1.25, min: 0.05, max: 2.0, step: 0.01 },
    ],
    warpFn: (x, y) => {
      const scale = 1.25;
      const scale_1 = 1.0 / scale;
      const r = Math.sqrt(x * x + y * y);
      const a = Math.atan2(y, x);
      const r2 = r <= 1.0 ? r * scale : r * scale_1;
      return [r2 * Math.cos(a), r2 * Math.sin(a)];
    },
  },
  {
    idx: V.asteria,
    name: 'asteria',
    source: sourceForIdx(V.asteria),
    formula: 'JWF_{56}: \\text{rotate by }\\pi\\alpha,\\; \\text{project }x \\to x/\\sqrt{1-y^2}\\cdot(1 - \\sqrt{1-(1-|y|)^2}),\\; \\text{rotate back; or identity}',
    blurb: 'Branchy fold by dark-beam. Tests whether the iterate is both inside the unit circle AND inside the diamond defined by (|x|-1)² + (|y|-1)² ≤ 1; when both fire, an RNG coin decides between identity passthrough and the asteria projection. Produces sharp four-pointed star silhouettes (the namesake) at α ≈ 0.1.',
    params: [
      // alpha=0 is a degenerate identity branch; default 0.1 surfaces
      // the characteristic asteroid silhouette inside the sierpinski
      // scaffold's extent per [[reference-pyr3-catalog-sierpinski-bias]].
      { name: 'alpha', default: 0.1, min: -1, max: 1, step: 0.02 },
    ],
    // RNG-driven — no warpFn (catalog renders "warp not applicable" note).
  },
  {
    idx: V.clifford_js,
    name: 'clifford_js',
    source: sourceForIdx(V.clifford_js),
    formula: "V_{156}(x, y) = w\\,(\\sin(ay) + c\\cos(ax),\\; \\sin(bx) + d\\cos(by))",
    blurb: "Paul Bourke's classic Clifford attractor, ported into JWildfire by Brad Stefanov. The 4 params (a, b, c, d) tune the sin/cos coupling between axes; at the canonical defaults (a=-1.4, b=1.6, c=1, d=0.7) the attractor traces dense, wing-shaped orbits.",
    params: [
      { name: 'a', default: -1.4, min: -3, max: 3, step: 0.05 },
      { name: 'b', default:  1.6, min: -3, max: 3, step: 0.05 },
      { name: 'c', default:  1.0, min: -3, max: 3, step: 0.05 },
      { name: 'd', default:  0.7, min: -3, max: 3, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const a = -1.4, b = 1.6, c = 1.0, d = 0.7;
      const nx = Math.sin(a * y) + c * Math.cos(a * x);
      const ny = Math.sin(b * x) + d * Math.cos(b * y);
      return [nx, ny];
    },
  },
  {
    idx: V.devil_warp,
    name: 'devil_warp',
    source: sourceForIdx(V.devil_warp),
    formula: "V_{157}: r = (x^2 + r_2 b y^2)^{warp} - (y^2 + r_2 a x^2)^{warp},\\; r_2 = 1/(x^2+y^2),\\; \\text{emit }p\\cdot(1 + e\\,\\mathrm{clamp}(r))",
    blurb: 'Radial pow-warp by dark-beam. Computes a pair of pow-weighted radial terms and uses their difference to scale the iterate outward (positive r) or inward (negative r). The rmin/rmax clamp keeps the warp bounded; `effect` is a global gain. Produces wing-shaped or curl-tendril textures depending on a/b/warp.',
    params: [
      { name: 'a',      default:  2.0,   min: -3,  max: 3,   step: 0.05 },
      { name: 'b',      default:  1.0,   min: -3,  max: 3,   step: 0.05 },
      { name: 'effect', default:  1.0,   min: -3,  max: 3,   step: 0.05 },
      { name: 'warp',   default:  0.5,   min: -2,  max: 2,   step: 0.05 },
      { name: 'rmin',   default: -0.24,  min: -5,  max: 5,   step: 0.05 },
      { name: 'rmax',   default:  100.0, min: 1,   max: 200, step: 1    },
    ],
    warpFn: (x, y) => {
      const a = 2.0, b = 1.0, effect = 1.0, warp = 0.5, rmin = -0.24, rmax = 100.0;
      const rsum = Math.max(x * x + y * y, 1e-30);
      const r2 = 1.0 / rsum;
      const baseA = x * x + r2 * b * y * y;
      const baseB = y * y + r2 * a * x * x;
      const powA = baseA > 0 ? Math.pow(baseA, warp) : 0;
      const powB = baseB > 0 ? Math.pow(baseB, warp) : 0;
      let r = powA - powB;
      r = Math.min(rmax, Math.max(rmin, r));
      r = effect * r;
      return [x * (1.0 + r), y * (1.0 + r)];
    },
  },
  {
    idx: V.voron,
    name: 'voron',
    source: sourceForIdx(V.voron),
    formula: 'JWF_{59}: \\text{find nearest jittered cell center }(X_0, Y_0)\\text{ in }3\\times 3\\text{ neighborhood},\\; \\text{emit }(k(x-X_0)+X_0,\\; k(y-Y_0)+Y_0)\\cdot w',
    blurb: 'Voronoi cell distance field by eralex61. Hashes each grid cell deterministically into 1..num jittered "site" points; the iterate is pulled toward the nearest site by `(1-k)` and emitted on the other side scaled by `k`. Produces irregular Voronoi-tile textures with cell sizes set by `step`.',
    params: [
      { name: 'k',     default: 0.99, min: -1, max: 2,  step: 0.01 },
      // step=0.5 (was JWildfire 0.25) — wider cells ensure the
      // sierpinski scaffold's extent ≈ 1 spans at least one cell
      // boundary per [[reference-pyr3-catalog-sierpinski-bias]].
      { name: 'step',  default: 0.5,  min: 0.05, max: 2, step: 0.05 },
      { name: 'num',   default: 1,    min: 1,  max: 25, step: 1    },
      { name: 'xseed', default: 3,    min: 1,  max: 999, step: 1   },
      { name: 'yseed', default: 7,    min: 1,  max: 999, step: 1   },
    ],
    warpFn: (x, y) => {
      const k = 0.99, step = 0.5, num = 1, xseed = 3, yseed = 7;
      // Pure i32 hash mirroring discret_noise_voron in chaos.wgsl.
      const discret = (n: number): number => {
        let s = (n << 13) ^ n;
        // JS 32-bit i32 ops via |0 + Math.imul wrap correctly.
        const inner = Math.imul(s, s);
        const inner2 = Math.imul(inner, 15731) + 789221;
        const r = (Math.imul(s, inner2) + 1376312589) & 0x7fffffff;
        return r * (1.0 / 2147483647.0);
      };
      const M = Math.floor(x / step);
      const N = Math.floor(y / step);
      let rmin = 20.0, X0 = 0.0, Y0 = 0.0;
      for (let i = -1; i < 2; i++) {
        const M1 = M + i;
        for (let j = -1; j < 2; j++) {
          const N1 = N + j;
          const K = 1 + Math.floor(num * discret(19 * M1 + 257 * N1 + xseed));
          for (let l = 0; l < K; l++) {
            const X = (discret(l + 64 * M1 + 15 * N1 + xseed) + M1) * step;
            const Y = (discret(l + 21 * M1 + 33 * N1 + yseed) + N1) * step;
            const ox = x - X, oy = y - Y;
            const r = Math.sqrt(ox * ox + oy * oy);
            if (r < rmin) { rmin = r; X0 = X; Y0 = Y; }
          }
        }
      }
      return [k * (x - X0) + X0, k * (y - Y0) + Y0];
    },
  },
  // ============================================================
  // #121 batch L2 — JWildfire 2D long tail (V159..V165).
  // henon (TyrantWave), atan (FractalDesire/Brad Stefanov), cardioid
  // (Faber), chrysanthemum (Sosa/Bourke), bcollide (Faber), bsplit
  // (Raykoid666/Nic Anderson), bulge. Mix of attractor + curves +
  // boundary effects. chrysanthemum is RNG-driven base shape.
  // ============================================================
  {
    idx: V.henon,
    name: 'henon',
    source: sourceForIdx(V.henon),
    formula: "V_{159}(x, y) = w\\,(c - a\\,x^2 + y,\\; b\\,x)",
    blurb: "TyrantWave's port of the Hénon map, the Bourke-attractor sibling of V156 clifford_js. The classic chaotic dynamics produce a strange-attractor cloud whose density shifts dramatically with tiny moves in the (a, b, c) tuning.",
    params: [
      { name: 'a', default: 0.5, min: -2, max: 2, step: 0.05 },
      { name: 'b', default: 1.0, min: -2, max: 2, step: 0.05 },
      { name: 'c', default: 1.0, min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const a = 0.5, b = 1.0, c = 1.0;
      return [c - a * x * x + y, b * x];
    },
  },
  {
    idx: V.atan,
    name: 'atan',
    source: sourceForIdx(V.atan),
    formula: "V_{160}: \\text{mode 0: }(w\\,x,\\; (w/(\\pi/2))\\arctan(s\\,y));\\; \\text{mode 1: swap}; \\text{mode 2: both arctan}",
    blurb: "FractalDesire's 3-mode arctan saturation (via Brad Stefanov). Like erf, this gently squashes coords toward ±1 — but only along the axis selected by mode (0=y only, 1=x only, 2=both). The `stretch` knob controls how aggressively the saturation kicks in.",
    params: [
      { name: 'mode',    default: 0,   min: 0,   max: 2,  step: 1    },
      { name: 'stretch', default: 1.0, min: 0.05, max: 5, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const stretch = 1.0;
      const norm = 1.0 / (Math.PI / 2);
      // mode-0 default narrows to (x, norm·atan(stretch·y)).
      return [x, norm * Math.atan(stretch * y)];
    },
  },
  {
    idx: V.cardioid,
    name: 'cardioid',
    source: sourceForIdx(V.cardioid),
    formula: "V_{161}(x, y) = w\\,r'\\,(\\cos\\theta,\\; \\sin\\theta),\\quad r' = \\sqrt{x^2 + y^2 + \\sin(a\\theta) + 1}",
    blurb: "Michael Faber's polar curve variation. Radius is augmented by sin(a·θ) before sqrt — at a=1 traces a cardioid-like silhouette; integer a values produce multi-cusped rose shapes; non-integer a produces irregular fold patterns.",
    params: [
      { name: 'a', default: 1.0, min: 0.05, max: 8, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const a = 1.0;
      const theta = Math.atan2(y, x);
      const rSq = x * x + y * y + Math.sin(a * theta) + 1.0;
      const r = Math.sqrt(Math.max(rSq, 0));
      return [r * Math.cos(theta), r * Math.sin(theta)];
    },
  },
  {
    idx: V.chrysanthemum,
    name: 'chrysanthemum',
    source: sourceForIdx(V.chrysanthemum),
    formula: "V_{162}: u \\sim U[0, 21\\pi];\\; r = w \\cdot 0.1 (5(1 + \\sin(11u/5)) - 4\\sin^4(17u/3)\\sin^8(2\\cos 3u - 28u));\\; \\text{emit }r\\,(\\cos u, \\sin u)",
    blurb: "Jesus Sosa's port of Paul Bourke's chrysanthemum curve. RNG-driven base shape — samples u uniformly across 21π and computes the namesake parametric curve. Produces dense flower-petal silhouettes; the high-frequency p4/p8 sin products contribute the characteristic chrysanthemum scallops.",
    // RNG-driven base shape — no warpFn (catalog renders "warp not applicable" note).
  },
  {
    idx: V.bcollide,
    name: 'bcollide',
    source: sourceForIdx(V.bcollide),
    formula: "V_{163}: \\text{bipolar }(\\tau, \\sigma) \\text{ on }p;\\; \\text{fold }\\sigma\\text{ into }num\\text{ wedges with phase }\\pi a/num;\\; \\text{emit }w(\\sinh \\tau, \\sin \\sigma)/(\\cosh \\tau - \\cos \\sigma)",
    blurb: "Michael Faber's boundary-collision variation (from his bSeries). Maps the iterate into bipolar coordinates, folds the angular coordinate into `num` equal wedges with alternating phase offsets, then projects back via the Möbius-style bipolar inverse. Produces multi-petal symmetric shapes that pinch toward the focal points (±1, 0).",
    params: [
      // Catalog defaults RETUNED — at (num=1, a=0) the bipolar fold is
      // near-identity on the sierpinski scaffold (verified visually).
      // (num=4, a=0.5) surfaces the characteristic 4-wedge collision
      // pattern with mid-strength phase offset — the namesake "collision"
      // discontinuities at wedge boundaries become clearly visible.
      { name: 'num', default: 4,    min: 1,    max: 16, step: 1    },
      { name: 'a',   default: 0.5,  min: 0,    max: 1,  step: 0.05 },
    ],
    warpFn: (x, y) => {
      const num = 4, a = 0.5;
      const bcn_pi = num / Math.PI;
      const pi_bcn = Math.PI / num;
      const bca_bcn = Math.PI * a / num;
      const xp1 = x + 1.0, xm1 = x - 1.0, y2 = y * y;
      const tau = 0.5 * (Math.log(Math.max(xp1 * xp1 + y2, 1e-30)) - Math.log(Math.max(xm1 * xm1 + y2, 1e-30)));
      const sigmaRaw = Math.PI - Math.atan2(y, xp1) - Math.atan2(y, 1.0 - x);
      const alt = Math.trunc(sigmaRaw * bcn_pi);
      const altEven = (alt & 1) === 0;
      const offset = altEven ? bca_bcn : -bca_bcn;
      const arg = sigmaRaw + offset;
      const folded = arg - Math.floor(arg / pi_bcn) * pi_bcn;
      const sigma = alt * pi_bcn + folded;
      const cosh = (z: number): number => 0.5 * (Math.exp(z) + Math.exp(-z));
      const sinh = (z: number): number => 0.5 * (Math.exp(z) - Math.exp(-z));
      const temp = cosh(tau) - Math.cos(sigma);
      const tempSafe = Math.abs(temp) < 1e-30 ? 1e-30 : temp;
      return [sinh(tau) / tempSafe, Math.sin(sigma) / tempSafe];
    },
  },
  {
    idx: V.bsplit,
    name: 'bsplit',
    source: sourceForIdx(V.bsplit),
    formula: "V_{164}(x, y) = w\\,(\\cos(y + s_y)/\\tan(x + s_x),\\; (-y + s_y)/\\sin(x + s_x))",
    blurb: "Raykoid666's tan/sin shift variation (transcribed by Nic Anderson). Combines a cotangent-weighted x term and a cosecant-weighted y term, producing fan-like silhouettes that radiate from the periodic singularities of sin(x+sx). Emits nothing at the singularity.",
    params: [
      // Catalog default RETUNED: sx=1.0 (was JWildfire 0) — at (sx,sy)=(0,0)
      // the iterate hits the singularity at every x=0 point of the sierpinski
      // scaffold; sx=1 shifts the singularity off-scaffold so we see the
      // characteristic fan radiation.
      { name: 'x', default: 1.0, min: -3, max: 3, step: 0.05 },
      { name: 'y', default: 0.0, min: -3, max: 3, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const sx = 1.0, sy = 0.0;
      const argX = x + sx;
      const sinX = Math.sin(argX);
      if (Math.abs(sinX) < 1e-6) return [0, 0];
      const cosX = Math.cos(argX);
      const tanX = sinX / cosX;
      const tanSafe = Math.abs(cosX) < 1e-6 ? Math.sign(tanX) * 1e6 : tanX;
      return [Math.cos(y + sy) / tanSafe, (-y + sy) / sinX];
    },
  },
  {
    idx: V.bulge,
    name: 'bulge',
    source: sourceForIdx(V.bulge),
    formula: "V_{165}(x, y) = w\\,p \\cdot r^{N-1},\\quad r = \\sqrt{x^2 + y^2}",
    blurb: "Radial r^N bulge effect. N>1 stretches the periphery outward (bulge / fisheye); N<1 compresses toward the origin (pinch); N=1 is identity. At N=0.45 (sub-1 pinch power) on the sierpinski scaffold surfaces a striking fractal-lattice spheroid with hexagonal cells radiating from the centerline.",
    params: [
      // Catalog default RETUNED — N=2.0 (JWildfire default) is a smooth
      // zoom-out; N=0.45 surfaces the fractal-lattice spheroid that's much
      // more visually distinctive at the sierpinski scaffold's extent.
      { name: 'N', default: 0.45, min: 0.1, max: 5, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const N = 0.45;
      const r = Math.sqrt(x * x + y * y);
      const rSafe = Math.max(r, 1e-30);
      const rn = Math.pow(rSafe, N);
      const scale = rn / rSafe;
      return [x * scale, y * scale];
    },
  },
  // ============================================================
  // #121 batch L3 — JWildfire 2D continuing (V166..V170).
  // checks (Keeps/Xyrus02), circular + circular2 (Tatyana Zabanova
  // via Brad Stefanov), corners (Whittaker Courtney), circleblur
  // (Zyorg uniform disc sampler). 4 RNG-using + 1 deterministic.
  // ============================================================
  {
    idx: V.checks,
    name: 'checks',
    source: sourceForIdx(V.checks),
    formula: "V_{166}: \\text{is\\_xy} = \\text{round}(x/s) + \\text{round}(y/s);\\; \\text{branch on parity for cell offset}",
    blurb: "Keeps + Xyrus02's checkered pattern. Rounds the iterate to cell indices, alternates between two offset schemes based on cell-coordinate parity (the checkerboard), adds per-axis RNG jitter `rnd` to soften the cell edges. Produces square-grid patterns with offsets controlled by (x, y).",
    params: [
      { name: 'x',    default: 3.0, min: -10, max: 10, step: 0.1 },
      { name: 'y',    default: 3.0, min: -10, max: 10, step: 0.1 },
      { name: 'size', default: 1.0, min: 0.05, max: 5, step: 0.05 },
      { name: 'rnd',  default: 0.5, min: 0, max: 2, step: 0.05 },
    ],
    // RNG-using — no warpFn (catalog renders "warp not applicable" note).
  },
  {
    idx: V.circular,
    name: 'circular',
    source: sourceForIdx(V.circular),
    formula: "V_{167}: r = \\sqrt{x^2+y^2},\\; \\text{rotate by }(2(rng + \\text{hash}(p, \\text{seed})) - 2) \\cdot \\text{angle}\\cdot\\pi/180",
    blurb: "Tatyana Zabanova's hash-jitter circular rotation (transcribed by Brad Stefanov). Uses a sin-based spatial hash plus an RNG sample to produce a per-iter angular rotation around the origin — preserves radius, perturbs angle. Produces orbital halo patterns.",
    params: [
      { name: 'angle', default: 90.0, min: -180, max: 180, step: 1 },
      { name: 'seed',  default: 0.0,  min: 0,    max: Math.PI, step: 0.01 },
    ],
    // RNG-using — no warpFn.
  },
  {
    idx: V.circular2,
    name: 'circular2',
    source: sourceForIdx(V.circular2),
    formula: "V_{168}: \\text{same as circular but user-controlled hash multipliers }(xx, yy)",
    blurb: "Tatyana Zabanova's circular with exposed spatial-hash constants (xx, yy default 12.9898, 78.233 — the classic Pixar-GLSL hash). Same rotation algorithm as V167 circular but with knobs that change the spatial frequency of the jitter pattern.",
    params: [
      { name: 'angle', default: 90.0,    min: -180, max: 180, step: 1 },
      { name: 'seed',  default: 0.0,     min: 0,    max: Math.PI, step: 0.01 },
      { name: 'xx',    default: 12.9898, min: -100, max: 100, step: 0.1 },
      { name: 'yy',    default: 78.233,  min: -100, max: 100, step: 0.1 },
    ],
    // RNG-using — no warpFn.
  },
  {
    idx: V.corners,
    name: 'corners',
    source: sourceForIdx(V.corners),
    formula: "V_{169}: e_x = (x^2)^{x_{pow} + xy_{pow}}\\cdot m_x,\\; \\text{sign-flip on input }x;\\; +c_x \\text{ offset};\\; \\text{symmetric for }y",
    blurb: "Whittaker Courtney's corners variation. Power-law warp on (x², y²) with sign flipping driven by input sign — produces sharp corner-anchored shapes that radiate to the four quadrants. Optional `log_mode` wraps the power with a configurable log base for softer falloff. Highly tunable.",
    params: [
      { name: 'x',            default:  0.75,   min: -3, max: 3,   step: 0.05 },
      { name: 'y',            default: -0.10,   min: -3, max: 3,   step: 0.05 },
      { name: 'mult_x',       default: -0.70,   min: -3, max: 3,   step: 0.05 },
      { name: 'mult_y',       default: -1.95,   min: -3, max: 3,   step: 0.05 },
      { name: 'x_power',      default:  0.85,   min: 0,  max: 3,   step: 0.05 },
      { name: 'y_power',      default:  0.95,   min: 0,  max: 3,   step: 0.05 },
      { name: 'xy_power_add', default: -0.05,   min: -2, max: 2,   step: 0.05 },
      { name: 'log_mode',     default: 0,       min: 0,  max: 1,   step: 1    },
      { name: 'log_base',     default: 2.70,    min: 1.5, max: 10, step: 0.1  },
    ],
    warpFn: (x, y) => {
      const cx = 0.75, cy = -0.10, mult_x = -0.70, mult_y = -1.95;
      const x_power = 0.85, y_power = 0.95, xy_power_add = -0.05;
      const log_mode = 0;
      const xs = x * x, ys = y * y;
      let ex: number, ey: number;
      if (log_mode === 0) {
        ex = Math.pow(Math.max(xs, 0), x_power + xy_power_add) * mult_x;
        ey = Math.pow(Math.max(ys, 0), y_power + xy_power_add) * mult_y;
      } else {
        // log_mode=1 branch narrowed away — not reachable at default 0.
        ex = 0;
        ey = 0;
      }
      const ox = x > 0 ? ex + cx : -ex - cx;
      const oy = y > 0 ? ey + cy : -ey - cy;
      return [ox, oy];
    },
  },
  {
    idx: V.circleblur,
    name: 'circleblur',
    source: sourceForIdx(V.circleblur),
    formula: "V_{170}: r = \\sqrt{\\text{rng}},\\; \\theta = \\text{rng}\\cdot 2\\pi;\\; \\text{emit }w \\cdot r \\cdot (\\cos\\theta, \\sin\\theta)",
    blurb: "Zyorg's uniform-disc sampler. Pure RNG base shape — samples a point uniformly inside the unit disc (the sqrt(uniform) trick gives correct area-uniform sampling, NOT angle-uniform). Input (x, y) is ignored. Produces a clean filled circle; useful as a soft halo behind other variations.",
    // RNG-only base shape — no warpFn.
  },
  // ============================================================
  // #121 batch L4 — JWildfire 2D continuing (V171..V175).
  // fibonacci2 (Larry Berlin), hypertile + hypertile1 + hypertile2
  // (Zueuk hyperbolic Möbius tiling family), idisc (Faber).
  // ============================================================
  {
    idx: V.fibonacci2,
    name: 'fibonacci2',
    source: sourceForIdx(V.fibonacci2),
    formula: "V_{171}: z' = (\\varphi^z - (-\\varphi)^{-z})/\\sqrt{5},\\; \\varphi = \\text{golden ratio}",
    blurb: "Larry Berlin's golden-ratio Fibonacci curve. Computes (φ^z - (-φ)^(-z))/√5 — the closed-form Binet formula that generates the Fibonacci sequence for real-integer z. Produces an elegant logarithmic-spiral fan with the φ-rate growth characteristic of natural Fibonacci-like patterns.",
    params: [
      { name: 'sc',  default: 1.0, min: 0.1, max: 3, step: 0.05 },
      { name: 'sc2', default: 1.0, min: 0.1, max: 3, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const sc = 1.0, sc2 = 1.0;
      const ffive = 0.447213595, fnatlog = 0.481211825;
      const a = y * fnatlog;
      const snum1 = Math.sin(a), cnum1 = Math.cos(a);
      const b = (x * Math.PI + y * fnatlog) * -1.0;
      const snum2 = Math.sin(b), cnum2 = Math.cos(b);
      const eradius1 = sc * Math.exp(sc2 * (x * fnatlog));
      const eradius2 = sc * Math.exp(sc2 * ((x * fnatlog - y * Math.PI) * -1));
      return [
        (eradius1 * cnum1 - eradius2 * cnum2) * ffive,
        (eradius1 * snum1 - eradius2 * snum2) * ffive,
      ];
    },
  },
  {
    idx: V.hypertile,
    name: 'hypertile',
    source: sourceForIdx(V.hypertile),
    formula: "V_{172}: \\text{Möbius for }\\{p, q\\}\\text{ tiling};\\; r, (re, im)\\text{ from }p, q, n;\\; \\text{emit }(a + bi)/(c + di)",
    blurb: "Zueuk's hyperbolic {p, q} tiling Möbius generator. (p, q) are the Schläfli symbols of the tiling (e.g. {3, 7} is a triangle tiling with 7 triangles meeting at each vertex — only possible in hyperbolic geometry). The `n` parameter picks which vertex of the fundamental polygon to anchor the transform to.",
    params: [
      { name: 'p', default: 3, min: 3, max: 12, step: 1 },
      { name: 'q', default: 7, min: 3, max: 12, step: 1 },
      { name: 'n', default: 1, min: 0, max: 11, step: 1 },
    ],
    warpFn: (x, y) => {
      const p_p = 3, q = 7, n = 1;
      const pa = 2 * Math.PI / p_p, qa = 2 * Math.PI / q;
      const denom = Math.cos(pa) + Math.cos(qa);
      const r2 = Math.abs(denom) > 1e-30 ? (1 - Math.cos(pa)) / denom + 1 : 1;
      const r = r2 > 0 ? 1 / Math.sqrt(Math.max(r2, 1e-30)) : 1;
      const an = n * pa;
      const re = r * Math.cos(an), im = r * Math.sin(an);
      const a = x + re, b = y - im;
      const c = re * x - im * y + 1, d = re * y + im * x;
      const cd2 = Math.max(c * c + d * d, 1e-30);
      const vr = 1 / cd2;
      return [vr * (a * c + b * d), vr * (b * c - a * d)];
    },
  },
  {
    idx: V.hypertile1,
    name: 'hypertile1',
    source: sourceForIdx(V.hypertile1),
    formula: "V_{173}: \\text{hypertile with }n\\text{ randomized per iter}",
    blurb: "Zueuk's hypertile1 — same {p, q} hyperbolic tiling as V172 hypertile but the vertex-anchor index `n` is randomized per iter. Produces a denser, more uniformly filled hyperbolic tile pattern.",
    params: [
      { name: 'p', default: 3, min: 3, max: 12, step: 1 },
      { name: 'q', default: 7, min: 3, max: 12, step: 1 },
    ],
    // RNG-using — no warpFn.
  },
  {
    idx: V.hypertile2,
    name: 'hypertile2',
    source: sourceForIdx(V.hypertile2),
    formula: "V_{174}: \\text{hypertile with rotation jitter applied POST-projection}",
    blurb: "Zueuk's hypertile2 — same Möbius tiling but the per-iter rotation jitter is applied AFTER the (re, im) projection, producing a subtly different tile structure than V173 hypertile1.",
    params: [
      { name: 'p', default: 3, min: 3, max: 12, step: 1 },
      { name: 'q', default: 7, min: 3, max: 12, step: 1 },
    ],
    // RNG-using — no warpFn.
  },
  {
    idx: V.idisc,
    name: 'idisc',
    source: sourceForIdx(V.idisc),
    formula: "V_{175}(x, y) = (w/\\pi)\\,\\text{atan2}(y, x)\\,(\\cos a, \\sin a),\\; a = \\pi/(r + 1)",
    blurb: "Michael Faber's inverse-radius disc projection (from The Lost Variations). Smoothly pulls the entire plane onto a bounded disc — distant points map near the disc boundary, origin maps to the boundary too. Produces clean radial-pull silhouettes that frame nicely inside other variations.",
    warpFn: (x, y) => {
      const r = Math.sqrt(x * x + y * y);
      const a = Math.PI / (r + 1);
      const v = Math.atan2(y, x) / Math.PI;
      return [v * Math.cos(a), v * Math.sin(a)];
    },
  },
  // ============================================================
  // #121 batch L5 — JWildfire 2D continuing (V176..V180).
  // hole (Faber), kaleidoscope + layered_spiral (Will Evans),
  // linear_t (FractalDesire), line (Nic Anderson 2D-projection of
  // 3D base shape).
  // ============================================================
  {
    idx: V.hole,
    name: 'hole',
    source: sourceForIdx(V.hole),
    formula: "V_{176}: \\delta = (\\alpha/\\pi + 1)^a;\\; r = \\sqrt{x^2+y^2+\\delta}\\text{ or }\\delta/(x^2+y^2+\\delta);\\; \\alpha = \\text{atan2}(y, x)",
    blurb: "Michael Faber's hole variation. Polar radial branch — `inside=0` emits sqrt(x²+y²+δ) (outward push), `inside=1` emits the inverse δ/(x²+y²+δ) (inward pull to origin). The δ term is a power of (angle/π + 1) — creates the characteristic angular hole pattern.",
    params: [
      { name: 'a',      default: 1.0, min: -3, max: 3, step: 0.05 },
      { name: 'inside', default: 0,   min: 0,  max: 1, step: 1    },
    ],
    warpFn: (x, y) => {
      const a = 1.0, inside = 0;
      const alpha = Math.atan2(y, x);
      const delta = Math.pow(Math.max(alpha / Math.PI + 1, 1e-30), a);
      const sumsq = x * x + y * y;
      // inside-branch narrowed away at default=0.
      const r = inside === 0
        ? Math.sqrt(Math.max(sumsq + delta, 0))
        : delta / Math.max(sumsq + delta, 1e-30);
      return [r * Math.cos(alpha), r * Math.sin(alpha)];
    },
  },
  {
    idx: V.kaleidoscope,
    name: 'kaleidoscope',
    source: sourceForIdx(V.kaleidoscope),
    formula: "V_{177}: \\text{split at }y=0;\\; \\text{apply 45-rad rotation+offset to each half}",
    blurb: "Will Evans's kaleidoscope. Splits the plane at y=0 and applies a 45-radian (NOT degree — JWildfire quirk) rotation+offset to each half. `pull` separates the two halves; `rotate` scales both; `line_up` provides a phase offset; (x, y) translate one half. Produces sharp split-symmetry patterns.",
    params: [
      { name: 'pull',    default: 0.0, min: -3, max: 3, step: 0.05 },
      { name: 'rotate',  default: 1.0, min: -3, max: 3, step: 0.05 },
      { name: 'line_up', default: 1.0, min: -3, max: 3, step: 0.05 },
      { name: 'x',       default: 0.0, min: -3, max: 3, step: 0.05 },
      { name: 'y',       default: 0.0, min: -3, max: 3, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const pull = 0, rotate = 1, line_up = 1, off_x = 0, off_y = 0;
      const c45 = Math.cos(45), s45 = Math.sin(45);
      const ox = ((rotate * x) * c45 - y * s45 + line_up) + off_x;
      const oy = y > 0
        ? ((rotate * y) * c45 + x * s45 + pull + line_up) + off_y
        : (rotate * y) * c45 + x * s45 - pull - line_up;
      return [ox, oy];
    },
  },
  {
    idx: V.layered_spiral,
    name: 'layered_spiral',
    source: sourceForIdx(V.layered_spiral),
    formula: "V_{178}(x, y) = w \\cdot x \\cdot \\text{radius} \\cdot (\\cos t,\\; \\sin t),\\; t = x^2 + y^2",
    blurb: "Will Evans's layered spiral. Polar spiral where the angular phase is r² (so points further from origin spin faster) and the radial scale is x·radius. Produces concentric spiral arms with x-axis-modulated brightness.",
    params: [
      // #246: curated default (JWF/engine use 1.0). radius is a linear gain on
      // the output, so 2.10 just makes a livelier, more spread-out default
      // catalog thumbnail — cosmetic only; existing/imported flames carry their
      // own radius and are unaffected.
      { name: 'radius', default: 2.10, min: 0.05, max: 5, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const radius = 2.10;
      const a = x * radius;
      const t = x * x + y * y + 1e-30;
      return [a * Math.cos(t), a * Math.sin(t)];
    },
  },
  {
    idx: V.linear_t,
    name: 'linear_t',
    source: sourceForIdx(V.linear_t),
    formula: "V_{179}(x, y) = w\\,(\\text{sgn}(x)|x|^{powX},\\; \\text{sgn}(y)|y|^{powY})",
    blurb: "FractalDesire's linearT — per-axis power law with sign preservation. Stretches or compresses coords independently along x and y. At (powX, powY) = (1, 1) it's identity; sub-1 powers pull toward origin, super-1 powers push outward.",
    params: [
      { name: 'powX', default: 1.2, min: 0.1, max: 3, step: 0.05 },
      { name: 'powY', default: 0.9, min: 0.1, max: 3, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const powX = 1.2, powY = 0.9;
      const sx = x >= 0 ? 1 : -1;
      const sy = y >= 0 ? 1 : -1;
      return [
        sx * Math.pow(Math.max(Math.abs(x), 1e-30), powX),
        sy * Math.pow(Math.max(Math.abs(y), 1e-30), powY),
      ];
    },
  },
  {
    idx: V.line,
    name: 'line',
    source: sourceForIdx(V.line),
    formula: "V_{180}: \\text{2D projection of }(\\cos\\delta\\pi\\cos\\phi\\pi,\\; \\sin\\delta\\pi\\cos\\phi\\pi)\\text{ unit direction; rng-sample along the line}",
    blurb: "Nic Anderson (chronologicaldot) line base shape — 2D projection of JWildfire's 3D version (drops z). Computes a unit direction from spherical angles (δ, φ) both scaled by π, then samples a uniformly-random point along that line. At default (0, 0) the line is horizontal.",
    params: [
      { name: 'delta', default: 0.0, min: -1, max: 1, step: 0.01 },
      { name: 'phi',   default: 0.0, min: -1, max: 1, step: 0.01 },
    ],
    // RNG-using base shape — no warpFn.
  },
  // ============================================================
  // #121 batch L6 — JWildfire 2D continuing (V181..V184).
  // ovoid (Faber), phoenix_julia (TyrantWave), unpolar (Apophysis),
  // shredrad (Zy0rg).
  // ============================================================
  {
    idx: V.ovoid,
    name: 'ovoid',
    source: sourceForIdx(V.ovoid),
    formula: "V_{181}(x, y) = w\\,(x \\cdot p_x, y \\cdot p_y) / (x^2 + y^2 + \\epsilon)",
    blurb: "Michael Faber's ovoid — radial inverse with per-axis scale factors. At (px, py) = (1, 1) reduces to spherical; (0.94, 0.94) JWildfire default produces a subtle oval shape. Tune (px, py) independently for asymmetric ovals.",
    params: [
      { name: 'x', default: 0.94, min: 0, max: 3, step: 0.05 },
      { name: 'y', default: 0.94, min: 0, max: 3, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const px = 0.94, py = 0.94;
      const t = x * x + y * y + 1e-6;
      const r = 1 / t;
      return [x * r * px, y * r * py];
    },
  },
  {
    idx: V.phoenix_julia,
    name: 'phoenix_julia',
    source: sourceForIdx(V.phoenix_julia),
    formula: "V_{182}: \\text{Julian variant with axis distortion preprocessing}",
    blurb: "TyrantWave's phoenix_julia — a Julian variant with `x_distort` and `y_distort` scale factors applied to the iterate BEFORE the atan2 angle computation. Distorts the symmetry of the underlying Julian by squashing/stretching the input axes.",
    params: [
      { name: 'power',     default: 2.0,  min: -8, max: 8, step: 1    },
      { name: 'dist',      default: 1.0,  min: -2, max: 2, step: 0.05 },
      { name: 'x_distort', default: -0.5, min: -2, max: 2, step: 0.05 },
      { name: 'y_distort', default: 0.0,  min: -2, max: 2, step: 0.05 },
    ],
    // RNG-using (randint branch) — no warpFn.
  },
  {
    idx: V.unpolar,
    name: 'unpolar',
    source: sourceForIdx(V.unpolar),
    formula: "V_{183}(x, y) = (w/(2\\pi))\\,e^y\\,(\\sin x, \\cos x)",
    blurb: "Apophysis plugin pack unpolar — inverse-polar mapping. Treats x as the angular coord (in radians) and y as the radial log-scale. Output uses sin for x and cos for y (atypical convention). Produces dense logarithmic-spiral patterns.",
    defaultWeight: 0.30,
    warpFn: (x, y) => {
      const vvar_2 = (1 / Math.PI) * 0.5;
      const r = Math.exp(y);
      return [vvar_2 * r * Math.sin(x), vvar_2 * r * Math.cos(x)];
    },
  },
  {
    idx: V.shredrad,
    name: 'shredrad',
    source: sourceForIdx(V.shredrad),
    formula: "V_{184}: \\text{divide angle into }n\\text{ wedges; width-controlled fold within each wedge; preserve radius}",
    blurb: "Zy0rg's shredrad — radial shredder. Divides the angular coordinate into `n` equal wedges, then folds within each wedge by `width` factor. Preserves the input radius. Produces sharp pie-slice patterns with shred-like radial dividers.",
    params: [
      { name: 'n',     default: 4.0, min: 1,    max: 24, step: 1    },
      { name: 'width', default: 0.5, min: 0.05, max: 2,  step: 0.05 },
    ],
    warpFn: (x, y) => {
      const n = 4.0, width = 0.5;
      const alpha = 2 * Math.PI / n;
      const ang = Math.atan2(y, x);
      const rad = Math.sqrt(x * x + y * y);
      const xang = (ang + 3 * Math.PI + alpha * 0.5) / alpha;
      const zang = ((xang - Math.floor(xang)) * width + Math.floor(xang)) * alpha - Math.PI - alpha * 0.5 * width;
      return [rad * Math.cos(zang), rad * Math.sin(zang)];
    },
  },
  // ============================================================
  // #121 batch L7 — JWildfire 2D continuing (V185..V188).
  // ============================================================
  {
    idx: V.vogel,
    name: 'vogel',
    source: sourceForIdx(V.vogel),
    formula: "V_{185}: i \\sim U\\{1..n\\};\\; a = i \\cdot 2\\pi/\\varphi^2;\\; r = w(|p| + \\sqrt{i});\\; \\text{emit }r\\,(\\cos a + s\\,x, \\sin a + s\\,y)",
    blurb: "Victor Ganora's Vogel spiral — golden-angle phyllotaxis. Each iter picks a random integer i in [1, n] and projects to the i-th seed point of a sunflower-style spiral arrangement (anchored on the golden angle 2π/φ²). Produces dense organic spiral seed-head patterns.",
    params: [
      { name: 'n',     default: 3,    min: 1, max: 200, step: 1    },
      { name: 'scale', default: -0.5, min: -3, max: 3,  step: 0.05 },
    ],
    // RNG-using — no warpFn.
  },
  {
    idx: V.yin_yang,
    name: 'yin_yang',
    source: sourceForIdx(V.yin_yang),
    formula: "V_{186}: \\text{inside unit disc, yin-yang Möbius-like fold; outside, optional passthrough}",
    blurb: "dark-beam's yin_yang. Inside the unit disc, applies a yin-yang-symbol-shaped geometric fold (with rotation jitter via dual_t and ang1/ang2). Outside the disc, passes through unchanged or emits zero based on outside toggle.",
    params: [
      { name: 'radius',  default: 0.5, min: 0,  max: 1, step: 0.05 },
      { name: 'ang1',    default: 0.0, min: -1, max: 1, step: 0.05 },
      { name: 'ang2',    default: 0.0, min: -1, max: 1, step: 0.05 },
      { name: 'dual_t',  default: 1,   min: 0,  max: 1, step: 1    },
      { name: 'outside', default: 0,   min: 0,  max: 1, step: 1    },
    ],
    // RNG-using (dual_t branch) — no warpFn.
  },
  {
    idx: V.squish,
    name: 'squish',
    source: sourceForIdx(V.squish),
    formula: "V_{187}: \\text{fold into square's 8-region perimeter param + random rotation index}",
    blurb: "Michael Faber's squish (Angle Pack). Folds the iterate into a square's 8-region perimeter parameterization, picks a random rotation index, then emits onto one of 4 quadrant-aligned line segments. Produces square / cross silhouettes.",
    params: [
      { name: 'power', default: 2, min: 2, max: 12, step: 1 },
    ],
    // RNG-using — no warpFn.
  },
  {
    idx: V.target,
    name: 'target',
    source: sourceForIdx(V.target),
    formula: "V_{188}(x, y) = w\\,r\\,(\\cos a',\\; \\sin a'),\\; a' = \\mathrm{atan2}(y, x) + \\begin{cases} \\text{even} & t' < \\tfrac{\\text{size}}{2} \\\\ \\text{odd} & \\text{else} \\end{cases};\\; t = \\ln r,\\; t \\mathrel{-}= \\tfrac{\\text{size}}{2}\\ \\text{if } t<0,\\; t' = |t| \\bmod \\text{size},\\; r = \\sqrt{x^2+y^2}",
    blurb: "Michael Faber's target — log-radial ring rotator. Divides log(r) into rings of `size` width, then applies `even` or `odd` angle offset depending on which ring the iterate sits in. Produces rotating bullseye / target patterns with alternating-ring angular distortion.",
    params: [
      { name: 'even', default: 0.5, min: -Math.PI, max: Math.PI, step: 0.05 },
      { name: 'odd',  default: 1.5, min: -Math.PI, max: Math.PI, step: 0.05 },
      { name: 'size', default: 0.5, min: 0.1,      max: 3,       step: 0.05 },
    ],
    warpFn: (x, y) => {
      const even = 0.5, odd = 1.5, size = 0.5;
      const t_size_2 = 0.5 * size;
      let a = Math.atan2(y, x);
      const r = Math.sqrt(x * x + y * y);
      let t = Math.log(Math.max(r, 1e-30));
      if (t < 0) t -= t_size_2;
      const abs_t = Math.abs(t);
      t = abs_t - Math.floor(abs_t / size) * size;
      a += t < t_size_2 ? even : odd;
      return [r * Math.cos(a), r * Math.sin(a)];
    },
  },
  // ============================================================
  // #121 batch L8 — JWildfire 2D continuing (V189..V194).
  // ============================================================
  {
    idx: V.funnel,
    name: 'funnel',
    source: sourceForIdx(V.funnel),
    formula: "V_{189}(x, y) = w\\,(\\tanh x\\,(\\sec x + \\text{effect}\\cdot\\pi),\\; \\tanh y\\,(\\sec y + \\text{effect}\\cdot\\pi)),\\; \\sec\\xi = 1/\\cos\\xi",
    blurb: "Raykoid666's funnel — tanh + sec composition produces a funnel-shape projection. The `effect` integer scales the secant baseline. Sharp singularities at x or y = π/2 + nπ (guarded with epsilon).",
    defaultWeight: 0.06,
    // JWF/Raykoid666 default `effect`=8 (FunnelFunc.java; the runtime/parity
    // default in serialize.ts is also 8). This catalog slider-init is a
    // cosmetic hand-tune (2026-06-07): 2 gives more catalog visibility
    // against the sierpinski scaffold, and defaultWeight=0.06 produces the
    // canonical funnel-from-sierpinski silhouette. Catalog defaults only set
    // the editor slider + gallery thumbnail; they never affect parity.
    params: [{ name: 'effect', default: 2, min: 0, max: 20, step: 1 }],
    warpFn: (x, y) => {
      const effect = 2;
      const secX = 1 / Math.cos(x);
      const secY = 1 / Math.cos(y);
      return [Math.tanh(x) * (secX + effect * Math.PI), Math.tanh(y) * (secY + effect * Math.PI)];
    },
  },
  {
    idx: V.holesq,
    name: 'holesq',
    source: sourceForIdx(V.holesq),
    formula: "V_{190}: |x|+|y| > 1 \\Rightarrow \\text{pass};\\; \\text{else fold dominant-axis coord toward unit diamond edge}",
    blurb: "DarkBeam's holesq — diamond fold. Inside the |x|+|y| ≤ 1 diamond, pulls the dominant-axis coord toward the diamond edge. Outside, passes through. Produces a square-shaped hole in the otherwise-linear input.",
    warpFn: (x, y) => {
      const fax = Math.abs(x), fay = Math.abs(y);
      if (fax + fay > 1) return [x, y];
      if (fax > fay) {
        const t = x >= 0 ? (x - fay + 1) * 0.5 : (x + fay - 1) * 0.5;
        return [t, y];
      }
      const t = y >= 0 ? (y - fax + 1) * 0.5 : (y + fax - 1) * 0.5;
      return [x, t];
    },
  },
  {
    idx: V.hole2,
    name: 'hole2',
    source: sourceForIdx(V.hole2),
    formula: "V_{191}: 10\\text{-mode polar radial}; r_1 \\text{ via shape switch};\\; \\text{inside }\\Rightarrow w/r_1, \\text{else } w r_1",
    blurb: "Faber/Stefanov/Sidwell's hole2 — 10-mode polar radial generator. The `shape` switch picks among 10 different r₁ formulas (hole, hole1, double hole, heart, heart2, tan-fold, sin-modulated, sin-pi-sin, dual-sin). `inside` toggles inversion. Highly tunable target generator.",
    params: [
      { name: 'a',      default: 1.0, min: -3, max: 3, step: 0.05 },
      { name: 'b',      default: 2.0, min: -3, max: 3, step: 0.05 },
      { name: 'c',      default: 1.0, min: -3, max: 3, step: 0.05 },
      { name: 'd',      default: 1.0, min: -3, max: 3, step: 0.05 },
      { name: 'inside', default: 0,   min: 0,  max: 1, step: 1    },
      { name: 'shape',  default: 0,   min: 0,  max: 9, step: 1    },
    ],
    // Multi-shape switch — provide warp for default shape=0.
    warpFn: (x, y) => {
      const a = 1, c = 1, d = 1;
      const rhosq = x * x + y * y;
      const theta = Math.atan2(y, x) * d;
      const delta = Math.pow(Math.max(theta / Math.PI + 1, 1e-30), a) * c;
      const r1 = Math.sqrt(Math.max(rhosq, 0)) + delta;
      return [r1 * Math.cos(theta), r1 * Math.sin(theta)];
    },
  },
  {
    idx: V.lace_js,
    name: 'lace_js',
    source: sourceForIdx(V.lace_js),
    formula: "V_{192}: \\text{4-way RNG branch picks one of 4 anchor-rotated radial projections}",
    blurb: "Jesus Sosa's port of Paul Bourke's lace fractal. 4-way RNG branch picks one of 4 anchor-rotated radial projections at vertices (1, 0), (-½, √3/2), (-½, -√3/2), (0, 0). Produces hexagonal lace-like patterns.",
    // RNG-only — no warpFn.
  },
  {
    idx: V.julia_outside,
    name: 'julia_outside',
    source: sourceForIdx(V.julia_outside),
    formula: "V_{193}: \\text{complex Möbius-style mapping with 3 modes and optional RNG sign flip}",
    blurb: "Whittaker Courtney's julia_outside. 3-mode complex Möbius-style mapping using complex sqrt/sqr/div/inc/dec helpers. Modes select different sqrt/sqr application patterns; modes 0 and 1 add a 50/50 sign-flip via RNG. Produces Julia-set-like exterior patterns.",
    params: [
      { name: 're_div', default: -4.05, min: -5, max: 5, step: 0.05 },
      { name: 'im_div', default: -2.60, min: -5, max: 5, step: 0.05 },
      { name: 'mode',   default: 0,     min: 0,  max: 2, step: 1    },
    ],
    // RNG-using (modes 0+1) and complex math — no warpFn.
  },
  {
    idx: V.fourth,
    name: 'fourth',
    source: sourceForIdx(V.fourth),
    formula: "V_{194}: \\text{per-quadrant 4-way mix — Q-IV spherical, Q-I loonie, Q-III susan, Q-II linear}",
    blurb: "guagapunyaimel's fourth — a per-quadrant 4-way variation mix. Q-IV (x>0, y>0) gets spherical inverse-r; Q-I (x>0, y<0) gets loonie r²-fold; Q-III (x<0, y>0) gets lazysusan-style spiral+spin; Q-II (x<0, y<0) gets linear passthrough. Produces a striking quadrant-divided composite.",
    params: [
      { name: 'spin',  default: Math.PI, min: -Math.PI * 2, max: Math.PI * 2, step: 0.05 },
      { name: 'space', default: 0.10,    min: -1,   max: 1,   step: 0.05 },
      { name: 'twist', default: 0.20,    min: -1,   max: 1,   step: 0.05 },
      { name: 'x',     default: 0.30,    min: -2,   max: 2,   step: 0.05 },
      { name: 'y',     default: 0.12,    min: -2,   max: 2,   step: 0.05 },
    ],
    warpFn: (x, y) => {
      const spin = Math.PI, space = 0.10, twist = 0.20, off_x = 0.30, off_y = 0.12;
      const w = 1;
      if (x > 0 && y > 0) {
        const theta = Math.atan2(y, x);
        const r = 1 / Math.max(Math.sqrt(x * x + y * y), 1e-30);
        return [r * Math.cos(theta), r * Math.sin(theta)];
      }
      if (x > 0 && y < 0) {
        const r2 = x * x + y * y;
        if (r2 < w * w) {
          const r = Math.sqrt(Math.max(w * w / Math.max(r2, 1e-30) - 1, 0));
          return [r * x, r * y];
        }
        return [x, y];
      }
      if (x < 0 && y > 0) {
        const xx = x - off_x, yy = y + off_y;
        const r0 = Math.sqrt(xx * xx + yy * yy);
        if (r0 < w) {
          const theta = Math.atan2(yy, xx) + spin + twist * (w - r0);
          return [r0 * Math.cos(theta) + off_x, r0 * Math.sin(theta) - off_y];
        }
        const r = 1 + space / Math.max(r0, 1e-30);
        return [r * xx + off_x, r * yy - off_y];
      }
      return [x, y];
    },
  },
  // ============================================================
  // #121 batch L9 — JWildfire 2D continuing (V195..V198).
  // ============================================================
  {
    idx: V.pulse,
    name: 'pulse',
    source: sourceForIdx(V.pulse),
    formula: "V_{195}(x, y) = w\\,(x + s_x\\sin(x f_x),\\; y + s_y\\sin(y f_y))",
    blurb: "Sin-modulated linear identity. Adds a wavy displacement to each axis independently controlled by (freq, scale). At scalex=scaley=0 reduces to linear. Useful as a soft wavy perturbation overlay.",
    params: [
      { name: 'freqx',  default: 2.0, min: 0.1, max: 10, step: 0.1  },
      { name: 'freqy',  default: 2.0, min: 0.1, max: 10, step: 0.1  },
      { name: 'scalex', default: 1.0, min: 0,   max: 3,  step: 0.05 },
      { name: 'scaley', default: 1.0, min: 0,   max: 3,  step: 0.05 },
    ],
    warpFn: (x, y) => {
      const freqx = 2, freqy = 2, scalex = 1, scaley = 1;
      return [x + scalex * Math.sin(x * freqx), y + scaley * Math.sin(y * freqy)];
    },
  },
  {
    idx: V.rays1,
    name: 'rays1',
    source: sourceForIdx(V.rays1),
    formula: "V_{196}: u = 1/\\tan(\\sqrt{t}) + w(2/\\pi)^2;\\; \\text{emit }w\\,u\\,t/(x, y)",
    blurb: "Raykoid666's rays1 — radial ray burst. Combines cotangent of √(x²+y²) with an inverse-axis projection to produce dense radial-ray patterns radiating from origin.",
    warpFn: (x, y) => {
      const t = x * x + y * y;
      const tanT = Math.tan(Math.sqrt(Math.max(t, 1e-30)));
      const invTan = 1 / (Math.abs(tanT) < 1e-30 ? 1e-30 : tanT);
      const u = invTan + (2 / Math.PI) ** 2;
      const xs = u * t / (x === 0 ? 1e-30 : x);
      const ys = u * t / (y === 0 ? 1e-30 : y);
      return [xs, ys];
    },
  },
  {
    idx: V.rays2,
    name: 'rays2',
    source: sourceForIdx(V.rays2),
    formula: "V_{197}: u = 1/\\cos((t+\\epsilon)\\tan(1/t+\\epsilon));\\; \\text{emit }w/10 \\cdot u\\,t/(x, y)",
    blurb: "Raykoid666's rays2 — increased trig complexity radial ray burst. Cosine of (t·tan(1/t)) drives an even more dense radial pattern.",
    warpFn: (x, y) => {
      const t = x * x + y * y;
      const tSafe = Math.max(t, 1e-30);
      const inner = (tSafe + 1e-6) * Math.tan(1 / tSafe + 1e-6);
      const cosI = Math.cos(inner);
      const u = 1 / (Math.abs(cosI) < 1e-30 ? 1e-30 : cosI);
      const coef = 1 / 10;
      const xs = coef * u * t / (x === 0 ? 1e-30 : x);
      const ys = coef * u * t / (y === 0 ? 1e-30 : y);
      return [xs, ys];
    },
  },
  {
    idx: V.rays3,
    name: 'rays3',
    source: sourceForIdx(V.rays3),
    formula: "V_{198}: u = 1/\\sqrt{\\cos(\\sin(t^2+\\epsilon)\\sin(1/t^2+\\epsilon))};\\; \\text{emit }w/10 \\cdot u (\\cos t, \\tan t)\\,t/(x, y)",
    blurb: "Raykoid666's rays3 — highest trig complexity in the rays trio. Triple-nested sin/cos drives the radial-ray pattern, with cos(t) on x-axis and tan(t) on y-axis producing asymmetric burst patterns.",
    warpFn: (x, y) => {
      const t = x * x + y * y;
      const tSafe = Math.max(t, 1e-30);
      const inner = Math.sin(t * t + 1e-6) * Math.sin(1 / (tSafe * tSafe) + 1e-6);
      const denom = Math.sqrt(Math.max(Math.cos(inner), 1e-30));
      const u = 1 / Math.max(denom, 1e-30);
      const coef = 1 / 10;
      const xs = coef * u * Math.cos(t) * t / (x === 0 ? 1e-30 : x);
      const ys = coef * u * Math.tan(t) * t / (y === 0 ? 1e-30 : y);
      return [xs, ys];
    },
  },
  // ============================================================
  // #121 batch L10 — JWildfire 2D continuing (V199..V201).
  // V200 catalog-milestone passed.
  // ============================================================
  {
    idx: V.tancos,
    name: 'tancos',
    source: sourceForIdx(V.tancos),
    formula: "V_{199}: d_1 = \\epsilon + x^2+y^2;\\; d_2 = w/d_1;\\; \\text{emit }d_2(\\tanh d_1 \\cdot 2x,\\; \\cos d_1 \\cdot 2y)",
    blurb: "Raykoid666's tancos — mixed tanh + cos radial projection. Uses tanh on the x-axis and cos on the y-axis, both modulated by d=x²+y².",
    warpFn: (x, y) => {
      const d1 = 1e-6 + x * x + y * y;
      const d2 = 1 / d1;
      return [d2 * Math.tanh(d1) * 2 * x, d2 * Math.cos(d1) * 2 * y];
    },
  },
  {
    idx: V.twoface,
    name: 'twoface',
    source: sourceForIdx(V.twoface),
    formula: "V_{200}: x > 0 \\Rightarrow w\\,p / r^2;\\; \\text{else } w\\,p",
    blurb: "DarkBeam's twoface. Half-spherical: when x > 0 acts as spherical (inverse-r²); else passes through. Creates a sharp asymmetric 'inverted right half-plane' effect.",
    warpFn: (x, y) => {
      let v = 1;
      if (x > 0) v = v / Math.max(x * x + y * y, 1e-30);
      return [v * x, v * y];
    },
  },
  {
    idx: V.e_julia,
    name: 'e_julia',
    source: sourceForIdx(V.e_julia),
    formula: "V_{201}: \\text{if power} > 0,\\; x' = x;\\; \\text{else }r^2 \\leftarrow 1/r^2,\\; x' = x/r^2.\\; \\mu = \\mathrm{acosh}(x_{max})/p;\\; \\nu = (\\mathrm{acos}(x'/x_{max}) + 2\\pi k)/p;\\; \\text{sign}(\\nu) = \\text{sign}(y);\\; k \\in [0, |p|);\\; \\text{emit }w(\\cosh\\mu \\cos\\nu,\\; \\sinh\\mu\\sin\\nu)",
    blurb: "Michael Faber's eJulia (eSeries). Hyperbolic Julian variant — uses (acosh, acos) for elliptic-coordinate mu/nu, then projects via (cosh, sinh) and (cos, sin). Per-iter randint branch picks angular slice 0..|power|-1.",
    params: [
      { name: 'power', default: 2, min: -8, max: 8, step: 1 },
    ],
    // RNG-using — no warpFn.
  },
  // ============================================================
  // #121 batch L11 — JWildfire 2D continuing (V202..V204).
  // ============================================================
  {
    idx: V.cannabis_curve_wf,
    name: 'cannabis_curve_wf',
    source: sourceForIdx(V.cannabis_curve_wf),
    formula: "V_{202}: r = (1+0.9\\cos 8a)(1+0.1\\cos 24a)(0.9+0.1\\cos 200a)(1+\\sin a);\\; \\text{emit }r(\\sin(a+\\pi/2), \\cos(a+\\pi/2))",
    blurb: "High-frequency parametric flower curve (the 'cannabis curve' from mathworld.wolfram.com). Combines four sin/cos terms at frequencies 1, 8, 24, 200 to produce a leaf-silhouette parametric trace. The `filled` param mixes in RNG-attenuated radii to fill the interior.",
    params: [{ name: 'filled', default: 0.85, min: 0, max: 1, step: 0.05 }],
    // RNG-using — no warpFn.
  },
  {
    idx: V.e_collide,
    name: 'e_collide',
    source: sourceForIdx(V.e_collide),
    formula: "V_{203}: \\text{elliptic-coord collision fold on }\\nu\\text{ with }num\\text{ wedges + phase }\\pi a/num",
    blurb: "Michael Faber's eCollide (eSeries). Converts the iterate to elliptic coordinates (xmax, nu), folds nu into `num` equal angular wedges with alternating phase offset by `a`, then projects back via (xmax·cos nu, √(xmax²-1)·sin nu). Elliptic sibling of V163 bcollide.",
    params: [
      { name: 'num', default: 8,    min: 1, max: 16, step: 1    },
      { name: 'a',   default: 0.10, min: 0, max: 1,  step: 0.05 },
    ],
    // — no warpFn (transform-style; not worth replicating in JS for catalog).
  },
  {
    idx: V.e_mod,
    name: 'e_mod',
    source: sourceForIdx(V.e_mod),
    formula: "V_{204}: \\text{elliptic-coord modulus fold on }\\mu\\text{ with band }[-r, r]",
    blurb: "Michael Faber's eMod (eSeries). Converts to elliptic coordinates (mu, nu), then if |mu| < radius applies a `mod(2·radius)` fold to mu controlled by `distance`. Project back via (cosh mu·cos nu, sinh mu·sin nu). Bands the elliptic interior into repeating rings.",
    params: [
      { name: 'radius',   default: 1.0, min: 0.05, max: 5, step: 0.05 },
      { name: 'distance', default: 0.0, min: 0,    max: 2, step: 0.05 },
    ],
    // — no warpFn (skip; multi-modulo fold).
  },
  // ============================================================
  // #121 batch L12 — JWildfire 2D continuing (V205..V206).
  // ============================================================
  {
    idx: V.intersection,
    name: 'intersection',
    source: sourceForIdx(V.intersection),
    formula: "V_{205}: \\text{50/50 RNG: x-axis or y-axis tile mode; log-random step + 3-zone fmod fold on perpendicular axis}",
    blurb: "Brad Stefanov's intersection — 10-param tile intersector. Each iter a 50/50 RNG branch picks 'x-axis tile mode' or 'y-axis tile mode'. Within each mode, applies a log-scaled random translation on one axis and a 3-zone fmod-fold on the other. Produces intricate grid-intersection patterns.",
    params: [
      { name: 'xwidth',    default: 5.0,  min: 0.1, max: 10, step: 0.1  },
      { name: 'xtilesize', default: 0.50, min: 0,   max: 2,  step: 0.05 },
      { name: 'xmod1',     default: 0.30, min: 0,   max: 2,  step: 0.05 },
      { name: 'xmod2',     default: 1.0,  min: 0.1, max: 5,  step: 0.05 },
      { name: 'xheight',   default: 0.50, min: 0,   max: 2,  step: 0.05 },
      { name: 'yheight',   default: 5.0,  min: 0.1, max: 10, step: 0.1  },
      { name: 'ytilesize', default: 0.50, min: 0,   max: 2,  step: 0.05 },
      { name: 'ymod1',     default: 0.30, min: 0,   max: 2,  step: 0.05 },
      { name: 'ymod2',     default: 1.0,  min: 0.1, max: 5,  step: 0.05 },
      { name: 'ywidth',    default: 0.50, min: 0,   max: 2,  step: 0.05 },
    ],
    // RNG-using — no warpFn.
  },
  {
    idx: V.inv_squircular,
    name: 'inv_squircular',
    source: sourceForIdx(V.inv_squircular),
    formula: "V_{206}: r_2 = \\sqrt{r(w^2 r - 4 u^2 v^2)/w};\\; r = \\sqrt{r - r_2}/\\sqrt{2};\\; \\text{emit }r/u, r/v",
    blurb: "Inverse squircular projection — maps the plane into the unit squircle. Combines a quartic radial discriminant with per-axis inverse-coordinate projection. Produces squircle-shaped projections.",
    warpFn: (x, y) => {
      const u = x, v = y;
      const r = u * u + v * v;
      const r2Arg = r * (r - 4 * u * u * v * v);
      const r2 = Math.sqrt(Math.max(r2Arg, 0));
      const rOut = Math.sqrt(Math.max(r - r2, 0)) / Math.SQRT2;
      const uSafe = u === 0 ? 1e-30 : u;
      const vSafe = v === 0 ? 1e-30 : v;
      return [rOut / uSafe, rOut / vSafe];
    },
  },
  // ============================================================
  // #121 batch L13 — JWildfire 2D continuing (V207..V209).
  // ============================================================
  {
    idx: V.lozi,
    name: 'lozi',
    source: sourceForIdx(V.lozi),
    formula: "V_{207}(x, y) = w\\,(c - a\\,|x| + y,\\; b\\,x)",
    blurb: "TyrantWave's Lozi map — sibling of V159 henon. Same shape but uses |x| (absolute value) instead of x². Produces sharper-edged chaotic attractor with corners instead of smooth curves.",
    params: [
      { name: 'a', default: 0.5, min: -2, max: 2, step: 0.05 },
      { name: 'b', default: 1.0, min: -2, max: 2, step: 0.05 },
      { name: 'c', default: 1.0, min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const a = 0.5, b = 1.0, c = 1.0;
      return [c - a * Math.abs(x) + y, b * x];
    },
  },
  {
    idx: V.hypershift,
    name: 'hypershift',
    source: sourceForIdx(V.hypershift),
    formula: "V_{208}: \\text{Möbius radial shift onto hyperbolic-like disc with shift offset}",
    blurb: "Zy0rg's hypershift — Möbius-style radial transformation. Maps plane into a shifted disc-like region. `shift` controls the offset; `stretch` scales the y-axis after projection.",
    params: [
      { name: 'shift',   default: -0.15, min: -3, max: 3, step: 0.05 },
      { name: 'stretch', default: -1.25, min: -3, max: 3, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const shift = -0.15, stretch = -1.25;
      const scale = 1 - shift * shift;
      const rad1 = 1 / Math.max(x * x + y * y, 1e-30);
      const xp = rad1 * x + shift;
      const yp = rad1 * y;
      const rad = scale / Math.max(xp * xp + yp * yp, 1e-30);
      return [rad * xp + shift, rad * yp * stretch];
    },
  },
  {
    idx: V.hex_modulus,
    name: 'hex_modulus',
    source: sourceForIdx(V.hex_modulus),
    formula: "V_{209}: \\text{convert to hex axial coords; round to nearest hex cell; emit displacement from cell center}",
    blurb: "Tatyana Zabanova's hex_modulus (via Brad Stefanov). Converts iterate to hexagonal axial coordinates, rounds to nearest hex cell, returns the displacement from the cell center. Produces honeycomb-tiling patterns.",
    params: [
      { name: 'size', default: 0.40, min: 0.1, max: 5, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const size = 0.40;
      const M_SQRT3_2 = 0.8660254037844386;
      const M_SQRT3 = 1.7320508075688772;
      const hsize = M_SQRT3_2 / size;
      const weight = 1 / M_SQRT3_2;
      const X = x * hsize, Y = y * hsize;
      const xh = 0.5773502691896258 * X - Y / 3;
      const z = 2 * Y / 3;
      const yh = -xh - z;
      let rx = Math.round(xh), ry = Math.round(yh), rz = Math.round(z);
      const xd = Math.abs(rx - xh), yd = Math.abs(ry - yh), zd = Math.abs(rz - z);
      if (xd > yd && xd > zd) rx = -ry - rz;
      else if (yd > zd) ry = -rx - rz;
      else rz = -rx - ry;
      const FX_h = M_SQRT3 * rx + M_SQRT3_2 * rz;
      const FY_h = 1.5 * rz;
      return [(X - FX_h) * weight, (Y - FY_h) * weight];
    },
  },
  // ============================================================
  // #121 batch L14 (final) — JWildfire 2D long tail (V210..V213).
  // ============================================================
  {
    idx: V.boarders2,
    name: 'boarders2',
    source: sourceForIdx(V.boarders2),
    formula: "V_{210}:\\; \\text{offset} \\propto |c|,\\;\\; \\text{edge-shift} \\propto |c|\\cdot|\\mathrm{left}|",
    blurb: "Xyrus02's boarders2 — Apophysis boarders plugin with 3 tunable parameters. RNG splits each iter between center-pull and edge-shift behavior. Inner-cell offset scales by |c|; edge-shift distance scales by |c|·|left|. Produces sharp grid-tile patterns with controllable border thickness.",
    params: [
      { name: 'c',     default: 0.4,  min: 0, max: 1, step: 0.05 },
      { name: 'left',  default: 0.65, min: 0, max: 2, step: 0.05 },
      { name: 'right', default: 0.35, min: 0, max: 2, step: 0.05 },
    ],
    // RNG-using — no warpFn.
  },
  {
    idx: V.b_mod,
    name: 'b_mod',
    source: sourceForIdx(V.b_mod),
    formula: "V_{211}: \\text{bipolar coords, mu-axis modulus fold}; \\text{ emit Möbius bipolar inverse}",
    blurb: "Michael Faber's bMod (bSeries) — sibling of V163 bcollide. Bipolar Möbius coordinates with a `radius`-bounded modulus fold on the tau axis. Produces banded mirror-symmetric patterns pinching toward focal points (±1, 0).",
    params: [
      { name: 'radius',   default: 1.25, min: 0.05, max: 5, step: 0.05 },
      { name: 'distance', default: 0.25, min: 0,    max: 2, step: 0.05 },
    ],
    // — no warpFn (multi-fold).
  },
  {
    idx: V.b_transform,
    name: 'b_transform',
    source: sourceForIdx(V.b_transform),
    formula: "V_{212}: \\text{bipolar coords; power-divided angular slice with RNG randint; split offsets tau by sign}",
    blurb: "Michael Faber's bTransform (bSeries). Bipolar Möbius coords with `power`-divided angular slices (RNG picks one) and a `split` offset applied to tau based on input-x sign. Produces multi-wedge symmetric Möbius patterns.",
    params: [
      { name: 'rotate', default: 0.51, min: -Math.PI, max: Math.PI, step: 0.05 },
      { name: 'power',  default: 2,    min: 1, max: 12, step: 1    },
      { name: 'move',   default: 0.0,  min: -3, max: 3, step: 0.05 },
      { name: 'split',  default: 0.0,  min: -3, max: 3, step: 0.05 },
    ],
    // RNG-using — no warpFn.
  },
  {
    idx: V.parallel,
    name: 'parallel',
    source: sourceForIdx(V.parallel),
    formula: "V_{213}: \\text{50/50 RNG between x1-mode and x2-mode (both like intersection); additive }\\pm move\\text{ offset}",
    blurb: "Brad Stefanov's parallel — sibling of V205 intersection. 50/50 RNG split between two tile modes (x1 + x2) with mirrored signs on a `move` offset (x1 adds, x2 subtracts). Drops x2height/x2move to fit pyr3's 10-param seam (hardcoded to JWildfire defaults 0.5 / 1.0).",
    params: [
      { name: 'x1width',    default: 5.0,  min: 0.1, max: 10, step: 0.1  },
      { name: 'x1tilesize', default: 0.50, min: 0,   max: 2,  step: 0.05 },
      { name: 'x1mod1',     default: 0.30, min: 0,   max: 2,  step: 0.05 },
      { name: 'x1mod2',     default: 1.0,  min: 0.1, max: 5,  step: 0.05 },
      { name: 'x1height',   default: 0.50, min: 0,   max: 2,  step: 0.05 },
      { name: 'x1move',     default: 1.0,  min: -3,  max: 3,  step: 0.05 },
      { name: 'x2width',    default: 5.0,  min: 0.1, max: 10, step: 0.1  },
      { name: 'x2tilesize', default: 0.50, min: 0,   max: 2,  step: 0.05 },
      { name: 'x2mod1',     default: 0.30, min: 0,   max: 2,  step: 0.05 },
      { name: 'x2mod2',     default: 1.0,  min: 0.1, max: 5,  step: 0.05 },
    ],
    // RNG-using — no warpFn.
  },
  // ============================================================
  // #170 — sibling-pair completions + S-tier ports (V214..V219).
  // ============================================================
  {
    idx: V.waves3,
    name: 'waves3',
    source: sourceForIdx(V.waves3),
    formula: 'JWF_{115}(x, y) = w\\,(x + \\sin(y\\,\\text{freqx})\\,s_x,\\; y + \\sin(x\\,\\text{freqy})\\,s_y),\\; s_x = \\tfrac{1}{2}\\text{scalex}(1+\\sin(y\\,sx\\_freq)),\\; s_y = \\tfrac{1}{2}\\text{scaley}(1+\\sin(x\\,sy\\_freq))',
    blurb: "Tatyana Zabanova's waves3 (via Brad Stefanov). Sibling of V16 waves / V85 waves2 — adds per-axis frequency modulators (sx_freq, sy_freq) that ripple the scale factor along the orthogonal axis. Produces wave patterns with mid-frequency bunching.",
    params: [
      { name: 'scalex',  default: 0.05, min: -1, max: 1, step: 0.01 },
      { name: 'scaley',  default: 0.05, min: -1, max: 1, step: 0.01 },
      { name: 'freqx',   default: 7.0,  min: 0,  max: 30, step: 0.5 },
      { name: 'freqy',   default: 13.0, min: 0,  max: 30, step: 0.5 },
      { name: 'sx_freq', default: 0.0,  min: -5, max: 5, step: 0.1 },
      { name: 'sy_freq', default: 2.0,  min: -5, max: 5, step: 0.1 },
    ],
    warpFn: (x, y) => {
      const scalex = 0.05, scaley = 0.05, freqx = 7.0, freqy = 13.0, sx_freq = 0.0, sy_freq = 2.0;
      const sxx = 0.5 * scalex * (1.0 + Math.sin(y * sx_freq));
      const syy = 0.5 * scaley * (1.0 + Math.sin(x * sy_freq));
      return [x + Math.sin(y * freqx) * sxx, y + Math.sin(x * freqy) * syy];
    },
  },
  {
    idx: V.waves4,
    name: 'waves4',
    source: sourceForIdx(V.waves4),
    formula: 'JWF_{116}(x, y) = w\\,(x + \\sin(y\\,\\text{freqx})\\cdot a_x^2\\,\\text{scalex},\\; y + \\sin(x\\,\\text{freqy})\\,\\text{scaley}),\\; a_x = \\text{hash}(\\lfloor y\\,\\text{freqx}/2\\pi\\rfloor)',
    blurb: "Tatyana Zabanova's waves4 (via Brad Stefanov). Banded variant: spatial hash on the y-cell index modulates scalex per-band, producing distinct horizontal stripes. cont=1 binarizes the hash → black-and-white bars.",
    params: [
      { name: 'scalex', default: 0.05, min: -1, max: 1, step: 0.01 },
      { name: 'scaley', default: 0.05, min: -1, max: 1, step: 0.01 },
      { name: 'freqx',  default: 7.0,  min: 0,  max: 30, step: 0.5 },
      { name: 'freqy',  default: 13.0, min: 0,  max: 30, step: 0.5 },
      { name: 'cont',   default: 0,    min: 0,  max: 1, step: 1    },
      { name: 'yfact',  default: 0.1,  min: -2, max: 2, step: 0.05 },
    ],
    // Hash-driven warp; warpFn shows a representative band.
    warpFn: (x, y) => {
      const scalex = 0.05, scaley = 0.05, freqx = 7.0, freqy = 13.0, yfact = 0.1;
      const cell = Math.floor(y * freqx / (2 * Math.PI));
      let ax = Math.sin(cell * 12.9898 + cell * 78.233 + 1.0 + y * 0.001 * yfact) * 43758.5453;
      ax = ax - Math.trunc(ax);
      return [x + Math.sin(y * freqx) * ax * ax * scalex, y + Math.sin(x * freqy) * scaley];
    },
  },
  {
    idx: V.scry2,
    name: 'scry2',
    source: sourceForIdx(V.scry2),
    formula: 'JWF_{117}(x, y) = (x, y)/d,\\; d = r_1\\,(r_2 + 1/w),\\; r_1, r_2 = \\text{loonie2 n-sided star+circle radii at }(x, y)',
    blurb: "dark-beam's scry2 — loonie2 (V105) star-polygon init combined with the V73 scry inversion. n-sided star + circle blend determines the local radius; final emission is `(x, y)/d` for `d = r₁·(r₂ + 1/w)`. Produces multi-armed concentric crystals.",
    params: [
      { name: 'sides',  default: 4,    min: 1, max: 50, step: 1 },
      { name: 'star',   default: 0.15, min: -1, max: 1, step: 0.02 },
      { name: 'circle', default: 0.25, min: -1, max: 1, step: 0.02 },
    ],
  },
  {
    idx: V.ennepers2,
    name: 'ennepers2',
    source: sourceForIdx(V.ennepers2),
    formula: 'JWF_{118}(x, y) = w\\,\\big(x(a^2 - d_{xy}/r^2 - c\\sqrt{|x|}),\\; y(b^2 - d_{xy}/r^2 - c\\sqrt{|y|})\\big),\\; d_{xy} = (ax)^2 - (by)^2,\\; r^2 = x^2 + y^2',
    blurb: "dark-beam's ennepers2 — 3-parameter variant of V152 ennepers (Enneper minimal surface fold). a/b/c control per-axis scale and a sqrt-of-coord absorption term; produces asymmetric Enneper deformations.",
    params: [
      { name: 'a', default: 1.0,    min: -3, max: 3, step: 0.05 },
      { name: 'b', default: 0.3333, min: -3, max: 3, step: 0.05 },
      { name: 'c', default: 0.075,  min: -1, max: 1, step: 0.01 },
    ],
    warpFn: (x, y) => {
      const a = 1.0, b = 0.3333, c = 0.075;
      const r2 = 1.0 / Math.max(x * x + y * y, 1e-30);
      const dxy = (a * x) * (a * x) - (b * y) * (b * y);
      return [
        x * (a * a - dxy * r2 - c * Math.sqrt(Math.abs(x))),
        y * (b * b - dxy * r2 - c * Math.sqrt(Math.abs(y))),
      ];
    },
  },
  {
    idx: V.apollony,
    name: 'apollony',
    source: sourceForIdx(V.apollony),
    formula: 'JWF_{119}: \\text{3-branch RNG selects one of }\\{(a_0, b_0),\\; \\text{Möbius-rotated }(f_{1x}, f_{1y})\\text{ by }\\pm 120°\\};\\; a_0/b_0 = \\text{Möbius image of }(x, y)\\text{ around }(1+\\sqrt{3}, 0)',
    blurb: "Jesus Sosa's apollony (Paul Bourke source) — Apollonian gasket IFS. Each iter: compute a Möbius-style image of the input around the corner (1+√3, 0), then 3-way random branch picks one of the three leaf rotations (identity, +120°, −120°). Produces the canonical Apollonian gasket attractor (nested circles).",
  },
  {
    idx: V.circlecrop,
    name: 'circlecrop',
    source: sourceForIdx(V.circlecrop),
    formula: 'JWF_{120}: \\text{if }|p-c| > r,\\; \\begin{cases} (0, 0)\\text{ (hide)} & \\text{zero}=1 \\\\ w\\,r_d(\\cos\\theta, \\sin\\theta) + c & \\text{zero}=0 \\end{cases};\\; \\text{else pass through}',
    blurb: "Xyrus02's circlecrop (Apophysis built-in). Disc clipper at (x, y) with radius `radius`. `zero=1`: outside the disc → hide (contributes nothing). `zero=0`: outside → wrap to disc edge with `scatter_area`-jittered radius. Inside the disc, points pass through.",
    params: [
      { name: 'radius',       default: 0.55, min: 0.1, max: 5, step: 0.05 },
      { name: 'x',            default: 0.0, min: -2, max: 2, step: 0.05 },
      { name: 'y',            default: 0.0, min: -2, max: 2, step: 0.05 },
      { name: 'scatter_area', default: 0.0, min: -1, max: 1, step: 0.05 },
      { name: 'zero',         default: 0,   min: 0, max: 1, step: 1    },
    ],
    defaultWeight: 1.0,
  },
  // ---------------------------------------------------------------------
  // Conformal & complex-analytic warps — V220 (#133). Original (not in
  // JWildfire) variations from classical complex analysis. Newton extends
  // the dc_cylinder (V102) "position-warp + DC color" precedent — its
  // basin coloring is the umbrella #128 headline shot.
  // ---------------------------------------------------------------------
  {
    idx: V.newton,
    name: 'newton',
    source: sourceForIdx(V.newton),  // novel (P0); emits DC basin color when dc_flag is set (#222: DC is a capability, not a source)
    formula: 'P_{0}(z, n) = z - \\frac{z^n - 1}{n\\,z^{n-1}}',
    blurb: 'One Newton step on zⁿ − 1. When the xform\'s DC flag is set, each splat is colored by which root the post-step coordinate is nearest to — producing the iconic Newton-fractal tri-basin (n=3), tetra-basin (n=4), or hepta-basin (n=7) painting that palette-index renderers cannot match. Without the DC flag, ships as a pure position warp with strong convergence toward the n roots on the unit circle.',
    params: [
      { name: 'n', default: 3, min: 2, max: 8, step: 1 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y) => {
      // n=3 catalog default. Math.pow on (r, phi) form mirrors the WGSL
      // complex_pow_int + complex_div sequence.
      const n = 3;
      const r = Math.hypot(x, y);
      const phi = Math.atan2(y, x);
      const rN = Math.pow(r, n);
      const rNm1 = Math.pow(r, n - 1);
      const zn_re = rN * Math.cos(n * phi);
      const zn_im = rN * Math.sin(n * phi);
      const znm1_re = rNm1 * Math.cos((n - 1) * phi);
      const znm1_im = rNm1 * Math.sin((n - 1) * phi);
      const num_re = (n - 1) * zn_re + 1;
      const num_im = (n - 1) * zn_im;
      const den_re = n * znm1_re;
      const den_im = n * znm1_im;
      const denom2 = den_re * den_re + den_im * den_im;
      // f64-side pole guard mirrors WGSL: at z=0 the denominator is (0,0);
      // return identity passthrough.
      if (denom2 < 1e-20) return [x, y];
      return [
        (num_re * den_re + num_im * den_im) / denom2,
        (num_im * den_re - num_re * den_im) / denom2,
      ];
    },
  },
  {
    idx: V.blaschke,
    name: 'blaschke',
    source: 'novel',
    formula: 'P_{1}(z, a) = z \\cdot \\frac{z - a}{1 - \\bar{a}\\,z}',
    blurb: 'Single-zero Blaschke product (2-to-1 form). Two zeros — origin and the configurable complex point a in the unit disk — produce a 2-to-1 disk symmetry. The unit circle maps to itself; interior maps to interior. Move a around to rotate the symmetry pattern.',
    params: [
      { name: 'a_re', default: -0.75, min: -0.95, max: 0.95, step: 0.05 },
      { name: 'a_im', default: -0.90, min: -0.95, max: 0.95, step: 0.05 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y) => {
      const ax = -0.75, ay = -0.90;
      // num = z · (z − a)
      const za_re = x - ax, za_im = y - ay;
      const num_re = x * za_re - y * za_im;
      const num_im = x * za_im + y * za_re;
      // den = 1 − ā · z; ā = (ax, −ay)
      const ax_c = ax, ay_c = -ay;
      const az_re = ax_c * x - ay_c * y;
      const az_im = ax_c * y + ay_c * x;
      const den_re = 1 - az_re;
      const den_im = -az_im;
      const denom2 = den_re * den_re + den_im * den_im;
      if (denom2 < 1e-20) return [x, y];
      return [
        (num_re * den_re + num_im * den_im) / denom2,
        (num_im * den_re - num_re * den_im) / denom2,
      ];
    },
  },
  {
    idx: V.cayley,
    name: 'cayley',
    source: 'novel',
    formula: 'P_{2}(z, s) = \\frac{z - s\\,i}{z + s\\,i}',
    blurb: 'Cayley transform — the classical conformal map from the upper half-plane to the open unit disk. The s parameter scales the i offset; s=1 is the textbook form. Produces tightly-curled flow near the negative imaginary axis (the map\'s pole).',
    params: [
      { name: 's', default: 0.8, min: 0.1, max: 4.0, step: 0.1 },
    ],
    defaultWeight: 0.2,
    warpFn: (x, y) => {
      const s = 0.8;
      const num_re = x, num_im = y - s;
      const den_re = x, den_im = y + s;
      const denom2 = den_re * den_re + den_im * den_im;
      if (denom2 < 1e-20) return [x, y];
      return [
        (num_re * den_re + num_im * den_im) / denom2,
        (num_im * den_re - num_re * den_im) / denom2,
      ];
    },
  },
  {
    idx: V.complex_gamma,
    name: 'complex_gamma',
    source: 'novel',
    formula: '\\Gamma(z) \\approx \\sqrt{2\\pi}\\,t^{z-0.5}\\,e^{-t}\\,A_g(z)',
    blurb: 'Complex Γ via the Lanczos g=7 approximation, with reflection-branch handling for Re(z) < 0.5. Γ(n+1) = n! interpolates smoothly between factorials, producing dramatic ringed structure around the positive real axis. The scale parameter multiplies the output to keep Γ\'s factorial growth from blowing the chaos walker.',
    params: [
      { name: 'scale', default: 0.4, min: 0.05, max: 1.0, step: 0.05 },
    ],
    defaultWeight: 0.32,
    // No warpFn: complex Γ is too expensive for the catalog SVG warp pane,
    // and Lanczos f32 precision artifacts would dominate the small-scale
    // visualization anyway. Catalog renders a "warp not applicable" note.
  },
  {
    idx: V.lambert_w,
    name: 'lambert_w',
    source: 'novel',
    formula: 'W_0(z) \\text{ satisfies } W\\,e^W = z',
    blurb: 'Principal-branch Lambert W function via Halley iteration. The inverse of f(w) = w·e^w shows up in delayed differential equations, asymptotic analysis, and combinatorics (number of rooted trees). As a chaos-game warp, W produces gentle logarithmic spirals near the origin transitioning into knee-shaped flow far from origin.',
    params: [
      { name: 'iters', default: 2, min: 1, max: 4, step: 1 },
    ],
    defaultWeight: 0.5,
    // No warpFn: iterative + the f64 oracle would have its own Halley loop;
    // catalog renders a "warp not applicable" note.
  },
  {
    idx: V.superellipse,
    name: 'superellipse',
    source: 'novel',
    formula: '|\\frac{x}{a}|^n + |\\frac{y}{b}|^n = 1',
    blurb: 'Lamé curve radial shaping. Sweeps between a star shape (n < 1), an ellipse (n = 2), and a box (n > 2).',
    params: [
      { name: 'a', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
      { name: 'b', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
      { name: 'n', default: 2.0, min: 0.1, max: 10.0, step: 0.1 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y, a = 1.0, b = 1.0, n = 2.0) => {
      const theta = Math.atan2(y, x);
      const c = Math.abs(Math.cos(theta) / a);
      const s = Math.abs(Math.sin(theta) / b);
      const r = Math.pow(Math.pow(c, n) + Math.pow(s, n), -1.0 / n);
      return [r * Math.cos(theta), r * Math.sin(theta)];
    },
  },
  {
    idx: V.limacon,
    name: 'limacon',
    source: 'novel',
    formula: 'r = b + a \\cos\\theta',
    blurb: 'Pascal\'s limaçon curve. Depending on a/b, produces an apple, cardioid, or inner-looped curve.',
    params: [
      { name: 'a', default: 1.0, min: -2.0, max: 2.0, step: 0.1 },
      { name: 'b', default: 0.5, min: -2.0, max: 2.0, step: 0.1 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y, a = 1.0, b = 0.5) => {
      const theta = Math.atan2(y, x);
      const r = b + a * Math.cos(theta);
      return [r * Math.cos(theta), r * Math.sin(theta)];
    },
  },
  {
    idx: V.epicycloid,
    name: 'epicycloid',
    source: 'novel',
    formula: 'x = (k+1)\\cos\\theta - \\cos((k+1)\\theta)',
    blurb: 'A roulette curve traced by a point on a circle rolling on the outside of another circle.',
    params: [
      { name: 'k', default: 1.0, min: 1.0, max: 10.0, step: 1.0 },
    ],
    defaultWeight: 0.45,
    warpFn: (x, y, k = 1.0) => { // #252 — k default must match params[].default (was 3.0)
      const theta = Math.atan2(y, x);
      const k1 = k + 1.0;
      const xp = k1 * Math.cos(theta) - Math.cos(k1 * theta);
      const yp = k1 * Math.sin(theta) - Math.sin(k1 * theta);
      return [xp, yp];
    },
  },
  {
    idx: V.catenary,
    name: 'catenary',
    source: 'novel',
    formula: 'y = a \\cosh(x/a)',
    blurb: 'The shape of a hanging chain. Warps the y-axis parabolically outward for large x.',
    params: [
      { name: 'a', default: 0.2, min: 0.1, max: 5.0, step: 0.1 },
    ],
    defaultWeight: 0.45,
    warpFn: (x, y, a = 0.2) => { // #252 — a default must match params[].default (was 1.0)
      const yp = a * Math.cosh(x / a);
      return [x, yp];
    },
  },
  {
    idx: V.tractrix,
    name: 'tractrix',
    source: 'novel',
    formula: 'x = t - \\tanh(t), y = 1/\\cosh(t)',
    blurb: 'The pursuit curve. Its involute is the catenary.',
    defaultWeight: 0.5,
    warpFn: (x, y) => {
      const t = x;
      const xp = t - Math.tanh(t);
      const yp = 1.0 / Math.cosh(t);
      return [xp, yp];
    },
  },
  {
    idx: V.arnold_cat,
    name: 'arnold_cat',
    source: 'novel',
    formula: '\\begin{bmatrix}x\'\\\\y\'\\end{bmatrix} = \\begin{bmatrix}2 & 1 \\\\ 1 & 1\\end{bmatrix}\\begin{bmatrix}x \\\\ y\\end{bmatrix} \\pmod 1',
    blurb: 'Arnold\'s cat map. A classic example of a chaotic area-preserving map that perfectly stretches and folds a torus over itself.',
    defaultWeight: 0.5,
    warpFn: (x, y) => {
      const xmod = x - Math.floor(x + 0.5);
      const ymod = y - Math.floor(y + 0.5);
      const xp = xmod * 2.0 + ymod;
      const yp = xmod + ymod;
      return [xp - Math.floor(xp + 0.5), yp - Math.floor(yp + 0.5)];
    },
  },
  {
    idx: V.bakers_map,
    name: 'bakers_map',
    source: 'novel',
    formula: '\\text{if } x < 0.5: \\ x\' = 2x, y\' = \\frac{y}{2} \\text{ else } x\' = 2x - 1, y\' = \\frac{y}{2} + 0.5',
    blurb: 'The folded baker\'s map. Slices the domain in half, stretches each horizontally, and stacks them vertically, perfectly preserving area.',
    defaultWeight: 0.5,
    warpFn: (x, y) => {
      let xf = x - Math.floor(x + 0.5) + 0.5;
      let yf = y - Math.floor(y + 0.5) + 0.5;
      let xp, yp;
      if (xf < 0.5) {
        xp = 2.0 * xf;
        yp = yf * 0.5;
      } else {
        xp = 2.0 * xf - 1.0;
        yp = yf * 0.5 + 0.5;
      }
      return [xp - 0.5, yp - 0.5];
    },
  },
  {
    idx: V.tent_map,
    name: 'tent_map',
    source: 'novel',
    formula: 'x\' = 1 - |1 - 2x|, \\quad y\' = 1 - |1 - 2y|',
    blurb: 'A piecewise linear chaotic map applied independently to the x and y axes. Produces self-similar triangular banding.',
    defaultWeight: 0.5,
    warpFn: (x, y) => {
      let xf = x - Math.floor(x + 0.5) + 0.5;
      let yf = y - Math.floor(y + 0.5) + 0.5;
      let xp = 1.0 - Math.abs(1.0 - 2.0 * xf);
      let yp = 1.0 - Math.abs(1.0 - 2.0 * yf);
      return [xp - 0.5, yp - 0.5];
    },
  },
  {
    idx: V.logistic_map,
    name: 'logistic_map',
    source: 'novel',
    formula: 'x\' = rx(1-x), \\quad y\' = ry(1-y)',
    blurb: 'The classic parabolic logistic map applied independently to the x and y axes. Tuning r into the 3.57–4.0 range yields chaos.',
    params: [
      { name: 'r', default: 3.9, min: 2.0, max: 4.0, step: 0.01 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y, r = 3.9) => {
      let xf = x - Math.floor(x + 0.5) + 0.5;
      let yf = y - Math.floor(y + 0.5) + 0.5;
      let xp = r * xf * (1.0 - xf);
      let yp = r * yf * (1.0 - yf);
      return [xp - 0.5, yp - 0.5];
    },
  },
  {
    idx: V.box_fold,
    name: 'box_fold',
    source: 'novel',
    formula: '\\text{if } |x| > L: x\' = 2L \\cdot \\text{sgn}(x) - x',
    blurb: 'A stateless reflection fold over an axis-aligned bounding box. The core building block of the Mandelbox fractal.',
    params: [
      { name: 'limit', default: 0.4, min: 0.1, max: 2.0, step: 0.1 },
    ],
    defaultWeight: 1.0,
    warpFn: (x, y, limit = 0.4) => { // #252 — limit default must match params[].default (was 1.0)
      let xp = x;
      let yp = y;
      if (xp > limit) xp = 2.0 * limit - xp;
      else if (xp < -limit) xp = -2.0 * limit - xp;
      if (yp > limit) yp = 2.0 * limit - yp;
      else if (yp < -limit) yp = -2.0 * limit - yp;
      return [xp, yp];
    },
  },
  {
    idx: V.sphere_fold,
    name: 'sphere_fold',
    source: 'novel',
    formula: '\\text{if } r < r_{min}: p\' = p \\frac{r_{max}^2}{r_{min}^2} \\text{ else if } r < r_{max}: p\' = p \\frac{r_{max}^2}{r^2}',
    blurb: 'Radial inversion shell. Points near the center are expanded outward, while points outside the shell remain unaffected.',
    params: [
      { name: 'rmin', default: 0.5, min: 0.1, max: 1.0, step: 0.1 },
      { name: 'rmax', default: 1.0, min: 0.5, max: 2.0, step: 0.1 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y, rmin = 0.5, rmax = 1.0) => {
      const r2 = x * x + y * y;
      const rmin2 = rmin * rmin;
      const rmax2 = rmax * rmax;
      let scale = 1.0;
      if (r2 < rmin2) scale = rmax2 / rmin2;
      else if (r2 < rmax2) scale = rmax2 / Math.max(r2, 1e-6);
      return [x * scale, y * scale];
    },
  },
  {
    idx: V.mandelbox_step,
    name: 'mandelbox_step',
    source: 'novel',
    formula: 'p\' = s \\cdot \\text{sphereFold}(\\text{boxFold}(p)) + c',
    blurb: 'A single step of the famous Mandelbox fractal. Combines a box fold, a sphere fold, and an affine transformation.',
    params: [
      { name: 'scale', default: 2.0, min: 0.5, max: 3.0, step: 0.1 },
      { name: 'rmin', default: 0.5, min: 0.1, max: 1.0, step: 0.1 },
      { name: 'rmax', default: 1.0, min: 0.5, max: 2.0, step: 0.1 },
      { name: 'cx', default: 0.0, min: -2.0, max: 2.0, step: 0.1 },
      { name: 'cy', default: 0.0, min: -2.0, max: 2.0, step: 0.1 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y, scale = 2.0, rmin = 0.5, rmax = 1.0, cx = 0.0, cy = 0.0) => {
      let xp = x;
      let yp = y;
      if (xp > 1.0) xp = 2.0 - xp;
      else if (xp < -1.0) xp = -2.0 - xp;
      if (yp > 1.0) yp = 2.0 - yp;
      else if (yp < -1.0) yp = -2.0 - yp;

      const r2 = xp * xp + yp * yp;
      const rmin2 = rmin * rmin;
      const rmax2 = rmax * rmax;
      let sfold = 1.0;
      if (r2 < rmin2) sfold = rmax2 / rmin2;
      else if (r2 < rmax2) sfold = rmax2 / Math.max(r2, 1e-6);
      
      return [xp * sfold * scale + cx, yp * sfold * scale + cy];
    },
  },
  {
    idx: V.kifs_fold,
    name: 'kifs_fold',
    source: 'novel',
    formula: '\\theta = \\frac{2\\pi}{n}, \\quad a\' = a \\bmod \\theta',
    blurb: 'Kaleidoscopic wedge fold. Folds all of 2D space into a single wedge sector by repeated mirror reflection.',
    params: [
      { name: 'n', default: 3.0, min: 1.0, max: 12.0, step: 1.0 },
      { name: 'offset', default: 0.0, min: -3.14, max: 3.14, step: 0.1 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y, n = 3.0, offset = 0.0) => {
      const r = Math.sqrt(x * x + y * y);
      if (r < 1e-6) return [0, 0];
      let a = Math.atan2(y, x) - offset;
      const theta = 6.283185307179586 / Math.max(1.0, n);
      a = a - theta * Math.floor(a / theta);
      if (a > theta * 0.5) a = theta - a;
      a = a + offset;
      return [r * Math.cos(a), r * Math.sin(a)];
    },
  },
  {
    idx: V.standard_map,
    name: 'standard_map',
    source: 'novel',
    formula: 'x\' = x + k \\sin y, \\quad y\' = y + x\'',
    blurb: 'Chirikov-Taylor standard map. A classic area-preserving map that models a kicked rotor. The k parameter controls the transition from regular motion (KAM tori) to widespread chaos.',
    params: [
      { name: 'k', default: 0.5, min: 0.0, max: 5.0, step: 0.01 },
    ],
    defaultWeight: 0.45,
    warpFn: (x, y, k = 0.5) => { // #252 — k default must match params[].default (was 1.0)
      const xp = x + k * Math.sin(y);
      const yp = y + xp;
      return [xp, yp];
    },
  },
  {
    idx: V.de_jong,
    name: 'de_jong',
    source: 'novel',
    formula: 'x\' = \\sin(ay) - \\cos(bx), \\quad y\' = \\sin(cx) - \\cos(dy)',
    blurb: 'Peter de Jong strange attractor. A simple trigonometric mapping that folds space into intricate, wispy filaments.',
    params: [
      { name: 'a', default: -2.24, min: -3.0, max: 3.0, step: 0.01 },
      { name: 'b', default: 0.43, min: -3.0, max: 3.0, step: 0.01 },
      { name: 'c', default: -0.65, min: -3.0, max: 3.0, step: 0.01 },
      { name: 'd', default: -2.43, min: -3.0, max: 3.0, step: 0.01 },
    ],
    defaultWeight: 0.94,
    warpFn: (x, y, a = -2.24, b = 0.43, c = -0.65, d = -2.43) => {
      return [
        Math.sin(a * y) - Math.cos(b * x),
        Math.sin(c * x) - Math.cos(d * y)
      ];
    },
  },
  {
    idx: V.ikeda,
    name: 'ikeda',
    source: 'novel',
    formula: 't = 0.4 - \\frac{6}{1+x^2+y^2}, \\quad x\' = 1 + u(x\\cos t - y\\sin t), \\quad y\' = u(x\\sin t + y\\cos t)',
    blurb: 'Ikeda map. A discrete-time dynamical system introduced by Kensuke Ikeda as a model of light going around across a nonlinear optical resonator.',
    params: [
      { name: 'u', default: 0.9, min: 0.1, max: 1.5, step: 0.1 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y, u = 0.9) => {
      const t = 0.4 - 6.0 / (1.0 + x * x + y * y);
      const st = Math.sin(t);
      const ct = Math.cos(t);
      return [
        1.0 + u * (x * ct - y * st),
        u * (x * st + y * ct)
      ];
    },
  },
  {
    idx: V.mercator,
    name: 'mercator',
    source: 'novel',
    formula: 'x\' = x, \\quad y\' = \\ln\\left(\\tan\\left(\\frac{\\pi}{4} + \\frac{y}{2}\\right)\\right)',
    blurb: 'Standard conformal cylindrical projection. Treats (x,y) as (longitude, latitude) and applies the classic Mercator map projection. Vertical coordinates are clamped to avoid infinity at the poles.',
    defaultWeight: 0.5,
    warpFn: (x, y) => {
      const lat = Math.max(-1.5, Math.min(1.5, y));
      const y_prime = Math.log(Math.abs(Math.tan(0.78539816 + lat * 0.5)) + 1e-6);
      return [x, y_prime];
    },
  },
  {
    idx: V.lambert,
    name: 'lambert',
    source: 'novel',
    formula: 'k = \\sqrt{\\frac{2}{1 + \\cos y \\cos x}}, \\quad x\' = k \\cos y \\sin x, \\quad y\' = k \\sin y',
    blurb: 'Lambert azimuthal equal-area projection. Maps the sphere to a disk while perfectly preserving area, causing increasing angular distortion towards the edges.',
    defaultWeight: 0.5,
    warpFn: (x, y) => {
      const k = Math.sqrt(2.0 / (1.0 + Math.cos(y) * Math.cos(x) + 1e-6));
      return [k * Math.cos(y) * Math.sin(x), k * Math.sin(y)];
    },
  },
  {
    idx: V.mollweide,
    name: 'mollweide',
    source: 'novel',
    formula: '2\\theta + \\sin(2\\theta) = \\pi \\sin y, \\quad x\' = \\frac{2\\sqrt{2}}{\\pi} x \\cos\\theta, \\quad y\' = \\sqrt{2} \\sin\\theta',
    blurb: 'Mollweide elliptical equal-area projection. An iconic map projection that trades off shape and angle accuracy for perfect global area proportion. The auxiliary angle is computed via Newton-Raphson iteration.',
    defaultWeight: 0.5,
    warpFn: (x, y) => {
      let t = y;
      const target = Math.PI * Math.sin(y);
      for (let i = 0; i < 4; i++) {
        const sin2 = Math.sin(2 * t);
        const cos2 = Math.cos(2 * t);
        const f = 2 * t + sin2 - target;
        const df = 2 + 2 * cos2;
        if (Math.abs(df) < 1e-6) break;
        t -= f / df;
      }
      return [0.9003163 * x * Math.cos(t), 1.4142135 * Math.sin(t)];
    },
  },
  {
    idx: V.hammer,
    name: 'hammer',
    source: 'novel',
    formula: 'z = \\sqrt{1 + \\cos y \\cos\\frac{x}{2}}, \\quad x\' = \\frac{2\\sqrt{2} \\cos y \\sin\\frac{x}{2}}{z}, \\quad y\' = \\frac{\\sqrt{2} \\sin y}{z}',
    blurb: 'Hammer equal-area projection. Similar to Mollweide but reduces distortion at the outer meridians by projecting a hemisphere and then stretching it globally.',
    defaultWeight: 0.5,
    warpFn: (x, y) => {
      const z = Math.sqrt(1.0 + Math.cos(y) * Math.cos(x * 0.5) + 1e-6);
      const x_prime = (2.828427 * Math.cos(y) * Math.sin(x * 0.5)) / z;
      const y_prime = (1.4142135 * Math.sin(y)) / z;
      return [x_prime, y_prime];
    },
  },
  {
    idx: V.stereographic,
    name: 'stereographic',
    source: 'novel',
    formula: 'k = \\frac{2}{1 + \\cos y \\cos x}, \\quad x\' = k \\cos y \\sin x, \\quad y\' = k \\sin y',
    blurb: 'Stereographic azimuthal projection. Conformal (preserves local angles and circles) but neither equal-area nor equidistant. Creates a beautiful global swirl radiating outward from the pole.',

    defaultWeight: 0.5,
    warpFn: (x, y) => {
      const k = 2.0 / (1.0 + Math.cos(y) * Math.cos(x) + 1e-6);
      return [k * Math.cos(y) * Math.sin(x), k * Math.sin(y)];
    },
  },
  {
    idx: V.tinkerbell,
    name: 'tinkerbell',
    source: 'novel',
    formula: 'x\' = x^2 - y^2 + ax + by, \\quad y\' = 2xy + cx + dy',
    blurb: 'Tinkerbell map. A discrete dynamical system that produces a fractal shape resembling a flying tinkerbell.',
    params: [
      { name: 'a', default: 0.9, min: -2.0, max: 2.0, step: 0.05 },
      { name: 'b', default: -0.6, min: -2.0, max: 2.0, step: 0.05 },
      { name: 'c', default: 2.0, min: -2.0, max: 2.0, step: 0.05 },
      { name: 'd', default: 0.5, min: -2.0, max: 2.0, step: 0.05 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y, p0 = 0.9, p1 = -0.6, p2 = 2.0, p3 = 0.5) => {
      return [
        x * x - y * y + p0 * x + p1 * y,
        2.0 * x * y + p2 * x + p3 * y
      ];
    },
  },
  {
    idx: V.duffing,
    name: 'duffing',
    source: 'novel',
    formula: 'x\' = x + hy, \\quad y\' = y + h(x - x^3 - \\delta y + \\gamma \\cos(\\omega t))',
    blurb: 'Duffing equation map. One Euler step of the non-linear Duffing oscillator, which exhibits complex chaotic behavior.',
    params: [
      { name: 'h', default: 0.1, min: 0.01, max: 1.0, step: 0.01 },
      { name: 'delta', default: 0.1, min: 0.0, max: 1.0, step: 0.01 },
      { name: 'gamma', default: 0.1, min: 0.0, max: 1.0, step: 0.01 },
      { name: 'omega', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y, p0 = 0.1, p1 = 0.1, p2 = 0.1, p3 = 1.0) => {
      const t = x;
      return [
        x + p0 * y,
        y + p0 * (x - x * x * x - p1 * y + p2 * Math.cos(p3 * t))
      ];
    },
  },
  {
    idx: V.vanderpol,
    name: 'vanderpol',
    source: 'novel',
    formula: 'x\' = x + hy, \\quad y\' = y + h(\\mu(1-x^2)y - x)',
    blurb: 'Van der Pol oscillator map. One Euler step of the Van der Pol non-linear oscillator with non-conservative damping.',
    params: [
      { name: 'h', default: 0.1, min: 0.01, max: 1.0, step: 0.01 },
      { name: 'mu', default: 1.0, min: 0.0, max: 5.0, step: 0.1 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y, p0 = 0.1, p1 = 1.0) => {
      return [
        x + p0 * y,
        y + p0 * (p1 * (1.0 - x * x) * y - x)
      ];
    },
  },
  {
    idx: V.rossler,
    name: 'rossler',
    source: 'novel',
    formula: 'x\' = x + h(-y-z), \\quad y\' = y + h(x+ay)',
    blurb: 'Rössler attractor map. Projected into 2D using synthetic radius for z. Exhibits continuous-time chaotic flow.',
    params: [
      { name: 'h', default: 0.1, min: 0.01, max: 1.0, step: 0.01 },
      { name: 'a', default: 0.2, min: 0.0, max: 1.0, step: 0.01 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y, p0 = 0.1, p1 = 0.2) => {
      const z = Math.sqrt(x * x + y * y);
      return [
        x + p0 * (-y - z),
        y + p0 * (x + p1 * y)
      ];
    },
  },
  {
    idx: V.droste,
    name: 'droste',
    source: 'novel',
    formula: 'z \\to w\\,z^{\\,1 + i\\,\\ln s / 2\\pi},\\; z = x + iy',
    blurb: 'Droste effect conformal mapping. Zooms exponentially while rotating to tile the plane.',
    params: [
      { name: 's', default: 5.50, min: 0.1, max: 10.0, step: 0.1 },
    ],
    defaultWeight: 0.47,
    warpFn: (x, y, s = 5.50) => {
      const r = Math.max(Math.hypot(x, y), 1e-6);
      const theta = Math.atan2(y, x);
      const lns_2pi = Math.log(Math.max(s, 1e-4)) / 6.283185307179586;
      const re = Math.log(r) - lns_2pi * theta;
      const im = theta + lns_2pi * Math.log(r);
      const er = Math.exp(re);
      return [er * Math.cos(im), er * Math.sin(im)];
    },
  },
  {
    idx: V.logspiral,
    name: 'logspiral',
    source: 'novel',
    formula: 'r = a e^{k \\theta}',
    blurb: 'Logarithmic spiral parameterized by angle. Equiangular growth pattern.',
    params: [
      { name: 'a', default: 1.00, min: 0.1, max: 5.0, step: 0.1 },
      { name: 'k', default: 0.20, min: -5.0, max: 5.0, step: 0.1 },
    ],
    defaultWeight: 0.45,
    warpFn: (x, y, a = 1.00, k = 0.20) => {
      const theta = Math.atan2(y, x);
      const r = a * Math.exp(k * theta);
      return [r * Math.cos(theta), r * Math.sin(theta)];
    },
  },
  {
    idx: V.fermat_spiral,
    name: 'fermat_spiral',
    source: 'novel',
    formula: 'r = a \\sqrt{\\theta}',
    blurb: 'Fermat spiral. Spacing between successive turns grows smaller.',
    params: [
      { name: 'a', default: 0.90, min: 0.1, max: 5.0, step: 0.1 },
    ],
    defaultWeight: 0.26,
    warpFn: (x, y, a = 0.90) => {
      const t = Math.atan2(y, x);
      const theta = Math.max(t < 0 ? t + 2 * Math.PI : t, 1e-6);
      const r = a * Math.sqrt(theta);
      return [r * Math.cos(theta), r * Math.sin(theta)];
    },
  },
  {
    idx: V.lituus,
    name: 'lituus',
    source: 'novel',
    formula: 'r = a / \\sqrt{\\theta}',
    blurb: 'Lituus spiral. Area of circular sectors is constant.',
    params: [
      { name: 'a', default: 1.50, min: 0.1, max: 5.0, step: 0.1 },
    ],
    defaultWeight: 0.54,
    warpFn: (x, y, a = 1.50) => {
      const t = Math.atan2(y, x);
      const theta = Math.max(t < 0 ? t + 2 * Math.PI : t, 1e-6);
      const r = a / Math.sqrt(theta);
      return [r * Math.cos(theta), r * Math.sin(theta)];
    },
  },
  {
    idx: V.hyperbolic_spiral,
    name: 'hyperbolic_spiral',
    source: 'novel',
    formula: 'r = a / \\theta',
    blurb: 'Hyperbolic spiral (reciprocal spiral). Starts at infinity and winds to the origin.',
    params: [
      { name: 'a', default: 1.80, min: 0.1, max: 5.0, step: 0.1 },
    ],
    defaultWeight: 0.12,
    warpFn: (x, y, a = 1.80) => {
      const t = Math.atan2(y, x);
      const theta = Math.max(t < 0 ? t + 2 * Math.PI : t, 1e-6);
      const r = a / theta;
      return [r * Math.cos(theta), r * Math.sin(theta)];
    },
  },
  {
    idx: V.weierstrass,
    name: 'weierstrass',
    source: 'novel',
    formula: 'W(x, y) = \\sum a^n \\cos(b^n \\pi (x, y))',
    blurb: 'Weierstrass function. A classic continuous but nowhere differentiable fractal curve.',
    params: [
      { name: 'a', default: 0.5, min: 0.1, max: 0.9, step: 0.1 },
      { name: 'b', default: 3.0, min: 1.0, max: 7.0, step: 1.0 },
      { name: 'terms', default: 4.0, min: 1.0, max: 16.0, step: 1.0 },
      { name: 'amp', default: 0.5, min: 0.1, max: 5.0, step: 0.1 },
    ],
    defaultWeight: 1.0,
    warpFn: (x, y, a = 0.5, b = 3.0, terms = 4.0, amp = 0.5) => {
      let Wx = 0;
      let Wy = 0;
      const N = Math.max(1, Math.min(16, Math.floor(terms)));
      let ap = 1.0;
      let bp = 1.0;
      for (let i = 0; i < N; i++) {
        Wx += ap * Math.cos(bp * Math.PI * x);
        Wy += ap * Math.cos(bp * Math.PI * y);
        ap *= a;
        bp *= b;
      }
      return [x + amp * Wx, y + amp * Wy];
    },
  },
  {
    idx: V.takagi,
    name: 'takagi',
    source: 'novel',
    formula: 'T(x, y) = \\sum \\frac{|2^n (x, y) - \\lfloor 2^n (x, y) + 0.5 \\rfloor|}{2^n}',
    blurb: 'Takagi curve (blancmange curve). Another continuous but nowhere differentiable fractal, built from triangle waves.',
    params: [
      { name: 'terms', default: 4.0, min: 1.0, max: 16.0, step: 1.0 },
      { name: 'amp', default: 0.5, min: 0.1, max: 5.0, step: 0.1 },
    ],
    defaultWeight: 1.0,
    warpFn: (x, y, terms = 4.0, amp = 0.5) => {
      let Tx = 0;
      let Ty = 0;
      const N = Math.max(1, Math.min(16, Math.floor(terms)));
      let pow2 = 1.0;
      for (let i = 0; i < N; i++) {
        const x_scaled = pow2 * x;
        const y_scaled = pow2 * y;
        Tx += Math.abs(x_scaled - Math.floor(x_scaled + 0.5)) / pow2;
        Ty += Math.abs(y_scaled - Math.floor(y_scaled + 0.5)) / pow2;
        pow2 *= 2.0;
      }
      return [x + amp * Tx, y + amp * Ty];
    },
  },
  {
    idx: V.cantor_stairs,
    name: 'cantor_stairs',
    source: 'novel',
    formula: 'C(x, y) = \\text{iterated } \\frac{x + \\sin(2\\pi x)}{2}',
    blurb: "Devil's staircase approximation. Iteratively squeezes the identity line into a stair-step fractal.",
    params: [
      { name: 'terms', default: 4.0, min: 1.0, max: 8.0, step: 1.0 },
      { name: 'amp', default: 0.5, min: 0.1, max: 5.0, step: 0.1 },
    ],
    defaultWeight: 1.0,
    warpFn: (x, y, terms = 4.0, amp = 0.5) => {
      let Cx = x;
      let Cy = y;
      const N = Math.max(1, Math.min(8, Math.floor(terms)));
      for (let i = 0; i < N; i++) {
        Cx = (Cx + Math.sin(Cx * 2 * Math.PI)) * 0.5;
        Cy = (Cy + Math.sin(Cy * 2 * Math.PI)) * 0.5;
      }
      return [x + amp * Cx, y + amp * Cy];
    },
  },
  {
    idx: V.billiard_circle,
    name: 'billiard_circle',
    source: 'novel',
    formula: 'V_{258}(p) = p_{\\text{hit}} + (s - t_{\\text{hit}})(v - 2(v \\cdot n)n) \\quad (|p| \\le R)',
    blurb: 'Circular billiard table. Walker travels along a step distance, bouncing off the circular boundary with specular reflection if it hits.',
    params: [
      { name: 'radius', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
      { name: 'step', default: 0.5, min: 0.05, max: 5.0, step: 0.05 },
      // Default angle = 0.7 (~40°) — axis-aligned 0.0 collapses all walkers
      // to a single direction → bucket-contention freeze on the catalog scaffold.
      { name: 'angle', default: 0.7, min: -Math.PI, max: Math.PI, step: 0.05 },
    ],
    defaultWeight: 1.0,
    warpFn: (x, y) => {
      const res = ts_var_billiard_circle({
        tx: x,
        ty: y,
        weight: 1.0,
        params: { radius: 1.0, step: 0.5, angle: 0.7 },
      });
      return [res.x, res.y];
    },
  },
  {
    idx: V.billiard_stadium,
    name: 'billiard_stadium',
    source: 'novel',
    formula: 'V_{259}(p) = p_{\\text{hit}} + (s - t_{\\text{hit}})(v - 2(v \\cdot n)n) \\quad (\\text{Bunimovich stadium})',
    blurb: 'Bunimovich stadium billiard. Walker travels along a step distance, bouncing off the straight walls or semicircular caps with specular reflection.',
    params: [
      { name: 'width', default: 1.5, min: 0.1, max: 5.0, step: 0.1 },
      { name: 'height', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
      { name: 'step', default: 0.5, min: 0.05, max: 5.0, step: 0.05 },
      { name: 'angle', default: 0.7, min: -Math.PI, max: Math.PI, step: 0.05 },
    ],
    defaultWeight: 1.0,
    warpFn: (x, y) => {
      const res = ts_var_billiard_stadium({
        tx: x,
        ty: y,
        weight: 1.0,
        params: { width: 1.5, height: 1.0, step: 0.5, angle: 0.7 },
      });
      return [res.x, res.y];
    },
  },
  {
    idx: V.billiard_sinai,
    name: 'billiard_sinai',
    source: 'novel',
    formula: 'V_{260}(p) = p_{\\text{hit}} + (s - t_{\\text{hit}})(v - 2(v \\cdot n)n) \\quad (\\text{Sinai square table})',
    blurb: 'Sinai billiard. Walker travels inside a square region and bounces specularly off the outer walls or a central circular obstacle.',
    params: [
      { name: 'length', default: 2.0, min: 0.5, max: 10.0, step: 0.1 },
      { name: 'radius', default: 0.5, min: 0.05, max: 2.5, step: 0.05 },
      { name: 'step', default: 0.5, min: 0.05, max: 5.0, step: 0.05 },
      { name: 'angle', default: 0.7, min: -Math.PI, max: Math.PI, step: 0.05 },
    ],
    defaultWeight: 1.0,
    warpFn: (x, y) => {
      const res = ts_var_billiard_sinai({
        tx: x,
        ty: y,
        weight: 1.0,
        params: { length: 2.0, radius: 0.5, step: 0.5, angle: 0.7 },
      });
      return [res.x, res.y];
    },
  },
  {
    idx: V.billiard_polygon,
    name: 'billiard_polygon',
    source: 'novel',
    formula: 'V_{261}(p) = p_{\\text{hit}} + (s - t_{\\text{hit}})(v - 2(v \\cdot n)n) \\quad (\\text{regular } N\\text{-gon})',
    blurb: 'Polygonal billiard table. Walker travels and bounces specularly off the edges of a regular polygon of N sides.',
    params: [
      { name: 'sides', default: 5.0, min: 3.0, max: 12.0, step: 1.0 },
      { name: 'radius', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
      { name: 'step', default: 0.5, min: 0.05, max: 5.0, step: 0.05 },
      { name: 'angle', default: 0.7, min: -Math.PI, max: Math.PI, step: 0.05 },
    ],
    defaultWeight: 1.0,
    warpFn: (x, y) => {
      const res = ts_var_billiard_polygon({
        tx: x,
        ty: y,
        weight: 1.0,
        params: { sides: 5, radius: 1.0, step: 0.5, angle: 0.7 },
      });
      return [res.x, res.y];
    },
  },
  {
    idx: V.lorentz_boost,
    name: 'lorentz_boost',
    source: 'novel',
    formula: "V_{262}(p) = w\\,R(\\theta) \\cdot \\begin{bmatrix} \\cosh\\varphi & \\sinh\\varphi \\\\ \\sinh\\varphi & \\cosh\\varphi \\end{bmatrix} \\cdot R(-\\theta) \\cdot p",
    blurb: 'Lorentz boost by rapidity φ along an axis at angle θ — the Minkowski analog of swirl. Reduces to identity at φ=0; expands shear along the boost axis as φ grows.',
    params: [
      { name: 'rapidity', default: 0.5, min: -2.0, max: 2.0, step: 0.05 },
      { name: 'angle', default: 0.0, min: -Math.PI, max: Math.PI, step: 0.05 },
    ],
    defaultWeight: 1.0,
    warpFn: (x, y) => {
      const res = ts_var_lorentz_boost({
        tx: x,
        ty: y,
        weight: 1.0,
        params: { rapidity: 0.5, angle: 0.0 },
      });
      return [res.x, res.y];
    },
  },
  {
    idx: V.schwarzschild_lensing,
    name: 'schwarzschild_lensing',
    source: 'novel',
    formula: "V_{263}(p) = R(\\alpha)\\,p, \\quad \\alpha = \\frac{m}{|p| + \\varepsilon}",
    blurb: 'Gravitational lensing by a point mass at the origin. The position vector is deflected — rotated by the Schwarzschild angle α = m/(|p|+ε) — strongly near the lens and vanishingly far away (the opposite radial falloff to swirl). ε softens the core singularity.',
    params: [
      { name: 'mass', default: 0.5, min: 0.0, max: 3.0, step: 0.05 },
      { name: 'eps', default: 0.05, min: 0.001, max: 1.0, step: 0.01 },
    ],
    defaultWeight: 1.0,
    warpFn: (x, y) => {
      const res = ts_var_schwarzschild_lensing({
        tx: x,
        ty: y,
        weight: 1.0,
        params: { mass: 0.5, eps: 0.05 },
      });
      return [res.x, res.y];
    },
  },
  {
    idx: V.field_dipole,
    name: 'field_dipole',
    source: 'novel',
    formula: "V_{264}(p) = p + s \\cdot q \\cdot \\left( \\frac{p - c_+}{|p - c_+|^3} - \\frac{p - c_-}{|p - c_-|^3} \\right)",
    blurb: 'Classical electric-dipole field. Walker is stepped along the local E-field of two opposite ±charges offset by ±separation/2 along the dipole axis. 1/r³ singularities at the poles are eps-softened.',
    params: [
      { name: 'charge', default: 1.0, min: -3.0, max: 3.0, step: 0.05 },
      { name: 'separation', default: 0.5, min: 0.1, max: 2.0, step: 0.05 },
      { name: 'step', default: 0.2, min: 0.01, max: 1.0, step: 0.01 },
      { name: 'angle', default: 0.0, min: -Math.PI, max: Math.PI, step: 0.05 },
    ],
    defaultWeight: 1.0,
    warpFn: (x, y) => {
      const res = ts_var_field_dipole({
        tx: x,
        ty: y,
        weight: 1.0,
        params: { charge: 1.0, separation: 0.5, step: 0.2, angle: 0.0 },
      });
      return [res.x, res.y];
    },
  },
  {
    idx: V.magnetic_pendulum,
    name: 'magnetic_pendulum',
    source: sourceForIdx(V.magnetic_pendulum),
    formula: "V_{265}(p) = p + s \\sum_{k=0}^{N-1} \\frac{M_k - p}{|M_k - p|^3} - d \\cdot p, \\quad M_k = R \\cdot (\\cos\\tfrac{2\\pi k}{N}, \\sin\\tfrac{2\\pi k}{N})",
    blurb: 'N-magnet pendulum (3–6 magnets on a ring of radius R). Walker is pulled by inverse-square attractions and damped toward origin; chaotic basins emerge. When dc_flag is set, each walker is coloured by its nearest-magnet basin index.',
    params: [
      { name: 'magnets', default: 3.0, min: 3.0, max: 6.0, step: 1.0 },
      { name: 'radius', default: 1.0, min: 0.3, max: 2.5, step: 0.05 },
      { name: 'strength', default: 0.5, min: 0.0, max: 2.0, step: 0.05 },
      { name: 'damping', default: 0.1, min: 0.0, max: 1.0, step: 0.01 },
    ],
    defaultWeight: 1.0,
    warpFn: (x, y) => {
      const res = ts_var_magnetic_pendulum({
        tx: x,
        ty: y,
        weight: 1.0,
        params: { magnets: 3, radius: 1.0, strength: 0.5, damping: 0.1 },
      });
      return [res.x, res.y];
    },
  },
  {
    idx: V.jacobi_theta,
    name: 'jacobi_theta',
    source: 'novel',
    formula: '\\vartheta_3(\\tau) = 1 + 2\\sum_{n\\geq1} q^{n^2}, \\quad q = e^{i\\pi\\tau}',
    blurb: 'Jacobi theta function θ₃ — the q-series substrate of the modular family, made visible. The point is folded into the upper half-plane (τ) and held off the real axis by im_floor; smaller im_floor crowds the real axis for more quasi-periodic horizontal banding. The gentlest of the modular set.',
    params: [{ name: 'im_floor', default: 0.15, min: 0.02, max: 1.0, step: 0.01 }],
    defaultWeight: 1.0,
    warpFn: (x, y) => modularEval(x, y, 0.15, 'theta3'),
  },
  {
    idx: V.modular_lambda,
    name: 'modular_lambda',
    source: 'novel',
    formula: '\\lambda(\\tau) = \\left(\\frac{\\vartheta_2(\\tau)}{\\vartheta_3(\\tau)}\\right)^{4}',
    blurb: 'Modular lambda function — doubly-periodic and wildly self-similar under the congruence subgroup Γ(2). Maps the upper half-plane onto ℂ∖{0,1}; on the imaginary axis it is real in (0,1) with λ(i)=½. Lower im_floor reveals deeper SL(2,ℤ) tessellation (at the cost of convergence).',
    params: [{ name: 'im_floor', default: 0.08, min: 0.02, max: 1.0, step: 0.01 }],
    defaultWeight: 0.10,
    warpFn: (x, y) => modularEval(x, y, 0.08, 'lambda'),
  },
  {
    idx: V.klein_j,
    name: 'klein_j',
    source: 'novel',
    formula: 'j = 256\\,\\frac{(1-\\lambda+\\lambda^2)^3}{\\lambda^2(1-\\lambda)^2}',
    blurb: 'Klein j-invariant — the canonical SL(2,ℤ)-invariant function, with j(i)=1728. Blows up as λ→0,1, so output is log-compressed (direction preserved, magnitude tamed) to keep the structure framable. The deepest "number theory you can see" of the family.',
    params: [{ name: 'im_floor', default: 0.32, min: 0.05, max: 1.0, step: 0.01 }],
    defaultWeight: 0.03,
    warpFn: (x, y) => modularEval(x, y, 0.32, 'j'),
  },
  {
    idx: V.weierstrass_p,
    name: 'weierstrass_p',
    source: 'novel',
    formula: "\\wp(z) = \\frac{1}{z^2} + \\sum_{\\omega\\neq0}\\left[\\frac{1}{(z-\\omega)^2} - \\frac{1}{\\omega^2}\\right]",
    blurb: 'Weierstrass elliptic ℘ over a 5×5 lattice truncation with generators ω₁, ω₂. Doubly-periodic double poles tile the plane into repeating cells; output is log-compressed to tame the poles. Skew ω₂ off (0,1) to shear the lattice from square to rhombic.',
    params: [
      { name: 'omega1_re', default: -1.0, min: -2.0, max: 2.0, step: 0.05 },
      { name: 'omega1_im', default: -1.1, min: -2.0, max: 2.0, step: 0.05 },
      { name: 'omega2_re', default: -0.5, min: -2.0, max: 2.0, step: 0.05 },
      { name: 'omega2_im', default: 1.0, min: -2.0, max: 2.0, step: 0.05 },
    ],
    defaultWeight: 0.18,
    warpFn: (x, y) => weierstrassEval(x, y, -1.0, -1.1, -0.5, 1.0),
  },
  {
    idx: V.gauss_map,
    name: 'gauss_map',
    source: 'novel',
    formula: 'x \\mapsto \\frac{1}{x} - \\left\\lfloor \\frac{1}{x} \\right\\rfloor',
    blurb: 'Gauss / continued-fraction map applied per axis. The arithmetic engine behind continued fractions, producing Stern-Brocot self-similarity. Each axis lands in [0,1); the discontinuities at 1/x integer crossings shatter the plane into a self-similar comb.',
    defaultWeight: 0.20,
    warpFn: (x, y) => [gaussFrac(x), gaussFrac(y)],
  },
  // ── More Variations Marathon (#16) — V271–V303 ──
  // #132 — Exotic warps
  {
    idx: V.nbody_lensing,
    name: 'nbody_lensing',
    source: 'novel',
    formula: "p' = p + \\sum_{i=1}^{2} \\frac{G\\,m_i\\,(c_i-p)}{\\left(|c_i-p|^2 + \\varepsilon\\right)^{3/2}}",
    blurb: 'Deflects the walker by the softened gravitational pull of two fixed point masses. The ε-softening turns the 1/r² singularities into smooth lensing wells, folding the plane into gravitational-caustic arcs. Default masses + ε keep displacement well inside the scaffold.',
    params: [
      { name: 'c1x', default: -0.4, min: -2, max: 2, step: 0.05 },
      { name: 'c1y', default: 0, min: -2, max: 2, step: 0.05 },
      { name: 'c2x', default: 0.4, min: -2, max: 2, step: 0.05 },
      { name: 'c2y', default: 0, min: -2, max: 2, step: 0.05 },
      { name: 'm1', default: 0.06, min: 0, max: 1, step: 0.01 },
      { name: 'm2', default: 0.06, min: 0, max: 1, step: 0.01 },
      { name: 'g', default: 1, min: 0, max: 4, step: 0.05 },
      { name: 'eps', default: 0.05, min: 0.005, max: 1, step: 0.005 },
    ],
    warpFn: (x, y) => { const c1x=-0.4,c1y=0.0,c2x=0.4,c2y=0.0,m1=0.06,m2=0.06,g=1.0; const e=Math.max(0.05,5e-3); const pull=(cx: number,cy: number,m: number): [number, number]=>{ const dx=cx-x, dy=cy-y; const r2=dx*dx+dy*dy+e; const inv=g*m/(r2*Math.sqrt(r2)); return [inv*dx, inv*dy]; }; const a=pull(c1x,c1y,m1); const b=pull(c2x,c2y,m2); return [x+a[0]+b[0], y+a[1]+b[1]]; },
  },
  {
    idx: V.curl_noise,
    name: 'curl_noise',
    source: 'novel',
    formula: "p' = p + a\\left(\\tfrac{\\partial \\psi}{\\partial y},\\, -\\tfrac{\\partial \\psi}{\\partial x}\\right),\\quad \\psi = \\mathrm{noise}(f\\,p)",
    blurb: 'Displaces the walker by the curl of a hash-based scalar value-noise potential ψ(x,y), giving a divergence-free, incompressible swirl field. The (∂ψ/∂y, −∂ψ/∂x) rotation produces smooth turbulent eddies with no sources or sinks — a procedural-graphics flow technique, not a flame idiom.',
    params: [
      { name: 'freq', default: 2.5, min: 0.5, max: 8, step: 0.1 },
      { name: 'amp', default: 0.3, min: 0, max: 1.5, step: 0.05 },
    ],
    warpFn: (x, y) => { const hash01 = (n: number) => { let h = n >>> 0; h = (h ^ (h >>> 17)) >>> 0; h = Math.imul(h, 0xed5ad4bb) >>> 0; h = (h ^ (h >>> 11)) >>> 0; h = Math.imul(h, 0xac4c1b51) >>> 0; h = (h ^ (h >>> 15)) >>> 0; return h / 4294967296; }; const corner = (ix: number, iy: number) => { const ux = Math.imul(ix >>> 0, 0x9e3779b1) >>> 0; const uy = Math.imul(iy >>> 0, 0x85ebca77) >>> 0; return hash01((ux ^ uy) >>> 0) * 2 - 1; }; const vn = (px: number, py: number) => { const fx = Math.floor(px), fy = Math.floor(py); const ix = fx | 0, iy = fy | 0; const tx = px - fx, ty = py - fy; const ux = tx*tx*(3-2*tx), uy = ty*ty*(3-2*ty); const c00 = corner(ix, iy), c10 = corner(ix+1, iy), c01 = corner(ix, iy+1), c11 = corner(ix+1, iy+1); const bottom = c00 + (c10-c00)*ux, top = c01 + (c11-c01)*ux; return bottom + (top-bottom)*uy; }; const f = Math.max(2.5, 1e-3), amp = 0.3; const sx = x*f, sy = y*f, h = 1e-2; const ddx = (vn(sx+h,sy)-vn(sx-h,sy))/(2*h); const ddy = (vn(sx,sy+h)-vn(sx,sy-h))/(2*h); let dx = ddy, dy = -ddx; dx = Math.max(-8, Math.min(8, dx)); dy = Math.max(-8, Math.min(8, dy)); return [x + amp*dx, y + amp*dy]; },
  },
  // #219 — stateless electrical-breakdown filament warp
  {
    idx: V.lichtenberg,
    name: 'lichtenberg',
    source: 'novel',
    formula: "p' = p - s\\,\\frac{f}{\\lVert\\nabla f\\rVert^{2}}\\,\\nabla f,\\quad f=\\mathrm{noise}_{\\text{radial}}(p)",
    blurb: 'Fakes a Lichtenberg / dielectric-breakdown figure with no per-walker tree state: one clamped Newton step pulls the walker onto the zero-set of a radially-biased multi-octave value-noise field, so chaos-game density collapses onto a branching web of thin filaments radiating from the center. `branches` sets the primary trunk count (a periodic angular lattice keeps it seam-free); `radial` blends isotropic crackle into the radial dendrite; `detail` adds self-similar tendrils. A stateless approximation of true stochastic breakdown — a procedural-graphics technique, not a flame idiom.',
    params: [
      { name: 'freq', default: 1.5, min: 0.2, max: 6, step: 0.1 },
      { name: 'branches', default: 5, min: 1, max: 16, step: 1 },
      { name: 'radial', default: 0.8, min: 0, max: 1, step: 0.05 },
      { name: 'detail', default: 3, min: 1, max: 4, step: 1 },
      { name: 'strength', default: 0.5, min: 0, max: 1.5, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const hash01 = (n: number) => { let h = n >>> 0; h = (h ^ (h >>> 17)) >>> 0; h = Math.imul(h, 0xed5ad4bb) >>> 0; h = (h ^ (h >>> 11)) >>> 0; h = Math.imul(h, 0xac4c1b51) >>> 0; h = (h ^ (h >>> 15)) >>> 0; return h / 4294967296; };
      const corner = (ix: number, iy: number) => { const ux = Math.imul(ix >>> 0, 0x9e3779b1) >>> 0; const uy = Math.imul(iy >>> 0, 0x85ebca77) >>> 0; return hash01((ux ^ uy) >>> 0) * 2 - 1; };
      const wrap = (i: number, period: number) => { const m = i % period; return m < 0 ? m + period : m; };
      const vnP = (px: number, py: number, period: number) => { const fx = Math.floor(px), fy = Math.floor(py); const ix = fx | 0, iy = fy | 0; const tx = px - fx, ty = py - fy; const ux = tx*tx*(3-2*tx), uy = ty*ty*(3-2*ty); const ix0 = wrap(ix, period), ix1 = wrap(ix+1, period); const c00 = corner(ix0, iy), c10 = corner(ix1, iy), c01 = corner(ix0, iy+1), c11 = corner(ix1, iy+1); const bottom = c00 + (c10-c00)*ux, top = c01 + (c11-c01)*ux; return bottom + (top-bottom)*uy; };
      const TAU = 6.28318530717958647692;
      const freq = 1.5, branches = 5, radial = 0.8, octaves = 3, strength = 0.5;
      const field = (px: number, py: number) => { const r = Math.hypot(px, py); const ang = Math.atan2(py, px) / TAU; const uP = (ang + 0.5) * branches, vP = r * freq; const uI = px * freq, vI = py * freq; let u = uI + (uP - uI) * radial, v = vI + (vP - vI) * radial; let period = Math.max(Math.round(branches), 1); let sum = 0, amp = 1, tot = 0; for (let k = 0; k < octaves; k++) { sum += amp * vnP(u, v, period); tot += amp; amp *= 0.5; u *= 2; v *= 2; period *= 2; } return sum / tot; };
      if (Math.hypot(x, y) < 1e-4) return [x, y];
      const H = 1e-2;
      const f0 = field(x, y), fxp = field(x+H, y), fxm = field(x-H, y), fyp = field(x, y+H), fym = field(x, y-H);
      const gx = (fxp - fxm) / (2*H), gy = (fyp - fym) / (2*H);
      const g2 = Math.max(gx*gx + gy*gy, 1e-3);
      let sx = -(f0 / g2) * gx, sy = -(f0 / g2) * gy;
      const slen = Math.hypot(sx, sy);
      if (slen > 2.0) { sx *= 2.0/slen; sy *= 2.0/slen; }
      return [x + strength*sx, y + strength*sy];
    },
  },
  // #217 — statistical copula warps (cross-axis dependence). The catalog's first
  // ANISOTROPIC statistical warp: x passes through, y' depends on BOTH coords via a
  // dependence parameter. copula_gaussian reuses the #218 erfinv (probit) helper.
  {
    idx: V.copula_gaussian,
    name: 'copula_gaussian',
    source: 'novel',
    formula: "z_y' = \\rho\\,z_x + \\sqrt{1-\\rho^2}\\,z_y,\\quad z=\\sqrt{2}\\,\\mathrm{erf}^{-1}\\!\\big(2\\sigma(sx)-1\\big)",
    blurb: 'The Gaussian copula — the catalog’s first anisotropic statistical warp. Each coordinate is mapped to a uniform by the logistic sigmoid, lifted to a standard-normal score by the probit (√2·erf⁻¹), then the two scores are mixed by the Cholesky correlation shear z_y′ = ρ·z_x + √(1−ρ²)·z_y before y′ is read back to coordinate scale. Unlike the rotationally-symmetric radial CDF family (weibull / cauchy / pareto / gaussian / levy_cdf, all r′ = f(r)), this is genuine 2D coupling: y′ depends on x. ρ controls the correlation — a symmetric elliptical shear along the diagonal, equal in both tails. The coupling is the exact Gaussian copula; the sigmoid (not the exact normal CDF) sets the coordinate map, chosen so the warp stays bounded in normal-score space.',
    params: [
      { name: 'strength', default: 1.0, min: 0.1, max: 4, step: 0.05 },
      { name: 'rho', default: 0.6, min: -0.95, max: 0.95, step: 0.05 },
    ],
    defaultWeight: 0.6,
    warpFn: (x, y) => { const s = 1.0, rho = 0.6; const sig = (t: number) => 1 / (1 + Math.exp(-t)); const erfinv = (xi: number) => { const xc = Math.max(-0.999999, Math.min(0.999999, xi)); const a = 0.147; const ln1 = Math.log(1 - xc * xc); const t1 = 2 / (Math.PI * a) + 0.5 * ln1; const inner = Math.sqrt(Math.max(t1 * t1 - ln1 / a, 0)) - t1; return Math.sign(xc) * Math.sqrt(Math.max(inner, 0)); }; const ss = Math.max(s, 1e-3); const u = Math.max(1e-4, Math.min(1 - 1e-4, sig(ss * x))); const v = Math.max(1e-4, Math.min(1 - 1e-4, sig(ss * y))); const zx = 1.4142135 * erfinv(2 * u - 1); const zy = 1.4142135 * erfinv(2 * v - 1); const r = Math.max(-0.95, Math.min(0.95, rho)); const zyp = r * zx + Math.sqrt(Math.max(1 - r * r, 0)) * zy; return [x, zyp / ss]; },
  },
  {
    idx: V.copula_clayton,
    name: 'copula_clayton',
    source: 'novel',
    formula: "h(v\\,|\\,u) = u^{-\\theta-1}\\big[u^{-\\theta}+v^{-\\theta}-1\\big]^{-1-1/\\theta},\\quad u=\\sigma(sx)",
    blurb: 'The Clayton copula — asymmetric LOWER-tail dependence, the sibling that breaks the Gaussian copula’s symmetry. Coordinates are mapped to uniforms by the logistic sigmoid, then the Clayton conditional value h(v|u) couples them and y′ is read back through the logit. θ sets the dependence strength: walkers cluster tightly when both coordinates are small (origin-ward) and stay loose when large — a one-cornered density no rotationally-symmetric radial warp can produce, and the visible asymmetry against the symmetric Gaussian copula. θ is hard-capped at 8 because u⁻θ races toward f32 overflow at the clamped uniform endpoint — a load-bearing boundedness cap, not a tuning knob.',
    params: [
      { name: 'strength', default: 1.0, min: 0.1, max: 4, step: 0.05 },
      { name: 'theta', default: 2.0, min: 0.05, max: 8, step: 0.05 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y) => { const s = 1.0, theta = 2.0; const sig = (t: number) => 1 / (1 + Math.exp(-t)); const ss = Math.max(s, 1e-3); const u = Math.max(1e-4, Math.min(1 - 1e-4, sig(ss * x))); const v = Math.max(1e-4, Math.min(1 - 1e-4, sig(ss * y))); const th = Math.max(0.05, Math.min(8, theta)); const ua = Math.pow(u, -th); const va = Math.pow(v, -th); const base = Math.max(ua + va - 1, 1e-6); const h = Math.pow(u, -th - 1) * Math.pow(base, -1 - 1 / th); const up = Math.max(1e-4, Math.min(1 - 1e-4, h)); const yp = Math.max(-12, Math.min(12, Math.log(up / (1 - up)))) / ss; return [x, yp]; },
  },
  // #154 — conformal-geometry warps (extend the #133 conformal family: blaschke,
  // mobius, schwarzschild_lensing, newton, cayley, complex_gamma, lambert_w).
  // Novel constructions with no JWF / flam3-C reference (verified 0 matches).
  {
    idx: V.schwarz_christoffel,
    name: 'schwarz_christoffel',
    source: 'novel',
    formula: "w(z) = \\int_0^z (1-\\zeta^n)^{-2/n}\\,d\\zeta = \\sum_k \\frac{(2/n)_k}{k!}\\,\\frac{z^{nk+1}}{nk+1}",
    blurb: 'The Schwarz-Christoffel map — the conformal transformation that sends the unit disk onto the interior of a regular polygon, here in its closed-form regular-n-gon case. The SC integral ∫₀ᶻ(1−ζⁿ)^(−2/n)dζ has no elementary antiderivative, so it is evaluated as the binomial series (1−u)^(−2/n) = Σ (2/n)ₖ/k!·uᵏ integrated term-by-term, a fast 10-term loop. sc_sides chooses the polygon — triangle, square, pentagon (the default), hexagon and up — and the disk fills that polygon with the characteristic conformal crowding toward the corners. Because the series converges only inside the unit disk, the input radius is soft-clamped just inside it, so every walker lands in the polygon interior. A true polygonal conformal warp, distinct from the radial and Möbius members of the conformal family.',
    params: [
      { name: 'sc_sides', default: 5, min: 3, max: 12, step: 1 },
    ],
    defaultWeight: 0.6,
    warpFn: (x, y) => {
      const n = 5; const ni = n;
      let zx = x, zy = y; const r = Math.hypot(x, y);
      if (r > 0.999) { const s = 0.999 / Math.max(r, 1e-12); zx *= s; zy *= s; }
      const a = 2 / n;
      const cpow = (k: number): [number, number] => {
        let rx = 1, ry = 0, bx = zx, by = zy, e = k;
        while (e > 0) {
          if (e & 1) { const nx = rx * bx - ry * by; ry = rx * by + ry * bx; rx = nx; }
          const sx = bx * bx - by * by; by = 2 * bx * by; bx = sx; e >>= 1;
        }
        return [rx, ry];
      };
      let ax = 0, ay = 0, coef = 1;
      for (let k = 0; k < 10; k++) {
        const pidx = ni * k + 1; const [px, py] = cpow(pidx);
        ax += (coef / pidx) * px; ay += (coef / pidx) * py;
        coef = coef * (a + k) / (k + 1);
      }
      return [ax, ay];
    },
  },
  {
    idx: V.doyle,
    name: 'doyle',
    source: 'novel',
    formula: "u=\\ln r,\\; v=\\theta,\\; \\kappa=\\tfrac{q}{p};\\quad \\rho=0.12\\big(\\sin pv+\\cos(pv-2\\pi(u+\\kappa v))\\big);\\quad z'=e^{\\,u+\\kappa v+\\rho}(\\cos v',\\sin v'),\\; v'=v+\\kappa\\rho",
    blurb: 'The Doyle spiral — a conformal hexagonal packing of mutually-tangent circles spiralling to the origin. Taking the complex logarithm sends that log-spiral lattice to a regular triangular lattice, so the whole construction becomes a shear of the (ln r, θ) strip: doyle_p sets the number of spiral arms, doyle_q the secondary winding, and their ratio is the spiral pitch (how fast angle bleeds into radius). A triangular ripple along the arms places the tangent-circle nodes, then the exponential maps everything back to the plane. The (p,q) basis is evaluated continuously, so animating between integer keyframes morphs the spiral smoothly rather than snapping. Where the Schwarz-Christoffel map fills a polygon, the Doyle warp winds the plane into self-similar spiral arms.',
    params: [
      { name: 'doyle_p', default: 2, min: 1, max: 8, step: 1 },
      { name: 'doyle_q', default: 1, min: 0, max: 8, step: 1 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y) => {
      const pp = 2, qq = 1;
      const u = 0.5 * Math.log(x * x + y * y + 1e-20);
      const v = Math.atan2(y, x);
      const pitch = qq / pp;
      const us = u + pitch * v;
      const ripple = 0.12 * (Math.sin(pp * v) + Math.cos(pp * v - 2 * Math.PI * us));
      const vs = v + pitch * ripple;
      const ex = Math.exp(Math.max(-20, Math.min(20, us + ripple)));
      return [ex * Math.cos(vs), ex * Math.sin(vs)];
    },
  },
  // #143 — aperiodic-tiling warps. quasicrystal sums n symmetric plane waves into
  // an interference field and displaces along its gradient (ridge-attraction);
  // penrose is the de Bruijn pentagrid cut-and-project that snaps points to
  // Penrose tile vertices. Both novel (no JWF / flam3-C reference).
  {
    idx: V.quasicrystal,
    name: 'quasicrystal',
    source: 'novel',
    formula: "s(\\mathbf{x})=\\sum_{k=0}^{n-1}\\cos\\!\\big(f\\,\\mathbf{x}\\cdot\\hat{u}_k\\big),\\;\\hat{u}_k=(\\cos\\theta_k,\\sin\\theta_k),\\;\\theta_k=\\tfrac{\\pi k}{n};\\quad \\mathbf{x}'=\\mathbf{x}-\\tfrac{\\sigma}{n}\\sum_{k}\\sin\\!\\big(f\\,\\mathbf{x}\\cdot\\hat{u}_k\\big)\\,\\hat{u}_k",
    blurb: 'The quasicrystal — n-fold plane-wave interference, the pattern that tiles the plane with perfect rotational symmetry but never repeats. n plane waves at evenly-spaced angles θₖ = πk/n are summed into an interference field, and each point is displaced along that field’s gradient (ridge-attraction), so walkers accumulate on the bright fringes and trace out the quasicrystalline lattice. qc_symmetry sets the fold: 5 gives the iconic Penrose-like five-fold star, 7 and 12 give other forbidden crystallographic symmetries, and qc_freq sets the spatial scale of the fringes. The gradient is computed in closed form (no finite differences), so the warp is cheap — just n cosines and a sum. A genuinely aperiodic structure no lattice-based warp can produce.',
    params: [
      { name: 'qc_symmetry', default: 5, min: 2, max: 12, step: 1 },
      { name: 'qc_freq', default: 3, min: 0.5, max: 12, step: 0.1 },
    ],
    defaultWeight: 0.6,
    warpFn: (x, y) => {
      const n = 5, freq = 3, QC_STEP = 0.4;
      let gx = 0, gy = 0;
      for (let k = 0; k < n; k++) {
        const th = Math.PI * k / n; const c = Math.cos(th), s = Math.sin(th);
        const d = freq * (x * c + y * s); const sw = Math.sin(d);
        gx -= sw * c; gy -= sw * s;
      }
      gx /= n; gy /= n;
      return [x + QC_STEP * gx, y + QC_STEP * gy];
    },
  },
  {
    idx: V.penrose,
    name: 'penrose',
    source: 'novel',
    formula: "K_j=\\lfloor s\\,\\mathbf{x}\\cdot(\\cos\\theta_j,\\sin\\theta_j)+\\gamma\\rfloor,\\;\\theta_j=\\tfrac{2\\pi j}{5};\\quad \\mathbf{x}'=\\tfrac{1}{s}\\sum_j K_j(\\cos\\theta_j,\\sin\\theta_j)",
    blurb: 'The Penrose tiling — built by de Bruijn’s pentagrid cut-and-project, the classic route from five families of parallel lines to the famous aperiodic rhombus tiling. Each point is projected onto five directions at 2πj/5, floored to an integer index per family, and the index five-tuple is mapped back to its Penrose tile vertex. The result snaps every walker to the tiling’s vertices, so the attractor becomes the Penrose lattice itself. pen_scale sets the tiling frequency and pen_offset the pentagrid phase γ. This ships the generalized constant-offset pentagrid (a true Penrose tiling additionally requires the offsets to sum to zero); the constant-γ form is the common shader variant and is still genuinely aperiodic.',
    params: [
      { name: 'pen_scale', default: 0.8, min: 0.1, max: 6, step: 0.1 },
      { name: 'pen_offset', default: 0.3, min: -1, max: 1, step: 0.05 },
    ],
    defaultWeight: 0.12,
    warpFn: (x, y) => {
      const scale = 0.8, gamma = 0.3;
      let vx = 0, vy = 0;
      for (let j = 0; j < 5; j++) {
        const th = 2 * Math.PI * j / 5; const c = Math.cos(th), s = Math.sin(th);
        const kk = Math.floor(scale * (x * c + y * s) + gamma);
        vx += kk * c; vy += kk * s;
      }
      return [vx / scale, vy / scale];
    },
  },
  // #142 — number-theoretic dynamics. collatz is the smooth complex 3n+1 map
  // (parity interpolation); digamma is ψ(z) via asymptotic series + recurrence.
  // Both novel (no JWF / flam3-C reference).
  {
    idx: V.collatz,
    name: 'collatz',
    source: 'novel',
    formula: "f(z) = \\tfrac{z}{2}\\cos^2\\!\\tfrac{\\pi z}{2} + \\tfrac{3z+1}{2}\\sin^2\\!\\tfrac{\\pi z}{2}",
    blurb: 'The Collatz map — the famous 3n+1 conjecture’s step, extended to a smooth complex-analytic function. The two integer branches (halve the evens, triple-plus-one the odds) are interpolated by cos²(πz/2) and sin²(πz/2), which are exactly 1 and 0 at even integers and swap at odd integers, so f agrees with the arithmetic Collatz step on the integers and flows smoothly between them across the complex plane. Treating each point as a complex number, the warp folds the plane through this parity dynamic — col_scale sets how many integer cells the pattern spans and col_shift slides the even/odd grid. A genuine arithmetic-dynamics warp no analytic function in the catalog reproduces.',
    params: [
      { name: 'col_scale', default: 0.65, min: 0.1, max: 4, step: 0.05 },
      { name: 'col_shift', default: 0.3, min: -2, max: 2, step: 0.05 },
    ],
    defaultWeight: 0.21,
    warpFn: (x, y) => {
      const scale = 0.65, shift = 0.3;
      const zx = x * scale + shift, zy = y * scale;
      const ax = zx * Math.PI / 2, ay = zy * Math.PI / 2;   // π z / 2
      const csin = (rx: number, ry: number): [number, number] => {
        const yy = Math.max(-20, Math.min(20, ry));
        return [Math.sin(rx) * Math.cosh(yy), Math.cos(rx) * Math.sinh(yy)];
      };
      const cmul = (a: [number, number], b: [number, number]): [number, number] =>
        [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
      const sn = csin(ax, ay), cs = csin(ax + Math.PI / 2, ay);
      const s2 = cmul(sn, sn), c2 = cmul(cs, cs);
      const even = cmul([0.5 * zx, 0.5 * zy], c2);
      const odd = cmul([0.5 * (3 * zx + 1), 0.5 * (3 * zy)], s2);
      return [even[0] + odd[0], even[1] + odd[1]];
    },
  },
  {
    idx: V.digamma,
    name: 'digamma',
    source: 'novel',
    formula: "\\psi(z) = \\psi(z{+}N) - \\sum_{k=0}^{N-1}\\frac{1}{z+k},\\;\\; \\psi(z') \\approx \\ln z' - \\tfrac{1}{2z'} - \\tfrac{1}{12 z'^2} + \\tfrac{1}{120 z'^4}",
    blurb: 'The digamma function ψ(z) = Γ′(z)/Γ(z), the logarithmic derivative of the gamma function. It is evaluated the standard way: a recurrence shifts the argument up by six to reach the regime where the asymptotic series ln z − 1/2z − 1/12z² + 1/120z⁴ converges quickly, then the shift is undone by subtracting the harmonic tail. As a warp, each point flows along the complex digamma field, whose simple poles at the non-positive integers (0, −1, −2, …) create a lattice of singular wells that sculpt the attractor. dig_scale sets the scale and dig_shift slides the pole lattice. Real-axis sanity: ψ(1) = −γ, the Euler–Mascheroni constant. A special-function warp distinct from the radial gamma-family members.',
    params: [
      { name: 'dig_scale', default: 2.3, min: 0.1, max: 4, step: 0.05 },
      { name: 'dig_shift', default: 1.35, min: -2, max: 2, step: 0.05 },
    ],
    defaultWeight: 0.19,
    warpFn: (x, y) => {
      const scale = 2.3, shift = 1.35;
      let zx = x * scale + shift, zy = y * scale;
      const crecip = (rx: number, ry: number): [number, number] => {
        const m2 = Math.max(rx * rx + ry * ry, 1e-100);
        return [rx / m2, -ry / m2];
      };
      const cmul = (a: [number, number], b: [number, number]): [number, number] =>
        [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
      let sx = 0, sy = 0;
      for (let k = 0; k < 6; k++) { const r = crecip(zx, zy); sx += r[0]; sy += r[1]; zx += 1; }
      const lz: [number, number] = [0.5 * Math.log(zx * zx + zy * zy + 1e-20), Math.atan2(zy, zx)];
      const zi = crecip(zx, zy), zi2 = cmul(zi, zi), zi4 = cmul(zi2, zi2);
      const px = lz[0] - 0.5 * zi[0] - (1 / 12) * zi2[0] + (1 / 120) * zi4[0] - sx;
      const py = lz[1] - 0.5 * zi[1] - (1 / 12) * zi2[1] + (1 / 120) * zi4[1] - sy;
      return [px, py];
    },
  },
  // #137 — Special-function radial profiles
  {
    idx: V.bessel_j0,
    name: 'bessel_j0',
    source: 'novel',
    formula: "(x',y') = J_0(k\\,r)\\,(x,y),\\quad r=\\sqrt{x^2+y^2}",
    blurb: 'Scales the radius by the Bessel function J₀(k·r), producing concentric interference rings that alternate sign at the zeros of J₀ — the canonical diffraction-ring look. The frequency knob k packs more rings inside the unit disk. |J₀|≤1 so the disk only contracts.',
    params: [{ name: 'freq', default: 8.1, min: 0.5, max: 12, step: 0.1 }],
    defaultWeight: 0.33,
    warpFn: (x, y) => { const freq = 8.1; const r = Math.hypot(x, y); const ax = Math.abs(freq * r); let j; if (ax < 3.0) { const yy = (freq*r)*(freq*r)/9.0; j = 1.0 + yy*(-2.2499997 + yy*(1.2656208 + yy*(-0.3163866 + yy*(0.0444479 + yy*(-0.0039444 + yy*0.0002100))))); } else { const z = 3.0/ax, yy = z*z; const amp = 0.79788456 + yy*(-0.00000077 + yy*(-0.00552740 + yy*(-0.00009512 + yy*(0.00137237 + yy*(-0.00072805 + yy*0.00014476))))); const ph = ax - 0.78539816 + yy*(-0.04166397 + yy*(-0.00003954 + yy*(0.00262573 + yy*(-0.00054125 + yy*(-0.00029333 + yy*0.00013558))))); j = amp/Math.sqrt(ax)*Math.cos(ph); } return [j * x, j * y]; },
  },
  {
    idx: V.airy_radial,
    name: 'airy_radial',
    source: 'novel',
    formula: "(x',y') = 3\\,\\mathrm{Ai}\\!\\big(s\\,(r - \\delta)\\big)\\,(x,y)",
    blurb: 'Scales the radius by the Airy function Ai(scale·(r − shift)) — an asymmetric profile that oscillates with decaying amplitude on one side of the turning point and decays exponentially on the other, mimicking an optical caustic fold. Shifting the turning point sweeps the bright fold across the disk.',
    params: [
      { name: 'scale', default: 5.3, min: 0.5, max: 8, step: 0.1 },
      // shift must be POSITIVE: the Airy oscillatory caustic region is at
      // negative argument scale·(r−shift), reached only when r < shift. A
      // negative shift parks the whole disk in the Ai≈0 decay tail (dead warp).
      { name: 'shift', default: 0.85, min: -1, max: 4, step: 0.05 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y) => { const scale = 5.3, shift = 0.85; const r = Math.hypot(x, y); const xx = scale * (r - shift); let a; if (xx > 4.0) { const xi = (2/3)*Math.pow(xx,1.5); a = Math.exp(-xi)/(2*1.7724539*Math.pow(xx,0.25)); } else if (xx < -5.0) { const axx = -xx; const xi = (2/3)*Math.pow(axx,1.5); a = Math.sin(xi+0.78539816)/(1.7724539*Math.pow(axx,0.25)); } else { const c1=0.355028053887817,c2=0.258819403792807; const x3=xx*xx*xx; let f=1,tf=1,g=xx,tg=xx; for(let k=1;k<12;k++){tf*=x3/((3*k-1)*(3*k));f+=tf;tg*=x3/((3*k)*(3*k+1));g+=tg;} a=c1*f-c2*g; } return [3*a*x, 3*a*y]; },
  },
  {
    idx: V.cornu_spiral,
    name: 'cornu_spiral',
    source: 'novel',
    formula: "x' = w\\!\\int_0^{t}\\!\\cos\\!\\tfrac{\\pi s^2}{2}\\,ds,\\ y' = w\\Big(\\!\\int_0^{t}\\!\\sin\\!\\tfrac{\\pi s^2}{2}\\,ds + \\tfrac{y}{4}\\Big),\\ t=k\\,x",
    blurb: 'The Cornu (Euler) clothoid, evaluated via Heald’s rational approximation of the Fresnel integrals. Curvature grows linearly with arc length, so it winds into the two signature spiral eyes that the chaos game smears into continuously-tightening filaments.',
    params: [{ name: 'freq', default: 3.7, min: 0.2, max: 5, step: 0.05 }],
    defaultWeight: 0.78,
    warpFn: (x, y) => { const freq = 3.7; const t = freq * x; const s = Math.abs(t); const sgn = t < 0 ? -1 : 1; const f = (1 + 0.926*s)/(2 + 1.792*s + 3.104*s*s); const g = 1/(2 + 4.142*s + 3.492*s*s + 6.670*s*s*s); const a = Math.PI*s*s/2; const C = 0.5 + f*Math.sin(a) - g*Math.cos(a); const S = 0.5 - f*Math.cos(a) - g*Math.sin(a); return [sgn*C, sgn*S + 0.25*y]; },
  },
  {
    idx: V.struve_h1,
    name: 'struve_h1',
    source: 'novel',
    formula: "(x',y') = 0.6\\,H_1(k\\,r)\\,(x,y),\\quad H_1(x)=\\sum_{m\\geq0}\\frac{(-1)^m (x/2)^{2m+2}}{\\Gamma(m+\\tfrac32)\\,\\Gamma(m+\\tfrac52)}",
    blurb: 'Scales the radius by the Struve function H₁(k·r) — an oscillatory radial profile closely related to J₁ but offset, giving asymmetric off-center interference rings with a slow secular rise before the oscillation, a distinctly different ring spacing from the Bessel variant.',
    params: [{ name: 'freq', default: 6.1, min: 0.3, max: 8, step: 0.1 }],
    defaultWeight: 0.69,
    warpFn: (x, y) => { const freq = 6.1; const r = Math.hypot(x, y); const xc = Math.max(-10, Math.min(10, freq * r)); const hh = 0.5 * xc; const h2 = hh * hh; let term = h2 / (0.8862269 * 1.3293404); let sum = term; for (let m = 1; m < 16; m++) { term = term * (-(h2)) / ((m + 0.5) * (m + 1.5)); sum += term; } const g = 0.6 * sum; return [g * x, g * y]; },
  },
  // #141 — Quasi-random & digit-scramble warps
  {
    idx: V.radical_inverse,
    name: 'radical_inverse',
    source: 'novel',
    formula: '\\Phi_2(i)=\\sum_{k=0}^{B-1} d_k\\,2^{\\,B-1-k},\\quad i=\\sum_{k=0}^{B-1} d_k\\,2^{k}',
    blurb: 'Van der Corput radical-inverse warp: encode each axis to a fixed-point integer, reverse its base-2 digit string, decode back. The digit reversal is the arithmetic engine behind low-discrepancy sampling, rendered as a self-similar interleaved comb that quasi-randomizes position while staying perfectly bounded and trig-free.',
    params: [
      { name: 'extent', default: 1.35, min: 0.25, max: 4, step: 0.05 },
      { name: 'bits', default: 6, min: 2, max: 24, step: 1 },
    ],
    defaultWeight: 0.23,
    warpFn: (x, y) => { const extent = 1.35, bits = 6; const levels = Math.pow(2, bits); const s = Math.max(extent, 1e-4); const enc = (c: number) => { const norm = (c + s) / (2 * s); const folded = norm - Math.floor(norm); return Math.min((folded * levels) | 0, levels - 1) >>> 0; }; const rev = (v: number) => { let r = 0; for (let k = 0; k < bits; k++) { r = ((r << 1) | (v & 1)) >>> 0; v = v >>> 1; } return r >>> 0; }; const dec = (i: number) => ((i + 0.5) / levels) * 2 * s - s; const mask = (Math.pow(2, bits) - 1) >>> 0; return [dec(rev(enc(x)) & mask), dec(rev(enc(y)) & mask)]; },
  },
  {
    idx: V.gray_code,
    name: 'gray_code',
    source: 'novel',
    formula: 'g(i)=i\\oplus\\left\\lfloor i/2\\right\\rfloor=i\\oplus(i\\gg 1)',
    blurb: 'Binary-reflected Gray-code warp: encode each axis to a fixed-point integer and apply the Gray permutation x ^ (x>>1), which reorders the grid so consecutive cells differ by exactly one bit. A self-similar reflected-binary scramble — a different digit-permutation texture from radical_inverse, with adjacency structure rather than reversal.',
    params: [
      { name: 'extent', default: 1, min: 0.25, max: 4, step: 0.05 },
      { name: 'bits', default: 12, min: 2, max: 24, step: 1 },
    ],
    warpFn: (x, y) => { const extent = 1.0, bits = 12; const levels = Math.pow(2, bits); const s = Math.max(extent, 1e-4); const mask = (Math.pow(2, bits) - 1) >>> 0; const enc = (c: number) => { const norm = (c + s) / (2 * s); const folded = norm - Math.floor(norm); return Math.min((folded * levels) | 0, levels - 1) >>> 0; }; const gray = (v: number) => (v ^ (v >>> 1)) >>> 0; const dec = (i: number) => ((i + 0.5) / levels) * 2 * s - s; return [dec(gray(enc(x)) & mask), dec(gray(enc(y)) & mask)]; },
  },
  {
    idx: V.morton_zorder,
    name: 'morton_zorder',
    source: 'novel',
    formula: 'M(x,y)=\\sum_{k=0}^{B-1}\\big(x_k\\,2^{2k}+y_k\\,2^{2k+1}\\big)',
    blurb: 'Morton / Z-order space-filling remap: encode (x,y) to fixed-point indices, bit-interleave them into a single 1D Morton code, then split that code back into two axes. This folds the plane along the Z-order curve, producing the recursive quadrant-nested texture that underlies quadtree locality — distinct from JWildfire’s Hilbert.',
    params: [
      { name: 'extent', default: 1, min: 0.25, max: 4, step: 0.05 },
      { name: 'bits', default: 8, min: 2, max: 16, step: 1 },
    ],
    warpFn: (x, y) => { const extent = 1.0, bits = 8; const levels = Math.pow(2, bits); const s = Math.max(extent, 1e-4); const mask = (Math.pow(2, bits) - 1) >>> 0; const enc = (c: number) => { const norm = (c + s) / (2 * s); const folded = norm - Math.floor(norm); return Math.min((folded * levels) | 0, levels - 1) >>> 0; }; const part = (v: number) => { let r = 0; for (let i = 0; i < bits; i++) { r = (r | (((v >>> i) & 1) << (i * 2))) >>> 0; } return r >>> 0; }; const dec = (i: number) => ((i + 0.5) / levels) * 2 * s - s; const ix = enc(x), iy = enc(y); const code = (part(ix) | (part(iy) << 1)) >>> 0; const nx = code & mask; const ny = (code >>> bits) & mask; return [dec(nx), dec(ny)]; },
  },
  // #144 — Orthogonal-polynomial & harmonic warps
  {
    idx: V.chebyshev,
    name: 'chebyshev',
    source: 'novel',
    formula: 'T_n(\\cos\\theta)=\\cos(n\\theta),\\quad T_0=1,\\;T_1=x,\\;T_n=2xT_{n-1}-T_{n-2}',
    blurb: 'Per-axis Chebyshev Tₙ warp. Each coordinate is clamped into [-1,1] and pushed through the stable recurrence, where Tₙ(cos θ)=cos(nθ) folds the plane into n equal-ripple petals per axis — clean frequency multiplication without large powers. Order n sets the petal count; on [-1,1] the output is provably bounded by 1.',
    params: [
      { name: 'order_x', default: 4, min: 0, max: 12, step: 1 },
      { name: 'order_y', default: 3, min: 0, max: 12, step: 1 },
    ],
    warpFn: (x, y) => { const T = (v: number, n: number) => { const c = Math.max(-1, Math.min(1, v)); if (n <= 0) return 1; if (n === 1) return c; let a = 1, b = c, t = c; for (let k = 2; k <= n; k++) { t = 2 * c * b - a; a = b; b = t; } return t; }; return [T(x, 4), T(y, 3)]; },
  },
  {
    idx: V.legendre,
    name: 'legendre',
    source: 'novel',
    formula: '(n{+}1)P_{n+1}(x)=(2n{+}1)\\,x\\,P_n(x)-n\\,P_{n-1}(x),\\quad P_0=1,\\;P_1=x',
    blurb: 'Per-axis Legendre Pₙ warp via Bonnet’s recurrence. Like chebyshev but with the Legendre weighting — lobes crowd toward the ±1 endpoints instead of rippling evenly, giving a visibly different petal cadence. Bounded by |Pₙ(x)|≤1 on the clamped [-1,1] domain; order sets the lobe count per axis.',
    params: [
      { name: 'order_x', default: 5, min: 0, max: 12, step: 1 },
      { name: 'order_y', default: 4, min: 0, max: 12, step: 1 },
    ],
    warpFn: (x, y) => { const P = (v: number, n: number) => { const c = Math.max(-1, Math.min(1, v)); if (n <= 0) return 1; if (n === 1) return c; let a = 1, b = c, p = c; for (let k = 1; k < n; k++) { p = ((2 * k + 1) * c * b - k * a) / (k + 1); a = b; b = p; } return p; }; return [P(x, 5), P(y, 4)]; },
  },
  {
    idx: V.spherical_harmonic,
    name: 'spherical_harmonic',
    source: 'novel',
    formula: "r' = r\\bigl(1-a + a\\,|Y_\\ell^m(\\theta)|\\bigr),\\quad Y_\\ell^m(\\theta)\\propto P_\\ell^m(\\cos\\theta)\\cos(m\\theta)",
    blurb: 'Lobed-rosette warp: r′ = r·|Yₗᵐ(θ)| using the real tesseral spherical harmonic as an angular magnitude modulator. The (l,m) pair sculpts the number and arrangement of rosette lobes — raising l adds latitudinal rings, raising m adds azimuthal petals. Direction is preserved; only the radius is modulated.',
    params: [
      { name: 'degree_l', default: 3, min: 0, max: 6, step: 1 },
      { name: 'order_m', default: 2, min: 0, max: 6, step: 1 },
      { name: 'amount', default: 1, min: 0, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => { const r = Math.hypot(x, y); if (r < 1e-6) return [0, 0]; const th = Math.atan2(y, x); const l = 3, m = 2; const u = Math.cos(th); const assoc = (l: number, m: number, u: number) => { let pmm = 1; if (m > 0) { const s = Math.sqrt(Math.max(1 - u * u, 0)); let f = 1; for (let i = 1; i <= m; i++) { pmm *= -f * s; f += 2; } } if (l === m) return pmm; let pmmp1 = u * (2 * m + 1) * pmm; if (l === m + 1) return pmmp1; let pll = 0; for (let ll = m + 2; ll <= l; ll++) { pll = ((2 * ll - 1) * u * pmmp1 - (ll + m - 1) * pmm) / (ll - m); pmm = pmmp1; pmmp1 = pll; } return pll; }; const ylm = Math.min(4, Math.abs(assoc(l, m, u) * Math.cos(m * th))); const a = 1.0; const scale = (1 - a) + a * ylm; const rp = r * Math.max(-3, Math.min(3, scale)); return [x / r * rp, y / r * rp]; },
  },
  {
    idx: V.fourier_warp,
    name: 'fourier_warp',
    source: 'novel',
    formula: "r' = r\\Bigl(1 + a\\sum_{k=1}^{N}\\tfrac{1}{k}\\cos(k\\theta+\\varphi_k)\\Bigr)",
    blurb: 'Band-limited Fourier radial warp: a capped harmonic series with fixed hash-derived phases sums up to N angular harmonics into a single ruffled radial envelope — the petal/scallop count and irregularity come from the harmonic mix, not from any single frequency. The 1/k weighting + positive floor keep it bounded with no fold-through.',
    params: [
      { name: 'harmonics', default: 4, min: 1, max: 8, step: 1 },
      { name: 'amp', default: 0.4, min: 0, max: 0.9, step: 0.02 },
      { name: 'phase_seed', default: 1, min: 0, max: 64, step: 1 },
    ],
    warpFn: (x, y) => { const r = Math.hypot(x, y); if (r < 1e-6) return [0, 0]; const th = Math.atan2(y, x); const N = 4, amt = 0.4, sbase = 1; const h01 = (n: number) => { let h = n >>> 0; h ^= h >>> 17; h = Math.imul(h, 0xed5ad4bb); h ^= h >>> 11; h = Math.imul(h, 0xac4c1b51); h ^= h >>> 15; return (h >>> 0) / 4294967296; }; let acc = 0; for (let k = 1; k <= N; k++) { const phi = h01((Math.imul(sbase, 2654435761) + Math.imul(k, 40503)) >>> 0) * 2 * Math.PI; acc += Math.cos(k * th + phi) / k; } const env = 1 + amt * acc; const rp = r * Math.max(0.05, Math.min(3, env)); return [x / r * rp, y / r * rp]; },
  },
  // #146 — Optics warps
  {
    idx: V.snell_refraction,
    name: 'snell_refraction',
    source: 'novel',
    formula: "\\sin\\theta_2 = n_r\\sin\\theta_1,\\quad |n_r\\sin\\theta_1|\\ge 1\\Rightarrow\\text{reflect}",
    blurb: 'Geometric refraction across a flat interface at y=0: the walker’s radial direction is bent per Snell’s law. When the index ratio exceeds the critical angle the ray totally-internally-reflects, folding walkers back across the interface and concentrating density along the boundary. A pure direction rotation, so |out|=|p|.',
    params: [
      { name: 'n_ratio', default: 1.18, min: 0.2, max: 3, step: 0.01 },
      { name: 'strength', default: 0.5, min: 0, max: 1, step: 0.05 },
    ],
    defaultWeight: 0.9,
    warpFn: (x, y) => { const r = Math.hypot(x, y); if (r < 1e-6) return [x, y]; const dx = x/r, dy = y/r; const nr = Math.max(0.05, Math.min(5, 1.18)); const sin1 = dx, cos1 = dy; const sin2 = nr*sin1; let ox, oy; if (Math.abs(sin2) >= 1) { ox = dx; oy = -dy; } else { const cos2 = Math.sqrt(Math.max(1-sin2*sin2, 0)); ox = sin2; oy = cos1 >= 0 ? cos2 : -cos2; } const s = 0.5; const bx = dx+(ox-dx)*s, by = dy+(oy-dy)*s; const bl = Math.max(Math.hypot(bx, by), 1e-6); return [r*bx/bl, r*by/bl]; },
  },
  {
    idx: V.grin_lens,
    name: 'grin_lens',
    source: 'novel',
    formula: "V(p)=\\Big(|p|-\\tfrac{|p|}{f}\\cdot\\tfrac{\\varepsilon^2}{|p|^2+\\varepsilon^2}\\Big)\\,\\widehat{p}",
    blurb: 'Graded-index converging lens: the walker is pulled radially toward the focus by an amount that grows with distance but saturates near the focal scale, so the focus is a soft attractor rather than a hard 1/r singularity. Walkers pile into a bright focal core surrounded by a refracted halo.',
    params: [
      { name: 'focal', default: 0.45, min: 0.1, max: 3, step: 0.05 },
      { name: 'eps', default: 0.39, min: 0.01, max: 1, step: 0.01 },
    ],
    defaultWeight: 0.21,
    warpFn: (x, y) => { const f = Math.max(Math.abs(0.45), 0.05); const e = Math.max(Math.abs(0.39), 1e-3); const r = Math.hypot(x, y); if (r < 1e-6) return [x, y]; const soft = (e*e)/(r*r+e*e); const pull = (r/f)*soft; const dx = x/r, dy = y/r; const nr = Math.max(r-pull, -r); return [nr*dx, nr*dy]; },
  },
  {
    idx: V.caustic_fold,
    name: 'caustic_fold',
    source: 'novel',
    formula: "V(p)=w\\big(p - a\\,(\\sin(kx+\\phi),\\; \\sin(ky+\\phi))\\big)",
    blurb: 'A smooth phase field φ(p)=cos(kx)+cos(ky) is treated as an optical wavefront; the walker is displaced along ∇φ. Where neighbouring rays cross, density piles onto bright folded curves — caustics — that self-brighten as pyr3 accumulates density along them. A glowing net of light-fold lines.',
    params: [
      { name: 'freq', default: 4.5, min: 0.2, max: 8, step: 0.1 },
      { name: 'amp', default: 0.75, min: 0, max: 1, step: 0.05 },
      { name: 'phase', default: 0.01, min: -3.14159265, max: 3.14159265, step: 0.05 },
    ],
    warpFn: (x, y) => { const k = Math.max(0, Math.min(16, 4.5)); const a = Math.max(0, Math.min(2, 0.75)); const ph = 0.01; const gx = -Math.sin(k*x+ph); const gy = -Math.sin(k*y+ph); let ox = x+a*gx, oy = y+a*gy; ox = Math.max(-8, Math.min(8, ox)); oy = Math.max(-8, Math.min(8, oy)); return [ox, oy]; },
  },
  // #147 — Wave & nodal-pattern warps
  {
    idx: V.chladni,
    name: 'chladni',
    source: 'novel',
    formula: "F = \\cos(n\\pi x)\\cos(m\\pi y) - \\cos(m\\pi x)\\cos(n\\pi y),\\quad p' = p - s\\,\\tfrac{\\nabla|F|}{\\lVert\\nabla|F|\\rVert+\\varepsilon}",
    blurb: 'Warps toward the nodal set of a symmetric Chladni vibrating-plate field by stepping down the gradient of |F|, so density accumulates on the silent lines where the plate doesn’t move. The integer mode numbers n and m select the figure (use n≠m — n=m makes F≡0). The iconic sand-pattern look, never before a flame variation.',
    params: [
      { name: 'n', default: 3, min: 1, max: 12, step: 1 },
      { name: 'm', default: 5, min: 1, max: 12, step: 1 },
      { name: 'step', default: 0.18, min: 0, max: 0.6, step: 0.01 },
    ],
    warpFn: (x, y) => { const n = 3, m = 5, step = 0.18, PI = Math.PI; const an = PI*n, am = PI*m; const cnx=Math.cos(an*x), snx=Math.sin(an*x); const cmy=Math.cos(am*y), smy=Math.sin(am*y); const cmx=Math.cos(am*x), smx=Math.sin(am*x); const cny=Math.cos(an*y), sny=Math.sin(an*y); const F=cnx*cmy - cmx*cny; let gx=-an*snx*cmy + am*smx*cny; let gy=-am*cnx*smy + an*cmx*sny; const s = F<0?-1:1; gx*=s; gy*=s; const gl=Math.hypot(gx,gy); const inv=1/(gl+1e-4); return [x - step*gx*inv, y - step*gy*inv]; },
  },
  {
    idx: V.standing_wave,
    name: 'standing_wave',
    source: 'novel',
    formula: "p' = p + \\sum_{k=1}^{K} a\\,\\delta^{k-1}\\bigl(\\sin(k\\pi f x)\\sin(k\\pi f y),\\ \\sin(k\\pi f y)\\cos(k\\pi f x)\\bigr)",
    blurb: 'Displaces each point by a finite sum of separable standing-wave modes — the superposition that builds up a vibrating membrane’s shape. The fixed 4-mode cap and geometric amplitude falloff keep it bounded while still layering interference structure. The origin is a pinned node.',
    params: [
      { name: 'modes', default: 3, min: 1, max: 4, step: 1 },
      { name: 'freq', default: 1, min: 0.25, max: 4, step: 0.05 },
      { name: 'amp', default: 0.35, min: 0, max: 1, step: 0.01 },
      { name: 'decay', default: 0.6, min: 0.1, max: 1, step: 0.05 },
    ],
    warpFn: (x, y) => { const modes=3, freq=1.0, amp=0.35, decay=0.6, PI=Math.PI; const kmax=Math.min(4,Math.max(1,Math.round(modes))); const d=Math.min(0.999,Math.max(0,decay)); let dx=0, dy=0, ak=amp; for (let k=1;k<=4;k++){ const kf=k*PI*freq; const active = k<=kmax ? 1 : 0; dx += active*ak*Math.sin(kf*x)*Math.sin(kf*y); dy += active*ak*Math.sin(kf*y)*Math.cos(kf*x); ak*=d; } return [x+dx, y+dy]; },
  },
  {
    idx: V.moire,
    name: 'moire',
    source: 'novel',
    formula: "p' = p + a\\bigl(\\sin(\\pi f x)\\sin(\\pi(f{+}b)u),\\ \\sin(\\pi f y)\\sin(\\pi(f{+}b)v)\\bigr),\\ (u,v)=R_\\theta\\,p",
    blurb: 'Superimposes two rotated sinusoidal gratings and displaces along the slow beat-frequency interference pattern they create — the shimmering moiré fringes you see through two overlapping screens. The small frequency offset (beat) between the gratings sets the fringe spacing.',
    params: [
      { name: 'freq', default: 4, min: 0.5, max: 12, step: 0.1 },
      { name: 'beat', default: 0.6, min: 0, max: 3, step: 0.05 },
      { name: 'angle', default: 0.4, min: 0, max: 1.5708, step: 0.01 },
      { name: 'amp', default: 0.25, min: 0, max: 0.8, step: 0.01 },
    ],
    warpFn: (x, y) => { const freq=4.0, beat=0.6, angle=0.4, amp=0.25, PI=Math.PI; const ca=Math.cos(angle), sa=Math.sin(angle); const u=x*ca+y*sa, v=-x*sa+y*ca; const f1=freq, f2=freq+beat; const gx=Math.sin(f1*PI*x)*Math.sin(f2*PI*u); const gy=Math.sin(f1*PI*y)*Math.sin(f2*PI*v); return [x+amp*gx, y+amp*gy]; },
  },
  // #148 — Atomic-orbital warps
  {
    idx: V.radial_shell,
    name: 'radial_shell',
    source: 'novel',
    formula: "r' = \\tfrac{3}{2}\\,\\tfrac{|R_{nl}|^2}{1+|R_{nl}|^2},\\quad |R_{nl}|^2 = \\rho^{2l}e^{-\\rho}\\bigl[L^{2l+1}_{n-l-1}(\\rho)\\bigr]^2,\\ \\rho=\\tfrac{2r}{n\\,s}",
    blurb: 'Hydrogen radial probability shells |R_nl(r)|² made geometric. The radius is remapped by the squared radial wavefunction (Laguerre × exp envelope), so the n−l−1 radial nodes appear as concentric density rings — 1s a single core, 2s/3s nested shells, 2p/3d outward lobes. Angle preserved; the always-bounded sibling of hydrogen_orbital.',
    params: [
      { name: 'n', default: 3, min: 1, max: 4, step: 1 },
      { name: 'l', default: 0, min: 0, max: 3, step: 1 },
      { name: 'shell_scale', default: 1, min: 0.2, max: 3, step: 0.05 },
    ],
    warpFn: (x, y) => { const n = 3, l = 0, sc = 1.0; const r = Math.hypot(x, y); const rho = (2*r)/(n*Math.max(sc,1e-3)); const assocLag = (k: number, a: number, xv: number) => { if (k<=0) return 1; let lkm1=1, lk=1+a-xv; if (k===1) return lk; for (let j=1;j<k;j++){ const lkp1=((2*j+1+a-xv)*lk-(j+a)*lkm1)/(j+1); lkm1=lk; lk=lkp1; } return lk; }; const k=n-l-1, alpha=2*l+1; const lag=assocLag(k,alpha,Math.max(rho,0)); let rpow=1; for (let j=0;j<2*l;j++) rpow*=Math.max(rho,0); const amp=rpow*Math.exp(-Math.max(rho,0))*lag*lag; const rOut=1.5*(amp/(1+amp)); let dx=1, dy=0; if (r>1e-6){ dx=x/r; dy=y/r; } return [rOut*dx, rOut*dy]; },
  },
  {
    idx: V.hydrogen_orbital,
    name: 'hydrogen_orbital',
    source: 'novel',
    formula: "r' = \\tfrac{3}{2}\\,\\tfrac{A}{1+A},\\quad A = |R_{nl}(r)|^2\\,\\bigl|Y_l^m(\\theta)\\bigr|^2",
    blurb: 'The full hydrogen orbital |ψ_nlm|² = |R_nl(r)|²·|Y_l^m(θ)|² as a warp: radius modulated by the radial shells AND the angular lobes, reproducing the textbook 1s/2p/3d/4f shapes — spherical cores, dumbbells, cloverleaves. Radial nodes become density gaps; angular nodes carve the lobes. Reuses #144’s spherical-harmonic evaluator.',
    params: [
      { name: 'n', default: 3, min: 1, max: 4, step: 1 },
      { name: 'l', default: 1, min: 0, max: 3, step: 1 },
      { name: 'm', default: 0, min: -3, max: 3, step: 1 },
      { name: 'shell_scale', default: 0.85, min: 0.2, max: 3, step: 0.05 },
      { name: 'lobe_mix', default: 1, min: 0, max: 1, step: 0.05 },
    ],
    warpFn: (x, y) => { const n=3, l=1, sc=0.85, mix=1.0; const r=Math.hypot(x,y); const rho=(2*r)/(n*Math.max(sc,1e-3)); const assocLag=(k: number,a: number,xv: number)=>{ if(k<=0)return 1; let lkm1=1,lk=1+a-xv; if(k===1)return lk; for(let j=1;j<k;j++){const lkp1=((2*j+1+a-xv)*lk-(j+a)*lkm1)/(j+1); lkm1=lk; lk=lkp1;} return lk; }; const kk=n-l-1, alpha=2*l+1; const lag=assocLag(kk,alpha,Math.max(rho,0)); let rpow=1; for(let j=0;j<2*l;j++) rpow*=Math.max(rho,0); const rad=rpow*Math.exp(-Math.max(rho,0))*lag*lag; let cphi=1; if(r>1e-6) cphi=x/r; const yl=cphi; /* #246: P_1^0(cphi)=cphi, matching the engine's default l=1,m=0 (was hardcoded l=2 P2) */ const ang2=yl*yl; const ampFull=rad*ang2; const amp=rad+(ampFull-rad)*mix; const rOut=1.5*(amp/(1+amp)); let dx=1,dy=0; if(r>1e-6){dx=x/r; dy=y/r;} return [rOut*dx, rOut*dy]; },
  },
  // #151 — Statistical-distribution warps (radial inverse-CDF)
  {
    idx: V.weibull_cdf,
    name: 'weibull_cdf',
    source: 'novel',
    formula: "r' = \\lambda\\,\\bigl(-\\ln(1-u)\\bigr)^{1/k},\\quad u = \\tfrac{r^2}{1+r^2}",
    blurb: 'Radial inverse-CDF remap by the Weibull quantile, with u a bounded sigmoid of the input radius. Shape k sculpts a soft inner ring (k>1) or a spike-toward-zero crowding (k<1); fully bounded with no tail to clamp. Angle preserved.',
    params: [
      { name: 'lambda', default: 1.17, min: 0.05, max: 2, step: 0.01 },
      { name: 'k', default: 2.35, min: 0.3, max: 5, step: 0.05 },
    ],
    warpFn: (x, y) => { const r2 = x*x + y*y; const r = Math.sqrt(r2); const u = Math.min(Math.max(r2/(1+r2), 1e-4), 1-1e-4); const lambda = 1.17, k = 2.35; const kk = Math.max(Math.abs(k), 0.05); const rp = lambda * Math.pow(-Math.log(1-u), 1/kk); if (r < 1e-9) return [0,0]; return [rp*(x/r), rp*(y/r)]; },
  },
  {
    idx: V.logistic_cdf,
    name: 'logistic_cdf',
    source: 'novel',
    formula: "r' = \\mu + s\\,\\ln\\!\\tfrac{u}{1-u},\\quad u = \\tfrac{r^2}{1+r^2}",
    blurb: 'Smooth radial squash by the logistic (logit) quantile, u a bounded sigmoid of the input radius. The S-curve gently compresses the mid-radius band and is naturally bounded by clamping the logit — the tamest, most photogenic member. At μ=0 the unit circle collapses to the origin (the logit zero).',
    params: [
      // mu defaults to 0.6 (not 0): at mu=0, rp=2s·log(r) clamps the entire
      // r<1 disk to the origin — a degenerate collapse that tanks the live
      // renderer. mu>0 lifts the curve so the disk maps to distinct radii.
      { name: 'mu', default: 0.84, min: -1, max: 1, step: 0.01 },
      { name: 's', default: 1.07, min: 0.02, max: 1.5, step: 0.01 },
    ],
    defaultWeight: 0.25,
    warpFn: (x, y) => { const r2 = x*x + y*y; const r = Math.sqrt(r2); const u = Math.min(Math.max(r2/(1+r2), 1e-4), 1-1e-4); const mu = 0.84, s = 1.07; let logit = Math.log(u/(1-u)); logit = Math.min(Math.max(logit, -12), 12); let rp = mu + s*logit; rp = Math.max(rp, 0); if (r < 1e-9) return [0,0]; return [rp*(x/r), rp*(y/r)]; },
  },
  {
    idx: V.cauchy_cdf,
    name: 'cauchy_cdf',
    source: 'novel',
    formula: "r' = \\gamma\\,\\tan\\!\\bigl(\\pi(u-\\tfrac12)\\bigr),\\quad |r'| \\le c",
    blurb: 'The marquee heavy-tailed warp: radial Cauchy quantile, throwing sparse far-flung structure. The tan tail is HARD-clamped (Cauchy is heavy-tailed) so walkers never fling to infinity, and the trig routes through safe_tan. The unit circle is the median, mapped to the origin.',
    params: [
      { name: 'gamma', default: 0.25, min: 0.02, max: 1, step: 0.01 },
      { name: 'tail_clamp', default: 4, min: 1, max: 12, step: 0.25 },
    ],
    warpFn: (x, y) => { const r2 = x*x + y*y; const r = Math.sqrt(r2); const u = Math.min(Math.max(r2/(1+r2), 1e-4), 1-1e-4); const gamma = 0.25, cap = 4.0; const arg = Math.PI*(u-0.5); const raw = gamma*Math.tan(arg); const rp = Math.min(Math.max(raw, -cap), cap); if (r < 1e-9) return [0,0]; return [rp*(x/r), rp*(y/r)]; },
  },
  {
    idx: V.pareto_cdf,
    name: 'pareto_cdf',
    source: 'novel',
    formula: "r' = x_m\\,(1-u)^{-1/\\alpha},\\quad u = \\tfrac{r^2}{1+r^2},\\ r' \\le c",
    blurb: 'Power-law heavy-tailed warp: Pareto quantile pushing structure outward with an algebraic (not trig) tail. Distinct from cauchy_cdf in tail shape; the (1−u)^(−1/α) blow-up is HARD-clamped so the scaffold survives. Pushes a hollow ring starting at the scale x_m.',
    params: [
      { name: 'x_m', default: 0.61, min: 0.02, max: 1, step: 0.01 },
      { name: 'alpha', default: 0.9, min: 0.3, max: 6, step: 0.05 },
      { name: 'tail_clamp', default: 4, min: 1, max: 12, step: 0.25 },
    ],
    warpFn: (x, y) => { const r2 = x*x + y*y; const r = Math.sqrt(r2); const u = Math.min(Math.max(r2/(1+r2), 1e-4), 1-1e-4); const xm = 0.61, alpha = 0.9, cap = 4.0; const a = Math.max(Math.abs(alpha), 0.05); const raw = xm * Math.pow(1-u, -1/a); const rp = Math.min(raw, cap); if (r < 1e-9) return [0,0]; return [rp*(x/r), rp*(y/r)]; },
  },
  // #152 — Wavelet & signal warps
  {
    idx: V.morlet,
    name: 'morlet',
    source: 'novel',
    formula: "\\mathbf{p} \\mapsto \\mathbf{p}\\,\\bigl(1 + A\\,e^{-r^2/2\\sigma^2}\\cos(\\omega r)\\bigr)",
    blurb: 'Morlet wavelet packet as a radial displacement modulation: a Gaussian-windowed cosine ripples the radius, pushing points in and out along concentric shells that fade smoothly to identity past the envelope. Frequency sets the ring count; envelope width sets how far the ripples reach.',
    params: [
      { name: 'freq', default: 21, min: 0, max: 30, step: 0.1 },
      { name: 'sigma', default: 0.79, min: 0.05, max: 3, step: 0.01 },
      { name: 'amp', default: 0.35, min: -1, max: 1, step: 0.01 },
    ],
    warpFn: (x, y) => { const r = Math.hypot(x, y); const s = Math.max(0.79, 0.05); const t = r / s; const env = Math.exp(-0.5 * Math.min(t * t, 80)); const psi = env * Math.cos(21.0 * r); const scale = 1 + 0.35 * psi; return [x * scale, y * scale]; },
  },
  {
    idx: V.mexican_hat,
    name: 'mexican_hat',
    source: 'novel',
    formula: "\\mathbf{p} \\mapsto \\mathbf{p}\\,\\Bigl(1 + A\\,\\bigl(1 - \\tfrac{r^2}{\\sigma^2}\\bigr)e^{-r^2/2\\sigma^2}\\Bigr)",
    blurb: 'Mexican-hat (Ricker) wavelet as a radial modulation: the second-derivative-of-Gaussian profile lifts a central bump ringed by a single negative trough, so points near the origin push outward while a mid-radius shell pulls inward — a smooth lens-and-moat warp. No trig at all, the family’s safe anchor.',
    params: [
      { name: 'sigma', default: 1.32, min: 0.05, max: 3, step: 0.01 },
      { name: 'amp', default: 0.4, min: -1, max: 1, step: 0.01 },
    ],
    defaultWeight: 0.85,
    warpFn: (x, y) => { const r = Math.hypot(x, y); const s = Math.max(1.32, 0.05); const t = r / s; const t2 = Math.min(t * t, 80); const psi = (1 - t2) * Math.exp(-0.5 * t2); const scale = 1 + 0.4 * psi; return [x * scale, y * scale]; },
  },
  {
    idx: V.chirp,
    name: 'chirp',
    source: 'novel',
    formula: "\\mathbf{p} \\mapsto \\mathbf{p}\\,\\bigl(1 + A\\,e^{-\\beta r^2}\\sin(\\alpha r^2)\\bigr)",
    blurb: 'Linear-chirp frequency sweep as a radial modulation: sin(α·r²) accelerates its oscillation with radius, so the warp rings start wide near the origin and crowd tighter outward — a zone-plate / interference-fringe look. The α·r² argument is routed through safe_sin (the family’s trig-cliff case).',
    params: [
      { name: 'alpha', default: 8, min: 0, max: 60, step: 0.1 },
      { name: 'amp', default: 0.3, min: -1, max: 1, step: 0.01 },
      { name: 'decay', default: 0.6, min: 0, max: 4, step: 0.01 },
    ],
    warpFn: (x, y) => { const r2 = x * x + y * y; const env = Math.exp(-0.6 * Math.min(r2, 160)); const psi = env * Math.sin(8.0 * r2); const scale = 1 + 0.3 * psi; return [x * scale, y * scale]; },
  },
  // #153 — Celestial-mechanics warps
  {
    idx: V.kepler_orbit,
    name: 'kepler_orbit',
    source: 'novel',
    formula: "M = E - e\\sin E,\\quad V(p)=a\\,(\\cos E - e,\\; \\sqrt{1-e^2}\\,\\sin E),\\ a=s|p|,\\ M=\\operatorname{atan2}(p_y,p_x)",
    blurb: 'Solves Kepler’s equation M = E − e·sin E for the eccentric anomaly via two stateless Newton iterations, then places the walker on the corresponding ellipse. Eccentricity morphs the flow from concentric circles (e=0) toward sharply-focused cometary ellipses; the nonlinear M→E map crowds points near perihelion.',
    params: [
      { name: 'eccentricity', default: 0.35, min: 0, max: 0.95, step: 0.01 },
      { name: 'scale', default: 1.3, min: 0.1, max: 2, step: 0.05 },
    ],
    defaultWeight: 0.48,
    warpFn: (x, y) => { const e = Math.min(Math.max(0.35, 0), 0.95); const scale = 1.3; const M = Math.atan2(y, x); const a = scale * (Math.hypot(x, y) + 1e-6); let E = M; for (let k = 0; k < 2; k++) { E = E - (E - e * Math.sin(E) - M) / Math.max(1 - e * Math.cos(E), 0.05); } const b = Math.sqrt(Math.max(1 - e * e, 0)); return [a * (Math.cos(E) - e), a * b * Math.sin(E)]; },
  },
  {
    idx: V.restricted_3body,
    name: 'restricted_3body',
    source: 'novel',
    formula: "\\Omega = \\tfrac12(x^2{+}y^2) + \\tfrac{1-\\mu}{r_1} + \\tfrac{\\mu}{r_2},\\quad V(p)=p + s(\\nabla\\Omega + c\\,R_{90}\\nabla\\Omega)",
    blurb: 'The planar circular restricted three-body problem in the rotating frame: two primaries of mass (1−μ) and μ sit on the x-axis, and the walker is displaced along the gradient of the effective potential plus a Coriolis deflection — sculpting the five Lagrange points and their separatrix flow. Both 1/r singularities are eps-softened, the step hard-clamped.',
    params: [
      { name: 'mu', default: 0.2, min: 0.01, max: 0.5, step: 0.01 },
      { name: 'step', default: 0.15, min: 0.01, max: 0.6, step: 0.01 },
      { name: 'coriolis', default: 0.4, min: -1.5, max: 1.5, step: 0.05 },
    ],
    warpFn: (x, y) => { const mu = Math.min(Math.max(0.2, 0.01), 0.5); const step = 0.15, coriolis = 0.4; const p1x = -mu, p2x = 1 - mu; const r1x = x - p1x, r1y = y, r2x = x - p2x, r2y = y; const d1 = Math.pow(r1x * r1x + r1y * r1y + 1e-3, 1.5); const d2 = Math.pow(r2x * r2x + r2y * r2y + 1e-3, 1.5); const gx = x - (1 - mu) * (r1x / d1) - mu * (r2x / d2); const gy = y - (1 - mu) * (r1y / d1) - mu * (r2y / d2); const gcx = -gy, gcy = gx; let dx = step * (gx + coriolis * gcx), dy = step * (gy + coriolis * gcy); const dl = Math.hypot(dx, dy), cap = 2.0; if (dl > cap) { dx *= cap / dl; dy *= cap / dl; } return [x + dx, y + dy]; },
  },
  {
    idx: V.hill_epicyclic,
    name: 'hill_epicyclic',
    source: 'novel',
    formula: "\\phi = \\kappa\\,\\phi_0,\\quad V(p)=\\begin{pmatrix}\\cos\\phi & -\\tfrac{\\sin\\phi}{\\kappa}\\\\ 2\\kappa\\sin\\phi & \\cos\\phi\\end{pmatrix}p + (0,\\ \\sigma p_x)",
    blurb: 'Hill’s linearized near-circular orbital dynamics: a small radial+tangential perturbation drifts as an epicycle — a retrograde ellipse riding a guiding-center shear. kappa sets the epicyclic frequency (radial/tangential axis ratio) and phase advances the drift, producing sheared, slowly-precessing elliptical banding. A pure linear map.',
    params: [
      { name: 'kappa', default: 1.15, min: 0.2, max: 2, step: 0.05 },
      { name: 'phase', default: -0.73, min: -6.2832, max: 6.2832, step: 0.05 },
      { name: 'shear', default: 0.5, min: -2, max: 2, step: 0.05 },
    ],
    warpFn: (x, y) => { const k = Math.min(Math.max(1.15, 0.2), 2.0); const phase = -0.73, shear = 0.5; const phi = phase * k; const cf = Math.cos(phi), sf = Math.sin(phi); const xo = x * cf - (sf / k) * y; const yo = (2 * k) * sf * x + y * cf; return [xo, yo + shear * x]; },
  },
  // #155 — Knots & braids
  {
    idx: V.torus_knot,
    name: 'torus_knot',
    source: 'novel',
    formula: "\\varphi = \\operatorname{atan2}(y,x),\\ r = R + t|p|\\cos(q\\varphi),\\ V = (r\\cos p\\varphi,\\; r\\sin p\\varphi)",
    blurb: 'Torus-knot rosette warp. The walker’s polar angle drives a (p,q) torus-knot parametrization, mapping the plane onto clean p-fold winding rosettes whose petal count is set by the q tube-winding. The input radius blends petals from center to rim so the warp shows the whole knot family. Bounded by radius+tube.',
    params: [
      { name: 'p', default: 3, min: 1, max: 12, step: 1 },
      { name: 'q', default: 2, min: 1, max: 12, step: 1 },
      { name: 'radius', default: 0.6, min: 0.1, max: 1.5, step: 0.05 },
      { name: 'tube', default: 0.3, min: 0, max: 1, step: 0.05 },
    ],
    warpFn: (x, y) => { const p = 3, q = 2, radius = 0.6, tube = 0.3; const phi = Math.atan2(y, x); const rin = Math.hypot(x, y); const amp = tube * Math.max(0, Math.min(1, rin)); const rr = radius + amp * Math.cos(q * phi); return [rr * Math.cos(p * phi), rr * Math.sin(p * phi)]; },
  },
  {
    idx: V.braid_warp,
    name: 'braid_warp',
    source: 'novel',
    formula: "\\theta'=\\theta+\\tau(-1)^{\\ell}\\sin(\\pi f)\\sin(c\\pi f)\\min(r,1),\\ V=r(\\cos\\theta',\\sin\\theta')",
    blurb: 'Braid-group strand warp. The circle is split into N angular strands; each strand’s angle is twisted by a smooth sinusoidal crossing (a continuous analog of a braid σ-generator) so adjacent strands weave over and under as the radius grows. Radius is preserved — only the angle is permuted — giving bounded, self-knotting rope-like braids without any persistent state.',
    params: [
      { name: 'strands', default: 4, min: 2, max: 10, step: 1 },
      { name: 'twist', default: -1.15, min: -2, max: 2, step: 0.05 },
      { name: 'crossings', default: 5, min: 1, max: 8, step: 1 },
    ],
    warpFn: (x, y) => { const strands = 4, twist = -1.15, crossings = 5; const n = Math.max(2, Math.round(strands)); const cr = Math.max(1, Math.round(crossings)); const r = Math.hypot(x, y); const theta = Math.atan2(y, x); const a = (theta + Math.PI) / (2 * Math.PI); const lane = Math.floor(a * n); const laneFrac = a * n - lane; const sgn = (lane & 1) === 1 ? -1 : 1; const weave = Math.sin(Math.PI * laneFrac); const rad = Math.max(0, Math.min(1, r)); const dtheta = twist * sgn * weave * Math.sin(cr * Math.PI * laneFrac) * rad; const nt = theta + dtheta; return [r * Math.cos(nt), r * Math.sin(nt)]; },
  },
  // ── Marathon follow-ons (#216/#218/#220/#221) ──
  // #216 — optics follow-on (reuses #137 Airy Ai helper)
  {
    idx: V.airy_caustic,
    name: 'airy_caustic',
    source: 'novel',
    formula: "(x',y') = \\big(1 + a\\,\\mathrm{Ai}(s\\,(r - r_0))\\big)(x,y)",
    blurb: 'The supernumerary-ring profile of a rainbow/Airy caustic: the radius is modulated by 1 + amp·Ai(scale·(r − r0)). Unlike airy_radial (which scales the radius BY Ai and can fold through zero), the +1 envelope keeps the disk intact and overlays the faint diffraction fringes just inside the bright caustic edge at r0 — fringes that self-brighten as the chaos game accumulates density. Bounded: |Ai| decays away from the turning point and the envelope is clamped positive.',
    params: [
      { name: 'scale', default: 4.5, min: 0.5, max: 8, step: 0.1 },
      { name: 'r0', default: 1.1, min: 0, max: 4, step: 0.05 },
      { name: 'amp', default: 2.2, min: 0, max: 4, step: 0.05 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y) => { const scale = 4.5, r0 = 1.1, amp = 2.2; const r = Math.hypot(x, y); const xx = scale * (r - r0); let a; if (xx > 4.0) { const xi = (2/3)*Math.pow(xx,1.5); a = Math.exp(-xi)/(2*1.7724539*Math.pow(xx,0.25)); } else if (xx < -5.0) { const axx = -xx; const xi = (2/3)*Math.pow(axx,1.5); a = Math.sin(xi+0.78539816)/(1.7724539*Math.pow(axx,0.25)); } else { const c1=0.355028053887817,c2=0.258819403792807; const x3=xx*xx*xx; let f=1,tf=1,g=xx,tg=xx; for(let k=1;k<12;k++){tf*=x3/((3*k-1)*(3*k));f+=tf;tg*=x3/((3*k)*(3*k+1));g+=tg;} a=c1*f-c2*g; } const env = Math.max(0.05, Math.min(3.0, 1 + amp * a)); return [env * x, env * y]; },
  },
  // #220 — special-function follow-on (complete elliptic integrals)
  {
    idx: V.elliptic_E,
    name: 'elliptic_E',
    source: 'novel',
    formula: "r' = s\\,E(m),\\quad m = \\tfrac{r^2}{1+r^2},\\quad E(m)=\\int_0^{\\pi/2}\\!\\sqrt{1-m\\sin^2\\theta}\\,d\\theta",
    blurb: 'Radial projector by the complete elliptic integral of the second kind E(m), with the modulus m = r²/(1+r²) ∈ (0,1) driven by the radius. E(m) is inherently bounded on [1, π/2], so this is the gentle, singularity-free member: a soft monotone ring that compresses the plane toward the rim. Evaluated via the Abramowitz & Stegun 17.3.36 polynomial approximation (no AGM loop).',
    params: [
      { name: 'scale', default: 0.8, min: 0.1, max: 3, step: 0.05 },
    ],
    defaultWeight: 0.6,
    warpFn: (x, y) => { const scale = 0.8; const r2 = x*x+y*y; const r = Math.sqrt(r2); if (r < 1e-9) return [0, 0]; const m = r2/(1+r2); const m1 = Math.max(0, Math.min(1, 1-m)); const l = Math.log(1/Math.max(m1,1e-6)); const a = 1 + m1*(0.4630151 + m1*0.1077812); const b = m1*(0.2452727 + m1*0.0412496); const e = a + b*l; const rp = scale*e; return [rp*x/r, rp*y/r]; },
  },
  {
    idx: V.elliptic_K,
    name: 'elliptic_K',
    source: 'novel',
    formula: "r' = \\min\\!\\big(s\\,K(m),\\,c\\big),\\quad K(m)=\\int_0^{\\pi/2}\\!\\frac{d\\theta}{\\sqrt{1-m\\sin^2\\theta}}",
    blurb: 'Radial projector by the complete elliptic integral of the FIRST kind K(m), m = r²/(1+r²). K(m) diverges logarithmically as m → 1 (the rim) — that singularity is the visual payoff: a bright outer ring where K blows up. The modulus floor (m1 ≥ 1e-3 in the A&S 17.3.34 approximation) plus a hard r′ cap (tail_clamp) keep it bounded. Distinct outer-ring brightening from elliptic_E’s gentle compression.',
    params: [
      { name: 'scale', default: 0.5, min: 0.1, max: 2, step: 0.05 },
      { name: 'tail_clamp', default: 3.0, min: 0.5, max: 8, step: 0.1 },
    ],
    defaultWeight: 0.55,
    warpFn: (x, y) => { const scale = 0.5, cap = 3.0; const r2 = x*x+y*y; const r = Math.sqrt(r2); if (r < 1e-9) return [0, 0]; const m = r2/(1+r2); const m1 = Math.max(1e-3, Math.min(1, 1-m)); const l = Math.log(1/m1); const a = 1.3862944 + m1*(0.1119723 + m1*0.0725296); const b = 0.5 + m1*(0.1213478 + m1*0.0288729); const k = a + b*l; const rp = Math.min(scale*k, cap); return [rp*x/r, rp*y/r]; },
  },
  // #218 — statistical-distribution follow-on (inverse-CDF via erfinv)
  {
    idx: V.gaussian_cdf,
    name: 'gaussian_cdf',
    source: 'novel',
    formula: "r' = \\mu + \\sigma\\sqrt{2}\\,\\mathrm{erf}^{-1}(2u-1),\\quad u=\\tfrac{r^2}{1+r^2}",
    blurb: 'Normal-quantile radial remap: the bounded sigmoid u = r²/(1+r²) is pushed through the inverse Gaussian CDF (the probit). The unit circle (u = ½ → erf⁻¹(0) = 0) maps to radius μ, with a bell-shaped pile-up around it. The erf⁻¹ is the Winitzki rational approximation; the u-endpoint clamp keeps its argument off ±1 so the warp stays bounded. The bell-shaped sibling of the heavy-tailed Cauchy/Pareto/Lévy CDFs.',
    params: [
      { name: 'mu', default: 0.9, min: 0, max: 3, step: 0.05 },
      { name: 'sigma', default: 0.5, min: 0.05, max: 2, step: 0.05 },
    ],
    defaultWeight: 0.6,
    warpFn: (x, y) => { const mu = 0.9, sigma = 0.5; const erfinv = (xi: number) => { const xc = Math.max(-0.999999, Math.min(0.999999, xi)); const a = 0.147; const ln1 = Math.log(1-xc*xc); const t1 = 2/(Math.PI*a) + 0.5*ln1; const inner = Math.sqrt(Math.max(t1*t1 - ln1/a, 0)) - t1; return Math.sign(xc)*Math.sqrt(Math.max(inner, 0)); }; const r2 = x*x+y*y; const r = Math.sqrt(r2); if (r < 1e-9) return [0, 0]; const u = Math.max(1e-4, Math.min(1-1e-4, r2/(1+r2))); const q = erfinv(2*u-1); const rp = Math.max(mu + sigma*1.4142135*q, 0); return [rp*x/r, rp*y/r]; },
  },
  {
    idx: V.levy_cdf,
    name: 'levy_cdf',
    source: 'novel',
    formula: "r' = \\dfrac{c}{2\\,\\big[\\mathrm{erf}^{-1}(1-u)\\big]^2},\\quad u=\\tfrac{r^2}{1+r^2}",
    blurb: 'The Lévy (α = ½ stable) quantile — the heaviest-tailed inverse-CDF in the family. As u → 1 at the rim, erf⁻¹(1 − u) → 0 and the radius blows up, so a two-layer defence (the u-endpoint guard plus a hard tail_clamp cap) is mandatory. Produces a sharp dense inner core with a clamped outer halo: a markedly different mass distribution from the bell-shaped gaussian_cdf. Shares the erf⁻¹ helper with gaussian_cdf.',
    params: [
      { name: 'c', default: 0.35, min: 0.05, max: 2, step: 0.05 },
      { name: 'tail_clamp', default: 3.0, min: 0.5, max: 8, step: 0.1 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y) => { const c = 0.35, cap = 3.0; const erfinv = (xi: number) => { const xc = Math.max(-0.999999, Math.min(0.999999, xi)); const a = 0.147; const ln1 = Math.log(1-xc*xc); const t1 = 2/(Math.PI*a) + 0.5*ln1; const inner = Math.sqrt(Math.max(t1*t1 - ln1/a, 0)) - t1; return Math.sign(xc)*Math.sqrt(Math.max(inner, 0)); }; const r2 = x*x+y*y; const r = Math.sqrt(r2); if (r < 1e-9) return [0, 0]; const u = Math.max(1e-4, Math.min(1-1e-4, r2/(1+r2))); const e = erfinv(1-u); const denom = Math.max(2*e*e, 1e-6); const raw = Math.max(c, 1e-4)/denom; const rp = Math.min(raw, cap); return [rp*x/r, rp*y/r]; },
  },
  // #221 — digit-scramble follow-on (base-3 Peano)
  {
    idx: V.peano,
    name: 'peano',
    source: 'novel',
    formula: "d_k \\to 2 - d_k\\ (\\text{when flipped}),\\quad \\text{flip} \\mathbin{\\oplus}{=} (d_k \\bmod 2)",
    blurb: 'Per-axis base-3 Peano reflected-ternary scramble: each coordinate is encoded to a trits-digit base-3 index, then the digits are walked MSB→LSB through the Peano orientation-flip recursion (a running flip state maps digit d → 2 − d and toggles whenever the emitted digit is odd) and decoded back. The ternary cousin of the base-2 digit-scramble family (radical_inverse / gray_code / morton_zorder) — a self-similar three-fold fold with a distinctly different cell texture. Pure integer ops, perfectly bounded.',
    params: [
      { name: 'extent', default: 1, min: 0.25, max: 4, step: 0.05 },
      { name: 'trits', default: 5, min: 2, max: 15, step: 1 },
    ],
    warpFn: (x, y) => { const extent = 1.0, trits = 5; const pow3 = (n: number) => { let p = 1; for (let i = 0; i < n; i++) p *= 3; return p; }; const cells = pow3(trits); const s = Math.max(extent, 1e-4); const enc = (c: number) => { const norm = (c+s)/(2*s); const folded = norm - Math.floor(norm); return Math.min((folded*cells) >>> 0, cells-1) >>> 0; }; const dec = (i: number) => ((i+0.5)/cells)*2*s - s; const scr = (idx: number) => { let flip = false, out = 0; for (let k = trits-1; k >= 0; k--) { const place = pow3(k); const d = Math.floor(idx/place) % 3; const e = flip ? 2-d : d; out += e*place; if ((e & 1) === 1) flip = !flip; } return out; }; return [dec(scr(enc(x))), dec(scr(enc(y)))]; },
  },
  // #145 — Escape-time fractal single-steps. Each is one step of a classic
  // escape-time iteration AND a Direct Color variation: color is always
  // computed directly by escape_color (smooth escape/convergence depth),
  // bypassing the palette. Catalog source = 'novel' (P90..P93, pyr3 originals);
  // the Direct-Color capability is carried by DC_VARIATION_SET, not the source (#222).
  {
    idx: V.burning_ship,
    name: 'burning_ship',
    source: sourceForIdx(V.burning_ship),
    formula: "z' = (|\\mathrm{Re}\\,z| + i\\,|\\mathrm{Im}\\,z|)^2 + c",
    blurb: 'A single step of the Burning Ship iteration: the coordinate is folded into the first quadrant by absolute value, squared, and offset by c. The absolute-value fold gives the family its signature angular, flame-like ridges — distinct from the smooth lobes of plain z²+c. A Direct Color variation: the color is computed directly (bypassing the palette) as a true Mandelbrot-style escape band — escape_color re-iterates the same map and colors by iters-to-bailout. No pole; growth is caught by the chaos-game bad-value reseed.',
    params: [
      { name: 'cx', default: 0.4, min: -2, max: 2, step: 0.05 },
      { name: 'cy', default: -0.3, min: -2, max: 2, step: 0.05 },
    ],
    defaultWeight: 0.17,
    warpFn: (x, y) => { const cx = 0.4, cy = -0.3; const ax = Math.abs(x), ay = Math.abs(y); return [ax*ax - ay*ay + cx, 2*ax*ay + cy]; },
  },
  {
    idx: V.magnet1,
    name: 'magnet1',
    source: sourceForIdx(V.magnet1),
    formula: "z' = \\left(\\dfrac{z^2 + c - 1}{2z + c - 2}\\right)^2",
    blurb: 'A single step of the Magnet I iteration (from the physics of phase transitions in the Ising model). The rational map has a pole at 2z + c − 2 = 0, guarded with the var_newton |den|²-floor precedent (the point stays put at the singularity). Convergence to the magnetic / non-magnetic fixed points carves smooth basins. A Direct Color variation: color is computed directly by escape_color from convergence depth, bypassing the palette.',
    params: [
      { name: 'cx', default: 0.85, min: -2, max: 2, step: 0.05 },
      { name: 'cy', default: -1.3, min: -2, max: 2, step: 0.05 },
    ],
    defaultWeight: 0.31,
    warpFn: (x, y) => { const cx = 0.85, cy = -1.3; const csqr = (z: [number,number]): [number,number] => [z[0]*z[0]-z[1]*z[1], 2*z[0]*z[1]]; const z2 = csqr([x, y]); const num: [number,number] = [z2[0]+cx-1, z2[1]+cy]; const den: [number,number] = [2*x+cx-2, 2*y+cy]; const d2 = den[0]*den[0]+den[1]*den[1]; if (d2 < 1e-20) return [x, y]; const ratio: [number,number] = [(num[0]*den[0]+num[1]*den[1])/d2, (num[1]*den[0]-num[0]*den[1])/d2]; return csqr(ratio); },
  },
  {
    idx: V.nova,
    name: 'nova',
    source: sourceForIdx(V.nova),
    formula: "z' = z - R\\,\\dfrac{z^3-1}{3z^2} + c",
    blurb: 'A single relaxed-Newton step on f(z) = z³ − 1 with a relaxation factor R and a Mandelbrot-style offset c — the Nova fractal. R = 1 recovers ordinary Newton; off-1 values over/under-relax the convergence and shift the basin geometry. The three cube roots of unity are fixed points (step = 0 there). Pole at z = 0 (f′ → 0), guarded. A Direct Color variation: color is computed directly by escape_color from convergence depth, bypassing the palette.',
    params: [
      { name: 'cx', default: 0, min: -2, max: 2, step: 0.05 },
      { name: 'cy', default: 0.5, min: -2, max: 2, step: 0.05 },
      { name: 'relax', default: 0.85, min: 0.1, max: 2, step: 0.05 },
    ],
    defaultWeight: 0.09,
    warpFn: (x, y) => { const cx = 0, cy = 0.5, relax = 0.85; const cmul = (a: [number,number], b: [number,number]): [number,number] => [a[0]*b[0]-a[1]*b[1], a[0]*b[1]+a[1]*b[0]]; const z: [number,number] = [x, y]; const z2 = cmul(z, z); const z3 = cmul(z2, z); const num: [number,number] = [z3[0]-1, z3[1]]; const den: [number,number] = [3*z2[0], 3*z2[1]]; const d2 = den[0]*den[0]+den[1]*den[1]; if (d2 < 1e-20) return [x, y]; const div: [number,number] = [(num[0]*den[0]+num[1]*den[1])/d2, (num[1]*den[0]-num[0]*den[1])/d2]; return [x - relax*div[0] + cx, y - relax*div[1] + cy]; },
  },
  {
    idx: V.halley,
    name: 'halley',
    source: sourceForIdx(V.halley),
    formula: "z' = z - \\dfrac{2ff'}{2f'^2 - ff''} + c,\\quad f = z^3 - 1",
    blurb: "A single Halley step on f(z) = z³ − 1 — Newton's cubic-convergence cousin, using f, f′ and f″ together for a tighter approach to the roots. Like Nova it fixes the three cube roots of unity, but the basin boundaries are noticeably crisper. Pole where 2f′² − ff″ = 0, guarded with the var_newton precedent. A Direct Color variation: color is computed directly by escape_color from convergence depth, bypassing the palette.",
    params: [
      { name: 'cx', default: -0.25, min: -2, max: 2, step: 0.05 },
      { name: 'cy', default: -0.2, min: -2, max: 2, step: 0.05 },
    ],
    defaultWeight: 0.12,
    warpFn: (x, y) => { const cx = -0.25, cy = -0.2; const cmul = (a: [number,number], b: [number,number]): [number,number] => [a[0]*b[0]-a[1]*b[1], a[0]*b[1]+a[1]*b[0]]; const z: [number,number] = [x, y]; const z2 = cmul(z, z); const z3 = cmul(z2, z); const f: [number,number] = [z3[0]-1, z3[1]]; const fp: [number,number] = [3*z2[0], 3*z2[1]]; const fpp: [number,number] = [6*x, 6*y]; const ffp = cmul(f, fp); const num: [number,number] = [2*ffp[0], 2*ffp[1]]; const fp2 = cmul(fp, fp); const ffpp = cmul(f, fpp); const den: [number,number] = [2*fp2[0]-ffpp[0], 2*fp2[1]-ffpp[1]]; const d2 = den[0]*den[0]+den[1]*den[1]; if (d2 < 1e-20) return [x, y]; const div: [number,number] = [(num[0]*den[0]+num[1]*den[1])/d2, (num[1]*den[0]-num[0]*den[1])/d2]; return [x - div[0] + cx, y - div[1] + cy]; },
  },
];

const byIdx = new Map(CATALOG_DATA.map(d => [d.idx, d]));
export function getCatalogDoc(idx: number): VariationDoc | undefined {
  return byIdx.get(idx);
}
