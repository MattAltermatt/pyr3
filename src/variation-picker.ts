// Variation picker — 3-group faceted dropdown panel (#49 Phase D, task D1).
//
// Presentational module: reads `selected` + `counts` from opts, dispatches
// `onChange(nextSelected)` on toggle. No internal filter state, no URL
// reads/writes — D2 wires this into the gallery-filter drawer; main.ts
// owns the URL.
//
// Three groups, in this order:
//   Selected (N) — currently-selected variations, × button on each row
//   Available (M) — unselected variations with count > 0
//   Empty (K) — unselected variations with count == 0 (dim+italic, still
//     clickable — visitors can pre-build filters that no fixtures currently
//     match)
//
// Rows within each group are alphabetical. The picker stays open on row
// click so visitors can build multi-variation filters without re-opening.

import { V } from './variations';

export interface VariationPickerOpts {
  /** Currently-selected variation indices. */
  selected: number[];
  /** Live counts from gallery-facets's computeFacetCounts(...).variations. */
  counts: Map<number, number>;
  /** Fired when the visitor toggles a variation. Argument is the next set,
   *  sorted ascending (deduped + canonical). */
  onChange(nextSelected: number[]): void;
}

export interface VariationPickerHandle {
  setState(opts: { selected: number[]; counts: Map<number, number> }): void;
  destroy(): void;
}

/** Static alphabetized variation list, built once at module load. */
const ALL_VARIATIONS: ReadonlyArray<{ idx: number; name: string }> = Object.entries(V)
  .map(([name, idx]) => ({ idx: idx as number, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

const STYLES_ID = 'pyr3-var-picker-styles';

const STYLES = `
.pyr3-var-picker { font-family: ui-monospace, monospace; font-size: 12px; color: var(--text, #ddd); }
.pyr3-var-group { padding: 4px 0; }
.pyr3-var-group-label { color: var(--text-dim, #888); padding: 2px 0; font-weight: 600; letter-spacing: 0.02em; }
.pyr3-var-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 8px; cursor: pointer; border-radius: 3px; gap: 12px; }
.pyr3-var-row:hover { background: var(--bar-bg-3, #0f0f13); }
.pyr3-var-group.empty .pyr3-var-row { color: #555; font-style: italic; }
.pyr3-var-remove { color: var(--text-dim, #aaa); padding: 0 6px; cursor: pointer; user-select: none; }
.pyr3-var-remove:hover { color: #ff7a7a; }
.pyr3-var-count { color: var(--text-dim, #888); font-size: 11px; }
`;

function injectStylesOnce(): void {
  if (document.getElementById(STYLES_ID)) return;
  const style = document.createElement('style');
  style.id = STYLES_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

function fmtCount(n: number): string {
  return `(${n.toLocaleString('en-US')})`;
}

function sortedAsc(nums: number[]): number[] {
  return [...new Set(nums)].sort((a, b) => a - b);
}

export function mountVariationPicker(
  root: HTMLElement,
  opts: VariationPickerOpts,
): VariationPickerHandle {
  injectStylesOnce();

  let selected: number[] = [...opts.selected];
  let counts: Map<number, number> = opts.counts;

  const panel = document.createElement('div');
  panel.className = 'pyr3-var-picker';
  root.replaceChildren(panel);

  function fireAdd(idx: number): void {
    const next = sortedAsc([...selected, idx]);
    opts.onChange(next);
  }

  function fireRemove(idx: number): void {
    const next = sortedAsc(selected.filter((i) => i !== idx));
    opts.onChange(next);
  }

  function makeGroup(
    label: string,
    klass: 'selected' | 'available' | 'empty',
    rows: Array<{ idx: number; name: string; count: number }>,
    isSelected: boolean,
  ): HTMLDivElement {
    const group = document.createElement('div');
    group.className = `pyr3-var-group ${klass}`;

    const header = document.createElement('div');
    header.className = 'pyr3-var-group-label';
    header.textContent = `${label} (${rows.length})`;
    group.appendChild(header);

    for (const { idx, name, count } of rows) {
      const row = document.createElement('div');
      row.className = 'pyr3-var-row';
      row.dataset.var = String(idx);
      row.dataset.varName = name;

      const nameSpan = document.createElement('span');
      nameSpan.textContent = name;
      row.appendChild(nameSpan);

      if (isSelected) {
        const x = document.createElement('span');
        x.className = 'pyr3-var-remove';
        x.textContent = '×';
        x.addEventListener('click', (ev) => {
          ev.stopPropagation();
          fireRemove(idx);
        });
        row.appendChild(x);
        // Clicking the row body itself (not the ×) is a no-op for selected
        // rows — × is the only remove affordance.
      } else {
        const countSpan = document.createElement('span');
        countSpan.className = 'pyr3-var-count';
        countSpan.textContent = fmtCount(count);
        row.appendChild(countSpan);
        row.addEventListener('click', () => fireAdd(idx));
      }

      group.appendChild(row);
    }

    return group;
  }

  function render(): void {
    panel.replaceChildren();

    const selectedSet = new Set(selected);

    const selectedRows: Array<{ idx: number; name: string; count: number }> = [];
    const availableRows: Array<{ idx: number; name: string; count: number }> = [];
    const emptyRows: Array<{ idx: number; name: string; count: number }> = [];

    for (const { idx, name } of ALL_VARIATIONS) {
      const c = counts.get(idx) ?? 0;
      if (selectedSet.has(idx)) {
        selectedRows.push({ idx, name, count: c });
      } else if (c > 0) {
        availableRows.push({ idx, name, count: c });
      } else {
        emptyRows.push({ idx, name, count: c });
      }
    }

    if (selectedRows.length > 0) {
      panel.appendChild(makeGroup('Selected', 'selected', selectedRows, true));
    }
    if (availableRows.length > 0) {
      panel.appendChild(makeGroup('Available', 'available', availableRows, false));
    }
    if (emptyRows.length > 0) {
      panel.appendChild(makeGroup('Empty', 'empty', emptyRows, false));
    }
  }

  render();

  return {
    setState(next) {
      selected = [...next.selected];
      counts = next.counts;
      render();
    },
    destroy() {
      root.replaceChildren();
    },
  };
}
