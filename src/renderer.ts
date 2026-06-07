// Renderer core — extracted from main.ts in Phase B1 (CLI prototype).
//
// Encapsulates the chaos + density + visualize pipeline lifecycle and the
// per-frame dispatch sequence. Caller supplies a `GPUDevice`, a target
// `GPUTextureFormat`, output dimensions, and (per render) a Genome plus a
// `GPUTextureView` to write into. Browser callers pass
// `context.getCurrentTexture().createView()`; CLI callers pass an offscreen
// texture's view that they can then `copyTextureToBuffer` + read back.

import { type Genome } from './genome';
import { createChaosPass } from './chaos';
import { createDensityPass } from './density';
import { buildGaussianKernel } from './spatial-filter';
import { createVisualizePass } from './visualize';
import { DEFAULT_TONEMAP } from './tonemap';
import { deriveCalibration } from './calibration';

// flam3 spatial_filter_radius default per flam3.c:1300; used when oversample > 1
// but the genome doesn't carry an explicit `<flame filter>` attribute. Without
// some kernel, the visualize collapse degenerates to a uniform box-average and
// dark gaps between cells get washed out (filt.c:225 — fw scales with both
// supersample and radius).
export const DEFAULT_FILTER_RADIUS = 0.5;

const WALKERS = 4096;
// Walker pool strategy: prefer FEWER walkers with LONGER trajectories per
// walker. Matches flam3's per-temporal-sample pattern (~1000 walkers ×
// ~1M iters typical). Empirically fixes visible transient-arc artifacts on
// concentrated attractors where pyr3's previous "many short walkers" pattern
// produced 231k pre-converged trajectories that left visible structure in
// dark regions of the canvas. See `npm run render` t36 fixture: mean abs
// diff vs flam3 dropped 1.41 → 0.50 with 1024 walkers × 1M iters.
export const TARGET_WALKERS = 1024;
export const MIN_ITERS_PER_WALKER = 4096;
export const MAX_ITERS_PER_WALKER = 1048576; // 2^20, keeps single-thread GPU runtime safely under macOS Metal's TDR.
const ITERS_PER_WALKER = MIN_ITERS_PER_WALKER; // chaos.ts pipeline init default
// Fuse: per-walker warm-up iterations skipped before splatting. flam3 uses
// ~200; pyr3's previous 20 left walkers polluting the background with
// pre-convergence noise (visible as haze in dark areas).
const FUSE = 200;
// Phase 9-cal-B: pyr3-default samples-per-pixel when Genome.quality is undefined.
// Matches the legacy WALKERS × ITERS_PER_WALKER / RENDER_SIZE² = 16 spp budget
// at the previous 1024² canvas.
export const DEFAULT_SPP = 16;
// WebGPU limit on workgroups per dimension (typically 65535). Cap walkers so we
// never exceed it; if quality demands more samples, iters_per_walker grows instead.
export const MAX_WALKERS = 65535 * 64;

/**
 * Walker-pool sizing for a chaos-game render: prefer ~TARGET_WALKERS walkers
 * with iters-per-walker scaled to land `targetSpp × width × height` total
 * samples, then bound iters to [MIN_ITERS_PER_WALKER, MAX_ITERS_PER_WALKER]
 * (adjusting walker count to keep the budget). With `walkersOverride`, the
 * caller pins the walker count; MIN/MAX bounds are skipped (caller-owned
 * tradeoff). Returns the chosen (walkers, iters, actualSamples).
 */
export function computeDispatch(
  targetSpp: number,
  width: number,
  height: number,
  walkersOverride?: number,
): { dispatchWalkers: number; dispatchIters: number; actualSamples: number } {
  const targetSamples = Math.round(targetSpp * width * height);
  let dispatchWalkers = walkersOverride ?? TARGET_WALKERS;
  let dispatchIters = Math.ceil(targetSamples / dispatchWalkers);
  if (walkersOverride === undefined) {
    if (dispatchIters < MIN_ITERS_PER_WALKER) {
      dispatchIters = MIN_ITERS_PER_WALKER;
      dispatchWalkers = Math.max(1, Math.ceil(targetSamples / dispatchIters));
    } else if (dispatchIters > MAX_ITERS_PER_WALKER) {
      dispatchIters = MAX_ITERS_PER_WALKER;
      dispatchWalkers = Math.min(MAX_WALKERS, Math.ceil(targetSamples / dispatchIters));
    }
  } else {
    dispatchIters = Math.max(1, dispatchIters);
  }
  return { dispatchWalkers, dispatchIters, actualSamples: dispatchWalkers * dispatchIters };
}

export interface RendererOptions {
  width: number;
  height: number;
  /** Defaults to genome.oversample at render time; explicit value overrides. */
  oversample?: number;
  /** Defaults to DEFAULT_FILTER_RADIUS or genome.spatialFilter?.radius. */
  filterRadius?: number;
}

export interface RenderRequest {
  genome: Genome;
  /** Color attachment to render into. Caller-owned. */
  outputView: GPUTextureView;
  /** Defaults to a fresh random seed each render. */
  seed?: number;
  /** Forces DE off regardless of genome.density. */
  forceDeOff?: boolean;
  /** #65 Tier 1 — override walker-jitter for this render. Defaults to
   *  DEFAULT_WALKER_JITTER (`src/chaos.ts`); since #43 a scale-relative
   *  proportional factor, not an absolute amplitude. */
  walkerJitter?: number;
}

export interface IterateRequest {
  genome: Genome;
  seed: number;
  walkers: number;
  itersPerWalker: number;
  /** #65 Tier 1 — same as RenderRequest.walkerJitter; defaults to DEFAULT_WALKER_JITTER. */
  walkerJitter?: number;
}

export interface PresentRequest {
  genome: Genome;
  outputView: GPUTextureView;
  /** Sum of walkers × iters across every accumulated `iterate()` call
   *  since the last `reset()`. Drives the log-density calibration. */
  totalSamples: number;
  forceDeOff?: boolean;
}

// Canvas-repoint contract (relied on by the gallery wave-fill orchestrator):
// the Renderer holds NO reference to any canvas or GPUCanvasContext. The
// presentation target is supplied per-call as `outputView: GPUTextureView`
// on `render()` / `present()`. A single Renderer + single GPUDevice can
// therefore drive any number of distinct canvases in sequence — the caller
// just hands a fresh `context.getCurrentTexture().createView()` (or an
// offscreen texture view, on the CLI side) on each call. There is no
// `setCanvas()` because there is no canvas to set; swapping targets between
// calls is the supported path. The only invariant: every target view must
// be created against the same GPUDevice the Renderer was built with, and
// match the GPUTextureFormat passed to `createRenderer()`. Dimensions and
// oversample are controlled by `resize()`; the target view is dimension-
// agnostic so long as it covers the configured (width, height).
export interface Renderer {
  /** Single-shot render — clears the histogram, runs one dispatch sized
   *  to the genome's quality, and presents. Kept as a convenience wrapper
   *  around reset + iterate + present for callers that don't need
   *  chunking. */
  render(req: RenderRequest): void;

  /** Clear the accumulation histogram and set the palette. Call once at
   *  the start of a chunked render sequence. */
  reset(genome: Genome): void;

  /** Run one chunk of chaos-game iteration, accumulating into the
   *  histogram. The orchestrator decides walker × iter sizing per chunk;
   *  the renderer just dispatches. */
  iterate(req: IterateRequest): void;

  /** Run density + visualize passes against the accumulated histogram
   *  and write to the output texture. Can be called many times between
   *  iterate() calls — each call shows the current refinement state. */
  present(req: PresentRequest): void;

  /**
   * Re-build internal pipelines if dimensions / oversample / filter radius
   * changed. No-op when all three match the current configuration.
   */
  resize(opts: RendererOptions): void;
  readonly width: number;
  readonly height: number;
  readonly superW: number;
  readonly superH: number;
  readonly oversample: number;
  readonly filterRadius: number;
  destroy(): void;
}

export function createRenderer(
  device: GPUDevice,
  format: GPUTextureFormat,
  initial: RendererOptions,
): Renderer {
  let pipelines = buildPipelines(device, format, initial);

  const renderer: Renderer = {
    reset(genome: Genome): void {
      pipelines.chaos.setPalette(genome.palette);
      pipelines.chaos.reset();
    },

    iterate(req: IterateRequest): void {
      pipelines.chaos.dispatch(req.genome, req.seed, {
        walkers: req.walkers,
        itersPerWalker: req.itersPerWalker,
        walkerJitter: req.walkerJitter,
      });
    },

    present(req: PresentRequest): void {
      const genome = req.genome;
      const forceDeOff = req.forceDeOff ?? false;
      const tonemap = genome.tonemap ?? DEFAULT_TONEMAP;
      // k1/k2 derived BEFORE density.dispatch — DE applies per-bucket ls
      // during its scatter (matches flam3 rect.c:140), so it needs k1/k2
      // host-side.
      const { k1, k2 } = deriveCalibration({
        scale: genome.scale,
        sampleCount: req.totalSamples,
        brightness: tonemap.brightness,
        oversample: pipelines.oversample,
      });
      const useDE = genome.density !== undefined && !forceDeOff;
      if (useDE) {
        pipelines.density.dispatch(genome.density!, k1, k2, pipelines.oversample);
      }
      // Phase 9-bg-palmode: default applied at this consumer boundary so
      // the genome stays a faithful echo of source XML. flam3 default = [0,0,0].
      const background = genome.background ?? [0, 0, 0];
      pipelines.viz.draw(tonemap, k1, k2, useDE, req.outputView, background, genome.channelCurves);
    },

    render(req: RenderRequest): void {
      const genome = req.genome;
      const seed = req.seed ?? ((Math.random() * 0xffffffff) >>> 0);

      const targetSpp = genome.quality ?? DEFAULT_SPP;
      const { dispatchWalkers, dispatchIters, actualSamples } = computeDispatch(
        targetSpp,
        pipelines.width,
        pipelines.height,
      );

      renderer.reset(genome);
      renderer.iterate({ genome, seed, walkers: dispatchWalkers, itersPerWalker: dispatchIters, walkerJitter: req.walkerJitter });
      renderer.present({ genome, outputView: req.outputView, totalSamples: actualSamples, forceDeOff: req.forceDeOff });
    },

    resize(opts: RendererOptions): void {
      const newOversample = Math.max(1, Math.floor(opts.oversample ?? pipelines.oversample));
      const newFilter = opts.filterRadius ?? pipelines.filterRadius;
      if (
        opts.width === pipelines.width &&
        opts.height === pipelines.height &&
        newOversample === pipelines.oversample &&
        newFilter === pipelines.filterRadius
      ) {
        return;
      }
      destroyPipelines(pipelines);
      pipelines = buildPipelines(device, format, { ...opts, oversample: newOversample, filterRadius: newFilter });
    },

    get width() { return pipelines.width; },
    get height() { return pipelines.height; },
    get superW() { return pipelines.superW; },
    get superH() { return pipelines.superH; },
    get oversample() { return pipelines.oversample; },
    get filterRadius() { return pipelines.filterRadius; },

    destroy(): void {
      destroyPipelines(pipelines);
    },
  };
  return renderer;
}

interface InternalPipelines {
  chaos: ReturnType<typeof createChaosPass>;
  density: ReturnType<typeof createDensityPass>;
  viz: ReturnType<typeof createVisualizePass>;
  width: number;
  height: number;
  superW: number;
  superH: number;
  oversample: number;
  filterRadius: number;
}

function buildPipelines(
  device: GPUDevice,
  format: GPUTextureFormat,
  opts: RendererOptions,
): InternalPipelines {
  const oversample = Math.max(1, Math.floor(opts.oversample ?? 1));
  const superW = opts.width * oversample;
  const superH = opts.height * oversample;

  const chaos = createChaosPass(device, {
    width: superW,
    height: superH,
    walkers: WALKERS,
    itersPerWalker: ITERS_PER_WALKER,
    fuse: FUSE,
    oversample,
  });
  const density = createDensityPass(device, { width: superW, height: superH }, chaos.histogram);

  const filterRadius = opts.filterRadius ?? DEFAULT_FILTER_RADIUS;
  const kernel1d = buildGaussianKernel(filterRadius, oversample);

  const viz = createVisualizePass(
    device,
    format,
    chaos.histogram,
    density.filtered,
    opts.width,
    opts.height,
    oversample,
    kernel1d,
  );

  return {
    chaos,
    density,
    viz,
    width: opts.width,
    height: opts.height,
    superW,
    superH,
    oversample,
    filterRadius,
  };
}

function destroyPipelines(p: InternalPipelines): void {
  p.chaos.destroy();
  p.density.destroy();
  p.viz.destroy();
}
