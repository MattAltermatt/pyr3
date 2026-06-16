import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readKeepTray, writeKeepTray, readWall, writeWall } from './surprise-prefs';
import { generateRandomGenome } from './edit-seed';

function makeStorageStub(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null, key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); } } as Storage;
}
beforeEach(() => vi.stubGlobal('localStorage', makeStorageStub()));
afterEach(() => vi.unstubAllGlobals());

describe('keep-tray persistence', () => {
  it('round-trips kept genomes', () => {
    const g = generateRandomGenome();
    writeKeepTray([g]);
    const back = readKeepTray();
    expect(back).toHaveLength(1);
    expect(back[0]!.xforms).toHaveLength(g.xforms.length);
  });
  it('returns [] when nothing stored', () => { expect(readKeepTray()).toEqual([]); });
  it('returns [] on version mismatch', () => {
    localStorage.setItem('pyr3.surprise.keep-tray', JSON.stringify({ version: 999, flames: [] }));
    expect(readKeepTray()).toEqual([]);
  });
  it('survives corrupt JSON', () => {
    localStorage.setItem('pyr3.surprise.keep-tray', '{not json');
    expect(readKeepTray()).toEqual([]);
  });
});

describe('wall persistence', () => {
  it('round-trips the wall batch under its own key', () => {
    const batch = [generateRandomGenome(), generateRandomGenome()];
    writeWall(batch);
    const back = readWall();
    expect(back).toHaveLength(2);
    expect(back[0]!.xforms).toHaveLength(batch[0]!.xforms.length);
  });
  it('is independent of the keep-tray key', () => {
    writeWall([generateRandomGenome()]);
    expect(readKeepTray()).toEqual([]); // wall write must not touch the tray
  });
  it('returns [] when nothing stored', () => { expect(readWall()).toEqual([]); });
});
