// Per-template save counters for the `{index}` placeholder (#104).
//
// Counters live in localStorage under one key holding a JSON map
// `{ "<template>": <next-index> }`. `peekIndex` returns what the NEXT save
// would write; `bumpIndex` advances the stored value. Save callers should
// bumpIndex ONLY on save success so a failed download doesn't burn a number.
//
// Templates are keyed by the literal template string the user typed. Two
// strings that differ in any way — including whitespace — get independent
// counters. That's intentional: it lets users start a fresh sequence by
// editing the template.

export const COUNTER_KEY = 'pyr3.edit.saveCounters';

type CounterMap = Record<string, number>;

function readMap(): CounterMap {
  try {
    const raw = globalThis.localStorage?.getItem(COUNTER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    // Coerce all numeric values; drop anything malformed.
    const out: CounterMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        out[k] = Math.floor(v);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: CounterMap): void {
  try {
    globalThis.localStorage?.setItem(COUNTER_KEY, JSON.stringify(map));
  } catch {
    // best-effort — quota or private-mode.
  }
}

/** What `{index}` will resolve to on the NEXT save for this template. */
export function peekIndex(template: string): number {
  const map = readMap();
  return map[template] ?? 1;
}

/** Advance the counter for `template`. Call after a successful save. */
export function bumpIndex(template: string): void {
  const map = readMap();
  map[template] = (map[template] ?? 1) + 1;
  writeMap(map);
}

/** Test-only — clear all counters. */
export function _clearCounters(): void {
  try {
    globalThis.localStorage?.removeItem(COUNTER_KEY);
  } catch {
    // best-effort.
  }
}
