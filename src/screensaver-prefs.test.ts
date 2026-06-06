// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readScreensaverPrefs,
  writeScreensaverPrefs,
  _clearScreensaverPrefs,
  parseSecondsInput,
  parseNumericInput,
  DEFAULTS,
  CLAMPS,
  PREFS_KEY,
  PREFS_VERSION,
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
      buildUpQ: 75,
      slideshowQ: 200,
      buildUpRamp: 1.5,
      recordTimeSec: 30,
      recordQ: 200,
      recordRamp: 3.0,
    });
    expect(readScreensaverPrefs()).toEqual({
      mode: 'slideshow',
      buildUpSec: 60,
      restSec: 10,
      holdSec: 30,
      buildUpQ: 75,
      slideshowQ: 200,
      buildUpRamp: 1.5,
      recordTimeSec: 30,
      recordQ: 200,
      recordRamp: 3.0,
    });
  });

  it('clamps out-of-range values to CLAMPS', () => {
    writeScreensaverPrefs({
      mode: 'build-up',
      buildUpSec: 99999, // > max
      restSec: -5,       // < min
      holdSec: 15,
      buildUpQ: 99999,   // > max
      slideshowQ: 1,     // < min
      buildUpRamp: 99,   // > max
      recordTimeSec: 30,
      recordQ: 200,
      recordRamp: 3.0,
    });
    const got = readScreensaverPrefs();
    expect(got.buildUpSec).toBe(CLAMPS.buildUpSec.max);
    expect(got.restSec).toBe(CLAMPS.restSec.min);
    expect(got.holdSec).toBe(15);
    expect(got.buildUpQ).toBe(CLAMPS.buildUpQ.max);
    expect(got.slideshowQ).toBe(CLAMPS.slideshowQ.min);
    expect(got.buildUpRamp).toBe(CLAMPS.buildUpRamp.max);
  });

  it('DEFAULTS expose the spec’d quality baselines (200 build-up, 100 slideshow)', () => {
    expect(DEFAULTS.buildUpQ).toBe(200);
    expect(DEFAULTS.slideshowQ).toBe(100);
  });

  it('DEFAULTS.buildUpRamp is Medium (3.0)', () => {
    expect(DEFAULTS.buildUpRamp).toBe(3.0);
  });

  it('DEFAULTS.buildUpSec is 1m (60s)', () => {
    expect(DEFAULTS.buildUpSec).toBe(60);
  });

  it('DEFAULTS.restSec is 0 (no rest between builds)', () => {
    expect(DEFAULTS.restSec).toBe(0);
  });

  it('CLAMPS bound quality 10..500 for both modes', () => {
    expect(CLAMPS.buildUpQ.min).toBe(10);
    expect(CLAMPS.buildUpQ.max).toBe(500);
    expect(CLAMPS.slideshowQ.min).toBe(10);
    expect(CLAMPS.slideshowQ.max).toBe(500);
  });

  it('older stored prefs trigger DEFAULTS fallback (new fields gained)', () => {
    // Simulate a user who saved prefs under v2 (no buildUpRamp).
    localStorage.setItem(
      'pyr3.screensaver.prefs',
      JSON.stringify({
        version: 2,
        mode: 'build-up',
        buildUpSec: 60,
        restSec: 10,
        holdSec: 30,
        buildUpQ: 75,
        slideshowQ: 200,
      }),
    );
    expect(readScreensaverPrefs()).toEqual(DEFAULTS);
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

describe('parseNumericInput', () => {
  it('parses plain numbers', () => {
    expect(parseNumericInput('100')).toBe(100);
    expect(parseNumericInput('50.5')).toBe(50.5);
  });
  it('rejects unit-suffixed input (quality has no minutes)', () => {
    expect(parseNumericInput('5m')).toBeNull();
    expect(parseNumericInput('30s')).toBeNull();
  });
  it('returns null for junk + empty', () => {
    expect(parseNumericInput('xyz')).toBeNull();
    expect(parseNumericInput('')).toBeNull();
  });
});

describe('ScreensaverPrefs v3→v4 migration', () => {
  it('PREFS_VERSION bumped to 4', () => {
    expect(PREFS_VERSION).toBe(4);
  });

  it('DEFAULTS includes record fields', () => {
    expect(DEFAULTS.recordTimeSec).toBe(30);  // 30s — short default fits "I just want a quick clip"
    expect(DEFAULTS.recordQ).toBe(200);       // Match buildUpQ — same perceptual target
    expect(DEFAULTS.recordRamp).toBe(3);      // Medium — same as buildUp default
  });

  it('mode union accepts "record"', () => {
    writeScreensaverPrefs({ ...DEFAULTS, mode: 'record' });
    const out = readScreensaverPrefs();
    expect(out.mode).toBe('record');
  });

  it('v3 payload (no record fields, version=3) falls back to DEFAULTS', () => {
    const v3 = { version: 3, mode: 'build-up', buildUpSec: 120, restSec: 30, holdSec: 15,
                 buildUpQ: 300, slideshowQ: 100, buildUpRamp: 5 };
    localStorage.setItem(PREFS_KEY, JSON.stringify(v3));
    const out = readScreensaverPrefs();
    // version mismatch → full DEFAULTS reset (matches existing v2→v3 policy)
    expect(out).toEqual(DEFAULTS);
  });

  it('clamps recordTimeSec to [5, 3600]', () => {
    writeScreensaverPrefs({ ...DEFAULTS, mode: 'record', recordTimeSec: 999999 });
    expect(readScreensaverPrefs().recordTimeSec).toBe(3600);
    writeScreensaverPrefs({ ...DEFAULTS, mode: 'record', recordTimeSec: 0 });
    expect(readScreensaverPrefs().recordTimeSec).toBe(5);
  });

  it('clamps recordQ to [10, 500]', () => {
    writeScreensaverPrefs({ ...DEFAULTS, mode: 'record', recordQ: 9999 });
    expect(readScreensaverPrefs().recordQ).toBe(500);
  });

  it('clamps recordRamp to [1, 10]', () => {
    writeScreensaverPrefs({ ...DEFAULTS, mode: 'record', recordRamp: 999 });
    expect(readScreensaverPrefs().recordRamp).toBe(10);
  });
});
