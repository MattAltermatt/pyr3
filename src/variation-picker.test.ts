import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Window } from 'happy-dom';
import { mountVariationPicker } from './variation-picker';
import { V } from './variations';

function setupDom(): void {
  const w = new Window();
  // @ts-expect-error injecting happy-dom globals for tests
  globalThis.document = w.document;
  // @ts-expect-error
  globalThis.HTMLElement = w.HTMLElement;
  // @ts-expect-error
  globalThis.Event = w.Event;
}

beforeEach(() => {
  setupDom();
});

const ALL_IDX = Object.values(V) as number[];
const ALL_COUNT = ALL_IDX.length; // 91 in current registry

function countsAll(n = 100): Map<number, number> {
  const m = new Map<number, number>();
  for (const idx of ALL_IDX) m.set(idx, n);
  return m;
}

function rowsIn(group: Element | null): Array<{ idx: number; name: string }> {
  if (!group) return [];
  return Array.from(group.querySelectorAll('.pyr3-var-row')).map((row) => {
    const el = row as HTMLElement;
    return { idx: Number(el.dataset.var), name: el.dataset.varName ?? '' };
  });
}

describe('mountVariationPicker — group composition', () => {
  it('with no selections + all counts > 0, all variations land in Available (sorted, no Selected/Empty groups)', () => {
    const root = document.createElement('div');
    mountVariationPicker(root, { selected: [], counts: countsAll(42), onChange: vi.fn() });

    expect(root.querySelector('.pyr3-var-group.selected')).toBeNull();
    expect(root.querySelector('.pyr3-var-group.empty')).toBeNull();

    const avail = root.querySelector('.pyr3-var-group.available');
    expect(avail).toBeTruthy();
    const rows = rowsIn(avail);
    expect(rows.length).toBe(ALL_COUNT);

    // Alphabetical
    const names = rows.map((r) => r.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);

    // Group header reflects N
    expect(avail!.querySelector('.pyr3-var-group-label')!.textContent).toBe(`Available (${ALL_COUNT})`);
  });

  it('with 2 selections, Selected/Available split correctly; Empty appears for zero-count', () => {
    const root = document.createElement('div');
    // counts: julia=10, linear=0, spherical=5, others=3
    const counts = countsAll(3);
    counts.set(V.linear, 0);
    counts.set(V.julia, 10);
    counts.set(V.spherical, 5);

    mountVariationPicker(root, {
      selected: [V.spherical, V.julia], // out of order; alpha = julia, spherical
      counts,
      onChange: vi.fn(),
    });

    const sel = root.querySelector('.pyr3-var-group.selected');
    const selRows = rowsIn(sel);
    expect(selRows.map((r) => r.name)).toEqual(['julia', 'spherical']);
    expect(sel!.querySelectorAll('.pyr3-var-remove').length).toBe(2);

    const empty = root.querySelector('.pyr3-var-group.empty');
    const emptyRows = rowsIn(empty);
    expect(emptyRows.map((r) => r.name)).toEqual(['linear']);

    const avail = root.querySelector('.pyr3-var-group.available');
    const availRows = rowsIn(avail);
    // Available = everything except selected (julia, spherical) and empty (linear)
    expect(availRows.length).toBe(ALL_COUNT - 3);
    // Sorted alphabetically
    const names = availRows.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('row ordering within groups is alphabetical (julia/linear/spherical sanity)', () => {
    const root = document.createElement('div');
    mountVariationPicker(root, { selected: [], counts: countsAll(1), onChange: vi.fn() });
    const names = rowsIn(root.querySelector('.pyr3-var-group.available')).map((r) => r.name);
    const iJulia = names.indexOf('julia');
    const iLinear = names.indexOf('linear');
    const iSpherical = names.indexOf('spherical');
    expect(iJulia).toBeGreaterThanOrEqual(0);
    expect(iLinear).toBeGreaterThan(iJulia);
    expect(iSpherical).toBeGreaterThan(iLinear);
  });
});

describe('mountVariationPicker — interactions', () => {
  it('clicking an Available row fires onChange with [prev, idx] sorted ascending', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountVariationPicker(root, { selected: [V.spherical], counts: countsAll(5), onChange });

    const juliaRow = root.querySelector(
      `.pyr3-var-group.available .pyr3-var-row[data-var="${V.julia}"]`,
    ) as HTMLElement;
    expect(juliaRow).toBeTruthy();
    juliaRow.dispatchEvent(new Event('click', { bubbles: true }));

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0]![0] as number[];
    expect(next).toEqual([...new Set([V.spherical, V.julia])].sort((a, b) => a - b));
  });

  it('clicking an Empty row fires onChange the same way (Empty is selectable)', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    const counts = countsAll(2);
    counts.set(V.linear, 0);

    mountVariationPicker(root, { selected: [V.julia], counts, onChange });

    const linearRow = root.querySelector(
      `.pyr3-var-group.empty .pyr3-var-row[data-var="${V.linear}"]`,
    ) as HTMLElement;
    expect(linearRow).toBeTruthy();
    linearRow.dispatchEvent(new Event('click', { bubbles: true }));

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0]![0] as number[];
    expect(next).toEqual([V.linear, V.julia].sort((a, b) => a - b));
  });

  it('clicking × on a Selected row removes it; row click handler does NOT also fire add', () => {
    const root = document.createElement('div');
    const onChange = vi.fn();
    mountVariationPicker(root, {
      selected: [V.julia, V.spherical],
      counts: countsAll(5),
      onChange,
    });

    const juliaRow = root.querySelector(
      `.pyr3-var-group.selected .pyr3-var-row[data-var="${V.julia}"]`,
    ) as HTMLElement;
    const x = juliaRow.querySelector('.pyr3-var-remove') as HTMLElement;
    x.dispatchEvent(new Event('click', { bubbles: true }));

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0]![0] as number[];
    expect(next).toEqual([V.spherical]);
  });
});

describe('mountVariationPicker — setState + destroy', () => {
  it('setState re-renders and reflects new selected + counts', () => {
    const root = document.createElement('div');
    const handle = mountVariationPicker(root, {
      selected: [],
      counts: countsAll(3),
      onChange: vi.fn(),
    });

    // Initially: no Selected group
    expect(root.querySelector('.pyr3-var-group.selected')).toBeNull();

    const newCounts = countsAll(7);
    newCounts.set(V.linear, 0);
    handle.setState({ selected: [V.julia], counts: newCounts });

    const sel = root.querySelector('.pyr3-var-group.selected');
    expect(sel).toBeTruthy();
    expect(rowsIn(sel).map((r) => r.name)).toEqual(['julia']);

    const empty = root.querySelector('.pyr3-var-group.empty');
    expect(rowsIn(empty).map((r) => r.name)).toEqual(['linear']);
  });

  it('destroy() clears the root', () => {
    const root = document.createElement('div');
    const handle = mountVariationPicker(root, {
      selected: [V.julia],
      counts: countsAll(5),
      onChange: vi.fn(),
    });
    expect(root.children.length).toBeGreaterThan(0);
    handle.destroy();
    expect(root.children.length).toBe(0);
  });
});
