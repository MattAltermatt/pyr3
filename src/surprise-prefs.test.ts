// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  readWall,
  writeWall,
  loadSurpriseSettings,
  saveSurpriseSettings,
  SURPRISE_SETTINGS_DEFAULT,
  SURPRISE_SETTINGS_KEY,
  type SurpriseSettings,
} from './surprise-prefs';
import { generateRandomGenome } from './edit-seed';

function makeStorageStub(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null, key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); } } as Storage;
}
beforeEach(() => vi.stubGlobal('localStorage', makeStorageStub()));
afterEach(() => vi.unstubAllGlobals());

describe('wall persistence', () => {
  it('round-trips the wall batch under its own key', () => {
    const batch = [generateRandomGenome(), generateRandomGenome()];
    writeWall(batch);
    const back = readWall();
    expect(back).toHaveLength(2);
    expect(back[0]!.xforms).toHaveLength(batch[0]!.xforms.length);
  });
  it('returns [] when nothing stored', () => { expect(readWall()).toEqual([]); });
  it('survives corrupt JSON', () => {
    localStorage.setItem('pyr3.surprise.wall', '{not json');
    expect(readWall()).toEqual([]);
  });
});

describe('SurpriseSettings (#surprise-v2)', () => {
  it('defaults', () => { expect(loadSurpriseSettings()).toEqual(SURPRISE_SETTINGS_DEFAULT); });

  it('uses the pyr3.surprise.settings key, separate from the wall batch', () => {
    expect(SURPRISE_SETTINGS_KEY).toBe('pyr3.surprise.settings');
    saveSurpriseSettings(SURPRISE_SETTINGS_DEFAULT);
    expect(readWall()).toEqual([]); // settings write must not touch the wall batch
  });

  it('round-trips', () => {
    const s: SurpriseSettings = { ...SURPRISE_SETTINGS_DEFAULT, countMode: 'set' as const, setN: 30, density: 'l' as const,
      xformCount: [2, 4] as [number, number], blendPerXform: [1, 3] as [number, number],
      preferred: [1, 2], preferMode: 'only' as const };
    saveSurpriseSettings(s);
    expect(loadSurpriseSettings()).toEqual(s);
  });

  it('clamps setN to >=1 and orders ranges on load', () => {
    saveSurpriseSettings({ ...SURPRISE_SETTINGS_DEFAULT, setN: 0, xformCount: [5, 2] });
    const l = loadSurpriseSettings();
    expect(l.setN).toBeGreaterThanOrEqual(1);
    expect(l.xformCount[0]).toBeLessThanOrEqual(l.xformCount[1]);
  });

  it('falls back to defaults on malformed JSON', () => {
    globalThis.localStorage!.setItem('pyr3.surprise.settings', '{bad');
    expect(loadSurpriseSettings()).toEqual(SURPRISE_SETTINGS_DEFAULT);
  });

  it('coerces invalid enums back to defaults', () => {
    saveSurpriseSettings({ ...SURPRISE_SETTINGS_DEFAULT, countMode: 'bogus' as never, density: 'xl' as never, preferMode: 'nope' as never });
    const l = loadSurpriseSettings();
    expect(l.countMode).toBe(SURPRISE_SETTINGS_DEFAULT.countMode);
    expect(l.density).toBe(SURPRISE_SETTINGS_DEFAULT.density);
    expect(l.preferMode).toBe(SURPRISE_SETTINGS_DEFAULT.preferMode);
  });

  it('clamps range values to >=1 and rounds setN', () => {
    saveSurpriseSettings({ ...SURPRISE_SETTINGS_DEFAULT, setN: 12.7, xformCount: [-3, 4], blendPerXform: [0, 6] });
    const l = loadSurpriseSettings();
    expect(l.setN).toBe(13);
    expect(l.xformCount[0]).toBeGreaterThanOrEqual(1);
    expect(l.blendPerXform[0]).toBeGreaterThanOrEqual(1);
  });
});
