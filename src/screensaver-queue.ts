// Random-shuffle queue over the ESF corpus with prev/next history.
//
// Model: a single `history` buffer + a `cursor` pointing at the currently-
// displayed entry. next() advances; prev() decrements. When cursor sits at
// the end of history and next() is called, a fresh random is generated and
// appended. Walking back past index 0 returns null (cursor parks at -1);
// the following next() re-emits history[0] so the user can replay forward
// through what was shown.
//
// HISTORY_MAX is the max number of prev() steps a fresh next() can be
// walked back by. The underlying buffer caps at HISTORY_MAX + 1 entries
// (current + HISTORY_MAX prev-able predecessors).

export interface SheepRef {
  readonly gen: number;
  readonly id: number;
}

export interface ScreensaverQueue {
  /** Advance and return the new current ref. Returns null when the source
   *  corpus is empty. */
  next(): SheepRef | null;
  /** Step back one entry; returns the new current ref, or null when we've
   *  walked past the start of history (cursor parks at -1). */
  prev(): SheepRef | null;
}

export const HISTORY_MAX = 50;
const BUFFER_CAP = HISTORY_MAX + 1;

/** Deterministic mulberry32 PRNG. Returns [0, 1). */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createScreensaverQueue(
  refs: readonly SheepRef[],
  seed: number,
): ScreensaverQueue {
  const rng = mulberry32(seed);
  const history: SheepRef[] = [];
  let cursor = -1;

  function pick(): SheepRef | null {
    if (refs.length === 0) return null;
    const idx = Math.floor(rng() * refs.length);
    return refs[idx] ?? null;
  }

  function appendAndAdvance(r: SheepRef): void {
    history.push(r);
    cursor = history.length - 1;
    while (history.length > BUFFER_CAP) {
      history.shift();
      cursor--;
    }
  }

  return {
    next() {
      if (refs.length === 0) return null;
      // Replay forward through history before generating new.
      if (cursor < history.length - 1) {
        cursor++;
        return history[cursor] ?? null;
      }
      // At end of history — generate a fresh random.
      const r = pick();
      if (!r) return null;
      appendAndAdvance(r);
      return r;
    },
    prev() {
      if (cursor <= 0) {
        if (cursor === 0) cursor = -1;
        return null;
      }
      cursor--;
      return history[cursor] ?? null;
    },
  };
}
