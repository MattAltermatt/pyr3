import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Window } from 'happy-dom';
import {
  mountFilterDrawer,
  buildActiveChipStrip,
  buildSortRow,
  buildMetricRow,
  attachBrushSelect,
} from './gallery-filter-ui';
import { DEFAULT_FILTER_SPEC, type FilterSpec, type SortMode, type SortDir } from './gallery-filter';

function setupDom(): void {
  const w = new Window();
  // @ts-expect-error injecting happy-dom globals for tests
  globalThis.document = w.document;
  // @ts-expect-error
  globalThis.HTMLElement = w.HTMLElement;
  // @ts-expect-error
  globalThis.HTMLAnchorElement = w.HTMLAnchorElement;
  // @ts-expect-error
  globalThis.HTMLButtonElement = w.HTMLButtonElement;
  // @ts-expect-error
  globalThis.HTMLSelectElement = w.HTMLSelectElement;
  // @ts-expect-error
  globalThis.Event = w.Event;
  // @ts-expect-error
  globalThis.MouseEvent = w.MouseEvent;
  // @ts-expect-error
  globalThis.window = w;
}

function makeCounts() {
  return {
    variations: new Map<number, number>(),
    xforms: new Map<number, number>(),
    coverage: new Map<number, number>(),
    entropy: new Map<number, number>(),
    colorVar: new Map<number, number>(),
    meanLum: new Map<number, number>(),
    total: 0,
  };
}

beforeEach(() => {
  setupDom();
});

describe('mountFilterDrawer — scaffold + open/close + reset', () => {
  it('mounts hidden when initialFilter is default', () => {
    const root = document.createElement('div');
    const handle = mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const drawer = root.querySelector('.pyr3-filter-drawer');
    expect(drawer).toBeTruthy();
    expect(drawer?.classList.contains('open')).toBe(false);
    expect(handle.isOpen()).toBe(false);
    handle.destroy();
  });

  it('mounts open when initialFilter is non-default (any axis)', () => {
    const root = document.createElement('div');
    const handle = mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, sort: 'interest' },
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    expect(root.querySelector('.pyr3-filter-drawer')?.classList.contains('open')).toBe(true);
    expect(handle.isOpen()).toBe(true);
    handle.destroy();
  });

  it('toggleOpen flips the drawer between open and closed', () => {
    const root = document.createElement('div');
    const handle = mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    expect(handle.isOpen()).toBe(false);
    handle.toggleOpen();
    expect(handle.isOpen()).toBe(true);
    expect(root.querySelector('.pyr3-filter-drawer')?.classList.contains('open')).toBe(true);
    handle.toggleOpen();
    expect(handle.isOpen()).toBe(false);
    handle.destroy();
  });

  it('reset button fires onChange with DEFAULT_FILTER_SPEC', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, sort: 'interest', vars: [13] },
      facetCounts: makeCounts(),
      onChange,
    });
    const resetBtn = root.querySelector('.pyr3-filter-reset') as HTMLButtonElement;
    expect(resetBtn).toBeTruthy();
    resetBtn.click();
    expect(onChange).toHaveBeenCalledWith(DEFAULT_FILTER_SPEC);
  });

  it('setFilter from non-default to default does NOT auto-close (visitor stays in drawer)', () => {
    // The drawer's open/closed state belongs to the visitor — auto-closing
    // when state returns to default would slam the drawer shut mid-edit
    // (e.g. clicking the default `time` sort pill). The bar pill is the
    // close affordance; auto-OPEN on non-default still fires.
    const root = document.createElement('div');
    const handle = mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, sort: 'interest' },
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    expect(handle.isOpen()).toBe(true);
    handle.setFilter(DEFAULT_FILTER_SPEC);
    expect(handle.isOpen()).toBe(true);
    handle.destroy();
  });

  it('setFilter from default to non-default auto-opens the drawer', () => {
    const root = document.createElement('div');
    const handle = mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    expect(handle.isOpen()).toBe(false);
    handle.setFilter({ ...DEFAULT_FILTER_SPEC, sort: 'coverage' });
    expect(handle.isOpen()).toBe(true);
    handle.destroy();
  });

  it('destroy() clears the root', () => {
    const root = document.createElement('div');
    const handle = mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    expect(root.children.length).toBeGreaterThan(0);
    handle.destroy();
    expect(root.children.length).toBe(0);
  });
});

describe('mountFilterDrawer — sort pills (B3)', () => {
  const SORT_NAMES = ['time', 'interest', 'coverage', 'entropy', 'colorVar', 'meanLum'] as const;

  it('renders all 6 sort pills with a sort: label', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const pills = root.querySelectorAll('.pyr3-sort-pill');
    expect(pills.length).toBe(6);
    const dataSorts = Array.from(pills).map((p) => (p as HTMLElement).dataset.sort);
    expect(dataSorts).toEqual([...SORT_NAMES]);
    const labels = Array.from(pills).map((p) => p.textContent);
    expect(labels).toEqual([...SORT_NAMES]);
    expect(root.querySelector('.pyr3-filter-row.sort .pyr3-filter-row-label')?.textContent).toBe('sort:');
  });

  it('initialFilter.sort=time → time pill has .active', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const active = root.querySelectorAll('.pyr3-sort-pill.active');
    expect(active.length).toBe(1);
    expect((active[0] as HTMLElement).dataset.sort).toBe('time');
  });

  it('initialFilter.sort=coverage → coverage pill is .active', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, sort: 'coverage' },
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const active = root.querySelectorAll('.pyr3-sort-pill.active');
    expect(active.length).toBe(1);
    expect((active[0] as HTMLElement).dataset.sort).toBe('coverage');
  });

  it('clicking a non-active pill fires onChange with that sort', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange,
    });
    const entropyPill = root.querySelector('.pyr3-sort-pill[data-sort="entropy"]') as HTMLButtonElement;
    entropyPill.click();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ sort: 'entropy' });
  });

  it('clicking the already-active pill does NOT fire onChange', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange,
    });
    const timePill = root.querySelector('.pyr3-sort-pill[data-sort="time"]') as HTMLButtonElement;
    timePill.click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('setFilter updates which pill is .active', () => {
    const root = document.createElement('div');
    const handle = mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    handle.setFilter({ ...DEFAULT_FILTER_SPEC, sort: 'meanLum' });
    const active = root.querySelectorAll('.pyr3-sort-pill.active');
    expect(active.length).toBe(1);
    expect((active[0] as HTMLElement).dataset.sort).toBe('meanLum');
    handle.setFilter(DEFAULT_FILTER_SPEC);
    const active2 = root.querySelectorAll('.pyr3-sort-pill.active');
    expect(active2.length).toBe(1);
    expect((active2[0] as HTMLElement).dataset.sort).toBe('time');
  });
});

describe('mountFilterDrawer — xform pickers + count strip (B4)', () => {
  it('renders from select (1..15) and to select (all + 1..15)', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const from = root.querySelector('.pyr3-xform-from') as HTMLSelectElement;
    const to = root.querySelector('.pyr3-xform-to') as HTMLSelectElement;
    expect(from).toBeTruthy();
    expect(to).toBeTruthy();
    const fromOpts = Array.from(from.querySelectorAll('option')).map((o) => o.value);
    expect(fromOpts).toEqual(['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15']);
    const toOpts = Array.from(to.querySelectorAll('option')).map((o) => o.value);
    expect(toOpts).toEqual(['all','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15']);
  });

  it('count strip has 14 cells labelled 1..13 and 14+', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const cells = root.querySelectorAll('.pyr3-xform-cell');
    expect(cells.length).toBe(14);
    expect((cells[0] as HTMLElement).dataset.bucket).toBe('1');
    expect((cells[13] as HTMLElement).dataset.bucket).toBe('14');
    expect(cells[0]?.textContent).toContain('1 (');
    expect(cells[12]?.textContent).toContain('13 (');
    expect(cells[13]?.textContent).toContain('14+ (');
  });

  it('picker values reflect currentFilter (xformMin=3, xformMax=null → to=all)', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, xformMin: 3 },
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const from = root.querySelector('.pyr3-xform-from') as HTMLSelectElement;
    const to = root.querySelector('.pyr3-xform-to') as HTMLSelectElement;
    expect(from.value).toBe('3');
    expect(to.value).toBe('all');
  });

  it('picker values reflect currentFilter (xformMax numeric)', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, xformMin: 2, xformMax: 7 },
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const to = root.querySelector('.pyr3-xform-to') as HTMLSelectElement;
    expect(to.value).toBe('7');
  });

  it('active range highlight: xformMin=3 xformMax=5 → cells 3..5 .active', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, xformMin: 3, xformMax: 5 },
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const cells = root.querySelectorAll('.pyr3-xform-cell');
    const activeBuckets = Array.from(cells)
      .filter((c) => c.classList.contains('active'))
      .map((c) => (c as HTMLElement).dataset.bucket);
    expect(activeBuckets).toEqual(['3', '4', '5']);
  });

  it('empty highlight: cells with count 0 get .empty; non-zero do not', () => {
    const root = document.createElement('div');
    const counts = makeCounts();
    counts.xforms.set(2, 17);
    counts.xforms.set(5, 4);
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: counts,
      onChange: vi.fn(),
    });
    const cells = root.querySelectorAll('.pyr3-xform-cell');
    const cell2 = cells[1] as HTMLElement; // bucket=2
    const cell5 = cells[4] as HTMLElement; // bucket=5
    const cell9 = cells[8] as HTMLElement; // bucket=9 (count=0)
    expect(cell2.classList.contains('empty')).toBe(false);
    expect(cell5.classList.contains('empty')).toBe(false);
    expect(cell9.classList.contains('empty')).toBe(true);
  });

  it('changing the from picker fires onChange with new xformMin', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange,
    });
    const from = root.querySelector('.pyr3-xform-from') as HTMLSelectElement;
    from.value = '4';
    from.dispatchEvent(new (globalThis as any).Event('change'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ xformMin: 4, xformMax: null });
  });

  it('changing the to picker to all fires onChange with xformMax=null', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, xformMin: 2, xformMax: 7 },
      facetCounts: makeCounts(),
      onChange,
    });
    const to = root.querySelector('.pyr3-xform-to') as HTMLSelectElement;
    to.value = 'all';
    to.dispatchEvent(new (globalThis as any).Event('change'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ xformMin: 2, xformMax: null });
  });

  it('changing the to picker to a number fires onChange with that xformMax', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange,
    });
    const to = root.querySelector('.pyr3-xform-to') as HTMLSelectElement;
    to.value = '6';
    to.dispatchEvent(new (globalThis as any).Event('change'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ xformMin: 1, xformMax: 6 });
  });

  it('auto-clamp: setting from=8 when to=5 bumps to up to 8', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, xformMin: 1, xformMax: 5 },
      facetCounts: makeCounts(),
      onChange,
    });
    const from = root.querySelector('.pyr3-xform-from') as HTMLSelectElement;
    from.value = '8';
    from.dispatchEvent(new (globalThis as any).Event('change'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ xformMin: 8, xformMax: 8 }));
  });

  it('auto-clamp other direction: setting to=3 when from=7 pulls from down to 3', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, xformMin: 7, xformMax: null },
      facetCounts: makeCounts(),
      onChange,
    });
    const to = root.querySelector('.pyr3-xform-to') as HTMLSelectElement;
    to.value = '3';
    to.dispatchEvent(new (globalThis as any).Event('change'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ xformMin: 3, xformMax: 3 }));
  });

  it('setFilter updates picker values + active highlight', () => {
    const root = document.createElement('div');
    const handle = mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    handle.setFilter({ ...DEFAULT_FILTER_SPEC, xformMin: 4, xformMax: 6 });
    const from = root.querySelector('.pyr3-xform-from') as HTMLSelectElement;
    const to = root.querySelector('.pyr3-xform-to') as HTMLSelectElement;
    expect(from.value).toBe('4');
    expect(to.value).toBe('6');
    const activeBuckets = Array.from(root.querySelectorAll('.pyr3-xform-cell.active'))
      .map((c) => (c as HTMLElement).dataset.bucket);
    expect(activeBuckets).toEqual(['4', '5', '6']);
  });

  it('setFacetCounts updates the strip count + empty highlight', () => {
    const root = document.createElement('div');
    const handle = mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const cells = root.querySelectorAll('.pyr3-xform-cell');
    expect((cells[2] as HTMLElement).classList.contains('empty')).toBe(true);
    const nextCounts = makeCounts();
    nextCounts.xforms.set(3, 42);
    handle.setFacetCounts(nextCounts);
    expect(cells[2]?.textContent).toContain('3 (42)');
    expect((cells[2] as HTMLElement).classList.contains('empty')).toBe(false);
  });
});

describe.each(['coverage', 'entropy', 'colorVar', 'meanLum'] as const)(
  'mountFilterDrawer — stat-range row (%s) (C4)',
  (stat) => {
    const minKey = `${stat}Min` as const;
    const maxKey = `${stat}Max` as const;

    function rowSel(s: string) {
      return `.pyr3-filter-row.stat.${stat} ${s}`;
    }
    function cellsFor(root: HTMLElement) {
      return root.querySelectorAll(`.pyr3-stat-count-strip[data-stat="${stat}"] .pyr3-stat-cell`);
    }

    it('mounts label + from select (0.0..1.0) + to select (all + 0.0..1.0) + 10 count cells', () => {
      const root = document.createElement('div');
      mountFilterDrawer(root, {
        initialFilter: DEFAULT_FILTER_SPEC,
        facetCounts: makeCounts(),
        onChange: vi.fn(),
      });
      const label = root.querySelector(`.pyr3-filter-row.stat.${stat} .pyr3-filter-row-label`);
      expect(label?.textContent).toBe(`${stat}:`);
      const from = root.querySelector(rowSel(`.pyr3-stat-from[data-stat="${stat}"]`)) as HTMLSelectElement;
      const to = root.querySelector(rowSel(`.pyr3-stat-to[data-stat="${stat}"]`)) as HTMLSelectElement;
      expect(from).toBeTruthy();
      expect(to).toBeTruthy();
      const fromOpts = Array.from(from.querySelectorAll('option')).map((o) => o.value);
      expect(fromOpts).toEqual(['0.0','0.1','0.2','0.3','0.4','0.5','0.6','0.7','0.8','0.9','1.0']);
      const toOpts = Array.from(to.querySelectorAll('option')).map((o) => o.value);
      expect(toOpts).toEqual(['all','0.0','0.1','0.2','0.3','0.4','0.5','0.6','0.7','0.8','0.9','1.0']);
      const cells = cellsFor(root);
      expect(cells.length).toBe(10);
      expect((cells[0] as HTMLElement).dataset.bucket).toBe('0');
      expect((cells[9] as HTMLElement).dataset.bucket).toBe('9');
      expect(cells[0]?.textContent).toContain('0.0-0.1');
      expect(cells[9]?.textContent).toContain('0.9-1.0');
    });

    it('default filter → from=0.0, to=all', () => {
      const root = document.createElement('div');
      mountFilterDrawer(root, {
        initialFilter: DEFAULT_FILTER_SPEC,
        facetCounts: makeCounts(),
        onChange: vi.fn(),
      });
      const from = root.querySelector(`.pyr3-stat-from[data-stat="${stat}"]`) as HTMLSelectElement;
      const to = root.querySelector(`.pyr3-stat-to[data-stat="${stat}"]`) as HTMLSelectElement;
      expect(from.value).toBe('0.0');
      expect(to.value).toBe('all');
    });

    it('active range highlight: min=0.3 max=0.7 → cells 3,4,5,6 .active', () => {
      const root = document.createElement('div');
      mountFilterDrawer(root, {
        initialFilter: { ...DEFAULT_FILTER_SPEC, [minKey]: 0.3, [maxKey]: 0.7 },
        facetCounts: makeCounts(),
        onChange: vi.fn(),
      });
      const cells = cellsFor(root);
      const activeBuckets = Array.from(cells)
        .filter((c) => c.classList.contains('active'))
        .map((c) => (c as HTMLElement).dataset.bucket);
      expect(activeBuckets).toEqual(['3', '4', '5', '6']);
    });

    it('empty highlight: cells with count 0 get .empty; non-zero do not', () => {
      const root = document.createElement('div');
      const counts = makeCounts();
      counts[stat].set(2, 17);
      counts[stat].set(5, 4);
      mountFilterDrawer(root, {
        initialFilter: DEFAULT_FILTER_SPEC,
        facetCounts: counts,
        onChange: vi.fn(),
      });
      const cells = cellsFor(root);
      expect((cells[2] as HTMLElement).classList.contains('empty')).toBe(false);
      expect((cells[5] as HTMLElement).classList.contains('empty')).toBe(false);
      expect((cells[7] as HTMLElement).classList.contains('empty')).toBe(true);
    });

    it('changing from picker fires onChange with new min', () => {
      const root = document.createElement('div');
      const onChange = vi.fn();
      mountFilterDrawer(root, {
        initialFilter: DEFAULT_FILTER_SPEC,
        facetCounts: makeCounts(),
        onChange,
      });
      const from = root.querySelector(`.pyr3-stat-from[data-stat="${stat}"]`) as HTMLSelectElement;
      from.value = '0.4';
      from.dispatchEvent(new (globalThis as any).Event('change'));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0]?.[0]).toMatchObject({ [minKey]: 0.4, [maxKey]: null });
    });

    it('changing to picker to all fires onChange with max=null', () => {
      const root = document.createElement('div');
      const onChange = vi.fn();
      mountFilterDrawer(root, {
        initialFilter: { ...DEFAULT_FILTER_SPEC, [minKey]: 0.2, [maxKey]: 0.6 },
        facetCounts: makeCounts(),
        onChange,
      });
      const to = root.querySelector(`.pyr3-stat-to[data-stat="${stat}"]`) as HTMLSelectElement;
      to.value = 'all';
      to.dispatchEvent(new (globalThis as any).Event('change'));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0]?.[0]).toMatchObject({ [minKey]: 0.2, [maxKey]: null });
    });

    it('auto-clamp: setting from=0.8 when to=0.5 bumps to up to 0.8', () => {
      const root = document.createElement('div');
      const onChange = vi.fn();
      mountFilterDrawer(root, {
        initialFilter: { ...DEFAULT_FILTER_SPEC, [minKey]: 0.1, [maxKey]: 0.5 },
        facetCounts: makeCounts(),
        onChange,
      });
      const from = root.querySelector(`.pyr3-stat-from[data-stat="${stat}"]`) as HTMLSelectElement;
      from.value = '0.8';
      from.dispatchEvent(new (globalThis as any).Event('change'));
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ [minKey]: 0.8, [maxKey]: 0.8 }));
    });

    it('auto-clamp other direction: setting to=0.3 when from=0.7 pulls from down to 0.3', () => {
      const root = document.createElement('div');
      const onChange = vi.fn();
      mountFilterDrawer(root, {
        initialFilter: { ...DEFAULT_FILTER_SPEC, [minKey]: 0.7, [maxKey]: null },
        facetCounts: makeCounts(),
        onChange,
      });
      const to = root.querySelector(`.pyr3-stat-to[data-stat="${stat}"]`) as HTMLSelectElement;
      to.value = '0.3';
      to.dispatchEvent(new (globalThis as any).Event('change'));
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ [minKey]: 0.3, [maxKey]: 0.3 }));
    });

    it('setFilter updates picker values + active highlight', () => {
      const root = document.createElement('div');
      const handle = mountFilterDrawer(root, {
        initialFilter: DEFAULT_FILTER_SPEC,
        facetCounts: makeCounts(),
        onChange: vi.fn(),
      });
      handle.setFilter({ ...DEFAULT_FILTER_SPEC, [minKey]: 0.4, [maxKey]: 0.7 });
      const from = root.querySelector(`.pyr3-stat-from[data-stat="${stat}"]`) as HTMLSelectElement;
      const to = root.querySelector(`.pyr3-stat-to[data-stat="${stat}"]`) as HTMLSelectElement;
      expect(from.value).toBe('0.4');
      expect(to.value).toBe('0.7');
      const activeBuckets = Array.from(cellsFor(root))
        .filter((c) => c.classList.contains('active'))
        .map((c) => (c as HTMLElement).dataset.bucket);
      expect(activeBuckets).toEqual(['4', '5', '6']);
    });

    it('setFacetCounts updates the strip', () => {
      const root = document.createElement('div');
      const handle = mountFilterDrawer(root, {
        initialFilter: DEFAULT_FILTER_SPEC,
        facetCounts: makeCounts(),
        onChange: vi.fn(),
      });
      const cells = cellsFor(root);
      expect((cells[3] as HTMLElement).classList.contains('empty')).toBe(true);
      const nextCounts = makeCounts();
      nextCounts[stat].set(3, 42);
      handle.setFacetCounts(nextCounts);
      expect(cells[3]?.textContent).toContain('(42)');
      expect((cells[3] as HTMLElement).classList.contains('empty')).toBe(false);
    });
  },
);

describe('mountFilterDrawer — loading state', () => {
  it('renders the loading banner when loading=true', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
      loading: true,
    });
    const drawer = root.querySelector('.pyr3-filter-drawer');
    expect(drawer?.classList.contains('loading')).toBe(true);
    const banner = root.querySelector('.pyr3-filter-loading-banner');
    expect(banner).toBeTruthy();
  });

  it('setLoading(false) clears the loading class', () => {
    const root = document.createElement('div');
    const handle = mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
      loading: true,
    });
    const drawer = root.querySelector('.pyr3-filter-drawer');
    expect(drawer?.classList.contains('loading')).toBe(true);
    handle.setLoading(false);
    expect(drawer?.classList.contains('loading')).toBe(false);
  });
});

describe('buildActiveChipStrip (Task 5.2) — active-filter chips with one-click remove', () => {
  it('renders one chip per active filter axis, in stable axis order', () => {
    const spec: FilterSpec = {
      ...DEFAULT_FILTER_SPEC,
      vars: [0],
      coverageMin: 0.3,
      coverageMax: 0.7,
      colorVarMin: 0.2,
      colorVarMax: null,
    };
    const onRemove = vi.fn();
    const onClearAll = vi.fn();
    const strip = buildActiveChipStrip(spec, onRemove, onClearAll);
    const chips = strip.querySelectorAll('.pyr3-active-chip');
    expect(chips.length).toBe(3);
    // Stable order: vars → xforms → coverage → entropy → colorVar → meanLum.
    const ids = Array.from(chips).map((c) => (c as HTMLElement).dataset.chipId);
    expect(ids).toEqual(['vars:0', 'coverage', 'colorVar']);
  });

  it('renders no chips when spec is default (all-default → empty)', () => {
    const strip = buildActiveChipStrip(DEFAULT_FILTER_SPEC, vi.fn(), vi.fn());
    expect(strip.querySelectorAll('.pyr3-active-chip').length).toBe(0);
  });

  it('chip label uses plain-english name + active range', () => {
    const spec: FilterSpec = {
      ...DEFAULT_FILTER_SPEC,
      colorVarMin: 0.3,
      colorVarMax: 0.7,
    };
    const strip = buildActiveChipStrip(spec, vi.fn(), vi.fn());
    const chip = strip.querySelector('.pyr3-active-chip') as HTMLElement;
    expect(chip.textContent).toContain('color variation');
    expect(chip.textContent).toContain('0.3');
    expect(chip.textContent).toContain('0.7');
  });

  it('open-ended ranges render with the unbounded edge as ≥ or ≤', () => {
    const lower: FilterSpec = { ...DEFAULT_FILTER_SPEC, coverageMin: 0.5 };
    const upperOnly: FilterSpec = { ...DEFAULT_FILTER_SPEC, entropyMin: 0, entropyMax: 0.4 };
    const lowerChip = buildActiveChipStrip(lower, vi.fn(), vi.fn()).querySelector('.pyr3-active-chip')!;
    expect(lowerChip.textContent).toContain('≥');
    expect(lowerChip.textContent).toContain('0.5');
    const upperChip = buildActiveChipStrip(upperOnly, vi.fn(), vi.fn()).querySelector('.pyr3-active-chip')!;
    expect(upperChip.textContent).toContain('≤');
    expect(upperChip.textContent).toContain('0.4');
  });

  it('xforms chip uses xform-count label + value/range', () => {
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, xformMin: 3, xformMax: 5 };
    const chip = buildActiveChipStrip(spec, vi.fn(), vi.fn()).querySelector('.pyr3-active-chip')!;
    expect(chip.textContent).toContain('xform count');
    expect(chip.textContent).toContain('3');
    expect(chip.textContent).toContain('5');
  });

  it("clicking a chip's × button invokes onRemove with the filter id", () => {
    const spec: FilterSpec = {
      ...DEFAULT_FILTER_SPEC,
      coverageMin: 0.3,
      coverageMax: 0.7,
    };
    const onRemove = vi.fn();
    const strip = buildActiveChipStrip(spec, onRemove, vi.fn());
    const x = strip.querySelector('.pyr3-active-chip-x') as HTMLElement;
    x.click();
    expect(onRemove).toHaveBeenCalledWith('coverage');
  });

  it('vars chips each remove themselves individually by id', () => {
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, vars: [0, 13] };
    const onRemove = vi.fn();
    const strip = buildActiveChipStrip(spec, onRemove, vi.fn());
    const chips = strip.querySelectorAll('.pyr3-active-chip');
    expect(chips.length).toBe(2);
    (chips[1]!.querySelector('.pyr3-active-chip-x') as HTMLElement).click();
    expect(onRemove).toHaveBeenCalledWith('vars:13');
  });

  it('clear-all link is present when any filter is active and fires onClearAll', () => {
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, coverageMin: 0.4 };
    const onClearAll = vi.fn();
    const strip = buildActiveChipStrip(spec, vi.fn(), onClearAll);
    const clearAll = strip.querySelector('.pyr3-active-chip-clear-all') as HTMLElement;
    expect(clearAll).toBeTruthy();
    expect(clearAll.textContent).toContain('clear all');
    clearAll.click();
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('clear-all link is absent when no filters are active', () => {
    const strip = buildActiveChipStrip(DEFAULT_FILTER_SPEC, vi.fn(), vi.fn());
    expect(strip.querySelector('.pyr3-active-chip-clear-all')).toBeFalsy();
  });
});

describe('buildSortRow (Task 5.3) — sort dropdown + direction toggle', () => {
  const NAMED_SORTS = ['time', 'interest', 'coverage', 'entropy', 'colorVar', 'meanLum'] as const;

  it('renders a "sort" label, a dropdown of the named sort modes, and a direction toggle', () => {
    const row = buildSortRow(DEFAULT_FILTER_SPEC, vi.fn(), vi.fn());
    expect(row.querySelector('.pyr3-sort-row-label')?.textContent).toBe('sort');
    const select = row.querySelector('select.pyr3-sort-select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual([...NAMED_SORTS]);
    expect(row.querySelector('.pyr3-sort-dir-btn')).toBeTruthy();
  });

  it('dropdown excludes "custom" (it is a UI-only mode toggled by the tune panel)', () => {
    const row = buildSortRow(DEFAULT_FILTER_SPEC, vi.fn(), vi.fn());
    const select = row.querySelector('select.pyr3-sort-select') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).not.toContain('custom');
  });

  it('dropdown reflects the current sort and direction toggle reflects the current dir', () => {
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, sort: 'interest', sortDir: 'asc' };
    const row = buildSortRow(spec, vi.fn(), vi.fn());
    const select = row.querySelector('select.pyr3-sort-select') as HTMLSelectElement;
    expect(select.value).toBe('interest');
    const dirBtn = row.querySelector('.pyr3-sort-dir-btn') as HTMLButtonElement;
    expect(dirBtn.textContent).toContain('asc');
    expect(dirBtn.textContent).toContain('↑');
  });

  it('changing the dropdown invokes onSortChange with the new key', () => {
    const onSortChange = vi.fn<(s: SortMode) => void>();
    const row = buildSortRow(DEFAULT_FILTER_SPEC, onSortChange, vi.fn());
    const select = row.querySelector('select.pyr3-sort-select') as HTMLSelectElement;
    select.value = 'coverage';
    select.dispatchEvent(new Event('change'));
    expect(onSortChange).toHaveBeenCalledWith('coverage');
  });

  it('clicking the direction toggle flips desc→asc and invokes onDirChange with the new dir', () => {
    const onDirChange = vi.fn<(d: SortDir) => void>();
    const specDesc: FilterSpec = { ...DEFAULT_FILTER_SPEC, sortDir: 'desc' };
    const row = buildSortRow(specDesc, vi.fn(), onDirChange);
    (row.querySelector('.pyr3-sort-dir-btn') as HTMLButtonElement).click();
    expect(onDirChange).toHaveBeenCalledWith('asc');
  });

  it('clicking the direction toggle flips asc→desc', () => {
    const onDirChange = vi.fn<(d: SortDir) => void>();
    const specAsc: FilterSpec = { ...DEFAULT_FILTER_SPEC, sortDir: 'asc' };
    const row = buildSortRow(specAsc, vi.fn(), onDirChange);
    (row.querySelector('.pyr3-sort-dir-btn') as HTMLButtonElement).click();
    expect(onDirChange).toHaveBeenCalledWith('desc');
  });

  it('direction toggle shows "↓ desc" when sortDir is desc', () => {
    const row = buildSortRow(DEFAULT_FILTER_SPEC, vi.fn(), vi.fn());
    const dirBtn = row.querySelector('.pyr3-sort-dir-btn') as HTMLButtonElement;
    expect(dirBtn.textContent).toContain('↓');
    expect(dirBtn.textContent).toContain('desc');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Task 5.4 — Collapsible metric rows with histogram
// ──────────────────────────────────────────────────────────────────────────

describe('buildMetricRow (Task 5.4) — collapsible metric row with histogram', () => {
  function makeBuckets(values: number[]): Map<number, number> {
    const m = new Map<number, number>();
    for (let i = 0; i < values.length; i++) m.set(i, values[i]!);
    return m;
  }

  it('renders header with chevron, label, and current range value', () => {
    const row = buildMetricRow({
      metric: 'colorVar',
      label: 'color variation',
      min: 0.3,
      max: 0.7,
      counts: makeBuckets([1, 2, 3, 4, 5, 6, 5, 4, 3, 2]),
      onRange: vi.fn(),
    });
    const header = row.querySelector('.pyr3-metric-header') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.textContent).toContain('color variation');
    expect(header.textContent).toContain('0.3');
    expect(header.textContent).toContain('0.7');
  });

  it('collapsed by default — only header shown, chevron is ▸, body hidden', () => {
    const row = buildMetricRow({
      metric: 'coverage',
      label: 'coverage',
      min: 0,
      max: null,
      counts: makeBuckets([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      onRange: vi.fn(),
    });
    const chevron = row.querySelector('.pyr3-metric-chevron') as HTMLElement;
    expect(chevron.textContent).toContain('▸');
    const body = row.querySelector('.pyr3-metric-body') as HTMLElement;
    expect(body).toBeTruthy();
    expect(body.style.display).toBe('none');
  });

  it('shows "all" instead of a range when both bounds are at default (min=0, max=null)', () => {
    const row = buildMetricRow({
      metric: 'entropy',
      label: 'complexity',
      min: 0,
      max: null,
      counts: makeBuckets([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
      onRange: vi.fn(),
    });
    const value = row.querySelector('.pyr3-metric-value') as HTMLElement;
    expect(value.textContent).toBe('all');
  });

  it('clicking the chevron expands the row — body becomes visible, chevron flips to ▾', () => {
    const row = buildMetricRow({
      metric: 'colorVar',
      label: 'color variation',
      min: 0.2,
      max: 0.6,
      counts: makeBuckets([0, 1, 2, 3, 4, 5, 4, 3, 2, 1]),
      onRange: vi.fn(),
    });
    const header = row.querySelector('.pyr3-metric-header') as HTMLElement;
    header.click();
    const chevron = row.querySelector('.pyr3-metric-chevron') as HTMLElement;
    expect(chevron.textContent).toContain('▾');
    const body = row.querySelector('.pyr3-metric-body') as HTMLElement;
    expect(body.style.display).toBe('block');
  });

  it('clicking the chevron a second time collapses again', () => {
    const row = buildMetricRow({
      metric: 'meanLum',
      label: 'brightness',
      min: 0.1,
      max: 0.5,
      counts: makeBuckets([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]),
      onRange: vi.fn(),
    });
    const header = row.querySelector('.pyr3-metric-header') as HTMLElement;
    header.click();  // expand
    header.click();  // collapse
    const body = row.querySelector('.pyr3-metric-body') as HTMLElement;
    expect(body.style.display).toBe('none');
    const chevron = row.querySelector('.pyr3-metric-chevron') as HTMLElement;
    expect(chevron.textContent).toContain('▸');
  });

  it('expanded body has a histogram with exactly 10 bucket bars', () => {
    const row = buildMetricRow({
      metric: 'coverage',
      label: 'coverage',
      min: 0,
      max: null,
      counts: makeBuckets([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      onRange: vi.fn(),
      initiallyExpanded: true,
    });
    const bars = row.querySelectorAll('.pyr3-metric-bar');
    expect(bars).toHaveLength(10);
  });

  it('bars within the current range carry an .in-range class, others do not', () => {
    // min=0.3, max=0.7 → buckets 3..6 in-range (max=0.7 is exclusive upper
    // edge in the bucket-strip convention used by the existing stat rows;
    // see Math.ceil(max*10)-1 in mountStatRow's renderStrip).
    const row = buildMetricRow({
      metric: 'colorVar',
      label: 'color variation',
      min: 0.3,
      max: 0.7,
      counts: makeBuckets([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
      onRange: vi.fn(),
      initiallyExpanded: true,
    });
    const bars = Array.from(row.querySelectorAll('.pyr3-metric-bar')) as HTMLElement[];
    expect(bars[0]!.classList.contains('in-range')).toBe(false);
    expect(bars[2]!.classList.contains('in-range')).toBe(false);
    expect(bars[3]!.classList.contains('in-range')).toBe(true);
    expect(bars[5]!.classList.contains('in-range')).toBe(true);
    expect(bars[6]!.classList.contains('in-range')).toBe(true);
    expect(bars[7]!.classList.contains('in-range')).toBe(false);
  });

  it('max=null treats every bucket above min as in-range (no upper cap)', () => {
    const row = buildMetricRow({
      metric: 'entropy',
      label: 'complexity',
      min: 0.4,
      max: null,
      counts: makeBuckets([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
      onRange: vi.fn(),
      initiallyExpanded: true,
    });
    const bars = Array.from(row.querySelectorAll('.pyr3-metric-bar')) as HTMLElement[];
    expect(bars[3]!.classList.contains('in-range')).toBe(false);
    expect(bars[4]!.classList.contains('in-range')).toBe(true);
    expect(bars[9]!.classList.contains('in-range')).toBe(true);
  });

  it('bar heights are proportional to bucket counts (max bucket → full height)', () => {
    const row = buildMetricRow({
      metric: 'coverage',
      label: 'coverage',
      min: 0,
      max: null,
      // Bucket 5 has 100; others 50 → bar 5 should be twice the height of others.
      counts: makeBuckets([50, 50, 50, 50, 50, 100, 50, 50, 50, 50]),
      onRange: vi.fn(),
      initiallyExpanded: true,
    });
    const bars = Array.from(row.querySelectorAll('.pyr3-metric-bar')) as HTMLElement[];
    // height stored as a percentage string like "100%" or "50%"
    expect(bars[5]!.style.height).toBe('100%');
    expect(bars[0]!.style.height).toBe('50%');
  });

  it('handles empty histogram (all zero counts) without divide-by-zero — bar heights collapse to 0', () => {
    const row = buildMetricRow({
      metric: 'colorVar',
      label: 'color variation',
      min: 0,
      max: null,
      counts: makeBuckets([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      onRange: vi.fn(),
      initiallyExpanded: true,
    });
    const bars = Array.from(row.querySelectorAll('.pyr3-metric-bar')) as HTMLElement[];
    for (const bar of bars) {
      // Either 0% or a small minimum — must not be NaN%/Infinity%.
      expect(bar.style.height.endsWith('%')).toBe(true);
      expect(bar.style.height).not.toContain('NaN');
      expect(bar.style.height).not.toContain('Infinity');
    }
  });

  it('renders edge brackets at the start + end of the current range', () => {
    const row = buildMetricRow({
      metric: 'colorVar',
      label: 'color variation',
      min: 0.3,
      max: 0.7,
      counts: makeBuckets([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
      onRange: vi.fn(),
      initiallyExpanded: true,
    });
    const brackets = row.querySelectorAll('.pyr3-metric-bracket');
    expect(brackets.length).toBe(2);
  });

  it('expanded body shows the readable range readout when a range is set', () => {
    const row = buildMetricRow({
      metric: 'coverage',
      label: 'coverage',
      min: 0.2,
      max: 0.8,
      counts: makeBuckets([1, 2, 3, 4, 5, 4, 3, 2, 1, 0]),
      onRange: vi.fn(),
      initiallyExpanded: true,
    });
    const readout = row.querySelector('.pyr3-metric-readout') as HTMLElement;
    expect(readout).toBeTruthy();
    expect(readout.textContent).toContain('0.2');
    expect(readout.textContent).toContain('0.8');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Task 5.5 — Brush-select drag gesture on the histogram
// ──────────────────────────────────────────────────────────────────────────

describe('attachBrushSelect (Task 5.5) — drag a bucket range across the histogram', () => {
  /**
   * Build a histogram element with 10 buckets sized 50px × 100px each so
   * that bucket.getBoundingClientRect() gives stable, predictable x-coords
   * — bucket N has center x ≈ (N + 0.5) × 50. happy-dom returns rect dims
   * directly from inline styles in lieu of layout.
   */
  function makeFakeHistogram(): { histogram: HTMLElement; bars: HTMLElement[] } {
    const histogram = document.createElement('div');
    histogram.className = 'pyr3-metric-histogram';
    histogram.style.position = 'relative';
    histogram.style.display = 'flex';
    histogram.style.width = '500px';
    histogram.style.height = '60px';
    const bars: HTMLElement[] = [];
    for (let i = 0; i < 10; i++) {
      const bar = document.createElement('div');
      bar.className = 'pyr3-metric-bar';
      bar.dataset.bucket = String(i);
      bar.style.width = '50px';
      bar.style.height = '60px';
      // happy-dom doesn't do real layout — stub getBoundingClientRect so
      // the brush handler's pixel-→-bucket math has stable input.
      const left = i * 50;
      bar.getBoundingClientRect = () =>
        ({ left, top: 0, right: left + 50, bottom: 60, width: 50, height: 60, x: left, y: 0, toJSON() { return {}; } }) as DOMRect;
      Object.defineProperty(bar, 'offsetWidth', { value: 50, configurable: true });
      bars.push(bar);
      histogram.appendChild(bar);
    }
    // Also stub the container so clientWidth-based math (the bucketAt
    // fallback) works deterministically.
    Object.defineProperty(histogram, 'clientWidth', { value: 500, configurable: true });
    histogram.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 500, bottom: 60, width: 500, height: 60, x: 0, y: 0, toJSON() { return {}; } }) as DOMRect;
    document.body.appendChild(histogram);
    return { histogram, bars };
  }

  function centerOf(bar: HTMLElement): number {
    const rect = bar.getBoundingClientRect();
    return rect.left + rect.width / 2;
  }

  it('mousedown on bucket 3 + mousemove to bucket 7 + mouseup → onRange(0.3, 0.7)', () => {
    const { histogram, bars } = makeFakeHistogram();
    const onRange = vi.fn();
    attachBrushSelect(histogram, onRange);

    bars[3]!.dispatchEvent(new MouseEvent('mousedown', {
      clientX: centerOf(bars[3]!), clientY: 30, bubbles: true,
    }));
    document.dispatchEvent(new MouseEvent('mousemove', {
      clientX: centerOf(bars[7]!), clientY: 30, bubbles: true,
    }));
    document.dispatchEvent(new MouseEvent('mouseup', {
      clientX: centerOf(bars[7]!), clientY: 30, bubbles: true,
    }));

    expect(onRange).toHaveBeenCalled();
    const last = onRange.mock.calls.at(-1)!;
    expect(last[0]).toBeCloseTo(0.3, 5);
    // Upper bound — bucket 7 means [0.7, 0.8) coverage so the emitted max
    // is 0.8 (exclusive upper-edge convention matching mountStatRow).
    expect(last[1]).toBeCloseTo(0.8, 5);
  });

  it('reverse drag — mousedown bucket 7 → move to bucket 3 → mouseup still emits onRange(0.3, 0.8)', () => {
    const { histogram, bars } = makeFakeHistogram();
    const onRange = vi.fn();
    attachBrushSelect(histogram, onRange);

    bars[7]!.dispatchEvent(new MouseEvent('mousedown', {
      clientX: centerOf(bars[7]!), clientY: 30, bubbles: true,
    }));
    document.dispatchEvent(new MouseEvent('mousemove', {
      clientX: centerOf(bars[3]!), clientY: 30, bubbles: true,
    }));
    document.dispatchEvent(new MouseEvent('mouseup', {
      clientX: centerOf(bars[3]!), clientY: 30, bubbles: true,
    }));

    expect(onRange).toHaveBeenCalled();
    const last = onRange.mock.calls.at(-1)!;
    expect(last[0]).toBeCloseTo(0.3, 5);
    expect(last[1]).toBeCloseTo(0.8, 5);
  });

  it('mousedown outside the histogram does NOT fire onRange', () => {
    const { histogram } = makeFakeHistogram();
    const onRange = vi.fn();
    attachBrushSelect(histogram, onRange);

    const stray = document.createElement('div');
    document.body.appendChild(stray);
    stray.dispatchEvent(new MouseEvent('mousedown', {
      clientX: 0, clientY: 0, bubbles: true,
    }));
    document.dispatchEvent(new MouseEvent('mousemove', {
      clientX: 100, clientY: 0, bubbles: true,
    }));
    document.dispatchEvent(new MouseEvent('mouseup', {
      clientX: 100, clientY: 0, bubbles: true,
    }));

    expect(onRange).not.toHaveBeenCalled();
  });

  it('mid-drag, in-progress range visually highlights bars within the drag span', () => {
    const { histogram, bars } = makeFakeHistogram();
    attachBrushSelect(histogram, vi.fn());

    bars[2]!.dispatchEvent(new MouseEvent('mousedown', {
      clientX: centerOf(bars[2]!), clientY: 30, bubbles: true,
    }));
    document.dispatchEvent(new MouseEvent('mousemove', {
      clientX: centerOf(bars[5]!), clientY: 30, bubbles: true,
    }));

    // Bars 2..5 should now be in-range; 0, 1, 6..9 should not.
    expect(bars[0]!.classList.contains('in-range')).toBe(false);
    expect(bars[1]!.classList.contains('in-range')).toBe(false);
    expect(bars[2]!.classList.contains('in-range')).toBe(true);
    expect(bars[4]!.classList.contains('in-range')).toBe(true);
    expect(bars[5]!.classList.contains('in-range')).toBe(true);
    expect(bars[6]!.classList.contains('in-range')).toBe(false);

    // Cleanup so listeners detach.
    document.dispatchEvent(new MouseEvent('mouseup', {
      clientX: centerOf(bars[5]!), clientY: 30, bubbles: true,
    }));
  });

  it('histogram exposes a hover-tooltip element ("click & drag to select range")', () => {
    // The tooltip is wired by buildMetricRow alongside attachBrushSelect; we
    // verify the metric row's histogram carries the tooltip element so the
    // affordance is discoverable.
    const row = buildMetricRow({
      metric: 'colorVar',
      label: 'color variation',
      min: 0,
      max: null,
      counts: new Map(),
      onRange: vi.fn(),
      initiallyExpanded: true,
    });
    const tooltip = row.querySelector('.pyr3-metric-tooltip') as HTMLElement;
    expect(tooltip).toBeTruthy();
    expect(tooltip.textContent).toContain('drag');
  });

  it('buildMetricRow wires brush-select into its expanded histogram — drag fires onRange', () => {
    // Integration check: the histogram inside a buildMetricRow responds to
    // brush gestures end-to-end. We have to stub the bar rects since
    // happy-dom skips layout — patch each bar's getBoundingClientRect.
    const onRange = vi.fn();
    const row = buildMetricRow({
      metric: 'meanLum',
      label: 'brightness',
      min: 0,
      max: null,
      counts: new Map([
        [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1],
      ]),
      onRange,
      initiallyExpanded: true,
    });
    document.body.appendChild(row);
    const bars = Array.from(row.querySelectorAll('.pyr3-metric-bar')) as HTMLElement[];
    for (let i = 0; i < bars.length; i++) {
      const left = i * 50;
      bars[i]!.getBoundingClientRect = () =>
        ({ left, top: 0, right: left + 50, bottom: 60, width: 50, height: 60, x: left, y: 0, toJSON() { return {}; } }) as DOMRect;
    }
    const histogram = row.querySelector('.pyr3-metric-histogram') as HTMLElement;
    Object.defineProperty(histogram, 'clientWidth', { value: 500, configurable: true });
    histogram.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 500, bottom: 60, width: 500, height: 60, x: 0, y: 0, toJSON() { return {}; } }) as DOMRect;

    bars[1]!.dispatchEvent(new MouseEvent('mousedown', {
      clientX: 75, clientY: 30, bubbles: true,
    }));
    document.dispatchEvent(new MouseEvent('mousemove', {
      clientX: 425, clientY: 30, bubbles: true,
    }));
    document.dispatchEvent(new MouseEvent('mouseup', {
      clientX: 425, clientY: 30, bubbles: true,
    }));

    expect(onRange).toHaveBeenCalled();
    const last = onRange.mock.calls.at(-1)!;
    expect(last[0]).toBeCloseTo(0.1, 5);
    expect(last[1]).toBeCloseTo(0.9, 5);
  });
});
