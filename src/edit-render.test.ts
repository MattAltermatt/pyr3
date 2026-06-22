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
});
