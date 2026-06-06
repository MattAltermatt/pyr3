// #119 — Variation Catalog content.
//
// One VariationDoc per variation index. The catalog page consumes this
// in numeric order to render the full V0..V106 set. Stubs are allowed
// during development — the page falls back to a placeholder. By ship,
// every variation must have a complete entry (asserted in tests).

import { V } from './variations';

export type CatalogSource = 'flam3' | 'dc' | 'jwf';

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
   *  fed straight into Variation.param0..param7 at scaffold-build time. */
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

/** Source category from variation index. Index ranges defined by the V
 *  table in src/variations.ts: flam3 V0..V98, DC family V99..V102,
 *  JWildfire ports V103..V106. */
export function sourceForIdx(idx: number): CatalogSource {
  if (idx <= V.mobius) return 'flam3';
  if (idx <= V.dc_cylinder) return 'dc';
  return 'jwf';
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
    formula: 'V_9(x, y) = \\tfrac{1}{r}\\,(\\cos\\alpha + \\sin r,\\; \\sin\\alpha - \\cos r)',
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
      const a = 1.4, b = 1.6, c = 1.0, d = 0.7;
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
      const val = 0.5;
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
    formula: 'V_{35}(x, y) = \\tfrac{2}{\\pi}\\,\\big(\\tfrac{1}{4}\\ln\\tfrac{t+2x}{t-2x},\\; \\tfrac{1}{2}\\mathrm{atan2}(2y, x^2+y^2-1) + \\mathrm{shift}\\big),\\; t = x^2+y^2+1',
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
    formula: 'V_{36}(x, y) = \\tfrac{1}{R^2+I^2}\\,(xR + yI,\\; yR - xI),\\; R=1+c_1 x+c_2(x^2-y^2)',
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
    formula: 'V_{40}(x, y) = (r + \\text{hole})\\,(\\cos a,\\; \\sin a),\\; a = \\phi\\,(1 - \\tfrac{\\text{angle}\\cdot\\text{count}}{2\\pi}) + c\\cdot\\text{angle}',
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
    formula: 'V_{41}(x, y) = e^{c\\ln r - d\\,\\phi}\\,(\\cos\\theta,\\; \\sin\\theta),\\; \\theta = ca + d\\ln r + \\tfrac{2\\pi n}{\\text{power}}',
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
    formula: 'V_{45}(x, y) = r\\,(\\cos\\theta,\\; \\sin\\theta),\\; r = r_1+r_2+r_3+r_4-2',
    blurb: 'Gaussian-distributed scatter around origin via central limit theorem (sum of four uniform [0,1) minus 2). Produces a soft, bell-shaped cloud.',
  },
  {
    idx: V.arch,
    name: 'arch',
    source: sourceForIdx(V.arch),
    formula: 'V_{46}(x, y) = (\\sin\\alpha,\\; \\sin^2\\alpha / \\cos\\alpha),\\; \\alpha = \\pi r_0',
    blurb: 'Draws random arches via sin and tan-shaped scaling. The output traces tan-singular arch curves — bright at sin·tan singularities.',
  },
  {
    idx: V.radial_blur,
    name: 'radial_blur',
    source: sourceForIdx(V.radial_blur),
    formula: 'V_{47}(x, y) \\approx r\\,(\\cos(\\phi + s\\cdot G),\\; \\sin(\\phi + s\\cdot G)) + (z\\cdot G - 1)\\,(x,y),\\; G = \\sqrt{\\text{rand}}\\cdot|\\text{angle}|',
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
    formula: 'V_{50}(x, y) = \\tan(\\pi w r_0) \\cdot \\tfrac{w}{r^2+\\epsilon}\\,(\\cos x,\\; \\sin y)',
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
    blurb: 'Complex cotangent — reciprocal of complex tangent. Singular where sin(2x) = sinh(2y) = 0 (lattice of integer-π points).',
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
    formula: 'V_{69}(x, y) = \\tfrac{2}{\\pi}\\,(\\mathrm{atan2}(x/x_\\text{max}, b),\\; \\pm\\ln(x_\\text{max} + \\sqrt{x_\\text{max}-1}))',
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
    formula: 'V_{76}(x, y) = e^{v_c \\ln r - v_d \\phi}\\,(\\cos\\theta,\\; \\sin\\theta),\\; v_c = (1+\\cos\\beta)/2,\\; v_d = \\sin\\beta/2',
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
    formula: 'V_{77}(x, y) = (\\,x \\bmod 2 x_p \\text{ within } [-x_p, x_p],\\; y \\bmod 2 y_p \\text{ within } [-y_p, y_p]\\,)',
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
    formula: 'V_{81}(x, y) = r\\,(\\cos a,\\; \\sin a),\\; a = \\phi + \\tfrac{\\text{inside or outside}}{1-r}',
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
    formula: 'V_{84}(x, y) = \\begin{cases} r(\\cos a + l_x,\\; \\sin a - l_y) & r<w \\\\ (1+\\text{space}/r)(x, y) + (l_x, -l_y) & \\text{else}\\end{cases}',
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
      const angle = 0.6, hole = 0, count = 4, swirl = 0;
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
    formula: 'V_{95}(x, y) \\approx \\text{piecewise rounded cell-edges}',
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
    formula: 'V_{99}(x, y) = (x, y);\\quad \\text{RGB} = \\mathrm{clamp}(\\tfrac{1}{2} + \\tfrac{1}{2}(x, y, -\\tfrac{1}{2}(x+y)))',
    blurb: 'Direct-color identity — passes position through, overrides RGB linearly from (x, y). Red rises with x, green with y, blue from −(x+y)/2; clamped to [0, 1].',
    hideWeight: true,
    warpFn: (x, y) => [x, y],
  },
  {
    idx: V.dc_perlin,
    name: 'dc_perlin',
    source: sourceForIdx(V.dc_perlin),
    formula: 'V_{100}(x, y) = (x, y);\\quad \\text{hue} = \\tfrac{1}{2}(1 + \\text{fBm}(p, \\text{octaves}, \\text{scale})) + \\text{seed}',
    blurb: 'Direct-color from a 2D Perlin fBm noise field. Position passes through unchanged; hue from noise, saturation 1, lightness 0.55. seed rotates the hue cycle.',
    hideWeight: true,
    params: [
      { name: 'scale',      default: 0, min: 0.1, max: 8, step: 0.1 },
      { name: 'octaves',    default: 0, min: 1,   max: 8, step: 1 },
      { name: 'color_seed', default: 0, min: 0,   max: 1, step: 0.02 },
    ],
    warpFn: (x, y) => [x, y],
  },
  {
    idx: V.dc_gridout,
    name: 'dc_gridout',
    source: sourceForIdx(V.dc_gridout),
    formula: 'V_{101}(x, y) = (x, y);\\quad \\text{RGB} = \\mathrm{hash}(\\lfloor x\\cdot n\\rfloor,\\; \\lfloor y\\cdot n\\rfloor)',
    blurb: 'Direct-color from a hashed grid of cells. Each integer cell gets a random RGB triple; produces a pixelated, tile-mosaic coloring.',
    hideWeight: true,
    params: [
      { name: 'cells', default: 0, min: 1, max: 32, step: 1 },
    ],
    warpFn: (x, y) => [x, y],
  },
  {
    idx: V.dc_cylinder,
    name: 'dc_cylinder',
    source: sourceForIdx(V.dc_cylinder),
    formula: 'V_{102}(x, y) = (\\sin x,\\; y);\\quad \\text{hue spirals along } x,\\; \\text{lightness modulates with } y',
    blurb: 'Direct-color cylinder — V21 position warp plus position-derived HSL. Hue cycles along x via sin; lightness modulates by tanh(y/2).',
    warpFn: (x, y) => [Math.sin(x), y],
  },
  // ---------------------------------------------------------------------
  // JWildfire plugin pack — V103..V106. #114 batch 1.
  // ---------------------------------------------------------------------
  {
    idx: V.cpow2,
    name: 'cpow2',
    source: sourceForIdx(V.cpow2),
    formula: 'V_{103}(x, y) = e^{c/2 \\cdot \\ln r^2 - d \\cdot a}\\,(\\cos\\theta,\\; \\sin\\theta),\\; \\text{range-driven RNG branching}',
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
    formula: 'V_{104}(x, y) = e^{c/2 \\cdot \\ln r^2 - d \\cdot a}\\,(\\cos\\theta,\\; \\sin\\theta),\\; \\text{log-distributed branch picker}',
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
    formula: 'V_{105}(x, y) = \\sqrt{w^2/r_n^2 - 1}\\,(x, y),\\; r_n = n\\text{-sided loonie radius blended with circle}',
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
      const sins = Math.sin(star * Math.PI * 0.5);
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
    formula: 'V_{106}(x, y) = t\\,(\\cos\\theta,\\; \\sin\\theta),\\; t = -\\text{holes} + 1/\\cos(n\\theta)\\;[\\cdot r_0\\text{thickness}]',
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
    formula: 'V_{107}: \\text{inside a hash-spaced bubble of radius } r,\\; p \\to c + R(\\theta(|p-c|))\\cdot \\tfrac{g^2}{|p-c|^2+1}(p-c);\\; \\text{else identity}',
    blurb: 'Bubble-wrap lattice (Apophysis 7X / JWildfire). Cellular grid where each cell carries a circular "bubble" — inside, the point gets hyperbolically pulled toward the bubble center with an inner/outer twist; outside, it passes through. Produces the soap-bubble / lens-array texture.',
    params: [
      { name: 'cellsize',     default: 1, min: 0.1, max: 4, step: 0.05 },
      { name: 'space',        default: 0, min: 0,   max: 2, step: 0.05 },
      { name: 'gain',         default: 1, min: 0,   max: 4, step: 0.05 },
      { name: 'inner_twist',  default: 0, min: -Math.PI, max: Math.PI, step: 0.05 },
      { name: 'outer_twist',  default: 0, min: -Math.PI, max: Math.PI, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const cellsize = 1, space = 0, gain = 1, inner_twist = 0, outer_twist = 0;
      const radius = 0.5 * (cellsize / (1 + space * space));
      const g2 = (gain * gain) / Math.max(radius * radius, 1e-30) + 1e-30;
      const r2 = radius * radius;
      const xx = x / cellsize;
      const yy = y / cellsize;
      const cx = (Math.floor(xx) + 0.5) * cellsize;
      const cy = (Math.floor(yy) + 0.5) * cellsize;
      const lx = x - cx;
      const ly = y - cy;
      if (lx * lx + ly * ly > r2) return [x, y];
      const denom = lx * lx + ly * ly + 1;
      const s = g2 / denom;
      const sx = lx * s, sy = ly * s;
      const r_frac = (sx * sx + sy * sy) / Math.max(r2, 1e-30);
      const theta = inner_twist * (1 - r_frac) + outer_twist * r_frac;
      const st = Math.sin(theta), ct = Math.cos(theta);
      return [cx + (sx * ct + sy * st), cy + (-sx * st + sy * ct)];
    },
  },
  {
    idx: V.crackle,
    name: 'crackle',
    source: sourceForIdx(V.crackle),
    formula: 'V_{108}: p \\to s\\cdot(\\mathbf{f} + (p - \\mathbf{f})\\cdot d\\cdot F_1^{\\,\\text{power}});\\; \\mathbf{f} = \\text{nearest Worley feature of } p/c',
    blurb: 'Voronoi-cell scatter (Neil Slater / "slobo777"). Snaps each iterate to the nearest Worley feature point with a distance-power-weighted blend back toward the input — produces the crystalline / cracked-tile texture that JWildfire flames are known for.',
    params: [
      { name: 'cellsize', default: 1,   min: 0.1, max: 4, step: 0.05 },
      { name: 'power',    default: 0.2, min: -2,  max: 2, step: 0.05 },
      { name: 'distort',  default: 1,   min: 0,   max: 4, step: 0.05 },
      { name: 'scale',    default: 1,   min: 0,   max: 4, step: 0.05 },
    ],
    warpFn: (x, y) => {
      const cellsize = 1, power = 0.2, distort = 1, scale = 1;
      const cs = Math.max(Math.abs(cellsize), 1e-6);
      // Mirror the WGSL XOR hash so the JS warp diagram matches.
      const hash = (cx: number, cy: number): [number, number] => {
        let s = ((cx >>> 0) * 2654435769) >>> 0;
        s = (s ^ (((cy >>> 0) * 2246822519) >>> 0)) >>> 0;
        s = (s ^ (s >>> 16)) >>> 0;
        s = ((s * 0x85ebca6b) >>> 0);
        s = (s ^ (s >>> 13)) >>> 0;
        s = ((s * 0xc2b2ae35) >>> 0);
        s = (s ^ (s >>> 16)) >>> 0;
        return [(s & 0xffff) / 65535, ((s >>> 16) & 0xffff) / 65535];
      };
      const sx = x / cs, sy = y / cs;
      const ix = Math.floor(sx), iy = Math.floor(sy);
      let bestD2 = 1e9, bestFx = 0, bestFy = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const cx = ix + dx, cy = iy + dy;
          const [hx, hy] = hash(cx, cy);
          const fx = cx + hx, fy = cy + hy;
          const ddx = fx - sx, ddy = fy - sy;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 < bestD2) { bestD2 = d2; bestFx = fx; bestFy = fy; }
        }
      }
      const F1 = Math.sqrt(bestD2);
      const feat_x = bestFx * cs, feat_y = bestFy * cs;
      const dScale = Math.pow(F1 + 1e-6, power) * distort;
      return [scale * (feat_x + (x - feat_x) * dScale), scale * (feat_y + (y - feat_y) * dScale)];
    },
  },
  // #114 batch 2b-a — JWildfire S-tier first half.
  {
    idx: V.juliaq,
    name: 'juliaq',
    source: sourceForIdx(V.juliaq),
    formula: 'V_{109}(x, y) = r^{q/2p}\\,(\\cos a,\\; \\sin a),\\; a = \\tfrac{q}{p}\\,\\theta + n\\tfrac{2\\pi}{p},\\; n \\in [0, |p|)',
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
    formula: 'V_{110}(x, y) = \\begin{cases} \\tfrac{w\\sqrt{2}}{2}(\\sqrt{r+x},\\; -\\tfrac{y}{\\sqrt{r+x}}) & r\\geq 1,\\, \\text{coin}>0.5 \\\\ \\tfrac{w}{\\sqrt{r(y^2+(r+x)^2)}}(r+x,\\; y) & r\\geq 1,\\, \\text{coin}\\leq 0.5 \\\\ \\text{mirrored sign inside disk} \\end{cases}',
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
    formula: 'V_{111}(x, y) = w\\sqrt{w^2/r_2 - 1}\\,(x, y),\\; r_2 = (x^2+y^2)^2/x^2 \\text{ if } x>\\varepsilon\\text{, else identity}',
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
    formula: 'V_{112}(x, y) = (x, y) + d\\,(\\mu_x r_0,\\; \\mu_y r_1),\\; d = \\max(0,(|p - p_0| - m)\\,r_{max})',
    blurb: 'Distance-weighted random scatter by Xyrus02 (JWildfire Falloff2 type=0 path). Outside the mindist radius around (x0,y0), each iterate gets a random displacement that grows with distance — produces a soft-edged "halo" around the center point. Z-axis params (mul_z, z0) and the color/invert flags dropped to fit pyr3\'s 2D 8-slot seam; the type=1 (radial) and type=2 (gaussian) branches live on the sibling V113 falloff2.',
    params: [
      { name: 'scatter', default: 1,   min: 0,  max: 4,  step: 0.05 },
      { name: 'mindist', default: 0.5, min: 0,  max: 4,  step: 0.05 },
      { name: 'mul_x',   default: 1,   min: -4, max: 4,  step: 0.05 },
      { name: 'mul_y',   default: 1,   min: -4, max: 4,  step: 0.05 },
      { name: 'x0',      default: 0,   min: -4, max: 4,  step: 0.05 },
      { name: 'y0',      default: 0,   min: -4, max: 4,  step: 0.05 },
    ],
  },
  {
    idx: V.falloff2,
    name: 'falloff2',
    source: sourceForIdx(V.falloff2),
    formula: 'V_{113}: \\text{type } 0 = (x,y)+d(\\mu_x r_0,\\mu_y r_1),\\; 1 = \\text{radial rotate},\\; 2 = \\text{gaussian 2}\\pi\\pi\\text{ shell}',
    blurb: 'Three-branch falloff by Xyrus02 (JWildfire Falloff2Func). type=0 reproduces V112 falloff; type=1 rotates each iterate around (x0,y0) by a d-weighted angle; type=2 scatters inside a gaussian-shaped angular shell. Z-axis params + invert + mul_c dropped per pyr3\'s 2D 8-slot seam.',
    params: [
      { name: 'scatter', default: 1,   min: 0,  max: 4, step: 0.05 },
      { name: 'type',    default: 0,   min: 0,  max: 2, step: 1 },
      { name: 'mul_x',   default: 1,   min: -4, max: 4, step: 0.05 },
      { name: 'mul_y',   default: 1,   min: -4, max: 4, step: 0.05 },
      { name: 'x0',      default: 0,   min: -4, max: 4, step: 0.05 },
      { name: 'y0',      default: 0,   min: -4, max: 4, step: 0.05 },
      { name: 'mindist', default: 0.5, min: 0,  max: 4, step: 0.05 },
    ],
  },
  {
    idx: V.falloff3,
    name: 'falloff3',
    source: sourceForIdx(V.falloff3),
    formula: 'V_{114}(x, y) = (x, y) + d\\,\\mu \\cdot r_0\\cos(d r_1\\,2\\pi)\\,(\\cos(d r_2 \\pi),\\; \\sin(d r_2 \\pi))',
    blurb: 'Gaussian-shell falloff by JWildfire AbstractFalloff3Func, blur_type=0 (gaussian) + blur_shape=0 (circle) default-mode port. Scatters each iterate inside a 2π·π angular shell scaled by the circle-distance — produces a soft-shell glow around (x0,y0). invert=1 flips inside/outside. The blur_type 1/2 (radial/log) and blur_shape 1 (square) selectors, along with Z-axis params + alpha + mul_c, dropped to fit pyr3\'s 2D 8-slot seam.',
    params: [
      { name: 'scatter', default: 1,   min: 0,  max: 4, step: 0.05 },
      { name: 'mul_x',   default: 1,   min: -4, max: 4, step: 0.05 },
      { name: 'mul_y',   default: 1,   min: -4, max: 4, step: 0.05 },
      { name: 'x0',      default: 0,   min: -4, max: 4, step: 0.05 },
      { name: 'y0',      default: 0,   min: -4, max: 4, step: 0.05 },
      { name: 'mindist', default: 0.5, min: 0,  max: 4, step: 0.05 },
      { name: 'invert',  default: 0,   min: 0,  max: 1, step: 1 },
    ],
  },
  // #114 batch 2b-b — S-tier kaleidoscope/circle family.
  {
    idx: V.collideoscope,
    name: 'collideoscope',
    source: sourceForIdx(V.collideoscope),
    formula: 'V_{115}(x, y) = r\\,(\\cos a^{*},\\; \\sin a^{*}),\\; a^{*} = \\text{fold}_{2n}(\\theta, a)',
    blurb: 'Kaleidoscope-collide by Michael Faber (JWildfire). Folds the polar angle into 2·num pie slices with alternating-sign offsets — two adjacent slices "collide" in mirror-image, producing the eponymous splayed-petal pattern. JWF\'s class default a=0.20, num=1 (with randomize() spreading num∈[1,10]).',
    params: [
      { name: 'a',   default: 0.20, min: 0, max: 1,  step: 0.01 },
      { name: 'num', default: 1,    min: 1, max: 10, step: 1 },
    ],
    warpFn: (x, y) => {
      const num = 1;
      const a_param = 0.20;
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
    formula: 'V_{116}(x, y) = (r\\cos a,\\; r\\sin a),\\; r = \\tfrac{4w}{\\pi}\\,\\text{side} + h,\\; a = \\tfrac{\\pi}{4}\\,\\tfrac{\\text{perim}}{\\text{side}} - \\tfrac{\\pi}{4}',
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
    formula: 'V_{117}(x, y) = w(\\text{side}+h)\\,(\\cos a,\\; \\sin a),\\; a = \\tfrac{\\pi}{4}\\,\\tfrac{\\text{perim}}{\\text{side}} - \\tfrac{\\pi}{4}',
    blurb: 'Companion variation to V116 circlize by Michael Faber (Angle Pack). Same square → circle perimeter parameterization, but the radius is w·(side+h) instead of (4w/π)·side+h — the `hole` offset IS scaled by the weight here, correcting the sibling\'s quirk. Produces a more uniform ring at non-zero hole.',
    params: [
      { name: 'hole', default: 0.0, min: -1, max: 1, step: 0.01 },
    ],
    warpFn: (x, y) => {
      const w = 1;
      const hole = 0.0;
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
    formula: 'V_{118}(x, y) = w\\,(\\cosh\\mu\\cos\\nu^{*},\\; \\sinh\\mu\\sin\\nu^{*}),\\; \\nu^{*} = \\nu + \\mu\\cdot o + i/\\mu',
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
    formula: 'V_{119}(x, y) = w\\cos x\\,((\\cos x \\cos y)^3,\\; (\\sin x \\cos y)^3)',
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
    formula: 'V_{120}(x, y) = \\begin{cases} w\\,(sx, sy) & r \\leq 1 \\\\ w\\omega\\,(\\cos\\theta, \\sin\\theta) & r > 1 \\end{cases}',
    blurb: 'Bordered-circle projection by Xyrus02 (Apophysis plugin pack). Inside the scale-adjusted unit disk, the iterate passes through verbatim; outside, it gets snapped onto the unit circle (or — when `borderwidth ≠ 0` — onto a random-radius shell just outside it). At borderwidth=0 the deterministic disk path produces a clean filled circle; non-zero borderwidth adds a halo. RNG path activates only for borderwidth ≠ 0.',
    params: [
      { name: 'scale',       default: 1.0, min: 0.1, max: 4,    step: 0.05 },
      { name: 'borderwidth', default: 0.0, min: 0,   max: 1,    step: 0.05 },
    ],
    warpFn: (x, y) => {
      const scale = 1.0;
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
    formula: 'V_{121}(x, y) = \\tfrac{w}{|p(z)|^2}\\,(x\\,\\Re p + y\\,\\Im p,\\; y\\,\\Re p - x\\,\\Im p),\\; p(z) = c_3 z^3 + c_2 z^2 + c_1 z + 1',
    blurb: 'Cubic-polynomial complex inverse by Xyrus02 / Georg Kiehne. The c1-only path collapses to flam3\'s classic `curl`; non-zero c2 and c3 add quadratic and cubic shaping, producing the eponymous "tighter scroll" / "double bend" silhouettes. Defaults c1=1, c2=c3=0 reproduce the standard curl shape; users discover the richer family by dialing c2/c3 up.',
    params: [
      { name: 'c1', default: 1.0, min: -2, max: 2, step: 0.05 },
      { name: 'c2', default: 0.0, min: -2, max: 2, step: 0.05 },
      { name: 'c3', default: 0.0, min: -1, max: 1, step: 0.02 },
    ],
    warpFn: (x, y) => {
      const c1 = 1.0;
      const c2 = 0.0;
      const c3 = 0.0;
      const cc2 = 2 * c2;
      const cc3 = 3 * c3;
      const x2 = x * x;
      const x3 = x2 * x;
      const y2 = y * y;
      const y3 = y2 * y;
      const re = c3 * x3 - cc3 * x * y2 + c2 * x2 - c2 * y2 + c1 * x + 1.0;
      const im = c3 * x2 * y - c3 * y3 + cc2 * x * y + c1 * y;
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
    formula: 'V_{122}(x, y) = \\tfrac{w(c+1)}{|1 + r e^{ip\\theta}|^2 + \\epsilon}\\,((x\\,\\Re,\\; y\\,\\Im) + (y\\,\\Im,\\; -x\\,\\Re)),\\; r = c\\,(x^2+y^2)^{p/2}',
    blurb: 'Polar-power murl by Peter Sdobnov (Zueuk), ported into JWildfire by chronologicaldot. The polar angle is multiplied by an integer power and a complex-inverse blend through (re, im) folds back to Cartesian — produces the "spiraling braid" look characteristic of murl-family flames. Defaults c=0.1, power=1 give a gentle deterministic spiral; higher power values multiply the angular folding.',
    params: [
      { name: 'c',     default: 0.1, min: -1, max: 2, step: 0.05 },
      { name: 'power', default: 1,   min: 1,  max: 8, step: 1 },
    ],
    warpFn: (x, y) => {
      const c_in = 0.1;
      const power = 1;
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
    formula: 'V_{123}(x, y) = w(x, y) + \\frac{(s_x^2 - s_y^2)\\sin(2\\pi\\,d\\,(s_x+s_y))}{s_x^2 + s_y^2}\\,(1, 1),\\; s = 0.05\\,wp',
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
    formula: 'V_{124}(x, y) = w\\,(P_0 + R\\cdot(D_x\\cos\\phi + D_y\\sin\\phi,\\, -D_x\\sin\\phi + D_y\\cos\\phi)),\\; \\phi = 2\\pi r',
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
    formula: 'V_{125}(x, y) = w\\,R(\\alpha)\\,\\left(\\tfrac{4x}{r^2+4},\\; \\tfrac{6+2\\rho}{r^2+4}\\,y\\right)\\cdot \\sigma,\\; \\alpha = \\tfrac{\\pi}{4}(1 + \\tfrac{\\theta}{2}),\\; \\sigma = \\mathrm{sign}(x_{\\mathrm{rot}})',
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
    formula: 'V_{126}(x, y) = \\tfrac{w}{|z\'|^2 + \\epsilon}\\,|z\'|^2\\,(\\cos\\alpha, \\sin\\alpha),\\; z\' = M\\cdot\\tfrac{z}{|z|^2 + \\epsilon} + t,\\; \\alpha = \\arg z\'',
    blurb: 'Extended hyperbolic by Xyrus02 (Apophysis plugin pack). Composes a unit-disc inversion (z → z/|z|²) with a 2x3 affine M·(·) + t — then re-emits the iterate as |z\'|²·(cos α, sin α) so the radius scales with the affine\'s magnitude. A final |z|⁻² reflection (the second "flip" in the source) wraps output back. Defaults M = identity (m00=m11=1) give the simplest hyperbolic shape; non-zero m20/m21 translate the inversion center.',
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
    formula: 'V_{127}(x, y) = \\tfrac{w}{re^2 + im^2}\\,(x\\,re + y\\,im,\\; y\\,re + x\\,im),\\; re = 1 + c_1 x + c_2(x^2-y^2) + c_3(x^3 - 3x)',
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
    formula: 'V_{128}(x, y) = w\\,r\'\\,(\\cos\\phi, \\sin\\phi),\\; r\' = (in_x^2 + in_y^2)^{c_N},\\; \\phi = \\tfrac{\\arctan(in_y, in_x) + 2\\pi k}{p}',
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
    formula: 'V_{129}(x, y) = w\\,(x + \\delta_x, y + \\delta_y),\\; (\\delta_x, \\delta_y) \\in \\{(\\pm 1, 0), (0, \\pm 1)\\}\\; \\text{by quadrant}',
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
    formula: 'V_{130}(x, y) = (r\\cos\\phi, r\\sin\\phi),\\; r = \\tfrac{4w}{\\pi}\\,s + \\text{hole},\\; \\phi = \\tfrac{\\pi}{4}\\,\\tfrac{p_s}{s} - \\pi',
    blurb: 'Disc-uniform blur by Xyrus02 (Apophysis plugin pack). Uniformly samples a unit square, runs a square→circle perimeter parameterization (same family as circlize / circlize2), then emits onto a hole-offset circle. Input iterate is ignored — the variation\'s output is purely RNG-driven. The 4/π scale factor matches a unit-disc area density; non-zero hole adds a concentric annulus offset.',
    params: [
      { name: 'hole', default: 0.0, min: -1, max: 1, step: 0.05 },
    ],
    // RNG-driven (input p is ignored, output is pure RNG) — no warpFn.
  },
];

const byIdx = new Map(CATALOG_DATA.map(d => [d.idx, d]));
export function getCatalogDoc(idx: number): VariationDoc | undefined {
  return byIdx.get(idx);
}
