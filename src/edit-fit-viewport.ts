// pyr3 — /editor "fit to viewport" computation.
//
// Runs a small CPU chaos game on the genome (re-using the ts_var_* reference
// kernels from src/variations.ts) and returns a (cx, cy, scale) that frames
// the flame in the target render dims. Used by the 🎯 fit button in the
// viewport section.
//
// Are flames infinite?  YES — fractal flames are formally unbounded. Some
// variations (spherical, julia, exponential) can produce points arbitrarily
// far from origin, so a strict 100%-coverage bbox is meaningless. We mirror
// flam3's `flam3_estimate_bounding_box` (rect.c:340): sample N points, drop
// the outer DROP_FRAC per axis, return the bbox of the central tranche.
//
// This is NOT a render path — it's an editor UX helper. No GPU dependency,
// no histogram readback, no engine seam touched.

import { type Genome, type Xform } from './genome';
import { type Variation, V } from './variations';
import { VARIATION_PARAMS } from './serialize';
import * as TS from './variations';

// Index → variation name (the reverse of V). Built once at module load.
const REVERSE_V: Record<number, string> = (() => {
  const out: Record<number, string> = {};
  for (const [name, idx] of Object.entries(V)) out[idx as number] = name;
  return out;
})();

// Deterministic LCG so a given (genome, seed) always fits to the same viewport.
// Numerical-Recipes constants — well-distributed in low bits.
function makeLcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 0x100000000;
  };
}

function paramsFor(v: Variation): Record<string, number> {
  const name = REVERSE_V[v.index];
  if (!name) return {};
  const keys = VARIATION_PARAMS[name];
  if (!keys) return {};
  const out: Record<string, number> = {};
  const obj = v as unknown as Record<string, number | undefined>;
  for (let i = 0; i < keys.length; i++) {
    const raw = obj[`param${i}`];
    // #440 — default a missing / non-finite positional param to 0 (the GPU
    // packer's behaviour) so the oracle gets a COMPLETE named-params object and
    // never throws "requires params.*". The 25 throwing variations absent from
    // VARIATION_DEFAULTS reach here with no param0/param1; fit is a UX estimate,
    // so 0 is a safe stand-in (the GPU still renders them with their real 0
    // defaults).
    const val = (typeof raw === 'number' && Number.isFinite(raw)) ? raw : 0;
    const bareKey = keys[i]!;
    out[bareKey] = val;
    if (!bareKey.startsWith(name + '_')) {
      out[`${name}_${bareKey}`] = val;
    }
  }
  return out;
}

type TsVarFn = (i: {
  tx: number;
  ty: number;
  weight: number;
  params?: Record<string, number>;
  randBranch?: number;
  randValues?: number[];
}) => { x: number; y: number };

function dispatchVariation(
  v: Variation,
  tx: number,
  ty: number,
  rng: () => number,
): { x: number; y: number } {
  const name = REVERSE_V[v.index];
  if (!name) {
    // Unknown variation index — fall back to linear-weighted identity. Not
    // mathematically equivalent, but fit is a UX starting point, not a render.
    return { x: v.weight * tx, y: v.weight * ty };
  }
  const fn = (TS as unknown as Record<string, TsVarFn | undefined>)[`ts_var_${name}`];
  if (!fn) return { x: v.weight * tx, y: v.weight * ty };
  // #440 — the oracle is a UX fit estimate, NOT a render: it must be TOTAL.
  // paramsFor zero-fills missing params, but a few variations still throw (the
  // 5 absent from VARIATION_PARAMS — waves/popcorn/rings/fan/oscope — plus any
  // degenerate-param math). Fall back to the same linear-identity used for
  // unknown variations rather than letting the throw escape and crash editor
  // init (the #432 fit-on-open path runs this unguarded).
  try {
    return fn({
      tx,
      ty,
      weight: v.weight,
      params: paramsFor(v),
      randBranch: rng() < 0.5 ? 0 : 1,
      // Six rand draws covers every randValues-consuming variation in the registry
      // (noise/blur/gaussian_blur/arch/radial_blur/square/rays/blade/twintrian
      // top out at 6). Cheap to allocate; per-iter cost is dominated by the
      // variation math itself.
      randValues: [rng(), rng(), rng(), rng(), rng(), rng()],
    });
  } catch {
    return { x: v.weight * tx, y: v.weight * ty };
  }
}

function applyAffineXform(xf: Pick<Xform, 'a' | 'b' | 'c' | 'd' | 'e' | 'f'>, x: number, y: number): { x: number; y: number } {
  return { x: xf.a * x + xf.b * y + xf.c, y: xf.d * x + xf.e * y + xf.f };
}

function applyXform(xf: Xform, px: number, py: number, rng: () => number): { x: number; y: number } {
  const t = applyAffineXform(xf, px, py);
  let qx = 0;
  let qy = 0;
  for (const v of xf.variations) {
    const o = dispatchVariation(v, t.x, t.y, rng);
    qx += o.x;
    qy += o.y;
  }
  if (xf.post) {
    const p = applyAffineXform(xf.post, qx, qy);
    qx = p.x;
    qy = p.y;
  }
  return { x: qx, y: qy };
}

export interface ChaosSamplerOpts {
  /** Total sample count returned (post-warmup). 5000 is plenty for percentile
   *  bbox on most flames; bumps up cost ~linearly. */
  samples: number;
  /** Initial iterations discarded so the walker reaches the attractor. */
  warmup: number;
  /** LCG seed — same seed → same samples → same fit. */
  seed: number;
}

const DEFAULT_OPTS: ChaosSamplerOpts = { samples: 5000, warmup: 50, seed: 12345 };

/** Run a CPU chaos game and return post-warmup walker positions. Returns []
 *  for degenerate genomes (no xforms, all-zero weights). NaN/Inf blowups
 *  during iteration reseed the walker and continue. */
export function sampleChaosForFit(
  genome: Genome,
  opts: Partial<ChaosSamplerOpts> = {},
): Array<{ x: number; y: number }> {
  const { samples, warmup, seed } = { ...DEFAULT_OPTS, ...opts };
  const xforms = genome.xforms;
  if (xforms.length === 0) return [];

  // Cumulative xform selection distribution. Skip zero-weight xforms.
  let totalW = 0;
  for (const x of xforms) totalW += Math.max(0, x.weight ?? 0);
  if (totalW <= 0) return [];
  const cum: number[] = new Array(xforms.length);
  let acc = 0;
  for (let i = 0; i < xforms.length; i++) {
    acc += Math.max(0, xforms[i]!.weight ?? 0) / totalW;
    cum[i] = acc;
  }

  const rng = makeLcg(seed);
  let px = rng() * 2 - 1;
  let py = rng() * 2 - 1;
  const out: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < samples + warmup; i++) {
    const r = rng();
    let xi = cum.length - 1;
    for (let k = 0; k < cum.length; k++) {
      if (r < cum[k]!) {
        xi = k;
        break;
      }
    }
    const next = applyXform(xforms[xi]!, px, py, rng);
    px = next.x;
    py = next.y;
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      px = rng() * 2 - 1;
      py = rng() * 2 - 1;
      continue;
    }
    if (i < warmup) continue;
    // Apply finalxform lens on the stored point. Trajectory continues from
    // the pre-lens point (chaos.wgsl + flam3.c:280-287) so the lens doesn't
    // perturb the walker — only the recorded sample.
    const lens = genome.finalxform;
    if (lens) {
      const l = applyXform(lens, px, py, rng);
      if (Number.isFinite(l.x) && Number.isFinite(l.y)) {
        out.push({ x: l.x, y: l.y });
        continue;
      }
      // Lens blew up; fall through and record the raw walker position.
    }
    out.push({ x: px, y: py });
  }

  return out;
}

export interface FitViewport {
  cx: number;
  cy: number;
  scale: number;
}

/** Padding around the bbox. 0.9 = 10% margin so the flame doesn't kiss the
 *  canvas edges. Subjective; Apophysis defaults to a similar ratio. */
export const FIT_MARGIN = 0.9;

/** Fraction of samples to drop per axis when computing percentile bbox.
 *  Mirrors flam3_estimate_bounding_box's outlier trim (rect.c:340 — 0.5%).
 *  Required because fractal flames are formally unbounded — a faraway rare
 *  outlier should not force the user to zoom out off the bulk of the flame. */
export const DROP_FRAC = 0.005;

/** Compute the viewport that fits the flame into a (canvasW, canvasH) frame.
 *  Returns null when the genome can't be fit (empty xforms, all-zero weight,
 *  all-NaN samples, zero-area bbox). Caller should no-op on null.
 *
 *  Algorithm:
 *    1. Sample N walker positions via sampleChaosForFit.
 *    2. Rotate samples by genome.rotate so the bbox is screen-axis-aligned.
 *    3. Sort and drop outer DROP_FRAC per axis → percentile bbox.
 *    4. Scale = min(W/bboxW, H/bboxH) × FIT_MARGIN.
 *    5. Center = inverse-rotate the bbox center back to world coords.
 *
 *  The rotation step matters: a 45°-rotated flame fit using an unrotated
 *  bbox gives extra slack on the diagonal. Rotating first makes the fit tight. */
export function computeFitViewport(
  genome: Genome,
  canvasW: number,
  canvasH: number,
  opts: Partial<ChaosSamplerOpts> = {},
): FitViewport | null {
  if (canvasW <= 0 || canvasH <= 0) return null;
  const pts = sampleChaosForFit(genome, opts);
  if (pts.length === 0) return null;

  const rotRad = ((genome.rotate ?? 0) * Math.PI) / 180;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);
  const xs = new Float64Array(pts.length);
  const ys = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    xs[i] = cosR * p.x - sinR * p.y;
    ys[i] = sinR * p.x + cosR * p.y;
  }
  xs.sort();
  ys.sort();

  const dropN = Math.floor(pts.length * DROP_FRAC);
  const xmin = xs[dropN]!;
  const xmax = xs[xs.length - 1 - dropN]!;
  const ymin = ys[dropN]!;
  const ymax = ys[ys.length - 1 - dropN]!;
  if (![xmin, xmax, ymin, ymax].every(Number.isFinite)) return null;

  const bbW = xmax - xmin;
  const bbH = ymax - ymin;
  // Singleton-attractor (all samples at one point) → fit would be infinite zoom.
  if (bbW < 1e-9 && bbH < 1e-9) return null;
  // Single-axis-zero (line attractor) → pad so the other axis still fits.
  const safeW = Math.max(bbW, 1e-3);
  const safeH = Math.max(bbH, 1e-3);

  const scaleX = canvasW / safeW;
  const scaleY = canvasH / safeH;
  const scale = Math.min(scaleX, scaleY) * FIT_MARGIN;

  const cxRot = (xmin + xmax) / 2;
  const cyRot = (ymin + ymax) / 2;
  // Inverse rotation R(-θ): (x cos + y sin, -x sin + y cos).
  const cx = cosR * cxRot + sinR * cyRot;
  const cy = -sinR * cxRot + cosR * cyRot;

  return { cx, cy, scale };
}

/** #432 — fit-on-open. Re-frame a genome's camera (`scale`/`cx`/`cy`) to its own
 *  output `size`. A transferred flame (surprise tile / corpus ✏️ Edit / catalog)
 *  carries a camera fit for a DIFFERENT reference frame — generateRandomGenome
 *  fits at 1920×1080, the surprise thumbnail at 320². Once the editor stamps its
 *  sticky output size (e.g. 4K), that old scale renders the attractor tiny. This
 *  re-fits to the genome's own dims so it opens framed like the thumbnail; the
 *  output size itself is untouched. No-op when `size` is missing or the chaos
 *  oracle can't frame the attractor (divergent / singleton). Mutates in place. */
export function refitGenomeToOutputSize(genome: Genome, opts: Partial<ChaosSamplerOpts> = {}): void {
  const w = genome.size?.width;
  const h = genome.size?.height;
  if (!w || !h) return;
  const fit = computeFitViewport(genome, w, h, opts);
  if (!fit) return;
  genome.scale = fit.scale;
  genome.cx = fit.cx;
  genome.cy = fit.cy;
}
