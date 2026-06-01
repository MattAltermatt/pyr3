// Gallery filter drawer — UI surface beneath the gallery bar that hosts
// sort/variation/xform controls (#49 Phase B/C/D/E).
//
// State lives in the URL; the drawer is a controlled component — it never
// holds filter state internally. Every interaction calls opts.onChange
// with the next FilterSpec; main.ts owns the URL write + master-list
// rebuild and feeds the new state back via setFilter / setFacetCounts.
//
// Phase B scope (this file's first cut): scaffold + reset pill + auto-
// open/close on (non-)default + loading state. Sort, xform, and variation
// rows are wired in later B/D tasks; the row containers are present here
// as placeholders so their later wiring is purely additive.

import {
  DEFAULT_FILTER_SPEC,
  isDefaultFilterSpec,
  SORT_MODES,
  type FilterSpec,
  type SortDir,
  type SortMode,
} from './gallery-filter';

/** Hover tooltips for each sort preset — the abstract pill labels
 *  ("coverage", "entropy", …) don't explain what they order by; the
 *  native title-attribute tooltip does. */
const SORT_TOOLTIPS: Record<SortMode, string> = {
  time: 'sort: chronological (canonical corpus order — gen ascending, id ascending)',
  interest: 'sort: weighted "interestingness" — coverage + entropy + colorVar − dimness',
  coverage: 'sort: how much of the frame is painted (descending — fullest frames first)',
  entropy: 'sort: textural complexity of the rendered image (descending — most-detailed first)',
  colorVar: 'sort: variety of colors in the palette (descending — most-colorful first)',
  meanLum: 'sort: mean brightness (descending — brightest first)',
};
import type { FacetCounts } from './gallery-facets';

export interface FilterDrawerOpts {
  initialFilter: FilterSpec;
  facetCounts: FacetCounts;
  /** Fired when any control inside the drawer changes (including reset). */
  onChange(nextFilter: FilterSpec): void;
  /** When true, the drawer is mounted in a disabled "loading…" state — the
   *  feature index isn't ready yet. main.ts flips this false once
   *  loadFeatureIndex() resolves. */
  loading?: boolean;
}

export interface FilterDrawerHandle {
  /** Replace the drawer's facet counts (call after every applyFilter so
   *  rows re-render with fresh leave-one-out counts). */
  setFacetCounts(counts: FacetCounts): void;
  /** Mirror state after main.ts has accepted the change — keeps the
   *  drawer's internal DOM in sync with the URL's source of truth.
   *  Also closes the drawer when the new spec is the default. */
  setFilter(filter: FilterSpec): void;
  /** Toggle the drawer's open/closed state — wired to the bar's
   *  [⚙ filters ▾] pill click. */
  toggleOpen(): void;
  isOpen(): boolean;
  /** Flip the loading state (true → controls disabled + banner shown). */
  setLoading(loading: boolean): void;
  destroy(): void;
}

const STYLES_ID = 'pyr3-filter-drawer-styles';

const STYLES = `
.pyr3-filter-drawer {
  display: none;
  padding: 12px 16px;
  background: var(--bar-bg-2, #1a1a20);
  border-bottom: 1px solid var(--bar-border, #2a2a30);
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: var(--text, #ddd);
}
.pyr3-filter-drawer.open { display: block; }

.pyr3-filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  flex-wrap: wrap;
}
.pyr3-filter-row-label {
  color: var(--text-dim, #888);
  min-width: 62px;
}

.pyr3-filter-reset {
  background: var(--bar-bg-1, #15151a);
  color: var(--text, #ddd);
  border: 1px solid var(--bar-border, #2a2a30);
  padding: 4px 12px;
  border-radius: 3px;
  cursor: pointer;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.pyr3-filter-reset:hover { background: var(--bar-bg-3, #0f0f13); }

.pyr3-sort-pill {
  background: var(--bar-bg-1, #15151a);
  color: var(--text-dim, #aaa);
  border: 1px solid var(--bar-border, #2a2a30);
  padding: 3px 10px;
  border-radius: 3px;
  cursor: pointer;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.pyr3-sort-pill.active {
  background: var(--accent-soft, rgba(255, 140, 26, 0.18));
  color: var(--accent, #ff8c1a);
  border-color: var(--accent-border, #884a1a);
}
.pyr3-sort-pill:hover:not(.active) {
  background: var(--bar-bg-3, #0f0f13);
  color: var(--text, #ddd);
}

.pyr3-sort-order-btn {
  background: var(--bar-bg-1, #15151a);
  color: var(--text-dim, #aaa);
  border: 1px solid var(--bar-border, #2a2a30);
  padding: 3px 10px;
  border-radius: 3px;
  cursor: pointer;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  margin-left: 4px;
}
.pyr3-sort-order-btn:hover {
  background: var(--bar-bg-3, #0f0f13);
  color: var(--text, #ddd);
}

.pyr3-filter-loading-banner {
  display: none;
  color: var(--accent, #ff8c1a);
  padding: 4px 0 8px;
  font-style: italic;
}
.pyr3-filter-drawer.loading .pyr3-filter-loading-banner { display: block; }
.pyr3-filter-drawer.loading .pyr3-filter-row > *:not(.pyr3-filter-row-label) {
  opacity: 0.4;
  pointer-events: none;
}

.pyr3-xform-from, .pyr3-xform-to {
  background: var(--bar-bg-1, #15151a);
  color: var(--text, #ddd);
  border: 1px solid var(--bar-border, #2a2a30);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.pyr3-xform-count-strip {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  padding-left: 70px;  /* align with the picker row's label indent */
}
.pyr3-xform-cell {
  color: var(--text-dim, #666);
  font-size: 11px;
  white-space: nowrap;
}
.pyr3-xform-cell.active { color: var(--accent, #ff8c1a); }
.pyr3-xform-cell.empty { color: #444; font-style: italic; }
.pyr3-filter-row-stat-label { color: var(--text-dim, #888); }
`;

function injectStylesOnce(): void {
  if (document.getElementById(STYLES_ID)) return;
  const style = document.createElement('style');
  style.id = STYLES_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

export function mountFilterDrawer(
  root: HTMLElement,
  opts: FilterDrawerOpts,
): FilterDrawerHandle {
  injectStylesOnce();
  root.replaceChildren();

  let currentFilter = opts.initialFilter;
  // initialFilter remembered so setFacetCounts can re-render without
  // needing the caller to re-feed the current spec.
  let currentCounts = opts.facetCounts;
  let isOpen = !isDefaultFilterSpec(currentFilter);

  const drawer = document.createElement('div');
  drawer.className = `pyr3-filter-drawer${isOpen ? ' open' : ''}${opts.loading ? ' loading' : ''}`;

  // Loading banner — hidden by CSS unless .loading is on the drawer.
  const loadingBanner = document.createElement('div');
  loadingBanner.className = 'pyr3-filter-loading-banner';
  loadingBanner.textContent = 'loading feature index… (filters arrive in ~0.5s)';
  drawer.appendChild(loadingBanner);

  // Placeholder rows for the sort/variation/xform controls — wired in
  // later B/D tasks. Present as empty containers so the later wiring
  // is purely additive (no DOM-shape changes that would risk other
  // rows shifting under the cursor).
  const sortRow = document.createElement('div');
  sortRow.className = 'pyr3-filter-row sort';
  const sortLabel = document.createElement('span');
  sortLabel.className = 'pyr3-filter-row-label';
  sortLabel.textContent = 'sort:';
  sortRow.appendChild(sortLabel);
  const sortPills = new Map<SortMode, HTMLButtonElement>();
  for (const mode of SORT_MODES) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'pyr3-sort-pill';
    pill.dataset.sort = mode;
    pill.textContent = mode;
    pill.title = SORT_TOOLTIPS[mode];
    if (currentFilter.sort === mode) pill.classList.add('active');
    pill.onclick = () => {
      if (currentFilter.sort === mode) return;
      opts.onChange({ ...currentFilter, sort: mode });
    };
    sortPills.set(mode, pill);
    sortRow.appendChild(pill);
  }
  // Sort-direction toggle — flips asc/desc. Sits at the end of the sort
  // row so it composes with the preset pills. Its label updates to reflect
  // current direction. Tooltip explains.
  const orderBtn = document.createElement('button');
  orderBtn.type = 'button';
  orderBtn.className = 'pyr3-sort-order-btn';
  const renderOrderBtn = (dir: SortDir): void => {
    orderBtn.textContent = dir === 'desc' ? '↓ desc' : '↑ asc';
    orderBtn.title = dir === 'desc'
      ? 'sort direction: descending (highest first). click to flip to ascending.'
      : 'sort direction: ascending (lowest first). click to flip to descending.';
  };
  renderOrderBtn(currentFilter.sortDir);
  orderBtn.onclick = () => {
    const nextDir: SortDir = currentFilter.sortDir === 'desc' ? 'asc' : 'desc';
    opts.onChange({ ...currentFilter, sortDir: nextDir });
  };
  sortRow.appendChild(orderBtn);
  drawer.appendChild(sortRow);

  function renderSortActive(sort: SortMode): void {
    for (const [mode, pill] of sortPills) {
      pill.classList.toggle('active', mode === sort);
    }
  }

  const varsRow = document.createElement('div');
  varsRow.className = 'pyr3-filter-row vars';
  drawer.appendChild(varsRow);

  // Xforms row — `from` (1..15, required) and `to` (`all` + 1..15) integer
  // pickers + a 14-cell live count strip below. Auto-clamp invariant:
  // to >= from. If the user picks a `from` greater than the current `to`,
  // `to` is clamped UP to match the new `from` (predictable: the picker the
  // user just touched is authoritative, the other moves to keep the range
  // valid). Same in reverse for `to` < `from`.
  const xformsRow = document.createElement('div');
  xformsRow.className = 'pyr3-filter-row xforms';
  const xformsLabel = document.createElement('span');
  xformsLabel.className = 'pyr3-filter-row-label';
  xformsLabel.textContent = 'xforms:';
  xformsRow.appendChild(xformsLabel);

  const fromLabel = document.createElement('span');
  fromLabel.className = 'pyr3-filter-row-stat-label';
  fromLabel.textContent = 'from';
  xformsRow.appendChild(fromLabel);

  const fromSelect = document.createElement('select');
  fromSelect.className = 'pyr3-xform-from';
  for (let n = 1; n <= 15; n++) {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = String(n);
    fromSelect.appendChild(opt);
  }
  xformsRow.appendChild(fromSelect);

  const toLabel = document.createElement('span');
  toLabel.className = 'pyr3-filter-row-stat-label';
  toLabel.textContent = 'to';
  xformsRow.appendChild(toLabel);

  const toSelect = document.createElement('select');
  toSelect.className = 'pyr3-xform-to';
  {
    const optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.textContent = 'all';
    toSelect.appendChild(optAll);
    for (let n = 1; n <= 15; n++) {
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = String(n);
      toSelect.appendChild(opt);
    }
  }
  xformsRow.appendChild(toSelect);

  // Count strip — 14 cells: 1..13 + 14+. Rendered as a sibling of the
  // picker row so the pickers stay anchored on their own line and the
  // strip wraps independently underneath.
  const xformStrip = document.createElement('div');
  xformStrip.className = 'pyr3-xform-count-strip';
  const xformCells: HTMLSpanElement[] = [];
  for (let b = 1; b <= 14; b++) {
    const cell = document.createElement('span');
    cell.className = 'pyr3-xform-cell';
    cell.dataset.bucket = String(b);
    xformCells.push(cell);
    xformStrip.appendChild(cell);
  }

  drawer.appendChild(xformsRow);
  drawer.appendChild(xformStrip);

  function renderXformPickers(f: FilterSpec): void {
    fromSelect.value = String(f.xformMin);
    toSelect.value = f.xformMax === null ? 'all' : String(f.xformMax);
  }

  function renderXformStrip(f: FilterSpec, counts: FacetCounts): void {
    const min = f.xformMin;
    const max = f.xformMax;
    for (let b = 1; b <= 14; b++) {
      const cell = xformCells[b - 1]!;
      const count = counts.xforms.get(b) ?? 0;
      const label = b === 14 ? '14+' : String(b);
      cell.textContent = `${label} (${count.toLocaleString()})`;
      const inRange = b >= min && (max === null || b <= max);
      cell.classList.toggle('active', inRange);
      cell.classList.toggle('empty', count === 0);
    }
  }

  renderXformPickers(currentFilter);
  renderXformStrip(currentFilter, currentCounts);

  fromSelect.addEventListener('change', () => {
    const nextFrom = Number(fromSelect.value);
    let nextTo = currentFilter.xformMax;
    // Auto-clamp: if `to` is a finite cap below the new `from`, bump it up
    // to match. `all` (null) stays `all`.
    if (nextTo !== null && nextTo < nextFrom) nextTo = nextFrom;
    opts.onChange({ ...currentFilter, xformMin: nextFrom, xformMax: nextTo });
  });

  toSelect.addEventListener('change', () => {
    const raw = toSelect.value;
    const nextTo = raw === 'all' ? null : Number(raw);
    let nextFrom = currentFilter.xformMin;
    // Auto-clamp the other direction: if the new `to` falls below `from`,
    // pull `from` down to match.
    if (nextTo !== null && nextTo < nextFrom) nextFrom = nextTo;
    opts.onChange({ ...currentFilter, xformMin: nextFrom, xformMax: nextTo });
  });

  // Actions row — reset pill (always last so it can't get pushed off
  // when filter chips wrap).
  const actionsRow = document.createElement('div');
  actionsRow.className = 'pyr3-filter-row actions';
  const resetBtn = document.createElement('button');
  resetBtn.className = 'pyr3-filter-reset';
  resetBtn.type = 'button';
  resetBtn.textContent = '✕ reset';
  resetBtn.title = 'clear all filters + sort';
  resetBtn.onclick = () => opts.onChange(DEFAULT_FILTER_SPEC);
  actionsRow.appendChild(resetBtn);
  drawer.appendChild(actionsRow);

  root.appendChild(drawer);

  return {
    setFacetCounts(c) {
      currentCounts = c;
      renderXformStrip(currentFilter, c);
    },
    setFilter(f) {
      currentFilter = f;
      renderSortActive(f.sort);
      renderOrderBtn(f.sortDir);
      renderXformPickers(f);
      renderXformStrip(f, currentCounts);
      // Auto-open on non-default; auto-close on reset-to-default. The
      // drawer mirrors the meaningfulness of the filter state.
      const shouldOpen = !isDefaultFilterSpec(f);
      if (shouldOpen !== isOpen) {
        isOpen = shouldOpen;
        drawer.classList.toggle('open', isOpen);
      }
    },
    toggleOpen() {
      isOpen = !isOpen;
      drawer.classList.toggle('open', isOpen);
    },
    isOpen() {
      return isOpen;
    },
    setLoading(loading) {
      drawer.classList.toggle('loading', loading);
    },
    destroy() {
      root.replaceChildren();
    },
  };
}
