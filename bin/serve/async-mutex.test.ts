import { describe, it, expect } from 'vitest';

import { AsyncMutex } from './async-mutex';

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('AsyncMutex', () => {
  it('serializes overlapping tasks so they never interleave', async () => {
    const mutex = new AsyncMutex();
    const log: string[] = [];

    async function job(name: string, delay: number): Promise<void> {
      log.push(`${name}:start`);
      await tick(delay);
      log.push(`${name}:end`);
    }

    // Enqueue A (slow), B (fast), C (medium) all at once. Without the mutex a
    // bare Promise.all would interleave their start/end markers.
    await Promise.all([
      mutex.run(() => job('A', 20)),
      mutex.run(() => job('B', 1)),
      mutex.run(() => job('C', 10)),
    ]);

    // Each task fully completes (start→end) before the next starts, in order.
    expect(log).toEqual([
      'A:start', 'A:end',
      'B:start', 'B:end',
      'C:start', 'C:end',
    ]);
  });

  it('surfaces a task result to its own caller', async () => {
    const mutex = new AsyncMutex();
    await expect(mutex.run(async () => 42)).resolves.toBe(42);
  });

  it('a rejected task does not wedge the queue for the next caller', async () => {
    const mutex = new AsyncMutex();
    const failed = mutex.run(async () => { throw new Error('boom'); });
    const after = mutex.run(async () => 'ok');
    await expect(failed).rejects.toThrow('boom');
    await expect(after).resolves.toBe('ok');
  });

  it('runs the next task only after the prior settles (ordering under failure)', async () => {
    const mutex = new AsyncMutex();
    const log: string[] = [];
    const a = mutex.run(async () => { await tick(15); log.push('a'); throw new Error('x'); });
    const b = mutex.run(async () => { log.push('b'); });
    await Promise.allSettled([a, b]);
    expect(log).toEqual(['a', 'b']);
  });
});
