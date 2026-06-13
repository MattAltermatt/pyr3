// src/timeline-thumbnails.ts
// #227c — render a small GPU thumbnail of each timeline clip's flame to its own
// offscreen canvas. Self-contained: creates one small Renderer, presents each
// clip's genome to that clip's canvas via the single-shot renderer.render()
// path (the Renderer holds no canvas ref — present target is per-call), then
// destroys the Renderer. Quality is capped so the strip paints quickly.

import { createRenderer, DEFAULT_FILTER_RADIUS } from './renderer';
import { type Timeline } from './timeline';

export interface ThumbnailOpts {
  /** Bounding box the thumbnail fits inside. Defaults to 160×120. The actual
   *  canvas preserves the genome's native aspect within this box. */
  width?: number;
  height?: number;
  /** Samples-per-pixel cap for the thumbnail render. Defaults to 12. */
  maxSpp?: number;
}

/** Render one thumbnail canvas per clip (index-aligned to timeline.clips). Each
 *  thumbnail preserves its genome's native aspect within the box and scales the
 *  camera (`scale` = px/world-unit) by the same fit factor so the WHOLE flame
 *  frames into the smaller canvas — otherwise the genome's native-size `scale`
 *  renders a zoomed-in crop (e.g. lops the bottom point off an inverted
 *  Sierpinski, leaving "two points"). */
export async function renderClipThumbnails(
  device: GPUDevice,
  format: GPUTextureFormat,
  timeline: Timeline,
  opts: ThumbnailOpts = {},
): Promise<HTMLCanvasElement[]> {
  const boxW = opts.width ?? 160;
  const boxH = opts.height ?? 120;
  const maxSpp = opts.maxSpp ?? 12;

  const renderer = createRenderer(device, format, {
    width: boxW, height: boxH, oversample: 1, filterRadius: DEFAULT_FILTER_RADIUS,
  });
  const canvases: HTMLCanvasElement[] = [];
  try {
    for (const clip of timeline.clips) {
      const g = clip.flame.genome;
      // Fit the genome's native frame into the box, preserving aspect.
      const nativeW = g.size?.width ?? boxW;
      const nativeH = g.size?.height ?? boxH;
      const fit = Math.min(boxW / nativeW, boxH / nativeH);
      const tw = Math.max(1, Math.round(nativeW * fit));
      const th = Math.max(1, Math.round(nativeH * fit));

      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null;
      if (!ctx) throw new Error('timeline-thumbnails: WebGPU canvas context unavailable');
      ctx.configure({ device, format, alphaMode: 'premultiplied' });

      renderer.resize({ width: tw, height: th, oversample: 1, filterRadius: DEFAULT_FILTER_RADIUS });
      const genome = {
        ...g,
        quality: Math.min(g.quality ?? maxSpp, maxSpp),
        scale: g.scale * fit, // shrink the camera to keep the full native frame visible
      };
      renderer.render({ genome, outputView: ctx.getCurrentTexture().createView() });
      await device.queue.onSubmittedWorkDone();
      canvases.push(canvas);
    }
  } finally {
    renderer.destroy();
  }
  return canvases;
}
