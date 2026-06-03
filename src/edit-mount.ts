// pyr3 — /v1/edit page mount.
//
// Owns WebGPU canvas wiring, creates EditState, wires the lane scheduler to
// the EditRenderer, and composes section modules into the left panel via
// mountEditUi. The renderer's histogram lives across edits — fast-lane edits
// re-present without touching it; slow-lane edits reset + re-iterate.
//
// Top-bar action callbacks (🎲 reroll, 📂 open, 💾 save, 🖼️ render PNG) are
// wired in Task 4.x; left intentionally undefined here so the shell is a
// clean Task 2.1 deliverable.

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
   *  the current genome for save/open flows wired in Task 4.x. */
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

  // WebGPU context on the editor canvas.
  const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!ctx) {
    throw new Error('pyr3-edit: getContext("webgpu") returned null');
  }
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

  // Compose sections + mount UI shell.
  const ui: EditUiHandle = mountEditUi(panelHost, state, opts.sections, {
    onChange: (path: string) => {
      scheduler.schedule({ lane: pathLane(path), path });
    },
    // onReroll / onOpenFile / onSaveFile / onRenderPng → Task 4.x
  });

  // Initial paint.
  const view0 = ctx.getCurrentTexture().createView();
  editRenderer.fullRender(state.genome, state.seed, view0, preview.width, preview.height);

  return {
    state,
    destroy(): void {
      scheduler.cancel();
      ui.destroy();
      renderer.destroy();
    },
  };
}
