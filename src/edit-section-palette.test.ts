// @vitest-environment happy-dom
//
// Unit tests for the /editor palette section after Phase 9 reflow:
//   - Full-width hue-rotating ribbon at top (the one section-body exception
//     to the row grid).
//   - `palette` row: launcher button (text = paletteIdentifier()) →
//     opens the docked picker.
//   - `hue rotation` row: buildSlider 0..360 with degree value display.
//   - `⟲ reset hue` btn-accent inline action.
//   - Section header carries a `hue +N°` chip when state.genome.palette.hue
//     is non-zero.
//   - Mode radio (linear/step → genome.paletteMode) preserved.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paletteSection } from './edit-section-palette';
import { createEditState } from './edit-state';
import { generateRandomGenome } from './edit-seed';
import { FLAM3_PALETTE_COUNT, getLibraryPaletteName } from './flam3-palettes';
import { saveMine, deleteMine } from './palette-library';

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

  // #365 — applying a "mine" (user-saved) palette via the picker must reach the
  // genome. Regression guard: the host onApply previously only wired flam3, so a
  // mine pick was a silent no-op.
  it('applying a "mine" palette through the picker updates the genome palette (#365)', () => {
    const pyre = {
      name: 'pyre-test',
      stops: [
        { t: 0, r: 0.05, g: 0, b: 0 },
        { t: 1, r: 1, g: 0.92, b: 0.5 },
      ],
    };
    vi.stubGlobal('localStorage', makeStorageStub()); // happy-dom v20 has no global localStorage
    saveMine(pyre);
    try {
      const { state, onChange } = mount();
      expect(state.genome.palette.name).not.toBe('pyre-test'); // precondition

      state.openPalettePicker!(); // default opener mounts the real picker on body
      const picker = document.querySelector('.pyr3-palette-picker') as HTMLElement;
      const fire = (el: Element): void => {
        for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, { bubbles: true }));
      };
      fire(picker.querySelector('[data-tab="mine"]')!);           // switch to mine tab
      const cell = picker.querySelector('.pyr3-palette-picker-mine-cell') as HTMLElement;
      expect(cell?.dataset['mine']).toBe('pyre-test');
      fire(cell);                                                 // select the mine palette
      const apply = Array.from(picker.querySelectorAll('*')).find(
        (e) => e.childElementCount === 0 && /apply\s*&?\s*close/i.test(e.textContent || ''),
      );
      fire(apply!);                                               // commit

      expect(state.genome.palette.name).toBe('pyre-test');
      expect(state.genome.palette.stops).toHaveLength(2);
      expect(state.paletteSource).toEqual({ kind: 'mine', name: 'pyre-test' });
      expect(onChange).toHaveBeenCalledWith('palette');
      document.querySelectorAll('.pyr3-palette-picker').forEach((n) => n.remove());
    } finally {
      deleteMine('pyre-test');
      vi.unstubAllGlobals();
    }
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

// Map-backed localStorage stub — happy-dom v20 doesn't expose `localStorage`
// globally under vitest (canonical pattern, mirrors edit-state.test.ts).
function makeStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => { store.delete(k); },
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
  };
}

describe('paletteSection — Edit gradient toggle (#372)', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', makeStorageStub()); });

  it('exposes the toggle, a controls host, and a readout', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    paletteSection.build(host, state, vi.fn());
    expect(host.querySelector('[data-role="edit-gradient-toggle"]')).toBeTruthy();
    expect(host.querySelector('[data-role="gradient-controls-host"]')).toBeTruthy();
    expect(host.querySelector('[data-role="gradient-readout"]')).toBeTruthy();
  });

  it('toggle drives activeCanvasOverlay on/off and fires onCanvasOverlayChange', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    let fired = 0;
    state.onCanvasOverlayChange = () => { fired++; };
    paletteSection.build(host, state, vi.fn());

    const toggle = host.querySelector('[data-role="edit-gradient-toggle"]') as HTMLElement;
    toggle.click();
    expect(state.activeCanvasOverlay).toBe('gradient');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(fired).toBe(1);

    toggle.click();
    expect(state.activeCanvasOverlay).toBe('none');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(fired).toBe(2);
  });

  it('exposes a Save / Import / Export library cluster', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    paletteSection.build(host, state, vi.fn());
    expect(host.querySelector('[data-role="palette-save"]')).toBeTruthy();
    expect(host.querySelector('[data-role="palette-import"]')).toBeTruthy();
    expect(host.querySelector('[data-role="palette-export"]')).toBeTruthy();
  });
});

// FLAM3_PALETTE_COUNT just keeps the import live across grep/lint sweeps.
void FLAM3_PALETTE_COUNT;
