// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import {
  globalSymmetrySection,
  globalTonemapSection,
  hexToRgb01,
  rgb01ToHex,
  TONEMAP_CHANGED_EVENT,
} from './edit-section-global';
import { createEditState } from './edit-state';
import { generateRandomGenome } from './edit-seed';
import { DEFAULT_TONEMAP } from './tonemap';
import { TONEMAP_PRESETS } from './edit-preset-tonemap';

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
  // #27 — GLOBAL split into two sections; each build() calls replaceChildren on
  // its own host, so mount each into a sub-host under one parent. rowByLabel
  // searches the whole subtree, so all 7 rows resolve.
  const tonemapHost = document.createElement('div');
  const symHost = document.createElement('div');
  host.append(tonemapHost, symHost);
  globalTonemapSection.build(tonemapHost, state, onChange);
  globalSymmetrySection.build(symHost, state, onChange);
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
  it('exports the two SectionMount shapes (#27 split)', () => {
    expect(globalTonemapSection.key).toBe('global-tonemap');
    expect(globalTonemapSection.title).toMatch(/tonemap/i);
    expect(typeof globalTonemapSection.build).toBe('function');
    expect(globalSymmetrySection.key).toBe('global-symmetry');
    expect(globalSymmetrySection.title).toMatch(/symmetry/i);
    expect(typeof globalSymmetrySection.build).toBe('function');
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
    globalTonemapSection.build(host, state, () => {});
    const input = rowByLabel(host, 'background').querySelector('input[type="color"]') as HTMLInputElement;
    expect(input.value.toLowerCase()).toBe('#ff8000');
  });

  it('#351 — the color input is a full-size interactable overlay (not a pointer-events:none 1px proxy)', () => {
    const { host } = setup();
    const bgRow = rowByLabel(host, 'background');
    const input = bgRow.querySelector('input[type="color"]') as HTMLInputElement;
    // The fix: the input itself catches the click. The old bug-state set
    // pointer-events:none + width:1px and proxied a programmatic .click(),
    // which Chrome incognito ignored. Guard against regressing to that.
    expect(input.style.pointerEvents).not.toBe('none');
    expect(input.style.width).toBe('100%');
    expect(input.style.height).toBe('100%');
    expect(input.style.position).toBe('absolute');
    expect(input.style.opacity).toBe('0'); // transparent overlay over the swatch
    // The visible swatch must NOT swallow the click — it's pointer-events:none
    // so the overlaid input receives it.
    const swatch = bgRow.querySelector('.pyr3-color-swatch') as HTMLElement;
    expect(swatch.style.pointerEvents).toBe('none');
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

describe('globalSection — tonemap preset strip (#397, relocated from DENSITY EMITTER)', () => {
  function mountWithHeader() {
    const wrap = document.createElement('div');
    wrap.className = 'pyr3-edit-section';
    const header = document.createElement('div');
    header.className = 'pyr3-edit-section-header';
    const host = document.createElement('div');
    wrap.append(header, host);
    document.body.appendChild(wrap);
    const genome = generateRandomGenome(seededRng(1));
    delete genome.tonemap;
    const state = createEditState(genome, 1);
    const onChange = vi.fn();
    globalTonemapSection.build(host, state, onChange);
    return { wrap, header, host, state, onChange };
  }

  it('renders the 6-button preset strip at the top of the section body', () => {
    const { host } = mountWithHeader();
    const strip = host.querySelector('.pyr3-edit-density-preset-strip');
    expect(strip).not.toBeNull();
    expect(strip!.querySelectorAll('.pyr3-edit-density-tonemap-preset').length).toBe(6);
    // Strip sits above the tonemap rows — first child of the section body.
    expect(host.firstElementChild).toBe(strip);
    const names = Array.from(strip!.querySelectorAll('.pyr3-edit-density-tonemap-preset')).map(
      (b) => b.textContent ?? '',
    );
    for (const n of ['default', 'soft', 'vivid', 'punchy', 'cinematic', 'crystal']) {
      expect(names.some((label) => label.includes(n))).toBe(true);
    }
  });

  it('clicking a preset writes gamma/gammaThreshold/vibrancy/brightness + fires onChange', () => {
    const { host, state, onChange } = mountWithHeader();
    const vivid = TONEMAP_PRESETS.find((p) => p.name === 'vivid')!;
    (host.querySelector('.pyr3-edit-density-tonemap-preset-vivid') as HTMLElement).click();
    expect(state.genome.tonemap?.gamma).toBe(vivid.gamma);
    expect(state.genome.tonemap?.gammaThreshold).toBe(vivid.gammaThreshold);
    expect(state.genome.tonemap?.vibrancy).toBe(vivid.vibrancy);
    expect(state.genome.tonemap?.brightness).toBe(vivid.brightness);
    expect(onChange).toHaveBeenCalledWith('tonemap.gamma');
    expect(onChange).toHaveBeenCalledWith('tonemap.brightness');
  });

  it('applying a preset refreshes the displayed tonemap field values (#397)', () => {
    const { host } = mountWithHeader();
    const vivid = TONEMAP_PRESETS.find((p) => p.name === 'vivid')!;
    (host.querySelector('.pyr3-edit-density-tonemap-preset-vivid') as HTMLElement).click();
    // gamma + brightness are unclamped number inputs — they reflect the preset.
    const gammaScrubby = rowByLabel(host, 'gamma').querySelector('.pyr3-scrubby') as HTMLElement;
    expect(parseFloat(gammaScrubby.textContent ?? '')).toBeCloseTo(vivid.gamma, 5);
    const brightnessScrubby = rowByLabel(host, 'brightness').querySelector('.pyr3-scrubby') as HTMLElement;
    expect(parseFloat(brightnessScrubby.textContent ?? '')).toBeCloseTo(vivid.brightness, 5);
  });

  it('section header carries the preset chip after a preset is applied', async () => {
    const { header, state } = mountWithHeader();
    const vivid = TONEMAP_PRESETS.find((p) => p.name === 'vivid')!;
    state.genome.tonemap = {
      gamma: vivid.gamma,
      gammaThreshold: vivid.gammaThreshold,
      vibrancy: vivid.vibrancy,
      brightness: vivid.brightness,
      highlightPower: DEFAULT_TONEMAP.highlightPower,
    };
    await Promise.resolve(); // chip mounts on a microtask
    document.dispatchEvent(new CustomEvent(TONEMAP_CHANGED_EVENT));
    const chip = header.querySelector('.pyr3-edit-density-chip') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toBe('vivid');
  });

  it('chip appends * when a tonemap value is nudged off-preset', async () => {
    const { header, state } = mountWithHeader();
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
    state.genome.tonemap.brightness = vivid.brightness + 0.5;
    document.dispatchEvent(new CustomEvent(TONEMAP_CHANGED_EVENT));
    const chip = header.querySelector('.pyr3-edit-density-chip') as HTMLElement;
    expect(chip.textContent).toBe('vivid*');
  });
});

describe('globalSection — targeted help icons (Q4)', () => {
  it('tonemap section stamps data-help-key on gammaThreshold / highlightPower / vibrancy', () => {
    const { host } = setup();
    expect(host.querySelector('[data-help-key="global.gammaThreshold"]')).not.toBeNull();
    expect(host.querySelector('[data-help-key="global.highlightPower"]')).not.toBeNull();
    expect(host.querySelector('[data-help-key="global.vibrancy"]')).not.toBeNull();
  });

  it('symmetry section stamps data-help-key on symmetry', () => {
    const { host } = setup();
    expect(host.querySelector('[data-help-key="global.symmetry"]')).not.toBeNull();
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
