// Up-front render-time estimate for animation export (#226).
//
// The /v1/animate Export modal answers "is this a 2-minute or a 2-hour job?"
// BEFORE the first frame renders. The estimate is two parts:
//   1. A sample BUDGET — computable up front from frames × per-frame dispatch
//      cost (the same computeDispatch() math the real render uses).
//   2. A throughput ANCHOR (samples/sec) measured from THIS machine's preview
//      renders that already happen on flame load / scrub (animate-mount.ts).
// budget ÷ throughput → estimated seconds. The during-render ETA
// (animate-export.ts) re-anchors per frame, so a rough cold anchor self-
// corrects within one frame.
//
// Correction vs the issue premise (#226): per-frame cost does NOT scale with
// ntemporal_samples. pyr3's temporal sampling REDISTRIBUTES a fixed walker
// budget across sub-frames (animate-render.ts:103-125 preserves the total),
// it does not multiply it — so motion-blur sub-samples are budget-neutral here.

import { type Animation } from './animation';
import { type Timeline, timelineDuration, timelineGenomeAt } from './timeline';
import { interpolate } from './interpolate';
import { computeDispatch } from './renderer';

export interface ExportRange {
  begin: number;
  end: number;
  dtime: number;
  /** Quality scale applied to each keyframe's quality (matches the CLI/backend
   *  `qs` semantics). */
  qs: number;
}

export interface ExportEstimate {
  /** Frames that will be rendered for this range. */
  frames: number;
  /** Total chaos-sample budget across all frames. */
  totalSamples: number;
  /** Estimated wall-clock seconds, or null when no throughput anchor exists
   *  yet (caller shows a "after first frame" placeholder). */
  seconds: number | null;
}

/** Frames rendered for begin..end inclusive at the given stride — matches the
 *  CLI loop `for (t = begin; t <= end; t += dtime)` in pyr3-animate.ts. Returns
 *  0 for an empty / reversed range. */
export function countFrames(begin: number, end: number, dtime: number): number {
  const step = Math.max(1, Math.floor(dtime));
  if (!Number.isFinite(begin) || !Number.isFinite(end) || end < begin) return 0;
  return Math.floor((end - begin) / step) + 1;
}

// Cap on how many frame times we actually interpolate to estimate the budget.
// Dims/quality vary slowly across keyframes, so sampling evenly and scaling by
// the true frame count keeps a several-thousand-frame estimate from stalling
// the modal's input handler (interpolate() builds a full Genome per call).
const BUDGET_SAMPLE_CAP = 64;

/** Total chaos-sample budget (walkers × iters, summed over frames) for an
 *  export. Per-frame cost = computeDispatch(quality·qs, w, h).actualSamples —
 *  the SAME dispatch math the real render uses. */
export function totalSampleBudget(animation: Animation, range: ExportRange): number {
  const frames = countFrames(range.begin, range.end, range.dtime);
  if (frames === 0) return 0;
  const step = Math.max(1, Math.floor(range.dtime));
  const qs = range.qs > 0 ? range.qs : 1;

  // Probe up to BUDGET_SAMPLE_CAP frame indices spread evenly across the range,
  // average their per-frame budget, and scale by the true frame count.
  const probes = Math.min(frames, BUDGET_SAMPLE_CAP);
  let sum = 0;
  for (let i = 0; i < probes; i++) {
    const frameIdx = probes === 1 ? 0 : Math.round((i * (frames - 1)) / (probes - 1));
    const t = range.begin + frameIdx * step;
    const g = interpolate(animation, t);
    const w = g.size?.width ?? 1024;
    const h = g.size?.height ?? 1024;
    const spp = (g.quality ?? 16) * qs;
    sum += computeDispatch(spp, w, h).actualSamples;
  }
  const avgPerFrame = sum / probes;
  return Math.round(avgPerFrame * frames);
}

/** Seconds to render `totalSamples` at a measured throughput. Returns null when
 *  no throughput anchor is available yet. */
export function estimateSeconds(
  totalSamples: number,
  samplesPerSec: number | null,
): number | null {
  if (samplesPerSec === null || !(samplesPerSec > 0) || !Number.isFinite(totalSamples)) {
    return null;
  }
  return totalSamples / samplesPerSec;
}

/** Bundle frame count, sample budget, and (when an anchor exists) seconds. */
export function estimateExport(
  animation: Animation,
  range: ExportRange,
  samplesPerSec: number | null,
): ExportEstimate {
  const frames = countFrames(range.begin, range.end, range.dtime);
  const totalSamples = totalSampleBudget(animation, range);
  return { frames, totalSamples, seconds: estimateSeconds(totalSamples, samplesPerSec) };
}

/** Compact count: 850, 12k, 4.2M, 101B. "B" for billions reads clearer to a
 *  lay viewer than "G". */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${Math.round(n)}`;
}

/** Estimated-time string. M:SS, or H:MM:SS for long jobs, or "<1s". Returns
 *  empty string for non-finite / negative input. */
export function formatEstTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 1) return '<1s';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export interface TimelineExportRange {
  /** Frames per second. */
  fps: number;
  /** Absolute quality (samples/px) applied to every clip — NOT a scale. */
  quality: number;
}

/** Frame count for a timeline export. Mirrors the CLI buildTimelinePlan:
 *  frameCount = max(1, round(duration × fps)). 0 for invalid fps. */
export function countTimelineFrames(durationSeconds: number, fps: number): number {
  if (!Number.isFinite(durationSeconds) || !Number.isFinite(fps) || fps <= 0 || durationSeconds < 0) {
    return 0;
  }
  return Math.max(1, Math.round(durationSeconds * fps));
}

/** Total chaos-sample budget for a timeline export. Per-frame cost =
 *  computeDispatch(absoluteQuality, w, h).actualSamples — the same dispatch math
 *  the real render uses, with the absolute quality (no qs multiply). */
export function timelineSampleBudget(tl: Timeline, range: TimelineExportRange): number {
  const total = timelineDuration(tl);
  const frames = countTimelineFrames(total, range.fps);
  if (frames === 0) return 0;
  const quality = range.quality > 0 ? range.quality : 16;
  const probes = Math.min(frames, BUDGET_SAMPLE_CAP);
  let sum = 0;
  for (let i = 0; i < probes; i++) {
    const frameIdx = probes === 1 ? 0 : Math.round((i * (frames - 1)) / (probes - 1));
    const t = frameIdx / range.fps;
    const g = timelineGenomeAt(tl, t);
    const w = g.size?.width ?? 1024;
    const h = g.size?.height ?? 1024;
    sum += computeDispatch(quality, w, h).actualSamples;
  }
  return Math.round((sum / probes) * frames);
}

/** Bundle frame count + sample budget + (when an anchor exists) seconds for a
 *  timeline export. Reuses estimateSeconds + the ExportEstimate shape so the
 *  modal's formatExportEstimate renders it unchanged. */
export function estimateTimelineExport(
  tl: Timeline,
  range: TimelineExportRange,
  samplesPerSec: number | null,
): ExportEstimate {
  const frames = countTimelineFrames(timelineDuration(tl), range.fps);
  const totalSamples = timelineSampleBudget(tl, range);
  return { frames, totalSamples, seconds: estimateSeconds(totalSamples, samplesPerSec) };
}

/** Render the up-front estimate as one human line. Spells out "est. time" with
 *  no bare ~ — the estimate-ness is in words, not a glyph (#226 UX). */
export function formatExportEstimate(est: ExportEstimate): string {
  if (est.frames === 0) return 'no frames in range';
  const head = `${est.frames} frame${est.frames === 1 ? '' : 's'} · ${formatCount(est.totalSamples)} samples`;
  if (est.seconds === null) {
    return `${head} · est. time after first frame`;
  }
  return `${head} · est. time ${formatEstTime(est.seconds)} (this machine)`;
}
