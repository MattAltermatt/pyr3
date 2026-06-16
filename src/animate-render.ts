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
import { type Timeline, timelineSegmentAt } from './timeline';
import { type Genome } from './genome';
import { type Renderer, computeDispatch } from './renderer';
import { interpolate } from './interpolate';
import { createTemporalFilter } from './temporal-filter';
import { DEFAULT_WALKER_JITTER } from './chaos';

/**
 * #302 — apportion an integer `total` walker budget across per-sub-frame
 * `weights` using largest-remainder (Hamilton) apportionment. The returned
 * counts sum EXACTLY to `total` (when total ≤ a representable integer), and
 * low-weight tails are allowed to receive 0 — unlike a per-entry `max(1, …)`
 * floor, which inflates the total toward `weights.length`. Pure + exported for
 * unit test.
 */
export function apportionWalkers(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sumW = weights.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (sumW <= 0 || total <= 0) return new Array(n).fill(0);
  const quotas = weights.map((w) => (total * Math.max(0, w)) / sumW);
  const out = quotas.map((q) => Math.floor(q));
  let deficit = total - out.reduce((a, b) => a + b, 0);
  // Hand the remaining units to the largest fractional remainders.
  const order = quotas
    .map((q, i) => ({ i, rem: q - Math.floor(q) }))
    .sort((a, b) => b.rem - a.rem);
  for (let k = 0; k < deficit && k < n; k++) out[order[k]!.i]!++;
  return out;
}

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
  const { deltas, filter } = createTemporalFilter(
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
  // #302 — distribute the integer dispatchWalkers budget across the N filter
  // weights with largest-remainder (Hamilton) apportionment. The old
  // `max(1, round(...))` floored every tail to ≥1, so for N ≳ dispatchWalkers
  // the total ballooned toward N (cost grew ~linearly with N, and a peaked
  // gaussian/exp filter flattened as its tails all rounded up to 1). Hamilton
  // keeps the sum exactly == dispatchWalkers and lets low-weight tails go to 0,
  // restoring the ntemporal-neutral cost the estimate (animate-estimate.ts)
  // assumes.
  const walkerCounts = apportionWalkers(dispatchWalkers, filter);
  let totalWalkers = 0;
  for (let i = 0; i < N; i++) {
    const walkers = walkerCounts[i]!;
    if (walkers === 0) continue; // zero-weight tail — contributes nothing
    const subTime = time + deltas[i]!;
    const subGenome = interpolate(animation, subTime);
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

/** Render one output frame of a Timeline at global time `t`. Locates the active
 *  clip's ephemeral 2-keyframe segment and delegates to renderAnimationFrame so
 *  the temporal-filter / motion-blur path is reused verbatim (#227). */
export function renderTimelineFrame(
  renderer: Renderer,
  timeline: Timeline,
  t: number,
  opts: AnimationFrameRenderOpts,
): AnimationFrameRenderResult {
  const seg = timelineSegmentAt(timeline, t);
  return renderAnimationFrame(renderer, seg.animation, seg.localTime, opts);
}
