// src/surprise-state.ts
//
// Wall + keep-tray state machine for the Surprise Wall. Pure data — the mount
// layer subscribes for re-renders. Tray persists via surprise-prefs.

import { type Genome } from './genome';
import { readKeepTray, writeKeepTray } from './surprise-prefs';

export interface WallTile { genome: Genome }
export interface KeptFlame { genome: Genome }

/** #304 — hard cap on the keep-tray. Each entry is a full genome (~25 KB, a
 *  256-stop palette dominates); 100 keeps ≈ 2.5 MB, comfortably under the ~5 MB
 *  localStorage budget. Capping prevents the silent-loss bug where an unbounded
 *  in-memory tray overflows quota, writeKeepTray swallows the error, and the
 *  next reload returns the smaller last-successfully-written set. */
export const MAX_KEEP_TRAY = 100;

/** Why a keep() failed, for the mount layer's toast. */
export type KeepFailure = 'no-tile' | 'tray-full' | 'persist-failed';

export interface SurpriseState {
  setTile(slot: number, tile: WallTile): void;
  getTile(slot: number): WallTile | null;
  /** Star the tile at `slot`. Returns the kept flame, or a failure reason. */
  keep(slot: number): KeptFlame | KeepFailure;
  tray(): KeptFlame[];
  removeFromTray(idx: number): void;
}

export function createSurpriseState(): SurpriseState {
  const tiles: (WallTile | null)[] = [];
  const kept: KeptFlame[] = readKeepTray().map((genome) => ({ genome }));

  function persist(): boolean { return writeKeepTray(kept.map((k) => k.genome)); }

  return {
    setTile(slot, tile) { tiles[slot] = tile; },
    getTile(slot) { return tiles[slot] ?? null; },
    keep(slot) {
      const t = tiles[slot]; if (!t) return 'no-tile';
      if (kept.length >= MAX_KEEP_TRAY) return 'tray-full';
      const entry: KeptFlame = { genome: t.genome };
      kept.unshift(entry);
      if (!persist()) { kept.shift(); return 'persist-failed'; } // atomic: roll back on quota fail
      return entry;
    },
    tray() { return kept.slice(); },
    removeFromTray(idx) { if (idx >= 0 && idx < kept.length) { kept.splice(idx, 1); persist(); } },
  };
}
