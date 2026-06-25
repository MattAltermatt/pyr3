// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  readWall,
  writeWall,
  loadSurpriseSettings,
  saveSurpriseSettings,
  resetGeneration,
  resetVariations,
  applySeedPreferred,
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

describe('applySeedPreferred (#448 — /creator?vars deep-link)', () => {
  it('seeds the pool with preferMode "featured" (X present + diverse, #450)', () => {
    const out = applySeedPreferred(SURPRISE_SETTINGS_DEFAULT, [12, 34]);
    expect(out.preferred).toEqual([12, 34]);
    expect(out.preferMode).toBe('featured');
  });
  it('leaves settings untouched for an empty/undefined seed', () => {
    expect(applySeedPreferred(SURPRISE_SETTINGS_DEFAULT, [])).toBe(SURPRISE_SETTINGS_DEFAULT);
    expect(applySeedPreferred(SURPRISE_SETTINGS_DEFAULT, undefined)).toBe(SURPRISE_SETTINGS_DEFAULT);
  });
  it('does not mutate the input', () => {
    const base = { ...SURPRISE_SETTINGS_DEFAULT, preferred: [1] };
    applySeedPreferred(base, [9]);
    expect(base.preferred).toEqual([1]);
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

  it('migrates a legacy stored preferMode "bias" → "featured" (#450)', () => {
    // Write a raw legacy record (the old value isn't in the new type union).
    localStorage.setItem(
      SURPRISE_SETTINGS_KEY,
      JSON.stringify({ ...SURPRISE_SETTINGS_DEFAULT, preferMode: 'bias' }),
    );
    expect(loadSurpriseSettings().preferMode).toBe('featured');
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

const CUSTOM: SurpriseSettings = {
  countMode: 'set', setN: 40, density: 'l',
  xformCount: [3, 6], blendPerXform: [2, 5],
  preferred: [12, 88], preferMode: 'only',
};

describe('scoped resets (#433)', () => {
  it('resetGeneration reverts generation knobs, preserves variation knobs', () => {
    const out = resetGeneration(CUSTOM);
    expect(out.countMode).toBe(SURPRISE_SETTINGS_DEFAULT.countMode);
    expect(out.setN).toBe(SURPRISE_SETTINGS_DEFAULT.setN);
    expect(out.density).toBe(SURPRISE_SETTINGS_DEFAULT.density);
    expect(out.xformCount).toEqual(SURPRISE_SETTINGS_DEFAULT.xformCount);
    expect(out.blendPerXform).toEqual(SURPRISE_SETTINGS_DEFAULT.blendPerXform);
    expect(out.preferred).toEqual([12, 88]);
    expect(out.preferMode).toBe('only');
  });

  it('resetVariations reverts variation knobs, preserves generation knobs', () => {
    const out = resetVariations(CUSTOM);
    expect(out.preferred).toEqual(SURPRISE_SETTINGS_DEFAULT.preferred);
    expect(out.preferMode).toBe(SURPRISE_SETTINGS_DEFAULT.preferMode);
    expect(out.countMode).toBe('set');
    expect(out.setN).toBe(40);
    expect(out.xformCount).toEqual([3, 6]);
    expect(out.blendPerXform).toEqual([2, 5]);
  });

  it('returns fresh array copies (no shared reference into DEFAULT)', () => {
    const out = resetGeneration(CUSTOM);
    expect(out.xformCount).not.toBe(SURPRISE_SETTINGS_DEFAULT.xformCount);
    expect(out.blendPerXform).not.toBe(SURPRISE_SETTINGS_DEFAULT.blendPerXform);
    expect(resetVariations(CUSTOM).preferred).not.toBe(SURPRISE_SETTINGS_DEFAULT.preferred);
  });
});
