// src/surprise-state.ts
//
// Surprise Wall v2 state: the wall reroll undo/redo history (#surprise-v2).
// The mount layer owns the tile DOM and re-renders from the current wall batch;
// this module just holds the history stack so it can't drift. The settings
// undo/redo history was removed in #433 (per-bar ↺ Reset replaced it); only the
// wall history remains. The v1 keep-tray is gone (the wall is now click-to-edit,
// no on-page curation).

import { type Genome } from './genome';
import { createHistory, type History } from './edit-history';
import { type SurpriseSettings } from './surprise-prefs';

export interface SurpriseState {
  /** Undo/redo over walls — each Reroll pushes the batch of genomes (Ctrl+Z). */
  wallHistory: History<Genome[]>;
}

export function createSurpriseState(
  _initialSettings?: SurpriseSettings,  // kept for call-site compat; settings history removed (#433)
): SurpriseState {
  return {
    wallHistory: createHistory<Genome[]>([]),
  };
}
