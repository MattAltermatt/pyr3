// pyr3 — /editor density-estimation section.
//
// Surfaces the engine's adaptive-Gaussian DE blur kernel: maxRad / minRad /
// curve sliders. Same lane routing as before (fast lane — present()-only
// re-render). The tonemap preset strip that used to live here was relocated
// to the 🌐 Tonemap section in #397 (it wrote tonemap fields, not the DE
// kernel — see src/edit-section-global.ts).
//
// onChange paths (all fast lane per pathLane in src/edit-state.ts):
//   - density.maxRad / density.minRad / density.curve
//
// Tooltip popovers — every labeled field carries a `?` info icon (via
// `infoIcon`) that toggles a right-anchored explainer. Click again or
// outside to dismiss.

import { type SectionMount } from './edit-ui';
import { type Density, DEFAULT_DENSITY } from './density';
import { COLORS } from './ui-tokens';
import { buildSlider, buildToggle, type SliderControl } from './edit-primitives';
import { infoIcon } from './help-text';

export const densitySection: SectionMount = {
  key: 'density',
  lens: 'output',
  title: '💫 DENSITY ESTIMATION',
  build(host, state, onChange) {
    host.classList.add('pyr3-edit-section-density');

    function ensureDensity(): Density {
      if (!state.genome.density) {
        state.genome.density = { ...DEFAULT_DENSITY };
      }
      return state.genome.density;
    }

    // #370 — READ-ONLY view of the density used by the engine: the genome's own
    // field if present, else the engine default. syncWidgets() uses this so that
    // merely mounting the section (Output lens) no longer silently writes
    // DEFAULT_DENSITY into the genome (a non-undoable mutation that flipped DE on
    // for density-less flames). The genome is materialized only on a real edit,
    // via ensureDensity() inside setField().
    function effectiveDensity(): Density {
      return state.genome.density ?? DEFAULT_DENSITY;
    }

    // ── Three slider+number rows (maxRad / minRad / curve) ──────────────────
    // Each row is a single shared buildSlider control (rail + orange fill +
    // thumb + internal scrubby number — the same primitive every other editor
    // section uses). A visually-hidden <input type="range"> mirror rides
    // alongside, wired to the same setter, so the legacy `input[type="range"]`
    // test contract keeps working and external drivers (undo) can sync the
    // displayed value. Mirrors the hidden-range pattern in
    // edit-section-global.ts (vibrancy).
    // Collected so the DE on/off toggle can dim/disable the kernel sliders
    // when DE is off (#397).
    const sliderRows: HTMLElement[] = [];

    function makeRow(
      labelText: string,
      cls: string,
      field: keyof Density,
      min: number,
      max: number,
      step: number,
      helpKey: string,
    ): SliderControl {
      const row = document.createElement('div');
      row.className = `pyr3-edit-density-row ${cls}-row`;
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';
      row.style.marginTop = '6px';

      const lab = document.createElement('span');
      lab.textContent = labelText;
      lab.style.width = '96px';
      lab.style.color = COLORS.text.muted;
      lab.style.fontSize = '12px';

      // Legacy range input mirror — same min/max/step, visually hidden,
      // drives the same setter. Forward-declared so the slider onChange can
      // keep it in sync; tab-blocked so the visible slider owns interaction.
      const rangeMirror = document.createElement('input');
      rangeMirror.type = 'range';
      rangeMirror.min = String(min);
      rangeMirror.max = String(max);
      rangeMirror.step = String(step);
      rangeMirror.className = `${cls}-slider`;
      rangeMirror.tabIndex = -1;
      rangeMirror.style.position = 'absolute';
      rangeMirror.style.width = '1px';
      rangeMirror.style.height = '1px';
      rangeMirror.style.opacity = '0';
      rangeMirror.style.pointerEvents = 'none';

      const control = buildSlider({
        value: 0,
        min,
        max,
        step,
        onChange: (v) => {
          rangeMirror.value = String(v);
          setField(field, v);
        },
      });

      rangeMirror.addEventListener('input', () => {
        const v = Number(rangeMirror.value);
        if (!Number.isFinite(v)) return;
        control.setValue(v);
        setField(field, v);
      });

      row.append(lab, control, rangeMirror, infoIcon(helpKey));
      host.appendChild(row);
      sliderRows.push(row);
      return control;
    }

    const maxRadControl = makeRow('maxRad', 'pyr3-edit-density-maxRad', 'maxRad', 0, 30, 0.5, 'density.maxRad');
    const minRadControl = makeRow('minRad', 'pyr3-edit-density-minRad', 'minRad', 0, 30, 0.1, 'density.minRad');
    const curveControl = makeRow('curve', 'pyr3-edit-density-curve', 'curve', 0.1, 2.0, 0.05, 'density.curve');

    // ── DE on/off toggle (#397) ─────────────────────────────────────────────
    // DE off = maxRad 0 (radius collapses to 0 → no adaptive blur), a real
    // serializable genome state. On = restore the remembered prior maxRad (or
    // the engine default 9 when nothing is remembered, e.g. a flame loaded at
    // 0). Reads effectiveDensity() so a density-less flame mounts read-only
    // (#370 invariant — the genome materializes only when the toggle flips).
    function setSlidersDimmed(dimmed: boolean): void {
      for (const r of sliderRows) {
        r.style.opacity = dimmed ? '0.4' : '1';
        r.style.pointerEvents = dimmed ? 'none' : 'auto';
      }
    }

    const deToggle = buildToggle({
      value: effectiveDensity().maxRad > 0,
      onChange: (on) => {
        if (on) {
          const restore = state.deRestoreMaxRad ?? DEFAULT_DENSITY.maxRad;
          setField('maxRad', restore);
          maxRadControl.setValue(restore);
        } else {
          state.deRestoreMaxRad = effectiveDensity().maxRad || DEFAULT_DENSITY.maxRad;
          setField('maxRad', 0);
          maxRadControl.setValue(0);
        }
        setSlidersDimmed(!on);
      },
    });
    // NB: buildToggle's paint() rewrites el.className on every repaint, so a
    // marker class on the toggle itself would be wiped. The stable hook is the
    // row class below (`.pyr3-edit-de-toggle-row`); `.pyr3-toggle` + `.on`
    // (paint-managed) carry the visual state.
    deToggle.title = 'Density estimation on/off. Off = no adaptive blur (maxRad 0).';

    const deRow = document.createElement('div');
    deRow.className = 'pyr3-edit-de-toggle-row';
    deRow.style.display = 'flex';
    deRow.style.alignItems = 'center';
    deRow.style.gap = '8px';
    deRow.style.marginBottom = '6px';
    const deLabel = document.createElement('span');
    deLabel.textContent = 'Density estimation';
    deLabel.style.fontSize = '12px';
    deLabel.style.color = COLORS.text.muted;
    deRow.append(deToggle, deLabel, infoIcon('density.deToggle'));
    // Mount at the top of the section body, above the kernel sliders.
    host.insertBefore(deRow, host.firstChild);

    // ── Engine DE state mutators ───────────────────────────────────────────

    function syncWidgets(): void {
      const d = effectiveDensity();
      maxRadControl.setValue(d.maxRad);
      minRadControl.setValue(d.minRad);
      curveControl.setValue(d.curve);
      deToggle.setValue(d.maxRad > 0);
      setSlidersDimmed(d.maxRad <= 0);
    }

    function setField(field: keyof Density, value: number): void {
      if (!Number.isFinite(value)) return;
      const d = ensureDensity();
      d[field] = value;
      onChange(`density.${field}`);
    }

    syncWidgets();
  },
};
