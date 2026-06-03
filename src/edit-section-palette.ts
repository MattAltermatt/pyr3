// pyr3 — /v1/edit palette section.
//
// Layout:
//   - Strip row: [◀] [gradient strip — click to pick] [▶]   (flex, single row)
//   - Label:     "<library-name> · flame #N"               (uses getLibraryPaletteName)
//   - Hue:       slider 0..360 + number input              → palette.hue
//   - Mode:      linear / step radio                        → palette.mode
//
// Picker (clicking the strip): full 701-palette 3-column grid with live
// name-search + footer. Same pattern as /v1/evolve's buildPalettePicker
// (parked branch); CSS class names mirror so future DRY into a shared
// `pyr3-palette-picker` is mechanical.
//
// onChange paths (matching pathLane in src/edit-state.ts):
//   - palette swap     → onChange('palette')      (fast lane)
//   - palette hue      → onChange('palette.hue')  (fast lane)
//   - palette mode     → onChange('palette.mode') (fast lane)

import { type SectionMount } from './edit-ui';
import { type Palette, type PaletteMode, type ColorStop } from './palette';
import { FLAM3_PALETTE_COUNT, getLibraryStops, getLibraryPaletteName } from './flam3-palettes';

// Parse `flame #N` → N. Returns null when the name doesn't match. Closure-
// only state; we don't add a field to EditState.
function parseFlameIndex(name: string): number | null {
  const m = /^flame\s+#(\d+)$/i.exec(name);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 0 || n >= FLAM3_PALETTE_COUNT) return null;
  return n;
}

function paletteAtIndex(idx: number): Palette {
  const stops = getLibraryStops(idx) ?? [];
  return { name: `flame #${idx}`, stops };
}

// Build a CSS linear-gradient from a palette's stops. Sorted by t so out-of-
// order stops still render correctly. Caps at 16 stops for browser perf.
function gradientCss(palette: { stops: ColorStop[] }): string {
  const stops = [...palette.stops].sort((a, b) => a.t - b.t);
  if (stops.length === 0) return 'linear-gradient(to right, #000, #000)';
  const N = Math.min(stops.length, 16);
  const step = Math.max(1, Math.floor(stops.length / N));
  const parts: string[] = [];
  for (let i = 0; i < stops.length; i += step) {
    const s = stops[i]!;
    const r = Math.round(s.r * 255);
    const g = Math.round(s.g * 255);
    const b = Math.round(s.b * 255);
    const pct = Math.max(0, Math.min(100, s.t * 100)).toFixed(2);
    parts.push(`rgb(${r}, ${g}, ${b}) ${pct}%`);
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

// Format the readable label for `flame #N` — `<name> · flame #N` when a name
// is known, else just `flame #N`.
function paletteDisplayLabel(idx: number): string {
  const name = getLibraryPaletteName(idx);
  return name ? `${name} · flame #${idx}` : `flame #${idx}`;
}

// Lazy entries cache — pays the 701-decode only on first picker open.
interface LibraryEntry { idx: number; name: string; gradient: string; }
let _libraryEntries: LibraryEntry[] | null = null;
function getLibraryEntries(): LibraryEntry[] {
  if (_libraryEntries) return _libraryEntries;
  const out: LibraryEntry[] = [];
  for (let i = 0; i < FLAM3_PALETTE_COUNT; i++) {
    const stops = getLibraryStops(i) ?? [];
    out.push({
      idx: i,
      name: getLibraryPaletteName(i) ?? `no-name`,
      gradient: gradientCss({ stops }),
    });
  }
  _libraryEntries = out;
  return out;
}

export const paletteSection: SectionMount = {
  key: 'palette',
  title: '🎨 PALETTE',
  build(host, state, onChange) {
    ensurePaletteStyles();
    host.classList.add('pyr3-edit-section-palette');

    // Closure-local current index. Seed from the genome's palette.name when it
    // matches `flame #N`; otherwise default to 0.
    let paletteIdx = parseFlameIndex(state.genome.palette.name) ?? 0;

    // ── Strip row: [◀] [strip] [▶] — single flex row ───────────────────────
    const stripRow = document.createElement('div');
    stripRow.className = 'pyr3-edit-palette-strip-row';
    stripRow.style.display = 'flex';
    stripRow.style.alignItems = 'center';
    stripRow.style.gap = '6px';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'pyr3-edit-palette-arrow pyr3-edit-palette-prev';
    prevBtn.textContent = '◀';
    prevBtn.title = 'previous palette';

    const strip = document.createElement('div');
    strip.className = 'pyr3-edit-palette-strip';
    strip.setAttribute('role', 'button');
    strip.tabIndex = 0;
    strip.style.flex = '1 1 auto';
    strip.style.height = '32px';
    strip.style.minWidth = '0';
    strip.style.cursor = 'pointer';
    strip.style.border = '1px solid var(--bar-border, #2a2a30)';
    strip.style.borderRadius = '2px';
    strip.title = 'click to pick a palette';

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'pyr3-edit-palette-arrow pyr3-edit-palette-next';
    nextBtn.textContent = '▶';
    nextBtn.title = 'next palette';

    stripRow.append(prevBtn, strip, nextBtn);
    host.appendChild(stripRow);

    // ── Label: "<name> · flame #N" ─────────────────────────────────────────
    const label = document.createElement('div');
    label.className = 'pyr3-edit-palette-label';
    label.style.fontSize = '11px';
    label.style.color = 'var(--text-dim, #888)';
    label.style.marginTop = '4px';
    host.appendChild(label);

    // ── Hue row ────────────────────────────────────────────────────────────
    const hueRow = document.createElement('div');
    hueRow.className = 'pyr3-edit-palette-hue-row';
    hueRow.style.display = 'flex';
    hueRow.style.alignItems = 'center';
    hueRow.style.gap = '6px';
    hueRow.style.marginTop = '8px';

    const hueLabel = document.createElement('span');
    hueLabel.textContent = 'hue';
    hueLabel.style.width = '32px';

    const hueSlider = document.createElement('input');
    hueSlider.type = 'range';
    hueSlider.min = '0';
    hueSlider.max = '360';
    hueSlider.step = '1';
    hueSlider.className = 'pyr3-edit-palette-hue-slider';
    hueSlider.style.flex = '1 1 auto';

    const hueNumber = document.createElement('input');
    hueNumber.type = 'number';
    hueNumber.min = '0';
    hueNumber.max = '360';
    hueNumber.step = '1';
    hueNumber.className = 'pyr3-edit-palette-hue-number';
    hueNumber.style.width = '54px';

    hueRow.append(hueLabel, hueSlider, hueNumber);
    host.appendChild(hueRow);

    // ── Mode row ───────────────────────────────────────────────────────────
    const modeRow = document.createElement('div');
    modeRow.className = 'pyr3-edit-palette-mode-row';
    modeRow.style.display = 'flex';
    modeRow.style.alignItems = 'center';
    modeRow.style.gap = '8px';
    modeRow.style.marginTop = '6px';

    const modeLabelTxt = document.createElement('span');
    modeLabelTxt.textContent = 'mode';
    modeLabelTxt.style.width = '32px';

    const radioGroup = `pyr3-edit-palette-mode-${Math.random().toString(36).slice(2, 9)}`;

    function makeRadio(value: PaletteMode, labelText: string): {
      input: HTMLInputElement;
      wrap: HTMLLabelElement;
    } {
      const wrap = document.createElement('label');
      wrap.style.display = 'inline-flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '3px';
      wrap.style.cursor = 'pointer';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = radioGroup;
      input.value = value;
      input.className = `pyr3-edit-palette-mode-${value}`;
      const t = document.createTextNode(labelText);
      wrap.append(input, t);
      return { input, wrap };
    }

    const linearRadio = makeRadio('linear', 'linear');
    const stepRadio = makeRadio('step', 'step');
    modeRow.append(modeLabelTxt, linearRadio.wrap, stepRadio.wrap);
    host.appendChild(modeRow);

    // ── Full picker (3-col grid + search + footer; opens on strip click) ───
    let picker: HTMLElement | null = null;
    let dismissHandler: ((ev: MouseEvent | KeyboardEvent) => void) | null = null;

    function closePicker(): void {
      if (picker) {
        picker.remove();
        picker = null;
      }
      if (dismissHandler) {
        document.removeEventListener('mousedown', dismissHandler);
        document.removeEventListener('keydown', dismissHandler);
        dismissHandler = null;
      }
    }

    function openPicker(): void {
      if (picker) { closePicker(); return; }
      picker = buildPicker(paletteIdx, (idx) => {
        setPaletteIndex(idx);
        closePicker();
      });
      // Position fixed near the strip so the popover doesn't reflow the panel.
      const rect = strip.getBoundingClientRect();
      picker.style.left = `${Math.round(rect.left)}px`;
      picker.style.top = `${Math.round(rect.bottom + 6)}px`;
      document.body.appendChild(picker);

      dismissHandler = (ev) => {
        if (ev instanceof KeyboardEvent) {
          if (ev.key === 'Escape') closePicker();
          return;
        }
        const t = ev.target as Node;
        if (picker && !picker.contains(t) && t !== strip) closePicker();
      };
      document.addEventListener('mousedown', dismissHandler);
      document.addEventListener('keydown', dismissHandler);
    }

    // ── State mutators ──────────────────────────────────────────────────────

    function refreshStrip(): void {
      strip.style.background = gradientCss(state.genome.palette);
      label.textContent = paletteDisplayLabel(paletteIdx);
    }

    function setPaletteIndex(idx: number): void {
      const wrapped = ((idx % FLAM3_PALETTE_COUNT) + FLAM3_PALETTE_COUNT) % FLAM3_PALETTE_COUNT;
      paletteIdx = wrapped;
      const fresh = paletteAtIndex(wrapped);
      // Preserve current hue + mode through the swap.
      const existing = state.genome.palette;
      state.genome.palette = {
        name: fresh.name,
        stops: fresh.stops,
        ...(existing.hue !== undefined ? { hue: existing.hue } : {}),
        ...(existing.mode !== undefined ? { mode: existing.mode } : {}),
      };
      refreshStrip();
      onChange('palette');
    }

    function setHue(deg: number): void {
      const clamped = Math.max(0, Math.min(360, Math.round(deg)));
      state.genome.palette.hue = clamped;
      if (hueSlider.value !== String(clamped)) hueSlider.value = String(clamped);
      if (hueNumber.value !== String(clamped)) hueNumber.value = String(clamped);
      refreshStrip();
      onChange('palette.hue');
    }

    function setMode(mode: PaletteMode): void {
      state.genome.palette.mode = mode;
      onChange('palette.mode');
    }

    // ── Wire events ─────────────────────────────────────────────────────────
    prevBtn.addEventListener('click', () => setPaletteIndex(paletteIdx - 1));
    nextBtn.addEventListener('click', () => setPaletteIndex(paletteIdx + 1));
    strip.addEventListener('click', openPicker);
    strip.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        openPicker();
      }
    });

    hueSlider.addEventListener('input', () => setHue(Number(hueSlider.value)));
    hueNumber.addEventListener('input', () => {
      const n = Number(hueNumber.value);
      if (Number.isFinite(n)) setHue(n);
    });

    linearRadio.input.addEventListener('change', () => {
      if (linearRadio.input.checked) setMode('linear');
    });
    stepRadio.input.addEventListener('change', () => {
      if (stepRadio.input.checked) setMode('step');
    });

    // ── Initial render ──────────────────────────────────────────────────────
    refreshStrip();
    const initialHue = state.genome.palette.hue ?? 0;
    hueSlider.value = String(initialHue);
    hueNumber.value = String(initialHue);
    const initialMode = state.genome.palette.mode ?? 'linear';
    linearRadio.input.checked = initialMode === 'linear';
    stepRadio.input.checked = initialMode === 'step';
  },
};

// ─── Full picker: 3-col grid + live search + footer (evolve pattern) ────────

function buildPicker(currentIdx: number, onPick: (idx: number) => void): HTMLDivElement {
  const entries = getLibraryEntries();

  const root = document.createElement('div');
  root.className = 'pyr3-edit-palette-picker';

  // Search bar
  const searchWrap = document.createElement('div');
  searchWrap.className = 'pyr3-edit-palette-picker-search';
  const search = document.createElement('input');
  search.type = 'text';
  search.placeholder = `🔍 search ${FLAM3_PALETTE_COUNT} palettes by name…`;
  search.spellcheck = false;
  search.autocomplete = 'off';
  searchWrap.appendChild(search);
  root.appendChild(searchWrap);

  // 3-col grid body
  const body = document.createElement('div');
  body.className = 'pyr3-edit-palette-picker-body';
  const cellByIdx = new Map<number, HTMLDivElement>();
  for (const entry of entries) {
    const cell = document.createElement('div');
    cell.className = 'pyr3-edit-palette-picker-cell';
    if (entry.idx === currentIdx) cell.classList.add('current');
    cell.dataset['paletteIdx'] = String(entry.idx);
    cell.dataset['paletteName'] = entry.name;
    cell.title = `${entry.name} · flame #${entry.idx}`;

    const stripEl = document.createElement('div');
    stripEl.className = 'pyr3-edit-palette-picker-cell-strip';
    stripEl.style.background = entry.gradient;
    cell.appendChild(stripEl);

    const nameEl = document.createElement('div');
    nameEl.className = 'pyr3-edit-palette-picker-cell-name';
    nameEl.textContent = entry.name;
    cell.appendChild(nameEl);

    const numEl = document.createElement('div');
    numEl.className = 'pyr3-edit-palette-picker-cell-num';
    numEl.textContent = `#${entry.idx}`;
    cell.appendChild(numEl);

    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      onPick(entry.idx);
    });
    body.appendChild(cell);
    cellByIdx.set(entry.idx, cell);
  }
  root.appendChild(body);

  // Footer (count + hover-name)
  const footer = document.createElement('div');
  footer.className = 'pyr3-edit-palette-picker-footer';
  const countEl = document.createElement('span');
  countEl.textContent = `${FLAM3_PALETTE_COUNT} palettes`;
  const hoverEl = document.createElement('span');
  hoverEl.className = 'hover-name';
  hoverEl.textContent = 'esc to close';
  footer.appendChild(countEl);
  footer.appendChild(hoverEl);
  root.appendChild(footer);

  body.addEventListener('mouseover', (e) => {
    const target = e.target as HTMLElement;
    const cell = target.closest('.pyr3-edit-palette-picker-cell');
    if (cell instanceof HTMLElement) {
      const name = cell.dataset['paletteName'] ?? '';
      const idx = cell.dataset['paletteIdx'] ?? '';
      hoverEl.textContent = `${name} · flame #${idx}`;
    }
  });
  body.addEventListener('mouseleave', () => { hoverEl.textContent = 'esc to close'; });

  let visibleCount = entries.length;
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    visibleCount = 0;
    for (const entry of entries) {
      const cell = cellByIdx.get(entry.idx)!;
      const match = q === '' || entry.name.toLowerCase().includes(q);
      cell.style.display = match ? '' : 'none';
      if (match) visibleCount++;
    }
    countEl.textContent = q === ''
      ? `${FLAM3_PALETTE_COUNT} palettes`
      : `${visibleCount} / ${FLAM3_PALETTE_COUNT} match`;
  });

  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    for (const entry of entries) {
      const cell = cellByIdx.get(entry.idx)!;
      if (cell.style.display !== 'none') {
        onPick(entry.idx);
        return;
      }
    }
  });

  // Scroll current into view after layout settles.
  setTimeout(() => {
    const cell = cellByIdx.get(currentIdx);
    if (cell) cell.scrollIntoView({ block: 'center', behavior: 'auto' });
    search.focus();
  }, 0);

  return root;
}

// One-time CSS injection (idempotent — same id check as the rest of the editor).
function ensurePaletteStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('pyr3-edit-palette-styles')) return;
  const style = document.createElement('style');
  style.id = 'pyr3-edit-palette-styles';
  style.textContent = PALETTE_CSS;
  document.head.appendChild(style);
}

const PALETTE_CSS = `
.pyr3-edit-palette-arrow {
  background: var(--bar-bg-2, #1a1a20);
  color: var(--text, #ddd);
  border: 1px solid var(--bar-border, #2a2a30);
  border-radius: 3px;
  padding: 2px 8px;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  flex: 0 0 auto;
}
.pyr3-edit-palette-arrow:hover {
  background: var(--accent-soft, rgba(255, 140, 26, 0.18));
  border-color: var(--accent-border, #884a1a);
}
/* Full picker: 3-col grid + search + footer (mirrors evolve picker). */
.pyr3-edit-palette-picker {
  position: fixed;
  background: #0c0c10;
  border: 1px solid #2a2a36;
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
  width: 360px;
  max-height: 460px;
  display: flex;
  flex-direction: column;
  z-index: 1000;
  overflow: hidden;
}
.pyr3-edit-palette-picker-search {
  padding: 8px;
  border-bottom: 1px solid #1e1e26;
  flex-shrink: 0;
}
.pyr3-edit-palette-picker-search input {
  width: 100%;
  background: #1a1a22;
  border: 1px solid #2a2a36;
  color: #ccc;
  border-radius: 3px;
  padding: 5px 8px;
  font-family: inherit;
  font-size: 12px;
  box-sizing: border-box;
}
.pyr3-edit-palette-picker-search input::placeholder { color: #555; }
.pyr3-edit-palette-picker-body {
  overflow-y: auto;
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  flex: 1;
  min-height: 0;
}
.pyr3-edit-palette-picker-cell {
  cursor: pointer;
  padding: 4px;
  border-radius: 3px;
  background: transparent;
}
.pyr3-edit-palette-picker-cell:hover { background: #15151a; }
.pyr3-edit-palette-picker-cell.current { background: rgba(255, 140, 26, 0.10); }
.pyr3-edit-palette-picker-cell-strip {
  height: 16px;
  border-radius: 2px;
}
.pyr3-edit-palette-picker-cell-name {
  font-size: 9px;
  color: #888;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}
.pyr3-edit-palette-picker-cell-num {
  font-size: 8px;
  color: #555;
  text-align: center;
}
.pyr3-edit-palette-picker-footer {
  padding: 6px 10px;
  border-top: 1px solid #1e1e26;
  color: #666;
  font-size: 10px;
  display: flex;
  justify-content: space-between;
  flex-shrink: 0;
}
.pyr3-edit-palette-picker-footer .hover-name { color: var(--accent, #ff8c1a); }
`;
