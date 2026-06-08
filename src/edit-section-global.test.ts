// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { globalSection, hexToRgb01, rgb01ToHex } from './edit-section-global';
import { createEditState } from './edit-state';
import { generateRandomGenome } from './edit-seed';
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

function setup(): {
  host: HTMLDivElement;
  state: ReturnType<typeof createEditState>;
  onChange: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement('div');
  const genome = generateRandomGenome(seededRng(1));
  delete genome.tonemap;
  const state = createEditState(genome, 1);
  const onChange = vi.fn();
  globalSection.build(host, state, onChange);
  document.body.appendChild(host); // text-mode swap needs to be in the document
  return { host, state, onChange };
}

// Drive a scrubby cell by double-clicking into text mode, typing, pressing Enter.
function typeInto(cell: HTMLElement, value: string): void {
  cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const inp = cell.querySelector('input') as HTMLInputElement;
  inp.value = value;
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

function rowByLabel(host: HTMLElement, label: string): HTMLElement {
  for (const r of host.querySelectorAll('.pyr3-edit-row')) {
    if (r.querySelector('.pyr3-edit-label')?.textContent === label) return r as HTMLElement;
  }
  throw new Error(`row not found: ${label}`);
}

describe('globalSection — shell', () => {
  it('exports the SectionMount shape', () => {
    expect(globalSection.key).toBe('global');
    expect(globalSection.title).toMatch(/global/i);
    expect(typeof globalSection.build).toBe('function');
  });

  it('renders all six core rows (brightness/gamma/highlightPower/gammaThreshold/vibrancy/background) + symmetry', () => {
    const { host } = setup();
    const expected = ['brightness', 'gamma', 'highlightPower', 'gammaThreshold', 'vibrancy', 'background', 'symmetry'];
    for (const label of expected) {
      expect(() => rowByLabel(host, label)).not.toThrow();
    }
  });

  it('initial values reflect DEFAULT_TONEMAP when genome.tonemap is undefined', () => {
    const { host, state } = setup();
    expect(state.genome.tonemap).toBeUndefined();
    const brightness = rowByLabel(host, 'brightness').querySelector('.pyr3-scrubby') as HTMLElement;
    expect(parseFloat(brightness.textContent ?? '')).toBeCloseTo(DEFAULT_TONEMAP.brightness, 5);
    const gamma = rowByLabel(host, 'gamma').querySelector('.pyr3-scrubby') as HTMLElement;
    expect(parseFloat(gamma.textContent ?? '')).toBeCloseTo(DEFAULT_TONEMAP.gamma, 5);
    const vibrancy = rowByLabel(host, 'vibrancy').querySelector('input') as HTMLInputElement;
    expect(parseFloat(vibrancy.value)).toBeCloseTo(DEFAULT_TONEMAP.vibrancy, 5);
  });
});

describe('globalSection — tonemap field mutations', () => {
  it('brightness input mutates tonemap.brightness and fires the right path', () => {
    const { host, state, onChange } = setup();
    typeInto(rowByLabel(host, 'brightness').querySelector('.pyr3-scrubby') as HTMLElement, '12.5');
    expect(state.genome.tonemap?.brightness).toBeCloseTo(12.5, 5);
    expect(onChange).toHaveBeenCalledWith('tonemap.brightness');
  });

  it('gamma input mutates tonemap.gamma', () => {
    const { host, state, onChange } = setup();
    typeInto(rowByLabel(host, 'gamma').querySelector('.pyr3-scrubby') as HTMLElement, '3.1');
    expect(state.genome.tonemap?.gamma).toBeCloseTo(3.1, 5);
    expect(onChange).toHaveBeenCalledWith('tonemap.gamma');
  });

  it('highlightPower input mutates tonemap.highlightPower', () => {
    const { host, state, onChange } = setup();
    typeInto(rowByLabel(host, 'highlightPower').querySelector('.pyr3-scrubby') as HTMLElement, '2.0');
    expect(state.genome.tonemap?.highlightPower).toBeCloseTo(2.0, 5);
    expect(onChange).toHaveBeenCalledWith('tonemap.highlightPower');
  });

  it('gammaThreshold input mutates tonemap.gammaThreshold', () => {
    const { host, state, onChange } = setup();
    typeInto(rowByLabel(host, 'gammaThreshold').querySelector('.pyr3-scrubby') as HTMLElement, '0.05');
    expect(state.genome.tonemap?.gammaThreshold).toBeCloseTo(0.05, 5);
    expect(onChange).toHaveBeenCalledWith('tonemap.gammaThreshold');
  });

  it('vibrancy slider mutates tonemap.vibrancy (range input)', () => {
    const { host, state, onChange } = setup();
    const input = rowByLabel(host, 'vibrancy').querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('range');
    input.value = '0.6';
    input.dispatchEvent(new Event('input'));
    expect(state.genome.tonemap?.vibrancy).toBeCloseTo(0.6, 5);
    expect(onChange).toHaveBeenCalledWith('tonemap.vibrancy');
  });
});

describe('globalSection — lazy tonemap init', () => {
  it('editing brightness when genome.tonemap is undefined initialises from DEFAULT_TONEMAP', () => {
    const { host, state } = setup();
    expect(state.genome.tonemap).toBeUndefined();
    typeInto(rowByLabel(host, 'brightness').querySelector('.pyr3-scrubby') as HTMLElement, '7');
    expect(state.genome.tonemap).toBeDefined();
    expect(state.genome.tonemap!.brightness).toBe(7);
    // Other fields preserved from DEFAULT_TONEMAP (not undefined)
    expect(state.genome.tonemap!.gamma).toBe(DEFAULT_TONEMAP.gamma);
    expect(state.genome.tonemap!.vibrancy).toBe(DEFAULT_TONEMAP.vibrancy);
    expect(state.genome.tonemap!.highlightPower).toBe(DEFAULT_TONEMAP.highlightPower);
    expect(state.genome.tonemap!.gammaThreshold).toBe(DEFAULT_TONEMAP.gammaThreshold);
  });
});

describe('globalSection — background color', () => {
  it('color picker writes genome.background as [r,g,b] in 0..1', () => {
    const { host, state, onChange } = setup();
    const input = rowByLabel(host, 'background').querySelector('input[type="color"]') as HTMLInputElement;
    input.value = '#ff8000';
    input.dispatchEvent(new Event('input'));
    expect(state.genome.background).toBeDefined();
    const [r, g, b] = state.genome.background!;
    expect(r).toBeCloseTo(1.0, 3);
    expect(g).toBeCloseTo(128 / 255, 3);
    expect(b).toBeCloseTo(0.0, 3);
    expect(onChange).toHaveBeenCalledWith('background');
  });

  it('initial color reflects an already-set genome.background', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    state.genome.background = [1.0, 0.5, 0.0];
    globalSection.build(host, state, () => {});
    const input = rowByLabel(host, 'background').querySelector('input[type="color"]') as HTMLInputElement;
    expect(input.value.toLowerCase()).toBe('#ff8000');
  });

  it('hexToRgb01 + rgb01ToHex round-trip', () => {
    expect(hexToRgb01('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgb01('#ffffff')).toEqual([1, 1, 1]);
    const round = rgb01ToHex(hexToRgb01('#3a7fbe'));
    expect(round.toLowerCase()).toBe('#3a7fbe');
  });
});

describe('globalSection — row primitive adoption (task 7.8)', () => {
  it('every row uses the shared buildRow grid (.pyr3-row + 96px label column)', () => {
    const { host } = setup();
    const rows = host.querySelectorAll('.pyr3-row');
    // 7 rows expected: brightness/gamma/highlightPower/gammaThreshold/vibrancy/background/symmetry
    expect(rows.length).toBe(7);
    for (const r of rows) {
      const el = r as HTMLElement;
      expect(el.style.gridTemplateColumns).toBe('96px 1fr');
    }
  });

  it('vibrancy row uses buildSlider chrome (rail + fill + handle + scrubby value)', () => {
    const { host } = setup();
    const vRow = rowByLabel(host, 'vibrancy');
    expect(vRow.querySelector('.pyr3-slider')).not.toBeNull();
    expect(vRow.querySelector('.pyr3-slider-rail')).not.toBeNull();
    expect(vRow.querySelector('.pyr3-slider-fill')).not.toBeNull();
    expect(vRow.querySelector('.pyr3-slider-handle')).not.toBeNull();
    // The always-visible numeric value lives in the slider's value cell.
    expect(vRow.querySelector('.pyr3-slider-value')).not.toBeNull();
  });

  it('background row uses buildColorSwatch filling the control column', () => {
    const { host } = setup();
    const bgRow = rowByLabel(host, 'background');
    const swatch = bgRow.querySelector('.pyr3-color-swatch') as HTMLElement;
    expect(swatch).not.toBeNull();
    expect(swatch.style.width).toBe('100%');
    // Hidden native <input type="color"> still present for OS picker + tests.
    expect(bgRow.querySelector('input[type="color"]')).not.toBeNull();
  });

  it('symmetry row carries checkbox + kind dropdown + n input inline', () => {
    const { host } = setup();
    const symRow = rowByLabel(host, 'symmetry');
    expect(symRow.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(symRow.querySelector('select')).not.toBeNull();
    expect(symRow.querySelector('.pyr3-scrubby')).not.toBeNull();
  });
});

describe('globalSection — symmetry', () => {
  it('checkbox starts unchecked when symmetry is undefined', () => {
    const { host, state } = setup();
    expect(state.genome.symmetry).toBeUndefined();
    const check = rowByLabel(host, 'symmetry').querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(check.checked).toBe(false);
  });

  it('toggling on creates a default symmetry (rotational, n=2) and fires onChange', () => {
    const { host, state, onChange } = setup();
    const check = rowByLabel(host, 'symmetry').querySelector('input[type="checkbox"]') as HTMLInputElement;
    check.checked = true;
    check.dispatchEvent(new Event('change'));
    expect(state.genome.symmetry).toEqual({ kind: 'rotational', n: 2 });
    expect(onChange).toHaveBeenCalledWith('symmetry.active');
  });

  it('toggling off clears genome.symmetry', () => {
    const { host, state, onChange } = setup();
    const check = rowByLabel(host, 'symmetry').querySelector('input[type="checkbox"]') as HTMLInputElement;
    check.checked = true;
    check.dispatchEvent(new Event('change'));
    check.checked = false;
    check.dispatchEvent(new Event('change'));
    expect(state.genome.symmetry).toBeUndefined();
    expect(onChange).toHaveBeenCalledWith('symmetry.active');
  });

  it('kind dropdown writes symmetry.kind when active', () => {
    const { host, state, onChange } = setup();
    const symRow = rowByLabel(host, 'symmetry');
    const check = symRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
    check.checked = true;
    check.dispatchEvent(new Event('change'));

    const sel = symRow.querySelector('select') as HTMLSelectElement;
    sel.value = 'dihedral';
    sel.dispatchEvent(new Event('change'));
    expect(state.genome.symmetry?.kind).toBe('dihedral');
    expect(onChange).toHaveBeenCalledWith('symmetry.kind');
  });

  it('n input writes symmetry.n when active', () => {
    const { host, state, onChange } = setup();
    const symRow = rowByLabel(host, 'symmetry');
    const check = symRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
    check.checked = true;
    check.dispatchEvent(new Event('change'));

    typeInto(symRow.querySelector('.pyr3-scrubby') as HTMLElement, '6');
    expect(state.genome.symmetry?.n).toBe(6);
    expect(onChange).toHaveBeenCalledWith('symmetry.n');
  });

  it('kind/n inputs are disabled when symmetry is undefined', () => {
    const { host } = setup();
    const symRow = rowByLabel(host, 'symmetry');
    const sel = symRow.querySelector('select') as HTMLSelectElement;
    const nInput = symRow.querySelector('.pyr3-scrubby') as HTMLElement;
    expect(sel.disabled).toBe(true);
    expect(nInput.getAttribute('aria-disabled')).toBe('true');
  });
});
