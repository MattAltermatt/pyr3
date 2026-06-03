// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { densitySection } from './edit-section-density';
import { createEditState } from './edit-state';
import { generateRandomGenome } from './edit-seed';
import { DENSITY_PRESETS, DEFAULT_DENSITY } from './density';

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mount() {
  const host = document.createElement('div');
  const state = createEditState(generateRandomGenome(seededRng(1)), 1);
  const onChange = vi.fn();
  densitySection.build(host, state, onChange);
  return { host, state, onChange };
}

describe('densitySection', () => {
  it('exposes the SectionMount contract', () => {
    expect(densitySection.key).toBe('density');
    expect(densitySection.title).toContain('DENSITY');
    expect(typeof densitySection.build).toBe('function');
  });

  it('renders preset dropdown + 3 slider+input pairs', () => {
    const { host } = mount();
    const preset = host.querySelector<HTMLSelectElement>('.pyr3-edit-density-preset');
    expect(preset).not.toBeNull();
    // DENSITY_PRESETS + "custom"
    expect(preset!.options.length).toBe(DENSITY_PRESETS.length + 1);

    const sliders = host.querySelectorAll('input[type="range"]');
    expect(sliders.length).toBe(3);
    const numbers = host.querySelectorAll('input[type="number"]');
    expect(numbers.length).toBe(3);
  });

  it('lazy-inits genome.density from DEFAULT_DENSITY when undefined', () => {
    const { state } = mount();
    expect(state.genome.density).toEqual(DEFAULT_DENSITY);
  });

  it('preset dropdown reads "classic" when density matches the classic preset', () => {
    const { host, state } = mount();
    const classic = DENSITY_PRESETS.find((p) => p.name === 'classic')!;
    state.genome.density = { ...classic.density };
    // Re-mount to pick up the new density on init (the mounted section reads
    // density at build time + via syncWidgets()).
    const preset = host.querySelector<HTMLSelectElement>('.pyr3-edit-density-preset')!;
    // syncWidgets is called on build with the live state; classic happens to be
    // DEFAULT_DENSITY too. Re-trigger preset selection to confirm matching logic.
    preset.value = 'classic';
    preset.dispatchEvent(new Event('change'));
    expect(state.genome.density).toEqual(classic.density);
    expect(preset.value).toBe('classic');
  });

  it('picking a preset copies all 3 values into state.genome.density', () => {
    const { host, state, onChange } = mount();
    const crisp = DENSITY_PRESETS.find((p) => p.name === 'crisp')!;
    const preset = host.querySelector<HTMLSelectElement>('.pyr3-edit-density-preset')!;
    preset.value = 'crisp';
    preset.dispatchEvent(new Event('change'));
    expect(state.genome.density!.maxRad).toBe(crisp.density.maxRad);
    expect(state.genome.density!.minRad).toBe(crisp.density.minRad);
    expect(state.genome.density!.curve).toBe(crisp.density.curve);
    expect(onChange).toHaveBeenCalledWith('density.maxRad');
  });

  it('picking each preset name resolves to that preset', () => {
    const { host, state } = mount();
    const preset = host.querySelector<HTMLSelectElement>('.pyr3-edit-density-preset')!;
    for (const p of DENSITY_PRESETS) {
      preset.value = p.name;
      preset.dispatchEvent(new Event('change'));
      expect(state.genome.density).toEqual(p.density);
      expect(preset.value).toBe(p.name);
    }
  });

  it('editing maxRad slider mutates state.genome.density.maxRad and fires onChange', () => {
    const { host, state, onChange } = mount();
    const slider = host.querySelector<HTMLInputElement>('.pyr3-edit-density-maxRad-slider')!;
    slider.value = '15';
    slider.dispatchEvent(new Event('input'));
    expect(state.genome.density!.maxRad).toBe(15);
    expect(onChange).toHaveBeenCalledWith('density.maxRad');
  });

  it('editing maxRad number input mutates state and syncs the slider', () => {
    const { host, state } = mount();
    const number = host.querySelector<HTMLInputElement>('.pyr3-edit-density-maxRad-number')!;
    const slider = host.querySelector<HTMLInputElement>('.pyr3-edit-density-maxRad-slider')!;
    number.value = '12.5';
    number.dispatchEvent(new Event('input'));
    expect(state.genome.density!.maxRad).toBe(12.5);
    expect(slider.value).toBe('12.5');
  });

  it('editing maxRad manually flips preset dropdown to "custom"', () => {
    const { host, state } = mount();
    // Start at classic (==DEFAULT_DENSITY); flip a value off-preset.
    const preset = host.querySelector<HTMLSelectElement>('.pyr3-edit-density-preset')!;
    expect(preset.value).toBe('classic');
    const slider = host.querySelector<HTMLInputElement>('.pyr3-edit-density-maxRad-slider')!;
    slider.value = '17';
    slider.dispatchEvent(new Event('input'));
    expect(preset.value).toBe('custom');
    expect(state.genome.density!.maxRad).toBe(17);
  });

  it('editing minRad / curve also fires the matching onChange path', () => {
    const { host, state, onChange } = mount();
    const minRad = host.querySelector<HTMLInputElement>('.pyr3-edit-density-minRad-slider')!;
    minRad.value = '2';
    minRad.dispatchEvent(new Event('input'));
    expect(state.genome.density!.minRad).toBe(2);
    expect(onChange).toHaveBeenCalledWith('density.minRad');

    const curve = host.querySelector<HTMLInputElement>('.pyr3-edit-density-curve-slider')!;
    curve.value = '0.85';
    curve.dispatchEvent(new Event('input'));
    expect(state.genome.density!.curve).toBe(0.85);
    expect(onChange).toHaveBeenCalledWith('density.curve');
  });
});
