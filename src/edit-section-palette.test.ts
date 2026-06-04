// @vitest-environment happy-dom
//
// Unit tests for the /v1/edit palette section. Covers DOM smoke, ◀/▶ arrow
// cycling, hue slider/number mutation, mode radio toggling, and full 3-col
// 701-cell picker open/close/select + live name search. All under happy-dom
// (no GPU).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { paletteSection } from './edit-section-palette';
import { createEditState } from './edit-state';
import { generateRandomGenome } from './edit-seed';
import { FLAM3_PALETTE_COUNT, getLibraryPaletteName } from './flam3-palettes';

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
  document.body.appendChild(host); // text-mode swap needs the host in the document
  return { host, state, onChange };
}

// Drive a scrubby cell by double-clicking into text mode, typing, pressing Enter.
function typeInto(cell: HTMLElement, value: string): void {
  cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const inp = cell.querySelector('input') as HTMLInputElement;
  inp.value = value;
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

afterEach(() => {
  // Pickers mount on document.body; clean between tests so they don't bleed.
  document.querySelectorAll('.pyr3-edit-palette-picker').forEach((p) => p.remove());
});

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

  it('strip row is a single flex row (◀ / strip / ▶ same line)', () => {
    const { host } = mount();
    const row = host.querySelector('.pyr3-edit-palette-strip-row') as HTMLElement;
    expect(row.style.display).toBe('flex');
  });

  it('label shows "<name> · flame #N" when palette idx is named', () => {
    const { host } = mount();
    const label = host.querySelector('.pyr3-edit-palette-label') as HTMLElement;
    const name = getLibraryPaletteName(100);
    if (name) {
      expect(label.textContent).toBe(`${name} · flame #100`);
    } else {
      expect(label.textContent).toBe('flame #100');
    }
  });

  it('label falls back to "flame #N" when palette idx is unnamed (no-name)', () => {
    // Find an idx whose name resolves to null (no-name in the source XML).
    let noNameIdx = -1;
    for (let i = 0; i < FLAM3_PALETTE_COUNT; i++) {
      if (getLibraryPaletteName(i) === null) { noNameIdx = i; break; }
    }
    if (noNameIdx < 0) return; // skip if every entry is named
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    state.genome.palette = { name: `flame #${noNameIdx}`, stops: state.genome.palette.stops };
    paletteSection.build(host, state, vi.fn());
    const label = host.querySelector('.pyr3-edit-palette-label') as HTMLElement;
    expect(label.textContent).toBe(`flame #${noNameIdx}`);
  });

  it('initial mode radio reflects genome.paletteMode (default step — flam3 spec)', () => {
    const { host } = mount();
    const linear = host.querySelector('.pyr3-edit-palette-mode-linear') as HTMLInputElement;
    const step = host.querySelector('.pyr3-edit-palette-mode-step') as HTMLInputElement;
    expect(step.checked).toBe(true);
    expect(linear.checked).toBe(false);
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
    const name = getLibraryPaletteName(101);
    const expected = name ? `${name} · flame #101` : 'flame #101';
    expect(label.textContent).toBe(expected);
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

  it('arrow click RESETS hue to 0 on new palette (mode is preserved)', () => {
    const { host, state } = mount();
    state.genome.palette.hue = 90;
    state.genome.palette.mode = 'step';
    const next = host.querySelector('.pyr3-edit-palette-next') as HTMLButtonElement;
    next.click();
    expect(state.genome.palette.hue).toBeUndefined();
    expect(state.genome.palette.mode).toBe('step');
    // Hue widgets reset to 0 too
    const slider = host.querySelector('.pyr3-edit-palette-hue-slider') as HTMLInputElement;
    const number = host.querySelector('.pyr3-edit-palette-hue-number') as HTMLElement;
    expect(slider.value).toBe('0');
    expect(number.textContent).toBe('0');
  });

  it('picker cell click also resets hue', () => {
    const { host, state } = mount();
    state.genome.palette.hue = 180;
    const strip = host.querySelector('.pyr3-edit-palette-strip') as HTMLElement;
    strip.click();
    const cells = document.querySelectorAll<HTMLElement>('.pyr3-edit-palette-picker-cell');
    cells[10]!.click();
    expect(state.genome.palette.hue).toBeUndefined();
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
    const number = host.querySelector('.pyr3-edit-palette-hue-number') as HTMLElement;
    typeInto(number, '45');
    expect(state.genome.palette.hue).toBe(45);
    expect(slider.value).toBe('45');
  });

  it('hue clamps to 0..360', () => {
    const { host, state } = mount();
    const number = host.querySelector('.pyr3-edit-palette-hue-number') as HTMLElement;
    typeInto(number, '500');
    expect(state.genome.palette.hue).toBe(360);
    typeInto(number, '-30');
    expect(state.genome.palette.hue).toBe(0);
  });
});

describe('paletteSection — mode radio (flam3 paletteMode)', () => {
  it('initial mode reflects genome.paletteMode (default step when unset)', () => {
    const { host } = mount();
    const linear = host.querySelector('.pyr3-edit-palette-mode-linear') as HTMLInputElement;
    const step = host.querySelector('.pyr3-edit-palette-mode-step') as HTMLInputElement;
    expect(step.checked).toBe(true);
    expect(linear.checked).toBe(false);
  });

  it('clicking linear writes genome.paletteMode=linear + fires onChange("paletteMode")', () => {
    const { host, state, onChange } = mount();
    const linear = host.querySelector('.pyr3-edit-palette-mode-linear') as HTMLInputElement;
    linear.checked = true;
    linear.dispatchEvent(new Event('change'));
    expect(state.genome.paletteMode).toBe('linear');
    expect(onChange).toHaveBeenCalledWith('paletteMode');
  });

  it('clicking step REMOVES genome.paletteMode (step is flam3 default — omit for clean round-trip)', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    state.genome.palette = { name: 'flame #100', stops: state.genome.palette.stops };
    state.genome.paletteMode = 'linear';
    const onChange = vi.fn();
    paletteSection.build(host, state, onChange);
    const step = host.querySelector('.pyr3-edit-palette-mode-step') as HTMLInputElement;
    step.checked = true;
    step.dispatchEvent(new Event('change'));
    expect(state.genome.paletteMode).toBeUndefined();
    expect(onChange).toHaveBeenCalledWith('paletteMode');
  });

  it('mode row carries a plain-language tooltip explaining step vs linear', () => {
    const { host } = mount();
    const row = host.querySelector('.pyr3-edit-palette-mode-row') as HTMLElement;
    expect(row.title.length).toBeGreaterThan(0);
    expect(row.title.toLowerCase()).toMatch(/step/);
    expect(row.title.toLowerCase()).toMatch(/linear/);
  });
});

describe('paletteSection — full picker (3-col grid + search + footer)', () => {
  it('clicking the strip opens the picker on document.body with all 701 cells', () => {
    const { host } = mount();
    expect(document.querySelector('.pyr3-edit-palette-picker')).toBeNull();
    const strip = host.querySelector('.pyr3-edit-palette-strip') as HTMLElement;
    strip.click();
    const picker = document.querySelector('.pyr3-edit-palette-picker');
    expect(picker).toBeTruthy();
    const cells = document.querySelectorAll('.pyr3-edit-palette-picker-cell');
    expect(cells.length).toBe(FLAM3_PALETTE_COUNT);
  });

  it('each cell carries idx, name, and a #N number', () => {
    const { host } = mount();
    const strip = host.querySelector('.pyr3-edit-palette-strip') as HTMLElement;
    strip.click();
    const first = document.querySelector('.pyr3-edit-palette-picker-cell') as HTMLElement;
    expect(first.dataset['paletteIdx']).toBe('0');
    expect(first.querySelector('.pyr3-edit-palette-picker-cell-name')).toBeTruthy();
    expect(first.querySelector('.pyr3-edit-palette-picker-cell-num')?.textContent).toBe('#0');
  });

  it('clicking a picker cell sets the palette index + closes the picker', () => {
    const { host, state, onChange } = mount();
    const strip = host.querySelector('.pyr3-edit-palette-strip') as HTMLElement;
    strip.click();
    const cells = document.querySelectorAll<HTMLElement>('.pyr3-edit-palette-picker-cell');
    const target = cells[5]!;
    const idx = Number(target.dataset['paletteIdx']);
    target.click();
    expect(state.genome.palette.name).toBe(`flame #${idx}`);
    expect(onChange).toHaveBeenCalledWith('palette');
    expect(document.querySelector('.pyr3-edit-palette-picker')).toBeNull();
  });

  it('clicking the strip a second time closes the picker (toggle)', () => {
    const { host } = mount();
    const strip = host.querySelector('.pyr3-edit-palette-strip') as HTMLElement;
    strip.click();
    expect(document.querySelector('.pyr3-edit-palette-picker')).toBeTruthy();
    strip.click();
    expect(document.querySelector('.pyr3-edit-palette-picker')).toBeNull();
  });

  it('search filters cells live, updates the footer count', () => {
    const { host } = mount();
    const strip = host.querySelector('.pyr3-edit-palette-strip') as HTMLElement;
    strip.click();
    const search = document.querySelector('.pyr3-edit-palette-picker-search input') as HTMLInputElement;
    search.value = 'sky-flesh';
    search.dispatchEvent(new Event('input'));
    const visibleCells = [...document.querySelectorAll<HTMLElement>('.pyr3-edit-palette-picker-cell')]
      .filter((c) => c.style.display !== 'none');
    expect(visibleCells.length).toBeGreaterThan(0);
    expect(visibleCells.length).toBeLessThan(FLAM3_PALETTE_COUNT);
    const countEl = document.querySelector('.pyr3-edit-palette-picker-footer span') as HTMLElement;
    expect(countEl.textContent).toMatch(/\d+ \/ \d+ match/);
  });

  it('Escape key closes the picker', () => {
    const { host } = mount();
    const strip = host.querySelector('.pyr3-edit-palette-strip') as HTMLElement;
    strip.click();
    expect(document.querySelector('.pyr3-edit-palette-picker')).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.pyr3-edit-palette-picker')).toBeNull();
  });
});
