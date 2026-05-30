// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startChunkedRender, startDecoupledRender, type ProgressInfo } from './render-orchestrator';
import type { Genome } from './genome';
import type { Renderer } from './renderer';

// Minimal mock — only the methods the orchestrator touches.
function mockRenderer(): {
  renderer: Renderer;
  resetCalls: Array<Genome>;
  iterateCalls: Array<{ seed: number; walkers: number; iters: number }>;
  presentCalls: Array<{ totalSamples: number; forceDeOff?: boolean }>;
} {
  const resetCalls: Array<Genome> = [];
  const iterateCalls: Array<{ seed: number; walkers: number; iters: number }> = [];
  const presentCalls: Array<{ totalSamples: number; forceDeOff?: boolean }> = [];
  const renderer = {
    reset(g: Genome) { resetCalls.push(g); },
    iterate(req: { seed: number; walkers: number; itersPerWalker: number }) {
      iterateCalls.push({ seed: req.seed, walkers: req.walkers, iters: req.itersPerWalker });
    },
    present(req: { totalSamples: number; forceDeOff?: boolean }) {
      presentCalls.push({ totalSamples: req.totalSamples, forceDeOff: req.forceDeOff });
    },
    render() { throw new Error('not used'); },
    resize() { throw new Error('not used'); },
    destroy() {},
    get width() { return 0; },
    get height() { return 0; },
    get superW() { return 0; },
    get superH() { return 0; },
    get oversample() { return 1; },
    get filterRadius() { return 0; },
  } as unknown as Renderer;
  return { renderer, resetCalls, iterateCalls, presentCalls };
}

const FAKE_GENOME = {} as Genome;
const FAKE_VIEW = {} as GPUTextureView;

beforeEach(() => {
  // happy-dom has requestAnimationFrame; nothing to stub.
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startChunkedRender', () => {
  it('runs targetSamples / SAMPLES_PER_CHUNK chunks and resolves "completed"', async () => {
    const m = mockRenderer();
    const progress: ProgressInfo[] = [];
    const { promise } = startChunkedRender({
      renderer: m.renderer,
      genome: FAKE_GENOME,
      outputViewProvider: () => FAKE_VIEW,
      targetSamples: 3_000_000, // 3 chunks at SAMPLES_PER_CHUNK=1M
      seedBase: 0x1000,
      onProgress: (p) => progress.push(p),
    });
    const outcome = await promise;
    expect(outcome).toBe('completed');
    expect(m.resetCalls.length).toBe(1);
    expect(m.iterateCalls.length).toBe(3);
    expect(progress.length).toBe(3);
    expect(progress[2]!.percent).toBeCloseTo(1.0, 5);
  });

  it('presents after each chunk by default', async () => {
    const m = mockRenderer();
    const { promise } = startChunkedRender({
      renderer: m.renderer,
      genome: FAKE_GENOME,
      outputViewProvider: () => FAKE_VIEW,
      targetSamples: 3_000_000,
      seedBase: 0,
      onProgress: () => {},
    });
    await promise;
    expect(m.presentCalls.length).toBe(3);
  });

  it('presents only once at the end when presentAfterEachChunk=false', async () => {
    const m = mockRenderer();
    const { promise } = startChunkedRender({
      renderer: m.renderer,
      genome: FAKE_GENOME,
      outputViewProvider: () => FAKE_VIEW,
      targetSamples: 3_000_000,
      seedBase: 0,
      onProgress: () => {},
      presentAfterEachChunk: false,
    });
    await promise;
    expect(m.presentCalls.length).toBe(1);
    expect(m.iterateCalls.length).toBe(3);
  });

  it('uses seedBase + chunkIndex per iterate', async () => {
    const m = mockRenderer();
    const { promise } = startChunkedRender({
      renderer: m.renderer,
      genome: FAKE_GENOME,
      outputViewProvider: () => FAKE_VIEW,
      targetSamples: 3_000_000,
      seedBase: 0x42,
      onProgress: () => {},
    });
    await promise;
    expect(m.iterateCalls.map((c) => c.seed)).toEqual([0x42, 0x43, 0x44]);
  });

  it('cancel() halts subsequent chunks and resolves "cancelled"', async () => {
    const m = mockRenderer();
    const handle = startChunkedRender({
      renderer: m.renderer,
      genome: FAKE_GENOME,
      outputViewProvider: () => FAKE_VIEW,
      targetSamples: 5_000_000, // 5 chunks
      seedBase: 0,
      onProgress: () => {
        if (m.iterateCalls.length === 2) handle.cancel();
      },
    });
    const outcome = await handle.promise;
    expect(outcome).toBe('cancelled');
    // Cancel happens after chunk 2 fires onProgress; loop checks the
    // cancel flag at the TOP of the next iteration, so iterateCalls
    // freezes at 2.
    expect(m.iterateCalls.length).toBe(2);
  });

  it('produces monotonically advancing percent values', async () => {
    const m = mockRenderer();
    const seq: number[] = [];
    const { promise } = startChunkedRender({
      renderer: m.renderer,
      genome: FAKE_GENOME,
      outputViewProvider: () => FAKE_VIEW,
      targetSamples: 4_000_000,
      seedBase: 0,
      onProgress: (p) => seq.push(p.percent),
    });
    await promise;
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i]!).toBeGreaterThan(seq[i - 1]!);
    }
  });

  it('handles tiny targetSamples (< 1 chunk) by running exactly one chunk', async () => {
    const m = mockRenderer();
    const { promise } = startChunkedRender({
      renderer: m.renderer,
      genome: FAKE_GENOME,
      outputViewProvider: () => FAKE_VIEW,
      targetSamples: 500,
      seedBase: 0,
      onProgress: () => {},
    });
    await promise;
    expect(m.iterateCalls.length).toBe(1);
  });
});

describe('startDecoupledRender', () => {
  it('runs ceil(targetSamples / samplesPerDispatch) dispatches and resolves "completed"', async () => {
    const m = mockRenderer();
    const progress: ProgressInfo[] = [];
    const { promise } = startDecoupledRender({
      renderer: m.renderer,
      genome: FAKE_GENOME,
      outputViewProvider: () => FAKE_VIEW,
      targetSamples: 30_000_000,
      seedBase: 0x10,
      samplesPerDispatch: 10_000_000, // 3 dispatches
      onProgress: (p) => progress.push(p),
    });
    const outcome = await promise;
    expect(outcome).toBe('completed');
    expect(m.resetCalls.length).toBe(1);
    expect(m.iterateCalls.length).toBe(3);
    expect(progress.length).toBe(3);
    expect(progress[2]!.percent).toBeCloseTo(1.0, 5);
  });

  it('uses seedBase + dispatchIndex per iterate', async () => {
    const m = mockRenderer();
    const { promise } = startDecoupledRender({
      renderer: m.renderer,
      genome: FAKE_GENOME,
      outputViewProvider: () => FAKE_VIEW,
      targetSamples: 30_000_000,
      seedBase: 0x99,
      samplesPerDispatch: 10_000_000,
      onProgress: () => {},
    });
    await promise;
    expect(m.iterateCalls.map((c) => c.seed)).toEqual([0x99, 0x9a, 0x9b]);
  });

  it('derives walkersPerDispatch from samplesPerDispatch / ITERS_PER_CHUNK', async () => {
    const m = mockRenderer();
    const { promise } = startDecoupledRender({
      renderer: m.renderer,
      genome: FAKE_GENOME,
      outputViewProvider: () => FAKE_VIEW,
      targetSamples: 10_000_000,
      seedBase: 0,
      samplesPerDispatch: 10_000_000,
      onProgress: () => {},
    });
    await promise;
    // 10M / 4096 iters ≈ 2441 walkers; all dispatches use the same count.
    expect(m.iterateCalls[0]!.walkers).toBe(Math.round(10_000_000 / 4096));
    expect(m.iterateCalls[0]!.iters).toBe(4096);
  });

  it('lands a final full-quality present (DE on, forceDeOff=false) on completion', async () => {
    const m = mockRenderer();
    const { promise } = startDecoupledRender({
      renderer: m.renderer,
      genome: FAKE_GENOME,
      outputViewProvider: () => FAKE_VIEW,
      targetSamples: 20_000_000,
      seedBase: 0,
      samplesPerDispatch: 10_000_000,
      onProgress: () => {},
    });
    await promise;
    expect(m.presentCalls.length).toBeGreaterThanOrEqual(1);
    expect(m.presentCalls[m.presentCalls.length - 1]!.forceDeOff).toBe(false);
  });

  it('mid-build display presents use cheap DE-off previews by default', async () => {
    const m = mockRenderer();
    const { promise } = startDecoupledRender({
      renderer: m.renderer,
      genome: FAKE_GENOME,
      outputViewProvider: () => FAKE_VIEW,
      targetSamples: 50_000_000,
      seedBase: 0,
      samplesPerDispatch: 10_000_000,
      displayIntervalMs: 0, // present on every rAF so previews are observed
      onProgress: () => {},
    });
    await promise;
    // Every present except the final one is a cheap DE-off preview.
    const previews = m.presentCalls.slice(0, -1);
    for (const p of previews) expect(p.forceDeOff).toBe(true);
  });

  it('cancel() halts subsequent dispatches and resolves "cancelled"', async () => {
    const m = mockRenderer();
    const handle = startDecoupledRender({
      renderer: m.renderer,
      genome: FAKE_GENOME,
      outputViewProvider: () => FAKE_VIEW,
      targetSamples: 50_000_000, // 5 dispatches
      seedBase: 0,
      samplesPerDispatch: 10_000_000,
      onProgress: () => {
        if (m.iterateCalls.length === 2) handle.cancel();
      },
    });
    const outcome = await handle.promise;
    expect(outcome).toBe('cancelled');
    expect(m.iterateCalls.length).toBe(2);
    // A cancelled run does NOT emit the final full-DE present.
    expect(m.presentCalls.every((p) => p.forceDeOff !== false)).toBe(true);
  });

  it('handles tiny targetSamples (< 1 dispatch) by running exactly one dispatch', async () => {
    const m = mockRenderer();
    const { promise } = startDecoupledRender({
      renderer: m.renderer,
      genome: FAKE_GENOME,
      outputViewProvider: () => FAKE_VIEW,
      targetSamples: 500,
      seedBase: 0,
      onProgress: () => {},
    });
    await promise;
    expect(m.iterateCalls.length).toBe(1);
  });
});
