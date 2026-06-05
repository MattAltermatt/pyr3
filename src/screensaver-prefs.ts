// Single-key localStorage persistence for /v1/screensaver settings.
// Pattern mirrors src/prefs.ts (single key, version-gated, default fallback
// on any read failure).

export type ScreensaverMode = 'slideshow' | 'build-up';

export interface ScreensaverPrefs {
  mode: ScreensaverMode;
  buildUpSec: number;
  restSec: number;
  holdSec: number;
}

interface StoredPrefs extends ScreensaverPrefs {
  version: number;
}

export const PREFS_KEY = 'pyr3.screensaver.prefs';
export const PREFS_VERSION = 1;

export const DEFAULTS: ScreensaverPrefs = {
  mode: 'build-up',
  buildUpSec: 300,
  restSec: 30,
  holdSec: 15,
};

export const CLAMPS = {
  buildUpSec: { min: 5,  max: 3600 },
  restSec:    { min: 0,  max: 600  },
  holdSec:    { min: 1,  max: 600  },
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
