// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { densitySection, TONEMAP_CHANGED_EVENT } from './edit-section-density';
import { createEditState } from './edit-state';
import { generateRandomGenome } from './edit-seed';
import { DENSITY_PRESETS, DEFAULT_DENSITY } from './density';
import { DENSITY_PRESETS as TONEMAP_PRESETS } from './edit-preset-density';
import { DEFAULT_TONEMAP } from './tonemap';

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
  // Wrap mimics mountEditUi's section shape: a `pyr3-edit-section` wrap
  // with a sibling `pyr3-edit-section-header` so the section's header-chip
  // injection target exists.
  const wrap = document.createElement('div');
  wrap.className = 'pyr3-edit-section';
  const header = document.createElement('div');
  header.className = 'pyr3-edit-section-header';
  wrap.appendChild(header);
  const host = document.createElement('div');
  wrap.appendChild(host);
  document.body.appendChild(wrap);

  const state = createEditState(generateRandomGenome(seededRng(1)), 1);
  const onChange = vi.fn();
  densitySection.build(host, state, onChange);
  return { host, state, onChange, header };
}

// Drive a scrubby cell by double-clicking into text mode, typing, pressing Enter.
function typeInto(cell: HTMLElement, value: string): void {
  cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const inp = cell.querySelector('input') as HTMLInputElement;
  inp.value = value;
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
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
    const numbers = host.querySelectorAll('.pyr3-scrubby');
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
    const number = host.querySelector<HTMLElement>('.pyr3-edit-density-maxRad-number')!;
    const slider = host.querySelector<HTMLInputElement>('.pyr3-edit-density-maxRad-slider')!;
    typeInto(number, '12.5');
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

  // ── Phase 7 task 7.10: tonemap preset strip + tooltips + chip ──────────

  it('renders the tonemap preset strip with 6 buttons at top of section body', () => {
    const { host } = mount();
    const strip = host.querySelector('.pyr3-edit-density-preset-strip');
    expect(strip).not.toBeNull();
    const buttons = strip!.querySelectorAll('.pyr3-edit-density-tonemap-preset');
    expect(buttons.length).toBe(6);
    // Strip sits at the top of the section body — first child.
    expect(host.firstElementChild).toBe(strip);
    // Buttons cover the six locked preset names.
    const names = Array.from(buttons).map((b) => b.textContent ?? '');
    for (const n of ['default', 'soft', 'vivid', 'punchy', 'cinematic', 'crystal']) {
      expect(names.some((label) => label.includes(n))).toBe(true);
    }
  });

  it('clicking a tonemap preset writes gamma/gammaThreshold/vibrancy/brightness at once', () => {
    const { host, state, onChange } = mount();
    const vivid = TONEMAP_PRESETS.find((p) => p.name === 'vivid')!;
    const btn = host.querySelector('.pyr3-edit-density-tonemap-preset-vivid') as HTMLElement;
    btn.click();
    expect(state.genome.tonemap?.gamma).toBe(vivid.gamma);
    expect(state.genome.tonemap?.gammaThreshold).toBe(vivid.gammaThreshold);
    expect(state.genome.tonemap?.vibrancy).toBe(vivid.vibrancy);
    expect(state.genome.tonemap?.brightness).toBe(vivid.brightness);
    // All four tonemap paths fire so the lane scheduler triggers a redraw.
    expect(onChange).toHaveBeenCalledWith('tonemap.gamma');
    expect(onChange).toHaveBeenCalledWith('tonemap.gammaThreshold');
    expect(onChange).toHaveBeenCalledWith('tonemap.vibrancy');
    expect(onChange).toHaveBeenCalledWith('tonemap.brightness');
  });

  it('section header carries a preset chip after clicking a preset', async () => {
    const { header, state } = mount();
    // Apply 'vivid' tonemap values directly + fire the event to refresh.
    const vivid = TONEMAP_PRESETS.find((p) => p.name === 'vivid')!;
    state.genome.tonemap = {
      gamma: vivid.gamma,
      gammaThreshold: vivid.gammaThreshold,
      vibrancy: vivid.vibrancy,
      brightness: vivid.brightness,
      highlightPower: DEFAULT_TONEMAP.highlightPower,
    };
    // Wait the microtask used for chip mount.
    await Promise.resolve();
    document.dispatchEvent(new CustomEvent(TONEMAP_CHANGED_EVENT));
    const chip = header.querySelector('.pyr3-edit-density-chip') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toBe('vivid');
  });

  it('chip appends * when user manually nudges any tonemap value off-preset', async () => {
    const { header, state } = mount();
    const vivid = TONEMAP_PRESETS.find((p) => p.name === 'vivid')!;
    state.genome.tonemap = {
      gamma: vivid.gamma,
      gammaThreshold: vivid.gammaThreshold,
      vibrancy: vivid.vibrancy,
      brightness: vivid.brightness,
      highlightPower: DEFAULT_TONEMAP.highlightPower,
    };
    await Promise.resolve();
    document.dispatchEvent(new CustomEvent(TONEMAP_CHANGED_EVENT));
    // Nudge brightness off-preset.
    state.genome.tonemap.brightness = vivid.brightness + 0.5;
    document.dispatchEvent(new CustomEvent(TONEMAP_CHANGED_EVENT));
    const chip = header.querySelector('.pyr3-edit-density-chip') as HTMLElement;
    expect(chip.textContent).toBe('vivid*');
  });

  it('renders ? info icons next to every labeled field (preset + maxRad + minRad + curve)', () => {
    const { host } = mount();
    const icons = host.querySelectorAll('.pyr3-info-icon');
    // 4 labeled fields → 4 info icons (preset / maxRad / minRad / curve).
    expect(icons.length).toBeGreaterThanOrEqual(4);
  });

  it('clicking an info icon toggles a tooltip popover at document level', () => {
    const { host } = mount();
    const icon = host.querySelector('.pyr3-info-icon') as HTMLElement;
    icon.click();
    expect(document.querySelector('.pyr3-tooltip')).not.toBeNull();
    // Click again — popover dismisses.
    icon.click();
    expect(document.querySelector('.pyr3-tooltip')).toBeNull();
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
