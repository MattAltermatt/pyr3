import { describe, it, expect } from 'vitest';
import { createScreensaverQueue, type SheepRef } from './screensaver-queue';

const refs: SheepRef[] = [
  { gen: 244, id: 1 },
  { gen: 244, id: 2 },
  { gen: 244, id: 3 },
  { gen: 244, id: 4 },
];

describe('createScreensaverQueue', () => {
  it('seeded RNG produces deterministic sequence', () => {
    const a = createScreensaverQueue(refs, 42);
    const b = createScreensaverQueue(refs, 42);
    expect(a.next()).toEqual(b.next());
    expect(a.next()).toEqual(b.next());
    expect(a.next()).toEqual(b.next());
  });

  it('next returns a ref from the input corpus', () => {
    const q = createScreensaverQueue(refs, 1);
    const r = q.next();
    expect(refs).toContainEqual(r);
  });

  it('prev pops history; returns null when history exhausted', () => {
    const q = createScreensaverQueue(refs, 1);
    const a = q.next();
    const b = q.next();
    const c = q.next();
    expect(q.prev()).toEqual(b);
    expect(q.prev()).toEqual(a);
    expect(q.prev()).toBeNull();
    // next() after exhausting prev resumes from history head
    expect(q.next()).toEqual(a);
    expect(q.next()).toEqual(b);
    expect(q.next()).toEqual(c);
  });

  it('history caps at 50 entries', () => {
    const big = Array.from({ length: 200 }, (_, i) => ({ gen: 244, id: i }));
    const q = createScreensaverQueue(big, 1);
    for (let i = 0; i < 100; i++) q.next();
    let back = 0;
    while (q.prev() !== null) back++;
    expect(back).toBe(50);
  });

  it('peek does not advance', () => {
    const q = createScreensaverQueue(refs, 1);
    const p = q.peek();
    expect(q.next()).toEqual(p);
  });

  it('empty corpus returns null from next/peek/prev', () => {
    const q = createScreensaverQueue([], 1);
    expect(q.peek()).toBeNull();
    expect(q.next()).toBeNull();
    expect(q.prev()).toBeNull();
  });
});
