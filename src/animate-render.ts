// P5 of Animation milestone (#17 / #210). Temporal-sampled render of one
// output frame from a multi-keyframe Animation. When ntemporal_samples > 1,
// renders N sub-frames at time + delta[i], distributing walker counts by
// filter[i]/sumfilt so the TOTAL walker count is preserved across filter
// shapes (i.e. box and gaussian yield the same total quality budget).
//
// Strategy: GPU-side accumulate (Option A from #210). The chaos histogram
// is NOT reset between sub-frame iterate() calls, so contributions stack
// atomically. No WGSL change — reuses existing renderer.iterate() interface.

import { type Animation } from './animation';
import { type Genome } from './genome';
import { type Renderer, computeDispatch } from './renderer';
import { interpolate } from './interpolate';
import { createTemporalFilter } from './temporal-filter';
import { DEFAULT_WALKER_JITTER } from './chaos';

export interface AnimationFrameRenderOpts {
  /** Output texture view (offscreen render target or canvas swap chain). */
  outputView: GPUTextureView;
  /** Deterministic base seed; per-sub-frame seeds are derived from it +
   *  the sub-frame index. */
  seed?: number;
  /** Forwarded to renderer.iterate(); pyr3-animate uses DEFAULT_WALKER_JITTER. */
  walkerJitter?: number;
  /** When true, density-estimation is bypassed at present time. */
  forceDeOff?: boolean;
}

export interface AnimationFrameRenderResult {
  /** The genome used to seed renderer.reset (palette + first sub-frame). */
  centerGenome: Genome;
  /** Number of sub-frames actually rendered. */
  subframes: number;
  /** Total walker count summed across all sub-frames. */
  totalWalkers: number;
  /** Total samples (walkers × iters) passed to renderer.present for K2. */
  totalSamples: number;
}

/** Render one output frame of an Animation at time T. Honors
 *  `animation.ntemporal_samples` + `temporal_filter_*` — sub-renders N times
 *  at t + delta[i], walker-weighted by filter[i]/sumfilt, accumulating into
 *  one histogram before a single present.
 *
 *  Falls back to single-frame interp + render when ntemporal_samples <= 1
 *  (matches flam3-render's force-to-1 behavior for static renders). */
export function renderAnimationFrame(
  renderer: Renderer,
  animation: Animation,
  time: number,
  opts: AnimationFrameRenderOpts,
): AnimationFrameRenderResult {
  const N = Math.max(1, Math.floor(animation.ntemporal_samples));
  const baseSeed = opts.seed ?? ((Math.random() * 0xffffffff) >>> 0);
  const walkerJitter = opts.walkerJitter ?? DEFAULT_WALKER_JITTER;

  // Compute the dispatch budget from the center-time genome's quality.
  const centerGenome = interpolate(animation, time);
  const targetSpp = centerGenome.quality ?? 16;
  const { dispatchWalkers, dispatchIters } = computeDispatch(
    targetSpp,
    renderer.width,
    renderer.height,
  );

  // Initial reset uses the center-time genome's palette (needed for the
  // chaos pass's per-walker palette LUT). All sub-frames write into the
  // same histogram from here.
  renderer.reset(centerGenome);

  if (N === 1) {
    // Single sub-frame — bypass temporal filter machinery.
    renderer.iterate({
      genome: centerGenome,
      seed: baseSeed,
      walkers: dispatchWalkers,
      itersPerWalker: dispatchIters,
      walkerJitter,
    });
    renderer.present({
      genome: centerGenome,
      outputView: opts.outputView,
      totalSamples: dispatchWalkers * dispatchIters,
      ...(opts.forceDeOff !== undefined ? { forceDeOff: opts.forceDeOff } : {}),
    });
    return {
      centerGenome,
      subframes: 1,
      totalWalkers: dispatchWalkers,
      totalSamples: dispatchWalkers * dispatchIters,
    };
  }

  // N > 1: build the filter, distribute walkers, sub-render N times.
  const { deltas, filter, sumfilt } = createTemporalFilter(
    N,
    animation.temporal_filter_type,
    animation.temporal_filter_width,
    animation.temporal_filter_exp,
  );

  // walker distribution: each sub-frame gets (dispatchWalkers * filter[i]) /
  // (N * sumfilt) walkers — this preserves TOTAL walker count across filter
  // shapes (box: every entry 1.0 → uniform N-th; gaussian: weighted hump).
  // Scale: sum_i (walkers_i) = dispatchWalkers * (sum(filter) / (N * sumfilt))
  //                          = dispatchWalkers * (N * sumfilt / (N * sumfilt))
  //                          = dispatchWalkers.
  let totalWalkers = 0;
  for (let i = 0; i < N; i++) {
    const subTime = time + deltas[i]!;
    const subGenome = interpolate(animation, subTime);
    const walkers = Math.max(1, Math.round((dispatchWalkers * filter[i]!) / (N * sumfilt)));
    // Per-sub-frame seed derived from base + i, so a fixed --seed still
    // produces deterministic temporal output.
    const subSeed = (baseSeed + i * 0x9e3779b1) >>> 0;
    renderer.iterate({
      genome: subGenome,
      seed: subSeed,
      walkers,
      itersPerWalker: dispatchIters,
      walkerJitter,
    });
    totalWalkers += walkers;
  }

  const totalSamples = totalWalkers * dispatchIters;
  renderer.present({
    genome: centerGenome,
    outputView: opts.outputView,
    totalSamples,
    ...(opts.forceDeOff !== undefined ? { forceDeOff: opts.forceDeOff } : {}),
  });

  return {
    centerGenome,
    subframes: N,
    totalWalkers,
    totalSamples,
  };
}
