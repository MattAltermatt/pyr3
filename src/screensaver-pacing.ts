// Build-up mode pacing: translate wall-clock elapsed → target quality.
// qTarget(t, buildUpSec) ramps linearly from 0 at t=0 to BUILD_UP_TARGET_Q
// at t=buildUpSec, then clamps. The mount loop dispatches more chaos
// iterations every frame until the renderer's measured q reaches qTarget.

export const BUILD_UP_TARGET_Q = 50;

export function qTarget(elapsedSec: number, buildUpSec: number): number {
  if (elapsedSec <= 0) return buildUpSec <= 0 ? BUILD_UP_TARGET_Q : 0;
  if (buildUpSec <= 0) return BUILD_UP_TARGET_Q;
  if (elapsedSec >= buildUpSec) return BUILD_UP_TARGET_Q;
  return (elapsedSec / buildUpSec) * BUILD_UP_TARGET_Q;
}
