// P3 of Animation milestone (#17 / #208). Port of flam3-C's per-xform motion
// overlay: `motion_funcs` (interpolation.c:31-54) and `apply_motion_parameters`
// (flam3.c:641-792).
//
// Semantics: each xform can carry a `motion[]` array of "delta xforms" — each
// motion element has its own `motion_freq` (integer cycle count) and
// `motion_func` (sin/triangle/hill), plus a subset of xform fields whose
// values become additive contributions modulated by motion_funcs(func, freq*blend).
//
// Integration with P2 interp: BEFORE the linear 2-keyframe blend (interpolate.ts),
// each source keyframe's xform is pre-modified by its own motion[] using the
// current blend as the time clock. The pre-modified xforms then feed the
// standard P2 interp. This matches flam3-C's "sheep_edge" pattern
// (flam3.c:533-541), which is the cleaner of the two motion-application
// patterns in the reference impl — semantically: "each keyframe varies with
// time t before getting blended."

import { type Xform } from './genome';
import { type Variation, type VariationIndex } from './variations';

const TWO_PI = 2 * Math.PI;

/** flam3 motion_func enum codes. 0 = none (handled separately). */
export type MotionFuncCode = 1 | 2 | 3;

/** flam3 motion_funcs: cyclic, equal to 0 at integer t, peak amplitude ≤ 1.
 *  interpolation.c:31-54. */
export function motionFuncs(funcnum: MotionFuncCode, t: number): number {
  if (funcnum === 1) {
    // MOTION_SIN — sin(2π t), period 1, range [-1, +1]
    return Math.sin(TWO_PI * t);
  }
  if (funcnum === 2) {
    // MOTION_TRIANGLE — piecewise linear, period 1, range [-1, +1].
    // Peaks at t = 0.25 (+1) and t = 0.75 (-1), zero-crossings at t = 0, 0.5.
    let fr = t % 1;
    if (fr < 0) fr += 1;
    if (fr <= 0.25) return 4.0 * fr;
    if (fr <= 0.75) return -4.0 * fr + 2.0;
    return 4.0 * fr - 4.0;
  }
  // MOTION_HILL — (1 - cos(2π t)) / 2, period 1, range [0, 1], peak at t = 0.5.
  return (1 - Math.cos(TWO_PI * t)) * 0.5;
}

/** Apply this xform's motion[] overlay at the given blend time. Returns a
 *  NEW xform with motion contributions ADDED to each animatable field;
 *  pure function (does not mutate the input).
 *
 *  `blend` is the in-window time in [0, 1] for the current 2-keyframe pair
 *  (matches the c1 weight from interpolate.ts pickKeyframes). For each
 *  motion element m, the effective time clock is `m.motion_freq * blend`,
 *  passed to `motionFuncs(m.motion_func, ...)`.
 *
 *  Pyr3 differences from flam3-C apply_motion_parameters:
 *  - Variation params (60+ flat fields in flam3) live on `Variation` objects
 *    in pyr3. Motion contributions to params apply per-variation, matched by
 *    `index`. Missing-on-one-side semantics: motion contribution on a
 *    variation absent from the base xform is dropped (no synthetic variation
 *    creation here — that's P2's union-and-blend job).
 *  - flam3's `animate` field is the per-xform rotation flag (default 1); pyr3
 *    stores it as `Xform.animate?: number`. Motion contributes to it directly.
 *  - Per-variation `var[j]` weights in flam3 = per-Variation.weight in pyr3.
 *  - No-op when xform.motion is undefined or empty. */
export function applyMotionParameters(xform: Xform, blend: number): Xform {
  const elements = xform.motion;
  if (!elements || elements.length === 0) return xform;

  // Pull the base xform's mutable fields. Start with a shallow clone of all
  // numeric scalars (other fields like `variations` are handled separately).
  const out: Xform = {
    ...xform,
    variations: xform.variations.map((v) => ({ ...v })),
  };
  if (xform.post) out.post = { ...xform.post };
  if (xform.xaos) out.xaos = [...xform.xaos];

  for (const m of elements) {
    const func = m.motion_func;
    if (func === undefined || func === 0) continue;   // motion_func=0 = no overlay
    const freq = m.motion_freq ?? 0;
    const w = motionFuncs(func as MotionFuncCode, freq * blend);

    // Affine c[][] — pyr3 fields a..f.
    out.a += m.a * w;
    out.b += m.b * w;
    out.c += m.c * w;
    out.d += m.d * w;
    out.e += m.e * w;
    out.f += m.f * w;

    // Scalar xform fields.
    out.weight += m.weight * w;
    out.color += m.color * w;
    out.colorSpeed += m.colorSpeed * w;
    if (m.opacity !== undefined) {
      out.opacity = (out.opacity ?? 1) + m.opacity * w;
    }
    if (m.animate !== undefined) {
      out.animate = (out.animate ?? 1) + m.animate * w;
    }

    // Post-affine. Per flam3 (apply_motion_parameters loops over c AND post),
    // the motion element's post is also additive. Empty motion-element post
    // means no contribution; non-empty modifies the base post (initializing
    // from identity if absent).
    if (m.post) {
      if (!out.post) out.post = { ...IDENTITY_AFFINE };
      out.post.a += m.post.a * w;
      out.post.b += m.post.b * w;
      out.post.c += m.post.c * w;
      out.post.d += m.post.d * w;
      out.post.e += m.post.e * w;
      out.post.f += m.post.f * w;
    }

    // Per-variation weight + params. Match by variation index — motion
    // contributions on a variation absent from the base xform are dropped.
    if (m.variations.length > 0) {
      const baseByIdx = new Map<VariationIndex, Variation>();
      for (const v of out.variations) baseByIdx.set(v.index, v);
      for (const mv of m.variations) {
        const target = baseByIdx.get(mv.index);
        if (!target) continue;
        target.weight += mv.weight * w;
        for (const pk of PARAM_KEYS) {
          const mvp = (mv as unknown as Record<string, number | undefined>)[pk];
          if (mvp === undefined) continue;
          const tp = (target as unknown as Record<string, number | undefined>)[pk];
          (target as unknown as Record<string, number>)[pk] = (tp ?? 0) + mvp * w;
        }
      }
    }
  }

  // Clamp constraints per flam3's tail (flam3.c:787-792).
  if (out.color < 0) out.color = 0;
  if (out.color > 1) out.color = 1;
  if (out.weight < 0) out.weight = 0;

  return out;
}

const IDENTITY_AFFINE = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 } as const;

const PARAM_KEYS = [
  'param0', 'param1', 'param2', 'param3', 'param4',
  'param5', 'param6', 'param7', 'param8', 'param9',
] as const;
