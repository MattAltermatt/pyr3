// Single-key localStorage persistence for /v1/screensaver settings.
// Pattern mirrors src/prefs.ts (single key, version-gated, default fallback
// on any read failure).

export type ScreensaverMode = 'slideshow' | 'build-up';

export interface ScreensaverPrefs {
  mode: ScreensaverMode;
  buildUpSec: number;
  restSec: number;
  holdSec: number;
  // Quality targets (samples per pixel). buildUpQ defaults to 50 (the
  // perceptual baseline the build-up loop was originally tuned for);
  // slideshowQ defaults to 100 (slideshow renders to "lean back at full
  // quality" — 2× build-up's perceptual budget). Both clamped 10..500.
  buildUpQ: number;
  slideshowQ: number;
}

interface StoredPrefs extends ScreensaverPrefs {
  version: number;
}

export const PREFS_KEY = 'pyr3.screensaver.prefs';
// v2 (2026-06-05): added buildUpQ + slideshowQ. v1 prefs fall back to
// DEFAULTS — users who saved v1 lose their custom timings but get the new
// fields. Acceptable; the screensaver is recent and few users have v1
// stored.
export const PREFS_VERSION = 2;

export const DEFAULTS: ScreensaverPrefs = {
  mode: 'build-up',
  buildUpSec: 300,
  restSec: 30,
  holdSec: 15,
  buildUpQ:   50,
  slideshowQ: 100,
};

export const CLAMPS = {
  buildUpSec: { min: 5,  max: 3600 },
  restSec:    { min: 0,  max: 600  },
  holdSec:    { min: 1,  max: 600  },
  buildUpQ:   { min: 10, max: 500  },
  slideshowQ: { min: 10, max: 500  },
} as const;

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function isMode(v: unknown): v is ScreensaverMode {
  return v === 'slideshow' || v === 'build-up';
}

function applyClamps(p: ScreensaverPrefs): ScreensaverPrefs {
  return {
    mode: p.mode,
    buildUpSec: clamp(p.buildUpSec, CLAMPS.buildUpSec.min, CLAMPS.buildUpSec.max),
    restSec:    clamp(p.restSec,    CLAMPS.restSec.min,    CLAMPS.restSec.max),
    holdSec:    clamp(p.holdSec,    CLAMPS.holdSec.min,    CLAMPS.holdSec.max),
    buildUpQ:   clamp(p.buildUpQ,   CLAMPS.buildUpQ.min,   CLAMPS.buildUpQ.max),
    slideshowQ: clamp(p.slideshowQ, CLAMPS.slideshowQ.min, CLAMPS.slideshowQ.max),
  };
}

export function readScreensaverPrefs(): ScreensaverPrefs {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PREFS_KEY);
  } catch {
    return { ...DEFAULTS };
  }
  if (!raw) return { ...DEFAULTS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULTS };
  }
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS };
  const p = parsed as Partial<StoredPrefs>;
  if (p.version !== PREFS_VERSION) return { ...DEFAULTS };
  if (!isMode(p.mode)) return { ...DEFAULTS };
  return applyClamps({
    mode: p.mode,
    buildUpSec: typeof p.buildUpSec === 'number' ? p.buildUpSec : DEFAULTS.buildUpSec,
    restSec:    typeof p.restSec    === 'number' ? p.restSec    : DEFAULTS.restSec,
    holdSec:    typeof p.holdSec    === 'number' ? p.holdSec    : DEFAULTS.holdSec,
    buildUpQ:   typeof p.buildUpQ   === 'number' ? p.buildUpQ   : DEFAULTS.buildUpQ,
    slideshowQ: typeof p.slideshowQ === 'number' ? p.slideshowQ : DEFAULTS.slideshowQ,
  });
}

export function writeScreensaverPrefs(p: ScreensaverPrefs): void {
  const clamped = applyClamps(p);
  const payload: StoredPrefs = { version: PREFS_VERSION, ...clamped };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(payload));
  } catch {
    // best-effort; quota or private mode — swallow.
  }
}

export function _clearScreensaverPrefs(): void {
  try {
    localStorage.removeItem(PREFS_KEY);
  } catch {
    // best-effort.
  }
}

/** Parse user-typed value in the ladder's freeform input.
 *  Accepts "30", "30s", "5m". Returns null on junk. */
export function parseSecondsInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(s|m)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? 's').toLowerCase();
  return unit === 'm' ? n * 60 : n;
}

/** Parse a plain numeric value (no unit suffix). Used by the quality
 *  ladders where "100s"/"5m" would be nonsense. Returns null on junk. */
export function parseNumericInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  return Number.isFinite(n) ? n : null;
}
