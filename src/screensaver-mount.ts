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
import { COLORS } from './ui-tokens';

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

const CANVAS_MAX_W = 2560;
const CANVAS_MAX_H = 1440;
const CANVAS_MIN_DIM = 256;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

interface KeyHint { key: string; label: string; }

const KEY_HINTS: KeyHint[] = [
  { key: 'Space',  label: 'pause' },
  { key: '← →',    label: 'skip' },
  { key: 'F',      label: 'fullscreen' },
  { key: 'Esc',    label: 'exit FS' },
  { key: 'S',      label: 'settings' },
];

function buildControlsStrip(): HTMLElement {
  const strip = el('div', 'pyr3-screensaver-strip');
  Object.assign(strip.style, {
    position: 'absolute',
    left: '0',
    right: '0',
    top: '0',
    padding: '12px 24px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '20px',
    background: COLORS.bg.info,
    borderBottom: `1px solid ${COLORS.border}`,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '13px',
    color: COLORS.text.primary,
    pointerEvents: 'none',
    zIndex: '12',
  });
  for (const hint of KEY_HINTS) {
    const group = el('span', 'pyr3-screensaver-hint');
    Object.assign(group.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
    });
    const kbd = el('kbd', 'pyr3-screensaver-kbd');
    kbd.textContent = hint.key;
    Object.assign(kbd.style, {
      padding: '3px 8px',
      background: COLORS.bg.action,
      border: `1px solid ${COLORS.border}`,
      borderRadius: '4px',
      color: COLORS.flame.top,
      fontWeight: '600',
      letterSpacing: '0.02em',
      minWidth: '20px',
      textAlign: 'center',
    });
    const lbl = el('span');
    lbl.textContent = hint.label;
    lbl.style.color = COLORS.text.muted;
    group.append(kbd, lbl);
    strip.append(group);
  }
  return strip;
}

interface PillCallbacks {
  onPrev: () => void;
  onPause: () => void;
  onNext: () => void;
  onFullscreen: () => void;
  onStop: () => void;
}

function buildNowPlayingPill(cb: PillCallbacks): HTMLElement {
  const pill = el('div', 'pyr3-screensaver-pill');
  Object.assign(pill.style, {
    position: 'absolute',
    top: '60px',
    right: '16px',
    padding: '6px',
    display: 'flex',
    gap: '4px',
    background: COLORS.bg.panel,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    zIndex: '11',
    transition: 'opacity 0.2s',
  });
  function btn(label: string, fn: () => void, title: string): HTMLButtonElement {
    const b = el('button', 'pyr3-screensaver-pill-btn');
    b.textContent = label;
    b.title = title;
    Object.assign(b.style, {
      padding: '6px 10px',
      background: COLORS.bg.input,
      border: `1px solid ${COLORS.border}`,
      borderRadius: '4px',
      color: COLORS.text.primary,
      cursor: 'pointer',
      fontSize: '14px',
      minWidth: '32px',
    });
    b.addEventListener('click', fn);
    return b;
  }
  pill.append(
    btn('⏮', cb.onPrev,       'Previous (←)'),
    btn('⏸', cb.onPause,      'Pause / resume (Space)'),
    btn('⏭', cb.onNext,       'Next (→)'),
    btn('⛶', cb.onFullscreen, 'Toggle fullscreen (F)'),
    btn('⏹', cb.onStop,       'Stop, back to settings (S)'),
  );
  return pill;
}

/** Per-page tracker so the fullscreenchange listener can tell apart "user
 *  pressed F to toggle off" (no stop) from "user pressed Esc / browser
 *  exited" (stop playback). Set true just before our toggle calls
 *  exitFullscreen; cleared on the resulting fullscreenchange. */
const fullscreenIntent = { userToggledOff: false };

async function toggleFullscreen(target: HTMLElement): Promise<void> {
  if (document.fullscreenElement) {
    fullscreenIntent.userToggledOff = true;
    await document.exitFullscreen();
  } else {
    await target.requestFullscreen();
  }
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
  // Render at the user's screen resolution (capped) so fullscreen looks
  // pixel-native. CSS scales 100% in the windowed view; browser
  // downsamples cleanly. window.screen reports device pixels on all
  // modern browsers.
  const sw = (typeof window !== 'undefined' && window.screen?.width)  ? window.screen.width  : 1920;
  const sh = (typeof window !== 'undefined' && window.screen?.height) ? window.screen.height : 1080;
  canvas.width = clampDim(sw, CANVAS_MAX_W);
  canvas.height = clampDim(sh, CANVAS_MAX_H);
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
  });
  host.append(canvas);
  return canvas;
}

interface ModeControls {
  /** Toggle paused state. Pause freezes elapsed/hold timers; render output
   *  is whatever was last presented. */
  togglePause(): void;
  /** Signal a skip — dir = 1 for next, -1 for prev. The mode picks this up
   *  at its next loop boundary. */
  skip(dir: -1 | 1): void;
}

interface ModeHandle {
  cancel(): void;
  controls: ModeControls;
}

/** Final quality the slideshow renders each flame to before holding. Higher
 *  than build-up's BUILD_UP_TARGET_Q (50) since slideshow is "lean back at
 *  full quality"; lower than viewer's max (200) to keep prefetch within the
 *  default holdSec window. */
const SLIDESHOW_TARGET_Q = 100;
const SLIDESHOW_CHUNK_SAMPLES = 5_000_000;
const SLIDESHOW_CROSSFADE_MS = 1500;

/** Mutable state shared between mode loops and their ModeControls. Wrapped
 *  in an object so TS doesn't narrow `skipDir` to a literal across closures
 *  on each assignment. */
interface ModeState {
  cancelled: boolean;
  paused: boolean;
  /** Skip-direction signal. Set by controls.skip(); cleared by the mode loop
   *  when consumed. */
  skipDir: -1 | 0 | 1;
  /** Build-up only: timestamp at which the current pause began (0 = not
   *  paused). */
  pausedAt: number;
  /** Build-up only: total ms accumulated across resumed pauses, applied as
   *  an offset to the elapsed-vs-target calculation. */
  pauseAccumMs: number;
}

/** Promise-based sleep that bails on cancel. Use for the fade-to-black
 *  transition where pause/skip shouldn't extend or shorten the wall-clock
 *  fade duration. */
async function sleepCancellable(ms: number, isCancelled: () => boolean): Promise<void> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (isCancelled()) return;
    await new Promise<void>((r) => setTimeout(r, Math.min(50, end - performance.now())));
  }
}

/** Sleep that bails on cancel, EXTENDS while paused, and SHORTCIRCUITS on
 *  skip. Returns the reason it exited so the caller can branch. */
type SleepReason = 'done' | 'cancelled' | 'skipped';
async function sleepInteractive(ms: number, state: ModeState): Promise<SleepReason> {
  let remaining = ms;
  while (remaining > 0) {
    if (state.cancelled) return 'cancelled';
    if (state.skipDir !== 0) return 'skipped';
    if (state.paused) {
      await new Promise<void>((r) => setTimeout(r, 100));
      continue;
    }
    const step = Math.min(50, remaining);
    await new Promise<void>((r) => setTimeout(r, step));
    remaining -= step;
  }
  return 'done';
}

function createModeState(): ModeState {
  return {
    cancelled: false,
    paused: false,
    skipDir: 0,
    pausedAt: 0,
    pauseAccumMs: 0,
  };
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
  const state = createModeState();
  const isCancelled = () => state.cancelled;

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
      // Skip-back consumes the queue's history; skip-forward and natural
      // advance both call next().
      const pickRef =
        state.skipDir === -1
          ? (queue.prev() ?? queue.next())
          : queue.next();
      state.skipDir = 0;
      if (!pickRef) break;
      let nextGenome: Genome;
      try {
        nextGenome = await loadGenomeByRef(pickRef);
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

      // Wait the remainder of the hold period. Skip signal shortcircuits
      // immediately; pause extends.
      const reason = await sleepInteractive(prefs.holdSec * 1000, state);
      if (reason === 'cancelled') return;
      // 'done' and 'skipped' both fall through to the crossfade.

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
      state.cancelled = true;
    },
    controls: {
      togglePause() {
        state.paused = !state.paused;
      },
      skip(dir) {
        state.skipDir = dir;
      },
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
  const state = createModeState();
  const isCancelled = () => state.cancelled;

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
      // Pick the next ref; skip-back consumes history.
      const ref =
        state.skipDir === -1
          ? (queue.prev() ?? queue.next())
          : queue.next();
      state.skipDir = 0;
      if (!ref) break;
      let genome: Genome;
      try {
        genome = await loadGenomeByRef(ref);
      } catch {
        continue;
      }
      if (isCancelled()) return;

      renderer.reset(genome);
      const seed = (Math.random() * 0xffffffff) >>> 0;
      const startedAt = performance.now();
      state.pauseAccumMs = 0;
      state.pausedAt = 0;
      let samplesAccumulated = 0;
      let lastIterAt = 0;
      let lastPresentAt = 0;

      canvas.style.transition = '';
      canvas.style.opacity = '1';

      const totalPixels = W * H;

      // Decoupled iterate + present loop. Dispatch (iterate) at ITER_INTERVAL_MS
      // — each renderer.iterate carries a fixed ~44ms GPU overhead, so
      // dispatching every rAF (60Hz) saturated the GPU at 99%. Present
      // (visualize-only) is cheap, so we re-tone-map at PRESENT_INTERVAL_MS
      // for smooth visible brightness ramp between dispatches.
      const ITER_INTERVAL_MS = 250;
      const PRESENT_INTERVAL_MS = 100;

      while (!isCancelled()) {
        if (state.skipDir !== 0) break;
        if (state.paused) {
          if (state.pausedAt === 0) state.pausedAt = performance.now();
          await new Promise<void>((r) => setTimeout(r, 100));
          continue;
        }
        if (state.pausedAt !== 0) {
          state.pauseAccumMs += performance.now() - state.pausedAt;
          state.pausedAt = 0;
        }
        const now = performance.now();
        const elapsed = (now - startedAt - state.pauseAccumMs) / 1000;
        const targetQ = qTarget(elapsed, prefs.buildUpSec);

        // Iterate paced — catch up to qTarget once every ITER_INTERVAL_MS.
        if (now - lastIterAt >= ITER_INTERVAL_MS) {
          const desiredSamples = targetQ * totalPixels;
          const delta = desiredSamples - samplesAccumulated;
          if (delta > 0) {
            const sppToAdd = delta / totalPixels;
            const dispatch = computeDispatch(sppToAdd, W, H);
            renderer.iterate({
              genome,
              seed,
              walkers: dispatch.dispatchWalkers,
              itersPerWalker: dispatch.dispatchIters,
            });
            samplesAccumulated += dispatch.actualSamples;
          }
          lastIterAt = now;
        }

        // Present paced — visualize the current histogram at 10fps. Cheap
        // (no chaos iteration); just density + visualize passes.
        if (now - lastPresentAt >= PRESENT_INTERVAL_MS && samplesAccumulated > 0) {
          renderer.present({
            genome,
            outputView: ctx.getCurrentTexture().createView(),
            totalSamples: samplesAccumulated,
          });
          lastPresentAt = now;
        }

        if (targetQ >= BUILD_UP_TARGET_Q && elapsed >= prefs.buildUpSec) break;
        await new Promise<void>((r) => setTimeout(r, 50));
      }
      if (isCancelled()) return;

      // Final full-quality present before rest.
      renderer.present({
        genome,
        outputView: ctx.getCurrentTexture().createView(),
        totalSamples: Math.max(1, samplesAccumulated),
      });

      // Rest period — hold at full quality. Skip signal shortcircuits;
      // pause extends.
      const restReason = await sleepInteractive(prefs.restSec * 1000, state);
      if (restReason === 'cancelled') return;

      // Fade-to-black ~2s, then advance.
      canvas.style.transition = 'opacity 2s';
      canvas.style.opacity = '0';
      await sleepCancellable(2200, isCancelled);
    }
  })();

  return {
    cancel() {
      state.cancelled = true;
    },
    controls: {
      togglePause() {
        state.paused = !state.paused;
      },
      skip(dir) {
        state.skipDir = dir;
      },
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
      const pill = buildNowPlayingPill({
        onPrev:       () => runHandle?.controls.skip(-1),
        onPause:      () => runHandle?.controls.togglePause(),
        onNext:       () => runHandle?.controls.skip(1),
        onFullscreen: () => { void toggleFullscreen(root); },
        onStop:       stopPlayback,
      });
      root.append(pill);
      attachPillAutohide(pill);
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

  let mousemoveListener: ((ev: MouseEvent) => void) | null = null;
  let pillHideTimer: number | undefined;

  function attachPillAutohide(pill: HTMLElement): void {
    function show(): void {
      pill.style.opacity = '1';
      pill.style.pointerEvents = 'auto';
      window.clearTimeout(pillHideTimer);
      pillHideTimer = window.setTimeout(() => {
        pill.style.opacity = '0';
        pill.style.pointerEvents = 'none';
      }, 2500);
    }
    mousemoveListener = () => show();
    window.addEventListener('mousemove', mousemoveListener);
    show();
  }

  // Window-level keydown listener. Lives for the page lifetime; handlers
  // delegate to the active mode's controls (null when not playing).
  function onKeydown(ev: KeyboardEvent): void {
    // Don't steal keys when the user is typing in the freeform input on the
    // landing card.
    const target = ev.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      // Allow Esc to fall through (browser default).
      if (ev.key !== 'Escape') return;
    }
    if (ev.key === ' ' || ev.code === 'Space') {
      ev.preventDefault();
      runHandle?.controls.togglePause();
      return;
    }
    if (ev.key === 'ArrowLeft')  { runHandle?.controls.skip(-1); return; }
    if (ev.key === 'ArrowRight') { runHandle?.controls.skip(1);  return; }
    if (ev.key === 'f' || ev.key === 'F') {
      void toggleFullscreen(root);
      return;
    }
    if (ev.key === 's' || ev.key === 'S') {
      if (runHandle) stopPlayback();
      return;
    }
    // Esc: browser auto-exits fullscreen. We deliberately don't handle it —
    // playback continues, the page returns to windowed naturally.
  }
  window.addEventListener('keydown', onKeydown);

  function stopPlayback(): void {
    runHandle?.cancel();
    runHandle = null;
    if (mousemoveListener) {
      window.removeEventListener('mousemove', mousemoveListener);
      mousemoveListener = null;
    }
    window.clearTimeout(pillHideTimer);
    root.querySelector('.pyr3-screensaver-pill')?.remove();
    canvasHost.replaceChildren();
    // Exit fullscreen if we're in it. Idempotent if windowed.
    if (document.fullscreenElement) {
      fullscreenIntent.userToggledOff = true;
      void document.exitFullscreen().catch(() => {});
    }
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
  style.textContent = `
.pyr3-screensaver-card.hidden { display: none; }
/* In fullscreen, hide the top strip — the flame owns the whole screen.
   !important overrides the inline display:flex on the strip element. */
.pyr3-screensaver-fs .pyr3-screensaver-strip { display: none !important; }
`;
  document.head.append(style);
}
