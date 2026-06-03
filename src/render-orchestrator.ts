// Chunked render orchestrator.
//
// Wraps the renderer's reset / iterate / present API in a loop that
// runs N chunks with a frame yield between them. Each chunk
// accumulates ~SAMPLES_PER_CHUNK samples into the renderer's
// histogram; after each chunk, present() commits the current
// accumulation to the canvas (so the visitor sees the flame refine
// live). Progress callbacks land per-chunk; cancel halts the loop
// before the next dispatch and still releases the in-flight chunk's
// GPU work via the renderer's existing patterns.
//
// Why chunks: the inherited single-shot dispatch hands the entire
// chaos-game compute to the GPU at once, which can lock the browser
// for many seconds on heavy flames + offers no visible progress.
// Chunked dispatches keep each frame's GPU work bounded, let the
// browser composite intermediate states, and give us per-chunk
// progress data for the tier-3 UI.

import type { Genome } from './genome';
import type { Renderer } from './renderer';

/** Target samples per chunk. ~1M keeps each chunk's GPU work under
 *  ~50–150 ms on typical hardware, which leaves room for ~10 fps of
 *  UI updates without TDR risk on the heaviest flames. */
const SAMPLES_PER_CHUNK = 1_000_000;

/** Iters-per-walker fixed inside a chunk. Matches chaos.ts's
 *  MIN_ITERS_PER_WALKER so the FUSE warm-up overhead amortizes. */
const ITERS_PER_CHUNK = 4096;

export interface OrchestratorOpts {
  renderer: Renderer;
  genome: Genome;
  /** Lazy because WebGPU's current texture rotates per frame. The
   *  orchestrator calls this before each present(). */
  outputViewProvider: () => GPUTextureView;
  /** Total samples to accumulate across all chunks. Typically
   *  `quality × width × height`. */
  targetSamples: number;
  /** Base seed; each chunk uses seedBase + chunkIndex. */
  seedBase: number;
  onProgress: (info: ProgressInfo) => void;
  /** Default true. False for offscreen renders (download path) where
   *  presenting per-chunk would waste work on a hidden texture. */
  presentAfterEachChunk?: boolean;
  /** Samples accumulated per chunk. Defaults to SAMPLES_PER_CHUNK.
   *  Larger values → fewer chunks → less per-chunk rAF/present overhead
   *  at the cost of coarser progress + a less responsive cancel.
   *  Exposed for the PYR3-027 perf A/B (see __pyr3Bench). */
  samplesPerChunk?: number;
  /** Yield to the event loop (rAF) only every Nth chunk. Default 1
   *  (yield every chunk). Higher values reduce compositor-tick overhead
   *  at the cost of UI responsiveness between yields. PYR3-027 A/B knob. */
  yieldEveryNChunks?: number;
  /** #65 Tier 1 — walker-jitter forwarded to renderer.iterate. Default
   *  DEFAULT_WALKER_JITTER (a scale-relative proportional factor since #43). */
  walkerJitter?: number;
}

export interface ProgressInfo {
  /** 1-based chunk index that just finished. */
  chunk: number;
  total: number;
  /** 0..1. */
  percent: number;
  /** Total samples accumulated so far. */
  samples: number;
  elapsedSeconds: number;
  /** Linear ETA based on per-chunk average. Recomputed each chunk;
   *  approaches 0 as we complete. */
  etaSeconds: number;
}

export interface RunHandle {
  promise: Promise<'completed' | 'cancelled'>;
  cancel(): void;
}

/** Options for the decoupled (display-independent) orchestrator. */
export interface DecoupledOpts {
  renderer: Renderer;
  genome: Genome;
  outputViewProvider: () => GPUTextureView;
  targetSamples: number;
  seedBase: number;
  onProgress: (info: ProgressInfo) => void;
  /** Samples per iterate dispatch. Larger → fewer, fatter dispatches →
   *  higher iteration throughput. Display cadence is independent of this,
   *  so unlike startChunkedRender, bigger dispatches do NOT cost
   *  refinement smoothness. Defaults to DECOUPLED_SAMPLES_PER_DISPATCH. */
  samplesPerDispatch?: number;
  /** Minimum ms between display presents (frame budget). Default ~33ms
   *  (~30fps). The display loop presents the CURRENT accumulated histogram
   *  on this cadence regardless of how many dispatches have landed. */
  displayIntervalMs?: number;
  /** Present with density-estimation OFF during refinement (cheap), then
   *  one full-quality DE present at the end. Default true. */
  cheapPreview?: boolean;
  /** #65 Tier 1 — walker-jitter forwarded to renderer.iterate. Default
   *  DEFAULT_WALKER_JITTER (a scale-relative proportional factor since #43). */
  walkerJitter?: number;
}

/** Default samples per iterate dispatch in the decoupled orchestrator.
 *  PYR3-027 showed each dispatch carries ~44ms fixed overhead independent
 *  of sample count, and the GPU is far from saturated at 1M — so a fatter
 *  dispatch amortizes that fixed cost across far more useful work. */
const DECOUPLED_SAMPLES_PER_DISPATCH = 10_000_000;

/**
 * Decoupled render (PYR3-027 Option 1): iteration and display run as two
 * INDEPENDENT loops sharing the accumulating histogram.
 *
 *  - The iterate loop runs chaos dispatches back-to-back, accumulating
 *    samples as fast as the GPU allows (no per-dispatch present).
 *  - The display loop presents the CURRENT histogram on a fixed time
 *    cadence (displayIntervalMs), so the visitor watches the image refine
 *    smoothly out of noise — at a frame rate decoupled from dispatch rate.
 *
 * Why this beats startChunkedRender for "watch it render": display
 * smoothness no longer depends on chunk count, so iteration can use big
 * efficient dispatches AND the refinement can be as smooth as the frame
 * timer allows. A final full-quality (DE-on) present lands on completion.
 */
export function startDecoupledRender(opts: DecoupledOpts): RunHandle {
  let cancelled = false;
  const perDispatch = opts.samplesPerDispatch ?? DECOUPLED_SAMPLES_PER_DISPATCH;
  const intervalMs = opts.displayIntervalMs ?? 33;
  const cheapPreview = opts.cheapPreview ?? true;
  const dispatches = Math.max(1, Math.ceil(opts.targetSamples / perDispatch));
  const walkersPerDispatch = Math.max(1, Math.round(perDispatch / ITERS_PER_CHUNK));
  const samplesPerDispatch = walkersPerDispatch * ITERS_PER_CHUNK;

  // Shared mutable state between the two loops.
  let samplesAccumulated = 0;
  let done = false;
  const startTime = performance.now();

  const present = (forceDeOff: boolean): void => {
    opts.renderer.present({
      genome: opts.genome,
      outputView: opts.outputViewProvider(),
      totalSamples: Math.max(1, samplesAccumulated),
      forceDeOff,
    });
  };

  // Display loop — present the current histogram on a steady cadence.
  // Independent of dispatch landing; gives smooth refinement frames.
  let lastPresent = 0;
  const displayTick = async (): Promise<void> => {
    while (!done && !cancelled) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const now = performance.now();
      if (samplesAccumulated > 0 && now - lastPresent >= intervalMs) {
        present(cheapPreview);
        lastPresent = now;
      }
    }
  };

  // Iterate loop — accumulate samples as fast as the GPU allows.
  const iterateLoop = async (): Promise<'completed' | 'cancelled'> => {
    opts.renderer.reset(opts.genome);
    for (let i = 0; i < dispatches; i++) {
      if (cancelled) return 'cancelled';
      opts.renderer.iterate({
        genome: opts.genome,
        seed: (opts.seedBase + i) >>> 0,
        walkers: walkersPerDispatch,
        itersPerWalker: ITERS_PER_CHUNK,
        walkerJitter: opts.walkerJitter,
      });
      samplesAccumulated += samplesPerDispatch;
      const elapsed = (performance.now() - startTime) / 1000;
      const perStep = elapsed / (i + 1);
      opts.onProgress({
        chunk: i + 1,
        total: dispatches,
        percent: (i + 1) / dispatches,
        samples: samplesAccumulated,
        elapsedSeconds: elapsed,
        etaSeconds: Math.max(0, perStep * (dispatches - i - 1)),
      });
      // Yield so the display loop (and input) get a turn between dispatches.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
    return 'completed';
  };

  const promise = (async (): Promise<'completed' | 'cancelled'> => {
    const display = displayTick();
    let outcome: 'completed' | 'cancelled';
    try {
      outcome = await iterateLoop();
    } finally {
      done = true;
      await display;
    }
    // Final full-quality present (DE on) on the complete histogram.
    if (outcome === 'completed') present(false);
    return outcome;
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
    },
  };
}

export function startChunkedRender(opts: OrchestratorOpts): RunHandle {
  let cancelled = false;
  const presentEach = opts.presentAfterEachChunk ?? true;
  const yieldEvery = Math.max(1, opts.yieldEveryNChunks ?? 1);
  const chunkTarget = opts.samplesPerChunk ?? SAMPLES_PER_CHUNK;
  const chunks = Math.max(1, Math.ceil(opts.targetSamples / chunkTarget));
  const walkersPerChunk = Math.max(1, Math.round(chunkTarget / ITERS_PER_CHUNK));
  const samplesPerChunk = walkersPerChunk * ITERS_PER_CHUNK;

  const promise = (async (): Promise<'completed' | 'cancelled'> => {
    const startTime = performance.now();
    opts.renderer.reset(opts.genome);
    let samplesAccumulated = 0;
    for (let i = 0; i < chunks; i++) {
      if (cancelled) return 'cancelled';
      opts.renderer.iterate({
        genome: opts.genome,
        seed: (opts.seedBase + i) >>> 0,
        walkers: walkersPerChunk,
        itersPerWalker: ITERS_PER_CHUNK,
        walkerJitter: opts.walkerJitter,
      });
      samplesAccumulated += samplesPerChunk;
      if (presentEach) {
        opts.renderer.present({
          genome: opts.genome,
          outputView: opts.outputViewProvider(),
          totalSamples: samplesAccumulated,
        });
      }
      const elapsed = (performance.now() - startTime) / 1000;
      const perChunk = elapsed / (i + 1);
      opts.onProgress({
        chunk: i + 1,
        total: chunks,
        percent: (i + 1) / chunks,
        samples: samplesAccumulated,
        elapsedSeconds: elapsed,
        etaSeconds: Math.max(0, perChunk * (chunks - i - 1)),
      });
      // Yield to event loop so the browser can composite + handle
      // input (cancel button). requestAnimationFrame is the natural
      // pacing — matches the screen refresh. yieldEvery lets the perf
      // A/B (PYR3-027) thin out the yields to measure their cost.
      if ((i + 1) % yieldEvery === 0) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      }
    }
    if (!presentEach) {
      opts.renderer.present({
        genome: opts.genome,
        outputView: opts.outputViewProvider(),
        totalSamples: samplesAccumulated,
      });
    }
    return 'completed';
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
    },
  };
}
