// Build-up mode pacing helpers.
//
// `qTarget(t, buildUpSec)` translates wall-clock elapsed → target quality;
// retained for backward-compat (the literal-pixel-landing loop in
// screensaver-mount.ts uses cumulativeSamplesAt instead).
//
// `cumulativeSamplesAt` answers "how many splatted samples should have
// landed by elapsed t, given a ramp exponent?" — the build-up loop subtracts
// already-accumulated samples to size each frame's chaos dispatch.
// ramp=1.0 → linear pacing (bright early, polishing tail); ramp>1.0 →
// slower-then-faster (image visibly builds through 50%).

export const BUILD_UP_TARGET_Q = 50;

export function qTarget(elapsedSec: number, buildUpSec: number): number {
  if (elapsedSec <= 0) return buildUpSec <= 0 ? BUILD_UP_TARGET_Q : 0;
  if (buildUpSec <= 0) return BUILD_UP_TARGET_Q;
  if (elapsedSec >= buildUpSec) return BUILD_UP_TARGET_Q;
  return (elapsedSec / buildUpSec) * BUILD_UP_TARGET_Q;
}

export interface RampPreset {
  value: number;
  label: string;
}

export const RAMP_PRESETS: readonly RampPreset[] = [
  { value: 1, label: 'Linear' },
  { value: 2, label: 'Gentle' },
  { value: 3, label: 'Medium' },
  { value: 5, label: 'Heavy'  },
];

/** Preset label for exact matches; ×<n> for custom exponents. */
export function rampLabel(ramp: number): string {
  for (const p of RAMP_PRESETS) if (p.value === ramp) return p.label;
  return `×${ramp.toFixed(1)}`;
}

/** Cumulative splatted-sample target at `elapsedSec` under the curve
 *  `totalSamples × (elapsedSec / buildUpSec)^ramp`. Clamped to
 *  `[0, totalSamples]`. Degenerate inputs (buildUpSec≤0 or negative
 *  elapsed) collapse to the endpoints. */
export function cumulativeSamplesAt(
  elapsedSec: number,
  buildUpSec: number,
  totalSamples: number,
  ramp: number,
): number {
  if (totalSamples <= 0) return 0;
  if (buildUpSec <= 0)   return totalSamples;
  if (elapsedSec <= 0)   return 0;
  if (elapsedSec >= buildUpSec) return totalSamples;
  const f = elapsedSec / buildUpSec;
  return totalSamples * Math.pow(f, ramp);
}
