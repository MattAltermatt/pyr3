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

import { makeEtaProjector, saveRenderToPng } from './render-save';

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

beforeEach(async () => {
  cancelCalls.length = 0;
  injectCalls.length = 0;
  stubOutcome = 'completed';
  lastStartArgs = null;
  const cap = await import('./capability');
  cap._resetCapabilityForTest();
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

  it('forks to the backend when capability.backend === "dawn-node"', async () => {
    const cap = await import('./capability');
    cap._resetCapabilityForTest();
    // Stub /api/capabilities → dawn-node
    const capFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        backend: 'dawn-node',
        max_quality: null,
        can_write_files: false,
        can_render_animation: false,
      }),
    });
    globalThis.fetch = capFetch as never;
    await cap.fetchCapability();

    // PNG bytes the server pretends to render. Use the PNG magic so the
    // base64 round-trip is meaningful.
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const b64 = Buffer.from(pngBytes).toString('base64');
    // Build an SSE stream: progress events + a final done event.
    const sse = [
      'event: open\ndata: {"jobId":"test-job"}\n\n',
      'event: progress\ndata: {"chunk":1,"total":2,"percent":0.5,"samples":1000}\n\n',
      'event: progress\ndata: {"chunk":2,"total":2,"percent":1.0,"samples":2000}\n\n',
      `event: done\ndata: ${JSON.stringify({ png_base64: b64 })}\n\n`,
    ].join('');
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sse));
        controller.close();
      },
    });
    // Render fetch responds with the SSE stream.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'X-Job-ID': 'test-job' }),
      body,
    }) as never;

    const progressCalls: Array<{ percent: number }> = [];
    const ctrl = new AbortController();
    const canvas = mockCanvas();
    canvas.width = 100; canvas.height = 100;
    // Inject a fake URL/createObjectURL into happy-dom — minimal stub.
    let downloadAttribute: string | null = null;
    const origCreate = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'download', {
          set(v) { downloadAttribute = v; },
          get() { return downloadAttribute; },
        });
      }
      return el;
    }) as never;
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob://test';
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};

    const { saveRenderToPng: helper } = await import('./render-save');
    const result = await helper({
      renderer: FAKE_RENDERER,
      genome: {
        quality: 50,
        oversample: 1,
        palette: { name: 'test', stops: [{ t: 0, r: 0, g: 0, b: 0 }] },
        xforms: [],
      } as never,
      canvas,
      ctx: FAKE_CTX,
      device: mockDevice(),
      abortSignal: ctrl.signal,
      onProgress: (p) => progressCalls.push({ percent: p.percent }),
      filename: 'backend.pyr3.png',
      metadataJson: '{"meta":1}',
      targetSamples: 2_000,
      seedBase: 7,
    });

    expect(result).toBe('completed');
    expect(progressCalls.length).toBe(2);
    expect(progressCalls[0]?.percent).toBe(0.5);
    expect(progressCalls[1]?.percent).toBe(1.0);
    expect(injectCalls).toHaveLength(1);
    expect(injectCalls[0]?.keyword).toBe('pyr3');
    expect(downloadAttribute).toBe('backend.pyr3.png');

    cap._resetCapabilityForTest();
    document.createElement = origCreate;
  });

  it('#324 — surfaces a clean error on a malformed backend "done" event', async () => {
    const cap = await import('./capability');
    cap._resetCapabilityForTest();
    const capFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        backend: 'dawn-node',
        max_quality: null,
        can_write_files: false,
        can_render_animation: false,
      }),
    });
    globalThis.fetch = capFetch as never;
    await cap.fetchCapability();

    // A `done` event whose data is not valid JSON.
    const sse = [
      'event: open\ndata: {"jobId":"j"}\n\n',
      'event: done\ndata: {not valid json\n\n',
    ].join('');
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) { controller.enqueue(encoder.encode(sse)); controller.close(); },
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'X-Job-ID': 'j' }),
      body,
    }) as never;

    const ctrl = new AbortController();
    const canvas = mockCanvas();
    canvas.width = 10; canvas.height = 10;
    await expect(saveRenderToPng({
      renderer: FAKE_RENDERER,
      genome: { quality: 50, oversample: 1, palette: { name: 't', stops: [{ t: 0, r: 0, g: 0, b: 0 }] }, xforms: [] } as never,
      canvas,
      ctx: FAKE_CTX,
      device: mockDevice(),
      abortSignal: ctrl.signal,
      onProgress: () => {},
      filename: 'bad.pyr3.png',
      metadataJson: '{}',
      targetSamples: 1,
      seedBase: 0,
    })).rejects.toThrow(/malformed "done"/);

    cap._resetCapabilityForTest();
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

describe('makeEtaProjector (#204 — ETA anchored past the cold first chunk)', () => {
  it('returns NaN on the first event (cold-warmup chunk, no rate yet)', () => {
    const eta = makeEtaProjector();
    // First chunk landed at 1% complete after a slow 14s cold dispatch.
    expect(Number.isNaN(eta(0.01, 14_000))).toBe(true);
  });

  it('projects from the post-anchor rate, ignoring the cold chunk time', () => {
    const eta = makeEtaProjector();
    eta(0.01, 14_000); // cold first chunk: 1% in 14s — anchor, no estimate
    // Steady state: +1% per 0.3s after the anchor. At 2% (0.3s later), the
    // remaining 98% projects from the 0.3s/1% rate ≈ 29.4s — NOT the ~23min a
    // cumulative 14s/1% would have implied.
    const remaining = eta(0.02, 14_300);
    expect(remaining).toBeCloseTo(0.98 / (0.01 / 0.3), 1); // ≈ 29.4s
    expect(remaining).toBeLessThan(60); // sanity: realistic, not minutes
  });

  it('returns NaN when no forward progress has accrued since the anchor', () => {
    const eta = makeEtaProjector();
    eta(0.01, 14_000); // anchor
    expect(Number.isNaN(eta(0.01, 14_050))).toBe(true); // same percent → no rate
  });

  it('drives the ETA toward 0 as the render nears completion', () => {
    const eta = makeEtaProjector();
    eta(0.01, 0); // anchor
    eta(0.5, 5_000); // mid-run
    const near = eta(0.99, 9_900); // 99% done; rate ≈ 0.98/9.9 per s
    expect(near).toBeGreaterThanOrEqual(0);
    expect(near).toBeLessThan(1); // ~0.1s left
  });
});
