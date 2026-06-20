// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { densitySection } from './edit-section-density';
import { createEditState } from './edit-state';
import { generateRandomGenome } from './edit-seed';
import { DEFAULT_DENSITY } from './density';

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

// Like mount(), but seeds an explicit genome.density BEFORE building so the
// DE toggle reflects a known kernel (#397).
function mountWithDensity(density: { maxRad: number; minRad: number; curve: number }) {
  const wrap = document.createElement('div');
  wrap.className = 'pyr3-edit-section';
  const header = document.createElement('div');
  header.className = 'pyr3-edit-section-header';
  wrap.appendChild(header);
  const host = document.createElement('div');
  wrap.appendChild(host);
  document.body.appendChild(wrap);

  const state = createEditState(generateRandomGenome(seededRng(1)), 1);
  state.genome.density = { ...density };
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

  it('stamps data-help-key on minRad / maxRad / curve (Q4)', () => {
    const { host } = mount();
    expect(host.querySelector('[data-help-key="density.minRad"]')).not.toBeNull();
    expect(host.querySelector('[data-help-key="density.maxRad"]')).not.toBeNull();
    expect(host.querySelector('[data-help-key="density.curve"]')).not.toBeNull();
  });

  it('renders 3 slider+input pairs (preset dropdown removed 2026-06-05)', () => {
    const { host } = mount();
    // Dropdown is gone — confirm explicitly.
    expect(host.querySelector('.pyr3-edit-density-preset')).toBeNull();
    const sliders = host.querySelectorAll('input[type="range"]');
    expect(sliders.length).toBe(3);
    const numbers = host.querySelectorAll('.pyr3-scrubby');
    expect(numbers.length).toBe(3);
  });

  it('#370: mounting does NOT materialize genome.density (no silent mutation)', () => {
    const { state, host } = mount();
    // Opening the section must NOT write DEFAULT_DENSITY into the genome — that
    // was a non-undoable mutation that flipped DE on for density-less flames.
    expect(state.genome.density).toBeUndefined();
    // ...but the sliders still DISPLAY the effective engine default (maxRad 9).
    const maxRadScrubby = host.querySelector<HTMLElement>(
      '.pyr3-edit-density-maxRad-row .pyr3-slider-scrubby',
    )!;
    expect(parseFloat(maxRadScrubby.textContent!)).toBeCloseTo(DEFAULT_DENSITY.maxRad, 3);
  });

  it('#370: genome.density is materialized only on a real edit', () => {
    const { host, state } = mount();
    expect(state.genome.density).toBeUndefined();
    const slider = host.querySelector<HTMLInputElement>('.pyr3-edit-density-maxRad-slider')!;
    slider.value = '12';
    slider.dispatchEvent(new Event('input'));
    expect(state.genome.density).toEqual({ ...DEFAULT_DENSITY, maxRad: 12 });
  });

  it('editing maxRad slider mutates state.genome.density.maxRad and fires onChange', () => {
    const { host, state, onChange } = mount();
    const slider = host.querySelector<HTMLInputElement>('.pyr3-edit-density-maxRad-slider')!;
    slider.value = '15';
    slider.dispatchEvent(new Event('input'));
    expect(state.genome.density!.maxRad).toBe(15);
    expect(onChange).toHaveBeenCalledWith('density.maxRad');
  });

  it('editing the maxRad scrubby mutates state and syncs the hidden range mirror', () => {
    const { host, state } = mount();
    // The buildSlider control owns an internal scrubby (`.pyr3-slider-scrubby`)
    // and a visually-hidden range mirror (`.pyr3-edit-density-maxRad-slider`).
    // Typing into the scrubby writes the genome and mirrors back to the range.
    const row = host.querySelector<HTMLElement>('.pyr3-edit-density-maxRad-row')!;
    const number = row.querySelector<HTMLElement>('.pyr3-slider-scrubby')!;
    const slider = row.querySelector<HTMLInputElement>('.pyr3-edit-density-maxRad-slider')!;
    typeInto(number, '12.5');
    expect(state.genome.density!.maxRad).toBe(12.5);
    expect(slider.value).toBe('12.5');
  });

  it('renders ? info icons next to every labeled field (maxRad + minRad + curve)', () => {
    const { host } = mount();
    const icons = host.querySelectorAll('.pyr3-info-icon');
    // 3 labeled fields → 3 info icons (maxRad / minRad / curve). Was 4
    // before 2026-06-05 when the engine-DE preset dropdown was removed.
    expect(icons.length).toBeGreaterThanOrEqual(3);
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

describe('densitySection — DE on/off toggle (#397)', () => {
  it('renames the section header to DENSITY ESTIMATION', () => {
    expect(densitySection.title).toContain('DENSITY ESTIMATION');
  });

  it('renders a DE on/off toggle, on by default for a maxRad>0 kernel', () => {
    const { host } = mountWithDensity({ maxRad: 9, minRad: 0, curve: 0.4 });
    const toggle = host.querySelector('.pyr3-edit-de-toggle-row .pyr3-toggle') as HTMLElement;
    expect(toggle).not.toBeNull();
    expect(toggle.classList.contains('on')).toBe(true);
  });

  it('turning DE off writes maxRad 0 and remembers the prior value', () => {
    const { host, state } = mountWithDensity({ maxRad: 9, minRad: 0, curve: 0.4 });
    const toggle = host.querySelector('.pyr3-edit-de-toggle-row .pyr3-toggle') as HTMLElement;
    toggle.click(); // → off
    expect(state.genome.density?.maxRad).toBe(0);
    expect(state.deRestoreMaxRad).toBe(9);
    expect(toggle.classList.contains('on')).toBe(false);
  });

  it('turning DE back on restores the remembered maxRad', () => {
    const { host, state } = mountWithDensity({ maxRad: 7, minRad: 0, curve: 0.4 });
    const toggle = host.querySelector('.pyr3-edit-de-toggle-row .pyr3-toggle') as HTMLElement;
    toggle.click(); // off → remembers 7
    toggle.click(); // on → restores 7
    expect(state.genome.density?.maxRad).toBe(7);
    expect(toggle.classList.contains('on')).toBe(true);
  });

  it('dims the slider rows when DE is off', () => {
    const { host } = mountWithDensity({ maxRad: 9, minRad: 0, curve: 0.4 });
    const toggle = host.querySelector('.pyr3-edit-de-toggle-row .pyr3-toggle') as HTMLElement;
    const maxRadRow = host.querySelector<HTMLElement>('.pyr3-edit-density-maxRad-row')!;
    expect(maxRadRow.style.pointerEvents).not.toBe('none');
    toggle.click(); // off
    expect(maxRadRow.style.pointerEvents).toBe('none');
    expect(parseFloat(maxRadRow.style.opacity)).toBeLessThan(1);
  });

  it('#370: a density-less flame mounts read-only with the toggle reflecting DEFAULT (on)', () => {
    const { host, state } = mount(); // random genome, no density field
    expect(state.genome.density).toBeUndefined();
    const toggle = host.querySelector('.pyr3-edit-de-toggle-row .pyr3-toggle') as HTMLElement;
    expect(toggle.classList.contains('on')).toBe(true); // DEFAULT_DENSITY.maxRad 9 > 0
    expect(state.genome.density).toBeUndefined(); // no materialization on mount
  });
});
