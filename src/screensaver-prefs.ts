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
  // Build-up ramp curve exponent. Cumulative samples at time t follow
  // (t / buildUpSec)^buildUpRamp. 1.0 = linear (bright early, polishing
  // tail); higher = slower-then-faster (image visibly builds through 50%).
  // Default Medium=3.0. UI ladder offers 1/2/3/5. Custom values up to 10
  // accepted via the typed input; past ~5 the curve approaches "nothing
  // for 80% then explosion" and the late-frame splat budget swells, which
  // can stall the GPU for a noticeable beat.
  buildUpRamp: number;
}

interface StoredPrefs extends ScreensaverPrefs {
  version: number;
}

export const PREFS_KEY = 'pyr3.screensaver.prefs';
// v3 (2026-06-05): added buildUpRamp. v2 prefs (and earlier) fall back to
// DEFAULTS — users who saved v2 lose their custom timings/quality but gain
// the new ramp default. Acceptable; the screensaver is recent.
export const PREFS_VERSION = 3;

export const DEFAULTS: ScreensaverPrefs = {
  mode: 'build-up',
  buildUpSec: 60,
  restSec: 0,
  holdSec: 15,
  buildUpQ:   200,
  slideshowQ: 100,
  buildUpRamp: 3.0,
};

export const CLAMPS = {
  buildUpSec: { min: 5,  max: 3600 },
  restSec:    { min: 0,  max: 600  },
  holdSec:    { min: 1,  max: 600  },
  buildUpQ:   { min: 10, max: 500  },
  slideshowQ: { min: 10, max: 500  },
  buildUpRamp:{ min: 1,  max: 10   },
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
    buildUpRamp: clamp(p.buildUpRamp, CLAMPS.buildUpRamp.min, CLAMPS.buildUpRamp.max),
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
    buildUpRamp: typeof p.buildUpRamp === 'number' ? p.buildUpRamp : DEFAULTS.buildUpRamp,
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
