// pyr3 — /v1/edit Renderer wrapper.
//
// Routes lane → Renderer call sequence (per the two-lane refresh model in
// the spec): fast = present()-only against the existing histogram; slow =
// reset + iterate(quick) + present; rebuild = resize first, then slow.
//
// The wrapper owns no DOM. Renderer is injected so the unit tests stub it
// without touching WebGPU.

import { type Renderer, computeDispatch } from './renderer';
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
  };
}
