import { describe, expect, it } from 'vitest';
import { createSurpriseState } from './surprise-state';
import { SURPRISE_SETTINGS_DEFAULT } from './surprise-prefs';
import { type Genome } from './genome';

// #surprise-v2 — surprise-state now holds two independent undo/redo histories
// (settings + wall) and no keep-tray.
describe('createSurpriseState (#surprise-v2)', () => {
  it('exposes two independent histories', () => {
    const s = createSurpriseState();
    expect(s.settingsHistory).not.toBe(s.wallHistory);
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

  it('settings history seeded with the initial settings', () => {
    const s = createSurpriseState(SURPRISE_SETTINGS_DEFAULT);
    expect(s.settingsHistory.size()).toBe(1);
    s.settingsHistory.push({ ...SURPRISE_SETTINGS_DEFAULT, setN: 30 });
    expect(s.settingsHistory.canUndo()).toBe(true);
    expect(s.settingsHistory.undo()).toEqual(SURPRISE_SETTINGS_DEFAULT);
  });

  it('has no keep-tray state', () => {
    const s = createSurpriseState() as unknown as Record<string, unknown>;
    expect(s['keep']).toBeUndefined();
    expect(s['tray']).toBeUndefined();
  });
});
