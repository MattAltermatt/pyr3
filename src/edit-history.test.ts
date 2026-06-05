import { describe, it, expect } from 'vitest';
import { createHistory, HISTORY_MAX } from './edit-history';
import type { Genome } from './genome';

// Minimal genome factories — the history doesn't care about genome shape, just
// deep-clones the whole object. Each factory varies one field so identity is
// observable in tests.
function g(scale: number, extras: Partial<Genome> = {}): Genome {
  return {
    name: 'flame',
    scale,
    cx: 0,
    cy: 0,
    rotation: 0,
    xforms: [],
    palette: { mode: 'index', indices: [] },
    background: [0, 0, 0],
    gamma: 4,
    gammaThreshold: 0.01,
    vibrancy: 1,
    brightness: 1,
    ...extras,
  } as Genome;
}

describe('edit-history', () => {
  describe('initial state', () => {
    it('seeds with the initial genome', () => {
      const h = createHistory(g(1));
      expect(h.canUndo()).toBe(false);
      expect(h.canRedo()).toBe(false);
      expect(h.size()).toBe(1);
    });
  });

  describe('push', () => {
    it('appends an entry and advances the pointer', () => {
      const h = createHistory(g(1));
      h.push(g(2));
      expect(h.size()).toBe(2);
      expect(h.canUndo()).toBe(true);
      expect(h.canRedo()).toBe(false);
    });

    it('deep-clones the pushed genome so external mutation is safe', () => {
      const live = g(1);
      const h = createHistory(live);
      live.scale = 99;
      h.push(g(2));
      const undone = h.undo();
      expect(undone?.scale).toBe(1); // initial, not the mutated-after-push value
    });

    it('coalesces identical-content pushes (no-op when nothing changed)', () => {
      const h = createHistory(g(1));
      h.push(g(1)); // same scale → no new entry
      expect(h.size()).toBe(1);
      expect(h.canUndo()).toBe(false);
    });

    it('truncates the redo tail when pushing after an undo', () => {
      const h = createHistory(g(1));
      h.push(g(2));
      h.push(g(3));
      h.undo();              // back to scale=2
      expect(h.canRedo()).toBe(true);
      h.push(g(4));          // branches — scale=3 is now unreachable
      expect(h.canRedo()).toBe(false);
      expect(h.size()).toBe(3); // [1, 2, 4]
    });
  });

  describe('undo / redo', () => {
    it('walks back through pushed entries', () => {
      const h = createHistory(g(1));
      h.push(g(2));
      h.push(g(3));
      expect(h.undo()?.scale).toBe(2);
      expect(h.undo()?.scale).toBe(1);
      expect(h.canUndo()).toBe(false);
    });

    it('returns null when nothing to undo', () => {
      const h = createHistory(g(1));
      expect(h.undo()).toBeNull();
    });

    it('walks forward through redo', () => {
      const h = createHistory(g(1));
      h.push(g(2));
      h.push(g(3));
      h.undo();
      h.undo();
      expect(h.redo()?.scale).toBe(2);
      expect(h.redo()?.scale).toBe(3);
      expect(h.canRedo()).toBe(false);
    });

    it('returns null when nothing to redo', () => {
      const h = createHistory(g(1));
      h.push(g(2));
      expect(h.redo()).toBeNull();
    });

    it('returns deep-cloned genomes so the caller can mutate without poisoning the stack', () => {
      const h = createHistory(g(1));
      h.push(g(2));
      const undone = h.undo();
      if (undone) undone.scale = 999;
      const reDone = h.redo();
      expect(reDone?.scale).toBe(2); // not 999
    });
  });

  describe('reset', () => {
    it('clears the stack and seeds with a new entry', () => {
      const h = createHistory(g(1));
      h.push(g(2));
      h.push(g(3));
      h.reset(g(10));
      expect(h.size()).toBe(1);
      expect(h.canUndo()).toBe(false);
      expect(h.canRedo()).toBe(false);
    });
  });

  describe('cap', () => {
    it(`enforces ${HISTORY_MAX}-entry maximum by dropping the oldest`, () => {
      const h = createHistory(g(0));
      for (let i = 1; i <= HISTORY_MAX + 5; i++) h.push(g(i));
      expect(h.size()).toBe(HISTORY_MAX);
      // After cap, the oldest survivor is (5+1) since 6 entries were dropped
      // off the front (initial g(0) + first 5 pushes).
      let undone: Genome | null = null;
      while (h.canUndo()) undone = h.undo();
      expect(undone?.scale).toBe(6);
    });
  });
});
