import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Window } from 'happy-dom';
import {
  activeFilterCount,
  attachBrushSelect,
  buildActiveChipStrip,
  buildMetricRow,
  buildSortRow,
  mountFilterDrawer,
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

// ──────────────────────────────────────────────────────────────────────────
// mountFilterDrawer — progressive-disclosure layout (Task 5.6)
// ──────────────────────────────────────────────────────────────────────────

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

  it('mounts open when initialFilter is non-default', () => {
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

  it('setFilter from non-default to default does NOT auto-close', () => {
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

describe('mountFilterDrawer — progressive-disclosure structure (Task 5.6)', () => {
  it('renders the new shell: chip strip + sort row + variations row + 5 metric rows + footer', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    expect(root.querySelector('.pyr3-filter-chip-strip-wrap')).toBeTruthy();
    expect(root.querySelector('.pyr3-filter-sort-row-wrap')).toBeTruthy();
    expect(root.querySelector('.pyr3-vars-row')).toBeTruthy();
    const metricRows = root.querySelectorAll('.pyr3-filter-metric-row-wrap');
    expect(metricRows.length).toBe(5);
    const metricAxes = Array.from(metricRows).map((el) => (el as HTMLElement).dataset.metric);
    expect(metricAxes).toEqual(['xforms', 'coverage', 'entropy', 'colorVar', 'meanLum']);
    expect(root.querySelector('.pyr3-filter-footer')).toBeTruthy();
    expect(root.querySelector('.pyr3-filter-reset')).toBeTruthy();
    expect(root.querySelector('.pyr3-filter-apply')).toBeTruthy();
  });

  it('chip strip is empty when filter is default', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const stripWrap = root.querySelector('.pyr3-filter-chip-strip-wrap') as HTMLElement;
    expect(stripWrap.querySelectorAll('.pyr3-active-chip').length).toBe(0);
  });

  it('chip strip renders one chip per active axis when filters are set', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: {
        ...DEFAULT_FILTER_SPEC,
        coverageMin: 0.3,
        coverageMax: 0.7,
        meanLumMin: 0.4,
      },
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const chips = root.querySelectorAll('.pyr3-active-chip');
    expect(chips.length).toBe(2);
  });

  it("clicking a chip's × removes that axis from the filter", () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, coverageMin: 0.3, coverageMax: 0.7 },
      facetCounts: makeCounts(),
      onChange,
    });
    const x = root.querySelector('.pyr3-active-chip-x') as HTMLElement;
    x.click();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ coverageMin: 0, coverageMax: null }),
    );
  });

  it("clear-all link resets every filter axis but preserves sort + sortDir", () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: {
        ...DEFAULT_FILTER_SPEC,
        sort: 'coverage',
        sortDir: 'asc',
        coverageMin: 0.3,
        vars: [0],
      },
      facetCounts: makeCounts(),
      onChange,
    });
    const clearAll = root.querySelector('.pyr3-active-chip-clear-all') as HTMLElement;
    clearAll.click();
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0];
    expect(next.sort).toBe('coverage');
    expect(next.sortDir).toBe('asc');
    expect(next.coverageMin).toBe(0);
    expect(next.vars).toEqual([]);
  });

  it('sort dropdown change fires onChange with the new sort key', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange,
    });
    const select = root.querySelector('select.pyr3-sort-select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    select.value = 'coverage';
    select.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sort: 'coverage' }));
  });

  it('sort direction toggle fires onChange with the inverse direction', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, sortDir: 'desc' },
      facetCounts: makeCounts(),
      onChange,
    });
    const dirBtn = root.querySelector('.pyr3-sort-dir-btn') as HTMLButtonElement;
    dirBtn.click();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sortDir: 'asc' }));
  });

  it("vars row's `+ add` button renders and is initially closed", () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const addBtn = root.querySelector('.pyr3-vars-add-btn') as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    expect(addBtn.classList.contains('open')).toBe(false);
    const panel = root.querySelector('.pyr3-vars-picker-panel') as HTMLElement;
    expect(panel.style.display).toBe('none');
  });

  it('vars chips render when filter has variations', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, vars: [0, 13] },
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const chips = root.querySelectorAll('.pyr3-vars-chip');
    expect(chips.length).toBe(2);
  });

  it('a vars chip click removes that variation from the filter', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, vars: [0, 13] },
      facetCounts: makeCounts(),
      onChange,
    });
    const chips = root.querySelectorAll('.pyr3-vars-chip');
    (chips[0] as HTMLElement).click();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ vars: [13] }));
  });

  it('metric rows are collapsed by default — bodies hidden', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const bodies = root.querySelectorAll('.pyr3-filter-metric-row-wrap .pyr3-metric-body');
    expect(bodies.length).toBe(5);
    for (const body of Array.from(bodies)) {
      expect((body as HTMLElement).style.display).toBe('none');
    }
  });

  it('metric row headers carry plain-english labels', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const labels = Array.from(
      root.querySelectorAll('.pyr3-filter-metric-row-wrap .pyr3-metric-label'),
    ).map((el) => el.textContent);
    expect(labels).toEqual([
      'xform count',
      'coverage',
      'complexity',
      'color variation',
      'brightness',
    ]);
  });

  it('xform metric row maps xformMin / xformMax through to a metric range value', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, xformMin: 3, xformMax: 5 },
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const xformWrap = root.querySelector(
      '.pyr3-filter-metric-row-wrap[data-metric="xforms"]',
    ) as HTMLElement;
    expect(xformWrap).toBeTruthy();
    const value = xformWrap.querySelector('.pyr3-metric-value') as HTMLElement;
    // xform [3, 5] is now rendered in integer xform-count units to match the
    // active-chip strip's "xform count 3–5" — not the underlying metric
    // float space (0.2–0.5) (overhaul fix 2026-06-04).
    expect(value.textContent).toContain('3');
    expect(value.textContent).toContain('5');
  });

  it('coverage metric row reflects the current coverage range in its header', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: { ...DEFAULT_FILTER_SPEC, coverageMin: 0.3, coverageMax: 0.7 },
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const wrap = root.querySelector(
      '.pyr3-filter-metric-row-wrap[data-metric="coverage"]',
    ) as HTMLElement;
    const value = wrap.querySelector('.pyr3-metric-value') as HTMLElement;
    expect(value.textContent).toContain('0.3');
    expect(value.textContent).toContain('0.7');
  });

  it('Apply button shows the live match count and updates via setMatchCount', () => {
    const root = document.createElement('div');
    const handle = mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
      matchCount: 1234,
    });
    const apply = root.querySelector('.pyr3-filter-apply') as HTMLButtonElement;
    expect(apply.textContent).toContain('Apply');
    expect(apply.textContent).toContain('1,234');
    expect(apply.textContent).toContain('matches');

    handle.setMatchCount(1);
    expect(apply.textContent).toContain('1 match');
    expect(apply.textContent).not.toMatch(/1 matches/);

    handle.setMatchCount(0);
    expect(apply.textContent).toContain('0 matches');
  });

  it('Apply button defaults to 0 matches when matchCount is omitted', () => {
    const root = document.createElement('div');
    mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const apply = root.querySelector('.pyr3-filter-apply') as HTMLButtonElement;
    expect(apply.textContent).toContain('0 matches');
  });

  it('setFilter rebuilds the chip strip + metric row values', () => {
    const root = document.createElement('div');
    const handle = mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    expect(root.querySelectorAll('.pyr3-active-chip').length).toBe(0);
    handle.setFilter({ ...DEFAULT_FILTER_SPEC, colorVarMin: 0.4 });
    expect(root.querySelectorAll('.pyr3-active-chip').length).toBe(1);
    const wrap = root.querySelector(
      '.pyr3-filter-metric-row-wrap[data-metric="colorVar"]',
    ) as HTMLElement;
    expect((wrap.querySelector('.pyr3-metric-value') as HTMLElement).textContent).toContain('0.4');
  });

  it('a rebuild preserves per-row expansion (brush-select drag does not slam the row closed)', () => {
    const root = document.createElement('div');
    const handle = mountFilterDrawer(root, {
      initialFilter: DEFAULT_FILTER_SPEC,
      facetCounts: makeCounts(),
      onChange: vi.fn(),
    });
    const wrap = root.querySelector(
      '.pyr3-filter-metric-row-wrap[data-metric="colorVar"]',
    ) as HTMLElement;
    // Open the row by clicking its header (mimics what the user did).
    (wrap.querySelector('.pyr3-metric-header') as HTMLElement).click();
    expect((wrap.querySelector('.pyr3-metric-body') as HTMLElement).style.display).toBe('block');
    // A drag would dispatch onChange → main.ts re-routes through setFilter.
    // Without expansion-state preservation, the rebuilt row would default
    // back to collapsed; we want it to stay open.
    handle.setFilter({ ...DEFAULT_FILTER_SPEC, colorVarMin: 0.3, colorVarMax: 0.7 });
    const reopened = root.querySelector(
      '.pyr3-filter-metric-row-wrap[data-metric="colorVar"]',
    ) as HTMLElement;
    expect((reopened.querySelector('.pyr3-metric-body') as HTMLElement).style.display).toBe('block');
  });
});

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

// ──────────────────────────────────────────────────────────────────────────
// activeFilterCount (Task 5.6) — chip-strip-aligned count for the bar badge
// ──────────────────────────────────────────────────────────────────────────

describe('activeFilterCount — chip-strip-aligned count for the bar badge', () => {
  it('returns 0 for the default spec', () => {
    expect(activeFilterCount(DEFAULT_FILTER_SPEC)).toBe(0);
  });

  it('does NOT count the sort axis (sort dropdown is always visible)', () => {
    expect(
      activeFilterCount({ ...DEFAULT_FILTER_SPEC, sort: 'interest', sortDir: 'asc' }),
    ).toBe(0);
  });

  it('counts one per active stat axis', () => {
    expect(
      activeFilterCount({
        ...DEFAULT_FILTER_SPEC,
        coverageMin: 0.3,
        coverageMax: 0.7,
      }),
    ).toBe(1);
    expect(
      activeFilterCount({
        ...DEFAULT_FILTER_SPEC,
        coverageMin: 0.3,
        entropyMax: 0.5,
        meanLumMin: 0.2,
      }),
    ).toBe(3);
  });

  it('counts one per selected variation (each chip is its own axis)', () => {
    expect(
      activeFilterCount({ ...DEFAULT_FILTER_SPEC, vars: [0, 13] }),
    ).toBe(2);
  });

  it('counts the xform-count axis once when it differs from default', () => {
    expect(
      activeFilterCount({ ...DEFAULT_FILTER_SPEC, xformMin: 3, xformMax: 5 }),
    ).toBe(1);
  });

  it('matches what buildActiveChipStrip actually renders', () => {
    const spec: FilterSpec = {
      ...DEFAULT_FILTER_SPEC,
      vars: [0, 13],
      xformMin: 3,
      coverageMin: 0.3,
    };
    const strip = buildActiveChipStrip(spec, vi.fn(), vi.fn());
    const chips = strip.querySelectorAll('.pyr3-active-chip');
    expect(activeFilterCount(spec)).toBe(chips.length);
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

  it('rapid double-click reads live sortDir, not closure — emits asc then desc', () => {
    // Without the liveSortDir getter both clicks would see `spec.sortDir`
    // unchanged ('desc') and emit 'asc' twice. With the getter, the second
    // click sees the new value (caller updated it inside the first
    // onDirChange) and emits 'desc'.
    const onDirChange = vi.fn<(d: SortDir) => void>();
    let liveDir: SortDir = 'desc';
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, sortDir: 'desc' };
    const row = buildSortRow(
      spec,
      vi.fn(),
      (next) => { liveDir = next; onDirChange(next); },
      () => liveDir,
    );
    const dirBtn = row.querySelector('.pyr3-sort-dir-btn') as HTMLButtonElement;
    dirBtn.click();
    dirBtn.click();
    expect(onDirChange).toHaveBeenNthCalledWith(1, 'asc');
    expect(onDirChange).toHaveBeenNthCalledWith(2, 'desc');
  });

  it('omitting liveSortDir falls back to spec.sortDir (back-compat)', () => {
    // Old call-sites with no getter still work — first click uses spec.sortDir.
    const onDirChange = vi.fn<(d: SortDir) => void>();
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, sortDir: 'asc' };
    const row = buildSortRow(spec, vi.fn(), onDirChange /* no getter */);
    (row.querySelector('.pyr3-sort-dir-btn') as HTMLButtonElement).click();
    expect(onDirChange).toHaveBeenCalledWith('desc');
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
      counts: makeBuckets([50, 50, 50, 50, 50, 100, 50, 50, 50, 50]),
      onRange: vi.fn(),
      initiallyExpanded: true,
    });
    const bars = Array.from(row.querySelectorAll('.pyr3-metric-bar')) as HTMLElement[];
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

  it('default bucketLabels render the bucket upper-bound for stat axes (0.1 0.2 … 1.0)', () => {
    const row = buildMetricRow({
      metric: 'coverage',
      label: 'coverage',
      min: 0,
      max: null,
      counts: makeBuckets([3242, 2480, 3021, 3106, 3544, 3730, 4410, 5158, 6710, 16774]),
      onRange: vi.fn(),
      initiallyExpanded: true,
    });
    const axisLabels = Array.from(row.querySelectorAll('.pyr3-metric-axislabel'))
      .map(el => el.textContent);
    expect(axisLabels).toEqual(['0.1', '0.2', '0.3', '0.4', '0.5', '0.6', '0.7', '0.8', '0.9', '1.0']);
  });

  it('renders comma-formatted per-bucket count labels above each bar', () => {
    const row = buildMetricRow({
      metric: 'coverage',
      label: 'coverage',
      min: 0,
      max: null,
      counts: makeBuckets([3242, 2480, 3021, 3106, 3544, 3730, 4410, 5158, 6710, 16774]),
      onRange: vi.fn(),
      initiallyExpanded: true,
    });
    const counts = Array.from(row.querySelectorAll('.pyr3-metric-count'))
      .map(el => el.textContent);
    expect(counts).toEqual([
      '3,242', '2,480', '3,021', '3,106', '3,544',
      '3,730', '4,410', '5,158', '6,710', '16,774',
    ]);
  });

  it('bucketCount=14 + custom bucketLabels render xform-style row (1..13, 14+)', () => {
    const counts14 = new Map<number, number>();
    const xformCounts = [77, 5287, 9048, 8575, 5756, 4217, 3132, 3050, 2175, 1845, 1968, 3242, 1129, 2674];
    for (let i = 0; i < 14; i++) counts14.set(i, xformCounts[i]!);
    const row = buildMetricRow({
      metric: 'coverage',
      label: 'xform count',
      min: 0,
      max: null,
      counts: counts14,
      bucketCount: 14,
      bucketLabels: (i) => i < 13 ? String(i + 1) : '14+',
      onRange: vi.fn(),
      initiallyExpanded: true,
    });
    const bars = row.querySelectorAll('.pyr3-metric-bar');
    expect(bars).toHaveLength(14);
    const axisLabels = Array.from(row.querySelectorAll('.pyr3-metric-axislabel'))
      .map(el => el.textContent);
    expect(axisLabels).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14+']);
    const counts = Array.from(row.querySelectorAll('.pyr3-metric-count'))
      .map(el => el.textContent);
    expect(counts[1]).toBe('5,287');
    expect(counts[13]).toBe('2,674');
  });

  it('zero-count buckets still render an empty (non-null) count label so the row stays aligned', () => {
    const row = buildMetricRow({
      metric: 'coverage',
      label: 'coverage',
      min: 0,
      max: null,
      counts: makeBuckets([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      onRange: vi.fn(),
      initiallyExpanded: true,
    });
    const counts = row.querySelectorAll('.pyr3-metric-count');
    expect(counts).toHaveLength(10);
    for (const el of counts) expect(el.textContent).toBe('0');
  });

  it('renders a per-row reset link only when the axis is constrained', () => {
    const defaultRow = buildMetricRow({
      metric: 'coverage',
      label: 'coverage',
      min: 0,
      max: null,
      counts: makeBuckets([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
      onRange: vi.fn(),
      initiallyExpanded: true,
    });
    expect(defaultRow.querySelector('.pyr3-metric-reset')).toBeNull();

    const narrowedRow = buildMetricRow({
      metric: 'coverage',
      label: 'coverage',
      min: 0.3,
      max: 0.7,
      counts: makeBuckets([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
      onRange: vi.fn(),
      initiallyExpanded: true,
    });
    const reset = narrowedRow.querySelector('.pyr3-metric-reset') as HTMLButtonElement;
    expect(reset).toBeTruthy();
    expect(reset.textContent).toContain('reset');
  });

  it('clicking the per-row reset fires onRange(0, null) to clear just that axis', () => {
    const onRange = vi.fn();
    const row = buildMetricRow({
      metric: 'colorVar',
      label: 'color variation',
      min: 0.3,
      max: 0.7,
      counts: makeBuckets([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
      onRange,
      initiallyExpanded: true,
    });
    const reset = row.querySelector('.pyr3-metric-reset') as HTMLButtonElement;
    reset.click();
    expect(onRange).toHaveBeenCalledWith(0, null);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Task 5.5 — Brush-select drag gesture on the histogram
// ──────────────────────────────────────────────────────────────────────────

describe('attachBrushSelect (Task 5.5) — drag a bucket range across the histogram', () => {
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
      const left = i * 50;
      bar.getBoundingClientRect = () =>
        ({ left, top: 0, right: left + 50, bottom: 60, width: 50, height: 60, x: left, y: 0, toJSON() { return {}; } }) as DOMRect;
      Object.defineProperty(bar, 'offsetWidth', { value: 50, configurable: true });
      bars.push(bar);
      histogram.appendChild(bar);
    }
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

  it('mousedown on bucket 3 + mousemove to bucket 7 + mouseup → onRange(0.3, 0.8)', () => {
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

    expect(bars[0]!.classList.contains('in-range')).toBe(false);
    expect(bars[1]!.classList.contains('in-range')).toBe(false);
    expect(bars[2]!.classList.contains('in-range')).toBe(true);
    expect(bars[4]!.classList.contains('in-range')).toBe(true);
    expect(bars[5]!.classList.contains('in-range')).toBe(true);
    expect(bars[6]!.classList.contains('in-range')).toBe(false);

    document.dispatchEvent(new MouseEvent('mouseup', {
      clientX: centerOf(bars[5]!), clientY: 30, bubbles: true,
    }));
  });

  it('histogram exposes a hover-tooltip element ("click & drag to select range")', () => {
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
