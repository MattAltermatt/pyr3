// pyr3 — docked palette picker (Phase 9 visual overhaul).
//
// Sidecar widget that mounts alongside the editor's left panel and lets the
// user browse / search / filter / favorite the 701 flam3 catalog palettes
// (plus future `mine` user-saved entries). The editor host owns dock
// placement; this module owns the picker's internal DOM, state, and
// callback contract.
//
// Shell layout (this file):
//   ┌─ pyr3-palette-picker ────────────────────────────┐
//   │  pyr3-palette-picker-head                         │
//   │    title · badge · close-x                         │
//   │    search input                                    │
//   │    chip-row (Task 9.5 fills)                       │
//   │    tabs: all (701) · ★ favorites (N)               │
//   │    controls: sort dropdown · auto-apply toggle     │
//   │  pyr3-palette-picker-body                          │
//   │    (Task 9.4: 3-col cell grid; Task 9.5: filtered) │
//   │  pyr3-palette-picker-foot                          │
//   │    selected info · revert · apply & close          │
//   └──────────────────────────────────────────────────┘
//
// State contract:
//   - opts.current     — PaletteSource the editor is currently showing
//   - opts.onApply(s)  — invoked when the user commits a pick (auto-apply
//                        ON: immediately on cell click; OFF: on apply&close)
//   - opts.onClose()   — invoked when the close-x / footer dismiss fires
//
// Task scope:
//   9.3 = shell only (this file)
//   9.4 = cell grid + search filter
//   9.5 = color filter chips
//   9.6 = favorites + localStorage
//   9.7 = caller wiring (in edit-section-palette.ts)
//   9.8 = auto-apply toggle + revert + apply&close commit semantics

import { COLORS } from './ui-tokens';
import { buildDropdown, buildToggle, buildButton } from './edit-primitives';
import {
  type PaletteSource,
  paletteIdentifier,
} from './flam3-palette-names';
import { FLAM3_PALETTE_COUNT, getLibraryStops, getLibraryPaletteName } from './flam3-palettes';
import { type ColorStop } from './palette';
import {
  COLOR_TAGS,
  type ColorTag,
  getFlam3PaletteTags,
  getFlam3PaletteHsl,
} from './palette-tags';

// Canonical chip swatch colors (visible nub on each chip). One sample per
// category; calibrated by eye against the spec's 11 categories.
const CHIP_SWATCH: Record<ColorTag, string> = {
  red:    '#d83a3a',
  orange: '#e87c1a',
  yellow: '#e8c91a',
  green:  '#3aa84a',
  blue:   '#3a6ad8',
  purple: '#8c3ad8',
  pink:   '#e88ab0',
  brown:  '#7a4a28',
  pastel: '#d8c8e8',
  dark:   '#1a1a1e',
  gray:   '#8a8a92',
};

export interface PalettePickerOpts {
  /** The palette the editor is currently showing. Drives initial selection. */
  current: PaletteSource;
  /** Commit handler — called when the user applies a pick. */
  onApply: (source: PaletteSource) => void;
  /** Close handler — called when the user dismisses without apply. */
  onClose: () => void;
}

export interface PalettePickerHandle {
  /** Remove the picker DOM. Idempotent. */
  destroy: () => void;
}

// ── Favorites persistence ─────────────────────────────────────────────────
//
// Favorites are stored as a JSON array of stringified PaletteSource IDs:
//   "flam3:<N>"          for flam3 catalog entries
//   "corpus:<gen>/<id>"  for corpus-source palettes
//   "mine:<name>"        for user-saved (future)
// Stored under `pyr3.palette.favorites` (separate from the variation
// picker's localStorage key so the two pickers' favorites don't collide).

const FAVORITES_KEY = 'pyr3.palette.favorites';

function favoriteIdFor(source: PaletteSource): string {
  switch (source.kind) {
    case 'flam3':  return `flam3:${source.number}`;
    case 'corpus': return `corpus:${source.gen}/${source.id}`;
    case 'mine':   return `mine:${source.name}`;
  }
}

function readFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x) => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

function writeFavorites(set: Set<string>): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage may be disabled (private mode); favorites silently no-op.
  }
}

// ── Library entries (lazy-decoded once at first picker open) ──────────────
interface LibraryEntry {
  idx: number;
  name: string;       // display name (no-name → `flame #N`)
  searchName: string; // lower-cased name for filter matching
  gradient: string;   // CSS linear-gradient(...) string for cell ribbon
}

let _libraryEntries: LibraryEntry[] | null = null;
function getLibraryEntries(): LibraryEntry[] {
  if (_libraryEntries) return _libraryEntries;
  const out: LibraryEntry[] = [];
  for (let i = 0; i < FLAM3_PALETTE_COUNT; i++) {
    const stops = getLibraryStops(i) ?? [];
    const name = getLibraryPaletteName(i) ?? `flame #${i}`;
    out.push({
      idx: i,
      name,
      searchName: name.toLowerCase(),
      gradient: gradientCss(stops),
    });
  }
  _libraryEntries = out;
  return out;
}

// CSS gradient from a palette's stops. Sample every 16th index for a
// representative gradient (browser perf).
function gradientCss(stops: readonly ColorStop[]): string {
  if (stops.length === 0) return 'linear-gradient(to right, #000, #000)';
  const sorted = [...stops].sort((a, b) => a.t - b.t);
  const step = Math.max(1, Math.floor(sorted.length / 16));
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i += step) {
    const s = sorted[i]!;
    const r = Math.round(s.r * 255);
    const g = Math.round(s.g * 255);
    const b = Math.round(s.b * 255);
    const pct = Math.max(0, Math.min(100, s.t * 100)).toFixed(2);
    parts.push(`rgb(${r}, ${g}, ${b}) ${pct}%`);
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

function currentActiveIdx(source: PaletteSource): number | null {
  return source.kind === 'flam3' ? source.number : null;
}

export function mountPalettePicker(
  root: HTMLElement,
  opts: PalettePickerOpts,
): PalettePickerHandle {
  ensurePickerStyles();

  const picker = document.createElement('div');
  picker.className = 'pyr3-palette-picker';

  // ── Header ──────────────────────────────────────────────────────────────
  const head = document.createElement('div');
  head.className = 'pyr3-palette-picker-head';

  // Title row: title + badge + close-x
  const titleRow = document.createElement('div');
  titleRow.className = 'pyr3-palette-picker-title-row';
  const title = document.createElement('div');
  title.className = 'pyr3-palette-picker-title';
  title.textContent = '🎨 palette picker';
  const badge = document.createElement('span');
  badge.className = 'pyr3-palette-picker-badge';
  badge.textContent = `${FLAM3_PALETTE_COUNT}`;
  const closeBtn = document.createElement('div');
  closeBtn.className = 'pyr3-palette-picker-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'close picker (esc)';
  closeBtn.addEventListener('click', () => opts.onClose());
  titleRow.append(title, badge, closeBtn);
  head.appendChild(titleRow);

  // Search input
  const search = document.createElement('input');
  search.className = 'pyr3-palette-picker-search';
  search.type = 'text';
  search.placeholder = '🔍 search palettes by name…';
  search.spellcheck = false;
  search.autocomplete = 'off';
  head.appendChild(search);

  // Chip row — 11 color filter chips (Task 9.5).
  const chipRow = document.createElement('div');
  chipRow.className = 'pyr3-palette-picker-chip-row';
  const activeChips = new Set<ColorTag>();
  const chipByTag = new Map<ColorTag, HTMLElement>();
  for (const tag of COLOR_TAGS) {
    const chip = document.createElement('div');
    chip.className = 'pyr3-palette-picker-chip';
    chip.dataset['tag'] = tag;
    chip.title = tag;
    const swatch = document.createElement('span');
    swatch.className = 'pyr3-palette-picker-chip-swatch';
    swatch.style.backgroundColor = CHIP_SWATCH[tag];
    const label = document.createElement('span');
    label.className = 'pyr3-palette-picker-chip-label';
    label.textContent = tag;
    chip.append(swatch, label);
    chip.addEventListener('click', () => {
      if (activeChips.has(tag)) {
        activeChips.delete(tag);
        chip.classList.remove('on');
      } else {
        activeChips.add(tag);
        chip.classList.add('on');
      }
      applyFilter();
    });
    chipRow.appendChild(chip);
    chipByTag.set(tag, chip);
  }
  // `clear` link — resets every chip.
  const chipClear = document.createElement('span');
  chipClear.className = 'pyr3-palette-picker-chip-clear';
  chipClear.textContent = 'clear';
  chipClear.title = 'clear all color filters';
  chipClear.style.cursor = 'pointer';
  chipClear.style.fontSize = '10px';
  chipClear.style.color = COLORS.text.muted;
  chipClear.style.alignSelf = 'center';
  chipClear.style.marginLeft = '4px';
  chipClear.addEventListener('click', () => {
    activeChips.clear();
    for (const chip of chipByTag.values()) chip.classList.remove('on');
    applyFilter();
  });
  chipRow.appendChild(chipClear);
  head.appendChild(chipRow);

  // Tabs: all (701) · ★ favorites (N) — labels updated by refreshTabCounts.
  const tabsRow = document.createElement('div');
  tabsRow.className = 'pyr3-palette-picker-tabs';
  const allTab = document.createElement('div');
  allTab.className = 'pyr3-palette-picker-tab active';
  allTab.dataset['tab'] = 'all';
  const favTab = document.createElement('div');
  favTab.className = 'pyr3-palette-picker-tab';
  favTab.dataset['tab'] = 'favorites';
  tabsRow.append(allTab, favTab);
  head.appendChild(tabsRow);

  // Controls row: sort dropdown · auto-apply toggle
  const controlsRow = document.createElement('div');
  controlsRow.className = 'pyr3-palette-picker-controls';

  // sortMode drives the cell DOM order. 'number' is the catalog default
  // (entries already arrive in idx order); other modes re-append cells in
  // the computed order before `applyFilter()` re-paints visibility.
  type SortMode = 'number' | 'name' | 'hue' | 'sat' | 'light';
  let sortMode: SortMode = 'number';
  const sort = buildDropdown({
    value: 'number',
    options: [
      { value: 'number', label: 'sort: number' },
      { value: 'name',   label: 'sort: name' },
      { value: 'hue',    label: 'sort: hue' },
      { value: 'sat',    label: 'sort: saturation' },
      { value: 'light',  label: 'sort: lightness' },
    ],
    onChange: (next) => {
      sortMode = next as SortMode;
      applySortOrder();
      applyFilter();
    },
  });
  sort.classList.add('pyr3-palette-picker-sort');

  const autoApplyWrap = document.createElement('label');
  autoApplyWrap.className = 'pyr3-palette-picker-auto-apply-wrap';
  autoApplyWrap.style.display = 'inline-flex';
  autoApplyWrap.style.alignItems = 'center';
  autoApplyWrap.style.gap = '6px';
  autoApplyWrap.style.fontSize = '11px';
  autoApplyWrap.style.color = COLORS.text.muted;
  autoApplyWrap.style.cursor = 'pointer';
  const autoApplyLabel = document.createElement('span');
  autoApplyLabel.textContent = 'auto-apply';
  const autoApply = buildToggle({
    value: false,
    onChange: (next) => { autoApplyOn = next; },
  });
  autoApply.classList.add('pyr3-palette-picker-auto-apply');
  autoApplyWrap.append(autoApplyLabel, autoApply);

  controlsRow.append(sort, autoApplyWrap);
  head.appendChild(controlsRow);

  picker.appendChild(head);

  // ── Body — 3-col cell grid (Task 9.4) ──────────────────────────────────
  const body = document.createElement('div');
  body.className = 'pyr3-palette-picker-body';
  // Inline the grid template so tests can read the column policy directly.
  body.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';

  const entries = getLibraryEntries();
  const originalSource = opts.current; // snapshot for revert
  // selectedSource starts at the picker's current; cell clicks update it,
  // revert snaps it back to originalSource, apply&close commits it.
  let selectedSource: PaletteSource = opts.current;
  const cellByIdx = new Map<number, HTMLElement>();
  const starByIdx = new Map<number, HTMLElement>();

  // Live favorite set + tab state ------------------------------------------
  const favorites = readFavorites();
  let activeTab: 'all' | 'favorites' = 'all';
  // Auto-apply: cell click immediately invokes onApply. OFF = deferred until
  // the footer apply&close button fires.
  let autoApplyOn = false;

  function isFavorite(idx: number): boolean {
    return favorites.has(favoriteIdFor({ kind: 'flam3', number: idx }));
  }
  function paintStar(idx: number): void {
    const star = starByIdx.get(idx);
    if (!star) return;
    if (isFavorite(idx)) {
      star.textContent = '★';
      star.classList.add('on');
      star.style.color = COLORS.flame.top;
    } else {
      star.textContent = '☆';
      star.classList.remove('on');
      star.style.color = COLORS.text.dim;
    }
  }
  function toggleFavorite(idx: number): void {
    const id = favoriteIdFor({ kind: 'flam3', number: idx });
    if (favorites.has(id)) favorites.delete(id);
    else favorites.add(id);
    writeFavorites(favorites);
    paintStar(idx);
    refreshTabCounts();
    applyFilter();
  }

  const activeIdx = currentActiveIdx(opts.current);
  for (const entry of entries) {
    const cell = document.createElement('div');
    cell.className = 'pyr3-palette-picker-cell';
    cell.dataset['idx'] = String(entry.idx);
    cell.dataset['name'] = entry.searchName;
    cell.title = entry.name;
    cell.style.cursor = 'pointer';
    cell.style.padding = '4px';
    cell.style.borderRadius = '3px';
    cell.style.border = `1px solid transparent`;
    cell.style.background = 'transparent';
    cell.style.position = 'relative';

    if (entry.idx === activeIdx) {
      cell.classList.add('active');
      cell.style.borderColor = COLORS.flame.top;
      cell.style.background = COLORS.bg.action;
    }

    // Cell click → update selection. With auto-apply ON, also fire onApply.
    cell.addEventListener('click', () => {
      setSelected({ kind: 'flam3', number: entry.idx });
      if (autoApplyOn) {
        opts.onApply(selectedSource);
      }
    });

    // Cell ribbon: 36px gradient strip
    const ribbon = document.createElement('div');
    ribbon.className = 'pyr3-palette-picker-cell-ribbon';
    ribbon.style.height = '36px';
    ribbon.style.borderRadius = '2px';
    ribbon.style.border = `1px solid ${COLORS.border}`;
    ribbon.style.background = entry.gradient;
    cell.appendChild(ribbon);

    // Name (truncated)
    const nameEl = document.createElement('div');
    nameEl.className = 'pyr3-palette-picker-cell-name';
    nameEl.textContent = entry.name;
    nameEl.style.fontSize = '10px';
    nameEl.style.color = COLORS.text.muted;
    nameEl.style.marginTop = '4px';
    nameEl.style.overflow = 'hidden';
    nameEl.style.textOverflow = 'ellipsis';
    nameEl.style.whiteSpace = 'nowrap';
    nameEl.style.textAlign = 'center';
    cell.appendChild(nameEl);

    // Star (top-right corner — favorites toggle, Task 9.6)
    const star = document.createElement('div');
    star.className = 'pyr3-palette-picker-cell-star';
    star.textContent = '☆';
    star.style.position = 'absolute';
    star.style.top = '2px';
    star.style.right = '4px';
    star.style.fontSize = '12px';
    star.style.color = COLORS.text.dim;
    star.style.userSelect = 'none';
    star.style.cursor = 'pointer';
    star.title = 'toggle favorite';
    star.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleFavorite(entry.idx);
    });
    cell.appendChild(star);

    body.appendChild(cell);
    cellByIdx.set(entry.idx, cell);
    starByIdx.set(entry.idx, star);
    paintStar(entry.idx);
  }
  picker.appendChild(body);

  // Selection helpers — paint the active border on the cell matching
  // selectedSource; update the footer "selected" info text.
  function paintActive(idx: number | null): void {
    for (const [i, cell] of cellByIdx) {
      const isActive = i === idx;
      cell.classList.toggle('active', isActive);
      cell.style.borderColor = isActive ? COLORS.flame.top : 'transparent';
      cell.style.background = isActive ? COLORS.bg.action : 'transparent';
    }
  }
  function setSelected(source: PaletteSource): void {
    selectedSource = source;
    paintActive(currentActiveIdx(source));
    refreshSelectedInfo();
  }
  function refreshSelectedInfo(): void {
    const ident = paletteIdentifier(selectedSource);
    selected.textContent = ident.prefix
      ? `${ident.prefix} ${ident.name}`
      : ident.name;
  }

  // Re-append cells in the order dictated by sortMode. Pure DOM reorder —
  // visibility (display:none) is the filter's job.
  function applySortOrder(): void {
    const sorted = [...entries];
    switch (sortMode) {
      case 'number':
        sorted.sort((a, b) => a.idx - b.idx);
        break;
      case 'name':
        // Use idx as tiebreaker so unnamed entries (`flame #N`) stay stable.
        // searchName is lowercased; localeCompare keeps it locale-aware for
        // accented catalog names.
        sorted.sort((a, b) => {
          const cmp = a.searchName.localeCompare(b.searchName);
          return cmp !== 0 ? cmp : a.idx - b.idx;
        });
        break;
      case 'hue':
        sorted.sort((a, b) => {
          const ha = getFlam3PaletteHsl(a.idx).h;
          const hb = getFlam3PaletteHsl(b.idx).h;
          return ha - hb || a.idx - b.idx;
        });
        break;
      case 'sat':
        sorted.sort((a, b) => {
          const sa = getFlam3PaletteHsl(a.idx).s;
          const sb = getFlam3PaletteHsl(b.idx).s;
          return sa - sb || a.idx - b.idx;
        });
        break;
      case 'light':
        sorted.sort((a, b) => {
          const la = getFlam3PaletteHsl(a.idx).l;
          const lb = getFlam3PaletteHsl(b.idx).l;
          return la - lb || a.idx - b.idx;
        });
        break;
    }
    for (const entry of sorted) {
      const cell = cellByIdx.get(entry.idx);
      if (cell) body.appendChild(cell); // appendChild moves existing nodes
    }
  }

  // Live filter — search (substring AND) × chip (any-tag OR) × tab (all
  // vs favorites). Badge shows total when nothing is filtering, else
  // `visible / total`.
  function applyFilter(): void {
    const q = search.value.trim().toLowerCase();
    const chipsOn = activeChips.size > 0;
    const favTab = activeTab === 'favorites';
    let visible = 0;
    for (const entry of entries) {
      const cell = cellByIdx.get(entry.idx)!;
      const searchMatch = q === '' || entry.searchName.includes(q);
      let chipMatch = true;
      if (chipsOn) {
        const tags = getFlam3PaletteTags(entry.idx);
        chipMatch = false;
        for (const t of tags) {
          if (activeChips.has(t)) { chipMatch = true; break; }
        }
      }
      const tabMatch = !favTab || isFavorite(entry.idx);
      const match = searchMatch && chipMatch && tabMatch;
      cell.style.display = match ? '' : 'none';
      if (match) visible++;
    }
    const filtering = q !== '' || chipsOn || favTab;
    badge.textContent = filtering
      ? `${visible} / ${FLAM3_PALETTE_COUNT}`
      : `${FLAM3_PALETTE_COUNT}`;
  }
  search.addEventListener('input', applyFilter);

  // Tab labels (with counts) + click handlers ------------------------------
  function refreshTabCounts(): void {
    allTab.textContent = `all (${FLAM3_PALETTE_COUNT})`;
    favTab.textContent = `★ favorites (${favorites.size})`;
  }
  function setTab(tab: 'all' | 'favorites'): void {
    activeTab = tab;
    allTab.classList.toggle('active', tab === 'all');
    favTab.classList.toggle('active', tab === 'favorites');
    applyFilter();
  }
  allTab.addEventListener('click', () => setTab('all'));
  favTab.addEventListener('click', () => setTab('favorites'));
  refreshTabCounts();

  // ── Footer: selected info · revert · apply&close ────────────────────────
  const foot = document.createElement('div');
  foot.className = 'pyr3-palette-picker-foot';

  const selected = document.createElement('div');
  selected.className = 'pyr3-palette-picker-selected';
  const selIdent = paletteIdentifier(opts.current);
  selected.textContent = selIdent.prefix
    ? `${selIdent.prefix} ${selIdent.name}`
    : selIdent.name;

  const footActions = document.createElement('div');
  footActions.className = 'pyr3-palette-picker-foot-actions';

  const revertBtn = buildButton({
    variant: 'accent',
    label: 'revert',
    icon: '⟲',
    onClick: () => {
      setSelected(originalSource);
      // Auto-apply ON → revert also commits the original back to the host.
      if (autoApplyOn) opts.onApply(selectedSource);
    },
  });
  revertBtn.classList.add('pyr3-palette-picker-revert');

  const applyBtn = buildButton({
    variant: 'primary',
    label: 'apply & close',
    onClick: () => {
      opts.onApply(selectedSource);
      opts.onClose();
    },
  });
  applyBtn.classList.add('pyr3-palette-picker-apply');

  footActions.append(revertBtn, applyBtn);
  foot.append(selected, footActions);
  picker.appendChild(foot);

  root.appendChild(picker);

  return {
    destroy: () => {
      if (picker.parentElement) picker.remove();
    },
  };
}

// ─── One-time CSS injection ──────────────────────────────────────────────
function ensurePickerStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('pyr3-palette-picker-styles')) return;
  const style = document.createElement('style');
  style.id = 'pyr3-palette-picker-styles';
  style.textContent = PICKER_CSS;
  document.head.appendChild(style);
}

const PICKER_CSS = `
.pyr3-palette-picker {
  /* Docked to the right of the 340px editor left panel; matches the
     #102 variation-picker placement so the muscle memory transfers. */
  position: fixed;
  top: 88px;          /* under the top bar + info row */
  bottom: 0;
  left: 340px;
  width: 380px;
  display: flex;
  flex-direction: column;
  background: ${COLORS.bg.panel};
  border: 1px solid ${COLORS.border};
  border-left: none;
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.5);
  min-height: 0;
  overflow: hidden;
  color: ${COLORS.text.primary};
  font-size: 12px;
  z-index: 1000;
}
.pyr3-palette-picker-head {
  padding: 10px 12px;
  border-bottom: 1px solid ${COLORS.border};
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}
.pyr3-palette-picker-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pyr3-palette-picker-title {
  font-size: 13px;
  color: ${COLORS.flame.top};
  flex: 1 1 auto;
  font-weight: 500;
}
.pyr3-palette-picker-badge {
  font-size: 10px;
  color: ${COLORS.text.muted};
  font-family: ui-monospace, monospace;
  background: ${COLORS.bg.input};
  border: 1px solid ${COLORS.border};
  border-radius: 3px;
  padding: 1px 5px;
}
.pyr3-palette-picker-close {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: ${COLORS.text.muted};
  border-radius: 3px;
  font-size: 16px;
  line-height: 1;
  user-select: none;
}
.pyr3-palette-picker-close:hover {
  background: ${COLORS.bg.input};
  color: ${COLORS.danger};
}
.pyr3-palette-picker-search {
  width: 100%;
  box-sizing: border-box;
  background: ${COLORS.bg.input};
  border: 1px solid ${COLORS.border};
  border-radius: 3px;
  color: ${COLORS.text.primary};
  padding: 5px 8px;
  font-family: inherit;
  font-size: 12px;
}
.pyr3-palette-picker-search::placeholder { color: ${COLORS.text.dim}; }
.pyr3-palette-picker-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 0;
}
.pyr3-palette-picker-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  font-size: 10px;
  color: ${COLORS.text.muted};
  background: ${COLORS.bg.input};
  border: 1px solid ${COLORS.border};
  border-radius: 10px;
  cursor: pointer;
  user-select: none;
}
.pyr3-palette-picker-chip:hover { border-color: ${COLORS.flame.bot}; }
.pyr3-palette-picker-chip.on {
  background: ${COLORS.bg.action};
  border-color: ${COLORS.flame.bot};
  color: ${COLORS.flame.top};
}
.pyr3-palette-picker-chip-swatch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  border: 1px solid rgba(0, 0, 0, 0.4);
}
.pyr3-palette-picker-chip-clear:hover { color: ${COLORS.flame.top}; }
.pyr3-palette-picker-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid ${COLORS.border};
  padding-bottom: 4px;
}
.pyr3-palette-picker-tab {
  font-size: 11px;
  padding: 3px 8px;
  color: ${COLORS.text.muted};
  border-radius: 3px 3px 0 0;
  cursor: pointer;
  border: 1px solid transparent;
  user-select: none;
}
.pyr3-palette-picker-tab:hover { color: ${COLORS.text.primary}; }
.pyr3-palette-picker-tab.active {
  color: ${COLORS.flame.top};
  background: ${COLORS.bg.action};
  border-color: ${COLORS.flame.bot};
}
.pyr3-palette-picker-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}
.pyr3-palette-picker-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 12px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  align-content: start;
}
.pyr3-palette-picker-foot {
  padding: 8px 12px;
  border-top: 1px solid ${COLORS.border};
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.pyr3-palette-picker-selected {
  flex: 1 1 auto;
  font-size: 11px;
  color: ${COLORS.text.muted};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pyr3-palette-picker-foot-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}
`;
