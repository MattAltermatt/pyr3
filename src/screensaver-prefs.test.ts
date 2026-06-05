// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readScreensaverPrefs,
  writeScreensaverPrefs,
  _clearScreensaverPrefs,
  parseSecondsInput,
  DEFAULTS,
  CLAMPS,
} from './screensaver-prefs';

// Map-backed localStorage stub — happy-dom v20 doesn't expose `localStorage`
// globally under vitest. See src/edit-mount.test.ts for the canonical pattern.
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
  _clearScreensaverPrefs();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('screensaver-prefs', () => {
  it('returns DEFAULTS when localStorage is empty', () => {
    expect(readScreensaverPrefs()).toEqual(DEFAULTS);
  });

  it('round-trips through write + read', () => {
    writeScreensaverPrefs({
      mode: 'slideshow',
      buildUpSec: 60,
      restSec: 10,
      holdSec: 30,
    });
    expect(readScreensaverPrefs()).toEqual({
      mode: 'slideshow',
      buildUpSec: 60,
      restSec: 10,
      holdSec: 30,
    });
  });

  it('clamps out-of-range values to CLAMPS', () => {
    writeScreensaverPrefs({
      mode: 'build-up',
      buildUpSec: 99999, // > max
      restSec: -5,       // < min
      holdSec: 15,
    });
    const got = readScreensaverPrefs();
    expect(got.buildUpSec).toBe(CLAMPS.buildUpSec.max);
    expect(got.restSec).toBe(CLAMPS.restSec.min);
    expect(got.holdSec).toBe(15);
  });

  it('falls back to DEFAULTS on version mismatch', () => {
    localStorage.setItem(
      'pyr3.screensaver.prefs',
      JSON.stringify({ version: 999, mode: 'slideshow' }),
    );
    expect(readScreensaverPrefs()).toEqual(DEFAULTS);
  });

  it('falls back to DEFAULTS on malformed JSON', () => {
    localStorage.setItem('pyr3.screensaver.prefs', 'not-json');
    expect(readScreensaverPrefs()).toEqual(DEFAULTS);
  });
});

describe('parseSecondsInput', () => {
  it('parses bare seconds', () => {
    expect(parseSecondsInput('30')).toBe(30);
    expect(parseSecondsInput('30s')).toBe(30);
  });
  it('parses Nm shorthand', () => {
    expect(parseSecondsInput('5m')).toBe(300);
    expect(parseSecondsInput('2m')).toBe(120);
  });
  it('returns null for non-numeric junk', () => {
    expect(parseSecondsInput('xyz')).toBeNull();
    expect(parseSecondsInput('')).toBeNull();
  });
});
