// P2 of Animation milestone (#17 / #207). Port of flam3-C's
// `flam3_interpolate` (flam3.c:797-882) + `flam3_interpolate_n`
// (interpolation.c:373-720). Given an Animation and a target time `t`,
// derive a concrete Genome by 2-keyframe blend.
//
// Linear 2-keyframe blend is the default. #213 added three flam3-C parity
// refinements (Animation milestone #17):
//   - Catmull-Rom smooth interp (animation.interpolation === 'smooth' on an
//     interior segment) — a contained n=4 path (interpolateCatmullRom); the
//     2-keyframe linear path stays byte-identical.
//   - Asymmetric rotation wind refangles (establishWind) — fires when one
//     keyframe's xform has `animate=0` and the other animates; pins the
//     log-polar winding direction.
//   - 180°-rotated identity padding (makeIdentityXform) for the 7-variation
//     list (spherical / polar / julian / juliascope / ngon / wedge_sph /
//     wedge_julia) under log interp, to dodge black wedges when an xform
//     appears/disappears across keyframes.
// Stagger (P4) remains deferred. #225 added per-segment xform correspondence
// remapping (segmentPermutation); #224 added per-segment easing.
//
// flam3-C source map for callers cross-checking:
//   interpolation.c:31-54      motion_funcs              -> deferred to P3
//   interpolation.c:149-192    interpolate_cmap          -> interpolatePalette
//   interpolation.c:194-245    interp_and_convert_back   -> interpAndConvertBack
//   interpolation.c:247-324    convert_linear_to_polar   -> convertLinearToPolar
//   interpolation.c:373-720    flam3_interpolate_n       -> interpolate
//   flam3.c:797-882            flam3_interpolate         -> pickKeyframes + interpolate

import { type Animation, type InterpolationType } from './animation';
import { type Genome, type Xform, type ChannelCurves, type CurvePoint } from './genome';
import { IDENTITY_POINTS, evalCurve } from './channel-curves';
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
import { bakeSymmetryXforms } from './symmetry';

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

  const { i1, i2, c0: rawC0, c1: rawC1 } = pickKeyframes(keyframes, time);
  // #291 — bake each keyframe's rotational/dihedral symmetry into explicit
  // xforms BEFORE blending (flam3's flam3_add_symmetry order). The generated
  // rotation xforms then interpolate against the other keyframe's (weight-0)
  // alignment padding, so symmetry fades in/out WITH the morph and is identical
  // in either direction — instead of being copied from the first keyframe only,
  // which thinned a morph TO a symmetric flame to a near-empty mid-frame.
  const k0 = bakeSymmetryXforms(keyframes[i1]!);
  const k1 = bakeSymmetryXforms(keyframes[i2]!);

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

  // #213 Catmull-Rom smooth interp (flam3.c:832-877). Smooth is illegal on the
  // first/last segment (needs a keyframe on each side) → fall through to the
  // linear 2-keyframe path there, matching flam3's warn-and-revert. Otherwise
  // blend the 4 keyframes [i1-1, i1, i1+1, i1+2] with the cubic basis weights.
  // Easing (if present) composes as a time-warp on the cubic parameter `t`.
  if (animation.interpolation === 'smooth' && i1 !== 0 && i2 !== keyframes.length - 1) {
    const cmc = catmullRomWeights(c1);
    // #291 — bake symmetry before the 4-keyframe cubic blend, same as the
    // 2-keyframe path, so symmetry fades with the morph in either direction.
    const kfs = [
      keyframes[i1 - 1]!, keyframes[i1]!, keyframes[i1 + 1]!, keyframes[i1 + 2]!,
    ].map(bakeSymmetryXforms);
    return interpolateCatmullRom(kfs, cmc, animation, time, rawC1);
  }

  // Align xform counts — pad the shorter side with identity xforms so
  // both genomes have the same length (and same finalxform presence) before
  // interp. Plain identity for now (no special-case 180° rotation for
  // spherical/ngon/etc — deferred follow-up).
  const { aligned0, aligned1 } = alignXformCounts(k0, k1, animation.interpolation_type);

  // #225 xform correspondence remapping: reorder the SECOND keyframe's aligned
  // xforms by this segment's permutation before the index-aligned blend. perm is
  // defined over the ALIGNED length so it can target a padded (zero-weight) slot
  // for intentional appear/disappear. Absent/identity/invalid ⇒ positional
  // (b1 === aligned1) ⇒ byte-identical to today. finalxform is exempt (never in
  // the xforms[] array), matching flam3's final-xform exemption.
  // #412 — the pairing UI builds the permutation over the keyframe's ORIGINAL
  // (pre-symmetry-bake) xforms, but bakeSymmetryXforms above can grow the count,
  // so a short perm is extended with an identity tail to the aligned length (the
  // appended symmetry + alignment-pad slots pair positionally). A full-length
  // perm is used verbatim (can target a padded slot for intentional appear/
  // disappear). Anything invalid ⇒ undefined ⇒ positional.
  const perm = resolveSegmentPermutation(animation.segmentPermutation?.[i1], aligned1.xforms.length);
  const b1 = perm
    ? { ...aligned1, xforms: perm.map((j) => aligned1.xforms[j]!) }
    : aligned1;

  const useLog = animation.interpolation_type === 'log';

  // #213 asymmetric wind: only relevant for log-polar affine interp, and only
  // when an xform's animate flag differs across the (post-permutation) pair.
  // establishWind returns undefined per symmetric xform → no behavior change.
  const wind = useLog ? establishWind(aligned0, b1) : undefined;

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
    xforms.push(interpolateXform(xf0, xf1, c0, c1, useLog, wind?.[i]));
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

  // Tonemap: both undefined → undefined. Otherwise interp, filling a
  // missing-keyframe side with INTERP_TONEMAP_FALLBACK (the FLAM3_PARTIAL_FILL
  // defaults that flame-import would have stamped on it).
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
  // (interpolation.c:464-471): palette_mode.
  if (k0.paletteMode) out.paletteMode = k0.paletteMode;
  // #291 — symmetry is NOT carried here: it was baked into xforms before this
  // blend (see top of interpolate / interpolateCatmullRom), so k0.symmetry is
  // already undefined and the result genome stays unsymmetried-as-a-field.

  // #292 — post-tonemap color grading. UNLIKE the categorical carry-forward
  // above, grading FADES from/to identity when only one keyframe carries it, so
  // an HSL shift or color curve ramps in/out across the morph instead of
  // popping at the boundary. Same bug class as #291 (a structured field that
  // was silently dropped by interpolate()).
  const hsl = interpolateHslAdjust(k0.hslAdjust, k1.hslAdjust, c0, c1);
  if (hsl) out.hslAdjust = hsl;
  const curves = interpolateChannelCurves(k0.channelCurves, k1.channelCurves, c0, c1);
  if (curves) out.channelCurves = curves;

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

function alignXformCounts(
  k0: Genome,
  k1: Genome,
  interpolationType: InterpolationType,
): { aligned0: Genome; aligned1: Genome } {
  const n = Math.max(k0.xforms.length, k1.xforms.length);
  const useLog = interpolationType === 'log';

  // Quick path: same lengths + matching finalxform presence → no padding.
  if (
    k0.xforms.length === n &&
    k1.xforms.length === n &&
    !!k0.finalxform === !!k1.finalxform
  ) {
    return { aligned0: k0, aligned1: k1 };
  }

  // Pad the short side. For each padded slot j, peek at the OTHER (longer) side's
  // xform[j]: if it carries one of the spherical-family variations and interp is
  // log, use a 180°-rotated identity so the appearing/disappearing xform rotates
  // through the short arc instead of collapsing through a black wedge (#213,
  // flam3 interpolation.c:846-895).
  const padIfShort = (g: Genome, other: Genome): Genome => {
    let xforms = g.xforms;
    if (g.xforms.length < n) {
      const pads = Array.from({ length: n - g.xforms.length }, (_unused, k) => {
        const j = g.xforms.length + k;
        // flam3 checks ANY variation slot with positive weight (interpolation.c
        // :877-883), not just the first — scan for a listed-family member.
        const hint = other.xforms[j]?.variations.find(
          (v) => FLIPPED_IDENTITY_VARS.has(v.index) && v.active !== false,
        )?.index;
        return makeIdentityXform(hint, useLog);
      });
      xforms = g.xforms.concat(pads);
    }
    let finalxform = g.finalxform;
    if (!finalxform && (k0.finalxform || k1.finalxform)) {
      finalxform = makeIdentityXform();   // final-xform pad stays plain identity
    }
    return finalxform ? { ...g, xforms, finalxform } : { ...g, xforms };
  };

  return { aligned0: padIfShort(k0, k1), aligned1: padIfShort(k1, k0) };
}

/** pyr3 variation indices whose padded identity should be 180°-rotated under log
 *  interp (flam3's spherical-family black-wedge dodge, interpolation.c:868-880):
 *  spherical, polar, julian, juliascope, ngon, wedge_sph, wedge_julia. */
const FLIPPED_IDENTITY_VARS = new Set<VariationIndex>([2, 5, 14, 39, 48, 89, 96]);

function makeIdentityXform(variationHint?: VariationIndex, useLog?: boolean): Xform {
  // Flipped (180°-rotated) identity when the companion xform carries a
  // spherical-family variation AND interp is log; plain identity otherwise.
  const flip = useLog === true
    && variationHint !== undefined
    && FLIPPED_IDENTITY_VARS.has(variationHint);
  return {
    a: flip ? -1 : 1, b: 0, c: 0,
    d: 0, e: flip ? -1 : 1, f: 0,
    weight: 0,                         // zero weight: pad never participates in chaos pick
    color: 0,
    colorSpeed: 0.5,                   // flam3 parser default
    variations: [linearVar(flip ? -1 : 1)],
  };
}

/** #213 asymmetric rotation refangles (flam3 establish_asymmetric_refangles,
 *  interpolation.c:710-766). When one keyframe's xform is stationary
 *  (animate===0) and the other animates, derive a per-column reference angle
 *  that pins the rotation winding direction so the log-polar blend doesn't snap
 *  the long arc through 180°. Returns per-xform `[windCol0, windCol1]` (or
 *  undefined when that xform is symmetric → standard ±π unwrap). Final xform is
 *  excluded (callers pass only the xforms[] pairs). flam3's `padsymflag` is
 *  hardwired 0, so the trigger reduces to an animate-flag mismatch (absent
 *  animate ⇒ 1 ⇒ animated). Pass the two genomes actually being blended (after
 *  any #225 permutation) so the angles match the realized pairing. */
function establishWind(g0: Genome, g1: Genome): ([number, number] | undefined)[] {
  const n = Math.min(g0.xforms.length, g1.xforms.length);
  const out: ([number, number] | undefined)[] = [];
  for (let i = 0; i < n; i++) {
    const xf0 = g0.xforms[i]!;
    const xf1 = g1.xforms[i]!;
    const sym0 = xf0.animate === 0;
    const sym1 = xf1.animate === 0;
    if (sym0 === sym1) { out.push(undefined); continue; }   // symmetric → no wind
    const w: [number, number] = [0, 0];
    for (let col = 0; col < 2; col++) {
      const a0 = col === 0 ? Math.atan2(xf0.d, xf0.a) : Math.atan2(xf0.e, xf0.b);
      let a1 = col === 0 ? Math.atan2(xf1.d, xf1.a) : Math.atan2(xf1.e, xf1.b);
      // flam3 pre-adjusts a1 into the ±π window before deriving the reference.
      const d = a1 - a0;
      if (d > Math.PI + EPS) a1 -= 2 * Math.PI;
      else if (d < -(Math.PI - EPS)) a1 += 2 * Math.PI;
      // Reference angle (+2π so the value is >0, flagging "wind active"). sym1 ⇒
      // k1 is stationary ⇒ reference is k0's angle (a0); sym0 ⇒ k0 is stationary
      // ⇒ reference is k1's angle (a1). (flam3 interpolation.c:758-759.)
      w[col] = (sym1 ? a0 : a1) + 2 * Math.PI;
    }
    out.push(w);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Per-xform interp — interpolation.c:512-660. Linear fields are trivial;
// affine takes the log-polar path when interpolation_type === 'log'.

function interpolateXform(
  x0: Xform, x1: Xform, c0: number, c1: number, useLog: boolean,
  wind?: [number, number],
): Xform {
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
    ? interpolateAffineLogPolar(x0, x1, c0, c1, /* usePost */ false, wind)
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
function interpolateAffineLogPolar(
  x0: Affine6, x1: Affine6, c0: number, c1: number, _usePost: boolean,
  wind?: [number, number],
): Affine6 {
  // zlm angle inheritance is per-keyframe and cross-column, so it must be
  // resolved at the xform level (interpolation.c:274-285) BEFORE the per-column
  // blend — a column that collapses to (0,0) at one keyframe has no meaningful
  // atan2 and must inherit the sibling column's angle so it rotates WITH the
  // xform rather than from angle 0. (#248)
  const p0 = polarColumns(x0);
  const p1 = polarColumns(x1);
  const col0Result = blendPolarColumn(p0.ang0, p0.mag0, p1.ang0, p1.mag0, c0, c1, wind?.[0]);
  const col1Result = blendPolarColumn(p0.ang1, p0.mag1, p1.ang1, p1.mag1, c0, c1, wind?.[1]);
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
  wind?: number,
): { x: number; y: number } {
  let ang0 = ang0In;
  let ang1 = ang1In;

  if (wind !== undefined && wind > 0) {
    // #213 asymmetric wind branch (flam3 interpolation.c:293-309). When one
    // keyframe's xform is stationary (animate=0) and the other animates, the
    // rotation winding direction is pinned by a reference angle so the blend
    // doesn't snap the long arc through 180°. Bring both angles into the 2π
    // window [refang, refang + 2π].
    const refang = wind - 2 * Math.PI;
    while (ang0 < refang) ang0 += 2 * Math.PI;
    while (ang0 > refang + 2 * Math.PI) ang0 -= 2 * Math.PI;
    while (ang1 < refang) ang1 += 2 * Math.PI;
    while (ang1 > refang + 2 * Math.PI) ang1 -= 2 * Math.PI;
  } else {
    // Angle unwrap: pull ang1 into [ang0 - π, ang0 + π] so the blend takes the
    // shorter arc. flam3 interpolation.c:307-318 (the non-wind branch).
    const d = ang1 - ang0;
    if (d > Math.PI + EPS) ang1 -= 2 * Math.PI;
    else if (d < -(Math.PI - EPS)) ang1 += 2 * Math.PI;
  }

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

// #314 — shared fallback for the missing-keyframe side of a tonemap interp.
// These are the FLAM3_PARTIAL_FILL defaults (gamma/brightness 4.0), matching
// what flame-import stamps when a keyframe omits tonemap — NOT the standalone
// DEFAULT_TONEMAP (2.4/1.0). In practice every imported flame carries a full
// tonemap, so this fallback only affects hand-built genomes; hoisted here so the
// 2-keyframe and N-keyframe paths can never drift.
const INTERP_TONEMAP_FALLBACK: Tonemap = {
  gamma: 4.0, brightness: 4.0, vibrancy: 1.0,
  highlightPower: -1.0, gammaThreshold: 0.01,
};

function interpolateTonemap(
  t0: Tonemap | undefined,
  t1: Tonemap | undefined,
  c0: number,
  c1: number,
): Tonemap {
  const a = t0 ?? INTERP_TONEMAP_FALLBACK;
  const b = t1 ?? INTERP_TONEMAP_FALLBACK;
  return {
    gamma: blend(a.gamma, b.gamma, c0, c1),
    brightness: blend(a.brightness, b.brightness, c0, c1),
    vibrancy: blend(a.vibrancy, b.vibrancy, c0, c1),
    highlightPower: blend(a.highlightPower, b.highlightPower, c0, c1),
    gammaThreshold: blend(a.gammaThreshold, b.gammaThreshold, c0, c1),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// #292 Color grading interp — post-tonemap HSL adjust + channel curves. Both
// FADE from/to identity when only one keyframe carries them (NOT carry-forward
// like the categorical fields), so the grade ramps across the morph. The render
// path treats the identity values ({hue:0,sat:100,light:0} / the straight 0→1
// curve) as no-ops, so this is a true cross-fade.

/** flam3 has no HSL-adjust; identity = no change (hue 0°, sat 100%, light 0%). */
const IDENTITY_HSL_ADJUST = { hue: 0, sat: 100, light: 0 } as const;
type HslAdjust = { hue: number; sat: number; light: number };

function interpolateHslAdjust(
  a: HslAdjust | undefined, b: HslAdjust | undefined, c0: number, c1: number,
): HslAdjust | undefined {
  if (!a && !b) return undefined;
  const x = a ?? IDENTITY_HSL_ADJUST;
  const y = b ?? IDENTITY_HSL_ADJUST;
  return {
    hue: blendHueShortArc([x.hue, y.hue], [c0, c1]),
    sat: blend(x.sat, y.sat, c0, c1),
    light: blend(x.light, y.light, c0, c1),
  };
}

function interpolateHslAdjustN(
  adjs: (HslAdjust | undefined)[], cmc: number[],
): HslAdjust | undefined {
  if (adjs.every((a) => !a)) return undefined;
  const filled = adjs.map((a) => a ?? IDENTITY_HSL_ADJUST);
  return {
    hue: blendHueShortArc(filled.map((a) => a.hue), cmc),
    sat: blendN(filled.map((a) => a.sat), cmc),
    light: blendN(filled.map((a) => a.light), cmc),
  };
}

/** Weighted blend of hues (degrees) on the shorter arc. Sequentially unwraps
 *  each hue into the prior one's ±180 window (same trick as the affine angle
 *  unwrap) so the blend never sweeps the long way around the wheel, then
 *  normalizes the result back into [−180, 180) (an exact 180 maps to −180 — the
 *  same angle, so the boundary choice is cosmetic). */
function blendHueShortArc(hues: number[], weights: number[]): number {
  const h = hues.slice();
  for (let k = 1; k < h.length; k++) {
    const d = h[k]! - h[k - 1]!;
    if (d > 180) h[k] = h[k]! - 360;
    else if (d < -180) h[k] = h[k]! + 360;
  }
  const blended = blendN(h, weights);
  return ((blended + 180) % 360 + 360) % 360 - 180;
}

const CURVE_CHANNELS = ['composite', 'r', 'g', 'b', 'luma'] as const;
/** Max control points per channel curve — mirrors MAX_POINTS in channel-curves.ts. */
const MAX_CURVE_POINTS = 8;

function identityCurves(): ChannelCurves {
  return {
    composite: IDENTITY_POINTS, r: IDENTITY_POINTS, g: IDENTITY_POINTS,
    b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
  };
}

function interpolateChannelCurves(
  a: ChannelCurves | undefined, b: ChannelCurves | undefined, c0: number, c1: number,
): ChannelCurves | undefined {
  if (!a && !b) return undefined;
  const x = a ?? identityCurves();
  const y = b ?? identityCurves();
  const out = {} as ChannelCurves;
  for (const ch of CURVE_CHANNELS) out[ch] = blendCurve([x[ch], y[ch]], [c0, c1]);
  return out;
}

function interpolateChannelCurvesN(
  curves: (ChannelCurves | undefined)[], cmc: number[],
): ChannelCurves | undefined {
  if (curves.every((c) => !c)) return undefined;
  const filled = curves.map((c) => c ?? identityCurves());
  const out = {} as ChannelCurves;
  for (const ch of CURVE_CHANNELS) out[ch] = blendCurve(filled.map((c) => c[ch]), cmc);
  return out;
}

/** Blend N channel curves into one. Each curve defines y=f(x) over [0,1]; the
 *  blend is the weighted sum of those functions, sampled at the UNION of the
 *  inputs' control x's (deduped, capped at MAX_CURVE_POINTS). Exact when the
 *  inputs share x positions (Catmull-Rom is linear in the control y's at fixed
 *  x); a smooth approximation otherwise. */
function blendCurve(points: CurvePoint[][], weights: number[]): CurvePoint[] {
  const EPS_X = 1e-6;
  const sorted = points.flat().map((p) => p.x).sort((p, q) => p - q);
  const xs: number[] = [];
  for (const x of sorted) {
    if (xs.length === 0 || x - xs[xs.length - 1]! > EPS_X) xs.push(x);
  }
  const sampleXs = xs.length <= MAX_CURVE_POINTS ? xs : downsampleKeepingEnds(xs, MAX_CURVE_POINTS);
  return sampleXs.map((x) => ({
    x,
    y: clamp01(blendN(points.map((p) => evalCurve(p, x)), weights)),
  }));
}

/** Pick `k` x-values evenly across `xs`, always keeping the two endpoints. Used
 *  only when two curves' combined distinct x's exceed the 8-point cap (rare). */
function downsampleKeepingEnds(xs: number[], k: number): number[] {
  const n = xs.length;
  const out: number[] = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.round((i * (n - 1)) / (k - 1));
    const x = xs[idx]!;
    if (out.length === 0 || x !== out[out.length - 1]) out.push(x);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// #213 Catmull-Rom smooth interp — the only N-keyframe (n=4) blend path. The
// 2-keyframe linear path above stays untouched / byte-identical; this contained
// path mirrors flam3's flam3_interpolate_n(result, 4, cpi, cmc) (the smooth
// branch of flam3.c:832-877 + interpolation.c:326-337). Wind (#213 part 2) is a
// 2-keyframe concern and is NOT applied here — flam3's smooth path uses the
// standard unwrap. hsv_circular / sweep palette blends use a dominant-keyframe
// simplification (documented inline) since the exact N-keyframe palette edge is
// vanishingly rare (smooth needs ≥4 keyframes).

/** Catmull-Rom cubic basis weights for the 4 keyframes [i1-1, i1, i1+1, i1+2]
 *  at segment position t∈[0,1] (interpolation.c:326-337). Sums to 1 for all t;
 *  at t=0 ⇒ [0,1,0,0] (passes through keyframes[i1]), at t=1 ⇒ [0,0,1,0]
 *  (passes through keyframes[i1+1]). */
export function catmullRomWeights(t: number): [number, number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    (2 * t2 - t - t3) / 2,
    (3 * t3 - 5 * t2 + 2) / 2,
    (4 * t2 - 3 * t3 + t) / 2,
    (t3 - t2) / 2,
  ];
}

/** Σ weights[k]·values[k] — the N-keyframe generalization of `blend`. */
function blendN(values: number[], weights: number[]): number {
  let s = 0;
  for (let k = 0; k < values.length; k++) s += weights[k]! * values[k]!;
  return s;
}

function interpolateCatmullRom(
  kfs: Genome[],
  cmc: number[],
  animation: Animation,
  time: number,
  rawC1: number,
): Genome {
  const useLog = animation.interpolation_type === 'log';
  const aligned = alignXformCountsN(kfs, animation.interpolation_type);
  const n = aligned[0]!.xforms.length;

  // Per-xform N-keyframe blend (motion overlay applied per keyframe on the RAW
  // segment clock, before the cmc blend — matches the 2-keyframe path).
  const xforms: Xform[] = [];
  for (let i = 0; i < n; i++) {
    const xfs = aligned.map((g) => applyMotionParameters(g.xforms[i]!, rawC1));
    xforms.push(interpolateXformN(xfs, cmc, useLog));
  }

  let finalxform: Xform | undefined;
  if (aligned.every((g) => g.finalxform)) {
    finalxform = interpolateXformN(aligned.map((g) => g.finalxform!), cmc, useLog);
  }

  const out: Genome = {
    name: kfs[1]!.name,
    xforms,
    scale: blendN(kfs.map((k) => k.scale), cmc),
    cx: blendN(kfs.map((k) => k.cx), cmc),
    cy: blendN(kfs.map((k) => k.cy), cmc),
    palette: interpolatePaletteN(animation, kfs, cmc),
    time,
  };
  if (kfs[1]!.nick !== undefined) out.nick = kfs[1]!.nick;
  if (finalxform) out.finalxform = finalxform;

  if (kfs.some((k) => k.tonemap)) {
    out.tonemap = interpolateTonemapN(kfs.map((k) => k.tonemap), cmc);
  }

  const rots = kfs.map((k) => k.rotate ?? 0);
  if (rots.some((r) => r !== 0)) {
    const r = blendN(rots, cmc);
    if (r !== 0) out.rotate = r;
  }

  // Continuous fields: blend when ALL keyframes carry the field, else carry the
  // first present (generalizes the 2-keyframe both()/carry-forward rule).
  const allHave = <T>(get: (k: Genome) => T | undefined): boolean => kfs.every((k) => get(k) !== undefined);
  const firstPresent = <T>(get: (k: Genome) => T | undefined): T | undefined => {
    for (const k of kfs) { const v = get(k); if (v !== undefined) return v; }
    return undefined;
  };

  if (allHave((k) => k.quality)) out.quality = blendN(kfs.map((k) => k.quality!), cmc);
  else out.quality = firstPresent((k) => k.quality);

  if (allHave((k) => k.density)) {
    out.density = {
      maxRad: blendN(kfs.map((k) => k.density!.maxRad), cmc),
      minRad: blendN(kfs.map((k) => k.density!.minRad), cmc),
      curve: blendN(kfs.map((k) => k.density!.curve), cmc),
    };
  } else out.density = firstPresent((k) => k.density);

  if (allHave((k) => k.spatialFilter)) {
    out.spatialFilter = {
      radius: blendN(kfs.map((k) => k.spatialFilter!.radius), cmc),
      shape: kfs[1]!.spatialFilter!.shape,
    };
  } else out.spatialFilter = firstPresent((k) => k.spatialFilter);

  if (allHave((k) => k.background)) {
    out.background = [
      blendN(kfs.map((k) => k.background![0]), cmc),
      blendN(kfs.map((k) => k.background![1]), cmc),
      blendN(kfs.map((k) => k.background![2]), cmc),
    ];
  } else out.background = firstPresent((k) => k.background);

  if (allHave((k) => k.size)) {
    out.size = {
      width: Math.round(blendN(kfs.map((k) => k.size!.width), cmc)),
      height: Math.round(blendN(kfs.map((k) => k.size!.height), cmc)),
    };
  } else out.size = firstPresent((k) => k.size);

  if (allHave((k) => k.oversample)) out.oversample = Math.round(blendN(kfs.map((k) => k.oversample!), cmc));
  else out.oversample = firstPresent((k) => k.oversample);

  // Categorical fields — carry from the dominant inner keyframe (kfs[1] = i1).
  if (kfs[1]!.paletteMode) out.paletteMode = kfs[1]!.paletteMode;
  // #291 — symmetry baked into xforms before this blend (callers pass
  // symmetry-baked kfs), so it is not carried as a field here.

  // #292 — color grading, N-keyframe generalization of the 2-keyframe blend.
  // Same fade-from-identity rule (absent side = identity), so grading ramps
  // across a smooth multi-keyframe morph instead of popping.
  const hsl = interpolateHslAdjustN(kfs.map((k) => k.hslAdjust), cmc);
  if (hsl) out.hslAdjust = hsl;
  const curves = interpolateChannelCurvesN(kfs.map((k) => k.channelCurves), cmc);
  if (curves) out.channelCurves = curves;

  return out;
}

/** N-keyframe xform-count alignment. Pads every keyframe to the max xform count
 *  (and to finalxform presence if any has one), reusing the spherical-family
 *  flipped-identity hint (#213 part 3); the hint is the first keyframe whose
 *  xform[j] carries a listed variation. */
function alignXformCountsN(kfs: Genome[], interpolationType: InterpolationType): Genome[] {
  const n = Math.max(...kfs.map((k) => k.xforms.length));
  const anyFinal = kfs.some((k) => k.finalxform);
  const useLog = interpolationType === 'log';
  const hintFor = (j: number): VariationIndex | undefined => {
    for (const k of kfs) {
      // Scan all variation slots (flam3 interpolation.c:877-883), not just [0].
      const v = k.xforms[j]?.variations.find(
        (vv) => FLIPPED_IDENTITY_VARS.has(vv.index) && vv.active !== false,
      );
      if (v !== undefined) return v.index;
    }
    return undefined;
  };
  return kfs.map((g) => {
    let xforms = g.xforms;
    if (g.xforms.length < n) {
      const pads = Array.from({ length: n - g.xforms.length }, (_unused, k) =>
        makeIdentityXform(hintFor(g.xforms.length + k), useLog));
      xforms = g.xforms.concat(pads);
    }
    let finalxform = g.finalxform;
    if (!finalxform && anyFinal) finalxform = makeIdentityXform();
    return finalxform ? { ...g, xforms, finalxform } : { ...g, xforms };
  });
}

function interpolateXformN(xfs: Xform[], cmc: number[], useLog: boolean): Xform {
  const eff = (x: Xform) => (x.active === false ? 0 : x.weight);
  const density = clampGE0(blendN(xfs.map(eff), cmc));
  const color = clamp01(blendN(xfs.map((x) => x.color), cmc));
  const colorSpeed = clamp01(blendN(xfs.map((x) => x.colorSpeed), cmc));
  const opacity = blendN(xfs.map((x) => x.opacity ?? 1), cmc);

  const aff = useLog ? interpolateAffineLogPolarN(xfs, cmc) : interpolateAffineLinearN(xfs, cmc);

  let post: Affine6 | undefined;
  if (xfs.some((x) => x.post)) {
    const allId = xfs.every((x) => !x.post || isIdentityAffine(x.post));
    if (!allId) {
      const posts = xfs.map((x) => x.post ?? IDENTITY_AFFINE);
      const interp = useLog ? interpolateAffineLogPolarN(posts, cmc) : interpolateAffineLinearN(posts, cmc);
      if (!isIdentityAffine(interp)) post = interp;
    }
  }

  const variations = interpolateVariationsN(xfs.map((x) => x.variations), cmc);

  const out: Xform = {
    a: aff.a, b: aff.b, c: aff.c, d: aff.d, e: aff.e, f: aff.f,
    weight: density, color, colorSpeed, variations,
  };
  if (opacity !== 1.0) out.opacity = opacity;
  if (post) out.post = post;
  if (xfs.every((x) => x.active === false)) out.active = false;
  if (xfs.some((x) => x.xaos)) {
    const xaos = interpolateXaosN(xfs.map((x) => x.xaos), cmc);
    if (xaos) out.xaos = xaos;
  }
  return out;
}

function interpolateAffineLinearN(affs: Affine6[], cmc: number[]): Affine6 {
  return {
    a: blendN(affs.map((x) => x.a), cmc),
    b: blendN(affs.map((x) => x.b), cmc),
    c: blendN(affs.map((x) => x.c), cmc),
    d: blendN(affs.map((x) => x.d), cmc),
    e: blendN(affs.map((x) => x.e), cmc),
    f: blendN(affs.map((x) => x.f), cmc),
  };
}

function interpolateAffineLogPolarN(affs: Affine6[], cmc: number[]): Affine6 {
  const cols = affs.map((a) => polarColumns(a));
  const col0 = blendPolarColumnN(cols.map((c) => c.ang0), cols.map((c) => c.mag0), cmc);
  const col1 = blendPolarColumnN(cols.map((c) => c.ang1), cols.map((c) => c.mag1), cmc);
  return {
    a: col0.x, d: col0.y,
    b: col1.x, e: col1.y,
    c: blendN(affs.map((a) => a.c), cmc),
    f: blendN(affs.map((a) => a.f), cmc),
  };
}

function blendPolarColumnN(angsIn: number[], mags: number[], cmc: number[]): { x: number; y: number } {
  const angs = angsIn.slice();
  // Sequential ±π unwrap: pull each angle into the prior keyframe's window.
  for (let k = 1; k < angs.length; k++) {
    const d = angs[k]! - angs[k - 1]!;
    if (d > Math.PI + EPS) angs[k] = angs[k]! - 2 * Math.PI;
    else if (d < -(Math.PI - EPS)) angs[k] = angs[k]! + 2 * Math.PI;
  }
  const useLogMag = mags.every((m) => Math.log(m + EPS) >= LOG_MAG_THRESHOLD);
  const ang = blendN(angs, cmc);
  const mag = useLogMag
    ? Math.exp(blendN(mags.map((m) => Math.log(m + EPS)), cmc))
    : blendN(mags, cmc);
  return { x: mag * Math.cos(ang), y: mag * Math.sin(ang) };
}

function interpolateVariationsN(vss: Variation[][], cmc: number[]): Variation[] {
  const maps = vss.map((vs) => {
    const m = new Map<VariationIndex, Variation>();
    for (const v of vs) m.set(v.index, v);
    return m;
  });
  const indices: VariationIndex[] = [];
  const seen = new Set<VariationIndex>();
  for (const vs of vss) for (const v of vs) if (!seen.has(v.index)) { seen.add(v.index); indices.push(v.index); }

  const out: Variation[] = [];
  for (const idx of indices) {
    const weights = maps.map((m) => {
      const v = m.get(idx);
      return v?.active === false ? 0 : (v?.weight ?? 0);
    });
    const v: Variation = { index: idx, weight: blendN(weights, cmc) };
    if (maps.every((m) => m.get(idx)?.active === false)) v.active = false;
    for (const pk of PARAM_KEYS) {
      const present = maps.some((m) => (m.get(idx) as Record<string, number | undefined> | undefined)?.[pk] !== undefined);
      if (present) {
        const vals = maps.map((m) => (m.get(idx) as Record<string, number | undefined> | undefined)?.[pk] ?? 0);
        (v as unknown as Record<string, number>)[pk] = blendN(vals, cmc);
      }
    }
    out.push(v);
  }
  if (out.length > MAX_VARIATIONS_PER_XFORM) out.length = MAX_VARIATIONS_PER_XFORM;
  if (out.length === 0) out.push(linearVar(1));
  return out;
}

function interpolateXaosN(xss: (number[] | undefined)[], cmc: number[]): number[] | undefined {
  const n = Math.max(...xss.map((x) => x?.length ?? 0));
  if (n === 0) return undefined;
  const out: number[] = [];
  let allOne = true;
  for (let i = 0; i < n; i++) {
    const v = clampGE0(blendN(xss.map((x) => x?.[i] ?? 1), cmc));
    out.push(v);
    if (v !== 1) allOne = false;
  }
  return allOne ? undefined : out;
}

function interpolatePaletteN(animation: Animation, kfs: Genome[], cmc: number[]): Palette {
  const luts = kfs.map((k) => bakeLUT(k.palette.stops, k.palette.hue ?? 0, k.palette.mode ?? 'linear'));
  const mode = animation.palette_interpolation;
  const name = kfs[1]!.palette.name;

  // Dominant keyframe = argmax(cmc) — used for sweep selection + hsv-circular ref.
  let dom = 0;
  for (let k = 1; k < cmc.length; k++) if (cmc[k]! > cmc[dom]!) dom = k;

  if (mode === 'sweep') {
    // N-keyframe simplification: hard-pick the dominant keyframe's LUT.
    const lut = luts[dom]!;
    const stops: ColorStop[] = [];
    for (let i = 0; i < PALETTE_SIZE; i++) {
      stops.push({ t: i / (PALETTE_SIZE - 1), r: lut[i * 4]!, g: lut[i * 4 + 1]!, b: lut[i * 4 + 2]! });
    }
    return { name, stops };
  }

  let rgbFraction = 0;
  if (mode === 'rgb') rgbFraction = 1;
  else if (mode === 'hsv_circular') rgbFraction = animation.hsv_rgb_palette_blend;

  const stops: ColorStop[] = [];
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const rs = luts.map((l) => l[i * 4]!);
    const gs = luts.map((l) => l[i * 4 + 1]!);
    const bs = luts.map((l) => l[i * 4 + 2]!);
    const rRgb = blendN(rs, cmc);
    const gRgb = blendN(gs, cmc);
    const bRgb = blendN(bs, cmc);

    const hsvs = rs.map((_r, k) => rgb2hsvFlam3(rs[k]!, gs[k]!, bs[k]!));
    if (mode === 'hsv_circular') {
      // Generalized ±6 shortcut: pull each hue to the shorter arc vs the
      // dominant keyframe's hue (the 2-keyframe per-index correction, N-ized).
      const domH = hsvs[dom]!.h;
      for (const h of hsvs) {
        const dh = h.h - domH;
        if (dh > 3.0) h.h -= 6;
        else if (dh < -3.0) h.h += 6;
      }
    }
    const { r: rHsv, g: gHsv, b: bHsv } = hsv2rgbFlam3(
      blendN(hsvs.map((h) => h.h), cmc),
      blendN(hsvs.map((h) => h.s), cmc),
      blendN(hsvs.map((h) => h.v), cmc),
    );

    stops.push({
      t: i / (PALETTE_SIZE - 1),
      r: clamp01(rgbFraction * rRgb + (1 - rgbFraction) * rHsv),
      g: clamp01(rgbFraction * gRgb + (1 - rgbFraction) * gHsv),
      b: clamp01(rgbFraction * bRgb + (1 - rgbFraction) * bHsv),
    });
  }
  return { name, stops };
}

function interpolateTonemapN(ts: (Tonemap | undefined)[], cmc: number[]): Tonemap {
  const a = ts.map((t) => t ?? INTERP_TONEMAP_FALLBACK);
  return {
    gamma: blendN(a.map((t) => t.gamma), cmc),
    brightness: blendN(a.map((t) => t.brightness), cmc),
    vibrancy: blendN(a.map((t) => t.vibrancy), cmc),
    highlightPower: blendN(a.map((t) => t.highlightPower), cmc),
    gammaThreshold: blendN(a.map((t) => t.gammaThreshold), cmc),
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

/** #412 — resolve a UI-supplied xform-correspondence permutation to the
 *  symmetry-baked / alignment-padded `n`. The pairing widget builds the perm
 *  over the keyframe's ORIGINAL xforms, but `bakeSymmetryXforms` (#291) can grow
 *  the count before the blend — so a SHORTER valid permutation is extended with
 *  an identity tail (the appended symmetry + pad slots pair positionally). A
 *  full-length valid permutation is returned verbatim (it may target a padded
 *  slot for intentional appear/disappear, #225). Anything else ⇒ undefined ⇒
 *  the caller blends positionally. */
function resolveSegmentPermutation(perm: number[] | undefined, n: number): number[] | undefined {
  if (!perm || perm.length === 0) return undefined;
  if (perm.length === n) return isPermutation(perm, n) ? perm : undefined;
  if (perm.length < n && isPermutation(perm, perm.length)) {
    const out = perm.slice();
    for (let j = perm.length; j < n; j++) out.push(j);
    return out;
  }
  return undefined;
}
