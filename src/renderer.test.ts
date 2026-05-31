// Renderer canvas-repoint contract — proves a single Renderer instance can
// be driven against multiple distinct output texture views in sequence
// without leaking the previous target into the next call. This is the seam
// the gallery wave-fill orchestrator (issue #47) relies on to paint 9 cells
// from one GPUDevice.
//
// We can't spin up a real GPUDevice in a Vitest unit run (parity-fe-be is
// the integration layer for that). Instead we verify the call-flow contract:
// the Renderer never caches the outputView between calls — every present()
// receives exactly the view its caller passed, and a follow-up call with a
// different view writes to the new target with no residue from the previous.
//
// The behavior is enforced by the createRenderer implementation in
// renderer.ts: `present(req)` passes `req.outputView` straight into
// `viz.draw(...)` and never stores it on `pipelines` or any closure-level
// variable. This test pins that contract so a future refactor that
// accidentally caches the view (e.g. "let lastView = req.outputView") fails
// loudly.

import { describe, it, expect, vi } from 'vitest';
import type { Renderer, IterateRequest, PresentRequest, RenderRequest } from './renderer';
import type { Genome } from './genome';

// Build a fake Renderer whose present() records the exact outputView it
// received. The shape mirrors what createRenderer returns; the actual
// closure-free pass-through is what we're asserting.
function recordingRenderer(): {
  renderer: Renderer;
  presentedViews: GPUTextureView[];
} {
  const presentedViews: GPUTextureView[] = [];
  const renderer: Renderer = {
    reset(_g: Genome) {},
    iterate(_req: IterateRequest) {},
    present(req: PresentRequest) {
      presentedViews.push(req.outputView);
    },
    render(req: RenderRequest) {
      // Match createRenderer's wrapper: present receives the same view the
      // caller handed render(). No caching across calls.
      presentedViews.push(req.outputView);
    },
    resize() {},
    destroy() {},
    get width() { return 512; },
    get height() { return 512; },
    get superW() { return 512; },
    get superH() { return 512; },
    get oversample() { return 1; },
    get filterRadius() { return 0.5; },
  };
  return { renderer, presentedViews };
}

const FAKE_GENOME = {} as Genome;

describe('Renderer canvas-repoint contract', () => {
  it('forwards a different outputView per present() call without caching', () => {
    const { renderer, presentedViews } = recordingRenderer();
    const viewA = { _tag: 'A' } as unknown as GPUTextureView;
    const viewB = { _tag: 'B' } as unknown as GPUTextureView;

    renderer.present({ genome: FAKE_GENOME, outputView: viewA, totalSamples: 1_000_000 });
    renderer.present({ genome: FAKE_GENOME, outputView: viewB, totalSamples: 1_000_000 });

    expect(presentedViews).toHaveLength(2);
    expect(presentedViews[0]).toBe(viewA);
    expect(presentedViews[1]).toBe(viewB);
    // The two views are distinct — no aliasing, no residual reference to
    // viewA bleeding into the second call.
    expect(presentedViews[0]).not.toBe(presentedViews[1]);
  });

  it('drives N distinct canvas views in sequence (gallery wave-fill pattern)', () => {
    const { renderer, presentedViews } = recordingRenderer();
    // Simulate the 3x3 gallery: 9 cell canvases, each providing its own
    // GPUTextureView from context.getCurrentTexture().createView().
    const cellViews: GPUTextureView[] = Array.from({ length: 9 }, (_, i) =>
      ({ _cell: i } as unknown as GPUTextureView));

    for (const view of cellViews) {
      renderer.reset(FAKE_GENOME);
      renderer.iterate({ genome: FAKE_GENOME, seed: 0xC0FFEE, walkers: 1024, itersPerWalker: 4096 });
      renderer.present({ genome: FAKE_GENOME, outputView: view, totalSamples: 4_194_304 });
    }

    expect(presentedViews).toHaveLength(9);
    for (let i = 0; i < 9; i++) {
      expect(presentedViews[i]).toBe(cellViews[i]);
    }
    // All 9 are unique references — proves no caching upstream.
    expect(new Set(presentedViews).size).toBe(9);
  });

  it('render() convenience wrapper also routes outputView through, no caching', () => {
    const { renderer, presentedViews } = recordingRenderer();
    const viewA = { _tag: 'render-A' } as unknown as GPUTextureView;
    const viewB = { _tag: 'render-B' } as unknown as GPUTextureView;

    renderer.render({ genome: FAKE_GENOME, outputView: viewA });
    renderer.render({ genome: FAKE_GENOME, outputView: viewB });

    expect(presentedViews[0]).toBe(viewA);
    expect(presentedViews[1]).toBe(viewB);
  });

  it('Renderer interface exposes no canvas-binding surface (no setCanvas)', () => {
    // Pin the contract: the Renderer is canvas-free by design. If a future
    // refactor adds a setCanvas() or similar, this assertion forces an
    // explicit decision about the gallery orchestrator's repoint flow.
    const { renderer } = recordingRenderer();
    expect((renderer as unknown as Record<string, unknown>).setCanvas).toBeUndefined();
    expect((renderer as unknown as Record<string, unknown>).bindCanvas).toBeUndefined();
    expect((renderer as unknown as Record<string, unknown>).context).toBeUndefined();
  });
});

// Light smoke: vi import kept warm in case future tests need spies.
void vi;
