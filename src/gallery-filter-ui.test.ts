import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Window } from 'happy-dom';
import { mountFilterDrawer } from './gallery-filter-ui';
import { DEFAULT_FILTER_SPEC } from './gallery-filter';

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
