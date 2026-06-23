// @vitest-environment happy-dom
//
// Unit tests for the variation picker (Phase 10 visual overhaul refactor).
//
// The picker mirrors the palette-picker shell DOM (.pyr3-picker /
// .pyr3-picker-head / .pyr3-picker-body / .pyr3-picker-foot) with:
//   - Title:   '🧬 Variation picker · xform N'
//   - Search:  filter by variation name (substring)
//   - Tabs:    all (99) · ★ favorites (N)
//   - Sort:    name (asc/desc)
//   - Auto-apply toggle
//   - 3-col cell grid of variation thumbnails + name + star
//   - Footer:  selected info · ⟲ revert · apply & close
//
// NO filter chips — per user direction.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  openVariationPicker,
  FEATURED_VARIATIONS,
  CATEGORY_MAP,
  readRecentlyUsed,
  pushRecentlyUsed,
} from './edit-variation-picker';
import { V, VARIATION_NAMES } from './variations';

const TOTAL_VARIATIONS = Object.keys(VARIATION_NAMES).length;

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

// ── Catalogue invariants ─────────────────────────────────────────────────

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

// ── Picker shell DOM ─────────────────────────────────────────────────────

function setup(over: {
  initialIndex?: number;
  xformIndex?: number;
} = {}) {
  const initialIndex: number = over.initialIndex ?? V.spherical;
  let currentIndex: number = initialIndex;
  const onPreview = vi.fn((idx: number) => { currentIndex = idx; });
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const handle = openVariationPicker({
    host: document.body,
    initialIndex,
    xformIndex: over.xformIndex,
    onPreview,
    onCommit,
    onCancel,
  });
  return { handle, onPreview, onCommit, onCancel, getCurrent: () => currentIndex };
}

describe('variation picker — shell DOM', () => {
  it('mounts a docked sidecar with head / body / foot', () => {
    setup();
    expect(document.querySelector('.pyr3-picker')).toBeTruthy();
    expect(document.querySelector('.pyr3-picker-head')).toBeTruthy();
    expect(document.querySelector('.pyr3-picker-body')).toBeTruthy();
    expect(document.querySelector('.pyr3-picker-foot')).toBeTruthy();
  });

  it('shell carries the legacy .pyr3-var-picker class for backward-compat selectors', () => {
    setup();
    // Preserves the API surface — the editor's outer host scopes selectors
    // by this class.
    expect(document.querySelector('.pyr3-var-picker')).toBeTruthy();
  });

  it('title shows "🧬 Variation picker · xform N" when xformIndex provided', () => {
    setup({ xformIndex: 2 });
    const title = document.querySelector('.pyr3-picker-title') as HTMLElement;
    expect(title).toBeTruthy();
    expect(title.textContent).toContain('Variation picker');
    expect(title.textContent).toContain('xform 2');
  });

  it('title omits the xform suffix when xformIndex is undefined', () => {
    setup();
    const title = document.querySelector('.pyr3-picker-title') as HTMLElement;
    expect(title.textContent).toContain('Variation picker');
    expect(title.textContent).not.toMatch(/xform/i);
  });

  it('header has a close-x button that fires onCancel + closes', () => {
    const { onCancel } = setup();
    const close = document.querySelector('.pyr3-picker-close') as HTMLElement;
    expect(close).toBeTruthy();
    close.click();
    expect(onCancel).toHaveBeenCalled();
    expect(document.querySelector('.pyr3-picker')).toBeNull();
  });

  it('header has a search input', () => {
    setup();
    const search = document.querySelector('.pyr3-picker-search') as HTMLInputElement;
    expect(search).toBeTruthy();
    expect(search.tagName).toBe('INPUT');
  });

  it('header has NO chip row (per user spec for variation picker)', () => {
    setup();
    expect(document.querySelector('.pyr3-picker-chip-row')).toBeNull();
  });

  it('header has tabs: `all` and `★ favorites` with counts', () => {
    setup();
    const tabs = document.querySelectorAll('.pyr3-picker-tab');
    expect(tabs.length).toBe(2);
    const allTab = document.querySelector('.pyr3-picker-tab[data-tab="all"]') as HTMLElement;
    const favTab = document.querySelector('.pyr3-picker-tab[data-tab="favorites"]') as HTMLElement;
    expect(allTab).toBeTruthy();
    expect(favTab).toBeTruthy();
    expect(allTab.textContent).toContain('all');
    expect(allTab.textContent).toContain(String(TOTAL_VARIATIONS));
    expect(favTab.textContent).toContain('favorites');
  });

  it('controls row has a name-sort dropdown + auto-apply toggle', () => {
    setup();
    const sort = document.querySelector('.pyr3-picker-sort') as HTMLSelectElement;
    expect(sort).toBeTruthy();
    expect(sort.tagName).toBe('SELECT');
    const toggle = document.querySelector('.pyr3-picker-auto-apply') as HTMLElement;
    expect(toggle).toBeTruthy();
  });

  it('body uses a 3-col grid', () => {
    setup();
    const body = document.querySelector('.pyr3-picker-body') as HTMLElement;
    expect(body.style.gridTemplateColumns).toMatch(/repeat\(3,/);
  });

  it('body renders one cell per known variation', () => {
    setup();
    const cells = document.querySelectorAll('.pyr3-picker-cell');
    expect(cells.length).toBe(TOTAL_VARIATIONS);
  });

  it('each cell has a thumbnail img, name, and star widget', () => {
    setup();
    const cell = document.querySelector('.pyr3-picker-cell') as HTMLElement;
    expect(cell.querySelector('img.pyr3-var-thumb')).toBeTruthy();
    expect(cell.querySelector('.pyr3-picker-cell-name')).toBeTruthy();
    expect(cell.querySelector('.pyr3-picker-cell-star')).toBeTruthy();
  });

  it('active cell (matching initialIndex) carries the .active class', () => {
    setup({ initialIndex: V.spherical });
    const active = document.querySelectorAll('.pyr3-picker-cell.active');
    expect(active.length).toBe(1);
    expect((active[0] as HTMLElement).dataset['vidx']).toBe(String(V.spherical));
  });

  it('footer has selected info + revert + apply&close buttons', () => {
    setup();
    expect(document.querySelector('.pyr3-picker-selected')).toBeTruthy();
    expect(document.querySelector('.pyr3-picker-revert')).toBeTruthy();
    expect(document.querySelector('.pyr3-picker-apply')).toBeTruthy();
  });

  it('apply & close button uses btn-primary variant (popped CTA)', () => {
    setup();
    const apply = document.querySelector('.pyr3-picker-apply') as HTMLElement;
    expect(apply.classList.contains('pyr3-btn')).toBe(true);
    expect(apply.classList.contains('pyr3-btn-primary')).toBe(true);
  });

  it('revert button uses btn-accent variant', () => {
    setup();
    const revert = document.querySelector('.pyr3-picker-revert') as HTMLElement;
    expect(revert.classList.contains('pyr3-btn')).toBe(true);
    expect(revert.classList.contains('pyr3-btn-accent')).toBe(true);
  });
});

// ── Behavior — fitting-room semantics ────────────────────────────────────

describe('variation picker — fitting-room behavior', () => {
  it('clicking a cell fires onPreview with that variation index', () => {
    const { onPreview } = setup();
    const cell = document.querySelector(
      `.pyr3-picker-cell[data-vidx="${V.julian}"]`,
    ) as HTMLElement;
    cell.click();
    expect(onPreview).toHaveBeenCalledWith(V.julian);
  });

  it('clicking a cell updates the .active highlight', () => {
    setup();
    const cell = document.querySelector(
      `.pyr3-picker-cell[data-vidx="${V.heart}"]`,
    ) as HTMLElement;
    cell.click();
    expect(cell.classList.contains('active')).toBe(true);
    const others = document.querySelectorAll('.pyr3-picker-cell.active');
    expect(others.length).toBe(1);
  });

  it('apply & close button fires onCommit + closes', () => {
    const { onCommit } = setup();
    (document.querySelector('.pyr3-picker-apply') as HTMLElement).click();
    expect(onCommit).toHaveBeenCalled();
    expect(document.querySelector('.pyr3-picker')).toBeNull();
  });

  it('revert button fires onPreview(initialIndex) and keeps picker open', () => {
    const { onPreview } = setup({ initialIndex: V.spherical });
    (document.querySelector(
      `.pyr3-picker-cell[data-vidx="${V.heart}"]`,
    ) as HTMLElement).click();
    (document.querySelector('.pyr3-picker-revert') as HTMLElement).click();
    expect(onPreview).toHaveBeenLastCalledWith(V.spherical);
    expect(document.querySelector('.pyr3-picker')).toBeTruthy();
  });

  it('Escape key cancels (fires onCancel + closes)', () => {
    const { onCancel } = setup();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onCancel).toHaveBeenCalled();
    expect(document.querySelector('.pyr3-picker')).toBeNull();
  });

  it('search filters cells by name (substring, case-insensitive)', () => {
    setup();
    const search = document.querySelector('.pyr3-picker-search') as HTMLInputElement;
    search.value = 'jul';
    search.dispatchEvent(new Event('input'));
    const cells = document.querySelectorAll<HTMLElement>('.pyr3-picker-cell');
    const visible = [...cells].filter((c) => c.style.display !== 'none');
    expect(visible.length).toBeGreaterThan(0);
    const names = visible.map((c) => c.dataset['vname'] ?? '');
    for (const n of names) expect(n.toLowerCase()).toContain('jul');
  });

  it('sort: name desc reverses the cell order vs name asc', () => {
    setup();
    const body = document.querySelector('.pyr3-picker-body') as HTMLElement;
    const sort = document.querySelector('.pyr3-picker-sort') as HTMLSelectElement;
    sort.value = 'name-asc';
    sort.dispatchEvent(new Event('change'));
    const ascOrder = [...body.querySelectorAll<HTMLElement>('.pyr3-picker-cell')]
      .map((c) => c.dataset['vname'] ?? '');
    sort.value = 'name-desc';
    sort.dispatchEvent(new Event('change'));
    const descOrder = [...body.querySelectorAll<HTMLElement>('.pyr3-picker-cell')]
      .map((c) => c.dataset['vname'] ?? '');
    expect(descOrder).toEqual([...ascOrder].reverse());
  });

  it('auto-apply OFF: clicking a cell does NOT fire onCommit', () => {
    const { onCommit } = setup();
    (document.querySelector(
      `.pyr3-picker-cell[data-vidx="${V.heart}"]`,
    ) as HTMLElement).click();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('auto-apply ON: clicking a cell fires onCommit', () => {
    const { onCommit } = setup();
    (document.querySelector('.pyr3-picker-auto-apply') as HTMLElement).click();
    (document.querySelector(
      `.pyr3-picker-cell[data-vidx="${V.heart}"]`,
    ) as HTMLElement).click();
    expect(onCommit).toHaveBeenCalled();
  });
});

// ── Favorites (Task 10.2) ────────────────────────────────────────────────

describe('variation picker — favorites', () => {
  it('star is empty (☆) when not favorited', () => {
    setup();
    const cell = document.querySelector(
      `.pyr3-picker-cell[data-vidx="${V.linear}"]`,
    ) as HTMLElement;
    const star = cell.querySelector('.pyr3-picker-cell-star') as HTMLElement;
    expect(star.textContent).toBe('☆');
    expect(star.classList.contains('on')).toBe(false);
  });

  it('clicking a star toggles favorite — filled ★ + .on class', () => {
    setup();
    const cell = document.querySelector(
      `.pyr3-picker-cell[data-vidx="${V.linear}"]`,
    ) as HTMLElement;
    const star = cell.querySelector('.pyr3-picker-cell-star') as HTMLElement;
    star.click();
    expect(star.textContent).toBe('★');
    expect(star.classList.contains('on')).toBe(true);
    star.click();
    expect(star.textContent).toBe('☆');
    expect(star.classList.contains('on')).toBe(false);
  });

  it('clicking a star does NOT also preview/select the cell', () => {
    const { onPreview } = setup({ initialIndex: V.spherical });
    const cell = document.querySelector(
      `.pyr3-picker-cell[data-vidx="${V.linear}"]`,
    ) as HTMLElement;
    const star = cell.querySelector('.pyr3-picker-cell-star') as HTMLElement;
    star.click();
    // No preview fired (the cell click handler is stopPropagation'd from
    // the star widget).
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('favorites persist to localStorage under pyr3.variation.favorites as JSON array of names', () => {
    setup();
    const cell = document.querySelector(
      `.pyr3-picker-cell[data-vidx="${V.linear}"]`,
    ) as HTMLElement;
    (cell.querySelector('.pyr3-picker-cell-star') as HTMLElement).click();
    const raw = localStorage.getItem('pyr3.variation.favorites');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toContain('linear');
  });

  it('★ favorites tab filters cells to favorited-only', () => {
    setup();
    // Star two variations.
    (document.querySelector(
      `.pyr3-picker-cell[data-vidx="${V.linear}"] .pyr3-picker-cell-star`,
    ) as HTMLElement).click();
    (document.querySelector(
      `.pyr3-picker-cell[data-vidx="${V.heart}"] .pyr3-picker-cell-star`,
    ) as HTMLElement).click();
    // Switch to favorites tab.
    (document.querySelector(
      '.pyr3-picker-tab[data-tab="favorites"]',
    ) as HTMLElement).click();
    const cells = document.querySelectorAll<HTMLElement>('.pyr3-picker-cell');
    const visible = [...cells].filter((c) => c.style.display !== 'none');
    expect(visible.length).toBe(2);
    const visibleNames = visible.map((c) => c.dataset['vname']);
    expect(visibleNames).toContain('linear');
    expect(visibleNames).toContain('heart');
  });

  it('favorites tab label shows the favorite count live', () => {
    setup();
    const favTab = document.querySelector(
      '.pyr3-picker-tab[data-tab="favorites"]',
    ) as HTMLElement;
    expect(favTab.textContent).toContain('(0)');
    (document.querySelector(
      `.pyr3-picker-cell[data-vidx="${V.linear}"] .pyr3-picker-cell-star`,
    ) as HTMLElement).click();
    expect(favTab.textContent).toContain('(1)');
  });

  it('favorites localStorage key is separate from palette favorites', () => {
    setup();
    (document.querySelector(
      `.pyr3-picker-cell[data-vidx="${V.linear}"] .pyr3-picker-cell-star`,
    ) as HTMLElement).click();
    expect(localStorage.getItem('pyr3.variation.favorites')).toBeTruthy();
    // Must NOT have written to the palette key.
    expect(localStorage.getItem('pyr3.palette.favorites')).toBeNull();
  });

  it('favorites round-trip — values persisted in one picker session restore in the next', () => {
    // First session: star linear + julian.
    const first = setup();
    (document.querySelector(
      `.pyr3-picker-cell[data-vidx="${V.linear}"] .pyr3-picker-cell-star`,
    ) as HTMLElement).click();
    (document.querySelector(
      `.pyr3-picker-cell[data-vidx="${V.julian}"] .pyr3-picker-cell-star`,
    ) as HTMLElement).click();
    first.handle.close();
    document.body.replaceChildren();
    // Second session: stars should hydrate from localStorage.
    setup();
    const linearStar = document.querySelector(
      `.pyr3-picker-cell[data-vidx="${V.linear}"] .pyr3-picker-cell-star`,
    ) as HTMLElement;
    const julianStar = document.querySelector(
      `.pyr3-picker-cell[data-vidx="${V.julian}"] .pyr3-picker-cell-star`,
    ) as HTMLElement;
    expect(linearStar.textContent).toBe('★');
    expect(julianStar.textContent).toBe('★');
    const favTab = document.querySelector(
      '.pyr3-picker-tab[data-tab="favorites"]',
    ) as HTMLElement;
    expect(favTab.textContent).toContain('(2)');
  });
});

// ── Multi-select mode (#surprise-v2) ─────────────────────────────────────
// The picker tiles carry their variation index on `data-vidx` (see buildCell);
// the upstream spec stub referenced `data-idx`, but the real attribute is
// `data-vidx`, so the selectors below address that.

describe('variation picker multi-select mode (#surprise-v2)', () => {
  it('toggles a Set and fires onChange, never onPreview, in multi mode', () => {
    const selected = new Set<number>([V.spherical]);
    const onChange = vi.fn();
    const onPreview = vi.fn();
    const h = openVariationPicker({ mode: 'multi', selected, onChange, onPreview,
      onApply: vi.fn(), onClose: vi.fn() } as any);
    // find a thumb tile (cells carry a data-vidx); click one that's NOT spherical
    const tiles = Array.from(document.querySelectorAll('[data-vidx]')) as HTMLElement[];
    const tile = tiles.find(t => Number(t.dataset.vidx) !== V.spherical)!;
    tile.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onChange).toHaveBeenCalled();
    const arg = onChange.mock.calls[0]![0] as Set<number>;
    expect(arg.has(Number(tile.dataset.vidx))).toBe(true); // newly added
    expect(onPreview).not.toHaveBeenCalled();
    h.close();
  });

  it('clicking an already-selected tile removes it from the set', () => {
    const selected = new Set<number>([V.spherical]);
    const onChange = vi.fn();
    const h = openVariationPicker({ mode: 'multi', selected, onChange, onApply: vi.fn(), onClose: vi.fn() } as any);
    const tile = document.querySelector(`[data-vidx="${V.spherical}"]`) as HTMLElement;
    tile.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const arg = onChange.mock.calls[0]![0] as Set<number>;
    expect(arg.has(V.spherical)).toBe(false);
    h.close();
  });

  it('multi mode paints every selected tile active (set membership, not single index)', () => {
    const selected = new Set<number>([V.spherical, V.heart, V.swirl]);
    const onChange = vi.fn();
    const h = openVariationPicker({ mode: 'multi', selected, onChange, onApply: vi.fn(), onClose: vi.fn() } as any);
    const active = document.querySelectorAll('.pyr3-picker-cell.active');
    const activeIdx = new Set([...active].map(c => Number((c as HTMLElement).dataset['vidx'])));
    expect(activeIdx).toEqual(new Set([V.spherical, V.heart, V.swirl]));
    h.close();
  });

  it('single mode is unchanged — still previews', () => {
    const onPreview = vi.fn();
    const h = openVariationPicker({ host: document.body, initialIndex: V.spherical, onPreview, onApply: vi.fn(), onClose: vi.fn() } as any);
    const tiles = Array.from(document.querySelectorAll('[data-vidx]')) as HTMLElement[];
    tiles[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPreview).toHaveBeenCalled();
    h.close();
  });
});
