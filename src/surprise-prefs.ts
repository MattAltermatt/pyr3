// src/surprise-prefs.ts
//
// localStorage persistence for the Surprise Wall: the keep-tray (flames the user
// starred) AND the current wall (so a reload restores the same batch instead of
// regenerating). Both store flames as genomeToJson under a versioned key. Uses
// globalThis.localStorage (not bare localStorage) so it stays off SEAM_EXEMPT.

import { type Genome } from './genome';
import { genomeToJson, genomeFromJson } from './serialize';

const KEEP_TRAY_KEY = 'pyr3.surprise.keep-tray';
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

export function readKeepTray(): Genome[] { return readFlames(KEEP_TRAY_KEY); }
export function writeKeepTray(flames: Genome[]): boolean { return writeFlames(KEEP_TRAY_KEY, flames); }

/** The wall's current batch — restored on page load so the user returns to the
 *  same flames. Thumbnails are NOT stored (re-rendered on load); only genomes. */
export function readWall(): Genome[] { return readFlames(WALL_KEY); }
export function writeWall(flames: Genome[]): void { writeFlames(WALL_KEY, flames); }
