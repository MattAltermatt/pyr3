import { describe, expect, it } from 'vitest';
import { createSurpriseState } from './surprise-state';
import { type Genome } from './genome';

// #433 — settings-history removed (per-bar ↺ Reset replaced it); surprise-state
// now holds only the wall reroll history and no keep-tray.
describe('createSurpriseState (#surprise-v2, #433)', () => {
  it('exposes only the wall history (settingsHistory removed in #433)', () => {
    const s = createSurpriseState();
    expect(s.wallHistory).toBeDefined();
    expect((s as unknown as Record<string, unknown>)['settingsHistory']).toBeUndefined();
  });

  it('wall history undo/redo over batches', () => {
    const s = createSurpriseState();
    const a = [] as Genome[];
    const b = [{ size: { width: 1, height: 1 } } as unknown as Genome];
    s.wallHistory.push(a);
    s.wallHistory.push(b);
    expect(s.wallHistory.canUndo()).toBe(true);
    expect(s.wallHistory.undo()).toEqual(a);
    expect(s.wallHistory.canRedo()).toBe(true);
    expect(s.wallHistory.redo()).toEqual(b);
  });

  it('has no keep-tray state', () => {
    const s = createSurpriseState() as unknown as Record<string, unknown>;
    expect(s['keep']).toBeUndefined();
    expect(s['tray']).toBeUndefined();
  });
});
