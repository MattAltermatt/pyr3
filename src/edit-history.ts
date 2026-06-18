// Generic undo / redo snapshot stack (#108 for the editor's Genome; #265 for
// the gradient page's Palette).
//
// Snapshots JSON-shaped objects via structuredClone and walks them back/forward
// on undo/redo. The caller re-applies the returned snapshot to live state
// (e.g. the editor replaces state.genome + re-renders; the gradient page calls
// editor.setPalette + re-renders the flame).
//
// Semantics:
//   - createHistory(initial) seeds the stack with the starting snapshot.
//   - push(item) deep-clones + appends; identical-content pushes coalesce so a
//     no-op edit doesn't pollute the stack.
//   - Pushing AFTER an undo truncates the now-orphaned redo tail (standard
//     editor behaviour — the alternate future is discarded).
//   - The cap (HISTORY_MAX=100) drops the OLDEST entries when exceeded.
//   - reset(item) is for whole-state replacements — wipes the stack and seeds
//     with the new entry.
//
// What gets pushed is the caller's choice. Both callers push on every commit
// gesture, debounced (the editor's settle timer; the gradient page's own
// commit-debounce) so a continuous drag is one entry instead of sixty.
//
// Type param T must be JSON-shaped (no functions / Maps / Dates) — both
// structuredClone and the JSON.stringify content-equality below rely on that.

export const HISTORY_MAX = 100;

export interface History<T> {
  /** Append `item` as the new tip. If it's content-identical to the current
   *  tip the call is a no-op (no entry added). When pushing after an undo,
   *  the redo tail is truncated. */
  push(item: T): void;
  /** Move the pointer back one entry and return a clone of that snapshot.
   *  Returns `null` if already at the oldest entry. */
  undo(): T | null;
  /** Move the pointer forward one entry and return a clone of that snapshot.
   *  Returns `null` if already at the tip. */
  redo(): T | null;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Total entries currently held — useful for tests + UI counters. */
  size(): number;
  /** Wipe the stack and seed it with `item`. */
  reset(item: T): void;
}

function clone<T>(item: T): T {
  return structuredClone(item);
}

function sameContent<T>(a: T, b: T): boolean {
  // Snapshots are JSON-shaped (no functions, no Maps, no Dates), so
  // JSON.stringify on identical content yields identical strings. Cheap
  // enough at our snapshot sizes (~kB) to run on every push.
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createHistory<T>(initial: T): History<T> {
  const entries: T[] = [clone(initial)];
  let pointer = 0;

  return {
    push(item: T): void {
      if (sameContent(entries[pointer]!, item)) return;
      // Truncate any redo tail before appending.
      if (pointer < entries.length - 1) {
        entries.length = pointer + 1;
      }
      entries.push(clone(item));
      pointer = entries.length - 1;
      // Cap from the front — drop oldest entries while preserving pointer.
      while (entries.length > HISTORY_MAX) {
        entries.shift();
        pointer--;
      }
    },
    undo(): T | null {
      if (pointer <= 0) return null;
      pointer--;
      return clone(entries[pointer]!);
    },
    redo(): T | null {
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
    reset(item: T): void {
      entries.length = 0;
      entries.push(clone(item));
      pointer = 0;
    },
  };
}
