import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _clearGlobalQuality, readGlobalQuality, writeGlobalQuality } from './prefs';
import { QUALITY_TIERS } from './presets';

const PREFS_KEY = 'pyr3-prefs';

// Map-backed localStorage stub — environment-agnostic. happy-dom v20 doesn't
// expose `localStorage` globally under vitest, and Node 26's native variant
// requires --localstorage-file. Stubbing keeps these tests self-contained.
function makeStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => { store.delete(k); },
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorageStub());
  _clearGlobalQuality();
});

afterEach(() => {
  _clearGlobalQuality();
  vi.unstubAllGlobals();
});

describe('readGlobalQuality — shape-safe parse', () => {
  it('returns null when the key is missing', () => {
    expect(readGlobalQuality()).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    localStorage.setItem(PREFS_KEY, '{not valid json');
    expect(readGlobalQuality()).toBeNull();
  });

  it('returns null when the parsed value is not an object', () => {
    localStorage.setItem(PREFS_KEY, '42');
    expect(readGlobalQuality()).toBeNull();
    localStorage.setItem(PREFS_KEY, 'null');
    expect(readGlobalQuality()).toBeNull();
    localStorage.setItem(PREFS_KEY, '"a string"');
    expect(readGlobalQuality()).toBeNull();
  });

  it('returns null when globalQuality is missing', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({}));
    expect(readGlobalQuality()).toBeNull();
  });

  it('returns null on unknown tier name', () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ globalQuality: { kind: 'tier', tier: 'BorkedTier' } }),
    );
    expect(readGlobalQuality()).toBeNull();
  });

  it('returns null on custom kind missing longEdge', () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ globalQuality: { kind: 'custom', spp: 50 } }),
    );
    expect(readGlobalQuality()).toBeNull();
  });

  it('returns null on custom kind with non-integer longEdge', () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ globalQuality: { kind: 'custom', longEdge: 1024.5, spp: 50 } }),
    );
    expect(readGlobalQuality()).toBeNull();
  });

  it('returns null on unknown kind', () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ globalQuality: { kind: 'mystery' } }),
    );
    expect(readGlobalQuality()).toBeNull();
  });
});

describe('writeGlobalQuality + readGlobalQuality round-trip', () => {
  it('round-trips every tier in QUALITY_TIERS', () => {
    for (const tier of QUALITY_TIERS) {
      writeGlobalQuality({ kind: 'tier', tier });
      const back = readGlobalQuality();
      expect(back, `tier=${tier.name}`).toEqual({ kind: 'tier', tier });
    }
  });

  it('round-trips a custom quality request', () => {
    writeGlobalQuality({ kind: 'custom', longEdge: 2000, spp: 75 });
    expect(readGlobalQuality()).toEqual({ kind: 'custom', longEdge: 2000, spp: 75 });
  });

  it('overwrites prior values', () => {
    writeGlobalQuality({ kind: 'tier', tier: QUALITY_TIERS[0]! });
    writeGlobalQuality({ kind: 'tier', tier: QUALITY_TIERS[3]! });
    expect(readGlobalQuality()).toEqual({ kind: 'tier', tier: QUALITY_TIERS[3]! });
  });
});

describe('writeGlobalQuality — failure-safe', () => {
  it('does not throw when localStorage.setItem throws (Safari private / quota)', () => {
    // Replace the stub's setItem with a throwing variant — environment-agnostic
    // (CI runs Node 24 without happy-dom, so `Storage.prototype` isn't a global
    // there; mutating the stub on globalThis works regardless).
    const throwingStub: Storage = {
      ...(globalThis as { localStorage: Storage }).localStorage,
      setItem: () => { throw new Error('QuotaExceeded'); },
    };
    vi.stubGlobal('localStorage', throwingStub);
    expect(() => writeGlobalQuality({ kind: 'tier', tier: QUALITY_TIERS[0]! })).not.toThrow();
  });

  it('does not throw when localStorage.getItem throws', () => {
    const throwingStub: Storage = {
      ...(globalThis as { localStorage: Storage }).localStorage,
      getItem: () => { throw new Error('SecurityError'); },
    };
    vi.stubGlobal('localStorage', throwingStub);
    expect(() => readGlobalQuality()).not.toThrow();
    expect(readGlobalQuality()).toBeNull();
  });
});
