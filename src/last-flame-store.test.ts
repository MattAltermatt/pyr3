import { beforeEach, describe, expect, it } from 'vitest';
import { SPIRAL_GALAXY } from './genome';
import { saveLastFlame, loadLastFlame, clearLastFlame } from './last-flame-store';

const STORAGE_KEY = 'pyr3-last-flame';

// Map-backed localStorage stub — happy-dom's Storage prototype is unreliable
// across Node versions (reference-node24-ci-vs-node26-local memory); a Map stub
// is the project convention (render-mode-config.test.ts / palette-picker.test.ts).
function installLocalStorageStub(): void {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  (globalThis as { localStorage: Storage }).localStorage = stub as unknown as Storage;
}
installLocalStorageStub();

beforeEach(() => {
  localStorage.clear();
});

describe('last-flame-store (#203)', () => {
  it('returns null when nothing is stored', () => {
    expect(loadLastFlame()).toBeNull();
  });

  it('round-trips a genome through save → load', () => {
    saveLastFlame(SPIRAL_GALAXY);
    const restored = loadLastFlame();
    expect(restored).not.toBeNull();
    // genomeToJson/genomeFromJson is the canonical lossless codec; name +
    // xform count are a cheap structural check that the round-trip survived.
    expect(restored!.name).toBe(SPIRAL_GALAXY.name);
    expect(restored!.xforms.length).toBe(SPIRAL_GALAXY.xforms.length);
  });

  it('overwrites the previous flame (singular "last loaded")', () => {
    saveLastFlame(SPIRAL_GALAXY);
    saveLastFlame({ ...SPIRAL_GALAXY, name: 'Second Flame' });
    expect(loadLastFlame()!.name).toBe('Second Flame');
  });

  it('returns null and clears the key on an unreadable (corrupt) payload', () => {
    localStorage.setItem(STORAGE_KEY, '{ not valid json');
    expect(loadLastFlame()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull(); // wedge-proofing
  });

  it('returns null on a stale-schema payload (valid JSON, wrong shape)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 999, nope: true }));
    expect(loadLastFlame()).toBeNull();
  });

  it('clearLastFlame removes a stored flame', () => {
    saveLastFlame(SPIRAL_GALAXY);
    clearLastFlame();
    expect(loadLastFlame()).toBeNull();
  });
});
