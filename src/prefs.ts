// #53: persist the viewer's most recent quality choice across page refreshes.
//
// Storage shape (single localStorage key, JSON-encoded object):
//   { globalQuality: QualityRequest }
// Wrapper object so a future per-sheep layer can extend without breaking
// compat — becomes { globalQuality, perSheep: { ... } }.
//
// Tier is stored as the tier NAME (string), not the full QualityTier object,
// so a future tier-table edit doesn't invalidate stored prefs unless the name
// disappears. Custom kind stores its longEdge + spp verbatim.

import { QUALITY_TIERS, type QualityRequest } from './presets';

const PREFS_KEY = 'pyr3-prefs';

interface StoredQuality {
  kind: 'tier' | 'custom';
  tier?: string;
  longEdge?: number;
  spp?: number;
}

interface StoredPrefs {
  globalQuality?: StoredQuality;
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 && Number.isInteger(n);
}

function isPositiveNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 1;
}

function parseStored(raw: StoredQuality | undefined): QualityRequest | null {
  if (raw === undefined || raw === null || typeof raw !== 'object') return null;
  if (raw.kind === 'tier') {
    if (typeof raw.tier !== 'string') return null;
    const tier = QUALITY_TIERS.find((t) => t.name === raw.tier);
    return tier ? { kind: 'tier', tier } : null;
  }
  if (raw.kind === 'custom') {
    if (!isPositiveInt(raw.longEdge) || !isPositiveNumber(raw.spp)) return null;
    return { kind: 'custom', longEdge: raw.longEdge, spp: raw.spp };
  }
  return null;
}

/**
 * Read the persisted global quality preference. Returns `null` when nothing
 * is stored, the JSON is malformed, or the shape doesn't match a known
 * QualityRequest. Caller falls back to a sensible default (DEFAULT_TIER).
 */
export function readGlobalQuality(): QualityRequest | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(PREFS_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const prefs = parsed as StoredPrefs;
  return parseStored(prefs.globalQuality);
}

/**
 * Persist the user's quality choice. Best-effort — localStorage.setItem can
 * throw (Safari private mode, quota), so failure silently drops the write.
 */
export function writeGlobalQuality(q: QualityRequest): void {
  const stored: StoredQuality =
    q.kind === 'tier'
      ? { kind: 'tier', tier: q.tier.name }
      : { kind: 'custom', longEdge: q.longEdge, spp: q.spp };
  const payload: StoredPrefs = { globalQuality: stored };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(payload));
  } catch {
    // ignore — preferences are best-effort.
  }
}

/** Test-only: drop the persisted prefs. Exported so tests don't have to know the key. */
export function _clearGlobalQuality(): void {
  try {
    localStorage.removeItem(PREFS_KEY);
  } catch {
    // ignore
  }
}
