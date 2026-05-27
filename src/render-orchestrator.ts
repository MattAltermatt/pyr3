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

export function startChunkedRender(opts: OrchestratorOpts): RunHandle {
  let cancelled = false;
  const presentEach = opts.presentAfterEachChunk ?? true;
  const chunks = Math.max(1, Math.ceil(opts.targetSamples / SAMPLES_PER_CHUNK));
  const walkersPerChunk = Math.max(1, Math.round(SAMPLES_PER_CHUNK / ITERS_PER_CHUNK));
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
      // pacing — matches the screen refresh.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
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
