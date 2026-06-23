// src/surprise-prefs.ts
//
// localStorage persistence for the Surprise Wall. Two concerns, two keys:
//   - the current wall batch (so a reload restores the same flames instead of
//     regenerating) — genomes only, stored via genomeToJson under a versioned key;
//   - the SurpriseSettings the wall was generated under (count/density/xform-count/
//     blend/preferred-variation knobs) — a small plain-JSON object.
// The Surprise Wall v2 dropped the keep-tray, so its persistence was removed.
// Uses globalThis.localStorage (not bare localStorage) so it stays off SEAM_EXEMPT.

import { type Genome } from './genome';
import { genomeToJson, genomeFromJson } from './serialize';

const WALL_KEY = 'pyr3.surprise.wall';
const VERSION = 1;

function readFlames(key: string): Genome[] {
  let raw: string | null = null;
  try { raw = globalThis.localStorage?.getItem(key) ?? null; } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!parsed || typeof parsed !== 'object') return [];
  const p = parsed as { version?: number; flames?: unknown[] };
  if (p.version !== VERSION || !Array.isArray(p.flames)) return [];
  const out: Genome[] = [];
  for (const f of p.flames) { try { out.push(genomeFromJson(f)); } catch { /* skip bad entry */ } }
  return out;
}

/** Persist `flames` under `key`. Returns false when the write throws (quota
 *  exceeded / storage disabled) so callers can surface a non-fatal warning
 *  instead of silently losing data (#304). */
function writeFlames(key: string, flames: Genome[]): boolean {
  const payload = { version: VERSION, flames: flames.map((g) => genomeToJson(g)) };
  try { globalThis.localStorage?.setItem(key, JSON.stringify(payload)); return true; }
  catch { return false; }
}

/** The wall's current batch — restored on page load so the user returns to the
 *  same flames. Thumbnails are NOT stored (re-rendered on load); only genomes. */
export function readWall(): Genome[] { return readFlames(WALL_KEY); }
export function writeWall(flames: Genome[]): void { writeFlames(WALL_KEY, flames); }

// ---------------------------------------------------------------------------
// SurpriseSettings — the generator knobs for the Surprise Wall v2.
// ---------------------------------------------------------------------------

export interface SurpriseSettings {
  /** 'fill' = pack the viewport; 'set' = generate exactly `setN`. */
  countMode: 'fill' | 'set';
  /** Target count when `countMode === 'set'` (>= 1). */
  setN: number;
  /** Thumbnail density / tile size: small / medium / large. */
  density: 's' | 'm' | 'l';
  /** Inclusive xform-count range `[min, max]` (each >= 1, min <= max). */
  xformCount: [number, number];
  /** Inclusive variations-per-xform (blend) range `[min, max]` (each >= 1, min <= max). */
  blendPerXform: [number, number];
  /** Preferred variation indices the generator should favour. */
  preferred: number[];
  /** 'bias' = weight toward `preferred`; 'only' = restrict to `preferred`. */
  preferMode: 'bias' | 'only';
}

export const SURPRISE_SETTINGS_KEY = 'pyr3.surprise.settings';

export const SURPRISE_SETTINGS_DEFAULT: SurpriseSettings = {
  countMode: 'fill', setN: 24, density: 'm',
  xformCount: [2, 4], blendPerXform: [1, 3], preferred: [], preferMode: 'bias',
};

function coerceEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return (typeof v === 'string' && (allowed as readonly string[]).includes(v)) ? (v as T) : fallback;
}

/** Clamp `[a, b]` to integers >= 1, ordered so min <= max; default on non-array. */
function coerceRange(v: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(v) || v.length < 2) return [...fallback];
  const a = Number(v[0]);
  const b = Number(v[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [...fallback];
  const lo = Math.max(1, Math.round(a));
  const hi = Math.max(1, Math.round(b));
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

/** Load the wall's generator settings, validating + clamping every field; any
 *  miss / malformed entry falls back to `SURPRISE_SETTINGS_DEFAULT`. */
export function loadSurpriseSettings(): SurpriseSettings {
  let raw: string | null = null;
  try { raw = globalThis.localStorage?.getItem(SURPRISE_SETTINGS_KEY) ?? null; } catch { return { ...SURPRISE_SETTINGS_DEFAULT }; }
  if (!raw) return { ...SURPRISE_SETTINGS_DEFAULT };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ...SURPRISE_SETTINGS_DEFAULT }; }
  if (!parsed || typeof parsed !== 'object') return { ...SURPRISE_SETTINGS_DEFAULT };
  const p = parsed as Partial<Record<keyof SurpriseSettings, unknown>>;

  const setNRaw = Number(p.setN);
  const setN = Number.isFinite(setNRaw) ? Math.max(1, Math.round(setNRaw)) : SURPRISE_SETTINGS_DEFAULT.setN;

  const preferred = Array.isArray(p.preferred)
    ? p.preferred.map((n) => Number(n)).filter((n) => Number.isFinite(n))
    : [...SURPRISE_SETTINGS_DEFAULT.preferred];

  return {
    countMode: coerceEnum(p.countMode, ['fill', 'set'] as const, SURPRISE_SETTINGS_DEFAULT.countMode),
    setN,
    density: coerceEnum(p.density, ['s', 'm', 'l'] as const, SURPRISE_SETTINGS_DEFAULT.density),
    xformCount: coerceRange(p.xformCount, SURPRISE_SETTINGS_DEFAULT.xformCount),
    blendPerXform: coerceRange(p.blendPerXform, SURPRISE_SETTINGS_DEFAULT.blendPerXform),
    preferred,
    preferMode: coerceEnum(p.preferMode, ['bias', 'only'] as const, SURPRISE_SETTINGS_DEFAULT.preferMode),
  };
}

/** Persist the wall's generator settings. Silently no-ops on a storage throw. */
export function saveSurpriseSettings(s: SurpriseSettings): void {
  try { globalThis.localStorage?.setItem(SURPRISE_SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage disabled / quota */ }
}
