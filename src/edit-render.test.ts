import { describe, expect, it, vi } from 'vitest';
import { createEditRenderer } from './edit-render';
import { generateRandomGenome } from './edit-seed';
import { type Renderer } from './renderer';

interface StubRenderer extends Renderer {
  resetCalls: number;
  iterateCalls: number;
  presentCalls: number;
  resizeCalls: number;
}

function stubRenderer(): StubRenderer {
  const r = {
    resetCalls: 0,
    iterateCalls: 0,
    presentCalls: 0,
    resizeCalls: 0,
    width: 512,
    height: 512,
    superW: 512,
    superH: 512,
    oversample: 1,
    filterRadius: 0.5,
  } as StubRenderer;
  r.reset = vi.fn(() => { r.resetCalls++; });
  r.iterate = vi.fn(() => { r.iterateCalls++; });
  r.present = vi.fn(() => { r.presentCalls++; });
  r.resize = vi.fn(() => { r.resizeCalls++; });
  r.render = vi.fn();
  r.destroy = vi.fn();
  return r;
}

const fakeView = {} as GPUTextureView;

describe('createEditRenderer', () => {
  it('fast lane (after warm-up) calls present only', () => {
    const r = stubRenderer();
    const er = createEditRenderer(r);
    const g = generateRandomGenome(() => 0.5);

    // Warm the wrapper with a slow-lane apply so lastSamples > 0.
    er.applyLane('slow', g, 1, fakeView, 512, 512);
    expect(r.resetCalls).toBe(1);
    expect(r.iterateCalls).toBe(1);
    expect(r.presentCalls).toBe(1);

    // Now fast lane: present() only, no reset / iterate.
    er.applyLane('fast', g, 1, fakeView, 512, 512);
    expect(r.resetCalls).toBe(1);
    expect(r.iterateCalls).toBe(1);
    expect(r.presentCalls).toBe(2);
  });

  it('fast lane without prior iterate falls back to a reseed', () => {
    const r = stubRenderer();
    const er = createEditRenderer(r);
    const g = generateRandomGenome(() => 0.5);
    er.applyLane('fast', g, 1, fakeView, 512, 512);
    expect(r.resetCalls).toBe(1);
    expect(r.iterateCalls).toBe(1);
    expect(r.presentCalls).toBe(1);
  });

  it('slow lane runs reset + iterate + present', () => {
    const r = stubRenderer();
    const er = createEditRenderer(r);
    const g = generateRandomGenome(() => 0.5);
    er.applyLane('slow', g, 1, fakeView, 512, 512);
    expect(r.resetCalls).toBe(1);
    expect(r.iterateCalls).toBe(1);
    expect(r.presentCalls).toBe(1);
  });

  it('rebuild lane calls resize before reset + iterate + present', () => {
    const r = stubRenderer();
    const resize = vi.fn();
    const er = createEditRenderer(r, { resize });
    const g = generateRandomGenome(() => 0.5);
    er.applyLane('rebuild', g, 1, fakeView, 1290, 2796);
    expect(resize).toHaveBeenCalledWith(1290, 2796);
    expect(r.resetCalls).toBe(1);
    expect(r.iterateCalls).toBe(1);
    expect(r.presentCalls).toBe(1);
  });

  it('rebuild without resize callback is still safe (no-op resize)', () => {
    const r = stubRenderer();
    const er = createEditRenderer(r);
    const g = generateRandomGenome(() => 0.5);
    er.applyLane('rebuild', g, 1, fakeView, 1290, 2796);
    expect(r.resetCalls).toBe(1);
    expect(r.iterateCalls).toBe(1);
    expect(r.presentCalls).toBe(1);
  });

  it('fullRender runs reset + iterate + present at preview SPP', () => {
    const r = stubRenderer();
    const er = createEditRenderer(r);
    const g = generateRandomGenome(() => 0.5);
    er.fullRender(g, 1, fakeView, 512, 512);
    expect(r.resetCalls).toBe(1);
    expect(r.iterateCalls).toBe(1);
    expect(r.presentCalls).toBe(1);
  });

  it('fullRenderAt uses genome.quality (not preview SPP)', () => {
    const r = stubRenderer();
    const er = createEditRenderer(r);
    const g = generateRandomGenome(() => 0.5);
    g.quality = 200; // explicit high quality for the save path
    er.fullRenderAt(g, 1, 1290, 2796, fakeView);
    expect(r.resetCalls).toBe(1);
    expect(r.iterateCalls).toBe(1);
    expect(r.presentCalls).toBe(1);
    // iterate was called with the higher walker × iter product than quick mode would have produced.
    const call = (r.iterate as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.walkers * call.itersPerWalker).toBeGreaterThan(1290 * 2796 * 16); // > quick-mode budget
  });

  // ── #176 Task 2: applyLane opts.targetSpp ────────────────────────────────
  describe('applyLane with opts.targetSpp (preview-side spp override)', () => {
    it('uses opts.targetSpp instead of genome.quality when provided', () => {
      const r = stubRenderer();
      const er = createEditRenderer(r);
      const g = generateRandomGenome(() => 0.5);
      g.quality = 200; // would normally drive the preview at 200 spp

      er.applyLane('slow', g, 1, fakeView, 512, 512, { targetSpp: 25 });

      const call = (r.iterate as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      const samples = call.walkers * call.itersPerWalker;
      // 25 spp at 512² = ~6.5M samples; 200 spp would be ~52M. Should be much closer to 6.5M.
      expect(samples).toBeLessThan(15_000_000);
    });

    it('falls back to today\'s behavior (genome.quality clamp) when opts omitted', () => {
      const r = stubRenderer();
      const er = createEditRenderer(r);
      const g = generateRandomGenome(() => 0.5);
      g.quality = 50;
      er.applyLane('slow', g, 1, fakeView, 256, 256);
      expect(r.iterateCalls).toBe(1); // unchanged behavior
    });
  });

  // ── #176 Task 2: fullRenderAt opts.signal + opts.onProgress ──────────────
  describe('fullRenderAt with opts.signal + opts.onProgress', () => {
    it('single-shot path when no opts (preserves parity-stable behavior)', () => {
      const r = stubRenderer();
      const er = createEditRenderer(r);
      const g = generateRandomGenome(() => 0.5);
      er.fullRenderAt(g, 1, 256, 256, fakeView);
      expect(r.iterateCalls).toBe(1);
      expect(r.presentCalls).toBe(1);
    });

    it('chunked path with onProgress — dispatches N batches, reports 0..1 fractions', async () => {
      const r = stubRenderer();
      const er = createEditRenderer(r);
      const g = generateRandomGenome(() => 0.5);
      const fractions: number[] = [];
      await er.fullRenderAt(g, 1, 256, 256, fakeView, {
        onProgress: (f) => fractions.push(f),
      });
      expect(r.iterateCalls).toBeGreaterThan(1); // chunked into multiple dispatches
      expect(r.presentCalls).toBe(1); // single present after iteration completes
      expect(fractions.length).toBeGreaterThan(0);
      expect(fractions[0]).toBeGreaterThan(0);
      expect(fractions.at(-1)).toBeCloseTo(1.0, 2);
      fractions.forEach((f) => {
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
      });
    });

    it('AbortSignal bails out cleanly — throws AbortError + skips final present', async () => {
      const r = stubRenderer();
      const er = createEditRenderer(r);
      const g = generateRandomGenome(() => 0.5);
      const ctrl = new AbortController();
      await expect(
        er.fullRenderAt(g, 1, 256, 256, fakeView, {
          signal: ctrl.signal,
          onProgress: (f) => {
            if (f >= 0.3) ctrl.abort();
          },
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(r.presentCalls).toBe(0); // never reached the final present
    });

    it('AbortSignal already-aborted when called — bails before any dispatch', async () => {
      const r = stubRenderer();
      const er = createEditRenderer(r);
      const g = generateRandomGenome(() => 0.5);
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(
        er.fullRenderAt(g, 1, 256, 256, fakeView, { signal: ctrl.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(r.iterateCalls).toBe(0);
      expect(r.presentCalls).toBe(0);
    });

    it('dynamic batch count — scales up batches for large renders to prevent TDR', async () => {
      const r = stubRenderer();
      const er = createEditRenderer(r);
      const g = generateRandomGenome(() => 0.5);
      g.quality = 200; // high SPP target
      await er.fullRenderAt(g, 1, 3840, 2160, fakeView, {
        onProgress: () => {},
      });
      // With 1583 walkers & 1,048,576 iters, it should split into 64 batches
      expect(r.iterateCalls).toBe(64);
    });
  });
});
