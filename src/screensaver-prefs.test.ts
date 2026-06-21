// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readScreensaverPrefs,
  writeScreensaverPrefs,
  _clearScreensaverPrefs,
  parseSecondsInput,
  parseNumericInput,
  DEFAULTS,
  PREFS_KEY,
  PREFS_VERSION,
  type ScreensaverPrefs,
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

describe('screensaver prefs v5', () => {
  it('returns DEFAULTS when localStorage is empty', () => {
    expect(readScreensaverPrefs()).toEqual(DEFAULTS);
    expect(DEFAULTS.mode).toBe('slideshow');
    expect(DEFAULTS.slideshow.interest).toBe('normal');
    expect(DEFAULTS.slideshow.width).toBe(1920);
    expect(DEFAULTS.animation.loop).toBe(true);
  });

  it('returns a fresh copy each time (no shared mutable DEFAULTS)', () => {
    const a = readScreensaverPrefs();
    a.slideshow.quality = 999;
    expect(readScreensaverPrefs().slideshow.quality).toBe(DEFAULTS.slideshow.quality);
  });

  it('round-trips a written prefs object', () => {
    const p: ScreensaverPrefs = {
      ...DEFAULTS,
      mode: 'animation',
      animation: { ...DEFAULTS.animation, updateIntervalSec: 7, loop: false },
    };
    writeScreensaverPrefs(p);
    expect(readScreensaverPrefs()).toEqual(p);
  });

  it('discards a stale-version payload → DEFAULTS', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ version: 4, mode: 'build-up' }));
    expect(readScreensaverPrefs()).toEqual(DEFAULTS);
  });

  it('writes the current version envelope (flat)', () => {
    writeScreensaverPrefs(DEFAULTS);
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY)!);
    expect(raw.version).toBe(PREFS_VERSION);
    expect(raw.slideshow.interest).toBe('normal');
  });

  it('clamps out-of-range values and self-heals missing nested fields', () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        version: PREFS_VERSION,
        mode: 'slideshow',
        slideshow: { quality: 99999, dwellSec: -5, interest: 'bogus' },
        // animation block omitted entirely
      }),
    );
    const p = readScreensaverPrefs();
    expect(p.slideshow.quality).toBe(500); // clamped to max
    expect(p.slideshow.dwellSec).toBe(1); // clamped to min
    expect(p.slideshow.interest).toBe('normal'); // invalid → default
    expect(p.animation).toEqual(DEFAULTS.animation); // missing block → defaults
  });

  it('rejects an invalid mode → DEFAULTS', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ version: PREFS_VERSION, mode: 'record' }));
    expect(readScreensaverPrefs()).toEqual(DEFAULTS);
  });
});

describe('input parsers (retained)', () => {
  it('parseSecondsInput accepts s/m suffixes', () => {
    expect(parseSecondsInput('30')).toBe(30);
    expect(parseSecondsInput('30s')).toBe(30);
    expect(parseSecondsInput('5m')).toBe(300);
    expect(parseSecondsInput('junk')).toBeNull();
  });
  it('parseNumericInput rejects suffixes', () => {
    expect(parseNumericInput('100')).toBe(100);
    expect(parseNumericInput('100s')).toBeNull();
  });
});
