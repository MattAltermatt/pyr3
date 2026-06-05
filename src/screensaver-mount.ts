// Mount the /v1/screensaver page body. Wires the landing card, the canvas
// host, the per-mode render loops (build-up wired here in T7; slideshow in
// T8), and the permanent bottom controls strip.
//
// Structural analogue of edit-mount.ts: this module owns the page-level state
// machine. The bar lives in #pyr3-bar and is mounted by main.ts via
// mountScreensaverBar — this module renders only the body content into the
// container it's handed.
//
// Engine modules (chaos / density / visualize_*) untouched. See:
// docs/superpowers/specs/2026-06-05-screensaver-design.md.

import { mountScreensaverLanding } from './screensaver-ui';
import type { ScreensaverPrefs } from './screensaver-prefs';
import { createScreensaverQueue, type SheepRef } from './screensaver-queue';
import { qTarget, BUILD_UP_TARGET_Q } from './screensaver-pacing';
import { loadFeatureIndex } from './feature-index-client';
import { fetchFlameXml } from './chunk-fetch';
import { parseFlame } from './flame-import';
import {
  createRenderer,
  computeDispatch,
  DEFAULT_FILTER_RADIUS,
  type Renderer,
} from './renderer';
import type { Genome } from './genome';

export interface MountScreensaverOpts {
  /** Container the page renders into. Cleared on mount. */
  root: HTMLElement;
  /** Pre-acquired WebGPU device + canvas format. Optional so unit tests
   *  (no WebGPU) can still mount the landing card; production main.ts
   *  always passes both. When absent, Play stages the UI transitions but
   *  no flame loop runs. */
  device?: GPUDevice;
  format?: GPUTextureFormat;
}

export interface ScreensaverPageHandle {
  /** Returns to the landing state (hides pill + canvas, re-shows card). */
  stop(): void;
}

const CANVAS_MAX_W = 1920;
const CANVAS_MAX_H = 1080;
const CANVAS_MIN_DIM = 256;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function buildControlsStrip(): HTMLElement {
  const strip = el('div', 'pyr3-screensaver-strip');
  strip.textContent =
    'Space pause · ← → skip · F fullscreen · Esc exit FS · S settings';
  Object.assign(strip.style, {
    position: 'absolute',
    left: '0',
    right: '0',
    bottom: '0',
    padding: '6px 18px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    opacity: '0.6',
    pointerEvents: 'none',
    textAlign: 'center',
    zIndex: '10',
  });
  return strip;
}

function buildNowPlayingPill(opts: { onStop: () => void }): HTMLElement {
  const pill = el('div', 'pyr3-screensaver-pill');
  Object.assign(pill.style, {
    position: 'absolute',
    top: '12px',
    right: '12px',
    padding: '6px 10px',
    display: 'flex',
    gap: '8px',
    zIndex: '10',
  });
  const stop = el('button', 'pyr3-screensaver-pill-stop');
  stop.textContent = '⏸';
  stop.addEventListener('click', opts.onStop);
  pill.append(stop);
  return pill;
}

async function loadGenomeByRef(ref: SheepRef): Promise<Genome> {
  const xml = await fetchFlameXml(ref.gen, ref.id);
  return parseFlame(xml).genome;
}

function clampDim(n: number, max: number): number {
  return Math.max(CANVAS_MIN_DIM, Math.min(max, Math.floor(n)));
}

function makeRenderCanvas(host: HTMLElement): HTMLCanvasElement {
  const canvas = el('canvas', 'pyr3-screensaver-canvas');
  const dpr = window.devicePixelRatio || 1;
  const cssW = host.clientWidth || 1024;
  const cssH = host.clientHeight || 1024;
  canvas.width = clampDim(cssW * dpr, CANVAS_MAX_W);
  canvas.height = clampDim(cssH * dpr, CANVAS_MAX_H);
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
  });
  host.append(canvas);
  return canvas;
}

interface ModeHandle {
  cancel(): void;
}

/** Final quality the slideshow renders each flame to before holding. Higher
 *  than build-up's BUILD_UP_TARGET_Q (50) since slideshow is "lean back at
 *  full quality"; lower than viewer's max (200) to keep prefetch within the
 *  default holdSec window. */
const SLIDESHOW_TARGET_Q = 100;
const SLIDESHOW_CHUNK_SAMPLES = 5_000_000;
const SLIDESHOW_CROSSFADE_MS = 1500;

/** Promise-based sleep that bails on cancel. */
async function sleepCancellable(ms: number, isCancelled: () => boolean): Promise<void> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (isCancelled()) return;
    await new Promise<void>((r) => setTimeout(r, Math.min(50, end - performance.now())));
  }
}

/** Render a single flame to the target quality in chunks, yielding to the
 *  event loop between dispatches so cancellation can land. Presents only
 *  once at the end — slideshow is "appear fully rendered". */
async function renderFlameToQuality(args: {
  renderer: Renderer;
  genome: Genome;
  ctx: GPUCanvasContext;
  W: number;
  H: number;
  targetQ: number;
  isCancelled: () => boolean;
}): Promise<void> {
  const { renderer, genome, ctx, W, H, targetQ, isCancelled } = args;
  renderer.reset(genome);
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const pixels = W * H;
  const totalSamplesTarget = targetQ * pixels;
  let accumulated = 0;
  while (accumulated < totalSamplesTarget && !isCancelled()) {
    const remaining = totalSamplesTarget - accumulated;
    const chunkSamples = Math.min(SLIDESHOW_CHUNK_SAMPLES, remaining);
    const sppToAdd = Math.max(1, Math.ceil(chunkSamples / pixels));
    const dispatch = computeDispatch(sppToAdd, W, H);
    renderer.iterate({
      genome,
      seed,
      walkers: dispatch.dispatchWalkers,
      itersPerWalker: dispatch.dispatchIters,
    });
    accumulated += dispatch.actualSamples;
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  if (isCancelled()) return;
  renderer.present({
    genome,
    outputView: ctx.getCurrentTexture().createView(),
    totalSamples: Math.max(1, accumulated),
  });
}

function makeSlideshowCanvas(
  host: HTMLElement,
  device: GPUDevice,
  format: GPUTextureFormat,
  zIndex: number,
): { canvas: HTMLCanvasElement; ctx: GPUCanvasContext; renderer: Renderer; W: number; H: number } {
  const canvas = makeRenderCanvas(host);
  canvas.style.zIndex = String(zIndex);
  const ctx = canvas.getContext('webgpu');
  if (!ctx) throw new Error('screensaver: WebGPU canvas context unavailable');
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const renderer = createRenderer(device, format, {
    width: canvas.width,
    height: canvas.height,
    oversample: 1,
    filterRadius: DEFAULT_FILTER_RADIUS,
  });
  return { canvas, ctx, renderer, W: canvas.width, H: canvas.height };
}

function startSlideshow(args: {
  device: GPUDevice;
  format: GPUTextureFormat;
  canvasHost: HTMLElement;
  prefs: ScreensaverPrefs;
}): ModeHandle {
  const { device, format, canvasHost, prefs } = args;
  let cancelled = false;
  const isCancelled = () => cancelled;

  void (async () => {
    const front = makeSlideshowCanvas(canvasHost, device, format, 2);
    const back = makeSlideshowCanvas(canvasHost, device, format, 1);
    front.canvas.style.opacity = '0';
    back.canvas.style.opacity = '0';

    const index = await loadFeatureIndex();
    if (isCancelled()) return;
    const allRefs = index.filter(() => true);
    if (allRefs.length === 0) return;
    const queue = createScreensaverQueue(allRefs, Math.floor(performance.now()));

    // Prime the front layer with the first flame.
    const firstRef = queue.next();
    if (!firstRef) return;
    let firstGenome: Genome;
    try {
      firstGenome = await loadGenomeByRef(firstRef);
    } catch {
      return;
    }
    if (isCancelled()) return;
    await renderFlameToQuality({
      renderer: front.renderer,
      genome: firstGenome,
      ctx: front.ctx,
      W: front.W,
      H: front.H,
      targetQ: SLIDESHOW_TARGET_Q,
      isCancelled,
    });
    if (isCancelled()) return;
    front.canvas.style.transition = `opacity ${SLIDESHOW_CROSSFADE_MS}ms`;
    front.canvas.style.opacity = '1';

    // Track which layer currently displays the active flame. After every
    // crossfade we flip — the layer that just faded out becomes the prefetch
    // target for the next flame.
    let activeIsFront = true;

    while (!isCancelled()) {
      // Pick + render the next flame into the inactive layer (prefetch).
      const nextRef = queue.next();
      if (!nextRef) break;
      let nextGenome: Genome;
      try {
        nextGenome = await loadGenomeByRef(nextRef);
      } catch {
        continue;
      }
      if (isCancelled()) return;
      const prefetchTarget = activeIsFront ? back : front;
      const currentActive = activeIsFront ? front : back;
      await renderFlameToQuality({
        renderer: prefetchTarget.renderer,
        genome: nextGenome,
        ctx: prefetchTarget.ctx,
        W: prefetchTarget.W,
        H: prefetchTarget.H,
        targetQ: SLIDESHOW_TARGET_Q,
        isCancelled,
      });
      if (isCancelled()) return;

      // Wait the remainder of the hold period. Prefetch may have eaten into
      // it — that's the point. If prefetch took longer than holdSec we
      // crossfade immediately.
      await sleepCancellable(prefs.holdSec * 1000, isCancelled);
      if (isCancelled()) return;

      // Crossfade.
      prefetchTarget.canvas.style.transition = `opacity ${SLIDESHOW_CROSSFADE_MS}ms`;
      prefetchTarget.canvas.style.opacity = '1';
      currentActive.canvas.style.transition = `opacity ${SLIDESHOW_CROSSFADE_MS}ms`;
      currentActive.canvas.style.opacity = '0';
      await sleepCancellable(SLIDESHOW_CROSSFADE_MS + 100, isCancelled);

      activeIsFront = !activeIsFront;
    }
  })();

  return {
    cancel() {
      cancelled = true;
    },
  };
}

function startBuildUp(args: {
  device: GPUDevice;
  format: GPUTextureFormat;
  canvasHost: HTMLElement;
  prefs: ScreensaverPrefs;
}): ModeHandle {
  const { device, format, canvasHost, prefs } = args;
  let cancelled = false;
  const isCancelled = () => cancelled;

  void (async () => {
    const canvas = makeRenderCanvas(canvasHost);
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('webgpu');
    if (!ctx) return;
    ctx.configure({ device, format, alphaMode: 'opaque' });

    const renderer: Renderer = createRenderer(device, format, {
      width: W,
      height: H,
      oversample: 1,
      filterRadius: DEFAULT_FILTER_RADIUS,
    });

    const index = await loadFeatureIndex();
    if (isCancelled()) return;
    const allRefs = index.filter(() => true);
    if (allRefs.length === 0) return;
    const queue = createScreensaverQueue(allRefs, Math.floor(performance.now()));

    while (!isCancelled()) {
      const ref = queue.next();
      if (!ref) break;
      let genome: Genome;
      try {
        genome = await loadGenomeByRef(ref);
      } catch {
        // Sparse-corpus gap or transient fetch failure — skip this flame.
        continue;
      }
      if (isCancelled()) return;

      renderer.reset(genome);
      const seed = (Math.random() * 0xffffffff) >>> 0;
      const startedAt = performance.now();
      let samplesAccumulated = 0;

      canvas.style.transition = '';
      canvas.style.opacity = '1';

      const totalPixels = W * H;

      // Pacing loop: each frame, catch samples up to qTarget(elapsed).
      while (!isCancelled()) {
        const elapsed = (performance.now() - startedAt) / 1000;
        const targetQ = qTarget(elapsed, prefs.buildUpSec);
        const desiredSamples = targetQ * totalPixels;
        const delta = desiredSamples - samplesAccumulated;
        if (delta > 0) {
          const sppToAdd = Math.max(1, Math.ceil(delta / totalPixels));
          const dispatch = computeDispatch(sppToAdd, W, H);
          renderer.iterate({
            genome,
            seed,
            walkers: dispatch.dispatchWalkers,
            itersPerWalker: dispatch.dispatchIters,
          });
          samplesAccumulated += dispatch.actualSamples;
        }
        renderer.present({
          genome,
          outputView: ctx.getCurrentTexture().createView(),
          totalSamples: Math.max(1, samplesAccumulated),
        });
        if (targetQ >= BUILD_UP_TARGET_Q && elapsed >= prefs.buildUpSec) break;
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      }
      if (isCancelled()) return;

      // Rest period — hold at full quality.
      await sleepCancellable(prefs.restSec * 1000, isCancelled);
      if (isCancelled()) return;

      // Fade-to-black ~2s, then advance.
      canvas.style.transition = 'opacity 2s';
      canvas.style.opacity = '0';
      await sleepCancellable(2200, isCancelled);
    }
  })();

  return {
    cancel() {
      cancelled = true;
    },
  };
}

export function mountScreensaverPage(
  opts: MountScreensaverOpts,
): ScreensaverPageHandle {
  const { root, device, format } = opts;
  root.replaceChildren();

  const canvasHost = el('div', 'pyr3-screensaver-canvas-host');
  Object.assign(canvasHost.style, {
    position: 'absolute',
    inset: '0',
  });
  root.append(canvasHost);

  let runHandle: ModeHandle | null = null;

  const landing = mountScreensaverLanding(root, {
    onPlay: (prefs: ScreensaverPrefs) => {
      landing.card.classList.add('hidden');
      const pill = buildNowPlayingPill({ onStop: stopPlayback });
      root.append(pill);
      if (device && format) {
        runHandle =
          prefs.mode === 'build-up'
            ? startBuildUp({ device, format, canvasHost, prefs })
            : startSlideshow({ device, format, canvasHost, prefs });
      }
    },
  });

  Object.assign(landing.card.style, {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: '5',
  });
  injectHiddenRuleOnce();

  function stopPlayback(): void {
    runHandle?.cancel();
    runHandle = null;
    root.querySelector('.pyr3-screensaver-pill')?.remove();
    canvasHost.replaceChildren();
    landing.card.classList.remove('hidden');
    landing.refresh();
  }

  const strip = buildControlsStrip();
  root.append(strip);

  return { stop: stopPlayback };
}

let hiddenRuleInjected = false;
function injectHiddenRuleOnce(): void {
  if (hiddenRuleInjected) return;
  hiddenRuleInjected = true;
  const style = document.createElement('style');
  style.textContent = '.pyr3-screensaver-card.hidden { display: none; }';
  document.head.append(style);
}
