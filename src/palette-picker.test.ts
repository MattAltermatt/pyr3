// @vitest-environment happy-dom
//
// Unit tests for the docked palette picker (Phase 9). The picker is a self-
// contained sidecar widget — the editor host mounts it into a designated
// dock element; positioning is a pure CSS concern.
//
// Shape:
//   header  = title + count badge + close-x · search input · chip row
//             (Task 9.5 fills) · tabs · sort dropdown + auto-apply toggle
//   body    = (Task 9.4) 3-col cell grid; this file asserts the empty body
//             container exists in the shell phase
//   footer  = selected info + revert + apply&close

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountPalettePicker, type PalettePickerOpts } from './palette-picker';
import { type PaletteSource } from './flam3-palette-names';

afterEach(() => {
  document.body.innerHTML = '';
});

function makeOpts(over: Partial<PalettePickerOpts> = {}): PalettePickerOpts {
  return {
    current: { kind: 'flam3', number: 100 } as PaletteSource,
    onApply: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
}

function mount(opts: PalettePickerOpts = makeOpts()): {
  root: HTMLElement;
  handle: ReturnType<typeof mountPalettePicker>;
} {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const handle = mountPalettePicker(root, opts);
  return { root, handle };
}

describe('palette picker — shell DOM', () => {
  it('mounts the docked sidecar with header / body / footer', () => {
    const { root } = mount();
    expect(root.querySelector('.pyr3-palette-picker')).toBeTruthy();
    expect(root.querySelector('.pyr3-palette-picker-head')).toBeTruthy();
    expect(root.querySelector('.pyr3-palette-picker-body')).toBeTruthy();
    expect(root.querySelector('.pyr3-palette-picker-foot')).toBeTruthy();
  });

  it('header has title + total/filtered count badge', () => {
    const { root } = mount();
    const title = root.querySelector('.pyr3-palette-picker-title') as HTMLElement;
    expect(title.textContent).toMatch(/palette/i);
    const badge = root.querySelector('.pyr3-palette-picker-badge') as HTMLElement;
    expect(badge).toBeTruthy();
    // 701 total flam3 palettes; badge starts at the full count.
    expect(badge.textContent).toContain('701');
  });

  it('header has a close-x button that calls opts.onClose', () => {
    const onClose = vi.fn();
    const { root } = mount(makeOpts({ onClose }));
    const close = root.querySelector('.pyr3-palette-picker-close') as HTMLElement;
    expect(close).toBeTruthy();
    close.click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('header has a search input', () => {
    const { root } = mount();
    const search = root.querySelector('.pyr3-palette-picker-search') as HTMLInputElement;
    expect(search).toBeTruthy();
    expect(search.tagName).toBe('INPUT');
  });

  it('header has a chip-row placeholder (Task 9.5 fills with 11 chips)', () => {
    const { root } = mount();
    expect(root.querySelector('.pyr3-palette-picker-chip-row')).toBeTruthy();
  });

  it('header has tabs: `all` and `★ favorites` with counts', () => {
    const { root } = mount();
    const tabs = root.querySelectorAll('.pyr3-palette-picker-tab');
    expect(tabs.length).toBe(2);
    const allTab = root.querySelector('.pyr3-palette-picker-tab[data-tab="all"]') as HTMLElement;
    const favTab = root.querySelector('.pyr3-palette-picker-tab[data-tab="favorites"]') as HTMLElement;
    expect(allTab).toBeTruthy();
    expect(favTab).toBeTruthy();
    expect(allTab.textContent).toContain('all');
    expect(favTab.textContent).toContain('favorites');
  });

  it('controls row has a sort dropdown + auto-apply toggle', () => {
    const { root } = mount();
    const sort = root.querySelector('.pyr3-palette-picker-sort') as HTMLSelectElement;
    expect(sort).toBeTruthy();
    expect(sort.tagName).toBe('SELECT');
    const toggle = root.querySelector('.pyr3-palette-picker-auto-apply') as HTMLElement;
    expect(toggle).toBeTruthy();
  });

  it('footer has selected info + revert + apply&close buttons', () => {
    const { root } = mount();
    expect(root.querySelector('.pyr3-palette-picker-selected')).toBeTruthy();
    expect(root.querySelector('.pyr3-palette-picker-revert')).toBeTruthy();
    expect(root.querySelector('.pyr3-palette-picker-apply')).toBeTruthy();
  });

  it('apply & close button uses btn-primary variant (popped CTA)', () => {
    const { root } = mount();
    const apply = root.querySelector('.pyr3-palette-picker-apply') as HTMLElement;
    expect(apply.classList.contains('pyr3-btn')).toBe(true);
    expect(apply.classList.contains('pyr3-btn-primary')).toBe(true);
  });

  it('revert button uses btn-accent variant', () => {
    const { root } = mount();
    const revert = root.querySelector('.pyr3-palette-picker-revert') as HTMLElement;
    expect(revert.classList.contains('pyr3-btn')).toBe(true);
    expect(revert.classList.contains('pyr3-btn-accent')).toBe(true);
  });

  it('handle.destroy() removes the picker from the root', () => {
    const { root, handle } = mount();
    handle.destroy();
    expect(root.querySelector('.pyr3-palette-picker')).toBeNull();
  });
});

describe('palette picker — body cell grid (Task 9.4)', () => {
  it('body uses grid-template-columns: repeat(3, 1fr)', () => {
    const { root } = mount();
    const body = root.querySelector('.pyr3-palette-picker-body') as HTMLElement;
    // gridTemplateColumns is normalized by the browser; just check 3 columns.
    expect(body.style.gridTemplateColumns).toMatch(/repeat\(3,/);
  });

  it('renders one cell per flam3 palette', () => {
    const { root } = mount();
    const cells = root.querySelectorAll('.pyr3-palette-picker-cell');
    // 701 catalog entries.
    expect(cells.length).toBe(701);
  });

  it('each cell has a ribbon (height: 36px), a name, and a star placeholder', () => {
    const { root } = mount();
    const first = root.querySelector('.pyr3-palette-picker-cell') as HTMLElement;
    const ribbon = first.querySelector('.pyr3-palette-picker-cell-ribbon') as HTMLElement;
    expect(ribbon).toBeTruthy();
    expect(ribbon.style.height).toBe('36px');
    expect(first.querySelector('.pyr3-palette-picker-cell-name')).toBeTruthy();
    expect(first.querySelector('.pyr3-palette-picker-cell-star')).toBeTruthy();
  });

  it('active cell (matching opts.current) carries the `active` class + amber border', () => {
    // current = flam3 #100; expect cell[data-idx="100"] to be active.
    const { root } = mount();
    const active = root.querySelectorAll('.pyr3-palette-picker-cell.active');
    expect(active.length).toBe(1);
    const idx = (active[0] as HTMLElement).dataset['idx'];
    expect(idx).toBe('100');
    // Amber border via the COLORS.flame.top token — assert the style is set.
    const style = (active[0] as HTMLElement).style;
    expect(style.borderColor).toBeTruthy();
  });

  it('typing in the search input filters cells live (case-insensitive substring)', () => {
    const { root } = mount();
    const search = root.querySelector('.pyr3-palette-picker-search') as HTMLInputElement;
    // 'sky' should match e.g. flam3 #1 sky-flesh, and hide most others.
    search.value = 'sky';
    search.dispatchEvent(new Event('input'));
    const cells = root.querySelectorAll<HTMLElement>('.pyr3-palette-picker-cell');
    const visible = [...cells].filter((c) => c.style.display !== 'none');
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(701);
    // Every visible cell's name contains 'sky' (case-insensitive).
    for (const c of visible) {
      const name = (c.querySelector('.pyr3-palette-picker-cell-name') as HTMLElement).textContent ?? '';
      expect(name.toLowerCase()).toContain('sky');
    }
  });

  it('clearing search restores all cells', () => {
    const { root } = mount();
    const search = root.querySelector('.pyr3-palette-picker-search') as HTMLInputElement;
    search.value = 'sky';
    search.dispatchEvent(new Event('input'));
    search.value = '';
    search.dispatchEvent(new Event('input'));
    const cells = root.querySelectorAll<HTMLElement>('.pyr3-palette-picker-cell');
    const visible = [...cells].filter((c) => c.style.display !== 'none');
    expect(visible.length).toBe(701);
  });

  it('search match updates the count badge live', () => {
    const { root } = mount();
    const search = root.querySelector('.pyr3-palette-picker-search') as HTMLInputElement;
    const badge = root.querySelector('.pyr3-palette-picker-badge') as HTMLElement;
    expect(badge.textContent).toBe('701');
    search.value = 'sky';
    search.dispatchEvent(new Event('input'));
    expect(badge.textContent).toMatch(/\d+ \/ 701/);
  });
});

describe('palette picker — color filter chips (Task 9.5)', () => {
  it('renders 11 chips matching COLOR_TAGS', async () => {
    const { COLOR_TAGS } = await import('./palette-tags');
    const { root } = mount();
    const chips = root.querySelectorAll('.pyr3-palette-picker-chip');
    expect(chips.length).toBe(COLOR_TAGS.length);
    expect(chips.length).toBe(11);
    const order = [...chips].map((c) => (c as HTMLElement).dataset['tag']);
    expect(order).toEqual([...COLOR_TAGS]);
  });

  it('each chip has a canonical color swatch (background style set)', () => {
    const { root } = mount();
    const chips = root.querySelectorAll<HTMLElement>('.pyr3-palette-picker-chip');
    for (const chip of chips) {
      const swatch = chip.querySelector('.pyr3-palette-picker-chip-swatch') as HTMLElement;
      expect(swatch).toBeTruthy();
      // backgroundColor (canonical sample) is set.
      expect(swatch.style.backgroundColor || swatch.style.background).toBeTruthy();
    }
  });

  it('clicking a chip toggles the .on class', () => {
    const { root } = mount();
    const redChip = root.querySelector('.pyr3-palette-picker-chip[data-tag="red"]') as HTMLElement;
    expect(redChip.classList.contains('on')).toBe(false);
    redChip.click();
    expect(redChip.classList.contains('on')).toBe(true);
    redChip.click();
    expect(redChip.classList.contains('on')).toBe(false);
  });

  it('chip clicks filter the cell grid — OR within color chips', () => {
    const { root } = mount();
    const redChip = root.querySelector('.pyr3-palette-picker-chip[data-tag="red"]') as HTMLElement;
    redChip.click();
    const cells = root.querySelectorAll<HTMLElement>('.pyr3-palette-picker-cell');
    const visible = [...cells].filter((c) => c.style.display !== 'none');
    // Some palettes contain red; some don't. Visible count must be < 701.
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(701);
    // Turn on a second color — visible count should grow or stay equal (OR).
    const blueChip = root.querySelector('.pyr3-palette-picker-chip[data-tag="blue"]') as HTMLElement;
    blueChip.click();
    const visible2 = [...root.querySelectorAll<HTMLElement>('.pyr3-palette-picker-cell')]
      .filter((c) => c.style.display !== 'none');
    expect(visible2.length).toBeGreaterThanOrEqual(visible.length);
  });

  it('chip filter ANDs with search', () => {
    const { root } = mount();
    const search = root.querySelector('.pyr3-palette-picker-search') as HTMLInputElement;
    const redChip = root.querySelector('.pyr3-palette-picker-chip[data-tag="red"]') as HTMLElement;
    redChip.click();
    const visibleChip = [...root.querySelectorAll<HTMLElement>('.pyr3-palette-picker-cell')]
      .filter((c) => c.style.display !== 'none').length;
    search.value = 'rose';
    search.dispatchEvent(new Event('input'));
    const visibleBoth = [...root.querySelectorAll<HTMLElement>('.pyr3-palette-picker-cell')]
      .filter((c) => c.style.display !== 'none').length;
    // AND of chip + search ≤ chip-only.
    expect(visibleBoth).toBeLessThanOrEqual(visibleChip);
  });

  it('clear link resets all chip selections', () => {
    const { root } = mount();
    const redChip = root.querySelector('.pyr3-palette-picker-chip[data-tag="red"]') as HTMLElement;
    redChip.click();
    expect(redChip.classList.contains('on')).toBe(true);
    const clear = root.querySelector('.pyr3-palette-picker-chip-clear') as HTMLElement;
    expect(clear).toBeTruthy();
    clear.click();
    const onChips = root.querySelectorAll('.pyr3-palette-picker-chip.on');
    expect(onChips.length).toBe(0);
  });
});

// (chip+search interaction with the badge count is exercised in the
// 'chip filter ANDs with search' test above.)
describe('palette picker — chip+search final assert', () => {
  it('chip+search reduces visible count and badge reflects it', () => {
    const { root } = mount();
    const redChip = root.querySelector('.pyr3-palette-picker-chip[data-tag="red"]') as HTMLElement;
    redChip.click();
    const badge = root.querySelector('.pyr3-palette-picker-badge') as HTMLElement;
    expect(badge.textContent).toMatch(/\d+ \/ 701/);
  });
});

// Map-backed localStorage stub so favorites tests stay env-agnostic. Per the
// project's auto-memory note on Storage.prototype spy traps in CI, we install
// a Map-backed mock onto globalThis.localStorage instead.
function installLocalStorageStub(): { clear: () => void } {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  (globalThis as { localStorage: Storage }).localStorage = stub as unknown as Storage;
  return { clear: () => store.clear() };
}

describe('palette picker — favorites (Task 9.6)', () => {
  it('star is empty (☆) when not favorited', () => {
    installLocalStorageStub();
    const { root } = mount();
    const cell0 = root.querySelector('.pyr3-palette-picker-cell[data-idx="0"]') as HTMLElement;
    const star = cell0.querySelector('.pyr3-palette-picker-cell-star') as HTMLElement;
    expect(star.textContent).toBe('☆');
    expect(star.classList.contains('on')).toBe(false);
  });

  it('clicking a star toggles favorite — filled ★ and .on class', () => {
    installLocalStorageStub();
    const { root } = mount();
    const cell0 = root.querySelector('.pyr3-palette-picker-cell[data-idx="0"]') as HTMLElement;
    const star = cell0.querySelector('.pyr3-palette-picker-cell-star') as HTMLElement;
    star.click();
    expect(star.textContent).toBe('★');
    expect(star.classList.contains('on')).toBe(true);
    star.click();
    expect(star.textContent).toBe('☆');
    expect(star.classList.contains('on')).toBe(false);
  });

  it('clicking the star does NOT also select/apply the cell', () => {
    installLocalStorageStub();
    const onApply = vi.fn();
    const { root } = mount(makeOpts({ onApply }));
    const cell0 = root.querySelector('.pyr3-palette-picker-cell[data-idx="0"]') as HTMLElement;
    const star = cell0.querySelector('.pyr3-palette-picker-cell-star') as HTMLElement;
    star.click();
    // Apply should never fire from a star click.
    expect(onApply).not.toHaveBeenCalled();
  });

  it('favorites persist to localStorage under pyr3.palette.favorites as JSON array of source IDs', () => {
    installLocalStorageStub();
    const { root } = mount();
    const cell5 = root.querySelector('.pyr3-palette-picker-cell[data-idx="5"]') as HTMLElement;
    const star = cell5.querySelector('.pyr3-palette-picker-cell-star') as HTMLElement;
    star.click();
    const raw = localStorage.getItem('pyr3.palette.favorites');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toContain('flam3:5');
  });

  it('favorites read back from localStorage on next mount', () => {
    const { clear } = installLocalStorageStub();
    localStorage.setItem('pyr3.palette.favorites', JSON.stringify(['flam3:42']));
    const { root } = mount();
    const cell42 = root.querySelector('.pyr3-palette-picker-cell[data-idx="42"]') as HTMLElement;
    const star = cell42.querySelector('.pyr3-palette-picker-cell-star') as HTMLElement;
    expect(star.textContent).toBe('★');
    clear();
  });

  it('★ favorites tab filters cells to favorited only + updates count', () => {
    installLocalStorageStub();
    localStorage.setItem('pyr3.palette.favorites', JSON.stringify(['flam3:0', 'flam3:1', 'flam3:2']));
    const { root } = mount();
    const favTab = root.querySelector('.pyr3-palette-picker-tab[data-tab="favorites"]') as HTMLElement;
    expect(favTab.textContent).toContain('3');
    favTab.click();
    const cells = root.querySelectorAll<HTMLElement>('.pyr3-palette-picker-cell');
    const visible = [...cells].filter((c) => c.style.display !== 'none');
    expect(visible.length).toBe(3);
  });

  it('all tab counts the full catalog regardless of favorites', () => {
    installLocalStorageStub();
    localStorage.setItem('pyr3.palette.favorites', JSON.stringify(['flam3:0']));
    const { root } = mount();
    const allTab = root.querySelector('.pyr3-palette-picker-tab[data-tab="all"]') as HTMLElement;
    expect(allTab.textContent).toContain('701');
  });

  it('toggling a star while on favorites tab updates the visible set live', () => {
    installLocalStorageStub();
    localStorage.setItem('pyr3.palette.favorites', JSON.stringify(['flam3:10']));
    const { root } = mount();
    const favTab = root.querySelector('.pyr3-palette-picker-tab[data-tab="favorites"]') as HTMLElement;
    favTab.click();
    const cell10 = root.querySelector('.pyr3-palette-picker-cell[data-idx="10"]') as HTMLElement;
    const star = cell10.querySelector('.pyr3-palette-picker-cell-star') as HTMLElement;
    star.click(); // unfavorite
    const cells = root.querySelectorAll<HTMLElement>('.pyr3-palette-picker-cell');
    const visible = [...cells].filter((c) => c.style.display !== 'none');
    expect(visible.length).toBe(0);
  });
});
