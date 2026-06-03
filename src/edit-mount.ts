// pyr3 — /v1/edit page mount.
//
// Owns WebGPU canvas wiring, creates EditState, wires the lane scheduler to
// the EditRenderer, and composes section modules into the left panel via
// mountEditUi. The renderer's histogram lives across edits — fast-lane edits
// re-present without touching it; slow-lane edits reset + re-iterate.
//
// Top-bar action callbacks: 🎲 reroll / 📂 open / 💾 save wired here in Task 4.1;
// 🖼️ render PNG wired in Task 4.2 (resizes editor canvas to configured dims,
// renders at full quality, toBlobs + downloads, restores preview dims).

import {
  createEditState,
  createLaneScheduler,
  pathLane,
  type EditState,
  type LaneScheduler,
} from './edit-state';
import { generateRandomGenome } from './edit-seed';
import { createRenderer, type Renderer, DEFAULT_FILTER_RADIUS } from './renderer';
import { createEditRenderer, type EditRenderer } from './edit-render';
import { mountEditUi, type SectionMount, type EditUiHandle } from './edit-ui';
import { genomeToJson, genomeFromJson } from './serialize';
import { type Genome } from './genome';

export interface MountEditPageOpts {
  /** Root container the editor takes over (replaceChildren). The caller
   *  sizes the root (typically fill the viewport body). */
  root: HTMLElement;
  /** Pre-acquired WebGPU device. The caller (main.ts) already runs
   *  checkWebGPU + initDevice; we accept the device rather than re-acquiring
   *  it so the editor stays composable in any host. */
  device: GPUDevice;
  /** Canvas format. Same value passed to createRenderer. */
  format: GPUTextureFormat;
  /** Section modules to compose into the left panel. Empty list = shell only
   *  (useful while sections are being written in later tasks). */
  sections: SectionMount[];
  /** Preview size for the editor's canvas. Defaults to 512×512. */
  previewSize?: { width: number; height: number };
  /** Author nick to seed into any fresh genome (random seed / reroll). Read
   *  by the host from localStorage so the user's nick persists across
   *  sessions. Files opened with their own nick keep that nick — defaultNick
   *  only fills in when genome.nick is undefined. */
  defaultNick?: string;
  /** Fires on init + after every genome change (lane fire / reroll / open) so
   *  the host can sync external chrome (e.g. /v1/edit's top bar) with the
   *  current name + dimensions. */
  onStateChange?: (state: EditState) => void;
  /** Fires when a render is in flight — host typically wires this to the
   *  edit bar's tier3 progress panel (same one the viewer uses). label is a
   *  pre-formatted readable string like "rendering 1920×1080 · q50". */
  onProgressShow?: (label: string) => void;
  /** Fires when the in-flight render completes. */
  onProgressHide?: () => void;
}

export interface EditPageHandle {
  destroy(): void;
  /** Test/inspection hook — exposes the live EditState so a host can grab
   *  the current genome. */
  readonly state: EditState;
  /** Programmatic state mutators — let a host wire the top bar's editable
   *  flame name / nick back into the editor state. */
  setName(name: string): void;
  setNick(nick: string): void;
}

const DEFAULT_PREVIEW = { width: 512, height: 512 };

export function mountEditPage(opts: MountEditPageOpts): EditPageHandle {
  const preview = opts.previewSize ?? DEFAULT_PREVIEW;

  // Build root layout: panel left, canvas right. Render-in-flight signal is
  // the page-level bar's tier3 progress panel (same one the viewer uses);
  // wired below via `opts.onProgressShow` / `onProgressHide` callbacks.
  opts.root.replaceChildren();
  opts.root.classList.add('pyr3-edit-root');
  const panelHost = document.createElement('div');
  const canvasHost = document.createElement('div');
  canvasHost.className = 'pyr3-edit-canvas-host';
  const canvas = document.createElement('canvas');
  canvas.width = preview.width;
  canvas.height = preview.height;
  canvasHost.appendChild(canvas);
  opts.root.append(panelHost, canvasHost);

  // WebGPU context on the editor canvas. Assigned to a non-null local so
  // closures (lane scheduler, applyNewGenome) can read it without re-narrowing.
  const ctxOrNull = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!ctxOrNull) {
    throw new Error('pyr3-edit: getContext("webgpu") returned null');
  }
  const ctx: GPUCanvasContext = ctxOrNull;
  ctx.configure({ device: opts.device, format: opts.format, alphaMode: 'opaque' });

  // Apply defaultNick to a genome iff the genome has no nick. Files opened
  // with their own nick keep that nick; random / rerolled / nick-less .pyr3.json
  // get the user's saved nick stamped in.
  function applyDefaultNick(genome: Genome): void {
    if (genome.nick === undefined && opts.defaultNick) {
      genome.nick = opts.defaultNick;
    }
  }

  // Apply editor defaults to fields the user hasn't set yet. Files opened
  // with their own values keep them.
  function applyEditorDefaults(genome: Genome): void {
    if (genome.size === undefined) genome.size = { width: 1920, height: 1080 };
    if (genome.quality === undefined) genome.quality = 50;
  }

  // Initial genome + state.
  const initialGenome = generateRandomGenome();
  applyDefaultNick(initialGenome);
  applyEditorDefaults(initialGenome);
  const initialSeed = (Math.random() * 0xffffffff) >>> 0;
  const state = createEditState(initialGenome, initialSeed);
  state.preview = preview;

  // Resolve render dims from genome — when the user picks a size preset in
  // the Render section, the preview canvas re-sizes + re-iterates to match.
  // Falls back to preview-default (512×512) when genome.size is unset.
  // Oversample is capped at 1 for the live preview (oversample > 1 at full
  // preset dims often blows past WebGPU storage-buffer limits; the
  // 🖼️ render-PNG path uses the genome's actual oversample at save time).
  function effectiveDims(): { width: number; height: number; oversample: number; filterRadius: number } {
    const size = state.genome.size;
    const width = (size?.width ?? 0) > 0 ? size!.width : preview.width;
    const height = (size?.height ?? 0) > 0 ? size!.height : preview.height;
    return {
      width,
      height,
      oversample: 1,
      filterRadius: state.genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS,
    };
  }

  // Renderer + wrapper, sized to whatever the genome currently asks for.
  const initialDims = effectiveDims();
  canvas.width = initialDims.width;
  canvas.height = initialDims.height;
  const renderer: Renderer = createRenderer(opts.device, opts.format, initialDims);
  // editRenderer's own resize callback is intentionally omitted — the lane
  // scheduler below handles resize externally so we can grab the swapchain
  // texture view AFTER the canvas dimensions change (the view is bound to
  // the texture at the time getCurrentTexture() is called; grabbing it
  // before a resize writes into the OLD texture).
  const editRenderer: EditRenderer = createEditRenderer(renderer);

  // Apophysis-style live/settled split. While the user is actively editing
  // (slider drag, keystrokes, rapid clicks) we render at a downsized "live"
  // canvas so feedback is snappy. After SETTLE_DELAY_MS of quiet, a single
  // full-dims render replaces it. Fast-lane edits (tonemap/density) stay on
  // whatever canvas is currently mounted.
  const LIVE_MAX_LONG_EDGE = 384;
  const SETTLE_DELAY_MS = 1500;
  const BAR_DELAY_MS = 500;

  function liveDimsFor(full: { width: number; height: number }): { width: number; height: number } {
    const longEdge = Math.max(full.width, full.height);
    if (longEdge <= LIVE_MAX_LONG_EDGE) return { width: full.width, height: full.height };
    const ratio = LIVE_MAX_LONG_EDGE / longEdge;
    return {
      width: Math.max(1, Math.round(full.width * ratio)),
      height: Math.max(1, Math.round(full.height * ratio)),
    };
  }

  let isLive = false;
  function ensureLiveDims(): boolean {
    const full = effectiveDims();
    const live = liveDimsFor(full);
    if (live.width === canvas.width && live.height === canvas.height) {
      isLive = full.width !== canvas.width || full.height !== canvas.height;
      return false; // no resize needed
    }
    canvas.width = live.width;
    canvas.height = live.height;
    renderer.resize({
      width: live.width, height: live.height,
      oversample: 1, filterRadius: full.filterRadius,
    });
    isLive = true;
    return true;
  }

  /** Return a copy of the live genome with scale divided proportionally so the
   *  flame fills the same fraction of the canvas in live mode as in settled
   *  mode. `genome.scale` is pixels-per-world-unit, so dropping canvas width
   *  from 1920→384 without also dropping scale by 5× would make the flame
   *  visually 5× bigger (overflow). filter radius is also in output px so it
   *  benefits from the same proportional drop. */
  function liveAdjustedGenome(): Genome {
    const full = effectiveDims();
    const live = liveDimsFor(full);
    if (live.width === full.width) return state.genome; // no shrink needed
    const ratio = full.width / live.width;
    const adjusted: Genome = { ...state.genome, scale: state.genome.scale / ratio };
    if (state.genome.spatialFilter) {
      adjusted.spatialFilter = {
        ...state.genome.spatialFilter,
        radius: state.genome.spatialFilter.radius / ratio,
      };
    }
    return adjusted;
  }

  function ensureSettledDims(): boolean {
    const d = effectiveDims();
    if (d.width === canvas.width && d.height === canvas.height && !isLive) return false;
    canvas.width = d.width;
    canvas.height = d.height;
    renderer.resize({
      width: d.width, height: d.height,
      oversample: d.oversample, filterRadius: d.filterRadius,
    });
    isLive = false;
    return true;
  }

  // Progress-bar gating: only appears for renders that actually take >500ms.
  // setTimeout schedules the show; render completion cancels it. Quick
  // renders never trigger the bar — no flicker on fast tweaks.
  let inflightTicket = 0;
  let barShowTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleBarShow(label: string): void {
    if (barShowTimer !== null) clearTimeout(barShowTimer);
    barShowTimer = setTimeout(() => {
      barShowTimer = null;
      opts.onProgressShow?.(label);
    }, BAR_DELAY_MS);
  }
  function cancelBarShowAndHide(): void {
    if (barShowTimer !== null) {
      clearTimeout(barShowTimer);
      barShowTimer = null;
    }
    opts.onProgressHide?.();
  }
  async function awaitGpuThenMaybeHide(myTicket: number): Promise<void> {
    await opts.device.queue.onSubmittedWorkDone();
    if (inflightTicket === myTicket) cancelBarShowAndHide();
  }

  // Settle timer — fires SETTLE_DELAY_MS after the last slow/rebuild edit
  // with a full-dims render. Cleared on every new edit.
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSettle(): void {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      void runSettledRender();
    }, SETTLE_DELAY_MS);
  }
  async function runSettledRender(): Promise<void> {
    inflightTicket++;
    const myTicket = inflightTicket;
    ensureSettledDims();
    const d = effectiveDims();
    const spp = state.genome.quality ?? 50;
    scheduleBarShow(`rendering ${d.width}×${d.height} · q${spp}`);
    const view = ctx.getCurrentTexture().createView();
    editRenderer.applyLane('slow', state.genome, state.seed, view, d.width, d.height);
    opts.onStateChange?.(state);
    await awaitGpuThenMaybeHide(myTicket);
  }

  // Lane scheduler. Slow + rebuild lanes now render at LIVE dims (fast). The
  // settle timer (separate) handles the full-quality render at full dims.
  const scheduler: LaneScheduler = createLaneScheduler(async (lane, _paths) => {
    inflightTicket++;
    const myTicket = inflightTicket;
    if (lane === 'slow' || lane === 'rebuild') {
      ensureLiveDims();
    }
    const view = ctx.getCurrentTexture().createView();
    const w = canvas.width;
    const h = canvas.height;
    // Slow + rebuild both reseed at current (live) dims with a scale-adjusted
    // genome so the framing matches what the settled render will show.
    // Fast lane re-presents the existing histogram, no scale adjustment.
    const genome = (lane === 'slow' || lane === 'rebuild') ? liveAdjustedGenome() : state.genome;
    editRenderer.applyLane(lane === 'rebuild' ? 'slow' : lane, genome, state.seed, view, w, h);
    opts.onStateChange?.(state);
    await awaitGpuThenMaybeHide(myTicket);
  });

  // Replace the whole panel + force a slow-lane reseed. Used by reroll + open.
  let ui: EditUiHandle;
  function rebuildPanel(): void {
    ui?.destroy();
    ui = mountEditUi(panelHost, state, opts.sections, {
      onChange: (path: string) => {
        const lane = pathLane(path);
        scheduler.schedule({ lane, path });
        // Slow + rebuild → restart the settle timer for the eventual
        // full-quality render. Fast lane (tonemap/density/background) just
        // re-presents and doesn't need a settle.
        if (lane === 'slow' || lane === 'rebuild') {
          scheduleSettle();
        }
      },
      onReroll: handleReroll,
      onOpenFile: handleOpenFile,
      onSaveFile: handleSaveFile,
      onRenderPng: handleRenderPng,
    });
  }

  async function applyNewGenome(genome: Genome, seed?: number): Promise<void> {
    state.genome = genome;
    if (seed !== undefined) state.seed = seed;
    rebuildPanel();
    inflightTicket++;
    const myTicket = inflightTicket;
    // Open / reroll always renders at SETTLED dims with the bar gated by
    // BAR_DELAY_MS — these are "intentional, full" renders, not drags.
    ensureSettledDims();
    const d = effectiveDims();
    const spp = state.genome.quality ?? 50;
    scheduleBarShow(`rendering ${d.width}×${d.height} · q${spp}`);
    const view = ctx.getCurrentTexture().createView();
    editRenderer.applyLane('slow', state.genome, state.seed, view, d.width, d.height);
    opts.onStateChange?.(state);
    await awaitGpuThenMaybeHide(myTicket);
  }

  function handleReroll(): void {
    const fresh = generateRandomGenome();
    applyDefaultNick(fresh);
    applyEditorDefaults(fresh);
    const freshSeed = (Math.random() * 0xffffffff) >>> 0;
    applyNewGenome(fresh, freshSeed);
  }

  function handleOpenFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pyr3.json,.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const genome = genomeFromJson(parsed);
        applyDefaultNick(genome);
        applyEditorDefaults(genome);
        applyNewGenome(genome);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`pyr3-edit: open failed — ${msg}`);
        showToast(panelHost, `Open failed: ${msg}`);
      } finally {
        input.remove();
      }
    });
    document.body.appendChild(input);
    input.click();
  }

  async function handleRenderPng(): Promise<void> {
    const targetW = state.genome.size?.width ?? 1024;
    const targetH = state.genome.size?.height ?? 1024;
    const oversample = state.genome.oversample ?? 1;
    const filterRadius = state.genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;

    const modal = showModal(opts.root, `Rendering at ${targetW}×${targetH}…`);
    panelHost.setAttribute('data-busy', 'true');
    // Yield once so the modal paints before the heavy resize+iterate.
    await new Promise<void>((r) => setTimeout(r, 16));

    try {
      canvas.width = targetW;
      canvas.height = targetH;
      renderer.resize({ width: targetW, height: targetH, oversample, filterRadius });
      const view = ctx.getCurrentTexture().createView();
      editRenderer.fullRenderAt(state.genome, state.seed, targetW, targetH, view);

      await new Promise<void>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('toBlob returned null — canvas was not snapshottable'));
            return;
          }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${slugify(state.genome.name)}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          resolve();
        }, 'image/png');
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`pyr3-edit: render-PNG failed — ${msg}`);
      showToast(panelHost, `Render failed: ${msg}`);
    } finally {
      // Restore preview dims + re-iterate so the editor canvas isn't stuck
      // showing the high-res render at a downscaled blur.
      canvas.width = preview.width;
      canvas.height = preview.height;
      renderer.resize({
        width: preview.width,
        height: preview.height,
        oversample: 1,
        filterRadius: DEFAULT_FILTER_RADIUS,
      });
      const view2 = ctx.getCurrentTexture().createView();
      editRenderer.fullRender(state.genome, state.seed, view2, preview.width, preview.height);
      panelHost.removeAttribute('data-busy');
      modal.remove();
    }
  }

  function handleSaveFile(): void {
    try {
      const json = JSON.stringify(genomeToJson(state.genome), null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slugify(state.genome.name)}.pyr3.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after a tick so the browser has time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`pyr3-edit: save failed — ${msg}`);
      showToast(panelHost, `Save failed: ${msg}`);
    }
  }

  // Initial mount + first paint. Same "settled" path as open/reroll.
  rebuildPanel();
  inflightTicket++;
  {
    const spp = state.genome.quality ?? 50;
    scheduleBarShow(`rendering ${initialDims.width}×${initialDims.height} · q${spp}`);
  }
  const view0 = ctx.getCurrentTexture().createView();
  editRenderer.fullRender(state.genome, state.seed, view0, initialDims.width, initialDims.height);
  opts.onStateChange?.(state);
  void awaitGpuThenMaybeHide(inflightTicket);

  return {
    state,
    setName(name: string): void {
      state.genome.name = name;
      scheduler.schedule({ lane: pathLane('name'), path: 'name' });
    },
    setNick(nick: string): void {
      state.genome.nick = nick || undefined;
      scheduler.schedule({ lane: pathLane('nick'), path: 'nick' });
    },
    destroy(): void {
      scheduler.cancel();
      ui?.destroy();
      renderer.destroy();
    },
  };
}

export function slugify(name: string): string {
  const cleaned = (name || 'flame').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'flame';
}

function showToast(host: HTMLElement, message: string): void {
  const t = document.createElement('div');
  t.textContent = message;
  t.style.cssText = `
    position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
    background: #2a1c1c; color: #ff9090; border: 1px solid #8a4a4a;
    border-radius: 4px; padding: 6px 12px; font-size: 12px; z-index: 100;
    pointer-events: none;
  `;
  host.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function showModal(host: HTMLElement, message: string): HTMLElement {
  const m = document.createElement('div');
  m.textContent = message;
  m.style.cssText = `
    position: absolute; inset: 0; display: flex;
    align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.6); color: #ddd;
    font-size: 14px; z-index: 200; pointer-events: all;
  `;
  host.appendChild(m);
  return m;
}
