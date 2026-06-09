// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Genome } from './genome';
import type { Renderer } from './renderer';

// Stub the orchestrator + png-text-chunk modules so the helper can be exercised
// without a real GPU. The stubs are hoisted by vi.mock.
const cancelCalls: number[] = [];
let stubOutcome: 'completed' | 'cancelled' = 'completed';
let lastStartArgs: Record<string, unknown> | null = null;

vi.mock('./render-orchestrator', () => ({
  startChunkedRender: (args: Record<string, unknown>) => {
    lastStartArgs = args;
    return {
      promise: Promise.resolve(stubOutcome),
      cancel: () => { cancelCalls.push(performance.now()); },
    };
  },
}));

const injectCalls: Array<{ keyword: string; value: string; bytes: number }> = [];
vi.mock('./png-text-chunk', () => ({
  injectPngTextChunk: (bytes: Uint8Array, keyword: string, value: string) => {
    injectCalls.push({ keyword, value, bytes: bytes.length });
    return bytes;
  },
}));

import { saveRenderToPng } from './render-save';

function mockCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  // happy-dom doesn't ship a real toBlob; stub one that hands back a 4-byte blob.
  (c as unknown as { toBlob: HTMLCanvasElement['toBlob'] }).toBlob = (cb: BlobCallback) => {
    cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }));
  };
  return c;
}

function mockDevice(): GPUDevice {
  return {
    queue: { onSubmittedWorkDone: () => Promise.resolve() },
  } as unknown as GPUDevice;
}

const FAKE_RENDERER = {} as Renderer;
const FAKE_GENOME = {} as Genome;
const FAKE_CTX = {
  getCurrentTexture: () => ({ createView: () => ({} as GPUTextureView) }),
} as unknown as GPUCanvasContext;

beforeEach(() => {
  cancelCalls.length = 0;
  injectCalls.length = 0;
  stubOutcome = 'completed';
  lastStartArgs = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saveRenderToPng', () => {
  it('runs startChunkedRender with the expected per-chunk perf knobs', async () => {
    const ctrl = new AbortController();
    await saveRenderToPng({
      renderer: FAKE_RENDERER,
      genome: FAKE_GENOME,
      canvas: mockCanvas(),
      ctx: FAKE_CTX,
      device: mockDevice(),
      abortSignal: ctrl.signal,
      onProgress: () => {},
      filename: 'test.pyr3.png',
      metadataJson: '{}',
      targetSamples: 1_000_000,
      seedBase: 42,
    });
    expect(lastStartArgs?.samplesPerChunk).toBe(4_000_000);
    expect(lastStartArgs?.yieldEveryNChunks).toBe(4);
    expect(lastStartArgs?.targetSamples).toBe(1_000_000);
    expect(lastStartArgs?.seedBase).toBe(42);
  });

  it('returns "completed" on a successful run and injects the pyr3 tEXt chunk', async () => {
    const ctrl = new AbortController();
    const result = await saveRenderToPng({
      renderer: FAKE_RENDERER,
      genome: FAKE_GENOME,
      canvas: mockCanvas(),
      ctx: FAKE_CTX,
      device: mockDevice(),
      abortSignal: ctrl.signal,
      onProgress: () => {},
      filename: 'flame.pyr3.png',
      metadataJson: '{"hello":"world"}',
      targetSamples: 1,
      seedBase: 0,
    });
    expect(result).toBe('completed');
    expect(injectCalls).toHaveLength(1);
    expect(injectCalls[0]).toEqual({ keyword: 'pyr3', value: '{"hello":"world"}', bytes: 4 });
  });

  it('returns "cancelled" without injecting metadata when the orchestrator reports cancel', async () => {
    stubOutcome = 'cancelled';
    const ctrl = new AbortController();
    const result = await saveRenderToPng({
      renderer: FAKE_RENDERER,
      genome: FAKE_GENOME,
      canvas: mockCanvas(),
      ctx: FAKE_CTX,
      device: mockDevice(),
      abortSignal: ctrl.signal,
      onProgress: () => {},
      filename: 'cancelled.pyr3.png',
      metadataJson: '{}',
      targetSamples: 1,
      seedBase: 0,
    });
    expect(result).toBe('cancelled');
    expect(injectCalls).toHaveLength(0);
  });

  it('bridges the AbortSignal to renderHandle.cancel', async () => {
    // Stub a promise that never resolves so we can observe the cancel path.
    let resolve!: (v: 'completed' | 'cancelled') => void;
    const neverResolved = new Promise<'completed' | 'cancelled'>((r) => { resolve = r; });
    const mod = await import('./render-orchestrator');
    (mod.startChunkedRender as unknown as (a: unknown) => unknown) = ((args: Record<string, unknown>) => {
      lastStartArgs = args;
      return {
        promise: neverResolved,
        cancel: () => { cancelCalls.push(performance.now()); resolve('cancelled'); },
      };
    }) as never;

    const ctrl = new AbortController();
    const promise = saveRenderToPng({
      renderer: FAKE_RENDERER,
      genome: FAKE_GENOME,
      canvas: mockCanvas(),
      ctx: FAKE_CTX,
      device: mockDevice(),
      abortSignal: ctrl.signal,
      onProgress: () => {},
      filename: 'abort.pyr3.png',
      metadataJson: '{}',
      targetSamples: 1,
      seedBase: 0,
    });
    ctrl.abort();
    const result = await promise;
    expect(cancelCalls).toHaveLength(1);
    expect(result).toBe('cancelled');
  });
});
