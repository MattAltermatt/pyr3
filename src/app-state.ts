// Cross-surface app context — currently scopes the "current flame" so the
// viewer can transfer it to gallery/editor on tab clicks (per the
// 2026-06-04 visual-overhaul design § tab-navigation contract).
//
// Viewer writes when it loads a flame; editor writes when its WIP genome
// mutates (corpusId is preserved if the editor opened from a corpus URL).
// All other surfaces read-only.
import type { Genome } from './genome';

export interface CurrentFlame {
  genome: Genome;
  corpusId?: { gen: number; id: number };   // present if loaded from corpus
}

let _current: CurrentFlame | null = null;

export function setCurrentFlame(flame: CurrentFlame): void { _current = flame; }
export function getCurrentFlame(): CurrentFlame | null { return _current; }
export function clearCurrentFlame(): void { _current = null; }
