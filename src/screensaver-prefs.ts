// Single-key localStorage persistence for /screensaver settings.
// Pattern mirrors src/prefs.ts (single key, version-gated, default fallback
// on any read failure). v5 (#355): the screensaver is a two-mode player
// (slideshow · animation); build-up + record modes and their fields are gone.

import type { InterestLevel } from './screensaver-interest';

export type ScreensaverMode = 'slideshow' | 'animation';

export interface SlideshowPrefs {
  width: number;
  height: number;
  quality: number; // samples per pixel
  dwellSec: number; // hold per flame before advancing
  interest: InterestLevel; // "skip boring flames" strictness
}

export interface AnimationPrefs {
  width: number;
  height: number;
  quality: number;
  durationSec: number; // total span walked through the timeline
  updateIntervalSec: number; // dwell each rendered frame is shown
  loop: boolean;
}

export interface ScreensaverPrefs {
  mode: ScreensaverMode;
  slideshow: SlideshowPrefs;
  animation: AnimationPrefs;
}

interface StoredPrefs extends ScreensaverPrefs {
  version: number;
}

export const PREFS_KEY = 'pyr3.screensaver.prefs';
// v5 (2026-06-20, #355): two-mode rework. v4 and earlier (build-up/record)
// fall back to DEFAULTS — the old timings/quality are not portable to the new
// shape. Acceptable; the screensaver is recent.
export const PREFS_VERSION = 5;

export const DEFAULTS: ScreensaverPrefs = {
  mode: 'slideshow',
  slideshow: { width: 1920, height: 1080, quality: 25, dwellSec: 18, interest: 'normal' },
  animation: { width: 1920, height: 1080, quality: 50, durationSec: 900, updateIntervalSec: 10, loop: true },
};

export const CLAMPS = {
  width:  { min: 256, max: 7680 },
  height: { min: 256, max: 7680 },
  quality: { min: 10, max: 500 },
  dwellSec: { min: 1, max: 600 },
  durationSec: { min: 5, max: 86_400 },
  updateIntervalSec: { min: 1, max: 600 },
} as const;

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function isMode(v: unknown): v is ScreensaverMode {
  return v === 'slideshow' || v === 'animation';
}

function isInterest(v: unknown): v is InterestLevel {
  return v === 'off' || v === 'normal' || v === 'aggressive';
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

function applySlideshowClamps(p: SlideshowPrefs): SlideshowPrefs {
  return {
    width:  clamp(p.width,  CLAMPS.width.min,  CLAMPS.width.max),
    height: clamp(p.height, CLAMPS.height.min, CLAMPS.height.max),
    quality: clamp(p.quality, CLAMPS.quality.min, CLAMPS.quality.max),
    dwellSec: clamp(p.dwellSec, CLAMPS.dwellSec.min, CLAMPS.dwellSec.max),
    interest: isInterest(p.interest) ? p.interest : DEFAULTS.slideshow.interest,
  };
}

function applyAnimationClamps(p: AnimationPrefs): AnimationPrefs {
  return {
    width:  clamp(p.width,  CLAMPS.width.min,  CLAMPS.width.max),
    height: clamp(p.height, CLAMPS.height.min, CLAMPS.height.max),
    quality: clamp(p.quality, CLAMPS.quality.min, CLAMPS.quality.max),
    durationSec: clamp(p.durationSec, CLAMPS.durationSec.min, CLAMPS.durationSec.max),
    updateIntervalSec: clamp(p.updateIntervalSec, CLAMPS.updateIntervalSec.min, CLAMPS.updateIntervalSec.max),
    loop: p.loop !== false,
  };
}

function applyClamps(p: ScreensaverPrefs): ScreensaverPrefs {
  return {
    mode: p.mode,
    slideshow: applySlideshowClamps(p.slideshow),
    animation: applyAnimationClamps(p.animation),
  };
}

export function readScreensaverPrefs(): ScreensaverPrefs {
  let raw: string | null = null;
  try {
    raw = globalThis.localStorage?.getItem(PREFS_KEY);
  } catch {
    return structuredCloneDefaults();
  }
  if (!raw) return structuredCloneDefaults();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return structuredCloneDefaults();
  }
  if (!parsed || typeof parsed !== 'object') return structuredCloneDefaults();
  const p = parsed as Partial<StoredPrefs>;
  if (p.version !== PREFS_VERSION) return structuredCloneDefaults();
  if (!isMode(p.mode)) return structuredCloneDefaults();
  // Merge each nested block over DEFAULTS so a missing field self-heals.
  const ss = (p.slideshow ?? {}) as Partial<SlideshowPrefs>;
  const an = (p.animation ?? {}) as Partial<AnimationPrefs>;
  return applyClamps({
    mode: p.mode,
    slideshow: {
      width: num(ss.width, DEFAULTS.slideshow.width),
      height: num(ss.height, DEFAULTS.slideshow.height),
      quality: num(ss.quality, DEFAULTS.slideshow.quality),
      dwellSec: num(ss.dwellSec, DEFAULTS.slideshow.dwellSec),
      interest: isInterest(ss.interest) ? ss.interest : DEFAULTS.slideshow.interest,
    },
    animation: {
      width: num(an.width, DEFAULTS.animation.width),
      height: num(an.height, DEFAULTS.animation.height),
      quality: num(an.quality, DEFAULTS.animation.quality),
      durationSec: num(an.durationSec, DEFAULTS.animation.durationSec),
      updateIntervalSec: num(an.updateIntervalSec, DEFAULTS.animation.updateIntervalSec),
      loop: an.loop !== false,
    },
  });
}

export function writeScreensaverPrefs(p: ScreensaverPrefs): void {
  const clamped = applyClamps(p);
  const payload: StoredPrefs = { version: PREFS_VERSION, ...clamped };
  try {
    globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(payload));
  } catch {
    // best-effort; quota or private mode — swallow.
  }
}

export function _clearScreensaverPrefs(): void {
  try {
    globalThis.localStorage?.removeItem(PREFS_KEY);
  } catch {
    // best-effort.
  }
}

function structuredCloneDefaults(): ScreensaverPrefs {
  return {
    mode: DEFAULTS.mode,
    slideshow: { ...DEFAULTS.slideshow },
    animation: { ...DEFAULTS.animation },
  };
}

/** Parse user-typed value in a ladder's freeform input.
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
