// pyr3 — viewer entry point.
//
// Boot WebGPU, mount the top bar, paint the default genome, then
// accept .flame files via the bar's Open button. Per the v1 design
// spec (docs/superpowers/specs/2026-05-26-pyr3-direction-design.md):
// no drag-drop, no `L` hotkey, no overlays on the rendered flame.

import { loadAvail, neighbors } from './avail-client';
import { loadGensManifest, resolveCorpusNeighbors } from './corpus-bounds';
import { fetchFlameXml, FlameNotFound } from './chunk-fetch';
import { initDevice, showError } from './device';
import { parseFlame } from './flame-import';
import {
  clampGalleryPage,
  coalesce,
  GALLERY_NAV_COALESCE_MS,
  mountGallery,
  pageForSheep,
  totalPagesFiltered,
  type GalleryMountHandle,
} from './gallery-mount';
import {
  countActiveAxes,
  DEFAULT_FILTER_SPEC,
  filterSpecEquals,
  type FilterSpec,
} from './gallery-filter';
import { computeFacetCounts } from './gallery-facets';
import { mountFilterDrawer, type FilterDrawerHandle } from './gallery-filter-ui';
import { loadFeatureIndex } from './feature-index-client';
import { distinctVariationNames, SPIRAL_GALAXY, type Genome } from './genome';
import {
  corpusUrl,
  galleryUrl,
  GALLERY_PAGE_SIZE,
  HERO_GEN,
  HERO_ID,
  parseLoadIntent,
  type LoadIntent,
} from './load-intent';
import { load as loadFileFromUser, type LoadResult } from './loader';
import { applyPreset, DEFAULT_TIER, QUALITY_TIERS, tierToSpec, type PresetSpec, type QualityRequest } from './presets';
import { pickSurpriseFlame } from './viewer-dice';
import { startChunkedRender, startDecoupledRender, type RunHandle } from './render-orchestrator';
import { createRenderer, DEFAULT_FILTER_RADIUS, type Renderer } from './renderer';
import {
  mountBar,
  mountGalleryBar,
  type BarHandle,
  type CorpusNav,
  type CostEstimate,
  type GalleryBarHandle,
} from './ui-bar';
import { checkWebGPU } from './webgpu-check';

// The "welcome flame" — the bundled fixture `/` paints for an instant,
// chunk-free first paint. It's the hero sheep (gen HERO_GEN / id HERO_ID); the
// filename is derived from those constants so the bundled copy can never drift
// from the corpus URL the bare root forwards to. The specific flame was
// hand-picked from the Electric Sheep Fold (ESF) corpus.
const WELCOME_FLAME_URL = `${import.meta.env.BASE_URL}fixtures/electricsheep.${HERO_GEN}.${HERO_ID}.flam3`;

const RENDER_SIZE = 1024;

// Quick-preview render caps. Many .flam3 files (especially Electric
// Sheep / JWildfire pieces) ship with offline-rendering presets:
// `size="4096 4096"`, `quality="1000"`, `oversample="4"` are common.
// Those settings combine to ~256× more GPU work than the quick view
// needs — heavy enough to lock the browser. Quick caps:
//   · max(width, height) ≤ QUICK_MAX_DIM, aspect preserved
//   · quality clamped to QUICK_MAX_SPP
//   · oversample forced to QUICK_OVERSAMPLE
// The 4K render path is BE-only (see bin/pyr3-render.ts --preset 4k;
// the pre-v0.20 wrapper script scripts/pyr3-023-be-render-4k.mjs was
// graduated into src/presets.ts) — FE viewer is interactive at
// quick quality only. PYR3-023 probe found that FE 4K crashes Chrome
// for ~40% of showcase fixtures + runs 13× slower than BE when it
// doesn't crash; the showcase ships as static pre-rendered 4K JPGs
// per the predecessor renderer's pattern.
const QUICK_MAX_DIM = 1024;
const QUICK_MAX_SPP = 16;
const QUICK_OVERSAMPLE = 1;

// #2: name the browser tab after the current flame so a bookmark / shared link
// auto-titles itself. Corpus sheep → `pyr3 — 248/23674`; file-opened flames →
// `pyr3 — <flame name>`; bare default → `pyr3`. Updated on every load + popstate.
function setDocTitle(label: string | null): void {
  document.title = label ? `pyr3 — ${label}` : 'pyr3';
}

// Compact `gen/id` label for the document title (id zero-padded to 5, matching
// the corpus URL + nav-pill formatting).
function corpusTitleLabel(gen: number, id: number): string {
  return `${gen}/${String(id).padStart(5, '0')}`;
}

async function main(): Promise<void> {
  const webgpu = await checkWebGPU();

  // First-paint cue ("dreaming…" in index.html) — cleared once the first
  // flame paints, so the visitor sees the engine is alive on a cold load.
  let firstPaintDone = false;
  const clearFirstPaintCue = (): void => {
    if (firstPaintDone) return;
    firstPaintDone = true;
    const cue = document.getElementById('pyr3-firstpaint');
    if (cue) {
      cue.classList.add('hidden');
      setTimeout(() => cue.remove(), 450);
    }
  };

  let openFilePicker: () => void = () => {
    console.warn('pyr3: file picker invoked before canvas init');
  };
  // Forwarding ref: the quality render closure is defined after the bar mounts
  // (it needs the renderer + device), so the ladder calls through this.
  let renderQualityFn: (req: QualityRequest) => void = () => {
    console.warn('pyr3: quality render invoked before canvas init');
  };
  // Forwarding ref: the Advanced row's live cost estimate (needs activeGenome
  // aspect + the device limit, both bound after init).
  let estimateCostFn: (longEdge: number, spp: number) => CostEstimate = () => ({
    width: 0,
    height: 0,
    mb: 0,
    fits: false,
  });
  // Forwarding ref: corpus prev/next nav (PYR3-041) is defined after the load
  // helpers exist; the action-bar pills call through this.
  let navigateCorpus: (gen: number, id: number) => void = () => {
    console.warn('pyr3: corpus navigate invoked before canvas init');
  };
  // Forwarding ref: #22 — the canvas isn't bound until initDevice resolves, so
  // the Save click routes through this shim until the real downloader replaces it.
  let saveCanvas: (filename: string) => void = () => {
    console.warn('pyr3: save invoked before canvas init');
  };

  const bar: BarHandle = mountBar(document.getElementById('pyr3-bar')!, {
    webgpu,
    onOpenFile: () => openFilePicker(),
    onRenderQuality: (req) => renderQualityFn(req),
    onNavigate: (gen, id) => navigateCorpus(gen, id),
    estimateCost: (longEdge, spp) => estimateCostFn(longEdge, spp),
    onSave: (filename) => saveCanvas(filename),
    onSurpriseMe: () => {
      // #23: pick a flame from the corpus weighted by interestingness +
      // navigate to it. The first click awaits the feature-index load
      // (cached for the gallery too, so usually already in memory);
      // subsequent clicks are sync-cheap. Reuses the existing /v1/gen/...
      // corpus-load path so the dice click is indistinguishable from a
      // manual share-link visit.
      void pickSurpriseFlame().then((pick) => {
        if (pick === null) return;
        navigateCorpus(pick.gen, pick.id);
      });
    },
  });

  if (!webgpu.available) {
    const detail = webgpu.detail ? `, ${webgpu.detail}` : '';
    console.warn(`pyr3: WebGPU unavailable (reason=${webgpu.reason}${detail})`);
    mountWebGPUFallback();
    bar.setBusy(true);
    return;
  }

  const { device, context, format, canvas } = await initDevice('pyr3-canvas');
  canvas.width = RENDER_SIZE;
  canvas.height = RENDER_SIZE;

  const renderer: Renderer = createRenderer(device, format, {
    width: RENDER_SIZE,
    height: RENDER_SIZE,
    oversample: QUICK_OVERSAMPLE,
    filterRadius: DEFAULT_FILTER_RADIUS,
  });

  // #22: wire the Save click to a canvas.toBlob download with the bar's
  // suggested filename. The WebGPU canvas's swap-chain texture is read back
  // directly by toBlob (verified in current Chrome — the earlier "not
  // readable post-render" note was stale once WebGPU canvas snapshotting
  // landed). A null blob (toBlob can fail on a clobbered swap-chain) surfaces
  // as a toast rather than a silent no-op.
  saveCanvas = (filename) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        bar.showToast('Save failed — canvas was not snapshottable');
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 0);
    }, 'image/png');
  };

  const seed = (Math.random() * 0xffffffff) >>> 0;
  let activeGenome: Genome = SPIRAL_GALAXY;

  let runHandle: RunHandle | null = null;
  // #8: true for the duration of a quality-ladder / custom (e.g. 4K) render.
  // Corpus loads track their own in-flight state via loadInFlight; this covers
  // the standalone ladder path so arrow-key / pill nav can't queue behind a
  // heavy render that was started without a flame load.
  let renderInFlight = false;

  // Sticky quality: the tier/custom the user last chose persists across corpus
  // nav + file loads (PYR3-050) — every load re-renders at this quality, not a
  // reset to Preview. The render-progress bar is the "this is heavy" signal.
  // Defaults to Preview so cold browsing stays fast until the user opts up.
  let currentQuality: QualityRequest = { kind: 'tier', tier: DEFAULT_TIER };

  // PYR3-018 FE parity sweep: pixel-readback hook (dev-only).
  // The canvas swap-chain texture is single-frame-presented and not
  // readable via drawImage / toDataURL post-render. This hook mirrors
  // the CLI readback (bin/pyr3-render.ts §5): allocate an offscreen
  // texture with COPY_SRC, re-present the existing accumulated
  // histogram into it (renderer.present is cheap; iteration state is
  // preserved), copyTextureToBuffer → mapAsync → return RGBA bytes.
  let lastRenderInfo: { genome: Genome; totalSamples: number } | null = null;
  if (import.meta.env.DEV) {
    (window as unknown as {
      __pyr3CapturePixels?: () => Promise<{ width: number; height: number; rgba: Uint8ClampedArray; format: GPUTextureFormat }>;
    }).__pyr3CapturePixels = async () => {
      if (!lastRenderInfo) {
        throw new Error('__pyr3CapturePixels: no render to capture (load a flame first)');
      }
      const { genome, totalSamples } = lastRenderInfo;
      const W = renderer.width;
      const H = renderer.height;
      const tex = device.createTexture({
        label: 'pyr3.capture.output',
        size: { width: W, height: H },
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      renderer.present({ genome, outputView: tex.createView(), totalSamples, forceDeOff: false });
      const bytesPerPixel = 4;
      const unpaddedBytesPerRow = W * bytesPerPixel;
      const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
      const readBuf = device.createBuffer({
        label: 'pyr3.capture.readback',
        size: bytesPerRow * H,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = device.createCommandEncoder({ label: 'pyr3.capture.encoder' });
      encoder.copyTextureToBuffer(
        { texture: tex },
        { buffer: readBuf, bytesPerRow, rowsPerImage: H },
        { width: W, height: H },
      );
      device.queue.submit([encoder.finish()]);
      await readBuf.mapAsync(GPUMapMode.READ);
      const padded = new Uint8Array(readBuf.getMappedRange().slice(0));
      readBuf.unmap();
      tex.destroy();
      readBuf.destroy();
      // Strip row padding to tight RGBA, swap channels if needed (Chrome's
      // preferred canvas format is bgra8unorm on macOS — our pipeline target
      // matches, but parity comparison + PNG encoding expects RGBA).
      const tight = new Uint8ClampedArray(W * H * 4);
      const swapBR = format === 'bgra8unorm';
      for (let y = 0; y < H; y++) {
        const srcOff = y * bytesPerRow;
        const dstOff = y * unpaddedBytesPerRow;
        if (swapBR) {
          for (let x = 0; x < W; x++) {
            const s = srcOff + x * 4;
            const d = dstOff + x * 4;
            tight[d] = padded[s + 2]!;   // R ← B
            tight[d + 1] = padded[s + 1]!; // G
            tight[d + 2] = padded[s]!;     // B ← R
            tight[d + 3] = padded[s + 3]!; // A
          }
        } else {
          tight.set(padded.subarray(srcOff, srcOff + unpaddedBytesPerRow), dstOff);
        }
      }
      return { width: W, height: H, rgba: tight, format };
    };
  }

  // PYR3-027 perf A/B: drive the orchestrator with explicit knob
  // overrides on the last-rendered genome, holding total GPU samples
  // constant so only orchestration overhead varies. Awaits a full GPU
  // queue drain so wallMs is GPU-finished wall-clock, not JS-queue time.
  // Load a flame before calling. Dev-only.
  if (import.meta.env.DEV) {
    (window as unknown as {
      __pyr3Bench?: (cfg: {
        targetSamples?: number;
        samplesPerChunk?: number;
        presentEach?: boolean;
        yieldEveryNChunks?: number;
      }) => Promise<{ result: string; chunks: number; targetSamples: number; wallMs: number }>;
    }).__pyr3Bench = async (cfg) => {
      if (!lastRenderInfo) {
        throw new Error('__pyr3Bench: no render to bench (load a flame first)');
      }
      // Cancel any in-flight production render so it doesn't contend.
      if (runHandle) {
        runHandle.cancel();
        await runHandle.promise;
        runHandle = null;
      }
      await device.queue.onSubmittedWorkDone();
      const genome = lastRenderInfo.genome;
      const targetSamples = cfg.targetSamples ?? lastRenderInfo.totalSamples;
      const spc = cfg.samplesPerChunk ?? 1_000_000;
      const chunks = Math.max(1, Math.ceil(targetSamples / spc));
      const t0 = performance.now();
      const handle = startChunkedRender({
        renderer,
        genome,
        outputViewProvider: () => context.getCurrentTexture().createView(),
        targetSamples,
        seedBase: seed,
        onProgress: () => {},
        presentAfterEachChunk: cfg.presentEach,
        samplesPerChunk: cfg.samplesPerChunk,
        yieldEveryNChunks: cfg.yieldEveryNChunks,
      });
      const result = await handle.promise;
      await device.queue.onSubmittedWorkDone();
      const wallMs = performance.now() - t0;
      return { result, chunks, targetSamples, wallMs };
    };
  }

  // PYR3-027 Option 1 prototype: decoupled display/dispatch render driven
  // against the REAL canvas so the refinement is watchable in Chrome.
  // Counts display presents so we can confirm refinement frames land at
  // the display cadence rather than per-dispatch. Dev-only.
  if (import.meta.env.DEV) {
    (window as unknown as {
      __pyr3Decoupled?: (cfg?: {
        targetSamples?: number;
        samplesPerDispatch?: number;
        displayIntervalMs?: number;
        cheapPreview?: boolean;
      }) => Promise<{ result: string; targetSamples: number; wallMs: number }>;
    }).__pyr3Decoupled = async (cfg = {}) => {
      if (!lastRenderInfo) {
        throw new Error('__pyr3Decoupled: no render to drive (load a flame first)');
      }
      if (runHandle) {
        runHandle.cancel();
        await runHandle.promise;
        runHandle = null;
      }
      await device.queue.onSubmittedWorkDone();
      const genome = lastRenderInfo.genome;
      const targetSamples = cfg.targetSamples ?? lastRenderInfo.totalSamples;
      const t0 = performance.now();
      const handle = startDecoupledRender({
        renderer,
        genome,
        outputViewProvider: () => context.getCurrentTexture().createView(),
        targetSamples,
        seedBase: seed,
        onProgress: () => {},
        samplesPerDispatch: cfg.samplesPerDispatch,
        displayIntervalMs: cfg.displayIntervalMs,
        cheapPreview: cfg.cheapPreview,
      });
      const result = await handle.promise;
      await device.queue.onSubmittedWorkDone();
      const wallMs = performance.now() - t0;
      return { result, targetSamples, wallMs };
    };
  }

  const rerender = async (): Promise<void> => {
    // Cancel any in-flight orchestrator before starting a new one. The
    // promise still settles cleanly (either 'cancelled' or 'completed')
    // so awaiting it serializes the JS side.
    if (runHandle) {
      runHandle.cancel();
      await runHandle.promise;
      runHandle = null;
      // Drain pending GPU before we potentially resize.
      await device.queue.onSubmittedWorkDone();
    }

    // Quick-preview sizing: cap at QUICK_MAX_DIM long-edge (no upscale
    // of small genomes — preview snappy). The 4K render path lives in
    // the BE CLI (bin/pyr3-render.ts) per PYR3-023 — FE viewer is
    // interactive at quick quality only.
    const declW = activeGenome.size?.width ?? RENDER_SIZE;
    const declH = activeGenome.size?.height ?? RENDER_SIZE;
    const maxDecl = Math.max(declW, declH);
    const sizeScale = maxDecl > QUICK_MAX_DIM ? QUICK_MAX_DIM / maxDecl : 1;
    const targetW = Math.max(1, Math.round(declW * sizeScale));
    const targetH = Math.max(1, Math.round(declH * sizeScale));
    const targetFilter = activeGenome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;

    if (
      targetW !== renderer.width
      || targetH !== renderer.height
      || QUICK_OVERSAMPLE !== renderer.oversample
      || targetFilter !== renderer.filterRadius
    ) {
      canvas.width = targetW;
      canvas.height = targetH;
      renderer.resize({ width: targetW, height: targetH, oversample: QUICK_OVERSAMPLE, filterRadius: targetFilter });
    }

    const renderGenome: Genome = {
      ...activeGenome,
      scale: activeGenome.scale * sizeScale,
      // CRITICAL: keep `genome.oversample` aligned with the pipeline's
      // configured oversample. chaos.ts computes the WGSL scale uniform as
      // `g.scale * g.oversample` — if the pipeline is built at oversample=1
      // but g.oversample stays at the genome's declared supersample
      // (often 4 for ES flames), the projection over-zooms by that factor,
      // producing the "camera stuck at the middle point" over-zoom symptom.
      oversample: QUICK_OVERSAMPLE,
      quality: Math.min(activeGenome.quality ?? QUICK_MAX_SPP, QUICK_MAX_SPP),
    };
    const targetSamples = (renderGenome.quality ?? QUICK_MAX_SPP) * renderer.width * renderer.height;

    // Tier 3 mounts immediately on render start — visitor always sees
    // "this is working" + "N% / chunk M of K". Hides on completion.
    bar.showProgress({
      label: 'Rendering',
      percent: 0,
      etaSeconds: 0,
      samples: 0,
      onCancel: () => runHandle?.cancel(),
    });

    const handle = startChunkedRender({
      renderer,
      genome: renderGenome,
      outputViewProvider: () => context.getCurrentTexture().createView(),
      targetSamples,
      seedBase: seed,
      onProgress: (info) => {
        bar.showProgress({
          label: 'Rendering',
          percent: info.percent,
          etaSeconds: info.etaSeconds,
          samples: info.samples,
          onCancel: () => runHandle?.cancel(),
        });
      },
    });
    runHandle = handle;
    if (import.meta.env.DEV) {
      (window as unknown as { __pyr3LastHandle?: RunHandle }).__pyr3LastHandle = handle;
    }
    // PYR3-018 capture hook reads from the post-render histogram via
    // renderer.present(). Stash genome + sample count so the hook can
    // re-present into an offscreen texture without re-iterating.
    lastRenderInfo = { genome: renderGenome, totalSamples: targetSamples };

    try {
      await handle.promise;
    } finally {
      bar.hideProgress();
      clearFirstPaintCue();
      if (runHandle === handle) runHandle = null;
      // Initial/default paint is the Preview tier — reflect it in the readout.
      bar.setQuality({
        width: renderer.width,
        height: renderer.height,
        spp: renderGenome.quality ?? QUICK_MAX_SPP,
        tierLabel: DEFAULT_TIER.name,
      });
    }
  };

  // PYR3-027: render the CURRENT flame at 4K via the decoupled
  // orchestrator, so the visitor can watch a heavy render build
  // progressively in the browser. This is exactly where the decoupled
  // design pays off — fat back-to-back dispatches keep iteration
  // throughput high while the display loop presents the accumulating
  // histogram on a steady frame cadence (cheap DE-off previews
  // mid-build, one full-DE present at the end).
  //
  // 4K @ oversample 1 → histogram = longEdge·shortEdge·4ch·4B. For a
  // 16:9 flame that's ~126 MB; a square flame is ~226 MB. The
  // capability guard below aborts (with a toast) when the device's
  // maxStorageBufferBindingSize can't fit it, rather than crashing the
  // tab. This reverses the PYR3-023 FE-4K removal: that removal was the
  // CHUNKED orchestrator (1887 rAF/present chunks) plus oversample-4
  // (16× the histogram); the decoupled path + oversample 1 avoid both.
  const HIST_BYTES_PER_CELL = 4 * 4; // 4 channels (R,G,B,count) × 4 bytes
  // Render the current flame at a chosen quality — a preset tier or a custom
  // resolution/SPP (PYR3-050). Generalizes the old 4K path: applyPreset()
  // resolves dims/aspect/quality from the request's PresetSpec (so FE + CLI
  // share the math), the capability guard aborts when the histogram won't fit,
  // and the info-bar readout updates on completion. 4K is just the top tier.
  const renderQuality = async (req: QualityRequest): Promise<void> => {
    // Remember this choice so it persists across the next corpus nav / load.
    currentQuality = req;
    // Disable the ladder synchronously BEFORE the first await, so a double-tap
    // during the cancel/drain can't spawn a second concurrent render. The
    // renderInFlight flag (also set synchronously) gates corpus nav for #8.
    renderInFlight = true;
    bar.setBusy(true);
    if (runHandle) {
      runHandle.cancel();
      await runHandle.promise;
      runHandle = null;
      await device.queue.onSubmittedWorkDone();
    }

    const spec: PresetSpec = req.kind === 'tier'
      ? tierToSpec(req.tier)
      : { maxDim: req.longEdge, maxSpp: req.spp, oversample: 1, shortEdgeRound: 'floor', mode: 'force' };
    const tierLabel = req.kind === 'tier' ? req.tier.name : 'Custom';

    // applyPreset resolves size (long-edge → native aspect), scale, oversample(1)
    // and capped quality — identical math to the CLI presets.
    const renderGenome = applyPreset(activeGenome, spec);
    const targetW = renderGenome.size?.width ?? RENDER_SIZE;
    const targetH = renderGenome.size?.height ?? RENDER_SIZE;
    const spp = renderGenome.quality ?? spec.maxSpp;
    const targetFilter = activeGenome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;

    // Capability guard — never allocate a histogram the GPU can't bind.
    const histBytes = targetW * targetH * HIST_BYTES_PER_CELL;
    const maxBind = device.limits.maxStorageBufferBindingSize;
    if (histBytes > maxBind) {
      const mb = (n: number): string => `${(n / (1024 * 1024)).toFixed(0)} MB`;
      console.warn(
        `pyr3: ${tierLabel} render skipped — histogram ${mb(histBytes)} exceeds this GPU's max storage buffer ${mb(maxBind)}`,
      );
      bar.showToast(`${tierLabel} too large for this GPU (needs ${mb(histBytes)})`);
      bar.setBusy(false); // re-enable — we never started a render
      renderInFlight = false;
      return;
    }

    if (
      targetW !== renderer.width
      || targetH !== renderer.height
      || renderer.oversample !== 1
      || targetFilter !== renderer.filterRadius
    ) {
      canvas.width = targetW;
      canvas.height = targetH;
      renderer.resize({ width: targetW, height: targetH, oversample: 1, filterRadius: targetFilter });
    }

    const targetSamples = spp * renderer.width * renderer.height;
    console.log(
      `pyr3: ${tierLabel} decoupled render — ${renderer.width}×${renderer.height} · q${spp} · ${(targetSamples / 1e6).toFixed(0)}M samples`,
    );

    bar.showProgress({
      label: `Rendering ${tierLabel}`,
      percent: 0,
      etaSeconds: 0,
      samples: 0,
      onCancel: () => runHandle?.cancel(),
    });

    const handle = startDecoupledRender({
      renderer,
      genome: renderGenome,
      outputViewProvider: () => context.getCurrentTexture().createView(),
      targetSamples,
      seedBase: seed,
      onProgress: (info) => {
        bar.showProgress({
          label: `Rendering ${tierLabel}`,
          percent: info.percent,
          etaSeconds: info.etaSeconds,
          samples: info.samples,
          onCancel: () => runHandle?.cancel(),
        });
      },
    });
    runHandle = handle;
    lastRenderInfo = { genome: renderGenome, totalSamples: targetSamples };

    try {
      await handle.promise;
    } finally {
      bar.hideProgress();
      bar.setBusy(false);
      renderInFlight = false;
      clearFirstPaintCue();
      if (runHandle === handle) runHandle = null;
      bar.setQuality({ width: renderer.width, height: renderer.height, spp, tierLabel });
    }
  };

  // Wire the bar's quality ladder (and a dev-only console hook) to the render
  // closure now that it's defined.
  renderQualityFn = (req) => { void renderQuality(req); };
  if (import.meta.env.DEV) {
    (window as unknown as { __pyr3RenderQuality?: (req: QualityRequest) => Promise<void> }).__pyr3RenderQuality = renderQuality;
  }

  // Advanced-row cost estimate: resolve dims via applyPreset (identical to the
  // render path) then size the histogram against the GPU's binding limit, so
  // the readout/✗-gate matches what renderQuality's guard would decide.
  estimateCostFn = (longEdge, spp) => {
    const spec: PresetSpec = { maxDim: longEdge, maxSpp: spp, oversample: 1, shortEdgeRound: 'floor', mode: 'force' };
    const g = applyPreset(activeGenome, spec);
    const width = g.size?.width ?? RENDER_SIZE;
    const height = g.size?.height ?? RENDER_SIZE;
    const bytes = width * height * HIST_BYTES_PER_CELL;
    return {
      width,
      height,
      mb: bytes / (1024 * 1024),
      fits: bytes <= device.limits.maxStorageBufferBindingSize,
    };
  };

  const applyLoadResult = async (result: LoadResult, sourceLabel: string): Promise<void> => {
    // Resize logic lives in rerender (it depends on the loaded genome's
    // dims); applyLoadResult just updates activeGenome + meta then kicks
    // the render path, which resizes if needed.
    activeGenome = result.genome;
    if (result.kind === 'flame' && result.report) {
      const dropCount = result.report.droppedVariations.length;
      const ignoredCount = result.report.ignoredFields.length;
      const defaulted = result.report.defaultedFields;
      if (dropCount > 0 || ignoredCount > 0 || defaulted.length > 0) {
        console.log(
          `pyr3: import report — ${dropCount} unsupported variations · ${ignoredCount} ignored fields · ${defaulted.length} defaulted fields`,
        );
      }
      // #9: malformed scalars (e.g. NaN center/scale — 286 corpus flames) were
      // substituted with real defaults so the flame still renders. Surface it
      // loudly in-app so the user knows the framing/scale was synthesized.
      if (defaulted.length > 0) {
        const fields = defaulted.map((d) => d.field).join(', ');
        bar.showToast(`Some values were missing (${fields}) — loaded with defaults.`);
      }
    }
    console.log(`pyr3: loaded "${result.genome.name}" from ${sourceLabel}`);
    // Flame-name fallback ladder: XML `name` attr first; then the source
    // file's basename (stripped of .flam3 / .flame); then a sane default.
    // Without this the Save filename would read `imported.png` (or
    // `Untitled.png`) for corpus sheep whose XML lacks `name` — even though
    // the canonical `electricsheep.<gen>.<id>` label is right in the
    // sourceLabel that loadCorpus hands us.
    const sourceBase = sourceLabel.replace(/\.(flam3|flame)$/i, '');
    bar.setMeta({
      flameName: result.genome.name || sourceBase || 'Untitled',
      authorNick: result.genome.nick,
      sourceFilename: sourceLabel,
    });
    // #5: surface the flame's distinct variation set after the tier label.
    bar.setVariations(distinctVariationNames(result.genome));
    // Render at the sticky quality (PYR3-050) — persists the user's tier/custom
    // choice across nav + loads. Preview-default uses the fast chunked rerender
    // (the FE↔BE parity path); higher tiers / custom use the decoupled path.
    if (currentQuality.kind === 'tier' && currentQuality.tier.name === DEFAULT_TIER.name) {
      await rerender();
    } else {
      await renderQuality(currentQuality);
    }
  };

  // Graceful corpus missing-sheep panel (PYR3-039). Built once; covers the
  // canvas while keeping all three bars. Hidden whenever a real flame loads.
  const missingPanel = makeMissingPanel();

  let loadInFlight = false;
  const loadFromFile = async (file: File): Promise<void> => {
    console.log(`pyr3: loadFromFile("${file.name}") · loadInFlight=${loadInFlight}`);
    if (loadInFlight) {
      console.warn(`pyr3: load already in flight; ignoring ${file.name}`);
      return;
    }
    missingPanel.hide(); // a real flame is loading — clear any missing state
    loadInFlight = true;
    bar.setBusy(true);
    try {
      const result = await loadFileFromUser(file);
      await applyLoadResult(result, file.name);
      // Wait for the GPU to drain the queued work before releasing the
      // loadInFlight guard. The orchestrator's promise resolves when
      // JS-side iterate calls finish; GPU may still be processing.
      // Without this drain, the NEXT load's renderer.resize() can
      // destroyPipelines() while previous commands still reference
      // those buffers (Phase 2 verify, 2026-05-26).
      await device.queue.onSubmittedWorkDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`pyr3: failed to load ${file.name}: ${msg}`);
      // #9: surface the failure in-viewer (not just the console) with a
      // report-an-issue affordance. The canvas keeps its prior content behind
      // the panel; the bars stay live so the user can navigate away. The raw
      // `msg` stays in the console (logged above) — the panel copy is kept
      // high-level.
      missingPanel.showLoadError(file.name);
    } finally {
      // Clear the first-paint cue even if the (initial) load threw before
      // rerender() ran — otherwise "dreaming…" would stick on a black canvas.
      // Idempotent via the firstPaintDone guard.
      clearFirstPaintCue();
      bar.setBusy(false);
      loadInFlight = false;
    }
  };

  // PYR3-026 FE↔BE parity rig: programmatic flame-load hook (dev-only).
  // Mirrors the file-picker path (loadFromFile → applyLoadResult →
  // rerender) but takes raw text so Playwright can inject each fixture
  // without touching the OS file dialog. Serialized via an internal
  // queue so the test rig's `__pyr3LoadFlame(A); __pyr3LoadFlame(B)`
  // sequence does NOT hit loadFromFile's in-flight rejection — and
  // waits for the initial welcome-flame load to settle before its
  // first call. Awaiting resolves once the render completes (rerender
  // awaits the orchestrator promise).
  let loadHookQueue: Promise<void> = Promise.resolve();
  if (import.meta.env.DEV) {
    (window as unknown as {
      __pyr3LoadFlame?: (text: string, label?: string) => Promise<void>;
    }).__pyr3LoadFlame = (text: string, label = 'test.flame') => {
      const next = loadHookQueue.then(async () => {
        // If a non-hook caller (welcome flame, file picker) is still
        // in flight, wait it out — loadFromFile would otherwise reject.
        while (loadInFlight) {
          await new Promise((r) => setTimeout(r, 25));
        }
        const file = new File([text], label, { type: 'text/xml' });
        await loadFromFile(file);
      });
      loadHookQueue = next.catch(() => {});
      return next;
    };
  }

  openFilePicker = (): void => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.flame,.flam3';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (file) {
        await loadFromFile(file);
        setNav(null); // user-opened file is not a corpus sheep
        setDocTitle(activeGenome.name || null); // #2: tab named after the flame
      }
      input.remove();
    });
    // Chrome 113+ fires `cancel` when the OS dialog is dismissed without a
    // selection — without this listener, hidden inputs accumulate on cancel.
    input.addEventListener('cancel', () => input.remove());
    document.body.appendChild(input);
    input.click();
  };

  // ── Corpus navigation (PYR3-041) ──
  // Load a sheep by (gen, id) and refresh the action-bar prev/next cluster from
  // the gen's availability manifest. `push` controls History (false for the
  // initial load + popstate; true for in-app nav clicks).
  // Current corpus-nav context (#8): the arrow-key handler reads this to decide
  // whether ←/→ have anywhere to go. Kept in sync with the action-bar pills via
  // setNav — null whenever the loaded flame isn't a corpus sheep.
  let currentNav: CorpusNav | null = null;
  const setNav = (nav: CorpusNav | null): void => {
    currentNav = nav;
    bar.setCorpusNav(nav);
  };

  const updateCorpusNav = async (gen: number, id: number): Promise<void> => {
    // #38: cross-gen resolution lets out-of-corpus URLs (gen=0, gen=999, id past
    // a gen's max) still surface a logical prev/next on the action bar instead
    // of dead-ending. In-gen lookups remain authoritative when both sides exist.
    const { prev, next } = await resolveCorpusNeighbors(
      gen,
      id,
      loadAvail,
      loadGensManifest,
      neighbors,
    );
    setNav({ gen, prev, next });
    // v1.2 contextual gallery entry — the viewer's `gallery` link points at
    // the page containing the current sheep, so flipping into the gallery
    // lands on the neighborhood instead of page 1.
    void pageForSheep(gen, id).then((page) => bar.setGalleryHref(page));
  };

  const loadCorpus = async (gen: number, id: number, push: boolean): Promise<void> => {
    // Wait out any in-flight load (e.g. a multi-second 4K render drain or a
    // file-picker load) BEFORE mutating history — otherwise loadFromFile's
    // in-flight guard would silently drop this load while the URL + nav still
    // advanced, desyncing them from the canvas. Mirrors __pyr3LoadFlame.
    while (loadInFlight) {
      await new Promise((r) => setTimeout(r, 25));
    }
    if (push) {
      history.pushState({ gen, id }, '', corpusUrl(gen, id));
    }
    // #2: name the tab after the navigated sheep (reflects the coord regardless
    // of whether the flame loads or turns out to be missing).
    setDocTitle(corpusTitleLabel(gen, id));
    let xml: string | null = null;
    try {
      xml = await fetchFlameXml(gen, id);
    } catch (err) {
      // FlameNotFound → graceful in-viewer missing state (PYR3-039/040); a
      // genuine fetch/network error is logged but presents the same panel
      // (nav still lets the user escape) rather than a hard crash.
      if (!(err instanceof FlameNotFound)) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`pyr3: corpus fetch failed for gen ${gen} sheep ${id} — ${msg}`);
      }
      xml = null;
    }

    if (xml === null) {
      // Hero fallback (A2 root-forward): the hero sheep ships as a bundled
      // fixture, so a refresh / Back to its forwarded URL stays instant and
      // dev-safe even when the chunk pipeline is unavailable (PYR3-048). Only the
      // hero gets this — every other id keeps the honest missing-sheep state.
      if (gen === HERO_GEN && id === HERO_ID) {
        const heroFile = await fetchAsFile(WELCOME_FLAME_URL);
        if (heroFile) {
          await loadFromFile(heroFile); // hides the missing panel on success
          await updateCorpusNav(gen, id);
          return;
        }
      }
      // Keep the chrome; do NOT swap to the welcome flame. Honest wording —
      // we only know it isn't in OUR corpus, not that it "never existed".
      missingPanel.show(gen, id);
      bar.setMeta({ flameName: `gen ${gen} · sheep ${id} — not in corpus` });
      bar.setVariations([]); // no genome loaded → clear any stale variation set
      await updateCorpusNav(gen, id); // offer prev/next available
      return;
    }

    const file = new File([xml], `electricsheep.${gen}.${id}.flam3`, { type: 'text/xml' });
    await loadFromFile(file); // hides the missing panel on success
    await updateCorpusNav(gen, id);
  };
  // Serialize ALL corpus loads through one promise chain so two rapid nav
  // clicks can't both pushState + advance the nav before either renders (the
  // while-loop above only waits if loadInFlight is ALREADY set, which a
  // concurrently-entering loadCorpus has not yet done). Same idiom as the
  // __pyr3LoadFlame loadHookQueue.
  let corpusQueue: Promise<void> = Promise.resolve();
  const enqueueCorpus = (gen: number, id: number, push: boolean): Promise<void> => {
    const next = corpusQueue.then(() => loadCorpus(gen, id, push));
    corpusQueue = next.catch(() => {}); // keep the chain alive past a failure
    return next;
  };
  // #8: a synchronous lock that engages the instant a nav is dispatched and
  // releases only when that load + its render fully settle — so rapid pill
  // clicks or arrow presses can't stack navigations behind the in-flight load.
  // (loadInFlight flips too late — only after the chunk fetch resolves, leaving
  // a window where several navs slip through and queue.) Also refuses while a
  // standalone quality-ladder render (e.g. 4K) is running.
  let navLocked = false;
  navigateCorpus = (gen, id) => {
    if (navLocked || renderInFlight) return;
    navLocked = true;
    void enqueueCorpus(gen, id, true).finally(() => { navLocked = false; });
  };
  // ── Gallery surface state (v1.2 #47) ──
  // When the gallery is active, the viewer bar's DOM is cleared and replaced
  // by the gallery bar; the canvas is hidden and the #pyr3-gallery container
  // takes its place. The shared `renderer` is resized to Draft-tier cell dims
  // (512²) when the gallery mounts. The gallery owns its own cancellation
  // state via galleryHandle.cancel() / setPage().
  let galleryHandle: GalleryMountHandle | null = null;
  let galleryBar: GalleryBarHandle | null = null;
  let galleryTotalPages = 0;
  let currentGalleryPage = 1;
  let currentSurface: 'viewer' | 'gallery' = 'viewer';
  // #49 Phase B: drawer beneath the gallery bar. Mounted in the gallery
  // surface, destroyed on cross-surface nav. Its DOM root is a sibling of
  // the bar root, inserted dynamically so index.html stays viewer-shaped.
  let drawerHandle: FilterDrawerHandle | null = null;
  let drawerRoot: HTMLElement | null = null;
  // #49 Phase B6: banner above the gallery grid, shown only when the current
  // filter narrows the corpus to 0 matches. Inserted as a sibling above
  // galleryDiv (mountGallery would wipe a child of galleryDiv on each
  // wave). main.ts shows/hides it from inside applyFilter.
  let emptyBanner: HTMLElement | null = null;
  // #49 Phase A: live FilterSpec the gallery surface is paging through. Set
  // from the initial URL via parseLoadIntent, mutated by popstate cross-spec
  // navigation, and by applyFilter (the seam Phase B's drawer will call).
  let currentFilter: FilterSpec = DEFAULT_FILTER_SPEC;
  // Lazy-loaded feature index — fetched on first need (gallery mount) and
  // memoized for the rest of the session. Phase A always loads it on the
  // gallery surface (even for the default filter), so totalPagesFiltered
  // shares the same index reference as runWave inside mountGallery.
  let featureIndexPromise: ReturnType<typeof loadFeatureIndex> | null = null;
  const ensureFeatureIndex = (): ReturnType<typeof loadFeatureIndex> => {
    if (featureIndexPromise === null) featureIndexPromise = loadFeatureIndex();
    return featureIndexPromise;
  };

  const galleryFetchGenome = async (gen: number, id: number): Promise<Genome | null> => {
    try {
      const xml = await fetchFlameXml(gen, id);
      return parseFlame(xml).genome;
    } catch (err) {
      // FlameNotFound is expected for sparse-corpus gaps — the cell renders
      // a "(missing)" placeholder. Any other failure is logged but treated
      // the same way so the wave-fill doesn't stall on one bad cell.
      if (!(err instanceof FlameNotFound)) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`pyr3 gallery: fetch ${gen}/${id} failed — ${msg}`);
      }
      return null;
    }
  };

  const computeGalleryTotalPages = async (): Promise<number> => {
    const manifest = await loadGensManifest();
    if (manifest === null) return 0;
    const totalSheep = manifest.gens.reduce((sum, g) => sum + g.count, 0);
    return Math.max(1, Math.ceil(totalSheep / GALLERY_PAGE_SIZE));
  };

  // Debounced commit — rapid ‹/› mashing keeps the bar's page label in
  // sync each click (instant visual feedback) but coalesces the canonical
  // commit (history.pushState + setDocTitle + galleryHandle.setPage) into
  // the final page so the back-stack doesn't fill with intermediate pages
  // that would each trigger a wave-fill on popstate. ≤100ms window.
  const flushGalleryCommit = coalesce((page: number) => {
    // Preserve the active filter on every page-nav — otherwise ‹/› clicks
    // would strip `?coverage=0.5&…` from the URL, lying about what's
    // applied. The grid would still render filtered (closure-captured
    // filter state survives), but a refresh after nav would blow it away.
    history.pushState({}, '', galleryUrl(page, currentFilter));
    setDocTitle(`gallery · p${page}`);
    void galleryHandle?.setPage(page);
  }, GALLERY_NAV_COALESCE_MS);

  const navGallery = (newPage: number): void => {
    if (galleryHandle === null || galleryBar === null) return;
    const clamped = clampGalleryPage(newPage, galleryTotalPages);
    if (clamped === currentGalleryPage) return;
    currentGalleryPage = clamped;
    // Bar label updates immediately so each click looks responsive; the
    // URL + title + render commit on the coalesced final value.
    galleryBar.setPage(clamped, galleryTotalPages);
    flushGalleryCommit(clamped);
  };

  // #49 Phase A seam — wired but not yet reachable from any UI control. The
  // FilterDrawer + sort picker (Phase B/C) will invoke this with the spec
  // they assemble. Keeping the function defined now means Phase B can import
  // it without restructuring main.ts. Early-out on equal specs so accidental
  // re-applies are free; on a real change we pushState (so Back returns to
  // the prior filter), then refresh totalPages + page the mount.
  const applyFilter = (nextFilter: FilterSpec): void => {
    if (filterSpecEquals(currentFilter, nextFilter)) return;
    currentFilter = nextFilter;
    history.pushState({}, '', galleryUrl(1, nextFilter));
    setDocTitle('gallery · p1');
    galleryBar?.setActiveAxes(countActiveAxes(nextFilter));
    drawerHandle?.setFilter(nextFilter);
    void ensureFeatureIndex().then((index) => {
      const counts = computeFacetCounts(index, nextFilter);
      galleryTotalPages = totalPagesFiltered(currentFilter, GALLERY_PAGE_SIZE, { index });
      galleryBar?.setPage(1, galleryTotalPages);
      currentGalleryPage = 1;
      drawerHandle?.setFacetCounts(counts);
      if (emptyBanner !== null) {
        emptyBanner.style.display = counts.total === 0 ? 'flex' : 'none';
      }
      void galleryHandle?.setPage(1, nextFilter);
    });
  };

  const mountGallerySurface = async (initialPage: number): Promise<void> => {
    // Parse the URL once more here so the FilterSpec the gallery actually
    // mounts with always tracks the live address bar — the caller (the
    // initial-load block at the bottom of main) passes `intent.page` but not
    // `intent.filter`, and a popstate-into-gallery (which today calls
    // location.reload — see the popstate handler) will land here too.
    const intent = parseLoadIntent(location.pathname + location.search);
    currentFilter = intent !== null && intent.kind === 'gallery'
      ? intent.filter
      : DEFAULT_FILTER_SPEC;

    canvas.hidden = true;
    const galleryDiv = document.getElementById('pyr3-gallery');
    if (galleryDiv === null) {
      console.error('pyr3 gallery: #pyr3-gallery missing from index.html');
      return;
    }
    galleryDiv.hidden = false;

    // Swap the bar — the viewer's BarHandle stays in memory but its DOM
    // is gone, so its setters become harmless no-ops until we swap back
    // (which today is via full page reload, not an inline remount).
    const barRoot = document.getElementById('pyr3-bar');
    if (barRoot === null) return;
    barRoot.replaceChildren();

    // Initial page clamped to a floor of 1; the real upper-bound clamp
    // happens after the index resolves below (totalPagesFiltered isn't
    // known yet). totalPages=0 displays "page N" (no "of M") until then.
    currentGalleryPage = Math.max(1, Math.floor(initialPage));
    currentSurface = 'gallery';
    setDocTitle(`gallery · p${currentGalleryPage}`);

    galleryBar = mountGalleryBar(barRoot, {
      webgpu,
      page: currentGalleryPage,
      totalPages: 0,
      onPrevPage: () => navGallery(currentGalleryPage - 1),
      onNextPage: () => navGallery(currentGalleryPage + 1),
      onRandomPage: () => {
        // 🎲 — gallery-internal jump to a random page. Distinct from the
        // viewer's dice (#23) which picks a random sheep + opens viewer.
        // No-op when totalPages is unknown (manifest fetch failed) so a
        // misclick doesn't navigate to a non-canonical URL.
        if (galleryTotalPages <= 0) return;
        const next = Math.floor(Math.random() * galleryTotalPages) + 1;
        navGallery(next);
      },
      activeAxes: countActiveAxes(currentFilter),
      onFilterToggle: () => drawerHandle?.toggleOpen(),
    });

    // #49 Phase B6 — mount drawer EAGERLY with loading=true, before
    // awaiting the index. On slow networks the visitor sees the drawer
    // outline + a "loading feature index…" banner instead of an empty bar.
    drawerRoot = document.createElement('div');
    drawerRoot.id = 'pyr3-gallery-filter-drawer-root';
    barRoot.insertAdjacentElement('afterend', drawerRoot);
    drawerHandle = mountFilterDrawer(drawerRoot, {
      initialFilter: currentFilter,
      facetCounts: {
        variations: new Map(), xforms: new Map(),
        coverage: new Map(), entropy: new Map(),
        colorVar: new Map(), meanLum: new Map(),
        total: 0,
      },
      onChange: (next) => applyFilter(next),
      loading: true,
    });

    // #49 Phase B6 — empty-state banner. Inserted as a sibling of
    // galleryDiv inside the canvas-zone (galleryDiv is position:absolute
    // overlaying the zone; the banner needs to overlay TOO so it's not
    // hidden behind the 3×3 empty cells). z-index above the grid so it
    // visually reads as the primary message. galleryDiv is wiped on every
    // mountGallery wave, but the banner — its sibling — survives.
    const canvasZone = galleryDiv.parentElement;
    if (emptyBanner === null && canvasZone !== null) {
      emptyBanner = document.createElement('div');
      emptyBanner.id = 'pyr3-gallery-empty-banner';
      const icon = document.createElement('div');
      icon.className = 'pyr3-empty-icon';
      icon.textContent = '∅';
      const headline = document.createElement('div');
      headline.className = 'pyr3-empty-headline';
      headline.textContent = 'no flames match the current filter';
      const hint = document.createElement('div');
      hint.className = 'pyr3-empty-hint';
      hint.append(
        document.createTextNode('try clearing variations or widening the xform range — or hit '),
        Object.assign(document.createElement('kbd'), { textContent: '✕ reset' }),
        document.createTextNode(' above.'),
      );
      emptyBanner.append(icon, headline, hint);
      Object.assign(emptyBanner.style, {
        display: 'none',
        position: 'absolute',
        inset: '0',
        zIndex: '5',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '24px',
        textAlign: 'center',
        fontFamily: 'ui-monospace, monospace',
        color: 'var(--accent, #ff8c1a)',
        background: 'rgba(10, 10, 12, 0.85)',
        pointerEvents: 'none',
      });
      // Inject one-shot styles for the inner pieces so we get bigger
      // typography on the headline + dimmer hint + a glyph block.
      if (document.getElementById('pyr3-empty-banner-styles') === null) {
        const style = document.createElement('style');
        style.id = 'pyr3-empty-banner-styles';
        style.textContent = `
#pyr3-gallery-empty-banner .pyr3-empty-icon { font-size: 48px; line-height: 1; opacity: 0.6; }
#pyr3-gallery-empty-banner .pyr3-empty-headline { font-size: 16px; font-weight: 600; letter-spacing: 0.02em; }
#pyr3-gallery-empty-banner .pyr3-empty-hint { font-size: 12px; color: var(--text-dim, #888); max-width: 36em; }
#pyr3-gallery-empty-banner kbd { background: var(--bar-bg-1, #15151a); border: 1px solid var(--bar-border, #2a2a30); padding: 1px 6px; border-radius: 3px; font-family: inherit; }
`;
        document.head.appendChild(style);
      }
      canvasZone.appendChild(emptyBanner);
    } else if (emptyBanner !== null) {
      emptyBanner.style.display = 'none';
    }

    // Now load the index + compute totals + counts. ensureFeatureIndex
    // memoizes, so subsequent applyFilter calls reuse this promise.
    const index = await ensureFeatureIndex();
    const counts = computeFacetCounts(index, currentFilter);
    galleryTotalPages = totalPagesFiltered(currentFilter, GALLERY_PAGE_SIZE, { index });

    const page = clampGalleryPage(currentGalleryPage, galleryTotalPages);
    // Self-consistency: if the URL contains unrecognized filter tokens
    // (typo'd variation name, malformed xforms, etc.), the parser drops
    // them silently — but the address bar would lie about what's applied.
    // Rewrite to the canonical form so what the visitor sees IS what's
    // actually filtering. Also covers the URL-out-of-range page clamp.
    const canonical = galleryUrl(page, currentFilter);
    if (canonical !== location.pathname + location.search) {
      history.replaceState({}, '', canonical);
    }
    currentGalleryPage = page;
    setDocTitle(`gallery · p${page}`);

    galleryBar.setPage(page, galleryTotalPages);
    drawerHandle.setFacetCounts(counts);
    drawerHandle.setLoading(false);
    if (emptyBanner !== null) {
      emptyBanner.style.display = counts.total === 0 ? 'flex' : 'none';
    }

    // QUALITY_TIERS[0] is the Draft tier (longEdge 512, spp 8) — the
    // intentional gallery cell quality per the spec.
    galleryHandle = await mountGallery(page, {
      renderer,
      device,
      format,
      container: galleryDiv,
      fetchGenome: galleryFetchGenome,
      draftTier: QUALITY_TIERS[0]!,
      index,
      initialFilter: currentFilter,
    });

    clearFirstPaintCue();
  };

  // Back/forward through history. Within a single surface (viewer or gallery)
  // we update in place; a cross-surface popstate triggers a full reload — the
  // cleanest correct path for v1 since the renderer + WebGPU state would need
  // a careful inline teardown otherwise. Cell-click cross-surface navigation
  // is also a full reload by design (anchor href, no preventDefault).
  window.addEventListener('popstate', () => {
    const i = parseLoadIntent(window.location.pathname + window.location.search);
    if (i === null) { window.location.reload(); return; }
    if (currentSurface === 'gallery' && i.kind === 'gallery') {
      // #49: cross-spec popstate (Back/Forward across a filter change) → adopt
      // the new filter + recompute totalPagesFiltered before paging the mount.
      // Same-spec / different-page popstate falls through to the page-only path.
      if (!filterSpecEquals(i.filter, currentFilter)) {
        currentFilter = i.filter;
        currentGalleryPage = i.page;
        setDocTitle(`gallery · p${i.page}`);
        void ensureFeatureIndex().then((index) => {
          galleryTotalPages = totalPagesFiltered(currentFilter, GALLERY_PAGE_SIZE, { index });
          galleryBar?.setPage(i.page, galleryTotalPages);
          void galleryHandle?.setPage(i.page, i.filter);
        });
        return;
      }
      currentGalleryPage = i.page;
      setDocTitle(`gallery · p${i.page}`);
      void galleryHandle?.setPage(i.page);
      galleryBar?.setPage(i.page, galleryTotalPages);
      return;
    }
    if (currentSurface === 'viewer' && i.kind === 'corpus') {
      void enqueueCorpus(i.gen, i.id, false);
      return;
    }
    window.location.reload();
  });

  // #8: ←/→ arrow keys browse the corpus prev/next — the same enqueueCorpus
  // path the action-bar pills drive. No-ops while a text field is focused, when
  // there's no corpus-nav context (file-opened / non-corpus flame), or — via
  // navigateCorpus's lock — while any load/render is in flight. Modifier combos
  // (e.g. ⌘← browser-back) are left to the browser.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    // Gallery mode: arrows page through the grid (same direction as the
    // ‹/› pills). navGallery handles clamping + coalesced render commit.
    if (currentSurface === 'gallery') {
      e.preventDefault();
      navGallery(currentGalleryPage + (e.key === 'ArrowLeft' ? -1 : 1));
      return;
    }
    if (!currentNav) return;
    // #38: prev/next now carry their own (gen, id) so the arrow keys cross
    // gen boundaries the same way the action-bar pills do.
    const target = e.key === 'ArrowLeft' ? currentNav.prev : currentNav.next;
    if (target === null) return;
    e.preventDefault();
    navigateCorpus(target.gen, target.id);
  });

  // Resolve initial load from the URL (parseLoadIntent): a /v1/gen/{gen}/id/{id}
  // corpus link (→ loadCorpus, wires nav) or default. Fallback chain is welcome
  // fixture → hardcoded SPIRAL_GALAXY (safety net if fetch fails).
  const intent = parseLoadIntent(window.location.pathname + window.location.search)
    ?? { kind: 'default' as const };
  if (intent.kind === 'gallery') {
    await mountGallerySurface(intent.page);
  } else if (intent.kind === 'corpus') {
    await enqueueCorpus(intent.gen, intent.id, false); // initial load: no pushState
  } else if (intent.kind === 'default') {
    // Bare root (A2 root-forward): rewrite the address bar to the canonical hero
    // corpus URL so the landing page is real, shareable and nav-wired — but keep
    // painting the BUNDLED fixture for an instant, chunk-free first paint instead
    // of routing through loadCorpus' chunk + brotli-wasm fetch (which would be
    // slower in prod and broken under `npm run dev`, PYR3-048). replaceState (not
    // push) so Back never lands on a bare-root entry that just re-forwards.
    history.replaceState({ gen: HERO_GEN, id: HERO_ID }, '', corpusUrl(HERO_GEN, HERO_ID));
    const heroFile = await fetchAsFile(WELCOME_FLAME_URL);
    if (heroFile) {
      await loadFromFile(heroFile);
      await updateCorpusNav(HERO_GEN, HERO_ID); // wire ‹ › (no-ops to empty if avail unavailable)
      setDocTitle(corpusTitleLabel(HERO_GEN, HERO_ID)); // #2: hero is a corpus sheep
    } else {
      console.warn('pyr3: welcome-flame fetch failed; painting SPIRAL_GALAXY default');
      bar.setMeta({ flameName: SPIRAL_GALAXY.name });
      bar.setVariations(distinctVariationNames(SPIRAL_GALAXY));
      setDocTitle(SPIRAL_GALAXY.name || null);
      await rerender();
    }
  } else {
    // Deferred views (gen-list / gen-browse / custom-reserved): paint the welcome
    // fixture as a placeholder, keep the URL as-is, no nav (no built gallery yet).
    const initialFile = await resolveLoadIntent(intent);
    if (initialFile) {
      await loadFromFile(initialFile);
      setNav(null); // non-corpus flame → hide nav
      setDocTitle(activeGenome.name || null); // #2
    } else {
      console.warn('pyr3: no initial load resolved; painting SPIRAL_GALAXY default');
      bar.setMeta({ flameName: SPIRAL_GALAXY.name });
      bar.setVariations(distinctVariationNames(SPIRAL_GALAXY));
      setDocTitle(SPIRAL_GALAXY.name || null);
      await rerender();
    }
  }

  console.log(
    `pyr3: ${renderer.width}×${renderer.height} (oversample ${renderer.oversample}), seed=0x${seed.toString(16).padStart(8, '0')} — click 📂 Open .flame in the bar to load a different flame.`,
  );
}

function mountWebGPUFallback(): void {
  const fallback = document.getElementById('pyr3-fallback');
  if (!fallback) return;
  document.body.classList.add('webgpu-unavailable');
  // DOM-build the explainer (createElement + textContent so no
  // innerHTML XSS surface).
  fallback.replaceChildren();
  const h2 = document.createElement('h2');
  h2.textContent = '⚠️ This browser can\'t run WebGPU';
  const p1 = document.createElement('p');
  p1.textContent = "pyr3 renders fractal flames using your GPU through the WebGPU web standard. Your current browser doesn't expose it — so there's no engine here to draw with.";
  const fixP = document.createElement('p');
  fixP.className = 'fix';
  const fixStrong = document.createElement('strong');
  fixStrong.textContent = 'Likely fix: ';
  fixP.append(fixStrong, document.createTextNode('Chrome 113+, Edge 113+, Safari 18+ on macOS Sequoia, or Firefox Nightly. Sometimes a flag toggle, sometimes a GPU-driver update.'));
  const ul = document.createElement('ul');
  for (const item of [
    'Chrome / Edge 113+ (auto-enabled)',
    'Safari 18+ on macOS Sequoia',
    'Firefox Nightly (behind dom.webgpu.enabled in about:config)',
  ]) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.append(li);
  }
  const cta = document.createElement('a');
  cta.className = 'cta';
  cta.href = `${import.meta.env.BASE_URL}help/webgpu.html#why-not-working`;
  cta.textContent = 'Read the full WebGPU help page ↗';
  fallback.append(h2, p1, ul, fixP, cta);
  fallback.hidden = false;
}

interface MissingPanel {
  show(gen: number, id: number): void;
  /** #9 — a real load failure (parse error, malformed genome, fetch error):
   *  paint a visible in-viewer panel with a "report an issue" affordance,
   *  rather than leaving the canvas unchanged with a console-only error. */
  showLoadError(label: string): void;
  hide(): void;
}

const ISSUES_URL = 'https://github.com/MattAltermatt/pyr3/issues';

/** Build the corpus missing-sheep / load-failure overlay once (PYR3-039 + #9).
 *  DOM-built (no innerHTML); covers the canvas, keeps the bars, offers escape
 *  via the nav (missing) or a report-an-issue link (load failure). */
function makeMissingPanel(): MissingPanel {
  const zone = document.getElementById('pyr3-canvas-zone');
  const root = document.createElement('div');
  root.id = 'pyr3-missing';
  root.hidden = true;
  const coord = document.createElement('div');
  coord.className = 'pyr3-missing-coord';
  const msg = document.createElement('div');
  msg.className = 'pyr3-missing-msg';
  const report = document.createElement('a');
  report.className = 'pyr3-missing-report';
  report.href = ISSUES_URL;
  report.target = '_blank';
  report.rel = 'noopener noreferrer';
  report.textContent = 'report an issue ↗';
  report.hidden = true;
  root.append(coord, msg, report);
  zone?.appendChild(root);
  return {
    show(gen, id) {
      coord.textContent = `gen ${gen} · sheep ${id}`;
      msg.textContent =
        'Electric Sheep was not found — use ‹ prev or next › to jump to a valid flame.';
      report.hidden = true; // a missing sheep isn't a bug — nav is the escape
      root.hidden = false;
    },
    showLoadError(label) {
      // Higher-level user-facing copy — the raw parser detail stays in the
      // console (logged at the call site) for debugging / issue reports.
      coord.textContent = label;
      msg.textContent = 'This flame couldn’t be loaded — it may be corrupt or in an unsupported format.';
      report.hidden = false;
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
  };
}

async function resolveLoadIntent(intent: LoadIntent): Promise<File | null> {
  switch (intent.kind) {
    case 'corpus':
      // Corpus leaves (/v1/gen/{gen}/id/{id}) are handled by loadCorpus() (wires
      // nav + the graceful missing state). main routes corpus intents directly,
      // so this is unreachable — fail loud rather than silently returning the
      // wrong (welcome) flame if that invariant is ever broken.
      throw new Error('resolveLoadIntent: corpus intents must go through loadCorpus()');
    case 'gen-list':
    case 'gen-browse':
    case 'custom-reserved':
      // Browse + custom-flame sharing are a deferred phase (design spec §12).
      // For now, paint the welcome flame; no gallery/overlay UI is built yet.
      console.info(`pyr3: "${intent.kind}" view is not built yet (deferred) — painting welcome flame.`);
      return fetchAsFile(WELCOME_FLAME_URL);
    case 'gallery':
      // Defensive guard. Gallery intents dispatch via mountGallerySurface()
      // BEFORE this function is called (see the initial-load block at the
      // bottom of main()). Reaching here means the dispatch order was broken
      // — log loudly + paint welcome as a safe fallback so the page isn't
      // blank, but treat it as a bug to fix.
      console.error(`pyr3: gallery intent reached resolveLoadIntent — dispatch order broken (page ${intent.page})`);
      return fetchAsFile(WELCOME_FLAME_URL);
    case 'default':
      // Bare root is handled directly in main() (replaceState root-forward +
      // bundled fast-paint + nav). Reaching here means routing drifted — fail
      // loud rather than silently painting the placeholder without forwarding.
      throw new Error('resolveLoadIntent: default intent must go through the root-forward path in main()');
  }
}

async function fetchAsFile(path: string): Promise<File | null> {
  try {
    const resp = await fetch(path);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const filename = path.split('/').pop() ?? 'flame';
    return new File([blob], filename, { type: 'text/xml' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`pyr3: failed to fetch ${path} — ${msg}`);
    return null;
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('pyr3 init failed:', err);
  showError(`pyr3: init failed — ${msg}`);
});
