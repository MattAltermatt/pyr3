// Screensaver "Animation" mode — stepped-morph playback (#355).
//
// Walks a loaded timeline in DISCRETE held frames: render the timeline at
// normalized position t, hold it for `updateIntervalSec`, advance. Calm,
// non-distracting — "slowly change one image to another". Reuses the /animate
// timeline machinery (timelineGenomeAt / animationToTimeline); no engine change.
import { parseFlame } from './flame-import';
import { animationToTimeline, timelineGenomeAt, type Timeline } from './timeline';
import { timelineFromJson } from './timeline-serialize';
import type { Genome } from './genome';

// ─── pure frame math (unit-tested) ──────────────────────────────────────────

/** Number of distinct frames shown across the run. round(duration/interval),
 *  floored at 1. Guards a non-positive interval. */
export function frameCount(durationSec: number, updateIntervalSec: number): number {
  if (!(updateIntervalSec > 0)) return 1;
  return Math.max(1, Math.round(durationSec / updateIntervalSec));
}

/** Wall-time position (seconds) into the timeline for frame `i` of `frames`,
 *  spreading [0, timelineTotalSec] evenly. A single frame parks at 0. */
export function frameTimeSec(frameIndex: number, frames: number, timelineTotalSec: number): number {
  if (frames <= 1) return 0;
  return (frameIndex / (frames - 1)) * timelineTotalSec;
}

/** Total intrinsic span of the timeline in seconds (sum of clip durations).
 *  (Reconcile against /animate's own framing during verify — plan Task 12.) */
export function timelineTotalSec(tl: Timeline): number {
  return tl.clips.reduce((s, c) => s + c.duration, 0);
}

// ─── loader ─────────────────────────────────────────────────────────────────

/** Parse a loaded `.flam3` multi-keyframe file into a Timeline. Returns null
 *  for a single-keyframe flame (nothing to morph). */
export function timelineFromFlam3Xml(xml: string): Timeline | null {
  const { animation } = parseFlame(xml);
  if (!animation || animation.keyframes.length < 2) return null;
  return animationToTimeline(animation);
}

/** Unified loader for a picked timeline file. Accepts BOTH the `/animate`
 *  `timeline_json` export (`{"format":"pyr3-timeline",…}`) and a `.flam3`
 *  multi-keyframe XML. Returns null if neither parses to a usable timeline. */
export function timelineFromText(text: string): Timeline | null {
  const head = text.trimStart();
  if (head.startsWith('{') || head.startsWith('[')) {
    try {
      const tl = timelineFromJson(text);
      return tl.clips.length >= 1 ? tl : null;
    } catch {
      return null;
    }
  }
  try {
    return timelineFromFlam3Xml(text); // parseFlame throws on non-flame input
  } catch {
    return null;
  }
}

// ─── stepped player ───────────────────────────────────────────────────────────

export interface SteppedPlayerOpts {
  timeline: Timeline;
  durationSec: number;
  updateIntervalSec: number;
  loop: boolean;
  /** Host renders + presents the sampled genome. Awaited before the dwell. */
  renderFrame: (genome: Genome) => Promise<void>;
  onProgress?: (frameIndex: number, frames: number) => void;
  isCancelled: () => boolean;
}

export interface SteppedPlayer {
  start(): void;
  pause(): void;
  resume(): void;
  restart(): void;
  /** Pause auto-advance and render the previous frame (wraps at the start). */
  stepBack(): void;
  /** Pause auto-advance and render the next frame (wraps at the end). */
  stepForward(): void;
  destroy(): void;
}

export function createSteppedPlayer(opts: SteppedPlayerOpts): SteppedPlayer {
  const { timeline, durationSec, updateIntervalSec, loop, renderFrame, onProgress, isCancelled } = opts;
  const frames = frameCount(durationSec, updateIntervalSec);
  const total = timelineTotalSec(timeline);
  let i = 0;
  let paused = false;
  let dead = false;
  // Guards against a resume() kicking off a second tick() while a prior one is
  // still suspended in `await renderFrame` — two concurrent renders would race
  // on the shared Renderer.
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  }

  async function tick(): Promise<void> {
    if (dead || paused || isCancelled() || inFlight) return;
    inFlight = true;
    try {
      const t = frameTimeSec(i, frames, total);
      const genome = timelineGenomeAt(timeline, t);
      await renderFrame(genome);
      if (dead || paused || isCancelled()) return;
      onProgress?.(i, frames);
      i++;
      if (i >= frames) {
        if (!loop) return;
        i = 0;
      }
      timer = setTimeout(() => { void tick(); }, updateIntervalSec * 1000);
    } finally {
      inFlight = false;
    }
  }

  // Render a specific frame index (wrapping), independent of the auto-advance
  // loop. Used by manual stepping. Guarded by inFlight so it can't race a tick.
  async function renderAt(idx: number): Promise<void> {
    if (dead || isCancelled() || inFlight) return;
    inFlight = true;
    try {
      i = ((idx % frames) + frames) % frames;
      await renderFrame(timelineGenomeAt(timeline, frameTimeSec(i, frames, total)));
      onProgress?.(i, frames);
    } finally {
      inFlight = false;
    }
  }

  return {
    start() { clearTimer(); i = 0; paused = false; void tick(); },
    pause() { paused = true; clearTimer(); },
    resume() { if (!paused) return; paused = false; void tick(); },
    restart() { clearTimer(); i = 0; paused = false; void tick(); },
    stepBack() { paused = true; clearTimer(); void renderAt(i - 1); },
    stepForward() { paused = true; clearTimer(); void renderAt(i + 1); },
    destroy() { dead = true; clearTimer(); },
  };
}
