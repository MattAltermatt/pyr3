// Gallery filter drawer — UI surface beneath the gallery bar that hosts
// sort / variation / metric controls.
//
// State lives in the URL; the drawer is a controlled component — it never
// holds filter state internally. Every interaction calls opts.onChange with
// the next FilterSpec; main.ts owns the URL write + master-list rebuild and
// feeds the new state back via setFilter / setFacetCounts.
//
// #103 Phase 5 Task 5.6 — replaced the original segmented-pill layout with
// the progressive-disclosure shell: active-chip strip at top, sort row,
// variations row, one collapsible buildMetricRow per metric axis (xform
// count + the 4 stat axes), then footer with Reset + "Apply (N matches)"
// readout. Auto-apply on every change keeps the dispatch path identical
// to the previous wiring — the Apply button reads as a live match count.

import {
  DEFAULT_FILTER_SPEC,
  isDefaultFilterSpec,
  SORT_MODES,
  type FilterSpec,
  type SortDir,
  type SortMode,
} from './gallery-filter';
import { FILTER_LABEL_MAP } from './gallery-facets';
import { mountVariationPicker, type VariationPickerHandle } from './variation-picker';
import { VARIATION_NAMES } from './variations';
import type { ScoreWeights } from './feature-score';
import type { FacetCounts } from './gallery-facets';
// SORT_MODES retained for re-exports / external consumers; SortDir/SortMode
// reach the new buildSortRow widget below.
void SORT_MODES;

export interface FilterDrawerOpts {
  initialFilter: FilterSpec;
  facetCounts: FacetCounts;
  /** Fired when any control inside the drawer changes (including reset). */
  onChange(nextFilter: FilterSpec): void;
  /** When true, the drawer is mounted in a disabled "loading…" state — the
   *  feature index isn't ready yet. main.ts flips this false once
   *  loadFeatureIndex() resolves. */
  loading?: boolean;
  /** Initial live match count for the footer's `Apply (N matches)` readout.
   *  Defaults to 0. Update at runtime via setMatchCount() on the handle. */
  matchCount?: number;
}

export interface FilterDrawerHandle {
  /** Replace the drawer's facet counts (call after every applyFilter so
   *  rows re-render with fresh leave-one-out counts). */
  setFacetCounts(counts: FacetCounts): void;
  /** Mirror state after main.ts has accepted the change — keeps the
   *  drawer's internal DOM in sync with the URL's source of truth. */
  setFilter(filter: FilterSpec): void;
  /** Update the footer's "Apply (N matches)" readout. main.ts feeds this
   *  after every applyFilter so the visitor sees the live match count. */
  setMatchCount(n: number): void;
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
  padding: 12px 16px 4px;
  background: #131316;
  border-bottom: 1px solid #26262c;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: #d8d8de;
}
.pyr3-filter-drawer.open { display: block; }

.pyr3-filter-loading-banner {
  display: none;
  color: #ffbe3e;
  padding: 4px 12px 8px;
  font-style: italic;
}
.pyr3-filter-drawer.loading .pyr3-filter-loading-banner { display: block; }
.pyr3-filter-drawer.loading .pyr3-filter-section {
  opacity: 0.4;
  pointer-events: none;
}

.pyr3-filter-section { padding: 2px 0; }

.pyr3-vars-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  flex-wrap: wrap;
}
.pyr3-vars-row-label { color: #8a8a92; min-width: 62px; }
.pyr3-vars-add-btn {
  background: #15151a;
  color: #8a8a92;
  border: 1px solid #26262c;
  padding: 3px 10px;
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
}
.pyr3-vars-add-btn:hover { background: #1a1a20; color: #d8d8de; }
.pyr3-vars-add-btn.open {
  background: rgba(255, 190, 62, 0.18);
  color: #ffbe3e;
  border-color: rgba(255, 190, 62, 0.4);
}
.pyr3-vars-chips {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
  padding-left: 6px;
}
.pyr3-vars-chip {
  background: rgba(255, 190, 62, 0.12);
  color: #ffbe3e;
  border: 1px solid rgba(255, 190, 62, 0.4);
  padding: 2px 8px;
  border-radius: 8px;
  font-size: 11px;
  cursor: pointer;
  user-select: none;
}
.pyr3-vars-chip:hover { background: rgba(255, 190, 62, 0.22); }
.pyr3-vars-chip-x { padding-left: 4px; opacity: 0.7; }
.pyr3-vars-chip:hover .pyr3-vars-chip-x { opacity: 1; }
.pyr3-vars-picker-panel {
  padding: 8px 16px 12px 78px;
  max-height: 360px;
  overflow-y: auto;
  border-top: 1px solid #26262c;
  border-bottom: 1px solid #26262c;
  margin: 4px 0;
}

.pyr3-filter-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 12px 8px;
  margin-top: 6px;
  border-top: 1px solid #26262c;
}
.pyr3-filter-footer-spacer { flex: 1 1 auto; }
.pyr3-filter-reset {
  background: transparent;
  color: #8a8a92;
  border: 1px solid #26262c;
  padding: 5px 14px;
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
}
.pyr3-filter-reset:hover { background: #1a1a20; color: #d8d8de; }
.pyr3-filter-apply {
  background: linear-gradient(180deg, #ffbe3e 0%, #e87c1a 60%, #bf2408 100%);
  color: #0a0a0c;
  border: 1px solid rgba(255, 190, 62, 0.6);
  padding: 5px 16px;
  border-radius: 3px;
  cursor: default;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  box-shadow: 0 0 12px rgba(255, 190, 62, 0.25);
}
.pyr3-filter-apply:hover { filter: brightness(1.06); }
.pyr3-filter-apply[disabled] { opacity: 0.45; cursor: default; }
`;

function injectStylesOnce(): void {
  if (document.getElementById(STYLES_ID)) return;
  const style = document.createElement('style');
  style.id = STYLES_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

/** The 5 metric axes mounted as collapsible rows below the variations row.
 *  Order matches the chip-strip order so the visitor reads top-to-bottom in
 *  the same sequence as the active-filter chips. `xforms` is the integer-
 *  count axis (1..14+); the other 4 are 0..1 floats. */
type MetricAxis = 'xforms' | 'coverage' | 'entropy' | 'colorVar' | 'meanLum';
const METRIC_AXES: readonly MetricAxis[] = ['xforms', 'coverage', 'entropy', 'colorVar', 'meanLum'];

/** Plain-English labels for the metric rows. xforms uses the FILTER_LABEL_MAP
 *  entry; the four stat axes ship as their FILTER_LABEL_MAP names. */
const METRIC_LABELS: Record<MetricAxis, string> = {
  xforms: FILTER_LABEL_MAP.xforms,
  coverage: FILTER_LABEL_MAP.coverage,
  entropy: FILTER_LABEL_MAP.entropy,
  colorVar: FILTER_LABEL_MAP.colorVar,
  meanLum: FILTER_LABEL_MAP.meanLum,
};

/** Number of histogram buckets for the xform-count axis: integer counts
 *  1..13 each get their own bar; ≥14 collapses into the trailing "14+"
 *  bucket. Matches the `xformBucket(n)` collapse in gallery-facets.ts. */
const XFORM_BUCKETS = 14;

/** Convert the facets' xform-keyed Map (keys 1..13 + 14 for "14+") into a
 *  bucket-indexed Map (keys 0..13) that the histogram primitive consumes
 *  directly. Bucket i ↔ xform count i+1, where bucket 13 is the "14+" tail. */
function xformCountsToMetricBuckets(counts: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  for (let b = 0; b < XFORM_BUCKETS; b++) out.set(b, 0);
  for (const [xform, n] of counts.entries()) {
    if (xform < 1) continue;
    // xformBucket already clamps ≥14 into key 14 — but defend in depth.
    const idx = Math.min(XFORM_BUCKETS - 1, xform - 1);
    out.set(idx, (out.get(idx) ?? 0) + n);
  }
  return out;
}

/** Translate the xform integer range (xformMin / xformMax) into the 0..1
 *  range space the metric row consumes. xformMin=1 → 0.0; xformMin=14 →
 *  13/14 ≈ 0.929; xformMax=null → null (no upper cap). Mirrors the
 *  14-bucket layout so the in-range bracket aligns with each bar. */
function xformRangeToMetricFloat(min: number, max: number | null): { min: number; max: number | null } {
  const lo = Math.min(XFORM_BUCKETS - 1, Math.max(0, min - 1)) / XFORM_BUCKETS;
  if (max === null) return { min: lo, max: null };
  const hi = Math.min(XFORM_BUCKETS, Math.max(1, max));
  return { min: lo, max: hi / XFORM_BUCKETS };
}

/** Reverse the float-space mapping back to xform integer bounds for
 *  re-emission into FilterSpec. min=0.0 → xformMin=1; max=null stays null;
 *  max → round(max * 14); when that hits the trailing "14+" bucket
 *  (xformMax≥14) we saturate to null (no cap) so FilterSpec stays canonical. */
function metricFloatToXformRange(min: number, max: number | null): { min: number; max: number | null } {
  const lo = Math.max(1, Math.round(min * XFORM_BUCKETS) + 1);
  if (max === null) return { min: lo, max: null };
  const hi = Math.round(max * XFORM_BUCKETS);
  return { min: lo, max: hi >= XFORM_BUCKETS ? null : hi };
}

/** Bucket-label fn for the xform-count axis. Bucket index 0..12 → "1".."13";
 *  bucket 13 → the "14+" tail marker. */
function xformBucketLabel(i: number): string {
  return i < XFORM_BUCKETS - 1 ? String(i + 1) : '14+';
}

export function mountFilterDrawer(
  root: HTMLElement,
  opts: FilterDrawerOpts,
): FilterDrawerHandle {
  injectStylesOnce();
  root.replaceChildren();

  let currentFilter = opts.initialFilter;
  let currentCounts = opts.facetCounts;
  let currentMatchCount = opts.matchCount ?? 0;
  let isOpen = !isDefaultFilterSpec(currentFilter);
  // Live sortDir — kept here so rapid double-clicks on the direction toggle
  // don't read a stale closure capture from buildSortRow. handleDirChange
  // mutates this synchronously BEFORE emitting onChange (which may re-route
  // through async setFilter and eventually rebuild the row).
  let currentSortDir: SortDir = currentFilter.sortDir;

  const drawer = document.createElement('div');
  drawer.className = `pyr3-filter-drawer${isOpen ? ' open' : ''}${opts.loading ? ' loading' : ''}`;

  // Loading banner — shown when the feature index isn't ready yet.
  const loadingBanner = document.createElement('div');
  loadingBanner.className = 'pyr3-filter-loading-banner';
  loadingBanner.textContent = 'loading feature index… (filters arrive in ~0.5s)';
  drawer.appendChild(loadingBanner);

  // ── Active filter chip strip (top — progressive-disclosure summary) ──
  // The chip strip is a stateless DOM builder, so the panel owns the
  // remount-on-state-change responsibility. We park it in a wrapper div so
  // re-renders can replace its contents without affecting siblings.
  const chipStripWrap = document.createElement('div');
  chipStripWrap.className = 'pyr3-filter-section pyr3-filter-chip-strip-wrap';
  drawer.appendChild(chipStripWrap);

  function rebuildChipStrip(): void {
    const strip = buildActiveChipStrip(currentFilter, handleChipRemove, handleChipClearAll);
    chipStripWrap.replaceChildren(strip);
  }

  function handleChipRemove(id: ActiveChipId): void {
    if (id.startsWith('vars:')) {
      const v = Number(id.slice('vars:'.length));
      opts.onChange({ ...currentFilter, vars: currentFilter.vars.filter((i) => i !== v) });
      return;
    }
    if (id === 'xforms') {
      opts.onChange({
        ...currentFilter,
        xformMin: DEFAULT_FILTER_SPEC.xformMin,
        xformMax: DEFAULT_FILTER_SPEC.xformMax,
      });
      return;
    }
    // Stat axes — coverage, entropy, colorVar, meanLum.
    const minKey = `${id}Min` as const;
    const maxKey = `${id}Max` as const;
    opts.onChange({
      ...currentFilter,
      [minKey]: 0,
      [maxKey]: null,
    } as FilterSpec);
  }

  function handleChipClearAll(): void {
    // Clear every active filter axis but keep the current sort + sortDir.
    // "Clear all" reads as "drop filters", not "reset sort too".
    opts.onChange({
      ...DEFAULT_FILTER_SPEC,
      sort: currentFilter.sort,
      sortDir: currentFilter.sortDir,
      weights: currentFilter.weights,
    });
  }

  // ── Sort row (buildSortRow widget — dropdown + direction toggle) ──
  const sortRowWrap = document.createElement('div');
  sortRowWrap.className = 'pyr3-filter-section pyr3-filter-sort-row-wrap';
  drawer.appendChild(sortRowWrap);

  function rebuildSortRow(): void {
    const row = buildSortRow(
      currentFilter,
      handleSortChange,
      handleDirChange,
      () => currentSortDir,
    );
    sortRowWrap.replaceChildren(row);
  }

  function handleSortChange(next: SortMode): void {
    opts.onChange({ ...currentFilter, sort: next });
  }

  function handleDirChange(next: SortDir): void {
    // Update the live mirror FIRST so a rapid double-click reads the new
    // direction even though `currentFilter` only refreshes through the
    // async setFilter path.
    currentSortDir = next;
    opts.onChange({ ...currentFilter, sortDir: next });
  }

  // ── Variations row — add-button + active chip strip + picker panel ──
  const varsRow = document.createElement('div');
  varsRow.className = 'pyr3-filter-section pyr3-vars-row';
  const varsLabel = document.createElement('span');
  varsLabel.className = 'pyr3-vars-row-label';
  varsLabel.textContent = 'variations:';
  varsRow.appendChild(varsLabel);

  const addVarBtn = document.createElement('button');
  addVarBtn.type = 'button';
  addVarBtn.className = 'pyr3-vars-add-btn';
  addVarBtn.textContent = '+ add ▾';
  addVarBtn.title = 'open the variation picker — filter by which variations the flame uses (AND across selections)';
  varsRow.appendChild(addVarBtn);

  const varsChips = document.createElement('span');
  varsChips.className = 'pyr3-vars-chips';
  varsRow.appendChild(varsChips);

  drawer.appendChild(varsRow);

  const varsPickerPanel = document.createElement('div');
  varsPickerPanel.className = 'pyr3-vars-picker-panel pyr3-filter-section';
  varsPickerPanel.style.display = 'none';

  let varsPickerHandle: VariationPickerHandle | null = null;
  let varsPickerOpen = false;

  function renderVarsChips(vars: number[]): void {
    varsChips.replaceChildren();
    for (const v of vars) {
      const chip = document.createElement('span');
      chip.className = 'pyr3-vars-chip';
      const name = VARIATION_NAMES[v] ?? `var${v}`;
      chip.append(
        document.createTextNode(`${name} `),
        Object.assign(document.createElement('span'), { className: 'pyr3-vars-chip-x', textContent: '×' }),
      );
      chip.title = `remove ${name} from the variation filter`;
      chip.onclick = () => {
        opts.onChange({ ...currentFilter, vars: currentFilter.vars.filter((i) => i !== v) });
      };
      varsChips.appendChild(chip);
    }
  }

  function syncVarsPicker(): void {
    if (varsPickerHandle !== null) {
      varsPickerHandle.setState({
        selected: currentFilter.vars,
        counts: currentCounts.variations,
      });
    }
  }

  function toggleVarsPicker(): void {
    varsPickerOpen = !varsPickerOpen;
    varsPickerPanel.style.display = varsPickerOpen ? 'block' : 'none';
    addVarBtn.classList.toggle('open', varsPickerOpen);
    if (varsPickerOpen && varsPickerHandle === null) {
      varsPickerHandle = mountVariationPicker(varsPickerPanel, {
        selected: currentFilter.vars,
        counts: currentCounts.variations,
        onChange: (nextVars) => {
          opts.onChange({ ...currentFilter, vars: nextVars });
        },
      });
    } else if (varsPickerOpen) {
      syncVarsPicker();
    }
  }

  addVarBtn.onclick = (e) => {
    e.stopPropagation();
    toggleVarsPicker();
  };

  // Click-outside dismissal — close the picker when the click target is
  // outside both the picker panel AND the [+ add ▾] button. Composed-path
  // check survives mid-event re-renders.
  const onDocumentClick = (e: MouseEvent): void => {
    if (!varsPickerOpen) return;
    const path = e.composedPath();
    if (path.includes(varsPickerPanel) || path.includes(addVarBtn)) return;
    varsPickerOpen = false;
    varsPickerPanel.style.display = 'none';
    addVarBtn.classList.remove('open');
  };
  document.addEventListener('click', onDocumentClick);

  renderVarsChips(currentFilter.vars);
  drawer.appendChild(varsPickerPanel);

  // ── Collapsible metric rows (5 axes — xforms, coverage, entropy,
  //    colorVar, meanLum). Each row mounts via buildMetricRow with its
  //    facet histogram + range bounds; the row wires brush-select drag
  //    internally. We park each in a wrapper so re-renders on setFilter /
  //    setFacetCounts can rebuild the row without rebuilding siblings. ──
  const metricRowWraps: Record<MetricAxis, HTMLDivElement> = {} as Record<MetricAxis, HTMLDivElement>;
  for (const axis of METRIC_AXES) {
    const wrap = document.createElement('div');
    wrap.className = `pyr3-filter-section pyr3-filter-metric-row-wrap`;
    wrap.dataset.metric = axis;
    metricRowWraps[axis] = wrap;
    drawer.appendChild(wrap);
  }

  function rebuildMetricRow(axis: MetricAxis): void {
    const wrap = metricRowWraps[axis];
    // Preserve expansion across rebuild — a brush-select drag dispatches
    // onChange → setFilter → rebuildAllMetricRows. Without snapshotting
    // the prior expansion state, the newly-built row defaults to collapsed
    // and the drawer slams shut mid-selection. (User-flagged 2026-06-05.)
    const prevBody = wrap.querySelector('.pyr3-metric-body') as HTMLElement | null;
    const wasExpanded = prevBody !== null && prevBody.style.display === 'block';

    let min: number;
    let max: number | null;
    let buckets: Map<number, number>;
    let onRange: (min: number, max: number | null) => void;

    let formatValue: ((min: number, max: number | null) => string) | undefined;
    if (axis === 'xforms') {
      const re = xformRangeToMetricFloat(currentFilter.xformMin, currentFilter.xformMax);
      min = re.min;
      max = re.max;
      buckets = xformCountsToMetricBuckets(currentCounts.xforms);
      onRange = (lo, hi) => {
        const xf = metricFloatToXformRange(lo, hi);
        opts.onChange({ ...currentFilter, xformMin: xf.min, xformMax: xf.max });
      };
      // Render the row's range readout in integer xform-count units (e.g.
      // "4–6", "≥ 3", "all") instead of the metric-float default ("0.3–0.6"),
      // so the row matches the active-chip strip's "xform count 4–6" display.
      formatValue = (lo, hi) => {
        const xf = metricFloatToXformRange(lo, hi);
        return formatXformRange(xf.min, xf.max) ?? 'all';
      };
    } else {
      const minKey = `${axis}Min` as const;
      const maxKey = `${axis}Max` as const;
      min = currentFilter[minKey] as number;
      max = currentFilter[maxKey] as number | null;
      buckets = currentCounts[axis];
      onRange = (lo, hi) => {
        opts.onChange({
          ...currentFilter,
          [minKey]: lo,
          [maxKey]: hi,
        } as FilterSpec);
      };
    }

    const row = buildMetricRow({
      metric: axis === 'xforms' ? 'coverage' : (axis as 'coverage' | 'entropy' | 'colorVar' | 'meanLum'),
      label: METRIC_LABELS[axis],
      min,
      max,
      counts: buckets,
      onRange,
      formatValue,
      bucketCount: axis === 'xforms' ? XFORM_BUCKETS : undefined,
      bucketLabels: axis === 'xforms' ? xformBucketLabel : undefined,
      initiallyExpanded: wasExpanded,
    });
    // Preserve metric key on the row's dataset for downstream test
    // assertions / event delegation (buildMetricRow stamps a fallback type
    // but the panel knows its truth — keep xforms labelled correctly).
    row.dataset.metric = axis;
    wrap.replaceChildren(row);
  }

  function rebuildAllMetricRows(): void {
    for (const axis of METRIC_AXES) rebuildMetricRow(axis);
  }

  // ── Footer — Reset (secondary) + Apply (popped CTA, live match count) ──
  const footer = document.createElement('div');
  footer.className = 'pyr3-filter-section pyr3-filter-footer';

  const footerSpacer = document.createElement('span');
  footerSpacer.className = 'pyr3-filter-footer-spacer';
  footer.appendChild(footerSpacer);

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'pyr3-filter-reset';
  resetBtn.textContent = '✕ reset';
  resetBtn.title = 'clear every filter and reset sort to chronological';
  resetBtn.onclick = () => opts.onChange(DEFAULT_FILTER_SPEC);
  footer.appendChild(resetBtn);

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'pyr3-filter-apply';
  // Filter changes auto-apply to the gallery instantly. The Apply button's
  // job is the "I'm done picking filters" affordance — click → dismiss the
  // drawer so the visitor can see the filtered grid unobstructed.
  const renderApplyLabel = (n: number): void => {
    const label = n === 1 ? 'match' : 'matches';
    applyBtn.textContent = `Apply (${n.toLocaleString()} ${label})`;
  };
  renderApplyLabel(currentMatchCount);
  applyBtn.title = 'close filters — auto-apply is on, so every change updates the gallery instantly; this button just dismisses the drawer.';
  applyBtn.onclick = () => {
    isOpen = false;
    drawer.classList.toggle('open', false);
  };
  footer.appendChild(applyBtn);

  drawer.appendChild(footer);

  // Initial mount of widgets that don't have a stable "first render"
  // (chip strip + sort row + metric rows are state-driven; do them once
  // now so the visitor sees them on first open).
  rebuildChipStrip();
  rebuildSortRow();
  rebuildAllMetricRows();

  root.appendChild(drawer);

  return {
    setFacetCounts(c) {
      currentCounts = c;
      rebuildAllMetricRows();
      syncVarsPicker();
    },
    setFilter(f) {
      currentFilter = f;
      currentSortDir = f.sortDir;
      rebuildChipStrip();
      rebuildSortRow();
      rebuildAllMetricRows();
      renderVarsChips(f.vars);
      syncVarsPicker();
      // Auto-OPEN on non-default state (covers initial mount + popstate
      // landing on a filtered URL). Never auto-CLOSE — that belongs to the
      // visitor's filter pill click.
      if (!isOpen && !isDefaultFilterSpec(f)) {
        isOpen = true;
        drawer.classList.toggle('open', true);
      }
    },
    setMatchCount(n) {
      currentMatchCount = n;
      renderApplyLabel(n);
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
      document.removeEventListener('click', onDocumentClick);
      varsPickerHandle?.destroy();
      root.replaceChildren();
    },
  };
}

// ScoreWeights kept reachable in scope — main.ts re-imports it elsewhere
// but TS still warns when the import sits unused here after the rewrite.
// The custom-tune panel was retired in the progressive-disclosure layout;
// if it returns it'll re-use this import.
void (null as unknown as ScoreWeights);


// ──────────────────────────────────────────────────────────────────────────
// Task 5.2 — Active filter chip strip
// ──────────────────────────────────────────────────────────────────────────
//
// `buildActiveChipStrip` returns a flex row of amber-tinted pill chips —
// one per currently-active filter axis — with a `× clear all` link on the
// right. Each chip carries a tiny × button that fires `onRemove(chipId)`;
// the right-side link fires `onClearAll()`. The strip never mutates state
// itself — composition + state-write happens at the panel level (Task 5.6
// wires this into mountFilterDrawer).
//
// Stable axis order: vars (one chip per selected variation, sorted asc) →
// xforms → coverage → entropy → colorVar → meanLum. The order mirrors the
// FilterSpec field order so chip strip and metric rows below scan in the
// same direction.

/** Identifier emitted by `onRemove` so the caller knows which axis (or
 *  which individual variation) to clear from the FilterSpec.
 *  - `vars:<idx>` — remove that one variation from `spec.vars`
 *  - `xforms` | `coverage` | `entropy` | `colorVar` | `meanLum` — reset
 *    that axis's min/max to DEFAULT_FILTER_SPEC values */
export type ActiveChipId =
  | `vars:${number}`
  | 'xforms'
  | 'coverage'
  | 'entropy'
  | 'colorVar'
  | 'meanLum';

const CHIP_STYLES_ID = 'pyr3-active-chip-styles';

const CHIP_STYLES = `
.pyr3-active-chip-strip {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.pyr3-active-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  background: rgba(255, 190, 62, 0.12);
  border: 1px solid rgba(255, 190, 62, 0.4);
  color: #ffbe3e;
  border-radius: 12px;
  white-space: nowrap;
  user-select: none;
}
.pyr3-active-chip-x {
  cursor: pointer;
  opacity: 0.7;
  padding: 0 2px;
  font-size: 13px;
  line-height: 1;
}
.pyr3-active-chip-x:hover { opacity: 1; }
.pyr3-active-chip-clear-all {
  margin-left: auto;
  color: rgba(255, 190, 62, 0.7);
  cursor: pointer;
  font-size: 12px;
  background: transparent;
  border: none;
  padding: 3px 8px;
  font-family: inherit;
}
.pyr3-active-chip-clear-all:hover {
  color: #ffbe3e;
  text-decoration: underline;
}
`;

function injectChipStylesOnce(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(CHIP_STYLES_ID)) return;
  const style = document.createElement('style');
  style.id = CHIP_STYLES_ID;
  style.textContent = CHIP_STYLES;
  document.head.appendChild(style);
}

/** Format a 0..1 range as a human-readable string for a chip label.
 *  - Both bounds defaulted → null (caller skips emitting the chip)
 *  - Lower-only → `≥ X.X`
 *  - Upper-only → `≤ X.X`
 *  - Both bounds → `X.X–Y.Y` (en-dash, not hyphen, per design spec)
 */
function formatStatRange(min: number, max: number | null): string | null {
  const lowerActive = min > 0;
  const upperActive = max !== null;
  if (!lowerActive && !upperActive) return null;
  if (lowerActive && !upperActive) return `≥ ${min.toFixed(1)}`;
  if (!lowerActive && upperActive) return `≤ ${(max as number).toFixed(1)}`;
  return `${min.toFixed(1)}–${(max as number).toFixed(1)}`;
}

/** Format an xform-count range as a human-readable string. Returns null
 *  when the range matches the default (min=1, max=null = no cap). */
function formatXformRange(min: number, max: number | null): string | null {
  const lowerActive = min !== DEFAULT_FILTER_SPEC.xformMin;
  const upperActive = max !== DEFAULT_FILTER_SPEC.xformMax;
  if (!lowerActive && !upperActive) return null;
  if (lowerActive && max === null) return `≥ ${min}`;
  if (!lowerActive && max !== null) return `≤ ${max}`;
  if (min === max) return `${min}`;
  return `${min}–${max as number}`;
}

interface ChipDescriptor {
  id: ActiveChipId;
  label: string;
  value: string;
}

/** Walk the FilterSpec and produce one ChipDescriptor per active axis. The
 *  result is in canonical order (vars first, then xforms, then the four
 *  stats) — the chip strip + metric rows below scan in the same direction. */
function describeActiveChips(spec: FilterSpec): ChipDescriptor[] {
  const out: ChipDescriptor[] = [];

  // Variations: one chip per selected variation index. spec.vars is kept
  // sorted ascending as a class invariant — we keep that order here.
  for (const v of spec.vars) {
    const name = VARIATION_NAMES[v] ?? `var${v}`;
    out.push({ id: `vars:${v}`, label: 'variation', value: name });
  }

  const xfRange = formatXformRange(spec.xformMin, spec.xformMax);
  if (xfRange !== null) {
    out.push({ id: 'xforms', label: FILTER_LABEL_MAP.xforms, value: xfRange });
  }

  const stats: Array<['coverage' | 'entropy' | 'colorVar' | 'meanLum']> = [
    ['coverage'], ['entropy'], ['colorVar'], ['meanLum'],
  ];
  for (const [stat] of stats) {
    const minKey = `${stat}Min` as const;
    const maxKey = `${stat}Max` as const;
    const range = formatStatRange(spec[minKey] as number, spec[maxKey] as number | null);
    if (range !== null) {
      out.push({ id: stat, label: FILTER_LABEL_MAP[stat], value: range });
    }
  }

  return out;
}

/**
 * Count of active filter chips for a given spec. Returns the same number
 * as `describeActiveChips(spec).length` — exported so the gallery info-bar
 * filter pill can render a "N active" badge matching the chip strip exactly.
 *
 * One chip per selected variation + one per active metric axis (xform count,
 * coverage, entropy, colorVar, meanLum). Sort axis is NOT counted — the sort
 * dropdown is always visible in the panel; it isn't a "filter that hides
 * things from view".
 */
export function activeFilterCount(spec: FilterSpec): number {
  return describeActiveChips(spec).length;
}

/**
 * Build the active-filter chip strip — a flex row of amber-tinted pill
 * chips for each currently-active axis, with a `× clear all` link on the
 * right. The strip is a stateless DOM builder; the caller owns FilterSpec
 * state and decides what to do on remove / clear-all callbacks.
 *
 * Returns the strip's root element so the caller can append it directly
 * into whatever panel composition lives upstream.
 */
export function buildActiveChipStrip(
  spec: FilterSpec,
  onRemove: (id: ActiveChipId) => void,
  onClearAll: () => void,
): HTMLElement {
  injectChipStylesOnce();

  const strip = document.createElement('div');
  strip.className = 'pyr3-active-chip-strip';

  const chips = describeActiveChips(spec);

  for (const c of chips) {
    const chip = document.createElement('span');
    chip.className = 'pyr3-active-chip';
    chip.dataset.chipId = c.id;
    // Label · value · ×  — span keeps the × in the chip tap target without
    // making the whole chip clickable (which would conflict with the
    // future "click chip → re-open metric row" affordance).
    const text = document.createElement('span');
    text.textContent = `${c.label} ${c.value}`;
    chip.appendChild(text);
    const x = document.createElement('span');
    x.className = 'pyr3-active-chip-x';
    x.textContent = '×';
    x.title = `remove ${c.label} filter`;
    x.onclick = () => onRemove(c.id);
    chip.appendChild(x);
    strip.appendChild(chip);
  }

  // Clear-all link only appears when at least one chip rendered — when no
  // filters are active there's nothing to clear and the link is dead UI.
  if (chips.length > 0) {
    const clearAll = document.createElement('button');
    clearAll.type = 'button';
    clearAll.className = 'pyr3-active-chip-clear-all';
    clearAll.textContent = '× clear all';
    clearAll.title = 'clear every active filter (sort stays)';
    clearAll.onclick = () => onClearAll();
    strip.appendChild(clearAll);
  }

  return strip;
}

// ──────────────────────────────────────────────────────────────────────────
// Task 5.3 — Sort dropdown + direction toggle
// ──────────────────────────────────────────────────────────────────────────
//
// `buildSortRow` returns a row containing the "sort" label, a <select>
// dropdown of the 6 named sort modes (the `custom` mode is excluded — the
// tune panel toggles it on, no direct pick affordance), and a direction
// toggle button (`↓ desc` / `↑ asc`). It's a stateless builder; callers
// pass `onSortChange` and `onDirChange` to receive change events.
//
// Wired into the live filter panel in Task 5.6. Until then it's standalone
// so it can be unit-tested in isolation and previewed without disturbing
// the existing segmented-pill sort UI.

const SORT_ROW_STYLES_ID = 'pyr3-sort-row-styles';

const SORT_ROW_STYLES = `
.pyr3-sort-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: #d8d8de;
}
.pyr3-sort-row-label {
  color: #8a8a92;
  min-width: 40px;
}
.pyr3-sort-select {
  background: #15151a;
  color: #d8d8de;
  border: 1px solid #26262c;
  padding: 3px 8px;
  border-radius: 3px;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}
.pyr3-sort-select:hover { background: #1a1a20; }
.pyr3-sort-dir-btn {
  background: #15151a;
  color: #d8d8de;
  border: 1px solid #26262c;
  padding: 3px 10px;
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
}
.pyr3-sort-dir-btn:hover { background: #1a1a20; }
`;

function injectSortRowStylesOnce(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(SORT_ROW_STYLES_ID)) return;
  const style = document.createElement('style');
  style.id = SORT_ROW_STYLES_ID;
  style.textContent = SORT_ROW_STYLES;
  document.head.appendChild(style);
}

/** Sort modes shown in the dropdown — every mode in SORT_MODES except
 *  `custom`, which is a UI-only state the tune panel toggles on when the
 *  visitor edits weights. There's no "click me" affordance for custom in
 *  the dropdown to avoid a dead option that does nothing when picked. */
const NAMED_SORT_MODES: readonly SortMode[] = SORT_MODES.filter((m) => m !== 'custom');

/**
 * Build the sort row — `[sort] [select ▾] [↓ desc | ↑ asc]`. Standalone DOM
 * builder; caller owns FilterSpec state and decides what to do on
 * `onSortChange(newKey)` / `onDirChange(newDir)`.
 *
 * `liveSortDir` is an optional getter — the direction toggle reads through it
 * on every click rather than caching `spec.sortDir` in a closure. This avoids
 * a stale-capture bug on rapid double-clicks: caller can update the live
 * value synchronously, while the spec round-trips through async onChange /
 * setFilter. When omitted, the initial spec.sortDir is used (back-compat).
 */
export function buildSortRow(
  spec: FilterSpec,
  onSortChange: (next: SortMode) => void,
  onDirChange: (next: SortDir) => void,
  liveSortDir?: () => SortDir,
): HTMLElement {
  injectSortRowStylesOnce();

  const row = document.createElement('div');
  row.className = 'pyr3-sort-row';

  const label = document.createElement('span');
  label.className = 'pyr3-sort-row-label';
  label.textContent = 'sort';
  row.appendChild(label);

  // Dropdown — populated from SORT_MODES (excluding `custom`). The select's
  // value reflects spec.sort; if spec.sort is `custom`, the select falls
  // back to showing the first named option since `custom` has no entry —
  // but the tune panel UI will indicate the custom state separately.
  const select = document.createElement('select');
  select.className = 'pyr3-sort-select';
  for (const mode of NAMED_SORT_MODES) {
    const opt = document.createElement('option');
    opt.value = mode;
    opt.textContent = mode;
    select.appendChild(opt);
  }
  if ((NAMED_SORT_MODES as readonly string[]).includes(spec.sort)) {
    select.value = spec.sort;
  }
  select.addEventListener('change', () => {
    onSortChange(select.value as SortMode);
  });
  row.appendChild(select);

  // Direction toggle — shows the current direction and, on click, fires
  // the inverse. Visitor reads the current state from the glyph + label.
  const dirBtn = document.createElement('button');
  dirBtn.type = 'button';
  dirBtn.className = 'pyr3-sort-dir-btn';
  const renderDir = (dir: SortDir): void => {
    dirBtn.textContent = dir === 'desc' ? '↓ desc' : '↑ asc';
    dirBtn.title = dir === 'desc'
      ? 'sort direction: descending (highest first). click to flip to ascending.'
      : 'sort direction: ascending (lowest first). click to flip to descending.';
  };
  renderDir(spec.sortDir);
  dirBtn.onclick = () => {
    // Read live, not from closure. A rapid double-click on a stale closure
    // would emit the same direction twice; reading through the getter sees
    // the synchronous update the caller made on the previous click.
    const dir = liveSortDir ? liveSortDir() : spec.sortDir;
    onDirChange(dir === 'desc' ? 'asc' : 'desc');
  };
  row.appendChild(dirBtn);

  return row;
}

// ──────────────────────────────────────────────────────────────────────────
// Task 5.4 — Collapsible metric rows with histogram
// ──────────────────────────────────────────────────────────────────────────
//
// `buildMetricRow` returns a vertical stack: a header (chevron + label +
// current-range value) on top, and an expanded body (10-bucket histogram +
// edge brackets + range readout) below. Clicking the header toggles the
// body open/closed. The histogram bars carry an `.in-range` class when
// their bucket falls inside the current [min, max] range — the row's
// caller picks the colors via CSS.
//
// In-range bucket convention mirrors the existing `mountStatRow`:
//   minBucket = floor(min × 10)
//   maxBucket = max === null ? 9 : ceil(max × 10) - 1
// So a min=0.3 / max=0.7 range covers buckets 3..6 (i.e. the deciles
// [0.3, 0.4) … [0.6, 0.7)).
//
// The row is standalone — no FilterSpec coupling. The caller passes the
// current bounds + bucket counts + an `onRange(min, max | null)` callback,
// and Task 5.5's `attachBrushSelect` wires drag-to-select onto the
// histogram automatically (no separate wiring needed at the call site).

export type MetricKey = 'coverage' | 'entropy' | 'colorVar' | 'meanLum';

export interface MetricRowOpts {
  metric: MetricKey;
  label: string;
  /** Current lower bound on the metric in 0..1 (inclusive). */
  min: number;
  /** Current upper bound on the metric in 0..1 (exclusive at decile edge),
   *  or null for "no upper cap". When BOTH min=0 AND max=null the row's
   *  header displays `all` instead of a numeric range. */
  max: number | null;
  /** Decile bucket (0..9) → count of records in that bucket. Missing
   *  buckets are treated as 0. */
  counts: Map<number, number>;
  /** Fired when the user brush-selects a new range. Lower bound is always
   *  the decile floor (e.g. 0.3 for bucket 3); upper bound is the next
   *  decile ceiling (e.g. 0.8 for bucket 7, since bucket 7 = [0.7, 0.8)
   *  — see the upper-edge convention in mountStatRow). max=1.0 maps to
   *  null (no cap) so the spec stays canonical. */
  onRange: (min: number, max: number | null) => void;
  /** Optional cold-start expanded mode — when true the body opens
   *  immediately. Default false (collapsed). */
  initiallyExpanded?: boolean;
  /** Optional custom range formatter. Receives the 0..1 (min, max) and
   *  returns the display string. Used by the xform-count axis to render
   *  in integer xform-count units ("4–6") instead of the metric-float
   *  default ("0.3–0.6") since the underlying filter is integer-valued. */
  formatValue?: (min: number, max: number | null) => string;
  /** Number of histogram buckets. Default 10 (the 0..1 decile axes). The
   *  xform-count axis passes 14 (1..13 individual + "14+" tail). When
   *  changed, brush-select snaps to N buckets too. */
  bucketCount?: number;
  /** Optional label for the i-th bucket, rendered below each bar. Default
   *  is the bucket's upper-bound to one decimal (e.g. `0.1`, `0.2`, …,
   *  `1.0` for the default 10-bucket axes). Xforms override with the
   *  integer-count labels (`1`, `2`, …, `13`, `14+`). */
  bucketLabels?: (i: number) => string;
}

const METRIC_ROW_STYLES_ID = 'pyr3-metric-row-styles';

const METRIC_ROW_STYLES = `
.pyr3-metric-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 12px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: #d8d8de;
}
.pyr3-metric-header {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.pyr3-metric-header:hover { color: #ffbe3e; }
.pyr3-metric-chevron {
  display: inline-block;
  width: 12px;
  text-align: center;
  color: #8a8a92;
}
.pyr3-metric-label {
  color: #d8d8de;
  flex: 0 0 auto;
  /* Pin a min-width so the value text doesn't shift the row's center as
   * the range changes (matches the "no-jump UI" convention). */
  min-width: 110px;
}
.pyr3-metric-value {
  color: #8a8a92;
  font-size: 11px;
}
.pyr3-metric-body {
  display: none;
  padding: 6px 0 4px;
}
.pyr3-metric-histogram {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(0, 0, 0, 0.18);
  border-radius: 3px;
  padding: 4px;
  cursor: crosshair;
}
.pyr3-metric-count-row,
.pyr3-metric-axis-row {
  display: flex;
  gap: 2px;
}
.pyr3-metric-count,
.pyr3-metric-axislabel {
  flex: 1 1 0;
  min-width: 0;
  font-family: ui-monospace, monospace;
  font-size: 10px;
  line-height: 1;
  color: #8a8a92;
  text-align: center;
  white-space: nowrap;
  overflow: visible;
  pointer-events: none;
}
.pyr3-metric-count {
  color: #b6b6bd;
}
.pyr3-metric-bar-row {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 48px;
}
.pyr3-metric-bar {
  flex: 1 1 0;
  background: #e87c1a;
  opacity: 0.35;
  border-radius: 1px;
  transition: opacity 80ms ease-out;
  min-height: 2px;
}
.pyr3-metric-bar.in-range {
  background: #ffbe3e;
  opacity: 1;
}
.pyr3-metric-bracket {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #ffbe3e;
  pointer-events: none;
}
.pyr3-metric-readout {
  margin-top: 4px;
  color: #8a8a92;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.pyr3-metric-reset {
  background: transparent;
  border: 1px solid #3a3a44;
  color: #8a8a92;
  font-family: inherit;
  font-size: 10px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
  transition: color 80ms ease-out, border-color 80ms ease-out;
}
.pyr3-metric-reset:hover {
  color: #ffbe3e;
  border-color: #ffbe3e;
}
.pyr3-metric-tooltip {
  display: none;
  position: absolute;
  top: -22px;
  left: 50%;
  transform: translateX(-50%);
  padding: 2px 8px;
  background: rgba(20, 20, 23, 0.95);
  color: #ffbe3e;
  border: 1px solid #26262c;
  border-radius: 3px;
  font-size: 10px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 5;
}
.pyr3-metric-histogram:hover .pyr3-metric-tooltip { display: block; }
`;

function injectMetricRowStylesOnce(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(METRIC_ROW_STYLES_ID)) return;
  const style = document.createElement('style');
  style.id = METRIC_ROW_STYLES_ID;
  style.textContent = METRIC_ROW_STYLES;
  document.head.appendChild(style);
}

/** Format the current range for the header line. Returns `all` when both
 *  bounds are at their defaults (min=0, max=null) — the "all" sentinel is
 *  more legible than `0.0–all` at a glance. Otherwise emits an en-dash
 *  range (e.g. `0.3–0.7`) for both-bounded, `≥ 0.3` for lower-only,
 *  `≤ 0.7` for upper-only. */
function formatMetricRange(min: number, max: number | null): string {
  if (min === 0 && max === null) return 'all';
  if (min > 0 && max === null) return `≥ ${min.toFixed(1)}`;
  if (min === 0 && max !== null) return `≤ ${max.toFixed(1)}`;
  return `${min.toFixed(1)}–${(max as number).toFixed(1)}`;
}

/** Compute the in-range bucket span for a given (min, max) selection,
 *  matching mountStatRow's exclusive-upper-edge convention. N is the
 *  histogram's bucket count (10 for stats, 14 for xforms). */
function rangeToBuckets(min: number, max: number | null, n: number): { lo: number; hi: number } {
  const last = n - 1;
  const lo = Math.min(last, Math.max(0, Math.floor(min * n)));
  const hi = max === null ? last : Math.min(last, Math.max(0, Math.ceil(max * n) - 1));
  return { lo, hi };
}

/**
 * Build a collapsible metric row — header + (when expanded) histogram +
 * range readout. The histogram auto-wires brush-select drag (Task 5.5)
 * so the row is a complete drop-in for the filter drawer's metric axes.
 *
 * Standalone DOM builder; the caller owns FilterSpec state and decides
 * what to do with the `onRange(min, max | null)` callback.
 */
export function buildMetricRow(opts: MetricRowOpts): HTMLElement {
  injectMetricRowStylesOnce();

  // Bucket count is configurable so the xform-count axis can render its
  // full 14-bucket spread (1..13 + "14+") through the same primitive that
  // serves the 10-decile stat axes.
  const N = opts.bucketCount ?? 10;
  const defaultBucketLabel = (i: number): string => ((i + 1) / N).toFixed(1);
  const bucketLabel = opts.bucketLabels ?? defaultBucketLabel;

  const row = document.createElement('div');
  row.className = 'pyr3-metric-row';
  row.dataset.metric = opts.metric;

  // Header — chevron + label + current-range value. Click anywhere on the
  // header toggles the body open/closed; the chevron is just a visual cue.
  const header = document.createElement('div');
  header.className = 'pyr3-metric-header';

  const chevron = document.createElement('span');
  chevron.className = 'pyr3-metric-chevron';
  chevron.textContent = '▸';
  header.appendChild(chevron);

  const labelEl = document.createElement('span');
  labelEl.className = 'pyr3-metric-label';
  labelEl.textContent = opts.label;
  header.appendChild(labelEl);

  const valueEl = document.createElement('span');
  valueEl.className = 'pyr3-metric-value';
  valueEl.textContent = opts.formatValue
    ? opts.formatValue(opts.min, opts.max)
    : formatMetricRange(opts.min, opts.max);
  header.appendChild(valueEl);

  row.appendChild(header);

  // Body — histogram + readout. Hidden by default; clicking the header
  // toggles `display: block` and the chevron between ▸ and ▾.
  const body = document.createElement('div');
  body.className = 'pyr3-metric-body';

  const histogram = document.createElement('div');
  histogram.className = 'pyr3-metric-histogram';

  // Hover-tooltip ("click & drag to select range") — display:none by
  // default; CSS `:hover` on the histogram flips it to display:block.
  // Cheaper than a JS hover handler and accessibility-friendly.
  const tooltip = document.createElement('div');
  tooltip.className = 'pyr3-metric-tooltip';
  tooltip.textContent = 'click & drag to select range';
  histogram.appendChild(tooltip);

  // Normalize bar heights against the max bucket count. Empty histogram
  // (all zeros) → every bar gets 0% (we still emit a valid percentage so
  // the CSS doesn't end up with `NaN%` / `Infinity%`).
  let maxCount = 0;
  for (const v of opts.counts.values()) {
    if (v > maxCount) maxCount = v;
  }

  const { lo: rangeLo, hi: rangeHi } = rangeToBuckets(opts.min, opts.max, N);

  // Stacked rows: count labels above bars, bars in the middle (with the
  // amber range brackets overlaying), axis labels below. Each row is its
  // own flex of N equal cells so labels align column-for-column with bars.
  const countRow = document.createElement('div');
  countRow.className = 'pyr3-metric-count-row';

  const barRow = document.createElement('div');
  barRow.className = 'pyr3-metric-bar-row';

  const axisRow = document.createElement('div');
  axisRow.className = 'pyr3-metric-axis-row';

  for (let b = 0; b < N; b++) {
    const count = opts.counts.get(b) ?? 0;

    const countLabel = document.createElement('div');
    countLabel.className = 'pyr3-metric-count';
    countLabel.textContent = count.toLocaleString('en-US');
    countRow.appendChild(countLabel);

    const bar = document.createElement('div');
    bar.className = 'pyr3-metric-bar';
    bar.dataset.bucket = String(b);
    const pct = maxCount === 0 ? 0 : Math.round((count / maxCount) * 100);
    bar.style.height = `${pct}%`;
    if (b >= rangeLo && b <= rangeHi) bar.classList.add('in-range');
    barRow.appendChild(bar);

    const axis = document.createElement('div');
    axis.className = 'pyr3-metric-axislabel';
    axis.textContent = bucketLabel(b);
    axisRow.appendChild(axis);
  }

  // Edge brackets — small amber rectangles overlaying the bar row at the
  // START of the rangeLo bucket and the END of the rangeHi bucket.
  // Positioned as percentages of the bar-row width so they stay anchored
  // on resize without JS re-layout. (Living inside the bar row keeps them
  // visually aligned with bar tops/bottoms regardless of label rows.)
  const bracketStart = document.createElement('div');
  bracketStart.className = 'pyr3-metric-bracket';
  bracketStart.style.left = `${(rangeLo / N) * 100}%`;
  barRow.appendChild(bracketStart);

  const bracketEnd = document.createElement('div');
  bracketEnd.className = 'pyr3-metric-bracket';
  bracketEnd.style.left = `${((rangeHi + 1) / N) * 100}%`;
  barRow.appendChild(bracketEnd);

  histogram.append(countRow, barRow, axisRow);
  body.appendChild(histogram);

  const readout = document.createElement('div');
  readout.className = 'pyr3-metric-readout';
  const readoutText = document.createElement('span');
  readoutText.textContent = `range · ${opts.formatValue ? opts.formatValue(opts.min, opts.max) : formatMetricRange(opts.min, opts.max)}`;
  readout.appendChild(readoutText);

  // Per-row reset — only rendered when this axis is actually constrained
  // (min>0 or max!==null). Click clears just this axis, leaving every
  // other filter intact. The global "✕ reset" in the drawer footer clears
  // everything; this is the targeted alternative.
  const isAxisDefault = opts.min === 0 && opts.max === null;
  if (!isAxisDefault) {
    const resetLink = document.createElement('button');
    resetLink.type = 'button';
    resetLink.className = 'pyr3-metric-reset';
    resetLink.textContent = '✕ reset';
    resetLink.title = `reset ${opts.label} to all`;
    resetLink.onclick = (ev) => {
      ev.stopPropagation();
      opts.onRange(0, null);
    };
    readout.appendChild(resetLink);
  }

  body.appendChild(readout);

  row.appendChild(body);

  // Wire brush-select onto the histogram so drag gestures map to onRange.
  // (Task 5.5 — attachBrushSelect is defined below.)
  attachBrushSelect(histogram, opts.onRange, N);

  // Collapse / expand state. `display: none` toggling is the cheapest
  // mechanism that preserves layout when the user expands a row.
  let expanded = opts.initiallyExpanded === true;
  function syncExpansion(): void {
    body.style.display = expanded ? 'block' : 'none';
    chevron.textContent = expanded ? '▾' : '▸';
  }
  syncExpansion();

  header.addEventListener('click', () => {
    expanded = !expanded;
    syncExpansion();
  });

  return row;
}
// ──────────────────────────────────────────────────────────────────────────
// Task 5.5 — Brush-select drag gesture on the histogram
// ──────────────────────────────────────────────────────────────────────────
//
// `attachBrushSelect` adds a `mousedown → mousemove → mouseup` drag handler
// to the histogram. The user can press inside any bucket bar, drag across
// other buckets, and release to commit a [min, max] range. Reverse drag
// (right-to-left) normalizes the bounds so onRange always fires with
// `min <= max`. During the drag, the bars within the in-progress range
// receive an `.in-range` class so the visual highlight tracks the cursor.
//
// `onRange` receives normalized 0..1 decile bounds:
//   lo bucket B → min = B / 10
//   hi bucket B → max = (B + 1) / 10, or `null` if B === 9 (saturates
//                 to "no upper cap" so the canonical FilterSpec encoding
//                 matches DEFAULT_FILTER_SPEC.<metric>Max).
//
// Document-level mousemove/mouseup listeners are attached on mousedown so
// the drag continues even when the cursor leaves the histogram (matching
// the typical web brush-select UX). They're removed in mouseup.

function bucketAt(clientX: number, el: HTMLElement, n: number): number {
  const rect = el.getBoundingClientRect();
  const localX = clientX - rect.left;
  const width = el.clientWidth || rect.width || 1;
  return Math.min(n - 1, Math.max(0, Math.floor((localX / width) * n)));
}

export function attachBrushSelect(
  histogram: HTMLElement,
  onRange: (min: number, max: number | null) => void,
  bucketCount: number = 10,
): void {
  const N = bucketCount;
  let dragStart: number | null = null;

  function bucketsToRange(loBucket: number, hiBucket: number): { min: number; max: number | null } {
    const lo = Math.min(loBucket, hiBucket);
    const hi = Math.max(loBucket, hiBucket);
    const min = lo / N;
    // hi=N-1 saturates to null (no upper cap) so the canonical
    // DEFAULT_FILTER_SPEC.<metric>Max value re-encodes cleanly. Earlier
    // buckets carry the exclusive upper-edge convention from mountStatRow:
    // bucket B means [B/N, (B+1)/N) → emitted max = (B+1)/N.
    const max = hi === N - 1 ? null : (hi + 1) / N;
    return { min, max };
  }

  function renderInProgress(loBucket: number, hiBucket: number): void {
    const lo = Math.min(loBucket, hiBucket);
    const hi = Math.max(loBucket, hiBucket);
    const bars = histogram.querySelectorAll('.pyr3-metric-bar');
    bars.forEach((el, idx) => {
      el.classList.toggle('in-range', idx >= lo && idx <= hi);
    });
  }

  function onMove(ev: MouseEvent): void {
    if (dragStart === null) return;
    const cur = bucketAt(ev.clientX, histogram, N);
    renderInProgress(dragStart, cur);
  }

  function onUp(ev: MouseEvent): void {
    if (dragStart === null) {
      cleanup();
      return;
    }
    const cur = bucketAt(ev.clientX, histogram, N);
    const { min, max } = bucketsToRange(dragStart, cur);
    onRange(min, max);
    cleanup();
  }

  function cleanup(): void {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    dragStart = null;
  }

  histogram.addEventListener('mousedown', (ev) => {
    // Only react when the press is INSIDE the histogram (the listener is
    // attached to the histogram, so by the time we're here the bubbling
    // already filtered for us — but we still need to record the start
    // bucket before document-level listeners take over).
    dragStart = bucketAt(ev.clientX, histogram, N);
    renderInProgress(dragStart, dragStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
