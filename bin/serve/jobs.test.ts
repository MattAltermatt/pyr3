import { describe, it, expect } from 'vitest';
import { createJob, cancelJob, clearJob, activeJobCount } from './jobs';

describe('jobs', () => {
  it('createJob returns a unique id + a fresh AbortController', () => {
    const a = createJob();
    const b = createJob();
    expect(a.id).not.toBe(b.id);
    expect(a.controller.signal.aborted).toBe(false);
    expect(b.controller.signal.aborted).toBe(false);
    clearJob(a.id);
    clearJob(b.id);
  });

  it('cancelJob aborts the controller and removes the entry', () => {
    const j = createJob();
    expect(cancelJob(j.id)).toBe(true);
    expect(j.controller.signal.aborted).toBe(true);
    // second cancel is a no-op
    expect(cancelJob(j.id)).toBe(false);
  });

  it('cancelJob on an unknown id returns false', () => {
    expect(cancelJob('not-a-real-id')).toBe(false);
  });

  it('clearJob removes the entry without aborting', () => {
    const j = createJob();
    const before = activeJobCount();
    clearJob(j.id);
    expect(activeJobCount()).toBe(before - 1);
    expect(j.controller.signal.aborted).toBe(false);
  });
});
