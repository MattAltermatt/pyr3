import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createSurpriseState, MAX_KEEP_TRAY } from './surprise-state';
import { generateRandomGenome } from './edit-seed';

const stubTile = (g = generateRandomGenome()) => ({
  genome: g, rgba: new Uint8ClampedArray(4), w: 1, h: 1,
  label: { variation: 'swirl', symmetry: 'asym' },
});

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

  // #304 — cap the tray so an unbounded in-memory list can't overflow quota
  // and silently lose keepers on reload.
  it('keep() caps the tray at MAX_KEEP_TRAY and reports tray-full', () => {
    const s = createSurpriseState();
    for (let i = 0; i < MAX_KEEP_TRAY; i++) {
      s.setTile(0, stubTile());
      expect(s.keep(0)).not.toBe('tray-full');
    }
    expect(s.tray()).toHaveLength(MAX_KEEP_TRAY);
    s.setTile(0, stubTile());
    expect(s.keep(0)).toBe('tray-full');
    expect(s.tray()).toHaveLength(MAX_KEEP_TRAY); // not exceeded
  });

  it('keep() reports no-tile for an empty slot', () => {
    expect(createSurpriseState().keep(3)).toBe('no-tile');
  });

  // #304 — a persist failure (quota) rolls back the in-memory add so the tray
  // never claims a keep that didn't survive, and signals persist-failed.
  it('keep() rolls back + reports persist-failed when the write throws', () => {
    const stub = makeStorageStub();
    stub.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    vi.stubGlobal('localStorage', stub);
    const s = createSurpriseState();
    s.setTile(0, stubTile());
    expect(s.keep(0)).toBe('persist-failed');
    expect(s.tray()).toEqual([]); // rolled back — no phantom keeper
  });
});
