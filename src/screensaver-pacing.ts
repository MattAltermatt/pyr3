// Build-up mode pacing helpers.
//
// `qTarget(t, buildUpSec)` translates wall-clock elapsed → target quality;
// retained for backward-compat (the literal-pixel-landing loop in
// screensaver-mount.ts uses samplesPerFrameForBuildUp instead).
//
// `samplesPerFrameForBuildUp` distributes the build-up sample budget evenly
// across the buildUpSec × fps frames — the mount loop sizes each frame's
// chaos.iterate() dispatch from this value (splat iters per walker = ceil
// of samplesPerFrame / walkers). See spec §4.2 for the rationale.

export const BUILD_UP_TARGET_Q = 50;

export function qTarget(elapsedSec: number, buildUpSec: number): number {
  if (elapsedSec <= 0) return buildUpSec <= 0 ? BUILD_UP_TARGET_Q : 0;
  if (buildUpSec <= 0) return BUILD_UP_TARGET_Q;
  if (elapsedSec >= buildUpSec) return BUILD_UP_TARGET_Q;
  return (elapsedSec / buildUpSec) * BUILD_UP_TARGET_Q;
}

// How many post-fuse splatted samples per frame to land
// targetQ × width × height at exactly buildUpSec @ fps. Degenerate inputs
// (buildUpSec=0 or fps=0) collapse to the total budget — the loop finishes
// in one frame.
export function samplesPerFrameForBuildUp(
  targetQ: number,
  width: number,
  height: number,
  buildUpSec: number,
  fps: number,
): number {
  const total = targetQ * width * height;
  if (buildUpSec <= 0 || fps <= 0) return total;
  return total / (buildUpSec * fps);
}
