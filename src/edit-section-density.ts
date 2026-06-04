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
import { scrubbyInput, type ScrubbyHandle } from './edit-scrubby-input';

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

    // Tooltips — plain-English what / effect on the picture, matching the
    // render section's hover-hint pattern.
    const TIPS = {
      preset:
        'Quick-start density-estimation defaults.\n'
        + 'Crisp = small blur, sharp detail. Smooth = bigger blur, glowier output.\n'
        + 'Flips to "custom" the moment any slider/value below is hand-tuned.',
      maxRad:
        'Maximum blur radius around each scatter point.\n'
        + 'Higher = softer, glowier image. Lower = sharper, more granular.\n'
        + 'At 0, density estimation is off (raw point cloud).',
      minRad:
        'Minimum blur radius — the floor for dense areas.\n'
        + 'Dense regions use this; sparse regions blur up to maxRad.\n'
        + 'Keep at or below maxRad.',
      curve:
        'How density maps to blur radius.\n'
        + '< 1 = aggressive (sparse areas reach maxRad quickly).\n'
        + '> 1 = gentle (only the sparsest areas get close to maxRad).',
    };

    // ── Preset dropdown ─────────────────────────────────────────────────────
    const presetRow = document.createElement('div');
    presetRow.className = 'pyr3-edit-density-preset-row';
    presetRow.style.display = 'flex';
    presetRow.style.alignItems = 'center';
    presetRow.style.gap = '6px';
    presetRow.title = TIPS.preset;

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
      number: HTMLElement;
      handle: ScrubbyHandle;
    }

    function makeRow(
      labelText: string,
      cls: string,
      min: number,
      max: number,
      step: number,
      onScrub: (v: number) => void,
      tip?: string,
    ): SliderPair {
      const row = document.createElement('div');
      row.className = `pyr3-edit-density-row ${cls}-row`;
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';
      row.style.marginTop = '6px';
      if (tip !== undefined) row.title = tip;

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

      const handle = scrubbyInput({
        value: 0,
        kind: 'generic',
        min,
        max,
        minStep: step,
        onInput: onScrub,
      });
      const number = handle.el;
      number.classList.add(`${cls}-number`);
      number.style.width = '60px';

      row.append(lab, slider, number);
      host.appendChild(row);
      return { slider, number, handle };
    }

    // Forward-declare so the makeRow onScrub callbacks can reference setField
    // (function declarations below are hoisted within this build() scope).
    const maxRadPair = makeRow('maxRad', 'pyr3-edit-density-maxRad', 0, 30, 0.5, (v) => {
      maxRadPair.slider.value = String(v);
      setField('maxRad', v);
    }, TIPS.maxRad);
    const minRadPair = makeRow('minRad', 'pyr3-edit-density-minRad', 0, 30, 0.1, (v) => {
      minRadPair.slider.value = String(v);
      setField('minRad', v);
    }, TIPS.minRad);
    const curvePair = makeRow('curve', 'pyr3-edit-density-curve', 0.1, 2.0, 0.05, (v) => {
      curvePair.slider.value = String(v);
      setField('curve', v);
    }, TIPS.curve);

    // ── State mutators ──────────────────────────────────────────────────────

    function syncWidgets(): void {
      const d = ensureDensity();
      maxRadPair.slider.value = String(d.maxRad);
      maxRadPair.handle.setValue(d.maxRad);
      minRadPair.slider.value = String(d.minRad);
      minRadPair.handle.setValue(d.minRad);
      curvePair.slider.value = String(d.curve);
      curvePair.handle.setValue(d.curve);
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

    function bindSlider(pair: SliderPair, field: keyof Density): void {
      pair.slider.addEventListener('input', () => {
        const n = Number(pair.slider.value);
        if (!Number.isFinite(n)) return;
        pair.handle.setValue(n);
        setField(field, n);
      });
      // scrubby → state is wired via the onScrub callback passed to makeRow.
    }

    bindSlider(maxRadPair, 'maxRad');
    bindSlider(minRadPair, 'minRad');
    bindSlider(curvePair, 'curve');

    presetSelect.addEventListener('change', () => {
      const v = presetSelect.value;
      if (v === CUSTOM_PRESET_VALUE) return; // user can't manually pick "custom"
      applyPreset(v);
    });

    // ── Initial render ──────────────────────────────────────────────────────
    syncWidgets();
  },
};
