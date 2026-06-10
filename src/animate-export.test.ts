// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest';

import { exportAnimate } from './animate-export';

function sseBody(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e));
      controller.close();
    },
  });
}

function mockFetch(response: {
  ok?: boolean;
  status?: number;
  jobId?: string;
  events: string[];
}): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    headers: new Headers({ 'X-Job-ID': response.jobId ?? 'job-123' }),
    body: sseBody(response.events),
  }) as never as typeof fetch;
}

describe('exportAnimate', () => {
  it('walks open + progress + done events and resolves completed', async () => {
    const fetchImpl = mockFetch({
      events: [
        'event: open\ndata: {"jobId":"job-123","frames":3,"out_dir":"/tmp/x"}\n\n',
        'event: progress\ndata: {"frame":1,"total":3,"percent":0.33,"written":"/tmp/x/00000.png"}\n\n',
        'event: progress\ndata: {"frame":2,"total":3,"percent":0.66,"written":"/tmp/x/00001.png"}\n\n',
        'event: progress\ndata: {"frame":3,"total":3,"percent":1.0,"written":"/tmp/x/00002.png"}\n\n',
        'event: done\ndata: {"written":["/tmp/x/00000.png","/tmp/x/00001.png","/tmp/x/00002.png"]}\n\n',
      ],
    });

    const opens: Array<{ jobId: string; frames: number; outDir: string }> = [];
    const progresses: Array<{ frame: number; total: number; percent: number }> = [];
    const ctrl = new AbortController();

    const outcome = await exportAnimate({
      params: { flameXml: '<flames/>', outDir: '/tmp/x', begin: 0, end: 2 },
      onOpen: (o) => opens.push(o),
      onProgress: (p) => progresses.push({ frame: p.frame, total: p.total, percent: p.percent }),
      abortSignal: ctrl.signal,
      fetchImpl,
    });

    expect(outcome.status).toBe('completed');
    expect(outcome.written).toHaveLength(3);
    expect(opens).toHaveLength(1);
    expect(opens[0]).toEqual({ jobId: 'job-123', frames: 3, outDir: '/tmp/x' });
    expect(progresses).toHaveLength(3);
    expect(progresses[2]).toEqual({ frame: 3, total: 3, percent: 1.0 });
  });

  it('returns cancelled outcome on a cancelled SSE event', async () => {
    const fetchImpl = mockFetch({
      events: [
        'event: open\ndata: {"jobId":"job-x","frames":5,"out_dir":"/tmp/y"}\n\n',
        'event: progress\ndata: {"frame":1,"total":5,"percent":0.2,"written":"/tmp/y/00000.png"}\n\n',
        'event: cancelled\ndata: {"jobId":"job-x","written":["/tmp/y/00000.png"]}\n\n',
      ],
    });
    const ctrl = new AbortController();
    const outcome = await exportAnimate({
      params: { flameXml: '<flames/>', outDir: '/tmp/y' },
      onProgress: () => {},
      abortSignal: ctrl.signal,
      fetchImpl,
    });
    expect(outcome.status).toBe('cancelled');
    expect(outcome.written).toEqual(['/tmp/y/00000.png']);
  });

  it('throws when the server emits an error event', async () => {
    const fetchImpl = mockFetch({
      events: [
        'event: open\ndata: {"jobId":"job-z","frames":2,"out_dir":"/tmp/z"}\n\n',
        'event: error\ndata: {"message":"out_dir is read-only"}\n\n',
      ],
    });
    const ctrl = new AbortController();
    await expect(
      exportAnimate({
        params: { flameXml: '<flames/>', outDir: '/tmp/z' },
        onProgress: () => {},
        abortSignal: ctrl.signal,
        fetchImpl,
      }),
    ).rejects.toThrow(/out_dir is read-only/);
  });

  it('aborts via /api/cancel/:jobId when AbortSignal fires', async () => {
    const cancels: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/cancel/')) {
        cancels.push(url);
        return { ok: true, status: 200, headers: new Headers(), body: null } as Response;
      }
      // /api/animate — return an SSE stream that emits open then hangs.
      // Abort signal will fire mid-stream.
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(
            'event: open\ndata: {"jobId":"job-abort","frames":2,"out_dir":"/tmp/q"}\n\n',
          ));
          // Wait long enough that the abort fires before we close.
          init?.signal?.addEventListener('abort', () => {
            controller.close();
          }, { once: true });
        },
      });
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'X-Job-ID': 'job-abort' }),
        body,
      } as Response;
    });

    const ctrl = new AbortController();
    const p = exportAnimate({
      params: { flameXml: '<flames/>', outDir: '/tmp/q' },
      onProgress: () => {},
      abortSignal: ctrl.signal,
      fetchImpl: fetchImpl as never as typeof fetch,
    });
    // Let the open event flush, then abort.
    await new Promise<void>((r) => setTimeout(r, 5));
    ctrl.abort();
    const outcome = await p;
    expect(outcome.status).toBe('cancelled');
    expect(cancels).toContain('/api/cancel/job-abort');
  });

  it('throws when the response is not ok', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
      text: () => Promise.resolve('{"error":"bad input"}'),
      body: null,
    });
    const ctrl = new AbortController();
    await expect(
      exportAnimate({
        params: { flameXml: '<flames/>', outDir: '/tmp/q' },
        onProgress: () => {},
        abortSignal: ctrl.signal,
        fetchImpl: fetchImpl as never as typeof fetch,
      }),
    ).rejects.toThrow(/400/);
  });
});
