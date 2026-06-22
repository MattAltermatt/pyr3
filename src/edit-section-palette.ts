// pyr3 — /editor palette section (Phase 9 visual overhaul).
//
// Layout:
//   - Ribbon (full-width 22px, top) — gradient strip of the current palette;
//     CSS `filter: hue-rotate(<deg>deg)` previews the rotated palette live
//     without re-baking the LUT. Click = shortcut to open the picker.
//     This is the locked exception to the section's row-grid convention.
//   - palette row   — buildRow('palette', launcher button). The launcher
//     text comes from paletteIdentifier(state.paletteSource ?? inferred).
//     Click → state.openPalettePicker() (wired by the editor mount).
//   - hue rotation  — buildRow('hue rotation', buildSlider 0..360 deg).
//   - reset action  — inline accent `⟲ reset hue` btn (no label column).
//   - mode row      — preserved from pre-Phase-9 (genome.paletteMode
//     scatter-time sampling; linear vs step radio).
//
// Section header gains a `hue +N°` chip when hue is non-zero (mirrors the
// density section's chip pattern; mounted via a microtask after build()).
//
// onChange paths (matching pathLane in src/edit-state.ts):
//   - palette swap     → onChange('palette')      (slow lane)
//   - palette hue      → onChange('palette.hue')  (slow lane)
//   - palette mode     → onChange('paletteMode')  (slow lane)
//
// The launcher / ribbon both open the picker via state.openPalettePicker —
// the section never constructs the picker itself. That keeps the section
// stateless wrt picker lifecycle; the editor host owns the docking.

import { type SectionMount } from './edit-ui';
import { type Palette, type PaletteMode, type ColorStop, paletteFromStops } from './palette';
import { generateRamp, defaultRampMeta } from './palette-generate';
import { FLAM3_PALETTE_COUNT, getLibraryStops } from './flam3-palettes';
import {
  type PaletteSource,
  paletteIdentifier,
  FLAM3_PALETTE_NAMES,
} from './flam3-palette-names';
import { COLORS } from './ui-tokens';
import { infoIcon } from './help-text';
import { buildRow, buildSlider, buildButton } from './edit-primitives';
import { buildBackgroundControl } from './edit-section-background';
import { mountPaletteGenerator } from './edit-palette-generator';
import { mountPalettePicker, type PalettePickerHandle } from './palette-picker';
import { getMine, saveMine } from './palette-library';
import { exportPalette, importPalette } from './palette-file';
import { openNamingDialog } from './naming-dialog';
import { setActiveCanvasOverlay } from './edit-state';

// Parse `flame #N` → N. Returns null when the name doesn't match.
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

// Derive a PaletteSource from the genome's palette.name. Used when state hasn't
// explicitly set paletteSource, and after undo/redo (which restore the palette
// but NOT the editor's transient paletteSource). `flame #N` → flam3 index;
// otherwise match the name against the catalog so a named library palette keeps
// its real label instead of falling back to a placeholder (#358).
function inferPaletteSource(palette: Palette): PaletteSource {
  const idx = parseFlameIndex(palette.name);
  if (idx !== null) return { kind: 'flam3', number: idx };
  const byName = FLAM3_PALETTE_NAMES.indexOf(palette.name);
  if (byName >= 0) return { kind: 'flam3', number: byName };
  // Fallback for unknown-source palettes — show as flam3 #0 placeholder.
  return { kind: 'flam3', number: 0 };
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

export const paletteSection: SectionMount = {
  key: 'palette',
  lens: 'color',
  // Title is just 'Palette' — the Color lens group divider (#358) now carries
  // the 🎨 emoji + category label, so the section header stays unadorned.
  title: 'Palette',
  build(host, state, onChange) {
    ensurePaletteStyles();
    host.classList.add('pyr3-edit-section-palette');

    // ── Ribbon (full-width 22px, top) ──────────────────────────────────────
    // Locked exception to the row grid: full-width preview strip. Clicking
    // it opens the picker (handled in the click handler below; ribbon click
    // does NOT also affect hue — different element entirely).
    const ribbon = document.createElement('div');
    ribbon.className = 'pyr3-edit-palette-ribbon';
    ribbon.setAttribute('role', 'button');
    ribbon.tabIndex = 0;
    ribbon.title = 'click to pick a palette';
    ribbon.style.width = '100%';
    ribbon.style.height = '22px';
    ribbon.style.border = `1px solid ${COLORS.border}`;
    ribbon.style.borderRadius = '2px';
    ribbon.style.cursor = 'pointer';
    ribbon.style.marginBottom = '10px';
    host.appendChild(ribbon);

    // ── "Edit gradient" toggle — flips the editor into gradient-edit mode and
    //    attaches the on-canvas overlay (#372). Replaces the old navigate-away
    //    to /gradient: the bar + stoppers now float over the flame; this section
    //    hosts the parametric controls + the selected-stop readout. The actual
    //    overlay attach/detach lives in edit-mount, reacting to
    //    state.activeCanvasOverlay via state.onCanvasOverlayChange.
    const editGradientBtn = buildButton({
      variant: 'accent',
      label: 'Edit gradient',
      icon: '🎨',
      onClick: () => {
        const on = state.activeCanvasOverlay === 'gradient';
        setActiveCanvasOverlay(state, on ? 'none' : 'gradient');
        state.onCanvasOverlayChange?.();
        refreshGradientToggle();
      },
    });
    editGradientBtn.classList.add('pyr3-edit-gradient-link');
    editGradientBtn.dataset['role'] = 'edit-gradient-toggle';
    function refreshGradientToggle(): void {
      const on = state.activeCanvasOverlay === 'gradient';
      editGradientBtn.setAttribute('aria-pressed', String(on));
      editGradientBtn.textContent = on ? '🎨 Editing gradient — done' : '🎨 Edit gradient';
    }
    refreshGradientToggle();
    const editGradientRow = document.createElement('div');
    editGradientRow.style.display = 'flex';
    editGradientRow.style.justifyContent = 'flex-end';
    editGradientRow.style.margin = '0 0 8px';
    editGradientRow.appendChild(editGradientBtn);
    host.appendChild(editGradientRow);

    // Selected-stop readout — edit-mount updates this via the overlay's onSelect
    // while gradient-edit mode is active.
    const gradientReadout = document.createElement('div');
    gradientReadout.dataset['role'] = 'gradient-readout';
    Object.assign(gradientReadout.style, {
      fontSize: '11px', color: COLORS.text.muted, margin: '0 0 6px', minHeight: '14px',
    });
    host.appendChild(gradientReadout);

    // Controls host — edit-mount mounts the overlay's mountPaletteEditor controls
    // (interpolation / transforms / delete / resample) here, in the subpanel.
    const gradientControlsHost = document.createElement('div');
    gradientControlsHost.dataset['role'] = 'gradient-controls-host';
    host.appendChild(gradientControlsHost);

    // ── Library cluster (#372) — Save / Import / Export the current palette. ──
    // Re-hosts the former /gradient library chrome; the picker stays a read-only
    // chooser and surfaces saved palettes in its "mine" tab.
    const libRow = document.createElement('div');
    libRow.className = 'pyr3-edit-palette-library';
    Object.assign(libRow.style, { display: 'flex', gap: '6px', margin: '6px 0 2px' });

    const saveBtn = buildButton({
      variant: 'plain', label: 'Save', icon: '💾',
      onClick: () => {
        const p = state.genome.palette;
        void openNamingDialog({ kind: 'palette-library', seed: { name: p.name } }).then((res) => {
          if (!res) return;
          saveMine({
            name: res.name,
            stops: p.stops.map((s) => ({ ...s })),
            ...(p.hue ? { hue: p.hue } : {}),
            ...(p.mode ? { mode: p.mode } : {}),
          });
        });
      },
    });
    saveBtn.dataset['role'] = 'palette-save';

    const importBtn = buildButton({
      variant: 'plain', label: 'Import', icon: '📥',
      onClick: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', () => {
          const f = input.files?.[0];
          if (!f) return;
          void importPalette(f).then((p) => {
            state.genome.palette = p;
            onChange('palette');   // slow-lane re-iterate
            refreshRibbon();
            refreshLauncher();
            refreshGenConfig();
          });
        });
        input.click();
      },
    });
    importBtn.dataset['role'] = 'palette-import';

    const exportBtn = buildButton({
      variant: 'plain', label: 'Export', icon: '📤',
      onClick: () => exportPalette(state.genome.palette),
    });
    exportBtn.dataset['role'] = 'palette-export';

    libRow.append(saveBtn, importBtn, exportBtn);
    host.appendChild(libRow);

    // ── palette row (launcher button) ──────────────────────────────────────
    const launcher = document.createElement('div');
    launcher.className = 'pyr3-edit-palette-launcher';
    launcher.style.display = 'inline-flex';
    launcher.style.alignItems = 'center';
    launcher.style.gap = '6px';
    launcher.style.padding = '4px 8px';
    launcher.style.borderRadius = '3px';
    launcher.style.border = `1px solid ${COLORS.border}`;
    launcher.style.background = COLORS.bg.input;
    launcher.style.cursor = 'pointer';
    launcher.style.fontSize = '12px';
    launcher.style.flex = '1 1 0';
    launcher.style.minWidth = '0';
    launcher.title = 'click to pick a palette';

    const launcherPrefix = document.createElement('span');
    launcherPrefix.className = 'pyr3-edit-palette-launcher-prefix';
    launcherPrefix.style.color = COLORS.text.dim;
    const launcherName = document.createElement('span');
    launcherName.className = 'pyr3-edit-palette-launcher-name';
    launcherName.style.color = COLORS.flame.top;
    launcherName.style.flex = '1 1 0';
    launcherName.style.minWidth = '0';
    launcherName.style.overflow = 'hidden';
    launcherName.style.textOverflow = 'ellipsis';
    launcherName.style.whiteSpace = 'nowrap';
    const browseCue = document.createElement('span');
    browseCue.className = 'pyr3-edit-palette-launcher-cue';
    browseCue.textContent = `browse ${FLAM3_PALETTE_COUNT} ▸`;
    browseCue.style.color = COLORS.text.muted;
    browseCue.style.fontSize = '10px';
    browseCue.style.flex = '0 0 auto';

    launcher.append(launcherPrefix, launcherName, browseCue);
    host.appendChild(buildRow('palette', launcher));

    // ── hue rotation row ───────────────────────────────────────────────────
    const initialHue = state.genome.palette.hue ?? 0;
    const hueSlider = buildSlider({
      value: initialHue,
      min: 0,
      max: 360,
      step: 1,
      format: (v) => `${Math.round(v)}°`,
      onChange: (v) => setHue(v),
    });
    hueSlider.classList.add('pyr3-edit-palette-hue-row');
    host.appendChild(buildRow('hue rotation', hueSlider));

    // ── reset hue inline action ────────────────────────────────────────────
    // Action-only row with no label column — sits just under the hue slider.
    const resetBtn = buildButton({
      variant: 'accent',
      label: 'reset hue',
      icon: '⟲',
      onClick: () => setHue(0),
    });
    resetBtn.classList.add('pyr3-edit-palette-reset-hue');
    const resetRow = document.createElement('div');
    resetRow.className = 'pyr3-edit-palette-reset-row';
    resetRow.style.display = 'flex';
    resetRow.style.justifyContent = 'flex-end';
    resetRow.style.margin = '4px 0 8px';
    resetRow.appendChild(resetBtn);
    host.appendChild(resetRow);

    // ── ✨ Generated-ramp config (#267/#358) ───────────────────────────────
    // The generator is chosen FROM the palette picker (a "thing that replaces
    // your palette"), so its config is shown here ONLY while the active palette
    // is a generated ramp (palette.gen present). Undo/redo restore palette.gen,
    // and the panel rebuilds on undo → refreshGenConfig() re-derives visibility.
    const genConfigHost = document.createElement('div');
    genConfigHost.className = 'pyr3-edit-palette-gen';
    host.appendChild(genConfigHost);
    function refreshGenConfig(): void {
      genConfigHost.replaceChildren();
      if (!state.genome.palette.gen) return;
      const header = document.createElement('div');
      header.className = 'pyr3-edit-palette-gen-header';
      const genHelp = infoIcon('palette.generate');
      header.append(document.createTextNode('✨ Ramp settings'), genHelp);
      genConfigHost.appendChild(header);
      mountPaletteGenerator(genConfigHost, state, onChange, () => {
        refreshRibbon();
        refreshChip();
        refreshLauncher();
      });
    }

    // ── Mode row (preserved from pre-Phase-9) ──────────────────────────────
    // Writes genome.paletteMode (top-level, flam3 spec) — controls per-scatter
    // sampling: 'step' uses palette[floor(idx)] verbatim (flam3 default);
    // 'linear' lerps between adjacent LUT entries.
    const modeRow = document.createElement('div');
    modeRow.className = 'pyr3-edit-palette-mode-row';
    modeRow.style.display = 'flex';
    modeRow.style.alignItems = 'center';
    modeRow.style.gap = '8px';
    modeRow.style.marginTop = '6px';
    modeRow.title = 'How colors blend across the flame.\n'
      + 'Linear — colors blend smoothly into each other.\n'
      + 'Step — colors stay distinct (a touch more banded).';

    const modeLabelTxt = document.createElement('span');
    modeLabelTxt.textContent = 'mode';
    modeLabelTxt.style.width = '96px';
    modeLabelTxt.style.color = COLORS.text.muted;
    modeLabelTxt.style.fontSize = '12px';

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
      wrap.style.fontSize = '12px';
      wrap.style.color = COLORS.text.primary;
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

    // ── Header chip (hue +N°) ──────────────────────────────────────────────
    function findHeader(): HTMLElement | null {
      const wrap = host.parentElement;
      if (!wrap) return null;
      return wrap.querySelector('.pyr3-edit-section-header') as HTMLElement | null;
    }

    const chip = document.createElement('span');
    chip.className = 'pyr3-edit-palette-chip';
    chip.style.marginLeft = 'auto';
    chip.style.fontSize = '10px';
    chip.style.fontFamily = 'ui-monospace, monospace';
    chip.style.color = COLORS.flame.top;
    chip.style.padding = '1px 6px';
    chip.style.borderRadius = '3px';
    chip.style.border = `1px solid ${COLORS.flame.bot}`;
    chip.style.background = COLORS.bg.action;
    chip.style.userSelect = 'none';
    chip.addEventListener('click', (ev) => ev.stopPropagation());

    function refreshChip(): void {
      const hue = state.genome.palette.hue ?? 0;
      const header = findHeader();
      if (!header) return;
      // Detach prior chip first so re-mounts don't duplicate.
      header.querySelectorAll('.pyr3-edit-palette-chip').forEach((n) => {
        if (n !== chip) n.remove();
      });
      if (hue === 0) {
        if (chip.parentElement) chip.remove();
        return;
      }
      const sign = hue >= 0 ? '+' : '−';
      chip.textContent = `hue ${sign}${Math.abs(Math.round(hue))}°`;
      if (!chip.parentElement) header.appendChild(chip);
    }

    Promise.resolve().then(() => refreshChip());

    // ── State mutators ─────────────────────────────────────────────────────
    function currentSource(): PaletteSource {
      // The source of truth is the GENOME (restored by undo/redo); state.paletteSource
      // is editor-only and goes stale after undo. So: a generated ramp is identified
      // by palette.gen; otherwise we trust paletteSource ONLY while it still matches
      // the current palette, else derive it from the palette name (#358).
      const pal = state.genome.palette;
      if (pal.gen) return { kind: 'generate', meta: pal.gen };
      const ps = state.paletteSource;
      if (ps?.kind === 'mine' && ps.name === pal.name) return ps;
      if (ps?.kind === 'flam3'
        && (FLAM3_PALETTE_NAMES[ps.number] === pal.name || `flame #${ps.number}` === pal.name)) {
        return ps;
      }
      return inferPaletteSource(pal);
    }

    function refreshLauncher(): void {
      const ident = paletteIdentifier(currentSource());
      launcherPrefix.textContent = ident.prefix ? `${ident.prefix} ` : '';
      launcherName.textContent = ident.name;
      launcherName.style.fontFamily = ident.monospace
        ? 'ui-monospace, monospace'
        : 'inherit';
    }

    function refreshRibbon(): void {
      ribbon.style.background = gradientCss(state.genome.palette);
      const hue = state.genome.palette.hue ?? 0;
      ribbon.style.filter = `hue-rotate(${Math.round(hue)}deg)`;
    }

    function setHue(deg: number): void {
      const clamped = Math.max(0, Math.min(360, Math.round(deg)));
      state.genome.palette.hue = clamped;
      refreshRibbon();
      refreshChip();
      onChange('palette.hue');
    }

    function setMode(mode: PaletteMode): void {
      if (mode === 'step') {
        delete state.genome.paletteMode;
      } else {
        state.genome.paletteMode = mode;
      }
      onChange('paletteMode');
    }

    // ── Default openPalettePicker (host can override) ──────────────────────
    // The editor host (edit-mount.ts) is welcome to supply its own opener
    // that docks the picker into a specific layout slot; if it doesn't, we
    // install a body-mounted default so the launcher button works out of
    // the box. CSS `position: fixed; left: 340px` handles the dock visual.
    if (!state.openPalettePicker) {
      let pickerHandle: PalettePickerHandle | null = null;
      const dismissOnKey = (ev: KeyboardEvent): void => {
        if (ev.key !== 'Escape') return;
        if (pickerHandle) {
          pickerHandle.destroy();
          pickerHandle = null;
          document.removeEventListener('keydown', dismissOnKey);
        }
      };
      state.openPalettePicker = (): void => {
        if (pickerHandle) {
          pickerHandle.destroy();
          pickerHandle = null;
          document.removeEventListener('keydown', dismissOnKey);
          return;
        }
        pickerHandle = mountPalettePicker(document.body, {
          current: currentSource(),
          onApply: (source) => {
            // Apply a picked palette to the genome. flam3 resolves to catalog
            // stops; #365 — "mine" resolves to the user's saved palette stops.
            // (corpus/custom remain unwired — no reachable UI today.)
            const applyStops = (name: string, stops: Palette['stops']): void => {
              const existing = state.genome.palette;
              // No `gen` → switching away from a generated ramp; refreshGenConfig
              // below hides the generator config.
              state.genome.palette = {
                name,
                stops,
                ...(existing.mode !== undefined ? { mode: existing.mode } : {}),
              };
              state.paletteSource = source;
              refreshLauncher();
              refreshRibbon();
              refreshGenConfig();
              onChange('palette');
            };
            if (source.kind === 'flam3') {
              const fresh = paletteAtIndex(source.number);
              applyStops(fresh.name, fresh.stops);
            } else if (source.kind === 'mine') {
              const saved = getMine(source.name);
              if (saved) applyStops(saved.name, saved.stops);
            } else if (source.kind === 'generate') {
              // #358 — pick "Generate ramp". `meta` set → revert-on-cancel
              // restores that exact ramp; absent → a fresh default ramp. Stamps
              // palette.gen so the config appears + undo restores it.
              const meta = source.meta ?? defaultRampMeta();
              state.genome.palette = { ...paletteFromStops('generated', generateRamp(meta)), gen: meta };
              state.paletteSource = { kind: 'generate', meta };
              refreshLauncher();
              refreshRibbon();
              refreshChip();
              refreshGenConfig();
              onChange('palette');
            }
          },
          onClose: () => {
            if (pickerHandle) {
              pickerHandle.destroy();
              pickerHandle = null;
              document.removeEventListener('keydown', dismissOnKey);
            }
          },
        });
        document.addEventListener('keydown', dismissOnKey);
      };
    }

    // ── Wire events ────────────────────────────────────────────────────────
    function openPicker(): void {
      state.openPalettePicker?.();
    }

    launcher.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openPicker();
    });

    ribbon.addEventListener('click', (ev) => {
      // Ribbon click is independent of the hue slider — no fall-through.
      ev.stopPropagation();
      openPicker();
    });
    ribbon.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        openPicker();
      }
    });

    linearRadio.input.addEventListener('change', () => {
      if (linearRadio.input.checked) setMode('linear');
    });
    stepRadio.input.addEventListener('change', () => {
      if (stepRadio.input.checked) setMode('step');
    });

    // ── Initial render ─────────────────────────────────────────────────────
    refreshLauncher();
    refreshRibbon();
    // #358 — show the generator config iff the loaded/undone palette is a ramp.
    refreshGenConfig();
    const initialMode = state.genome.paletteMode ?? 'step';
    linearRadio.input.checked = initialMode === 'linear';
    stepRadio.input.checked = initialMode === 'step';

    // ── Background (#27) — second mount point of the shared background control;
    // the Output → Tonemap section is the other. Edits in either stay in sync
    // via state.backgroundListeners. Palette + background = "the colors."
    const bg = buildBackgroundControl(state, onChange);
    host.appendChild(buildRow('background', bg.el));

    return bg.dispose;
  },
};

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
.pyr3-edit-palette-ribbon:hover {
  outline: 1px solid var(--accent, #ff8c1a);
  outline-offset: 1px;
}
.pyr3-edit-palette-ribbon:focus-visible {
  outline: 2px solid var(--accent, #ff8c1a);
}
.pyr3-edit-palette-launcher:hover {
  border-color: var(--accent-border, #884a1a);
}
/* ✨ Generated-ramp config (#358) — shown only while the active palette is a
   generated ramp (chosen from the palette picker). The header marks it as the
   ramp's own config; the generator controls follow. */
.pyr3-edit-palette-gen {
  margin: 8px 0 4px;
}
.pyr3-edit-palette-gen-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 2px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent, #ff8c1a);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
`;
