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
import { BUILD_UP_TARGET_Q, samplesPerFrameForBuildUp } from './screensaver-pacing';
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
import { HERO_GEN, HERO_ID } from './load-intent';

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

// Canvas backing-store dims target HD by default — CSS scales 100% to fill
// the viewport / screen, browser handles the upscale. Going screen-native
// (2560×1440 or 4K) PLUS a genome oversample of 4 builds an internal
// histogram of 50M-130M pixels; each present's density+visualize pass over
// that swamps the GPU and locks the page up. Override with ?w=N&h=N when
// you have headroom. Genome oversample is also capped (see SCREENSAVER_MAX_OS).
const CANVAS_MAX_W = 1920;
const CANVAS_MAX_H = 1080;
const CANVAS_MIN_DIM = 256;
// Genomes typically set oversample 1-4. For real-time screensaver render
// we cap at 2 — going to 4 quadruples the histogram size and present cost
// for marginal visible-quality gain on a fullscreen canvas.
const SCREENSAVER_MAX_OS = 2;

// Build-up loop tuning (spec §4.2.1). Fixed; not user-exposed.
// 30fps cadence with 1024 walkers × ~112 splat iters per walker per frame
// lands ~115k samples/frame at hero dims (1080p × OS=2), reaching q=50
// over 30s buildUpSec at ~13% sustained GPU. See spec §4.2.2 cost model.
const BUILD_UP_TARGET_FPS = 30;
const BUILD_UP_WALKERS    = 1024;
const BUILD_UP_FUSE       = 200;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

interface StripChip {
  key: string;
  label: string;
  onClick: () => void;
}

function buildControlsStrip(chips: StripChip[]): HTMLElement {
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
    gap: '14px',
    background: COLORS.bg.info,
    borderBottom: `1px solid ${COLORS.border}`,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '13px',
    color: COLORS.text.primary,
    zIndex: '12',
  });
  for (const chip of chips) {
    const group = el('button', 'pyr3-screensaver-hint');
    Object.assign(group.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 8px',
      background: 'transparent',
      border: '1px solid transparent',
      borderRadius: '6px',
      cursor: 'pointer',
      fontFamily: 'inherit',
      fontSize: 'inherit',
      color: 'inherit',
    });
    group.title = `${chip.key} — click or press`;
    group.addEventListener('click', chip.onClick);
    group.addEventListener('mouseenter', () => {
      group.style.background = COLORS.bg.action;
      group.style.borderColor = COLORS.border;
    });
    group.addEventListener('mouseleave', () => {
      group.style.background = 'transparent';
      group.style.borderColor = 'transparent';
    });

    const kbd = el('kbd', 'pyr3-screensaver-kbd');
    kbd.textContent = chip.key;
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
      pointerEvents: 'none',
    });
    const lbl = el('span');
    lbl.textContent = chip.label;
    Object.assign(lbl.style, { color: COLORS.text.muted, pointerEvents: 'none' });
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

interface PillHandle {
  el: HTMLElement;
  setPaused(paused: boolean): void;
}

function buildNowPlayingPill(cb: PillCallbacks): PillHandle {
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
  const playPauseBtn = btn('⏸', cb.onPause, 'Pause / resume (Space)');
  // Orange ring signals "this is the live play/pause control." When paused
  // the ring stays static; when playing it pulses gently so the user has
  // an at-a-glance "yes it's running" signal.
  playPauseBtn.style.boxShadow = `0 0 0 2px ${COLORS.flame.top}`;
  playPauseBtn.style.transition = 'box-shadow 0.2s';
  pill.append(
    btn('⏮', cb.onPrev,       'Previous (←)'),
    playPauseBtn,
    btn('⏭', cb.onNext,       'Next (→)'),
    btn('⛶', cb.onFullscreen, 'Toggle fullscreen (F)'),
    btn('⏹', cb.onStop,       'Stop, back to settings (S)'),
  );
  return {
    el: pill,
    setPaused(paused) {
      playPauseBtn.textContent = paused ? '▶' : '⏸';
      playPauseBtn.title = paused ? 'Resume (Space)' : 'Pause (Space)';
      playPauseBtn.style.boxShadow = paused
        ? `0 0 0 2px ${COLORS.flame.top}`
        : `0 0 0 2px ${COLORS.flame.top}, 0 0 10px ${COLORS.flame.mid}`;
    },
  };
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

/** `?hero=true` — render only the canonical hero flame on repeat. Useful
 *  for visually QAing build-up pacing / tonemap behavior against a known
 *  fixture instead of a random shuffle. */
function shouldUseHeroOnly(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('hero') === 'true';
}

function pickSourceRefs(allRefs: SheepRef[]): SheepRef[] {
  if (shouldUseHeroOnly()) return [{ gen: HERO_GEN, id: HERO_ID }];
  return allRefs;
}

interface StatusPanel {
  el: HTMLElement;
  setText(s: string): void;
}

function buildStatusPanel(): StatusPanel {
  const panel = el('div', 'pyr3-screensaver-status');
  Object.assign(panel.style, {
    position: 'absolute',
    top: '60px',
    left: '16px',
    padding: '8px 12px',
    background: COLORS.bg.panel,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '6px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    color: COLORS.text.primary,
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    zIndex: '11',
    minWidth: '240px',
    lineHeight: '1.45',
  });
  panel.textContent = 'starting…';
  return {
    el: panel,
    setText: (s) => { panel.textContent = s; },
  };
}

function clampDim(n: number, max: number): number {
  return Math.max(CANVAS_MIN_DIM, Math.min(max, Math.floor(n)));
}

function makeRenderCanvas(host: HTMLElement): HTMLCanvasElement {
  const canvas = el('canvas', 'pyr3-screensaver-canvas');
  // Render at the user's screen resolution (capped at 4K) so fullscreen
  // looks pixel-native. CSS scales 100% in the windowed view; the browser
  // downsamples cleanly. URL overrides: ?w=NNNN&h=NNNN.
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const overrideW = params?.get('w');
  const overrideH = params?.get('h');
  const sw = overrideW ? Number(overrideW)
    : (typeof window !== 'undefined' && window.screen?.width)  ? window.screen.width  : 1920;
  const sh = overrideH ? Number(overrideH)
    : (typeof window !== 'undefined' && window.screen?.height) ? window.screen.height : 1080;
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
  /** Read current paused state — wired to the pill's play/pause icon. */
  isPaused(): boolean;
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
  // Apply the genome's preferred oversample + filter radius for full quality.
  const overs = Math.min(SCREENSAVER_MAX_OS, genome.oversample ?? 1);
  const filt  = genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;
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
  // Final DE-on present — matches the viewer's q=50 finish.
  renderer.present({
    genome,
    outputView: ctx.getCurrentTexture().createView(),
    totalSamples: Math.max(1, accumulated),
    forceDeOff: false,
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
  status: StatusPanel;
}): ModeHandle {
  const { device, format, canvasHost, prefs, status } = args;
  const state = createModeState();
  const isCancelled = () => state.cancelled;

  void (async () => {
    const front = makeSlideshowCanvas(canvasHost, device, format, 2);
    const back = makeSlideshowCanvas(canvasHost, device, format, 1);
    front.canvas.style.opacity = '0';
    back.canvas.style.opacity = '0';

    status.setText('Loading corpus index…');
    const index = await loadFeatureIndex();
    if (isCancelled()) return;
    const allRefs = pickSourceRefs(index.filter(() => true));
    if (allRefs.length === 0) return;
    const queue = createScreensaverQueue(allRefs, Math.floor(performance.now()));
    let slideNum = 0;

    // Prime the front layer with the first flame.
    const firstRef = queue.next();
    if (!firstRef) return;
    slideNum++;
    let firstGenome: Genome;
    try {
      status.setText(`Rendering slide #${slideNum} (${firstRef.gen}/${firstRef.id})…`);
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
      slideNum++;
      let nextGenome: Genome;
      try {
        status.setText(`Rendering slide #${slideNum} (${pickRef.gen}/${pickRef.id})…`);
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
      const holdStart = performance.now();
      const holdMs = prefs.holdSec * 1000;
      const statusTick = window.setInterval(() => {
        const e = Math.min(prefs.holdSec, (performance.now() - holdStart) / 1000);
        status.setText(`Slide #${slideNum - 1} on screen · ${e.toFixed(0)}s / ${prefs.holdSec}s · next ready`);
      }, 500);
      const reason = await sleepInteractive(holdMs, state);
      window.clearInterval(statusTick);
      if (reason === 'cancelled') return;
      // 'done' and 'skipped' both fall through to the crossfade.
      status.setText(`Crossfading to slide #${slideNum}…`);

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
      isPaused() {
        return state.paused;
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
  status: StatusPanel;
}): ModeHandle {
  const { device, format, canvasHost, prefs, status } = args;
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

    status.setText('Loading corpus index…');
    const index = await loadFeatureIndex();
    if (isCancelled()) return;
    const allRefs = pickSourceRefs(index.filter(() => true));
    if (allRefs.length === 0) return;
    const queue = createScreensaverQueue(allRefs, Math.floor(performance.now()));
    let flameNum = 0;

    while (!isCancelled()) {
      const ref =
        state.skipDir === -1
          ? (queue.prev() ?? queue.next())
          : queue.next();
      state.skipDir = 0;
      if (!ref) break;
      flameNum++;
      let genome: Genome;
      try {
        status.setText(`Loading flame #${flameNum} (${ref.gen}/${ref.id})…`);
        genome = await loadGenomeByRef(ref);
      } catch {
        continue;
      }
      if (isCancelled()) return;

      // Apply screensaver oversample cap (parity with slideshow's
      // renderFlameToQuality). Without this, hero genome's native OS=4
      // quadruples the histogram (8.3M → 33M cells) and pins the GPU on
      // every present pass — the original lockup.
      const overs = Math.min(SCREENSAVER_MAX_OS, genome.oversample ?? 1);
      const filt  = genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;
      renderer.resize({ width: W, height: H, oversample: overs, filterRadius: filt });
      renderer.reset(genome);

      const startedAt = performance.now();
      state.pauseAccumMs = 0;
      state.pausedAt = 0;
      let samplesAccumulated = 0;

      canvas.style.transition = '';
      canvas.style.opacity = '1';

      const totalPixels = W * H;
      const targetTotalSamples = BUILD_UP_TARGET_Q * totalPixels;

      // Pacing math — spec §4.2. Distribute the q=50 sample budget across
      // buildUpSec × fps frames; each walker runs FUSE warm-up iters then
      // splatItersPerWalker iters that actually scatter into the histogram.
      const samplesPerFrame = samplesPerFrameForBuildUp(
        BUILD_UP_TARGET_Q, W, H, prefs.buildUpSec, BUILD_UP_TARGET_FPS,
      );
      const splatItersPerWalker = Math.max(1, Math.ceil(samplesPerFrame / BUILD_UP_WALKERS));
      const totalItersPerWalker = BUILD_UP_FUSE + splatItersPerWalker;
      // Spec §4.2 adaptive cadence (ADAPTIVE_BACKOFF_MS=25 → drop to 20fps
      // when frameElapsed > 25ms) deferred to follow-up. Cost model
      // (§4.2.2) predicts ~4-5ms per frame at hero dims — 30fps has 5×
      // headroom, so v1 ships fixed cadence. If Chrome verify shows a
      // tight frame budget at short buildUpSec or large canvas, add the
      // backoff branch HERE (measure performance.now() - frameStart, swap
      // FRAME_INTERVAL_MS to 50 for that flame).
      const FRAME_INTERVAL_MS   = 1000 / BUILD_UP_TARGET_FPS;

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

        const frameStart = performance.now();

        // Fresh ISAAC seed every frame — same seed re-renders the identical
        // scatter pattern and just brightens the same cells (chaos.ts
        // re-inits ISAAC from `seed` on every dispatch).
        const seed = (Math.random() * 0xffffffff) >>> 0;
        renderer.iterate({
          genome,
          seed,
          walkers:        BUILD_UP_WALKERS,
          itersPerWalker: totalItersPerWalker,
        });
        // Splatted samples = walkers × (iters - fuse). First BUILD_UP_FUSE
        // iters per walker are warm-up; only post-fuse iters scatter.
        // Tracking walkers × iters would over-normalize the tonemap and
        // the build-up would look incorrectly dim.
        samplesAccumulated += BUILD_UP_WALKERS * splatItersPerWalker;

        // Tone-normalize against ACCUMULATED samples (not a fixed target)
        // AND skip density. Each new sample lands bright; the image
        // densifies frame by frame rather than fading-up. forceDeOff: true
        // is required even when genome.density is undefined (renderer.ts
        // useDE rule) to make intent explicit.
        renderer.present({
          genome,
          outputView:   ctx.getCurrentTexture().createView(),
          totalSamples: Math.max(1, samplesAccumulated),
          forceDeOff:   true,
        });

        const elapsed = (performance.now() - startedAt - state.pauseAccumMs) / 1000;
        const pct     = Math.min(100, Math.round(100 * samplesAccumulated / targetTotalSamples));
        status.setText(
          `Building flame #${flameNum} (${ref.gen}/${ref.id})\n` +
          `${elapsed.toFixed(1)}s / ${prefs.buildUpSec}s · ` +
          `samples ${(samplesAccumulated / 1e6).toFixed(1)}M / ${(targetTotalSamples / 1e6).toFixed(1)}M · ${pct}%` +
          (state.paused ? ' · PAUSED' : ''),
        );

        if (samplesAccumulated >= targetTotalSamples) break;
        if (elapsed >= prefs.buildUpSec) break;

        const frameElapsed = performance.now() - frameStart;
        const sleepFor     = Math.max(1, FRAME_INTERVAL_MS - frameElapsed);
        await new Promise<void>((r) => setTimeout(r, sleepFor));
      }
      if (isCancelled()) return;

      // Settle: density ON, tone-normalize to actual accumulated samples.
      // This is the dotty → smooth reveal — the chaos game's coherent
      // attractor emerges via the density pass + log tonemap.
      renderer.present({
        genome,
        outputView:   ctx.getCurrentTexture().createView(),
        totalSamples: Math.max(1, samplesAccumulated),
        forceDeOff:   false,
      });

      // Rest period — hold settled image at full quality.
      const restStart = performance.now();
      const restTick = window.setInterval(() => {
        const e = Math.min(prefs.restSec, (performance.now() - restStart) / 1000);
        status.setText(
          `Flame #${flameNum} (${ref.gen}/${ref.id}) settled\n` +
          `resting ${e.toFixed(0)}s / ${prefs.restSec}s` +
          (state.paused ? ' · PAUSED' : ''),
        );
      }, 500);
      const restReason = await sleepInteractive(prefs.restSec * 1000, state);
      window.clearInterval(restTick);
      if (restReason === 'cancelled') return;

      // Fade-to-black ~2s, then advance.
      status.setText(`Fading out flame #${flameNum}…`);
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
      isPaused() {
        return state.paused;
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

  let pillHandle: PillHandle | null = null;
  let pillSyncTimer: number | undefined;

  const landing = mountScreensaverLanding(root, {
    onPlay: (prefs: ScreensaverPrefs) => {
      landing.card.classList.add('hidden');
      pillHandle = buildNowPlayingPill({
        onPrev:       () => runHandle?.controls.skip(-1),
        onPause:      () => runHandle?.controls.togglePause(),
        onNext:       () => runHandle?.controls.skip(1),
        onFullscreen: () => { void toggleFullscreen(root); },
        onStop:       stopPlayback,
      });
      root.append(pillHandle.el);
      attachPillAutohide(pillHandle.el);
      const status = buildStatusPanel();
      root.append(status.el);
      if (device && format) {
        runHandle =
          prefs.mode === 'build-up'
            ? startBuildUp({ device, format, canvasHost, prefs, status })
            : startSlideshow({ device, format, canvasHost, prefs, status });
      } else {
        status.setText('WebGPU unavailable — preview mode only.');
      }
      // Poll runHandle.controls.isPaused() so the pill icon + ring stays
      // in sync regardless of who toggled pause (keyboard / pill click).
      pillSyncTimer = window.setInterval(() => {
        if (!pillHandle || !runHandle) return;
        pillHandle.setPaused(runHandle.controls.isPaused());
      }, 100);
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
    window.clearInterval(pillSyncTimer);
    pillSyncTimer = undefined;
    pillHandle = null;
    root.querySelector('.pyr3-screensaver-pill')?.remove();
    root.querySelector('.pyr3-screensaver-status')?.remove();
    canvasHost.replaceChildren();
    // Exit fullscreen if we're in it. Idempotent if windowed.
    if (document.fullscreenElement) {
      fullscreenIntent.userToggledOff = true;
      void document.exitFullscreen().catch(() => {});
    }
    landing.card.classList.remove('hidden');
    landing.refresh();
  }

  // Clickable strip: each chip fires the same action as its keyboard
  // shortcut. Esc-chip click does what Esc does (stop + exit FS).
  const strip = buildControlsStrip([
    { key: 'Space', label: 'pause',      onClick: () => runHandle?.controls.togglePause() },
    { key: '← →',   label: 'skip',       onClick: () => runHandle?.controls.skip(1) },
    { key: 'F',     label: 'fullscreen', onClick: () => { void toggleFullscreen(root); } },
    { key: 'Esc',   label: 'exit FS',    onClick: () => { if (runHandle) stopPlayback(); } },
    { key: 'S',     label: 'settings',   onClick: () => { if (runHandle) stopPlayback(); } },
  ]);
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
   !important overrides the inline display:flex on the strip element.
   Use both :fullscreen (native) and our class fallback for max coverage. */
:fullscreen .pyr3-screensaver-strip { display: none !important; }
:-webkit-full-screen .pyr3-screensaver-strip { display: none !important; }
.pyr3-screensaver-fs .pyr3-screensaver-strip { display: none !important; }
/* Also hide the now-playing pill + status panel in fullscreen — pure flame. */
:fullscreen .pyr3-screensaver-pill,
:fullscreen .pyr3-screensaver-status,
:-webkit-full-screen .pyr3-screensaver-pill,
:-webkit-full-screen .pyr3-screensaver-status,
.pyr3-screensaver-fs .pyr3-screensaver-pill,
.pyr3-screensaver-fs .pyr3-screensaver-status { display: none !important; }
`;
  document.head.append(style);
}
