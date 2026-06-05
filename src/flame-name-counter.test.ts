// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  peekIndex,
  bumpIndex,
  COUNTER_KEY,
  _clearCounters,
} from './flame-name-counter';

function makeStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => { store.delete(k); },
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorageStub());
  _clearCounters();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('flame-name-counter', () => {
  it('peekIndex starts at 1 for a never-seen template', () => {
    expect(peekIndex('sky-flesh-{index}')).toBe(1);
  });

  it('bumpIndex advances the counter; peekIndex returns the NEXT value', () => {
    expect(peekIndex('flame-{index}')).toBe(1);
    bumpIndex('flame-{index}');
    expect(peekIndex('flame-{index}')).toBe(2);
    bumpIndex('flame-{index}');
    expect(peekIndex('flame-{index}')).toBe(3);
  });

  it('counters are independent per template string', () => {
    bumpIndex('sky-flesh-{index}');
    bumpIndex('sky-flesh-{index}');
    bumpIndex('sky-flesh-{index}');
    expect(peekIndex('sky-flesh-{index}')).toBe(4);
    expect(peekIndex('different-{index}')).toBe(1);
  });

  it('persists across reads (localStorage round-trip)', () => {
    bumpIndex('flame-{index}');
    bumpIndex('flame-{index}');
    // Simulate fresh module load — peekIndex re-reads localStorage.
    expect(peekIndex('flame-{index}')).toBe(3);
  });

  it('survives malformed localStorage value (resets to 1)', () => {
    localStorage.setItem(COUNTER_KEY, 'not-json');
    expect(peekIndex('flame-{index}')).toBe(1);
    bumpIndex('flame-{index}');
    expect(peekIndex('flame-{index}')).toBe(2);
  });

  it('treats whitespace-different templates as distinct counters', () => {
    bumpIndex('flame-{index}');
    expect(peekIndex('flame -{index}')).toBe(1);
  });
});
