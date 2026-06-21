// Mount the /screensaver page body (#355). A two-mode immersive player:
//
//   Slideshow — random walk over an INTERESTINGNESS-pre-filtered corpus pool,
//               each flame rendered once to target quality, held for the dwell,
//               crossfaded to the next.
//   Animation — a loaded timeline walked in discrete held frames (stepped
//               morph), via createSteppedPlayer.
//
// One auto-hiding control bar (createControlBar) folds together the old hints
// strip + now-playing pill + info overlay. Build-up reveal and .webm recording
// were removed. Engine modules (chaos / density / visualize_*) untouched. See
// docs/superpowers/specs/2026-06-20-screensaver-revamp-design.md.

import { mountScreensaverLanding } from './screensaver-ui';
import type { ScreensaverPrefs } from './screensaver-prefs';
import { createScreensaverQueue, type SheepRef } from './screensaver-queue';
import { buildInterestPool } from './screensaver-interest';
import { createControlBar, type ControlBar } from './screensaver-controls';
import { createSteppedPlayer, type SteppedPlayer } from './screensaver-animation';
import type { Timeline } from './timeline';
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
import { HERO_GEN, HERO_ID } from './load-intent';

export interface MountScreensaverOpts {
  /** Container the page renders into. Cleared on mount. */
  root: HTMLElement;
  /** Pre-acquired WebGPU device + canvas format. Optional so unit tests
   *  (no WebGPU) can still mount the landing card. */
  device?: GPUDevice;
  format?: GPUTextureFormat;
}

export interface ScreensaverPageHandle {
  /** Returns to the landing state. */
  stop(): void;
  /** Tear down GPU resources + in-flight playback. Idempotent. */
  destroy(): void;
}

// Canvas backing-store cap — see #109. Going screen-native + high oversample
// builds a 50M-130M-cell histogram that swamps the GPU; cap the long edge here.
const CANVAS_MAX_W = 3840;
const CANVAS_MAX_H = 2160;
const CANVAS_MIN_DIM = 256;
const SCREENSAVER_MAX_OS = 2;
const SLIDESHOW_CHUNK_SAMPLES = 5_000_000;
const SLIDESHOW_CROSSFADE_MS = 1500;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

async function toggleFullscreen(target: HTMLElement): Promise<void> {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await target.requestFullscreen();
}

async function loadGenomeByRef(ref: SheepRef): Promise<Genome> {
  const xml = await fetchFlameXml(ref.gen, ref.id);
  return parseFlame(xml).genome;
}

/** `?hero=true` — render only the canonical hero flame on repeat (QA aid). */
function shouldUseHeroOnly(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('hero') === 'true';
}

function clampDim(n: number, max: number): number {
  return Math.max(CANVAS_MIN_DIM, Math.min(max, Math.floor(n)));
}

// #321 — `?w=`/`?h=` overrides are untrusted; junk falls back. Exported for test.
export function resolveDimOverride(override: string | null, fallback: number): number {
  if (override === null || override === '') return fallback;
  const n = Number(override);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Build a render canvas at the prefs-chosen dims (clamped), honouring ?w/?h
 *  overrides when present. */
function makeRenderCanvas(host: HTMLElement, prefW: number, prefH: number): HTMLCanvasElement {
  const canvas = el('canvas', 'pyr3-screensaver-canvas');
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const w = resolveDimOverride(params?.get('w') ?? null, prefW);
  const h = resolveDimOverride(params?.get('h') ?? null, prefH);
  canvas.width = clampDim(w, CANVAS_MAX_W);
  canvas.height = clampDim(h, CANVAS_MAX_H);
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
  host.append(canvas);
  return canvas;
}

interface RenderLayer {
  canvas: HTMLCanvasElement;
  ctx: GPUCanvasContext;
  renderer: Renderer;
  W: number;
  H: number;
}

function makeLayer(
  host: HTMLElement, device: GPUDevice, format: GPUTextureFormat,
  zIndex: number, prefW: number, prefH: number,
): RenderLayer {
  const canvas = makeRenderCanvas(host, prefW, prefH);
  canvas.style.zIndex = String(zIndex);
  const ctx = canvas.getContext('webgpu');
  if (!ctx) throw new Error('screensaver: WebGPU canvas context unavailable');
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const renderer = createRenderer(device, format, {
    width: canvas.width, height: canvas.height, oversample: 1, filterRadius: DEFAULT_FILTER_RADIUS,
  });
  return { canvas, ctx, renderer, W: canvas.width, H: canvas.height };
}

/** Render one flame to the target quality in chunks, yielding so cancellation
 *  can land. Presents once at the end — "appear fully rendered". */
async function renderFlameToQuality(args: {
  renderer: Renderer; genome: Genome; ctx: GPUCanvasContext;
  W: number; H: number; targetQ: number; isCancelled: () => boolean;
}): Promise<void> {
  const { renderer, genome, ctx, W, H, targetQ, isCancelled } = args;
  const overs = Math.min(SCREENSAVER_MAX_OS, genome.oversample ?? 1);
  const filt = genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;
  renderer.resize({ width: W, height: H, oversample: overs, filterRadius: filt });
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
    renderer.iterate({ genome, seed, walkers: dispatch.dispatchWalkers, itersPerWalker: dispatch.dispatchIters });
    accumulated += dispatch.actualSamples;
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  if (isCancelled()) return;
  renderer.present({ genome, outputView: ctx.getCurrentTexture().createView(), totalSamples: Math.max(1, accumulated), forceDeOff: false });
}

// ─── mode state + sleep helpers (slideshow) ─────────────────────────────────

interface ModeControls {
  togglePause(): void;
  isPaused(): boolean;
  skip(dir: -1 | 1): void;
}
interface ModeHandle { cancel(): void; controls: ModeControls; }

interface ModeState { cancelled: boolean; paused: boolean; skipDir: -1 | 0 | 1; }
function createModeState(): ModeState { return { cancelled: false, paused: false, skipDir: 0 }; }

async function sleepCancellable(ms: number, isCancelled: () => boolean): Promise<void> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (isCancelled()) return;
    await new Promise<void>((r) => setTimeout(r, Math.min(50, end - performance.now())));
  }
}

type SleepReason = 'done' | 'cancelled' | 'skipped';
async function sleepInteractive(ms: number, state: ModeState): Promise<SleepReason> {
  let remaining = ms;
  while (remaining > 0) {
    if (state.cancelled) return 'cancelled';
    if (state.skipDir !== 0) return 'skipped';
    if (state.paused) { await new Promise<void>((r) => setTimeout(r, 100)); continue; }
    const step = Math.min(50, remaining);
    await new Promise<void>((r) => setTimeout(r, step));
    remaining -= step;
  }
  return 'done';
}

function flameLabel(genome: Genome, ref: SheepRef): { name: string; meta: string } {
  // ESF flames carry the author handle as the `nick` (from the <edit nick=…>
  // chain). When present, attribute it as "by <nick>"; otherwise the flame has
  // no name, so fall back to its corpus sheep id.
  const nick = genome.nick?.trim();
  if (nick) return { name: `by ${nick}`, meta: `gen ${ref.gen} · id ${ref.id} · 🖼️ slideshow` };
  return { name: `electricsheep ${ref.gen}.${ref.id}`, meta: '🖼️ slideshow' };
}

// ─── slideshow ──────────────────────────────────────────────────────────────

function startSlideshow(args: {
  device: GPUDevice; format: GPUTextureFormat; canvasHost: HTMLElement;
  prefs: ScreensaverPrefs; bar: ControlBar;
}): ModeHandle {
  const { device, format, canvasHost, prefs, bar } = args;
  const state = createModeState();
  const isCancelled = () => state.cancelled;
  // Hoisted so cancel() can destroy the GPU renderers SYNCHRONOUSLY (matching
  // startAnimation) rather than waiting for the async loop's finally. All
  // renderer calls in the loop are guarded by isCancelled() checks that run
  // after each await, so a destroy here can't race an in-flight iterate/present.
  let layers: { front: RenderLayer; back: RenderLayer } | null = null;
  const destroyLayers = (): void => {
    if (!layers) return;
    layers.front.renderer.destroy();
    layers.back.renderer.destroy();
    layers = null;
  };

  void (async () => {
    const { width, height } = prefs.slideshow;
    const front = makeLayer(canvasHost, device, format, 2, width, height);
    const back = makeLayer(canvasHost, device, format, 1, width, height);
    layers = { front, back };
    front.canvas.style.opacity = '0';
    back.canvas.style.opacity = '0';

    try {
      const index = await loadFeatureIndex();
      if (isCancelled()) return;
      let allRefs: SheepRef[];
      if (shouldUseHeroOnly()) {
        allRefs = [{ gen: HERO_GEN, id: HERO_ID }];
      } else {
        allRefs = buildInterestPool((pred) => index.filter(pred), prefs.slideshow.interest).refs;
      }
      if (allRefs.length === 0) return;
      const queue = createScreensaverQueue(allRefs, Math.floor(performance.now()));

      const firstRef = queue.next();
      if (!firstRef) return;
      let firstGenome: Genome;
      try { firstGenome = await loadGenomeByRef(firstRef); } catch { return; }
      if (isCancelled()) return;
      await renderFlameToQuality({ renderer: front.renderer, genome: firstGenome, ctx: front.ctx, W: front.W, H: front.H, targetQ: prefs.slideshow.quality, isCancelled });
      if (isCancelled()) return;
      { const l = flameLabel(firstGenome, firstRef); bar?.setFlameName(l.name, l.meta); }
      front.canvas.style.transition = `opacity ${SLIDESHOW_CROSSFADE_MS}ms`;
      front.canvas.style.opacity = '1';

      let activeIsFront = true;
      while (!isCancelled()) {
        const pickRef = state.skipDir === -1 ? (queue.prev() ?? queue.next()) : queue.next();
        state.skipDir = 0;
        if (!pickRef) break;
        let nextGenome: Genome;
        try { nextGenome = await loadGenomeByRef(pickRef); } catch { continue; }
        if (isCancelled()) return;
        const prefetch = activeIsFront ? back : front;
        const active = activeIsFront ? front : back;
        await renderFlameToQuality({ renderer: prefetch.renderer, genome: nextGenome, ctx: prefetch.ctx, W: prefetch.W, H: prefetch.H, targetQ: prefs.slideshow.quality, isCancelled });
        if (isCancelled()) return;

        const reason = await sleepInteractive(prefs.slideshow.dwellSec * 1000, state);
        if (reason === 'cancelled') return;

        { const l = flameLabel(nextGenome, pickRef); bar?.setFlameName(l.name, l.meta); }
        prefetch.canvas.style.transition = `opacity ${SLIDESHOW_CROSSFADE_MS}ms`;
        prefetch.canvas.style.opacity = '1';
        active.canvas.style.transition = `opacity ${SLIDESHOW_CROSSFADE_MS}ms`;
        active.canvas.style.opacity = '0';
        await sleepCancellable(SLIDESHOW_CROSSFADE_MS + 100, isCancelled);
        activeIsFront = !activeIsFront;
      }
    } finally {
      destroyLayers();
    }
  })();

  return {
    cancel() { state.cancelled = true; destroyLayers(); },
    controls: {
      togglePause() { state.paused = !state.paused; },
      isPaused() { return state.paused; },
      skip(dir) { state.skipDir = dir; },
    },
  };
}

// ─── animation (stepped morph) ──────────────────────────────────────────────

interface AnimationHandle { cancel(): void; player: SteppedPlayer; }

function startAnimation(args: {
  device: GPUDevice; format: GPUTextureFormat; canvasHost: HTMLElement;
  prefs: ScreensaverPrefs; timeline: Timeline; bar: ControlBar; fileName: string;
}): AnimationHandle {
  const { device, format, canvasHost, prefs, timeline, bar, fileName } = args;
  let cancelled = false;
  const isCancelled = () => cancelled;
  const { width, height, quality } = prefs.animation;
  const layer = makeLayer(canvasHost, device, format, 2, width, height);
  layer.canvas.style.opacity = '1';
  bar.setFlameName(fileName, '🎞️ animation');

  const player = createSteppedPlayer({
    timeline,
    durationSec: prefs.animation.durationSec,
    updateIntervalSec: prefs.animation.updateIntervalSec,
    loop: prefs.animation.loop,
    isCancelled,
    renderFrame: async (genome) => {
      await renderFlameToQuality({ renderer: layer.renderer, genome, ctx: layer.ctx, W: layer.W, H: layer.H, targetQ: quality, isCancelled });
    },
    onProgress: (i, frames) => { bar.setProgress(frames > 1 ? i / (frames - 1) : 1); },
  });
  player.start();

  return {
    cancel() { cancelled = true; player.destroy(); layer.renderer.destroy(); },
    player,
  };
}

// ─── page mount ─────────────────────────────────────────────────────────────

export function mountScreensaverPage(opts: MountScreensaverOpts): ScreensaverPageHandle {
  const { root, device, format } = opts;
  root.replaceChildren();
  injectStyleOnce();

  const canvasHost = el('div', 'pyr3-screensaver-canvas-host');
  Object.assign(canvasHost.style, { position: 'absolute', inset: '0' });
  root.append(canvasHost);

  let slideHandle: ModeHandle | null = null;
  let animHandle: AnimationHandle | null = null;
  let bar: ControlBar | null = null;
  let animPaused = false;

  const landing = mountScreensaverLanding(root, {
    onPlay: (prefs, timeline, timelineName) => {
      if (slideHandle || animHandle) return; // already playing — ignore re-entry
      landing.card.classList.add('hidden');
      if (!device || !format) return; // preview mode (no WebGPU) — landing only

      if (prefs.mode === 'animation') {
        if (!timeline) { landing.card.classList.remove('hidden'); return; }
        const stepBack = (): void => { animPaused = true; animHandle?.player.stepBack(); bar?.setPaused(true); };
        const stepForward = (): void => { animPaused = true; animHandle?.player.stepForward(); bar?.setPaused(true); };
        bar = createControlBar({
          transport: 'animation',
          onPlayPause: () => {
            animPaused = !animPaused;
            if (animPaused) animHandle?.player.pause(); else animHandle?.player.resume();
            bar?.setPaused(animPaused);
          },
          onPrev: stepBack,
          onNext: stepForward,
          onFullscreen: () => { void toggleFullscreen(root); },
          onExit: stopPlayback,
        });
        root.append(bar.el);
        animPaused = false;
        animHandle = startAnimation({ device, format, canvasHost, prefs, timeline, bar, fileName: timelineName ?? 'timeline' });
      } else {
        bar = createControlBar({
          transport: 'slideshow',
          onPrev: () => slideHandle?.controls.skip(-1),
          onNext: () => slideHandle?.controls.skip(1),
          onPlayPause: () => { slideHandle?.controls.togglePause(); bar?.setPaused(slideHandle?.controls.isPaused() ?? false); },
          onFullscreen: () => { void toggleFullscreen(root); },
          onExit: stopPlayback,
        });
        root.append(bar.el);
        slideHandle = startSlideshow({ device, format, canvasHost, prefs, bar });
      }
      attachReveal();
      bar.reveal();
    },
  });

  Object.assign(landing.card.style, {
    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: '5',
  });

  // ── reveal-on-activity ──
  let mousemoveListener: ((ev: MouseEvent) => void) | null = null;
  function attachReveal(): void {
    if (mousemoveListener) return;
    mousemoveListener = () => bar?.reveal();
    window.addEventListener('mousemove', mousemoveListener);
  }
  function detachReveal(): void {
    if (mousemoveListener) { window.removeEventListener('mousemove', mousemoveListener); mousemoveListener = null; }
  }

  // ── keyboard ──
  function onKeydown(ev: KeyboardEvent): void {
    const target = ev.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      if (ev.key !== 'Escape') return;
    }
    if (!slideHandle && !animHandle) return;
    bar?.reveal();
    if (ev.key === ' ' || ev.code === 'Space') {
      ev.preventDefault();
      if (slideHandle) { slideHandle.controls.togglePause(); bar?.setPaused(slideHandle.controls.isPaused()); }
      else if (animHandle) { animPaused = !animPaused; if (animPaused) animHandle.player.pause(); else animHandle.player.resume(); bar?.setPaused(animPaused); }
      return;
    }
    if (ev.key === 'ArrowLeft') {
      slideHandle?.controls.skip(-1);
      if (animHandle) { animPaused = true; animHandle.player.stepBack(); bar?.setPaused(true); }
      return;
    }
    if (ev.key === 'ArrowRight') {
      slideHandle?.controls.skip(1);
      if (animHandle) { animPaused = true; animHandle.player.stepForward(); bar?.setPaused(true); }
      return;
    }
    if (ev.key === 'f' || ev.key === 'F') { void toggleFullscreen(root); return; }
    if (ev.key === 'Escape') { stopPlayback(); return; }
  }
  window.addEventListener('keydown', onKeydown);

  function stopPlayback(): void {
    slideHandle?.cancel();
    slideHandle = null;
    animHandle?.cancel();
    animHandle = null;
    detachReveal();
    bar?.destroy();
    bar = null;
    canvasHost.replaceChildren();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    landing.card.classList.remove('hidden');
    landing.refresh();
  }

  return {
    stop: stopPlayback,
    destroy() {
      // stopPlayback tears down handles (sync renderer destroy), overlay, bar,
      // canvasHost, reveal listener + fullscreen. Then drop the keydown listener
      // and the landing card.
      stopPlayback();
      window.removeEventListener('keydown', onKeydown);
      landing.destroy();
    },
  };
}

let styleInjected = false;
function injectStyleOnce(): void {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.pyr3-screensaver-card.hidden { display: none; }
`;
  document.head.append(style);
}
