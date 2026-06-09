// pyr3 — /v1/edit Renderer wrapper.
//
// Routes lane → Renderer call sequence (per the two-lane refresh model in
// the spec): fast = present()-only against the existing histogram; slow =
// reset + iterate(quick) + present; rebuild = resize first, then slow.
// fullRenderAt() is the separate save-PNG path (full quality at configured
// dims).
//
// The wrapper owns no DOM. Renderer is injected so the unit tests stub it
// without touching WebGPU.

import { type Renderer, DEFAULT_SPP, computeDispatch } from './renderer';
import { type Genome } from './genome';
import { type Lane } from './edit-state';

// Default preview samples-per-pixel when genome.quality is unset. The editor
// honors genome.quality directly so a user-picked "quality 50" in the Render
// section is the spp the live preview re-iterates at. Capped via clamp() for
// interactivity (very high quality + large dims = slow).
export const PREVIEW_DEFAULT_SPP = 50;
export const PREVIEW_MAX_SPP = 200;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function previewSpp(genome: Genome): number {
  return clamp(genome.quality ?? PREVIEW_DEFAULT_SPP, 1, PREVIEW_MAX_SPP);
}

/** Per-call options for applyLane.
 *
 *  #176 — `targetSpp` lets the editor/viewer drive preview iteration density
 *  from `PreviewRenderConfig.quality` (10..50 range) instead of inheriting
 *  `genome.quality` (which is now the render-side output quality, 50..500).
 *  When omitted, falls back to today's behavior (genome.quality, clamped). */
export interface ApplyLaneOptions {
  targetSpp?: number;
}

/** Per-call options for fullRender / fullRenderAt.
 *
 *  #176 — when either `signal` or `onProgress` is supplied, the renderer
 *  takes the chunked path (multiple iterate dispatches with abort + progress
 *  checks between them). When BOTH are omitted, the fast single-shot path
 *  runs (preserves parity-stable byte-for-byte today's behavior — the parity
 *  rig never sets opts, so its goldens stay valid).
 *
 *  outputViewProvider — when set, the chunked path calls it AT PRESENT TIME
 *  to get a fresh GPUTextureView. Required when the caller's WebGPU swap-
 *  chain is the output target: the passed `outputView` becomes stale across
 *  the chunked yields (each setTimeout(0) yield gives Chrome an opportunity
 *  to rotate the swap-chain texture, expiring our view → present writes to
 *  a buffer that never reaches the canvas → black output). Matches the
 *  pattern in startDecoupledRender (src/main.ts). */
export interface FullRenderOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  outputViewProvider?: () => GPUTextureView;
}

export interface EditRenderer {
  applyLane(
    lane: Lane,
    genome: Genome,
    seed: number,
    outputView: GPUTextureView,
    superW: number,
    superH: number,
    opts?: ApplyLaneOptions,
  ): void;
  fullRender(
    genome: Genome,
    seed: number,
    outputView: GPUTextureView,
    superW: number,
    superH: number,
    opts?: FullRenderOptions,
  ): void | Promise<void>;
  fullRenderAt(
    genome: Genome,
    seed: number,
    width: number,
    height: number,
    outputView: GPUTextureView,
    opts?: FullRenderOptions,
  ): void | Promise<void>;
}

export interface EditRendererOpts {
  resize?: (width: number, height: number) => void;
  /** Optional editor-level override: when this returns true the renderer
   *  strips `channelCurves` from the genome before presenting, giving the
   *  user a "before" view for the hold-to-preview-off (👁) button. The
   *  histogram is unchanged — only the visualize epilogue is bypassed.
   *  See `src/edit-section-curves.ts`. */
  getPreviewOff?: () => boolean;
}

export function createEditRenderer(
  renderer: Renderer,
  opts: EditRendererOpts = {},
): EditRenderer {
  function reseed(
    genome: Genome,
    seed: number,
    superW: number,
    superH: number,
    spp: number,
  ): number {
    renderer.reset(genome);
    const { dispatchWalkers, dispatchIters, actualSamples } = computeDispatch(
      spp,
      superW,
      superH,
    );
    renderer.iterate({
      genome,
      seed,
      walkers: dispatchWalkers,
      itersPerWalker: dispatchIters,
    });
    return actualSamples;
  }

  function present(
    genome: Genome,
    outputView: GPUTextureView,
    totalSamples: number,
  ): void {
    // Editor-level "before" hook: strip channelCurves when previewOff is set
    // so the user sees the un-graded image without re-iterating. Clone is
    // shallow — we only need to override the channelCurves field for this
    // present(), and we never mutate the original genome.
    const effective = opts.getPreviewOff?.()
      ? { ...genome, channelCurves: undefined }
      : genome;
    renderer.present({ genome: effective, outputView, totalSamples });
  }

  // Slow-lane samples cache so a fast-lane present() right after a slow-lane
  // reseed can pass the right totalSamples to renderer.present(). Tracked
  // here because Renderer doesn't expose its accumulated sample count.
  let lastSamples = 0;

  /** Resolve the spp target for a preview-side lane apply.
   *  Honours the caller-supplied override (#176 PreviewRenderConfig.quality)
   *  when present; otherwise falls back to today's `previewSpp(genome)`
   *  behavior so existing callers keep working. */
  function resolvePreviewSpp(genome: Genome, override?: number): number {
    if (override !== undefined && override > 0) {
      return clamp(override, 1, PREVIEW_MAX_SPP);
    }
    return previewSpp(genome);
  }

  /** #176 — chunked fullRender at arbitrary dims. Splits iteration into
   *  CHUNKED_BATCHES dispatches, yielding to the event loop between them so
   *  AbortSignal flips can interrupt and onProgress callbacks land mid-render. */
  async function fullRenderChunked(
    genome: Genome,
    seed: number,
    width: number,
    height: number,
    outputView: GPUTextureView,
    targetSpp: number,
    fullOpts: FullRenderOptions,
  ): Promise<void> {
    if (fullOpts.signal?.aborted) {
      throw new DOMException('Render aborted', 'AbortError');
    }
    const { dispatchWalkers, dispatchIters, actualSamples } = computeDispatch(
      targetSpp,
      width,
      height,
    );
    renderer.reset(genome);
    const batches = Math.max(8, Math.ceil(dispatchIters / 16384));
    const itersPerBatch = Math.max(1, Math.floor(dispatchIters / batches));
    let dispatched = 0;
    for (let i = 0; i < batches; i++) {
      if (fullOpts.signal?.aborted) {
        throw new DOMException('Render aborted', 'AbortError');
      }
      const remaining = dispatchIters - dispatched;
      const thisIters = i === batches - 1 ? remaining : Math.min(itersPerBatch, remaining);
      if (thisIters <= 0) break;
      // Per-batch seed varies so each call generates fresh chaos-game samples
      // that accumulate into the histogram (iterate is not stateful across
      // calls; same seed twice = same samples twice = no statistical gain).
      renderer.iterate({
        genome,
        seed: seed + i,
        walkers: dispatchWalkers,
        itersPerWalker: thisIters,
      });
      dispatched += thisIters;
      fullOpts.onProgress?.(dispatched / dispatchIters);
      // Yield to event loop so AbortSignal flips + onProgress side-effects
      // (e.g. cancel button click) are observed before the next batch.
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    if (fullOpts.signal?.aborted) {
      throw new DOMException('Render aborted', 'AbortError');
    }
    lastSamples = actualSamples;
    // #176 — get a FRESH outputView at present time when the caller supplied
    // a provider. The view captured before the chunked loop is expired across
    // the setTimeout(0) yields above (Chrome rotates the swap-chain texture
    // between event tasks → present writes to a stale buffer → black PNG).
    const view = fullOpts.outputViewProvider ? fullOpts.outputViewProvider() : outputView;
    present(genome, view, lastSamples);
    // Ensure GPU work is drained before returning — callers that toBlob()
    // immediately need the swap-chain to actually have pixels.
    await (renderer as Renderer & { device?: GPUDevice }).device?.queue.onSubmittedWorkDone();
  }

  function isChunkedRequested(fullOpts?: FullRenderOptions): fullOpts is FullRenderOptions {
    return !!fullOpts && (fullOpts.signal !== undefined || fullOpts.onProgress !== undefined);
  }

  return {
    applyLane(lane, genome, seed, outputView, superW, superH, applyOpts): void {
      const spp = resolvePreviewSpp(genome, applyOpts?.targetSpp);
      switch (lane) {
        case 'rebuild':
          opts.resize?.(superW, superH);
          lastSamples = reseed(genome, seed, superW, superH, spp);
          present(genome, outputView, lastSamples);
          break;
        case 'slow':
          lastSamples = reseed(genome, seed, superW, superH, spp);
          present(genome, outputView, lastSamples);
          break;
        case 'fast':
          // Histogram unchanged; just re-tone the same buckets.
          if (lastSamples === 0) {
            // No prior iterate — fall back to a quick reseed so we have
            // pixels to tone.
            lastSamples = reseed(genome, seed, superW, superH, spp);
          }
          present(genome, outputView, lastSamples);
          break;
      }
    },

    fullRender(genome, seed, outputView, superW, superH, fullOpts): void | Promise<void> {
      const spp = resolvePreviewSpp(genome);
      if (isChunkedRequested(fullOpts)) {
        return fullRenderChunked(genome, seed, superW, superH, outputView, spp, fullOpts);
      }
      lastSamples = reseed(genome, seed, superW, superH, spp);
      present(genome, outputView, lastSamples);
    },

    fullRenderAt(genome, seed, width, height, outputView, fullOpts): void | Promise<void> {
      // Caller is expected to have already resized renderer to (width, height).
      const targetSpp = genome.quality ?? DEFAULT_SPP;
      if (isChunkedRequested(fullOpts)) {
        return fullRenderChunked(genome, seed, width, height, outputView, targetSpp, fullOpts);
      }
      lastSamples = reseed(genome, seed, width, height, targetSpp);
      present(genome, outputView, lastSamples);
    },
  };
}
