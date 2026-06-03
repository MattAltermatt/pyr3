// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  openVariationPicker,
  FEATURED_VARIATIONS,
  CATEGORY_MAP,
  readRecentlyUsed,
  pushRecentlyUsed,
} from './edit-variation-picker';
import { V } from './variations';

// Map-backed localStorage stub — happy-dom v20 doesn't expose `localStorage`
// globally under vitest. See src/prefs.test.ts for the canonical pattern.
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
  document.body.replaceChildren();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FEATURED_VARIATIONS', () => {
  it('contains 20-30 curated variation indices', () => {
    expect(FEATURED_VARIATIONS.length).toBeGreaterThanOrEqual(20);
    expect(FEATURED_VARIATIONS.length).toBeLessThanOrEqual(30);
  });
  it('every featured index resolves to a known variation', () => {
    const reverse = new Set<number>(Object.values(V) as number[]);
    for (const idx of FEATURED_VARIATIONS) {
      expect(reverse.has(idx)).toBe(true);
    }
  });
});

describe('CATEGORY_MAP', () => {
  it('every variation index appears in exactly one category', () => {
    const seen = new Set<number>();
    for (const cat of Object.values(CATEGORY_MAP)) {
      for (const idx of cat) {
        expect(seen.has(idx)).toBe(false);
        seen.add(idx);
      }
    }
    // All known variations should be categorized.
    for (const idx of Object.values(V)) {
      expect(seen.has(idx as number)).toBe(true);
    }
  });
});

describe('recently-used FIFO', () => {
  it('readRecentlyUsed returns [] when localStorage is empty', () => {
    expect(readRecentlyUsed()).toEqual([]);
  });
  it('pushRecentlyUsed prepends to FIFO and caps at 5', () => {
    pushRecentlyUsed(V.spherical);
    pushRecentlyUsed(V.swirl);
    pushRecentlyUsed(V.julian);
    expect(readRecentlyUsed()).toEqual([V.julian, V.swirl, V.spherical]);
  });
  it('pushRecentlyUsed deduplicates (moves to front)', () => {
    pushRecentlyUsed(V.spherical);
    pushRecentlyUsed(V.swirl);
    pushRecentlyUsed(V.spherical);
    expect(readRecentlyUsed()).toEqual([V.spherical, V.swirl]);
  });
  it('FIFO cap = 5', () => {
    for (const k of [V.linear, V.spherical, V.swirl, V.julian, V.heart, V.disc]) {
      pushRecentlyUsed(k);
    }
    expect(readRecentlyUsed().length).toBe(5);
    // V.linear was the oldest → should have been evicted.
    expect(readRecentlyUsed()).not.toContain(V.linear);
  });
});

describe('openVariationPicker — fitting-room behavior', () => {
  function setup() {
    const initialIndex: number = V.spherical;
    let currentIndex: number = initialIndex;
    const onPreview = vi.fn((idx: number) => { currentIndex = idx; });
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const handle = openVariationPicker({
      host: document.body,
      initialIndex,
      onPreview,
      onCommit,
      onCancel,
    });
    return { handle, onPreview, onCommit, onCancel, getCurrent: () => currentIndex };
  }

  it('mounts a dialog and shows recently-used + featured + browse all', () => {
    setup();
    const dialog = document.querySelector('.pyr3-var-picker') as HTMLDivElement;
    expect(dialog).toBeTruthy();
    expect(dialog.querySelector('.pyr3-var-featured')).toBeTruthy();
    expect(dialog.querySelector('.pyr3-var-browse')).toBeTruthy();
  });

  it('clicking a tile fires onPreview with the picked index', () => {
    const { onPreview } = setup();
    const tile = document.querySelector(`.pyr3-var-tile[data-vidx="${V.julian}"]`) as HTMLButtonElement;
    tile.click();
    expect(onPreview).toHaveBeenCalledWith(V.julian);
  });

  it('apply button fires onCommit + closes', () => {
    const { onCommit } = setup();
    (document.querySelector('.pyr3-var-apply') as HTMLButtonElement).click();
    expect(onCommit).toHaveBeenCalled();
    expect(document.querySelector('.pyr3-var-picker')).toBeNull();
  });

  it('revert button fires onPreview(initialIndex) and keeps dialog open', () => {
    const { onPreview } = setup();
    (document.querySelector(`.pyr3-var-tile[data-vidx="${V.heart}"]`) as HTMLButtonElement).click();
    (document.querySelector('.pyr3-var-revert') as HTMLButtonElement).click();
    expect(onPreview).toHaveBeenLastCalledWith(V.spherical);
    expect(document.querySelector('.pyr3-var-picker')).toBeTruthy();
  });

  it('cancel button fires onCancel + closes', () => {
    const { onCancel } = setup();
    (document.querySelector('.pyr3-var-cancel') as HTMLButtonElement).click();
    expect(onCancel).toHaveBeenCalled();
    expect(document.querySelector('.pyr3-var-picker')).toBeNull();
  });

  it('Escape key acts as cancel', () => {
    const { onCancel } = setup();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('search filters tiles by name', () => {
    setup();
    const search = document.querySelector('.pyr3-var-search') as HTMLInputElement;
    search.value = 'jul';
    search.dispatchEvent(new Event('input'));
    // Should show only julia / julian / juliascope in the filtered grid.
    const visibleTiles = [...document.querySelectorAll('.pyr3-var-tile')].filter(
      el => (el as HTMLElement).style.display !== 'none',
    );
    const names = visibleTiles.map(el => el.getAttribute('data-vname'));
    expect(names).toContain('julia');
    expect(names).toContain('julian');
    expect(names.every(n => n!.toLowerCase().includes('jul'))).toBe(true);
  });
});
