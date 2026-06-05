// @vitest-environment happy-dom
//
// Unit tests for the /v1/edit palette section after Phase 9 reflow:
//   - Full-width hue-rotating ribbon at top (the one section-body exception
//     to the row grid).
//   - `palette` row: launcher button (text = paletteIdentifier()) →
//     opens the docked picker.
//   - `hue rotation` row: buildSlider 0..360 with degree value display.
//   - `⟲ reset hue` btn-accent inline action.
//   - Section header carries a `hue +N°` chip when state.genome.palette.hue
//     is non-zero.
//   - Mode radio (linear/step → genome.paletteMode) preserved.

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

// mountEditUi adds a .pyr3-edit-section-header sibling to the body host.
// Tests that exercise header chip logic need the wrap+header+body structure.
function mountWithHeader(stateOverrides?: (state: ReturnType<typeof createEditState>) => void): {
  wrap: HTMLElement;
  header: HTMLElement;
  host: HTMLElement;
  state: ReturnType<typeof createEditState>;
  onChange: ReturnType<typeof vi.fn>;
} {
  const wrap = document.createElement('div');
  wrap.className = 'pyr3-edit-section';
  const header = document.createElement('div');
  header.className = 'pyr3-edit-section-header';
  const host = document.createElement('div');
  host.className = 'pyr3-edit-section-body';
  wrap.append(header, host);
  document.body.appendChild(wrap);

  const state = createEditState(generateRandomGenome(seededRng(1)), 1);
  // Pin palette to flame #100 so paletteSource derives deterministically.
  state.genome.palette = { name: 'flame #100', stops: state.genome.palette.stops };
  if (stateOverrides) stateOverrides(state);
  const onChange = vi.fn();
  paletteSection.build(host, state, onChange);
  return { wrap, header, host, state, onChange };
}

function mount() {
  const host = document.createElement('div');
  const state = createEditState(generateRandomGenome(seededRng(1)), 1);
  state.genome.palette = { name: 'flame #100', stops: state.genome.palette.stops };
  const onChange = vi.fn();
  paletteSection.build(host, state, onChange);
  document.body.appendChild(host);
  return { host, state, onChange };
}

function typeInto(cell: HTMLElement, value: string): void {
  cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const inp = cell.querySelector('input') as HTMLInputElement;
  inp.value = value;
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('paletteSection — DOM smoke', () => {
  it('renders ribbon, launcher button, hue slider, reset-hue action, mode radios', () => {
    const { host } = mount();
    expect(host.querySelector('.pyr3-edit-palette-ribbon')).toBeTruthy();
    expect(host.querySelector('.pyr3-edit-palette-launcher')).toBeTruthy();
    expect(host.querySelector('.pyr3-edit-palette-hue-row')).toBeTruthy();
    expect(host.querySelector('.pyr3-edit-palette-reset-hue')).toBeTruthy();
    expect(host.querySelector('.pyr3-edit-palette-mode-linear')).toBeTruthy();
    expect(host.querySelector('.pyr3-edit-palette-mode-step')).toBeTruthy();
  });

  it('ribbon is a full-width 22px strip with the palette CSS gradient', () => {
    const { host } = mount();
    const ribbon = host.querySelector('.pyr3-edit-palette-ribbon') as HTMLElement;
    expect(ribbon.style.height).toBe('22px');
    expect(ribbon.style.width).toBe('100%');
    // CSS gradient bg derived from the palette's stops.
    expect(ribbon.style.background).toContain('linear-gradient');
  });

  it('ribbon applies CSS filter: hue-rotate bound to genome.palette.hue', () => {
    const { host } = mountWithHeader((state) => {
      state.genome.palette.hue = 30;
    });
    const ribbon = host.querySelector('.pyr3-edit-palette-ribbon') as HTMLElement;
    expect(ribbon.style.filter).toBe('hue-rotate(30deg)');
  });

  it('launcher button text reflects paletteIdentifier({kind: "flam3", number: N})', () => {
    const { host } = mount();
    const launcher = host.querySelector('.pyr3-edit-palette-launcher') as HTMLElement;
    const expectedName = getLibraryPaletteName(100);
    if (expectedName) {
      expect(launcher.textContent).toContain(expectedName);
      expect(launcher.textContent).toContain('flam3');
    } else {
      expect(launcher.textContent).toContain('#100');
      expect(launcher.textContent).toContain('flam3');
    }
  });

  it('initial mode radio reflects genome.paletteMode (default step — flam3 spec)', () => {
    const { host } = mount();
    const step = host.querySelector('.pyr3-edit-palette-mode-step') as HTMLInputElement;
    const linear = host.querySelector('.pyr3-edit-palette-mode-linear') as HTMLInputElement;
    expect(step.checked).toBe(true);
    expect(linear.checked).toBe(false);
  });
});

describe('paletteSection — hue mutation', () => {
  it('hue slider scrubby input writes palette.hue + fires onChange("palette.hue")', () => {
    const { host, state, onChange } = mount();
    const hueRow = host.querySelector('.pyr3-edit-palette-hue-row') as HTMLElement;
    const scrubby = hueRow.querySelector('.pyr3-slider-scrubby') as HTMLElement;
    typeInto(scrubby, '180');
    expect(state.genome.palette.hue).toBe(180);
    expect(onChange).toHaveBeenCalledWith('palette.hue');
  });

  it('scrubbing the hue updates the ribbon filter live', () => {
    const { host, state } = mount();
    const ribbon = host.querySelector('.pyr3-edit-palette-ribbon') as HTMLElement;
    const hueRow = host.querySelector('.pyr3-edit-palette-hue-row') as HTMLElement;
    const scrubby = hueRow.querySelector('.pyr3-slider-scrubby') as HTMLElement;
    typeInto(scrubby, '120');
    expect(ribbon.style.filter).toBe('hue-rotate(120deg)');
    expect(state.genome.palette.hue).toBe(120);
  });

  it('hue clamps to 0..360 via scrubby', () => {
    const { host, state } = mount();
    const hueRow = host.querySelector('.pyr3-edit-palette-hue-row') as HTMLElement;
    const scrubby = hueRow.querySelector('.pyr3-slider-scrubby') as HTMLElement;
    typeInto(scrubby, '500');
    expect(state.genome.palette.hue).toBe(360);
    typeInto(scrubby, '-30');
    expect(state.genome.palette.hue).toBe(0);
  });

  it('reset-hue button uses buildButton accent variant', () => {
    const { host } = mount();
    const reset = host.querySelector('.pyr3-edit-palette-reset-hue') as HTMLElement;
    // buildButton({variant: 'accent'}) tags as `pyr3-btn pyr3-btn-accent`.
    expect(reset.classList.contains('pyr3-btn')).toBe(true);
    expect(reset.classList.contains('pyr3-btn-accent')).toBe(true);
  });

  it('reset-hue button restores hue to 0 and clears the ribbon filter', () => {
    const { host, state, onChange } = mountWithHeader((state) => {
      state.genome.palette.hue = 90;
    });
    const ribbon = host.querySelector('.pyr3-edit-palette-ribbon') as HTMLElement;
    expect(ribbon.style.filter).toBe('hue-rotate(90deg)');
    const reset = host.querySelector('.pyr3-edit-palette-reset-hue') as HTMLElement;
    reset.click();
    expect(state.genome.palette.hue).toBe(0);
    expect(ribbon.style.filter).toBe('hue-rotate(0deg)');
    expect(onChange).toHaveBeenCalledWith('palette.hue');
  });
});

describe('paletteSection — section header chip', () => {
  it('chip not mounted when hue is 0/undefined', async () => {
    const { header } = mountWithHeader();
    // Microtask defer in build() — wait for the chip to be (or not be) mounted.
    await Promise.resolve();
    const chip = header.querySelector('.pyr3-edit-palette-chip');
    expect(chip).toBeNull();
  });

  it('chip text reads "hue +30°" when hue is 30', async () => {
    const { header } = mountWithHeader((state) => {
      state.genome.palette.hue = 30;
    });
    await Promise.resolve();
    const chip = header.querySelector('.pyr3-edit-palette-chip') as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toBe('hue +30°');
  });

  it('chip updates live as hue scrubs', async () => {
    const { host, header } = mountWithHeader();
    await Promise.resolve();
    expect(header.querySelector('.pyr3-edit-palette-chip')).toBeNull();
    const hueRow = host.querySelector('.pyr3-edit-palette-hue-row') as HTMLElement;
    const scrubby = hueRow.querySelector('.pyr3-slider-scrubby') as HTMLElement;
    typeInto(scrubby, '45');
    const chip = header.querySelector('.pyr3-edit-palette-chip') as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toBe('hue +45°');
  });
});

describe('paletteSection — launcher / ribbon → openPalettePicker', () => {
  it('launcher button click invokes state.openPalettePicker (when set)', () => {
    const opener = vi.fn();
    const { host, state } = mount();
    state.openPalettePicker = opener;
    const launcher = host.querySelector('.pyr3-edit-palette-launcher') as HTMLElement;
    launcher.click();
    expect(opener).toHaveBeenCalledOnce();
  });

  it('launcher click is a no-op when openPalettePicker is unset (graceful)', () => {
    const { host } = mount();
    const launcher = host.querySelector('.pyr3-edit-palette-launcher') as HTMLElement;
    expect(() => launcher.click()).not.toThrow();
  });

  it('ribbon click also invokes state.openPalettePicker', () => {
    const opener = vi.fn();
    const { host, state } = mount();
    state.openPalettePicker = opener;
    const ribbon = host.querySelector('.pyr3-edit-palette-ribbon') as HTMLElement;
    ribbon.click();
    expect(opener).toHaveBeenCalledOnce();
  });

  it('ribbon click does NOT also drive the hue slider (separate handlers)', () => {
    const opener = vi.fn();
    const { host, state, onChange } = mount();
    state.openPalettePicker = opener;
    const initialHue = state.genome.palette.hue ?? 0;
    const ribbon = host.querySelector('.pyr3-edit-palette-ribbon') as HTMLElement;
    ribbon.click();
    expect(state.genome.palette.hue ?? 0).toBe(initialHue);
    // onChange for hue must not have fired from this click.
    expect(onChange).not.toHaveBeenCalledWith('palette.hue');
  });

  it('after build() the section installs a default openPalettePicker (when unset)', () => {
    // The section's build mounts a default opener so the launcher works even
    // before the host wires a dock. Calling it should not throw.
    const { state } = mount();
    expect(typeof state.openPalettePicker).toBe('function');
    expect(() => state.openPalettePicker?.()).not.toThrow();
    // Default opener mounts the picker on document.body. Clean up so the
    // afterEach doesn't leak listeners across tests.
    document.querySelectorAll('.pyr3-palette-picker').forEach((n) => n.remove());
  });

  it('host-provided openPalettePicker is NOT overwritten by the default', () => {
    const opener = vi.fn();
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    state.genome.palette = { name: 'flame #100', stops: state.genome.palette.stops };
    state.openPalettePicker = opener;
    paletteSection.build(host, state, vi.fn());
    expect(state.openPalettePicker).toBe(opener);
  });
});

describe('paletteSection — mode radio (flam3 paletteMode, preserved)', () => {
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

  it('clicking step REMOVES genome.paletteMode (step is flam3 default — clean round-trip)', () => {
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
});

// FLAM3_PALETTE_COUNT just keeps the import live across grep/lint sweeps.
void FLAM3_PALETTE_COUNT;
