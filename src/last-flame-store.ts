// Persistence for the most-recently-opened custom (non-corpus) flame (#203).
//
// The viewer routes file-opened flames to /viewer (viewerUrl() — the canonical
// generic surface with no corpus identity in the URL). On refresh that surface
// has no gen/id to load, so it rehydrates the genome from here — making a refresh
// on /viewer reload the same flame the user just opened, instead of bouncing back
// to the hero sheep.
//
// Corpus sheep are NOT stored: their /esf/gen/{gen}/id/{id} URL already round-trips
// on refresh via parseLoadIntent. Only the singular "last loaded" custom flame is
// kept — a later file-open overwrites it.
//
// Storage shape mirrors the PNG-metadata path (#123): the canonical
// `JSON.stringify(genomeToJson(genome))` serializer, so any schema migration is
// shared with file export/import rather than forked here.

import type { Genome } from './genome';
import { genomeToJson, genomeFromJson } from './serialize';

const STORAGE_KEY = 'pyr3-last-flame';

/** Persist `genome` as the last-loaded custom flame. Best-effort — a blocked or
 *  quota-full localStorage just means a later /viewer refresh falls back to
 *  the hero sheep. */
export function saveLastFlame(genome: Genome): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(genomeToJson(genome)));
  } catch {
    // localStorage unavailable / over quota — non-fatal.
  }
}

/** Rehydrate the last-loaded custom flame, or null if none is stored / the
 *  stored payload is unreadable (corrupt JSON or a stale schema). A bad payload
 *  is cleared so a refresh can't wedge on it. */
export function loadLastFlame(): Genome | null {
  let raw: string | null = null;
  try {
    raw = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return genomeFromJson(JSON.parse(raw));
  } catch {
    clearLastFlame();
    return null;
  }
}

/** Drop the stored flame (e.g. after an unreadable payload). */
export function clearLastFlame(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable — nothing to clear.
  }
}
