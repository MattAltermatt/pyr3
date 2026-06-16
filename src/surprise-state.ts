// src/surprise-state.ts
//
// Wall + keep-tray state machine for the Surprise Wall. Pure data — the mount
// layer subscribes for re-renders. Tray persists via surprise-prefs.

import { type Genome } from './genome';
import { readKeepTray, writeKeepTray } from './surprise-prefs';

export interface TileLabel { variation: string; symmetry: string }
export interface WallTile { genome: Genome; rgba: Uint8ClampedArray; w: number; h: number; label: TileLabel }
export interface KeptFlame { genome: Genome }

export interface SurpriseState {
  setTile(slot: number, tile: WallTile): void;
  getTile(slot: number): WallTile | null;
  keep(slot: number): KeptFlame | null;
  tray(): KeptFlame[];
  removeFromTray(idx: number): void;
}

export function createSurpriseState(): SurpriseState {
  const tiles: (WallTile | null)[] = [];
  const kept: KeptFlame[] = readKeepTray().map((genome) => ({ genome }));

  function persist(): void { writeKeepTray(kept.map((k) => k.genome)); }

  return {
    setTile(slot, tile) { tiles[slot] = tile; },
    getTile(slot) { return tiles[slot] ?? null; },
    keep(slot) {
      const t = tiles[slot]; if (!t) return null;
      const entry: KeptFlame = { genome: t.genome };
      kept.unshift(entry); persist();
      return entry;
    },
    tray() { return kept.slice(); },
    removeFromTray(idx) { if (idx >= 0 && idx < kept.length) { kept.splice(idx, 1); persist(); } },
  };
}
