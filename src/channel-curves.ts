// Post-tonemap color-curves bake + validate (issue #116).
//
// PURE module — no DOM, no GPU. The visualize pass calls `bakeCurves` to
// produce a 5×256 f32 LUT it uploads to the GPU; `activeMask` produces the
// bit-field for the `curvesActive` uniform.
//
// The parity invariant — `activeMask(undefined) === 0` ⇒ shader branches
// off ⇒ output byte-identical to the no-curves path — is load-bearing for
// the 26-fixture BE parity rig. Do not change `isIdentity` semantics
// without revisiting `src/visualize.identity.test.ts`.
//
// Catmull-Rom B=0.5 cardinal-spline interpolation with endpoint duplication
// matches JWildfire's `org.jwildfire.envelope.SplineInterpolation` and the
// "Smooth" mode in every modern photo editor surveyed (Photoshop, Lightroom,
// Capture One, Affinity, GIMP, DaVinci Resolve).

import type { ChannelCurves, CurvePoint } from './genome';

export const IDENTITY_POINTS: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

const MIN_POINTS = 2;
const MAX_POINTS = 8;

const CHANNEL_ORDER = ['composite', 'r', 'g', 'b', 'luma'] as const;
type Channel = (typeof CHANNEL_ORDER)[number];

export function validate(points: CurvePoint[]): void {
  if (points.length < MIN_POINTS) {
    throw new Error(`channel curve must have at least 2 points, got ${points.length}`);
  }
  if (points.length > MAX_POINTS) {
    throw new Error(`channel curve must have at most 8 points, got ${points.length}`);
  }
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
      throw new Error(`channel curve point ${i} out of range [0,1]: x=${p.x} y=${p.y}`);
    }
    if (i > 0 && p.x <= points[i - 1]!.x) {
      throw new Error(
        `channel curve x not strictly monotonic at index ${i}: ${points[i - 1]!.x} -> ${p.x}`,
      );
    }
  }
}

export function isIdentity(points: CurvePoint[]): boolean {
  return (
    points.length === 2 &&
    points[0]!.x === 0 &&
    points[0]!.y === 0 &&
    points[1]!.x === 1 &&
    points[1]!.y === 1
  );
}

export function activeMask(c: ChannelCurves | undefined): number {
  if (!c) return 0;
  let mask = 0;
  for (let i = 0; i < CHANNEL_ORDER.length; i++) {
    if (!isIdentity(c[CHANNEL_ORDER[i]!])) mask |= 1 << i;
  }
  return mask;
}

// Catmull-Rom spline at parameter u ∈ [0,1], between control y-values xb
// (segment start) and xc (segment end), with neighbors xa (before xb) and
// xd (after xc). B = 0.5 cardinal tension. Matches JWF SplineInterpolation
// and photo-editor "Smooth" mode.
function evalSpline(u: number, xa: number, xb: number, xc: number, xd: number): number {
  const B = 0.5;
  let c = u * u * u * (-B * xa + (2 - B) * xb + (B - 2) * xc + B * xd);
  c += u * u * (2 * B * xa + (B - 3) * xb + (3 - 2 * B) * xc - B * xd);
  c += u * (-B * xa + B * xc);
  return c + xb;
}

function evalCurve(points: CurvePoint[], x: number): number {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  // Edge clamp — JWF Envelope.evaluate convention.
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;

  // <3 points: linear fallback.
  if (points.length < 3) {
    const second = points[1]!;
    const dx = second.x - first.x;
    if (dx < 1e-9) return first.y;
    const t = (x - first.x) / dx;
    return first.y + t * (second.y - first.y);
  }

  // Locate segment [i, i+1] containing x.
  let i = 0;
  while (i < points.length - 1 && points[i + 1]!.x < x) i++;

  const pi = points[i]!;
  const piPlus1 = points[i + 1]!;

  // Phantom-point endpoint duplication for the neighbors.
  const xa = points[Math.max(0, i - 1)]!.y;
  const xb = pi.y;
  const xc = piPlus1.y;
  const xd = points[Math.min(points.length - 1, i + 2)]!.y;

  const segDx = piPlus1.x - pi.x;
  if (segDx < 1e-9) return xb;
  const u = (x - pi.x) / segDx;
  return evalSpline(u, xa, xb, xc, xd);
}

export function bakeOne(points: CurvePoint[]): Float32Array {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const y = evalCurve(points, i / 255);
    lut[i] = Math.max(0, Math.min(1, y));
  }
  return lut;
}

export function bakeCurves(c: ChannelCurves): Float32Array | null {
  if (activeMask(c) === 0) return null;
  const out = new Float32Array(5 * 256);
  for (let ch = 0; ch < CHANNEL_ORDER.length; ch++) {
    const lut = bakeOne(c[CHANNEL_ORDER[ch] as Channel]);
    out.set(lut, ch * 256);
  }
  return out;
}
