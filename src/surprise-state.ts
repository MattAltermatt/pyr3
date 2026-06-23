// src/surprise-state.ts
//
// Surprise Wall v2 state: two independent undo/redo histories (#surprise-v2).
// The mount layer owns the tile DOM and re-renders from the current wall batch;
// this module just holds the history stacks so they can't drift. The v1 keep-tray
// is gone (the wall is now click-to-edit, no on-page curation).

import { type Genome } from './genome';
import { createHistory, type History } from './edit-history';
import { type SurpriseSettings, SURPRISE_SETTINGS_DEFAULT } from './surprise-prefs';

export interface SurpriseState {
  /** Undo/redo over generation+layout settings (panel ↶↷). A settings undo
   *  arms the "apply settings" cue; it does not re-render. */
  settingsHistory: History<SurpriseSettings>;
  /** Undo/redo over walls — each Reroll pushes the batch of genomes (Ctrl+Z). */
  wallHistory: History<Genome[]>;
}

export function createSurpriseState(
  initialSettings: SurpriseSettings = SURPRISE_SETTINGS_DEFAULT,
): SurpriseState {
  return {
    settingsHistory: createHistory<SurpriseSettings>(initialSettings),
    wallHistory: createHistory<Genome[]>([]),
  };
}
