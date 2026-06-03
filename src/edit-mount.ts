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
}

export interface EditPageHandle {
  destroy(): void;
  /** Test/inspection hook — exposes the live EditState so a host can grab
   *  the current genome. */
  readonly state: EditState;
}

const DEFAULT_PREVIEW = { width: 512, height: 512 };

export function mountEditPage(opts: MountEditPageOpts): EditPageHandle {
  const preview = opts.previewSize ?? DEFAULT_PREVIEW;

  // Build root layout: panel left, canvas right.
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

  // Initial genome + state.
  const initialGenome = generateRandomGenome();
  const initialSeed = (Math.random() * 0xffffffff) >>> 0;
  const state = createEditState(initialGenome, initialSeed);
  state.preview = preview;

  // Renderer + wrapper.
  const renderer: Renderer = createRenderer(opts.device, opts.format, {
    width: preview.width,
    height: preview.height,
    oversample: 1,
    filterRadius: DEFAULT_FILTER_RADIUS,
  });
  const editRenderer: EditRenderer = createEditRenderer(renderer, {
    resize: (w, h) => renderer.resize({
      width: w,
      height: h,
      oversample: 1,
      filterRadius: DEFAULT_FILTER_RADIUS,
    }),
  });

  // Lane scheduler — each fire grabs a fresh swapchain texture view and
  // hands it to the editRenderer.
  const scheduler: LaneScheduler = createLaneScheduler((lane, _paths) => {
    const view = ctx.getCurrentTexture().createView();
    editRenderer.applyLane(lane, state.genome, state.seed, view, preview.width, preview.height);
  });

  // Replace the whole panel + force a slow-lane reseed. Used by reroll + open.
  let ui: EditUiHandle;
  function rebuildPanel(): void {
    ui?.destroy();
    ui = mountEditUi(panelHost, state, opts.sections, {
      onChange: (path: string) => {
        scheduler.schedule({ lane: pathLane(path), path });
      },
      onReroll: handleReroll,
      onOpenFile: handleOpenFile,
      onSaveFile: handleSaveFile,
      onRenderPng: handleRenderPng,
    });
  }

  function applyNewGenome(genome: Genome, seed?: number): void {
    state.genome = genome;
    if (seed !== undefined) state.seed = seed;
    rebuildPanel();
    const view = ctx.getCurrentTexture().createView();
    editRenderer.applyLane('slow', state.genome, state.seed, view, preview.width, preview.height);
  }

  function handleReroll(): void {
    const fresh = generateRandomGenome();
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

  // Initial mount + first paint.
  rebuildPanel();
  const view0 = ctx.getCurrentTexture().createView();
  editRenderer.fullRender(state.genome, state.seed, view0, preview.width, preview.height);

  return {
    state,
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
