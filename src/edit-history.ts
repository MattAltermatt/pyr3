// Editor undo / redo stack (#108).
//
// Snapshots Genome objects via structuredClone and walks them back/forward
// on undo/redo. The caller is responsible for re-applying the returned
// genome to live state (replacing state.genome, re-rendering, rebuilding the
// section panel).
//
// Semantics:
//   - createHistory(initial) seeds the stack with the cold-start genome.
//   - push(genome) deep-clones + appends; identical-content pushes coalesce
//     so a no-op edit doesn't pollute the stack.
//   - Pushing AFTER an undo truncates the now-orphaned redo tail
//     (standard editor behaviour — the alternate future is discarded).
//   - The cap (HISTORY_MAX=100) drops the OLDEST entries when exceeded.
//   - reset(genome) is for whole-genome replacements (file open, reroll) —
//     wipes the stack and seeds with the new entry.
//
// What gets pushed is the caller's choice. Editor wiring pushes on every
// commit gesture, debounced via the existing settle timer so a slider drag
// is one entry instead of sixty.

import type { Genome } from './genome';

export const HISTORY_MAX = 100;

export interface History {
  /** Append `genome` as the new tip. If it's content-identical to the current
   *  tip the call is a no-op (no entry added). When pushing after an undo,
   *  the redo tail is truncated. */
  push(genome: Genome): void;
  /** Move the pointer back one entry and return a clone of that genome.
   *  Returns `null` if already at the oldest entry. */
  undo(): Genome | null;
  /** Move the pointer forward one entry and return a clone of that genome.
   *  Returns `null` if already at the tip. */
  redo(): Genome | null;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Total entries currently held — useful for tests + UI counters. */
  size(): number;
  /** Wipe the stack and seed it with `genome`. Used by file-open / reroll. */
  reset(genome: Genome): void;
}

function clone(g: Genome): Genome {
  return structuredClone(g);
}

function sameContent(a: Genome, b: Genome): boolean {
  // Genomes are JSON-shaped (no functions, no Maps, no Dates), so
  // JSON.stringify on identical content yields identical strings. Cheap
  // enough at our genome size (~kB) to run on every push.
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createHistory(initial: Genome): History {
  const entries: Genome[] = [clone(initial)];
  let pointer = 0;

  return {
    push(genome: Genome): void {
      if (sameContent(entries[pointer]!, genome)) return;
      // Truncate any redo tail before appending.
      if (pointer < entries.length - 1) {
        entries.length = pointer + 1;
      }
      entries.push(clone(genome));
      pointer = entries.length - 1;
      // Cap from the front — drop oldest entries while preserving pointer.
      while (entries.length > HISTORY_MAX) {
        entries.shift();
        pointer--;
      }
    },
    undo(): Genome | null {
      if (pointer <= 0) return null;
      pointer--;
      return clone(entries[pointer]!);
    },
    redo(): Genome | null {
      if (pointer >= entries.length - 1) return null;
      pointer++;
      return clone(entries[pointer]!);
    },
    canUndo(): boolean {
      return pointer > 0;
    },
    canRedo(): boolean {
      return pointer < entries.length - 1;
    },
    size(): number {
      return entries.length;
    },
    reset(genome: Genome): void {
      entries.length = 0;
      entries.push(clone(genome));
      pointer = 0;
    },
  };
}
