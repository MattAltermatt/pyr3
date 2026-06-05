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
import { FLAM3_PALETTE_COUNT } from './flam3-palettes';

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

  // Chip row (Task 9.5 fills this with 11 color filter chips)
  const chipRow = document.createElement('div');
  chipRow.className = 'pyr3-palette-picker-chip-row';
  head.appendChild(chipRow);

  // Tabs: all (701) · ★ favorites (N)
  const tabsRow = document.createElement('div');
  tabsRow.className = 'pyr3-palette-picker-tabs';
  const allTab = document.createElement('div');
  allTab.className = 'pyr3-palette-picker-tab active';
  allTab.dataset['tab'] = 'all';
  allTab.textContent = `all (${FLAM3_PALETTE_COUNT})`;
  const favTab = document.createElement('div');
  favTab.className = 'pyr3-palette-picker-tab';
  favTab.dataset['tab'] = 'favorites';
  favTab.textContent = '★ favorites (0)';
  tabsRow.append(allTab, favTab);
  head.appendChild(tabsRow);

  // Controls row: sort dropdown · auto-apply toggle
  const controlsRow = document.createElement('div');
  controlsRow.className = 'pyr3-palette-picker-controls';

  const sort = buildDropdown({
    value: 'number',
    options: [
      { value: 'number', label: 'sort: number' },
      { value: 'name',   label: 'sort: name' },
      { value: 'hue',    label: 'sort: hue' },
      { value: 'sat',    label: 'sort: saturation' },
      { value: 'light',  label: 'sort: lightness' },
    ],
    onChange: () => { /* Task 9.4+ wires the body re-sort */ },
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
    onChange: () => { /* Task 9.8 wires commit semantics */ },
  });
  autoApply.classList.add('pyr3-palette-picker-auto-apply');
  autoApplyWrap.append(autoApplyLabel, autoApply);

  controlsRow.append(sort, autoApplyWrap);
  head.appendChild(controlsRow);

  picker.appendChild(head);

  // ── Body (Task 9.4 fills with the 3-col cell grid) ──────────────────────
  const body = document.createElement('div');
  body.className = 'pyr3-palette-picker-body';
  picker.appendChild(body);

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
    onClick: () => { /* Task 9.8 wires snapshot restore */ },
  });
  revertBtn.classList.add('pyr3-palette-picker-revert');

  const applyBtn = buildButton({
    variant: 'primary',
    label: 'apply & close',
    onClick: () => {
      opts.onApply(opts.current);
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
  width: 380px;
  display: flex;
  flex-direction: column;
  background: ${COLORS.bg.panel};
  border: 1px solid ${COLORS.border};
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.5);
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: ${COLORS.text.primary};
  font-size: 12px;
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
