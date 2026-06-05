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
    // Format is `<visible> / 701` once filtered.
    expect(badge.textContent).toMatch(/\d+ \/ 701/);
  });
});
