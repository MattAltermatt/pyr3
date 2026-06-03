// pyr3 — /v1/edit palette section.
//
// Quick-pass content (per the v1 design spec):
//   - clickable gradient strip showing the current palette
//   - label with palette.name
//   - ◀ / ▶ arrows that step paletteIdx ± 1 mod FLAM3_PALETTE_COUNT
//   - clicking the strip opens a small popover with ~30 neighbour cells
//     (3-column grid) so the user can jump to any nearby palette
//   - hue-rotation slider (0..360°) + number input → palette.hue
//   - mode radio (linear / step) → palette.mode
//
// The 701-cell full picker is deferred — v1 ships the small neighbour-cell
// popover and the ◀/▶ arrows; the full picker is a v2 candidate.
//
// onChange paths (matching pathLane in src/edit-state.ts):
//   - palette swap     → onChange('palette')      (fast lane)
//   - palette hue      → onChange('palette.hue')  (fast lane)
//   - palette mode     → onChange('palette.mode') (fast lane)

import { type SectionMount } from './edit-ui';
import { type Palette, type PaletteMode } from './palette';
import { FLAM3_PALETTE_COUNT, getLibraryStops } from './flam3-palettes';

const POPOVER_CELLS = 30;     // 3 cols × 10 rows around current index
const POPOVER_COLS = 3;
const POPOVER_HALF = Math.floor(POPOVER_CELLS / 2);

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
// order stops still render correctly.
function gradientCss(palette: Palette): string {
  const stops = [...palette.stops].sort((a, b) => a.t - b.t);
  if (stops.length === 0) return 'linear-gradient(to right, #000, #000)';
  const parts = stops.map((s) => {
    const r = Math.round(s.r * 255);
    const g = Math.round(s.g * 255);
    const b = Math.round(s.b * 255);
    const pct = Math.max(0, Math.min(100, s.t * 100)).toFixed(2);
    return `rgb(${r}, ${g}, ${b}) ${pct}%`;
  });
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

export const paletteSection: SectionMount = {
  key: 'palette',
  title: '🎨 PALETTE',
  build(host, state, onChange) {
    host.classList.add('pyr3-edit-section-palette');

    // Closure-local current index. Seed from the genome's palette.name when it
    // matches `flame #N`; otherwise default to 0.
    let paletteIdx = parseFlameIndex(state.genome.palette.name) ?? 0;

    // ── Strip row: ◀ strip ▶ ────────────────────────────────────────────────
    const stripRow = document.createElement('div');
    stripRow.className = 'pyr3-edit-palette-strip-row';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'pyr3-edit-palette-arrow pyr3-edit-palette-prev';
    prevBtn.textContent = '◀';

    const strip = document.createElement('div');
    strip.className = 'pyr3-edit-palette-strip';
    strip.setAttribute('role', 'button');
    strip.tabIndex = 0;
    strip.style.flex = '1 1 auto';
    strip.style.height = '32px';
    strip.style.cursor = 'pointer';
    strip.style.border = '1px solid var(--bar-border, #2a2a30)';
    strip.style.borderRadius = '2px';

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'pyr3-edit-palette-arrow pyr3-edit-palette-next';
    nextBtn.textContent = '▶';

    stripRow.append(prevBtn, strip, nextBtn);
    host.appendChild(stripRow);

    // ── Name label ──────────────────────────────────────────────────────────
    const label = document.createElement('div');
    label.className = 'pyr3-edit-palette-label';
    label.style.fontSize = '11px';
    label.style.color = 'var(--text-dim, #888)';
    label.style.marginTop = '4px';
    host.appendChild(label);

    // ── Hue row ─────────────────────────────────────────────────────────────
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

    // ── Mode row ────────────────────────────────────────────────────────────
    const modeRow = document.createElement('div');
    modeRow.className = 'pyr3-edit-palette-mode-row';
    modeRow.style.display = 'flex';
    modeRow.style.alignItems = 'center';
    modeRow.style.gap = '8px';
    modeRow.style.marginTop = '6px';

    const modeLabelTxt = document.createElement('span');
    modeLabelTxt.textContent = 'mode';
    modeLabelTxt.style.width = '32px';

    // Unique radio-group name per mount so multiple instances in tests don't
    // collide (happy-dom respects HTML group semantics).
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

    // ── Popover (lazily created when the user clicks the strip) ─────────────
    let popover: HTMLElement | null = null;

    function closePopover(): void {
      if (popover) {
        popover.remove();
        popover = null;
      }
    }

    function openPopover(): void {
      if (popover) {
        closePopover();
        return;
      }
      const pop = document.createElement('div');
      pop.className = 'pyr3-edit-palette-popover';
      pop.style.display = 'grid';
      pop.style.gridTemplateColumns = `repeat(${POPOVER_COLS}, 1fr)`;
      pop.style.gap = '3px';
      pop.style.padding = '6px';
      pop.style.marginTop = '4px';
      pop.style.background = 'var(--bar-bg-2, #1a1a20)';
      pop.style.border = '1px solid var(--bar-border, #2a2a30)';
      pop.style.borderRadius = '4px';
      pop.style.maxHeight = '240px';
      pop.style.overflowY = 'auto';

      const startBase = paletteIdx - POPOVER_HALF;
      for (let i = 0; i < POPOVER_CELLS; i++) {
        // Wrap around the library so the popover always shows POPOVER_CELLS cells.
        const candidate = ((startBase + i) % FLAM3_PALETTE_COUNT + FLAM3_PALETTE_COUNT) % FLAM3_PALETTE_COUNT;
        const cell = document.createElement('div');
        cell.className = 'pyr3-edit-palette-popover-cell';
        cell.setAttribute('data-palette-idx', String(candidate));
        cell.style.height = '20px';
        cell.style.cursor = 'pointer';
        cell.style.border = candidate === paletteIdx
          ? '1px solid var(--accent-border, #884a1a)'
          : '1px solid var(--bar-border, #2a2a30)';
        cell.style.borderRadius = '2px';
        cell.title = `flame #${candidate}`;
        const p = paletteAtIndex(candidate);
        cell.style.background = gradientCss(p);
        cell.addEventListener('click', (ev) => {
          ev.stopPropagation();
          setPaletteIndex(candidate);
          closePopover();
        });
        pop.appendChild(cell);
      }
      popover = pop;
      host.appendChild(pop);
    }

    // ── State mutators ──────────────────────────────────────────────────────

    function refreshStrip(): void {
      strip.style.background = gradientCss(state.genome.palette);
      label.textContent = state.genome.palette.name;
    }

    function setPaletteIndex(idx: number): void {
      const wrapped = ((idx % FLAM3_PALETTE_COUNT) + FLAM3_PALETTE_COUNT) % FLAM3_PALETTE_COUNT;
      paletteIdx = wrapped;
      const fresh = paletteAtIndex(wrapped);
      // Preserve current hue + mode through the swap (they're palette-relative
      // transforms — swapping the underlying stops shouldn't reset the user's
      // hue dial back to 0).
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
      // Keep the two hue widgets in sync (slider drags update the number;
      // number-input edits update the slider).
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
    strip.addEventListener('click', openPopover);
    strip.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        openPopover();
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
