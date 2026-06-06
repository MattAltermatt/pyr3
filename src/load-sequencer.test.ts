// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createLoadSequencer } from './load-sequencer';

function fakeDevice(onSubmitted: () => Promise<void> = () => Promise.resolve()): GPUDevice {
  return { queue: { onSubmittedWorkDone: onSubmitted } } as unknown as GPUDevice;
}

describe('load sequencer', () => {
  it('rejects re-entrant loadFile while one is in flight', async () => {
    let release: (() => void) | null = null;
    const loadFromFile = vi.fn(
      () => new Promise<void>((r) => { release = r; }),
    );
    const seq = createLoadSequencer({ device: fakeDevice(), loadFromFile });

    const first = seq.loadFile(new File([''], 'a.flame'));
    const second = seq.loadFile(new File([''], 'b.flame'));
    await second; // dropped immediately
    expect(loadFromFile).toHaveBeenCalledTimes(1);
    release!();
    await first;
    expect(seq.inFlight()).toBe(false);
  });

  it('serializes back-to-back enqueueHook calls (no overlap)', async () => {
    const order: string[] = [];
    let releaseA: (() => void) | null = null;
    let releaseB: (() => void) | null = null;
    const loadFromFile = vi.fn(async (f: File) => {
      order.push(`start:${f.name}`);
      await new Promise<void>((r) => {
        if (f.name === 'a.flame') releaseA = r; else releaseB = r;
      });
      order.push(`end:${f.name}`);
    });
    const seq = createLoadSequencer({ device: fakeDevice(), loadFromFile });

    const pA = seq.enqueueHook('xmlA', 'a.flame');
    const pB = seq.enqueueHook('xmlB', 'b.flame');
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(['start:a.flame']);
    releaseA!();
    await pA;
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual(['start:a.flame', 'end:a.flame', 'start:b.flame']);
    releaseB!();
    await pB;
    expect(order).toEqual(['start:a.flame', 'end:a.flame', 'start:b.flame', 'end:b.flame']);
  });

  it('navLocked drops a second tryNavigateCorpus while one is in flight', async () => {
    let releaseA: (() => void) | null = null;
    const calls: string[] = [];
    const seq = createLoadSequencer({ device: fakeDevice(), loadFromFile: async () => {} });
    const loadA = () => {
      calls.push('A');
      return new Promise<void>((r) => { releaseA = r; });
    };
    const loadB = () => { calls.push('B'); return Promise.resolve(); };

    seq.tryNavigateCorpus(loadA, () => false);
    seq.tryNavigateCorpus(loadB, () => false); // synchronously dropped
    await new Promise((r) => setTimeout(r, 5)); // let enqueueCorpus microtask fire
    expect(calls).toEqual(['A']);
    releaseA!();
    await new Promise((r) => setTimeout(r, 5));
    expect(calls).toEqual(['A']); // B was dropped, not deferred
  });

  it('tryNavigateCorpus refuses while a standalone render is in flight', () => {
    const seq = createLoadSequencer({ device: fakeDevice(), loadFromFile: async () => {} });
    const calls: string[] = [];
    seq.tryNavigateCorpus(() => { calls.push('!'); return Promise.resolve(); }, () => true);
    expect(calls).toEqual([]);
  });

  it('awaits device.queue.onSubmittedWorkDone before releasing loadInFlight', async () => {
    const events: string[] = [];
    let releaseDrain: (() => void) | null = null;
    const drain = () => new Promise<void>((r) => {
      events.push('drain-start');
      releaseDrain = () => { events.push('drain-end'); r(); };
    });
    const loadFromFile = vi.fn(async () => { events.push('load-end'); });
    const seq = createLoadSequencer({ device: fakeDevice(drain), loadFromFile });

    const p = seq.loadFile(new File([''], 'a.flame'));
    await new Promise((r) => setTimeout(r, 5));
    expect(events).toEqual(['load-end', 'drain-start']);
    expect(seq.inFlight()).toBe(true); // still locked during drain
    releaseDrain!();
    await p;
    expect(seq.inFlight()).toBe(false);
    expect(events).toEqual(['load-end', 'drain-start', 'drain-end']);
  });

  it('enqueueCorpus serializes load callbacks', async () => {
    const order: string[] = [];
    let releaseA: (() => void) | null = null;
    const seq = createLoadSequencer({ device: fakeDevice(), loadFromFile: async () => {} });

    const pA = seq.enqueueCorpus(() => {
      order.push('A-start');
      return new Promise<void>((r) => { releaseA = () => { order.push('A-end'); r(); }; });
    });
    const pB = seq.enqueueCorpus(() => { order.push('B'); return Promise.resolve(); });

    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(['A-start']); // B waits behind A
    releaseA!();
    await Promise.all([pA, pB]);
    expect(order).toEqual(['A-start', 'A-end', 'B']);
  });

  it('keeps the corpus chain alive past a load failure', async () => {
    const order: string[] = [];
    const seq = createLoadSequencer({ device: fakeDevice(), loadFromFile: async () => {} });

    const pA = seq.enqueueCorpus(async () => { order.push('A'); throw new Error('boom'); });
    const pB = seq.enqueueCorpus(async () => { order.push('B'); });

    await pA.catch(() => {});
    await pB;
    expect(order).toEqual(['A', 'B']);
  });
});
