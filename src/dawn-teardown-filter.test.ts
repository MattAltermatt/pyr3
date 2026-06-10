import { describe, it, expect } from 'vitest';
import {
  isDawnWorkerTeardownError,
  dawnTeardownUnhandledErrorFilter,
} from './dawn-teardown-filter';

describe('#223 Dawn-node forked-worker teardown filter', () => {
  it('matches the exact pool error vitest emits on the crash (wrapped cause chain)', () => {
    // Shape observed in the wild: a pool wrapper whose .cause is the real exit.
    const err = Object.assign(
      new Error('[vitest-pool]: Worker forks emitted error'),
      { cause: new Error('Worker exited unexpectedly') },
    );
    expect(isDawnWorkerTeardownError(err)).toBe(true);
    expect(dawnTeardownUnhandledErrorFilter(err)).toBe(false); // → non-fatal
  });

  it('matches the bare "Worker exited unexpectedly" error', () => {
    expect(isDawnWorkerTeardownError(new Error('Worker exited unexpectedly'))).toBe(true);
  });

  it('matches the threads-pool variant too', () => {
    expect(isDawnWorkerTeardownError(new Error('[vitest-pool]: Worker threads emitted error'))).toBe(true);
  });

  it('does NOT match a real unhandled rejection from test code', () => {
    const real = new Error('Cannot read properties of undefined (reading foo)');
    expect(isDawnWorkerTeardownError(real)).toBe(false);
    // undefined return → vitest keeps it fatal (the run still fails).
    expect(dawnTeardownUnhandledErrorFilter(real)).toBeUndefined();
  });

  it('does NOT match an assertion-style error that merely mentions "worker"', () => {
    // Guard against over-broad matching: the substring "worker" alone is not enough.
    const assertionish = new Error('expected worker count to be 4 but got 3');
    expect(isDawnWorkerTeardownError(assertionish)).toBe(false);
  });

  it('is robust to non-Error / string / null inputs', () => {
    expect(isDawnWorkerTeardownError('Worker exited unexpectedly')).toBe(true);
    expect(isDawnWorkerTeardownError('a normal log line')).toBe(false);
    expect(isDawnWorkerTeardownError(null)).toBe(false);
    expect(isDawnWorkerTeardownError(undefined)).toBe(false);
    expect(isDawnWorkerTeardownError(42)).toBe(false);
  });
});
