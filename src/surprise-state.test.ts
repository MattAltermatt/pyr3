import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createSurpriseState } from './surprise-state';
import { generateRandomGenome } from './edit-seed';

function makeStorageStub(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null, removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); } } as Storage;
}
beforeEach(() => vi.stubGlobal('localStorage', makeStorageStub()));
afterEach(() => vi.unstubAllGlobals());

describe('surprise state', () => {
  it('keep() moves a wall tile into the tray and persists it', () => {
    const s = createSurpriseState();
    const g = generateRandomGenome();
    s.setTile(0, { genome: g, rgba: new Uint8ClampedArray(4), w: 1, h: 1, label: { variation: 'swirl', symmetry: 'asym' } });
    s.keep(0);
    expect(s.tray()).toHaveLength(1);
    expect(s.tray()[0]!.genome).toBe(g);
  });
  it('loads a previously-persisted tray on init', () => {
    const s1 = createSurpriseState();
    const g = generateRandomGenome();
    s1.setTile(0, { genome: g, rgba: new Uint8ClampedArray(4), w: 1, h: 1, label: { variation: 'swirl', symmetry: 'asym' } });
    s1.keep(0);
    const s2 = createSurpriseState();
    expect(s2.tray()).toHaveLength(1);
  });
  it('removeFromTray() drops the entry and re-persists', () => {
    const s = createSurpriseState();
    const g = generateRandomGenome();
    s.setTile(0, { genome: g, rgba: new Uint8ClampedArray(4), w: 1, h: 1, label: { variation: 'swirl', symmetry: 'asym' } });
    s.keep(0); s.removeFromTray(0);
    expect(s.tray()).toEqual([]);
  });
});
