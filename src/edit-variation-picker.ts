// pyr3 — /v1/edit variation kind picker (Phase 10 visual overhaul refactor).
//
// Docked sidecar mirroring the palette picker shell DOM. Same family of
// affordances: header with title + close-x + search + tabs (all · ★ favorites)
// + sort + auto-apply toggle; 3-col body grid of cells (thumb + name + star);
// footer with selected info + ⟲ revert + apply & close.
//
// API preserved from the pre-Phase-10 modal version so call sites in
// `edit-section-xforms.ts` (kindBtn / + var button) keep working:
//   openVariationPicker({ host, initialIndex, onPreview, onCommit, onCancel })
//   returns { close() }
//
// Phase 10 additions:
//   - `xformIndex?: number` in opts → drives the title suffix
//   - `.pyr3-picker` shared shell DOM (also carries the legacy
//     `.pyr3-var-picker` class for any external selectors)
//   - ★ favorites persisted under `pyr3.variation.favorites` (separate
//     localStorage key from the palette picker)
//
// Filter chips are intentionally OMITTED per user direction — type
// categorization stays in the data (CATEGORY_MAP) for future use, but no
// chip UI.

import { COLORS } from './ui-tokens';
import { buildDropdown, buildToggle, buildButton } from './edit-primitives';
import { V, VARIATION_NAMES, DC_VARIATION_SET } from './variations';

// #114 — per-variation descriptive tooltips for the picker. Adds the
// human-readable explanation alongside the raw variation name, mostly
// for the DC family where the name (`dc_perlin`) doesn't convey the
// mechanism. flam3-99 variations fall back to the bare name title.
export const VARIATION_TOOLTIPS: Record<string, string> = {
  dc_linear: 'Color from spatial coord (simplest direct-color variation)',
  dc_perlin: 'Color from a Perlin noise field — the marbled / painterly look',
  dc_gridout: 'Color by canvas quadrant — discrete-region direct color',
  dc_cylinder: 'Direct-color version of cylinder (shape + color combined)',
};

/** Canonical reference for the DC (direct-color) variation family.
 *  Points at pyr3's own help page (self-contained explanation + examples
 *  + author credits + the canonical external link onward). Linked from
 *  the picker tile badge and the xforms-section DC chip. */
export const DC_DOCS_URL = '/help/direct-color-variations.html';

// ──────────────────────────────────────────────────────────────────────
// Tier data (preserved from the previous picker version)
// ──────────────────────────────────────────────────────────────────────

/** Curated featured set — the workhorses 90% of flames use. */
export const FEATURED_VARIATIONS: readonly number[] = [
  V.linear, V.sinusoidal, V.spherical, V.swirl, V.horseshoe,
  V.polar, V.heart, V.disc, V.spiral, V.hyperbolic, V.diamond,
  V.ex, V.julian, V.julia, V.waves, V.fisheye, V.bubble,
  V.rings, V.fan, V.cross, V.ngon, V.cell, V.blob, V.rectangles,
];

/** All known variations, grouped by family. Every index in V appears in
 *  exactly one category. Used by external callers (and reserved for a
 *  future category sort/filter). The picker UI itself does NOT render
 *  category chips per user direction. */
export const CATEGORY_MAP: Record<string, readonly number[]> = (() => {
  const groups: Record<string, number[]> = {
    'Polar / angular': [
      V.polar, V.handkerchief, V.heart, V.disc, V.spiral, V.hyperbolic,
      V.diamond, V.eyefish, V.bubble, V.cylinder, V.perspective,
    ],
    'Julia family': [V.julia, V.julian, V.juliascope, V.cpow, V.wedge_julia ?? -1].filter(i => i >= 0),
    'Waves / rings': [V.waves, V.rings, V.fan, V.rings2, V.fan2, V.popcorn, V.flower ?? -1, V.auger ?? -1].filter(i => i >= 0),
    'Blur / random': [V.blur, V.gaussian_blur, V.noise, V.pre_blur ?? -1, V.square, V.rays, V.blade, V.twintrian, V.radial_blur].filter(i => i >= 0),
    'Transcendental': [V.exp ?? -1, V.log ?? -1, V.sin ?? -1, V.cos ?? -1, V.tan ?? -1, V.sec ?? -1, V.csc ?? -1, V.cot ?? -1, V.sinh ?? -1, V.cosh ?? -1, V.tanh ?? -1, V.sech ?? -1, V.csch ?? -1, V.coth ?? -1].filter(i => i >= 0),
    'Linear / basic': [V.linear, V.sinusoidal, V.swirl, V.horseshoe, V.ex, V.fisheye],
    // #114 — DC (direct-color) family. JWildfire-origin; color comes from
    // spatial position instead of the palette index for any xform that
    // includes one of these. See VARIATION_TOOLTIPS and DC_DOCS_URL above.
    'Direct color': [V.dc_linear, V.dc_perlin, V.dc_gridout, V.dc_cylinder],
  };
  // Sweep up everything else into 'Misc / exotic'.
  const seen = new Set<number>();
  for (const arr of Object.values(groups)) for (const i of arr) seen.add(i);
  const misc: number[] = [];
  for (const i of Object.values(V)) if (!seen.has(i as number)) misc.push(i as number);
  if (misc.length > 0) groups['Misc / exotic'] = misc;
  return groups;
})();

// ──────────────────────────────────────────────────────────────────────
// Recently-used (localStorage, FIFO, max 5, dedup-to-front)
// ──────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'pyr3.varpicker.recents';
const RECENTS_CAP = 5;

export function readRecentlyUsed(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(n => typeof n === 'number' && Number.isInteger(n));
  } catch {
    return [];
  }
}

export function pushRecentlyUsed(index: number): void {
  const cur = readRecentlyUsed().filter(i => i !== index);
  const next = [index, ...cur].slice(0, RECENTS_CAP);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be disabled (private mode); ignore.
  }
}

// ──────────────────────────────────────────────────────────────────────
// Favorites (localStorage)
// ──────────────────────────────────────────────────────────────────────
// Stored as a JSON array of variation NAMES (not indices) under
// `pyr3.variation.favorites`. Names are stable across pyr3 versions; the
// numeric V indices are an internal packing detail and could shift if the
// catalogue is reordered. The localStorage key is intentionally distinct
// from `pyr3.palette.favorites` so the two pickers' favorites never collide.

const FAVORITES_KEY = 'pyr3.variation.favorites';

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
    // localStorage disabled (private mode); silently no-op.
  }
}

// ──────────────────────────────────────────────────────────────────────
// Picker
// ──────────────────────────────────────────────────────────────────────

export interface VariationPickerOpts {
  /** Where to append the picker — usually `document.body`. */
  host: HTMLElement;
  /** The variation index that's currently in the slot, used as the
   *  snapshot to revert to. */
  initialIndex: number;
  /** Which xform the picker is editing — drives the title suffix. */
  xformIndex?: number;
  /** Called on each cell click. The host should write to genome and fire
   *  the slow lane so the flame canvas updates behind the picker. */
  onPreview: (index: number) => void;
  /** Called when the user clicks "apply & close". The current preview wins. */
  onCommit: () => void;
  /** Called when the user cancels (×, Escape). Host should treat as
   *  "abandon picker state" — the most recent preview was a no-op in
   *  retrospect. */
  onCancel: () => void;
}

export interface VariationPickerHandle {
  /** Programmatic close, equivalent to clicking close-x. */
  close(): void;
}

interface VariationEntry {
  idx: number;
  name: string;
  searchName: string;
}

function buildEntries(): VariationEntry[] {
  const out: VariationEntry[] = [];
  for (const [name, idxRaw] of Object.entries(V)) {
    const idx = idxRaw as number;
    out.push({ idx, name, searchName: name.toLowerCase() });
  }
  // Stable index order for the default cell layout.
  out.sort((a, b) => a.idx - b.idx);
  return out;
}

export function openVariationPicker(opts: VariationPickerOpts): VariationPickerHandle {
  ensurePickerStyles();

  // Snapshot the index the picker opened on; revert restores to this.
  const snapshot = opts.initialIndex;
  let currentIndex = opts.initialIndex;
  let autoApplyOn = false;

  const entries = buildEntries();
  const totalCount = entries.length;

  // ── Shell ────────────────────────────────────────────────────────
  const picker = document.createElement('div');
  // `.pyr3-picker` = shared shell class (matches palette picker's parallel
  // contract). `.pyr3-var-picker` = legacy qualifier so any external
  // selectors / styles addressing the modal-era variation picker still
  // resolve to this picker.
  picker.className = 'pyr3-picker pyr3-var-picker';

  // ── Header ───────────────────────────────────────────────────────
  const head = document.createElement('div');
  head.className = 'pyr3-picker-head';

  const titleRow = document.createElement('div');
  titleRow.className = 'pyr3-picker-title-row';

  const title = document.createElement('div');
  title.className = 'pyr3-picker-title';
  title.textContent = opts.xformIndex !== undefined
    ? `🧬 Variation picker · xform ${opts.xformIndex}`
    : '🧬 Variation picker';

  const badge = document.createElement('span');
  badge.className = 'pyr3-picker-badge';
  badge.textContent = String(totalCount);

  const closeBtn = document.createElement('div');
  closeBtn.className = 'pyr3-picker-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'close picker (esc)';
  closeBtn.addEventListener('click', () => cancel());

  titleRow.append(title, badge, closeBtn);
  head.appendChild(titleRow);

  // Search input
  const search = document.createElement('input');
  search.className = 'pyr3-picker-search';
  search.type = 'text';
  search.placeholder = `🔍 search ${totalCount} variations…`;
  search.spellcheck = false;
  search.autocomplete = 'off';
  head.appendChild(search);

  // Tabs: all (N) · ★ favorites (M)
  const tabsRow = document.createElement('div');
  tabsRow.className = 'pyr3-picker-tabs';
  const allTab = document.createElement('div');
  allTab.className = 'pyr3-picker-tab active';
  allTab.dataset['tab'] = 'all';
  const favTab = document.createElement('div');
  favTab.className = 'pyr3-picker-tab';
  favTab.dataset['tab'] = 'favorites';
  tabsRow.append(allTab, favTab);
  head.appendChild(tabsRow);

  // Controls: sort + auto-apply
  const controlsRow = document.createElement('div');
  controlsRow.className = 'pyr3-picker-controls';

  type SortKey = 'name-asc' | 'name-desc';
  let activeSort: SortKey = 'name-asc';
  const sort = buildDropdown<SortKey>({
    value: 'name-asc',
    options: [
      { value: 'name-asc',  label: 'sort: name (a→z)' },
      { value: 'name-desc', label: 'sort: name (z→a)' },
    ],
    onChange: (v) => {
      activeSort = v;
      applySort();
    },
  });
  sort.classList.add('pyr3-picker-sort');

  const autoApplyWrap = document.createElement('label');
  autoApplyWrap.className = 'pyr3-picker-auto-apply-wrap';
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
  autoApply.classList.add('pyr3-picker-auto-apply');
  autoApplyWrap.append(autoApplyLabel, autoApply);

  controlsRow.append(sort, autoApplyWrap);
  head.appendChild(controlsRow);

  picker.appendChild(head);

  // ── Body — 3-col cell grid ───────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'pyr3-picker-body';
  body.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';

  const cellByIdx = new Map<number, HTMLElement>();
  const starByIdx = new Map<number, HTMLElement>();
  const favorites = readFavorites();
  let activeTab: 'all' | 'favorites' = 'all';

  function isFavorite(idx: number): boolean {
    return favorites.has(VARIATION_NAMES[idx] ?? '');
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
    const name = VARIATION_NAMES[idx];
    if (!name) return;
    if (favorites.has(name)) favorites.delete(name);
    else favorites.add(name);
    writeFavorites(favorites);
    paintStar(idx);
    refreshTabCounts();
    applyFilter();
  }

  function buildCell(entry: VariationEntry): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'pyr3-picker-cell';
    cell.dataset['vidx'] = String(entry.idx);
    cell.dataset['vname'] = entry.name;
    // #114 — enriched tooltip for variations with a registered description
    // (the DC family). Bare name as fallback for the flam3-99 set.
    const desc = VARIATION_TOOLTIPS[entry.name];
    cell.title = desc ? `${entry.name} — ${desc}` : entry.name;
    cell.style.cursor = 'pointer';
    cell.style.padding = '4px';
    cell.style.borderRadius = '3px';
    cell.style.border = '1px solid transparent';
    cell.style.background = 'transparent';
    cell.style.position = 'relative';

    if (entry.idx === currentIndex) {
      cell.classList.add('active');
      cell.style.borderColor = COLORS.flame.top;
      cell.style.background = COLORS.bg.action;
    }

    cell.addEventListener('click', () => {
      currentIndex = entry.idx;
      opts.onPreview(entry.idx);
      paintActive(entry.idx);
      refreshSelectedInfo();
      if (autoApplyOn) {
        commit();
      }
    });

    // Thumbnail (preserve the existing production assets).
    const img = document.createElement('img');
    img.className = 'pyr3-var-thumb';
    img.alt = entry.name;
    img.src = `/variation-thumbs/${entry.name}.png`;
    img.style.width = '100%';
    img.style.aspectRatio = '1 / 1';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '2px';
    img.style.border = `1px solid ${COLORS.border}`;
    img.style.background = COLORS.bg.input;
    img.onerror = () => {
      // Graceful fallback — empty box so the cell still has shape.
      img.style.visibility = 'hidden';
    };
    cell.appendChild(img);

    // Name
    const nameEl = document.createElement('div');
    nameEl.className = 'pyr3-picker-cell-name';
    nameEl.textContent = entry.name;
    nameEl.style.fontSize = '10px';
    nameEl.style.color = COLORS.text.muted;
    nameEl.style.marginTop = '4px';
    nameEl.style.overflow = 'hidden';
    nameEl.style.textOverflow = 'ellipsis';
    nameEl.style.whiteSpace = 'nowrap';
    nameEl.style.textAlign = 'center';
    cell.appendChild(nameEl);

    // Star
    const star = document.createElement('div');
    star.className = 'pyr3-picker-cell-star';
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

    starByIdx.set(entry.idx, star);
    paintStar(entry.idx);

    // #114 — DC chip on direct-color variations. Small "DC" badge at the
    // top-left + clickable "ⓘ" to open the canonical docs page in a new
    // tab. Visually distinguishes the family without forcing a category
    // re-skin of the rest of the picker.
    if (DC_VARIATION_SET.has(entry.idx)) {
      const badge = document.createElement('div');
      badge.className = 'pyr3-picker-cell-dc-badge';
      badge.textContent = 'DC';
      badge.title = 'Direct-color variation — colors this xform from spatial position, not the palette';
      badge.style.position = 'absolute';
      badge.style.top = '2px';
      badge.style.left = '4px';
      badge.style.fontSize = '9px';
      badge.style.fontWeight = 'bold';
      badge.style.color = COLORS.flame.top;
      badge.style.background = COLORS.bg.input;
      badge.style.padding = '0 3px';
      badge.style.borderRadius = '2px';
      badge.style.border = `1px solid ${COLORS.border}`;
      badge.style.userSelect = 'none';
      badge.style.pointerEvents = 'auto';
      badge.style.cursor = 'help';
      badge.addEventListener('click', (ev) => {
        ev.stopPropagation();
        window.open(DC_DOCS_URL, '_blank', 'noopener,noreferrer');
      });
      cell.appendChild(badge);
    }
    return cell;
  }

  for (const entry of entries) {
    const cell = buildCell(entry);
    body.appendChild(cell);
    cellByIdx.set(entry.idx, cell);
  }
  picker.appendChild(body);

  function paintActive(idx: number): void {
    for (const [i, cell] of cellByIdx) {
      const isActive = i === idx;
      cell.classList.toggle('active', isActive);
      cell.style.borderColor = isActive ? COLORS.flame.top : 'transparent';
      cell.style.background = isActive ? COLORS.bg.action : 'transparent';
    }
  }

  function applySort(): void {
    const sorted = [...entries].sort((a, b) => {
      if (activeSort === 'name-asc') return a.searchName.localeCompare(b.searchName);
      return b.searchName.localeCompare(a.searchName);
    });
    for (const e of sorted) {
      const cell = cellByIdx.get(e.idx);
      if (cell) body.appendChild(cell); // re-append in new order
    }
  }

  function applyFilter(): void {
    const q = search.value.trim().toLowerCase();
    const favOnly = activeTab === 'favorites';
    let visible = 0;
    for (const entry of entries) {
      const cell = cellByIdx.get(entry.idx)!;
      const searchMatch = q === '' || entry.searchName.includes(q);
      const tabMatch = !favOnly || isFavorite(entry.idx);
      const match = searchMatch && tabMatch;
      cell.style.display = match ? '' : 'none';
      if (match) visible++;
    }
    const filtering = q !== '' || favOnly;
    badge.textContent = filtering ? `${visible} / ${totalCount}` : String(totalCount);
  }
  search.addEventListener('input', applyFilter);

  function refreshTabCounts(): void {
    allTab.textContent = `all (${totalCount})`;
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

  // ── Footer ───────────────────────────────────────────────────────
  const foot = document.createElement('div');
  foot.className = 'pyr3-picker-foot';

  const selected = document.createElement('div');
  selected.className = 'pyr3-picker-selected';
  function refreshSelectedInfo(): void {
    const name = VARIATION_NAMES[currentIndex] ?? `var${currentIndex}`;
    selected.textContent = name;
  }
  refreshSelectedInfo();

  const footActions = document.createElement('div');
  footActions.className = 'pyr3-picker-foot-actions';

  const revertBtn = buildButton({
    variant: 'accent',
    label: 'revert',
    icon: '⟲',
    onClick: () => {
      currentIndex = snapshot;
      opts.onPreview(snapshot);
      paintActive(snapshot);
      refreshSelectedInfo();
    },
  });
  revertBtn.classList.add('pyr3-picker-revert');

  const applyBtn = buildButton({
    variant: 'primary',
    label: 'apply & close',
    onClick: () => commit(),
  });
  applyBtn.classList.add('pyr3-picker-apply');

  footActions.append(revertBtn, applyBtn);
  foot.append(selected, footActions);
  picker.appendChild(foot);

  opts.host.appendChild(picker);

  // ── Lifecycle ────────────────────────────────────────────────────
  function close(): void {
    document.removeEventListener('keydown', onKeyDown);
    if (picker.parentElement) picker.remove();
  }

  function commit(): void {
    pushRecentlyUsed(currentIndex);
    opts.onCommit();
    close();
  }

  function cancel(): void {
    opts.onCancel();
    close();
  }

  function onKeyDown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') cancel();
  }
  document.addEventListener('keydown', onKeyDown);

  return { close: () => cancel() };
}

// ──────────────────────────────────────────────────────────────────────
// CSS
// ──────────────────────────────────────────────────────────────────────

function ensurePickerStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('pyr3-var-picker-styles')) return;
  const style = document.createElement('style');
  style.id = 'pyr3-var-picker-styles';
  style.textContent = PICKER_CSS;
  document.head.appendChild(style);
}

const PICKER_CSS = `
.pyr3-picker.pyr3-var-picker {
  /* Mirrors palette picker dock — to the right of the 340px editor left
     panel. Shifted right one panel-width so it doesn't collide with an
     open palette picker (z-index already handles the case but visual
     separation matters too). */
  position: fixed;
  top: 88px;
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
  z-index: 1001;
}
.pyr3-picker-head {
  padding: 10px 12px;
  border-bottom: 1px solid ${COLORS.border};
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}
.pyr3-picker-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pyr3-picker-title {
  font-size: 13px;
  color: ${COLORS.flame.top};
  flex: 1 1 auto;
  font-weight: 500;
}
.pyr3-picker-badge {
  font-size: 10px;
  color: ${COLORS.text.muted};
  font-family: ui-monospace, monospace;
  background: ${COLORS.bg.input};
  border: 1px solid ${COLORS.border};
  border-radius: 3px;
  padding: 1px 5px;
}
.pyr3-picker-close {
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
.pyr3-picker-close:hover {
  background: ${COLORS.bg.input};
  color: ${COLORS.danger};
}
.pyr3-picker-search {
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
.pyr3-picker-search::placeholder { color: ${COLORS.text.dim}; }
.pyr3-picker-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid ${COLORS.border};
  padding-bottom: 4px;
}
.pyr3-picker-tab {
  font-size: 11px;
  padding: 3px 8px;
  color: ${COLORS.text.muted};
  border-radius: 3px 3px 0 0;
  cursor: pointer;
  border: 1px solid transparent;
  user-select: none;
}
.pyr3-picker-tab:hover { color: ${COLORS.text.primary}; }
.pyr3-picker-tab.active {
  color: ${COLORS.flame.top};
  background: ${COLORS.bg.action};
  border-color: ${COLORS.flame.bot};
}
.pyr3-picker-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}
.pyr3-picker-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 12px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  align-content: start;
}
.pyr3-picker-foot {
  padding: 8px 12px;
  border-top: 1px solid ${COLORS.border};
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.pyr3-picker-selected {
  flex: 1 1 auto;
  font-size: 11px;
  color: ${COLORS.text.muted};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pyr3-picker-foot-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}
`;
