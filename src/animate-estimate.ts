// Up-front render-time estimate for animation export (#226).
//
// The /animate Export modal answers "is this a 2-minute or a 2-hour job?"
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
  /** #274 — absolute output dimensions. When set, the per-frame cost uses these
   *  pixel dims instead of each genome's native size. */
  outputSize?: { width: number; height: number };
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

// ── Backend per-frame cost model (#278) ──────────────────────────────────────
// The up-front export ETA used to divide the chaos-sample budget by a throughput
// anchor measured from the BROWSER preview render. That undershot 4K exports by
// ~30–100×: the preview renders to a canvas (no GPU→CPU readback, no PNG encode),
// while a backend export frame is dominated by a PER-PIXEL cost (readback + JS
// PNG encode + density/tonemap/visualize) that grows with resolution and is
// absent from the preview measurement. A pure samples/sec model structurally
// cannot represent it — effective seconds/sample then varies with both quality
// AND dimensions, so no single throughput anchor fits.
//
// Replacement: a two-term model  seconds = samples·SEC_PER_SAMPLE + pixels·SEC_PER_PIXEL.
// Constants calibrated from headless `npm run animate` timings (Dawn-node, Apple
// Silicon) across native/HD/4K × q=20/200/2000: fits native+HD within ~1% and is
// conservative (a safe ~38% OVER-estimate) at 4K, where the chaos game amortizes
// fixed GPU cost better than the linear model assumes. These are a COLD reference
// — the during-render ETA (animate-export.ts) re-anchors to wall-clock, so the
// up-front number self-corrects within one frame on any machine.
export const SEC_PER_SAMPLE = 2.5e-8; // backend chaos throughput ≈ 40M samples/s
export const SEC_PER_PIXEL = 1.3e-6;  // readback + PNG-encode + tonemap, per output px

/** Sample + pixel budget for an export, summed over frames. Probes up to
 *  BUDGET_SAMPLE_CAP frame times spread evenly across the range, averages the
 *  per-frame cost, and scales by the true frame count. Per-frame samples =
 *  computeDispatch(quality·qs, w, h).actualSamples (the SAME dispatch math the
 *  real render uses); per-frame pixels = w × h (drives the readback/encode term). */
function animationBudget(animation: Animation, range: ExportRange): { samples: number; pixels: number } {
  const frames = countFrames(range.begin, range.end, range.dtime);
  if (frames === 0) return { samples: 0, pixels: 0 };
  const step = Math.max(1, Math.floor(range.dtime));
  const qs = range.qs > 0 ? range.qs : 1;

  const probes = Math.min(frames, BUDGET_SAMPLE_CAP);
  let sampleSum = 0;
  let pixelSum = 0;
  for (let i = 0; i < probes; i++) {
    const frameIdx = probes === 1 ? 0 : Math.round((i * (frames - 1)) / (probes - 1));
    const t = range.begin + frameIdx * step;
    const g = interpolate(animation, t);
    const w = range.outputSize?.width ?? g.size?.width ?? 1024;
    const h = range.outputSize?.height ?? g.size?.height ?? 1024;
    const spp = (g.quality ?? 16) * qs;
    sampleSum += computeDispatch(spp, w, h).actualSamples;
    pixelSum += w * h;
  }
  return {
    samples: Math.round((sampleSum / probes) * frames),
    pixels: Math.round((pixelSum / probes) * frames),
  };
}

/** Total chaos-sample budget (walkers × iters, summed over frames) for an
 *  export — the headline "N samples" figure. */
export function totalSampleBudget(animation: Animation, range: ExportRange): number {
  return animationBudget(animation, range).samples;
}

/** Wall-clock seconds for the two-term backend cost model (#278). Always returns
 *  a number (the model needs no live anchor); the during-render ETA refines it. */
export function estimateSeconds(totalSamples: number, totalPixels: number): number {
  const s = (Number.isFinite(totalSamples) ? totalSamples : 0) * SEC_PER_SAMPLE
    + (Number.isFinite(totalPixels) ? totalPixels : 0) * SEC_PER_PIXEL;
  return Math.max(0, s);
}

/** Bundle frame count, sample budget, and modelled seconds. */
export function estimateExport(animation: Animation, range: ExportRange): ExportEstimate {
  const frames = countFrames(range.begin, range.end, range.dtime);
  const { samples, pixels } = animationBudget(animation, range);
  return { frames, totalSamples: samples, seconds: frames === 0 ? null : estimateSeconds(samples, pixels) };
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
  /** #274 — absolute output dimensions. When set, the per-frame cost uses these
   *  pixel dims instead of each clip genome's native size. */
  outputSize?: { width: number; height: number };
}

/** Frame count for a timeline export. Mirrors the CLI buildTimelinePlan:
 *  frameCount = max(1, round(duration × fps)). 0 for invalid fps. */
export function countTimelineFrames(durationSeconds: number, fps: number): number {
  if (!Number.isFinite(durationSeconds) || !Number.isFinite(fps) || fps <= 0 || durationSeconds < 0) {
    return 0;
  }
  return Math.max(1, Math.round(durationSeconds * fps));
}

/** Sample + pixel budget for a timeline export, summed over frames. Per-frame
 *  samples = computeDispatch(absoluteQuality, w, h).actualSamples (no qs multiply);
 *  per-frame pixels = w × h (drives the readback/encode term, #278). */
function timelineBudget(tl: Timeline, range: TimelineExportRange): { samples: number; pixels: number } {
  const total = timelineDuration(tl);
  const frames = countTimelineFrames(total, range.fps);
  if (frames === 0) return { samples: 0, pixels: 0 };
  const quality = range.quality > 0 ? range.quality : 16;
  const probes = Math.min(frames, BUDGET_SAMPLE_CAP);
  let sampleSum = 0;
  let pixelSum = 0;
  for (let i = 0; i < probes; i++) {
    const frameIdx = probes === 1 ? 0 : Math.round((i * (frames - 1)) / (probes - 1));
    const t = frameIdx / range.fps;
    const g = timelineGenomeAt(tl, t);
    const w = range.outputSize?.width ?? g.size?.width ?? 1024;
    const h = range.outputSize?.height ?? g.size?.height ?? 1024;
    sampleSum += computeDispatch(quality, w, h).actualSamples;
    pixelSum += w * h;
  }
  return {
    samples: Math.round((sampleSum / probes) * frames),
    pixels: Math.round((pixelSum / probes) * frames),
  };
}

/** Total chaos-sample budget for a timeline export — the headline "N samples". */
export function timelineSampleBudget(tl: Timeline, range: TimelineExportRange): number {
  return timelineBudget(tl, range).samples;
}

/** Bundle frame count + sample budget + modelled seconds for a timeline export.
 *  Reuses estimateSeconds + the ExportEstimate shape so the modal's
 *  formatExportEstimate renders it unchanged. */
export function estimateTimelineExport(tl: Timeline, range: TimelineExportRange): ExportEstimate {
  const frames = countTimelineFrames(timelineDuration(tl), range.fps);
  const { samples, pixels } = timelineBudget(tl, range);
  return { frames, totalSamples: samples, seconds: frames === 0 ? null : estimateSeconds(samples, pixels) };
}

/** Render the up-front estimate as one human line. Spells out "est. time" with
 *  no bare ~ — the estimate-ness is in words, not a glyph (#226 UX). The number
 *  is a cold model estimate (#278) that the during-render ETA refines live. */
export function formatExportEstimate(est: ExportEstimate): string {
  if (est.frames === 0) return 'no frames in range';
  const head = `${est.frames} frame${est.frames === 1 ? '' : 's'} · ${formatCount(est.totalSamples)} samples`;
  if (est.seconds === null) {
    return `${head} · est. time after first frame`;
  }
  return `${head} · est. time ${formatEstTime(est.seconds)}`;
}
