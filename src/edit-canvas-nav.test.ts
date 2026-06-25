// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest';
import { attachPanZoom } from './edit-canvas-nav';
import { type EditState } from './edit-state';

/** Minimal EditState carrying only the fields attachPanZoom reads. */
function makeState(): EditState {
  return {
    genome: { cx: 0.3, cy: -0.2, scale: 100, rotate: 0, size: { width: 512, height: 512 } },
    gizmo: { editOnCanvas: false },
    view: { panX: 0, panY: 0, zoom: 1 },
  } as unknown as EditState;
}

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  // happy-dom returns an all-zero rect by default; stamp a real one so the
  // projection math runs as it would on a laid-out canvas.
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 512, height: 512, right: 512, bottom: 512, x: 0, y: 0, toJSON() {} }) as DOMRect;
  return canvas;
}

function wheel(deltaY: number, clientX: number, clientY: number): WheelEvent {
  return new WheelEvent('wheel', { deltaY, clientX, clientY, bubbles: true, cancelable: true });
}

describe('attachPanZoom — center-anchored zoom (#451)', () => {
  it('zooming with an OFF-CENTER cursor leaves cx / cy untouched', () => {
    const state = makeState();
    const cx0 = state.genome.cx;
    const cy0 = state.genome.cy;
    const scale0 = state.genome.scale;
    const canvas = makeCanvas();
    const handle = attachPanZoom(canvas, state, { onViewportChange: vi.fn() });

    // Cursor near the top-left corner (100,100), well off the 256,256 center.
    canvas.dispatchEvent(wheel(-100, 100, 100)); // deltaY < 0 → zoom IN

    expect(state.genome.scale).toBeGreaterThan(scale0); // scale changed
    expect(state.genome.cx).toBe(cx0);                  // position frozen
    expect(state.genome.cy).toBe(cy0);
    handle.destroy();
  });

  it('zoom OUT also holds the position', () => {
    const state = makeState();
    const cx0 = state.genome.cx;
    const cy0 = state.genome.cy;
    const scale0 = state.genome.scale;
    const canvas = makeCanvas();
    const handle = attachPanZoom(canvas, state, { onViewportChange: vi.fn() });

    canvas.dispatchEvent(wheel(120, 40, 480)); // deltaY > 0 → zoom OUT, off-center cursor

    expect(state.genome.scale).toBeLessThan(scale0);
    expect(state.genome.cx).toBe(cx0);
    expect(state.genome.cy).toBe(cy0);
    handle.destroy();
  });

  it('fires onViewportChange on each wheel tick', () => {
    const state = makeState();
    const onViewportChange = vi.fn();
    const canvas = makeCanvas();
    const handle = attachPanZoom(canvas, state, { onViewportChange });
    canvas.dispatchEvent(wheel(-100, 256, 256));
    expect(onViewportChange).toHaveBeenCalledTimes(1);
    handle.destroy();
  });
});
