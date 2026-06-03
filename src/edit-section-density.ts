// pyr3 — /v1/edit density-emitter section.
//
// Surfaces the genome's adaptive-Gaussian density-estimation params (maxRad,
// minRad, curve) plus a preset dropdown sourced from DENSITY_PRESETS in
// src/density.ts. Selecting a preset writes all three values; editing any
// single slider/number flips the dropdown to "custom". Lazy-inits
// `genome.density` from DEFAULT_DENSITY on first edit (genomes loaded with
// no <flame> density attribute leave the field undefined).
//
// onChange paths (all fast lane per pathLane in src/edit-state.ts):
//   - density.maxRad / density.minRad / density.curve
//   - density.preset → coalesces to onChange('density.maxRad') (the
//     fast-lane scheduler dedupes the per-field paths fired in the same tick)

import { type SectionMount } from './edit-ui';
import { type Density, DEFAULT_DENSITY, DENSITY_PRESETS } from './density';

const CUSTOM_PRESET_VALUE = 'custom';

// Match a Density triple against the named preset list. Returns the preset
// name or null when the values don't match any preset (→ "custom").
function matchPresetName(d: Density): string | null {
  for (const p of DENSITY_PRESETS) {
    if (p.density.maxRad === d.maxRad && p.density.minRad === d.minRad && p.density.curve === d.curve) {
      return p.name;
    }
  }
  return null;
}

export const densitySection: SectionMount = {
  key: 'density',
  title: '💫 DENSITY EMITTER',
  build(host, state, onChange) {
    host.classList.add('pyr3-edit-section-density');

    // Lazy-init genome.density on first read so the controls always have a
    // backing object to mutate. We do NOT fire onChange here — read-only
    // population, no actual edit.
    function ensureDensity(): Density {
      if (!state.genome.density) {
        state.genome.density = { ...DEFAULT_DENSITY };
      }
      return state.genome.density;
    }

    // ── Preset dropdown ─────────────────────────────────────────────────────
    const presetRow = document.createElement('div');
    presetRow.className = 'pyr3-edit-density-preset-row';
    presetRow.style.display = 'flex';
    presetRow.style.alignItems = 'center';
    presetRow.style.gap = '6px';

    const presetLabel = document.createElement('span');
    presetLabel.textContent = 'preset';
    presetLabel.style.width = '54px';

    const presetSelect = document.createElement('select');
    presetSelect.className = 'pyr3-edit-density-preset';
    presetSelect.style.flex = '1 1 auto';
    for (const p of DENSITY_PRESETS) {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      presetSelect.appendChild(opt);
    }
    const customOpt = document.createElement('option');
    customOpt.value = CUSTOM_PRESET_VALUE;
    customOpt.textContent = CUSTOM_PRESET_VALUE;
    presetSelect.appendChild(customOpt);

    presetRow.append(presetLabel, presetSelect);
    host.appendChild(presetRow);

    // ── Three slider+number rows ────────────────────────────────────────────
    interface SliderPair {
      slider: HTMLInputElement;
      number: HTMLInputElement;
    }

    function makeRow(
      labelText: string,
      cls: string,
      min: number,
      max: number,
      step: number,
    ): SliderPair {
      const row = document.createElement('div');
      row.className = `pyr3-edit-density-row ${cls}-row`;
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';
      row.style.marginTop = '6px';

      const lab = document.createElement('span');
      lab.textContent = labelText;
      lab.style.width = '54px';

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(min);
      slider.max = String(max);
      slider.step = String(step);
      slider.className = `${cls}-slider`;
      slider.style.flex = '1 1 auto';

      const number = document.createElement('input');
      number.type = 'number';
      number.min = String(min);
      number.max = String(max);
      number.step = String(step);
      number.className = `${cls}-number`;
      number.style.width = '60px';

      row.append(lab, slider, number);
      host.appendChild(row);
      return { slider, number };
    }

    const maxRadPair = makeRow('maxRad', 'pyr3-edit-density-maxRad', 0, 30, 0.5);
    const minRadPair = makeRow('minRad', 'pyr3-edit-density-minRad', 0, 30, 0.1);
    const curvePair = makeRow('curve', 'pyr3-edit-density-curve', 0.1, 2.0, 0.05);

    // ── State mutators ──────────────────────────────────────────────────────

    function syncWidgets(): void {
      const d = ensureDensity();
      maxRadPair.slider.value = String(d.maxRad);
      maxRadPair.number.value = String(d.maxRad);
      minRadPair.slider.value = String(d.minRad);
      minRadPair.number.value = String(d.minRad);
      curvePair.slider.value = String(d.curve);
      curvePair.number.value = String(d.curve);
      const name = matchPresetName(d);
      presetSelect.value = name ?? CUSTOM_PRESET_VALUE;
    }

    function applyPreset(name: string): void {
      const preset = DENSITY_PRESETS.find((p) => p.name === name);
      if (!preset) return;
      state.genome.density = { ...preset.density };
      syncWidgets();
      // Any single fast-lane path triggers the scheduler; per task spec the
      // coalescing dedupes adjacent paths in the same tick.
      onChange('density.maxRad');
    }

    function setField(field: keyof Density, value: number): void {
      if (!Number.isFinite(value)) return;
      const d = ensureDensity();
      d[field] = value;
      // Flip dropdown to "custom" when the new triple doesn't match any preset.
      const name = matchPresetName(d);
      presetSelect.value = name ?? CUSTOM_PRESET_VALUE;
      onChange(`density.${field}`);
    }

    function bindPair(pair: SliderPair, field: keyof Density): void {
      pair.slider.addEventListener('input', () => {
        const n = Number(pair.slider.value);
        if (!Number.isFinite(n)) return;
        pair.number.value = String(n);
        setField(field, n);
      });
      pair.number.addEventListener('input', () => {
        const n = Number(pair.number.value);
        if (!Number.isFinite(n)) return;
        // Keep slider in sync (clamped by browser to its min/max via DOM).
        pair.slider.value = String(n);
        setField(field, n);
      });
    }

    bindPair(maxRadPair, 'maxRad');
    bindPair(minRadPair, 'minRad');
    bindPair(curvePair, 'curve');

    presetSelect.addEventListener('change', () => {
      const v = presetSelect.value;
      if (v === CUSTOM_PRESET_VALUE) return; // user can't manually pick "custom"
      applyPreset(v);
    });

    // ── Initial render ──────────────────────────────────────────────────────
    syncWidgets();
  },
};
