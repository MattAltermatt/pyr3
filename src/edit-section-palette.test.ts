// @vitest-environment happy-dom
//
// Unit tests for the /v1/edit palette section. Covers DOM smoke, ◀/▶ arrow
// cycling, hue slider/number mutation, mode radio toggling, and popover open/
// close + cell-click selection. All under happy-dom (no GPU).

import { describe, expect, it, vi } from 'vitest';
import { paletteSection } from './edit-section-palette';
import { createEditState } from './edit-state';
import { generateRandomGenome } from './edit-seed';
import { FLAM3_PALETTE_COUNT } from './flam3-palettes';

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
  // Pin the palette name to a known shape so the closure-local paletteIdx
  // parses deterministically.
  state.genome.palette = { name: 'flame #100', stops: state.genome.palette.stops };
  const onChange = vi.fn();
  paletteSection.build(host, state, onChange);
  return { host, state, onChange };
}

describe('paletteSection — DOM smoke', () => {
  it('renders strip, ◀/▶ arrows, hue slider, hue number, mode radios', () => {
    const { host } = mount();
    expect(host.querySelector('.pyr3-edit-palette-strip')).toBeTruthy();
    expect(host.querySelector('.pyr3-edit-palette-prev')).toBeTruthy();
    expect(host.querySelector('.pyr3-edit-palette-next')).toBeTruthy();
    expect(host.querySelector('.pyr3-edit-palette-hue-slider')).toBeTruthy();
    expect(host.querySelector('.pyr3-edit-palette-hue-number')).toBeTruthy();
    expect(host.querySelector('.pyr3-edit-palette-mode-linear')).toBeTruthy();
    expect(host.querySelector('.pyr3-edit-palette-mode-step')).toBeTruthy();
  });

  it('initial label matches palette name', () => {
    const { host } = mount();
    const label = host.querySelector('.pyr3-edit-palette-label') as HTMLElement;
    expect(label.textContent).toBe('flame #100');
  });

  it('initial mode radio reflects palette.mode (default linear when undefined)', () => {
    const { host } = mount();
    const linear = host.querySelector('.pyr3-edit-palette-mode-linear') as HTMLInputElement;
    const step = host.querySelector('.pyr3-edit-palette-mode-step') as HTMLInputElement;
    expect(linear.checked).toBe(true);
    expect(step.checked).toBe(false);
  });
});

describe('paletteSection — arrow stepping', () => {
  it('▶ arrow click advances paletteIdx by 1, fires onChange("palette")', () => {
    const { host, state, onChange } = mount();
    const next = host.querySelector('.pyr3-edit-palette-next') as HTMLButtonElement;
    next.click();
    expect(state.genome.palette.name).toBe('flame #101');
    expect(onChange).toHaveBeenCalledWith('palette');
  });

  it('◀ arrow click steps paletteIdx back by 1', () => {
    const { host, state, onChange } = mount();
    const prev = host.querySelector('.pyr3-edit-palette-prev') as HTMLButtonElement;
    prev.click();
    expect(state.genome.palette.name).toBe('flame #99');
    expect(onChange).toHaveBeenCalledWith('palette');
  });

  it('label updates after arrow click', () => {
    const { host } = mount();
    const next = host.querySelector('.pyr3-edit-palette-next') as HTMLButtonElement;
    next.click();
    const label = host.querySelector('.pyr3-edit-palette-label') as HTMLElement;
    expect(label.textContent).toBe('flame #101');
  });

  it('arrow stepping wraps around at FLAM3_PALETTE_COUNT boundary', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    state.genome.palette = {
      name: `flame #${FLAM3_PALETTE_COUNT - 1}`,
      stops: state.genome.palette.stops,
    };
    const onChange = vi.fn();
    paletteSection.build(host, state, onChange);
    const next = host.querySelector('.pyr3-edit-palette-next') as HTMLButtonElement;
    next.click();
    expect(state.genome.palette.name).toBe('flame #0');
  });

  it('arrow click preserves existing hue + mode on the new palette object', () => {
    const { host, state } = mount();
    state.genome.palette.hue = 90;
    state.genome.palette.mode = 'step';
    const next = host.querySelector('.pyr3-edit-palette-next') as HTMLButtonElement;
    next.click();
    expect(state.genome.palette.hue).toBe(90);
    expect(state.genome.palette.mode).toBe('step');
  });
});

describe('paletteSection — hue mutation', () => {
  it('hue slider input writes palette.hue + fires onChange("palette.hue")', () => {
    const { host, state, onChange } = mount();
    const slider = host.querySelector('.pyr3-edit-palette-hue-slider') as HTMLInputElement;
    slider.value = '180';
    slider.dispatchEvent(new Event('input'));
    expect(state.genome.palette.hue).toBe(180);
    expect(onChange).toHaveBeenCalledWith('palette.hue');
  });

  it('hue number input mirrors to the slider', () => {
    const { host, state } = mount();
    const slider = host.querySelector('.pyr3-edit-palette-hue-slider') as HTMLInputElement;
    const number = host.querySelector('.pyr3-edit-palette-hue-number') as HTMLInputElement;
    number.value = '45';
    number.dispatchEvent(new Event('input'));
    expect(state.genome.palette.hue).toBe(45);
    expect(slider.value).toBe('45');
  });

  it('hue clamps to 0..360', () => {
    const { host, state } = mount();
    const number = host.querySelector('.pyr3-edit-palette-hue-number') as HTMLInputElement;
    number.value = '500';
    number.dispatchEvent(new Event('input'));
    expect(state.genome.palette.hue).toBe(360);
    number.value = '-30';
    number.dispatchEvent(new Event('input'));
    expect(state.genome.palette.hue).toBe(0);
  });
});

describe('paletteSection — mode radio', () => {
  it('clicking step radio writes palette.mode=step + fires onChange("palette.mode")', () => {
    const { host, state, onChange } = mount();
    const step = host.querySelector('.pyr3-edit-palette-mode-step') as HTMLInputElement;
    step.checked = true;
    step.dispatchEvent(new Event('change'));
    expect(state.genome.palette.mode).toBe('step');
    expect(onChange).toHaveBeenCalledWith('palette.mode');
  });

  it('clicking linear radio writes palette.mode=linear', () => {
    const { host, state } = mount();
    // Pre-set to step so the change to linear is a real toggle.
    state.genome.palette.mode = 'step';
    const linear = host.querySelector('.pyr3-edit-palette-mode-linear') as HTMLInputElement;
    linear.checked = true;
    linear.dispatchEvent(new Event('change'));
    expect(state.genome.palette.mode).toBe('linear');
  });
});

describe('paletteSection — popover picker', () => {
  it('clicking the strip opens the popover with neighbour cells', () => {
    const { host } = mount();
    expect(host.querySelector('.pyr3-edit-palette-popover')).toBeNull();
    const strip = host.querySelector('.pyr3-edit-palette-strip') as HTMLElement;
    strip.click();
    const pop = host.querySelector('.pyr3-edit-palette-popover');
    expect(pop).toBeTruthy();
    const cells = host.querySelectorAll('.pyr3-edit-palette-popover-cell');
    expect(cells.length).toBe(30);
  });

  it('clicking the strip a second time closes the popover (toggle)', () => {
    const { host } = mount();
    const strip = host.querySelector('.pyr3-edit-palette-strip') as HTMLElement;
    strip.click();
    expect(host.querySelector('.pyr3-edit-palette-popover')).toBeTruthy();
    strip.click();
    expect(host.querySelector('.pyr3-edit-palette-popover')).toBeNull();
  });

  it('clicking a popover cell sets the palette index + closes the popover', () => {
    const { host, state, onChange } = mount();
    const strip = host.querySelector('.pyr3-edit-palette-strip') as HTMLElement;
    strip.click();
    const cells = host.querySelectorAll<HTMLElement>('.pyr3-edit-palette-popover-cell');
    // Pick a cell with a known idx attribute.
    const target = cells[5]!;
    const idx = Number(target.getAttribute('data-palette-idx'));
    target.click();
    expect(state.genome.palette.name).toBe(`flame #${idx}`);
    expect(onChange).toHaveBeenCalledWith('palette');
    expect(host.querySelector('.pyr3-edit-palette-popover')).toBeNull();
  });
});
