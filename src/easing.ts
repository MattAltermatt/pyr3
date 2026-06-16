// Easing curves for keyframe-animation tweens (#224). PURE + engine-safe
// (no DOM). evalEasing remaps a normalized segment progress t ∈ [0,1] → [0,1];
// interpolate.ts applies it to the linear keyframe blend weight BEFORE the
// per-field blend. EasingCurve is a `kind`-tagged union so #227's timeline can
// grow the vocabulary (steps/spring/…) additively; an unknown kind → linear.

/** #224's authored preset set. `linear` is the identity remap (and default).
 *  `hold` is a genuine step discontinuity (no separate `steps` union arm). */
export type EasingPreset = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';

export type EasingCurve =
  | { kind: 'preset'; name: EasingPreset }
  | { kind: 'cubicBezier'; x1: number; y1: number; x2: number; y2: number };

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Closed-form preset remaps, all [0,1]→[0,1] with f(0)=0, f(1)=1 (except the
 *  deliberate `hold` step). */
function evalPreset(name: EasingPreset, t: number): number {
  switch (name) {
    case 'linear': return t;
    case 'easeIn': return t * t;
    case 'easeOut': return 1 - (1 - t) * (1 - t);
    case 'easeInOut': return t * t * (3 - 2 * t); // smoothstep 3t²−2t³
    case 'hold': return t < 1 ? 0 : 1;
    default: return t;
  }
}

const BEZIER_EPS = 1e-6;

/** One axis of a cubic bezier with implicit P0=0, P3=1 and control points
 *  c1,c2:  B(s) = 3(1-s)²s·c1 + 3(1-s)s²·c2 + s³. */
function bezierAxis(c1: number, c2: number, s: number): number {
  const mt = 1 - s;
  return 3 * mt * mt * s * c1 + 3 * mt * s * s * c2 + s * s * s;
}

/** dB/ds — for Newton iteration. */
function bezierAxisDeriv(c1: number, c2: number, s: number): number {
  const mt = 1 - s;
  return 3 * mt * mt * c1 + 6 * mt * s * (c2 - c1) + 3 * s * s * (1 - c2);
}

/** Solve bezierX(s) = x for the parameter s ∈ [0,1] (x is monotonic in [0,1]).
 *  Newton-Raphson with a bisection fallback. CSS UnitBezier algorithm. */
function solveBezierParam(x1: number, x2: number, x: number): number {
  let s = x; // good initial guess
  for (let i = 0; i < 8; i++) {
    const err = bezierAxis(x1, x2, s) - x;
    if (Math.abs(err) < BEZIER_EPS) return s;
    const d = bezierAxisDeriv(x1, x2, s);
    if (Math.abs(d) < BEZIER_EPS) break;
    // Clamp each Newton step into [0,1]: keeps the solver well-behaved even for
    // out-of-domain handles (x1/x2 outside [0,1], non-monotone x) that the
    // future #227 handle editor could author — degrades to bisection cleanly.
    s = clamp01(s - err / d);
  }
  // Bisection fallback when Newton stalls (near-flat handles).
  let lo = 0;
  let hi = 1;
  s = x;
  while (hi - lo > BEZIER_EPS) {
    const xs = bezierAxis(x1, x2, s);
    if (Math.abs(xs - x) < BEZIER_EPS) break;
    if (x > xs) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return s;
}

function evalCubicBezier(curve: { x1: number; y1: number; x2: number; y2: number }, t: number): number {
  const s = solveBezierParam(curve.x1, curve.x2, t);
  return bezierAxis(curve.y1, curve.y2, s);
}

/** Remap t ∈ [0,1] through an easing curve. Output clamped to [0,1].
 *  Unknown kind → identity (forward-compat for future #227 arms).
 *
 *  #317 — the OUTPUT clamp deliberately disables overshoot/anticipation. All
 *  shipped presets + the current bezier curves stay within [0,1], so the clamp
 *  is a no-op today; it is NOT a solver bug. When a bezier-handle editor lands
 *  that can author handles past the unit box, clamp only the input `t` (domain)
 *  here and let the output range past [0,1] for overshoot. */
export function evalEasing(curve: EasingCurve, t: number): number {
  const x = clamp01(t);
  if (curve.kind === 'preset') return clamp01(evalPreset(curve.name, x));
  if (curve.kind === 'cubicBezier') return clamp01(evalCubicBezier(curve, x));
  return x;
}
