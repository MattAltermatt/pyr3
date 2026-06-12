// P2 of Animation milestone (#17 / #207). Port of flam3-C's
// `flam3_interpolate` (flam3.c:797-882) + `flam3_interpolate_n`
// (interpolation.c:373-720). Given an Animation and a target time `t`,
// derive a concrete Genome by 2-keyframe blend.
//
// Linear keyframe interp only — smooth/Catmull-Rom (animation.interpolation
// === 'smooth') logs a warning and falls back to linear. Stagger (P4) and
// asymmetric rotation refangles (rare; only fires when one keyframe has
// `xform.animate=0` and the other has `animate=1`) are deferred to follow-up
// issues filed against the same milestone. The 7-variation-list 180°-rotated
// identity padding (spherical / ngon / julian / juliascope / polar /
// wedge_sph / wedge_julia) is also deferred — plain identity is good enough
// for the common case; the rotated-identity dodge only matters when an
// xform with one of those variations has weight=0 in the source genome.
//
// flam3-C source map for callers cross-checking:
//   interpolation.c:31-54      motion_funcs              -> deferred to P3
//   interpolation.c:149-192    interpolate_cmap          -> interpolatePalette
//   interpolation.c:194-245    interp_and_convert_back   -> interpAndConvertBack
//   interpolation.c:247-324    convert_linear_to_polar   -> convertLinearToPolar
//   interpolation.c:373-720    flam3_interpolate_n       -> interpolate
//   flam3.c:797-882            flam3_interpolate         -> pickKeyframes + interpolate

import { type Animation } from './animation';
import { type Genome, type Xform } from './genome';
import {
  type Variation,
  type VariationIndex,
  MAX_VARIATIONS_PER_XFORM,
  linear as linearVar,
} from './variations';
import { type ColorStop, type Palette, bakeLUT, PALETTE_SIZE } from './palette';
import { type Tonemap } from './tonemap';
import { applyMotionParameters } from './motion';
import { evalEasing } from './easing';

/** flam3 EPS (interpolation.c:312). Guards against the ±π wrap discontinuity. */
const EPS = 1e-9;
/** flam3 log-mag threshold for switching to linear magnitude interp
 *  (interpolation.c:213). When any keyframe's column magnitude has
 *  log(mag) < -10, the column interpolates magnitude linearly instead of
 *  log-linearly. Prevents log(0) blow-up. */
const LOG_MAG_THRESHOLD = -10;

// ───────────────────────────────────────────────────────────────────────────
// Top-level interp entry.

/** Derive a concrete Genome at time `t` from an Animation by 2-keyframe blend.
 *  Matches flam3's `flam3_interpolate()`. Stagger always 0 (matches flam3-render;
 *  flam3-animate's stagger is P4). */
export function interpolate(animation: Animation, time: number): Genome {
  const keyframes = animation.keyframes;
  if (keyframes.length < 2) {
    throw new Error('pyr3: interpolate requires Animation.keyframes.length >= 2');
  }
  if (animation.interpolation === 'smooth') {
    // Catmull-Rom is a deferred P2 follow-up; surface once per call so the
    // missing-feature is loud but not blocking.
    console.warn('pyr3: smooth (Catmull-Rom) interp not yet implemented; using linear');
  }

  const { i1, i2, c0: rawC0, c1: rawC1 } = pickKeyframes(keyframes, time);
  const k0 = keyframes[i1]!;
  const k1 = keyframes[i2]!;

  // #224 easing: reshape the linear blend weight through this segment's curve.
  // Only ease in-range — pickKeyframes endpoint-extrapolates (rawC1 outside
  // [0,1]) where easing is undefined, so pass those through linearly. The eased
  // (c0, c1) drive EVERY downstream blend uniformly; the motion-overlay clock
  // below deliberately keeps the raw linear weight so oscillation rate stays
  // steady across the segment.
  let c0 = rawC0;
  let c1 = rawC1;
  const easeCurve = animation.segmentEasing?.[i1];
  if (easeCurve && rawC1 >= 0 && rawC1 <= 1) {
    c1 = evalEasing(easeCurve, rawC1);
    c0 = 1 - c1;
  }

  // Align xform counts — pad the shorter side with identity xforms so
  // both genomes have the same length (and same finalxform presence) before
  // interp. Plain identity for now (no special-case 180° rotation for
  // spherical/ngon/etc — deferred follow-up).
  const { aligned0, aligned1 } = alignXformCounts(k0, k1);

  // #225 xform correspondence remapping: reorder the SECOND keyframe's aligned
  // xforms by this segment's permutation before the index-aligned blend. perm is
  // defined over the ALIGNED length so it can target a padded (zero-weight) slot
  // for intentional appear/disappear. Absent/identity/invalid ⇒ positional
  // (b1 === aligned1) ⇒ byte-identical to today. finalxform is exempt (never in
  // the xforms[] array), matching flam3's final-xform exemption.
  const perm = animation.segmentPermutation?.[i1];
  const b1 = isPermutation(perm, aligned1.xforms.length)
    ? { ...aligned1, xforms: perm.map((j) => aligned1.xforms[j]!) }
    : aligned1;

  const useLog = animation.interpolation_type === 'log';

  // P3 #208 — pre-apply per-xform motion overlays to each keyframe's xforms
  // before linear blend (flam3.c:533-541 sheep_edge pattern). The motion clock
  // is the RAW (un-eased) linear weight rawC1 — the in-window time in [0, 1] for
  // this 2-keyframe pair (rawC1=0 at the first keyframe, =1 at the second). It
  // stays linear (not eased by #224) so a motion oscillation keeps a steady rate
  // across the segment. applyMotionParameters is a pure no-op when xform.motion
  // is empty, so the common case adds zero overhead.
  const xforms: Xform[] = [];
  for (let i = 0; i < aligned0.xforms.length; i++) {
    const xf0 = applyMotionParameters(aligned0.xforms[i]!, rawC1);
    const xf1 = applyMotionParameters(b1.xforms[i]!, rawC1);
    xforms.push(interpolateXform(xf0, xf1, c0, c1, useLog));
  }

  let finalxform: Xform | undefined;
  if (aligned0.finalxform && aligned1.finalxform) {
    // Final xforms never get motion overlay (flam3 interpolation.c:522-526 —
    // final xform is exempt from both stagger and motion).
    finalxform = interpolateXform(aligned0.finalxform, aligned1.finalxform, c0, c1, useLog);
  }

  const palette = interpolatePalette(animation, k0, k1, c0, c1);

  const out: Genome = {
    name: k0.name,
    xforms,
    scale: blend(k0.scale, k1.scale, c0, c1),
    cx: blend(k0.cx, k1.cx, c0, c1),
    cy: blend(k0.cy, k1.cy, c0, c1),
    palette,
    time,
  };
  if (k0.nick !== undefined) out.nick = k0.nick;
  if (finalxform) out.finalxform = finalxform;

  // Tonemap: both undefined → undefined. Otherwise interp using flam3 defaults
  // (matches what each keyframe would render as in standalone static-render).
  if (k0.tonemap || k1.tonemap) {
    out.tonemap = interpolateTonemap(k0.tonemap, k1.tonemap, c0, c1);
  }

  // Rotate (camera): only set if either keyframe has a non-zero rotate.
  const r0 = k0.rotate ?? 0;
  const r1 = k1.rotate ?? 0;
  if (r0 !== 0 || r1 !== 0) {
    const r = blend(r0, r1, c0, c1);
    if (r !== 0) out.rotate = r;
  }

  // Continuous render fields — flam3 INTERPs these across keyframes
  // (interpolation.c:489-501): quality, estimator radius/min/curve, spatial
  // filter radius, background, and (rounded INTERI) size + oversample. A
  // background fade or quality ramp between differing keyframes must transition,
  // not jump at k0. When only one keyframe carries the field we carry it
  // forward (flam3 always has them; pyr3's are optional). (#248)
  if (both(k0.quality, k1.quality)) out.quality = blend(k0.quality!, k1.quality!, c0, c1);
  else out.quality = k0.quality ?? k1.quality;
  if (both(k0.density, k1.density)) {
    out.density = {
      maxRad: blend(k0.density!.maxRad, k1.density!.maxRad, c0, c1),
      minRad: blend(k0.density!.minRad, k1.density!.minRad, c0, c1),
      curve: blend(k0.density!.curve, k1.density!.curve, c0, c1),
    };
  } else out.density = k0.density ?? k1.density;
  if (both(k0.spatialFilter, k1.spatialFilter)) {
    // radius INTERPs; shape is spatial_filter_select — categorical carry-forward.
    out.spatialFilter = {
      radius: blend(k0.spatialFilter!.radius, k1.spatialFilter!.radius, c0, c1),
      shape: k0.spatialFilter!.shape,
    };
  } else out.spatialFilter = k0.spatialFilter ?? k1.spatialFilter;
  if (both(k0.background, k1.background)) {
    out.background = [
      blend(k0.background![0], k1.background![0], c0, c1),
      blend(k0.background![1], k1.background![1], c0, c1),
      blend(k0.background![2], k1.background![2], c0, c1),
    ];
  } else out.background = k0.background ?? k1.background;
  if (both(k0.size, k1.size)) {
    out.size = {
      width: Math.round(blend(k0.size!.width, k1.size!.width, c0, c1)),
      height: Math.round(blend(k0.size!.height, k1.size!.height, c0, c1)),
    };
  } else out.size = k0.size ?? k1.size;
  if (both(k0.oversample, k1.oversample)) out.oversample = Math.round(blend(k0.oversample!, k1.oversample!, c0, c1));
  else out.oversample = k0.oversample ?? k1.oversample;

  // Categorical fields — flam3 carries these forward identically
  // (interpolation.c:464-471): palette_mode, symmetry.
  if (k0.paletteMode) out.paletteMode = k0.paletteMode;
  if (k0.symmetry) out.symmetry = k0.symmetry;

  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Keyframe selection — flam3.c:797-832.

interface KeyframePick {
  /** Index of the lower keyframe (i1). */
  i1: number;
  /** Index of the upper keyframe (i2 = i1 + 1). */
  i2: number;
  /** Blend weight for keyframes[i1]: c0 = (t_i2 - t) / (t_i2 - t_i1). */
  c0: number;
  /** Blend weight for keyframes[i2]: c1 = 1 - c0. */
  c1: number;
}

export function pickKeyframes(keyframes: Genome[], time: number): KeyframePick {
  const n = keyframes.length;
  if (n < 2) throw new Error('pyr3: pickKeyframes requires N >= 2');

  // Endpoint clamps. flam3: `cps[0].time >= time` → i1=0, i2=1.
  if ((keyframes[0]!.time ?? 0) >= time) {
    return endpointBlend(keyframes, 0, 1, time);
  }
  if ((keyframes[n - 1]!.time ?? 0) <= time) {
    return endpointBlend(keyframes, n - 2, n - 1, time);
  }

  // Linear scan for the bracket. flam3.c:818-822 — same algorithm.
  let i1 = 0;
  while ((keyframes[i1]!.time ?? 0) < time) i1++;
  i1--;
  const i2 = i1 + 1;
  return computeBlend(keyframes, i1, i2, time);
}

function computeBlend(keyframes: Genome[], i1: number, i2: number, time: number): KeyframePick {
  const t1 = keyframes[i1]!.time ?? 0;
  const t2 = keyframes[i2]!.time ?? 0;
  if (Math.abs(t2 - t1) < EPS) {
    // Coincident keyframes: weight goes fully to i2 (matches flam3 indirectly —
    // a zero-span window means c[1] approaches 1 from above).
    return { i1, i2, c0: 0, c1: 1 };
  }
  const c0 = (t2 - time) / (t2 - t1);
  return { i1, i2, c0, c1: 1 - c0 };
}

function endpointBlend(keyframes: Genome[], i1: number, i2: number, time: number): KeyframePick {
  // At endpoints, flam3 still computes c0 = (t2 - time) / (t2 - t1) — which
  // gives c0 > 1 (before first) or c0 < 0 (after last), pulling the result
  // toward the nearer endpoint. We mirror that.
  return computeBlend(keyframes, i1, i2, time);
}

// ───────────────────────────────────────────────────────────────────────────
// Xform alignment — interpolation.c:768-949 (flam3_align). Pad shorter side
// with identity xforms (linear weight=1, identity affine, no variations
// beyond linear(1)) so both genomes have the same xform count. Special-case
// 180° rotated identity for 7 listed variations is deferred.

function alignXformCounts(k0: Genome, k1: Genome): { aligned0: Genome; aligned1: Genome } {
  const n = Math.max(k0.xforms.length, k1.xforms.length);

  // Quick path: same lengths + matching finalxform presence → no padding.
  if (
    k0.xforms.length === n &&
    k1.xforms.length === n &&
    !!k0.finalxform === !!k1.finalxform
  ) {
    return { aligned0: k0, aligned1: k1 };
  }

  const padIfShort = (g: Genome): Genome => {
    const xforms = g.xforms.length === n
      ? g.xforms
      : g.xforms.concat(
          Array.from({ length: n - g.xforms.length }, () => makeIdentityXform()),
        );
    let finalxform = g.finalxform;
    if (!finalxform && (k0.finalxform || k1.finalxform)) {
      finalxform = makeIdentityXform();
    }
    return finalxform ? { ...g, xforms, finalxform } : { ...g, xforms };
  };

  return { aligned0: padIfShort(k0), aligned1: padIfShort(k1) };
}

function makeIdentityXform(): Xform {
  return {
    a: 1, b: 0, c: 0,
    d: 0, e: 1, f: 0,
    weight: 0,                         // zero weight: pad never participates in chaos pick
    color: 0,
    colorSpeed: 0.5,                   // flam3 parser default
    variations: [linearVar(1)],
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Per-xform interp — interpolation.c:512-660. Linear fields are trivial;
// affine takes the log-polar path when interpolation_type === 'log'.

function interpolateXform(x0: Xform, x1: Xform, c0: number, c1: number, useLog: boolean): Xform {
  // active:false mirrors the packer (symmetry.ts) — an inactive xform has
  // effective weight 0 — so a deactivated xform stays off across a tween
  // instead of silently re-activating (#260). When inactive on BOTH keyframes
  // the result carries active:false too; mixed off→on just ramps from 0.
  const density = clampGE0(blend(
    x0.active === false ? 0 : x0.weight,
    x1.active === false ? 0 : x1.weight,
    c0, c1,
  ));   // weight ~ density
  const color = clamp01(blend(x0.color, x1.color, c0, c1));
  const colorSpeed = clamp01(blend(x0.colorSpeed, x1.colorSpeed, c0, c1));
  const opacity = blend(x0.opacity ?? 1, x1.opacity ?? 1, c0, c1);

  // Affine interp. flam3 stores c[3][2] column-major; pyr3 stores
  // (a, b, c, d, e, f) row-major. Mapping:
  //   pyr3 (a, b, c) = row 0 (new_x = a*x + b*y + c)
  //   pyr3 (d, e, f) = row 1 (new_y = d*x + e*y + f)
  //   flam3 column 0 (the x-component) = (a, d)  [a from row 0, d from row 1]
  //   flam3 column 1 (the y-component) = (b, e)
  //   flam3 column 2 (translation)     = (c, f)  — linear interp always
  const aff = useLog
    ? interpolateAffineLogPolar(x0, x1, c0, c1, /* usePost */ false)
    : interpolateAffineLinear(x0, x1, c0, c1, /* usePost */ false);

  // Post-affine: identity-on-both → identity (no interp). Otherwise interp.
  let post: { a: number; b: number; c: number; d: number; e: number; f: number } | undefined;
  const p0 = x0.post;
  const p1 = x1.post;
  if (p0 || p1) {
    const allId = (!p0 || isIdentityAffine(p0)) && (!p1 || isIdentityAffine(p1));
    if (!allId) {
      const post0 = p0 ?? IDENTITY_AFFINE;
      const post1 = p1 ?? IDENTITY_AFFINE;
      const interp = useLog
        ? interpolateAffineLogPolar(
            { ...x0, a: post0.a, b: post0.b, c: post0.c, d: post0.d, e: post0.e, f: post0.f },
            { ...x1, a: post1.a, b: post1.b, c: post1.c, d: post1.d, e: post1.e, f: post1.f },
            c0, c1, /* usePost */ false,
          )
        : interpolateAffineLinear(
            { ...x0, a: post0.a, b: post0.b, c: post0.c, d: post0.d, e: post0.e, f: post0.f },
            { ...x1, a: post1.a, b: post1.b, c: post1.c, d: post1.d, e: post1.e, f: post1.f },
            c0, c1, /* usePost */ false,
          );
      if (!isIdentityAffine(interp)) post = interp;
    }
  }

  const variations = interpolateVariations(x0.variations, x1.variations, c0, c1);

  const out: Xform = {
    a: aff.a, b: aff.b, c: aff.c, d: aff.d, e: aff.e, f: aff.f,
    weight: density,
    color, colorSpeed,
    variations,
  };
  if (opacity !== 1.0) out.opacity = opacity;
  if (post) out.post = post;
  if (x0.active === false && x1.active === false) out.active = false;

  // xaos: per-cell linear interp, ≥0 clamp (interpolation.c:505-512).
  if (x0.xaos || x1.xaos) {
    const xaos = interpolateXaos(x0.xaos, x1.xaos, c0, c1);
    if (xaos) out.xaos = xaos;
  }

  return out;
}

const IDENTITY_AFFINE = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 } as const;

function isIdentityAffine(p: { a: number; b: number; c: number; d: number; e: number; f: number }): boolean {
  return p.a === 1 && p.b === 0 && p.c === 0 && p.d === 0 && p.e === 1 && p.f === 0;
}

// ───────────────────────────────────────────────────────────────────────────
// Affine interp — linear vs log-polar.

interface Affine6 {
  a: number; b: number; c: number; d: number; e: number; f: number;
}

function interpolateAffineLinear(x0: Affine6, x1: Affine6, c0: number, c1: number, _usePost: boolean): Affine6 {
  return {
    a: blend(x0.a, x1.a, c0, c1),
    b: blend(x0.b, x1.b, c0, c1),
    c: blend(x0.c, x1.c, c0, c1),
    d: blend(x0.d, x1.d, c0, c1),
    e: blend(x0.e, x1.e, c0, c1),
    f: blend(x0.f, x1.f, c0, c1),
  };
}

/** Log-polar affine interp. Each "column" (in flam3 terms — x-vec and y-vec)
 *  converts to (angle, magnitude); angle interpolates linearly, magnitude in
 *  log space (with linear fallback when any keyframe's log(mag) drops below
 *  LOG_MAG_THRESHOLD). Translation (column 2) stays linear. The angle-unwrap
 *  loop in convert_linear_to_polar pulls k>k-1 angles into the same 2π window
 *  to take the shorter arc. */
function interpolateAffineLogPolar(x0: Affine6, x1: Affine6, c0: number, c1: number, _usePost: boolean): Affine6 {
  // zlm angle inheritance is per-keyframe and cross-column, so it must be
  // resolved at the xform level (interpolation.c:274-285) BEFORE the per-column
  // blend — a column that collapses to (0,0) at one keyframe has no meaningful
  // atan2 and must inherit the sibling column's angle so it rotates WITH the
  // xform rather than from angle 0. (#248)
  const p0 = polarColumns(x0);
  const p1 = polarColumns(x1);
  const col0Result = blendPolarColumn(p0.ang0, p0.mag0, p1.ang0, p1.mag0, c0, c1);
  const col1Result = blendPolarColumn(p0.ang1, p0.mag1, p1.ang1, p1.mag1, c0, c1);
  return {
    a: col0Result.x,
    d: col0Result.y,
    b: col1Result.x,
    e: col1Result.y,
    c: blend(x0.c, x1.c, c0, c1),
    f: blend(x0.f, x1.f, c0, c1),
  };
}

/** Convert one keyframe's affine to per-column polar (angle, magnitude) with
 *  zlm inheritance applied: a zero-length column (mag < EPS) borrows the
 *  sibling column's angle. col0 = (a, d), col1 = (b, e). interpolation.c:274-285. */
function polarColumns(aff: Affine6): { ang0: number; mag0: number; ang1: number; mag1: number } {
  const mag0 = Math.hypot(aff.a, aff.d);
  const mag1 = Math.hypot(aff.b, aff.e);
  let ang0 = Math.atan2(aff.d, aff.a);
  let ang1 = Math.atan2(aff.e, aff.b);
  const z0 = mag0 < EPS;
  const z1 = mag1 < EPS;
  if (z0 && !z1) ang0 = ang1;
  else if (z1 && !z0) ang1 = ang0;
  return { ang0, mag0, ang1, mag1 };
}

function blendPolarColumn(
  ang0In: number, mag0: number,
  ang1In: number, mag1: number,
  c0: number, c1: number,
): { x: number; y: number } {
  let ang0 = ang0In;
  let ang1 = ang1In;

  // Angle unwrap: pull ang1 into [ang0 - π, ang0 + π] so the blend takes the
  // shorter arc. flam3 interpolation.c:307-318 (the non-wind branch).
  const d = ang1 - ang0;
  if (d > Math.PI + EPS) ang1 -= 2 * Math.PI;
  else if (d < -(Math.PI - EPS)) ang1 += 2 * Math.PI;

  // Magnitude mode: log unless either keyframe is too tiny.
  const useLogMag = Math.log(mag0 + EPS) >= LOG_MAG_THRESHOLD &&
                    Math.log(mag1 + EPS) >= LOG_MAG_THRESHOLD;

  const ang = c0 * ang0 + c1 * ang1;
  const mag = useLogMag
    ? Math.exp(c0 * Math.log(mag0 + EPS) + c1 * Math.log(mag1 + EPS))
    : c0 * mag0 + c1 * mag1;

  return { x: mag * Math.cos(ang), y: mag * Math.sin(ang) };
}

// ───────────────────────────────────────────────────────────────────────────
// Variation interp — flam3 interpolation.c:543-655. flam3 stores all params
// flat on flam3_xform; pyr3 stores per-variation. Take the union of variation
// indices; for each, lerp the weights + every param (missing side = 0 / default).

function interpolateVariations(v0: Variation[], v1: Variation[], c0: number, c1: number): Variation[] {
  // Build index → variation maps for fast lookup.
  const m0 = new Map<VariationIndex, Variation>();
  const m1 = new Map<VariationIndex, Variation>();
  for (const v of v0) m0.set(v.index, v);
  for (const v of v1) m1.set(v.index, v);

  // Preserve k0's order for variations present in k0; append k1-only at end.
  const indices: VariationIndex[] = [];
  for (const v of v0) indices.push(v.index);
  for (const v of v1) if (!m0.has(v.index)) indices.push(v.index);

  const out: Variation[] = [];
  for (const idx of indices) {
    const a = m0.get(idx);
    const b = m1.get(idx);
    // active:false mirrors the packer (symmetry.ts) — an inactive variation has
    // effective weight 0 — so a deactivated variation stays off (no surprise
    // weight AND no dc_flag for DC variations) across a tween instead of
    // silently re-activating mid-animation (#260). Inactive on BOTH keyframes →
    // result stays flagged inactive; mixed off→on just ramps from 0.
    const aOff = a?.active === false;
    const bOff = b?.active === false;
    const weight = blend(aOff ? 0 : (a?.weight ?? 0), bOff ? 0 : (b?.weight ?? 0), c0, c1);
    const v: Variation = { index: idx, weight };
    if (aOff && bOff) v.active = false;
    // Lerp each param. Missing side uses 0 — same as flam3, which initializes
    // padded xforms with each variation's default params but then interpolates
    // toward them as if from 0 (PYR3 simplification: just use 0).
    for (const pk of PARAM_KEYS) {
      const pa = (a as Record<string, number | undefined> | undefined)?.[pk];
      const pb = (b as Record<string, number | undefined> | undefined)?.[pk];
      if (pa !== undefined || pb !== undefined) {
        const blended = blend(pa ?? 0, pb ?? 0, c0, c1);
        (v as unknown as Record<string, number>)[pk] = blended;
      }
    }
    out.push(v);
  }

  // pyr3 cap. We never produce > MAX_VARIATIONS_PER_XFORM variations even if
  // the union exceeds it (drop trailing — preserves k0's ordering preference).
  if (out.length > MAX_VARIATIONS_PER_XFORM) out.length = MAX_VARIATIONS_PER_XFORM;
  // Empty union → linear(1) fallback (parser invariant — never an empty chain).
  if (out.length === 0) out.push(linearVar(1));
  return out;
}

const PARAM_KEYS = [
  'param0', 'param1', 'param2', 'param3', 'param4',
  'param5', 'param6', 'param7', 'param8', 'param9',
] as const;

// ───────────────────────────────────────────────────────────────────────────
// xaos interp — per-cell linear, ≥0 clamp. Pyr3 stores `Xform.xaos: number[]`
// (per-source weight multipliers; flam3 chaos array is square N×N, but pyr3
// flattens per source-xform). Pad the shorter side with 1.0 (flam3 default).

function interpolateXaos(
  x0?: number[],
  x1?: number[],
  c0: number = 0,
  c1: number = 1,
): number[] | undefined {
  const n = Math.max(x0?.length ?? 0, x1?.length ?? 0);
  if (n === 0) return undefined;
  const out: number[] = [];
  let allOne = true;
  for (let i = 0; i < n; i++) {
    const a = x0?.[i] ?? 1;
    const b = x1?.[i] ?? 1;
    const v = clampGE0(blend(a, b, c0, c1));
    out.push(v);
    if (v !== 1) allOne = false;
  }
  // All-ones → undefined (identity xaos doesn't need to be stored).
  return allOne ? undefined : out;
}

// ───────────────────────────────────────────────────────────────────────────
// Palette interp — interpolation.c:149-462. Bake both keyframes to 256-entry
// LUTs, interp per index in HSV / RGB / hsv_circular space, return 256 stops.

function interpolatePalette(
  animation: Animation,
  k0: Genome,
  k1: Genome,
  c0: number,
  c1: number,
): Palette {
  const lut0 = bakeLUT(k0.palette.stops, k0.palette.hue ?? 0, k0.palette.mode ?? 'linear');
  const lut1 = bakeLUT(k1.palette.stops, k1.palette.hue ?? 0, k1.palette.mode ?? 'linear');

  const mode = animation.palette_interpolation;
  if (mode === 'sweep') {
    // Hard switch at the blend boundary — pick lut0 for i < 256*c0, else lut1.
    const stops: ColorStop[] = [];
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const src = i < PALETTE_SIZE * c0 ? lut0 : lut1;
      stops.push({
        t: i / (PALETTE_SIZE - 1),
        r: src[i * 4 + 0]!,
        g: src[i * 4 + 1]!,
        b: src[i * 4 + 2]!,
      });
    }
    return { name: k0.palette.name, stops };
  }

  // RGB / HSV / hsv_circular: blend in each space, then mix per hsv_rgb_palette_blend.
  // - RGB: rgb_fraction = 1, hsv path unused.
  // - HSV: rgb_fraction = 0.
  // - hsv_circular: rgb_fraction = animation.hsv_rgb_palette_blend (default 0).
  let rgbFraction = 0;
  if (mode === 'rgb') rgbFraction = 1;
  else if (mode === 'hsv_circular') rgbFraction = animation.hsv_rgb_palette_blend;
  // 'hsv' keeps rgbFraction = 0.

  const stops: ColorStop[] = [];
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const r0 = lut0[i * 4 + 0]!;
    const g0 = lut0[i * 4 + 1]!;
    const b0 = lut0[i * 4 + 2]!;
    const r1 = lut1[i * 4 + 0]!;
    const g1 = lut1[i * 4 + 1]!;
    const b1 = lut1[i * 4 + 2]!;

    // RGB-space blend.
    const rRgb = c0 * r0 + c1 * r1;
    const gRgb = c0 * g0 + c1 * g1;
    const bRgb = c0 * b0 + c1 * b1;

    // HSV-space blend.
    const hsv0 = rgb2hsvFlam3(r0, g0, b0);
    let hsv1 = rgb2hsvFlam3(r1, g1, b1);
    // hsv_circular: adjust hue0 by ±6 to take the shorter arc, matching
    // flam3's per-index correction at interpolation.c:399-413. Note: flam3
    // does this for THIS index relative to the OTHER index's hue.
    if (mode === 'hsv_circular') {
      const dh = hsv1.h - hsv0.h;
      if (dh > 3.0) hsv0.h += 6;
      else if (dh < -3.0) hsv0.h -= 6;
    }
    const hMix = c0 * hsv0.h + c1 * hsv1.h;
    const sMix = c0 * hsv0.s + c1 * hsv1.s;
    const vMix = c0 * hsv0.v + c1 * hsv1.v;
    const { r: rHsv, g: gHsv, b: bHsv } = hsv2rgbFlam3(hMix, sMix, vMix);

    const r = clamp01(rgbFraction * rRgb + (1 - rgbFraction) * rHsv);
    const g = clamp01(rgbFraction * gRgb + (1 - rgbFraction) * gHsv);
    const b = clamp01(rgbFraction * bRgb + (1 - rgbFraction) * bHsv);

    stops.push({ t: i / (PALETTE_SIZE - 1), r, g, b });
  }
  return { name: k0.palette.name, stops };
}

// flam3's rgb2hsv / hsv2rgb use a 0-6 hue range, not 0-360. Port that
// convention so the ±6 hue-circular shortcut matches.
function rgb2hsvFlam3(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max;
  const delta = max - min;
  let s = 0;
  let h = 0;
  if (max > 0) s = delta / max;
  if (delta > 0) {
    if (max === r) h = (g - b) / delta;
    else if (max === g) h = 2 + (b - r) / delta;
    else h = 4 + (r - g) / delta;
    if (h < 0) h += 6;
  }
  return { h, s, v };
}

function hsv2rgbFlam3(h: number, s: number, v: number): { r: number; g: number; b: number } {
  // Normalize hue back into [0, 6) for the standard piecewise mapping.
  let hh = h % 6;
  if (hh < 0) hh += 6;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  switch (i) {
    case 0: return { r: v, g: t, b: p };
    case 1: return { r: q, g: v, b: p };
    case 2: return { r: p, g: v, b: t };
    case 3: return { r: p, g: q, b: v };
    case 4: return { r: t, g: p, b: v };
    default: return { r: v, g: p, b: q }; // case 5
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Tonemap interp. Each pyr3 Tonemap is a fully-populated struct; flam3 INTERPs
// brightness / contrast / gamma / vibrancy / highlight_power / gamma_threshold
// linearly. Use FLAM3_PARTIAL_FILL defaults (matches flame-import) for the
// missing-keyframe side.

function interpolateTonemap(
  t0: Tonemap | undefined,
  t1: Tonemap | undefined,
  c0: number,
  c1: number,
): Tonemap {
  const FALLBACK: Tonemap = {
    gamma: 4.0, brightness: 4.0, vibrancy: 1.0,
    highlightPower: -1.0, gammaThreshold: 0.01,
  };
  const a = t0 ?? FALLBACK;
  const b = t1 ?? FALLBACK;
  return {
    gamma: blend(a.gamma, b.gamma, c0, c1),
    brightness: blend(a.brightness, b.brightness, c0, c1),
    vibrancy: blend(a.vibrancy, b.vibrancy, c0, c1),
    highlightPower: blend(a.highlightPower, b.highlightPower, c0, c1),
    gammaThreshold: blend(a.gammaThreshold, b.gammaThreshold, c0, c1),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Numeric helpers.

/** Linear blend with flam3's INTERP weighting: result = c0 * v0 + c1 * v1.
 *  When called via pickKeyframes, c0 + c1 === 1 within ULP. */
function blend(v0: number, v1: number, c0: number, c1: number): number {
  return c0 * v0 + c1 * v1;
}

/** True when both keyframes carry an optional field — INTERP it; otherwise
 *  carry whichever side has it forward. (#248) */
function both<T>(a: T | undefined, b: T | undefined): boolean {
  return a !== undefined && b !== undefined;
}

function clampGE0(x: number): number {
  return x < 0 ? 0 : x;
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** True iff `perm` is a bijection over [0, n) — length n, every index 0..n-1
 *  present exactly once. Absent or invalid ⇒ caller falls back to positional
 *  (identity) so a stale/garbage permutation degrades rather than corrupts. */
function isPermutation(perm: number[] | undefined, n: number): perm is number[] {
  if (!perm || perm.length !== n) return false;
  const seen = new Array<boolean>(n).fill(false);
  for (const v of perm) {
    if (!Number.isInteger(v) || v < 0 || v >= n || seen[v]) return false;
    seen[v] = true;
  }
  return true;
}
