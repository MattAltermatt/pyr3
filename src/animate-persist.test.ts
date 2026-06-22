import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ANIMATE_TIMELINE_KEY,
  persistTimeline,
  restoreTimeline,
} from './animate-persist';
import { timelineGenomeAt, animationToTimeline } from './timeline';
import { FLAM3_ANIMATION_DEFAULTS } from './animation';
import { type Genome, type Xform } from './genome';
import { linear as linearVar } from './variations';
import { PYRE_PALETTE } from './palette';

const id = (c = 0): Xform => ({
  a: 1, b: 0, c, d: 0, e: 1, f: 0,
  weight: 1, color: 0, colorSpeed: 0.5,
  variations: [linearVar(1)],
});

const baseGenome = (overrides: Partial<Genome> = {}): Genome => ({
  name: 'k',
  xforms: [id()],
  scale: 100, cx: 0, cy: 0,
  palette: PYRE_PALETTE,
  ...overrides,
});

const tl = animationToTimeline({
  ...FLAM3_ANIMATION_DEFAULTS,
  keyframes: [baseGenome({ time: 0, xforms: [id(0)] }), baseGenome({ time: 1, xforms: [id(2)] })],
});

// Map-backed localStorage stub — happy-dom v20 doesn't expose `localStorage`
// under vitest. Canonical pattern (see src/edit-state.test.ts).
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
});

describe('animate-persist (#411)', () => {
  it('round-trips a timeline through localStorage, preserving render output', () => {
    persistTimeline(tl);
    const restored = restoreTimeline();
    expect(restored).not.toBeNull();
    expect(restored!.clips).toHaveLength(tl.clips.length);
    for (const s of [0, 0.5, 1]) {
      expect(timelineGenomeAt(restored!, s)).toEqual(timelineGenomeAt(tl, s));
    }
  });

  it('returns null when nothing is persisted (first visit / cleared)', () => {
    expect(restoreTimeline()).toBeNull();
  });

  it('persistTimeline(null) clears the key (entering animation mode / empty)', () => {
    persistTimeline(tl);
    expect(restoreTimeline()).not.toBeNull();
    persistTimeline(null);
    expect(restoreTimeline()).toBeNull();
    expect(globalThis.localStorage?.getItem(ANIMATE_TIMELINE_KEY) ?? null).toBeNull();
  });

  it('fails soft to null on a corrupt / old payload (no throw)', () => {
    globalThis.localStorage?.setItem(ANIMATE_TIMELINE_KEY, '{ not valid json');
    expect(restoreTimeline()).toBeNull();
  });
});
