// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { finalSection } from './edit-section-final';
import { createEditState } from './edit-state';
import { generateRandomGenome } from './edit-seed';
import { V, VARIATION_NAMES } from './variations';

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

function setupOff(): {
  host: HTMLDivElement;
  state: ReturnType<typeof createEditState>;
  onChange: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement('div');
  const state = createEditState(generateRandomGenome(seededRng(1)), 1);
  state.genome.finalxform = undefined;
  const onChange = vi.fn();
  finalSection.build(host, state, onChange);
  return { host, state, onChange };
}

function setupOn(): {
  host: HTMLDivElement;
  state: ReturnType<typeof createEditState>;
  onChange: ReturnType<typeof vi.fn>;
} {
  const env = setupOff();
  const check = env.host.querySelector('input[type="checkbox"]') as HTMLInputElement;
  check.checked = true;
  check.dispatchEvent(new Event('change'));
  env.onChange.mockClear();
  return env;
}

describe('finalSection — shell', () => {
  it('exports the SectionMount shape', () => {
    expect(finalSection.key).toBe('final');
    expect(finalSection.title).toMatch(/final/i);
    expect(typeof finalSection.build).toBe('function');
  });

  it('renders an active checkbox at the top of the body', () => {
    const { host } = setupOff();
    const check = host.querySelector('input[type="checkbox"]');
    expect(check).not.toBeNull();
    expect((check as HTMLInputElement).checked).toBe(false);
  });

  it('checkbox starts checked when finalxform is already set', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    state.genome.finalxform = {
      a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
      weight: 1, color: 0.3, colorSpeed: 0.5, opacity: 1,
      variations: [{ index: V.linear, weight: 1 }],
    };
    finalSection.build(host, state, () => {});
    const check = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(check.checked).toBe(true);
  });
});

describe('finalSection — toggle behaviour', () => {
  it('toggling on initialises a default finalxform', () => {
    const { host, state, onChange } = setupOff();
    expect(state.genome.finalxform).toBeUndefined();

    const check = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    check.checked = true;
    check.dispatchEvent(new Event('change'));

    const fx = state.genome.finalxform;
    expect(fx).toBeDefined();
    expect(fx!.a).toBe(1);
    expect(fx!.b).toBe(0);
    expect(fx!.c).toBe(0);
    expect(fx!.d).toBe(0);
    expect(fx!.e).toBe(1);
    expect(fx!.f).toBe(0);
    expect(fx!.weight).toBe(1);
    expect(fx!.color).toBe(0.5);
    expect(fx!.colorSpeed).toBe(0.5);
    expect(fx!.opacity).toBe(1);
    expect(fx!.variations.length).toBe(1);
    expect(fx!.variations[0]!.index).toBe(V.linear);
    expect(onChange).toHaveBeenCalledWith('finalxform.active');
  });

  it('toggling off clears the finalxform', () => {
    const { host, state, onChange } = setupOn();
    expect(state.genome.finalxform).toBeDefined();

    const check = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    check.checked = false;
    check.dispatchEvent(new Event('change'));

    expect(state.genome.finalxform).toBeUndefined();
    expect(onChange).toHaveBeenCalledWith('finalxform.active');
  });

  it('toggling off then on produces a fresh default (no stale prior state)', () => {
    const { host, state } = setupOn();
    state.genome.finalxform!.color = 0.9;
    const check = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    check.checked = false;
    check.dispatchEvent(new Event('change'));
    check.checked = true;
    check.dispatchEvent(new Event('change'));
    expect(state.genome.finalxform!.color).toBe(0.5);
  });
});

describe('finalSection — editable fields when active', () => {
  it('color slider mutates finalxform.color and fires onChange', () => {
    const { host, state, onChange } = setupOn();
    const sliders = host.querySelectorAll('input[type="range"]');
    // First slider is color
    const colorSlider = sliders[0] as HTMLInputElement;
    colorSlider.value = '0.72';
    colorSlider.dispatchEvent(new Event('input'));
    expect(state.genome.finalxform!.color).toBeCloseTo(0.72, 5);
    expect(onChange).toHaveBeenCalledWith('finalxform.color');
  });

  it('opacity slider mutates finalxform.opacity', () => {
    const { host, state, onChange } = setupOn();
    const sliders = host.querySelectorAll('input[type="range"]');
    const opacitySlider = sliders[1] as HTMLInputElement;
    opacitySlider.value = '0.4';
    opacitySlider.dispatchEvent(new Event('input'));
    expect(state.genome.finalxform!.opacity).toBeCloseTo(0.4, 5);
    expect(onChange).toHaveBeenCalledWith('finalxform.opacity');
  });

  it('every affine cell (a..f) mutates the right field', () => {
    const { host, state, onChange } = setupOn();
    const affineCells = host.querySelectorAll('.pyr3-edit-affine-cell');
    expect(affineCells.length).toBeGreaterThanOrEqual(6);
    const keys: Array<'a' | 'b' | 'c' | 'd' | 'e' | 'f'> = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (let i = 0; i < 6; i++) {
      const input = affineCells[i]!.querySelector('input[type="number"]') as HTMLInputElement;
      input.value = String(i + 0.5);
      input.dispatchEvent(new Event('input'));
      expect(state.genome.finalxform![keys[i]!]).toBeCloseTo(i + 0.5, 5);
      expect(onChange).toHaveBeenCalledWith(`finalxform.${keys[i]!}`);
    }
  });

  it('post-transform checkbox creates a default identity post matrix', () => {
    const { host, state, onChange } = setupOn();
    const checks = host.querySelectorAll('input[type="checkbox"]');
    // checks[0] is active; checks[1] is post-transform
    const postCheck = checks[1] as HTMLInputElement;
    expect(state.genome.finalxform!.post).toBeUndefined();
    postCheck.checked = true;
    postCheck.dispatchEvent(new Event('change'));
    expect(state.genome.finalxform!.post).toEqual({ a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 });
    expect(onChange).toHaveBeenCalledWith('finalxform.post');

    // Disabling clears the post
    postCheck.checked = false;
    postCheck.dispatchEvent(new Event('change'));
    expect(state.genome.finalxform!.post).toBeUndefined();
  });

  it('post-transform inputs mutate finalxform.post fields after enable', () => {
    const { host, state, onChange } = setupOn();
    const checks = host.querySelectorAll('input[type="checkbox"]');
    const postCheck = checks[1] as HTMLInputElement;
    postCheck.checked = true;
    postCheck.dispatchEvent(new Event('change'));

    const allCells = host.querySelectorAll('.pyr3-edit-affine-cell');
    // First 6 cells = pre-affine; next 6 = post-affine
    expect(allCells.length).toBeGreaterThanOrEqual(12);
    const postCInput = allCells[8]!.querySelector('input[type="number"]') as HTMLInputElement;
    postCInput.value = '1.5';
    postCInput.dispatchEvent(new Event('input'));
    expect(state.genome.finalxform!.post!.c).toBeCloseTo(1.5, 5);
    expect(onChange).toHaveBeenCalledWith('finalxform.post.c');
  });

  it('colorSpeed number input mutates finalxform.colorSpeed', () => {
    const { host, state, onChange } = setupOn();
    // colorSpeed is the first number input in the row labeled `colorSpeed`.
    const rows = host.querySelectorAll('.pyr3-edit-row');
    let csInput: HTMLInputElement | null = null;
    for (const r of rows) {
      const label = r.querySelector('.pyr3-edit-label');
      if (label?.textContent === 'colorSpeed') {
        csInput = r.querySelector('input[type="number"]') as HTMLInputElement;
        break;
      }
    }
    expect(csInput).not.toBeNull();
    csInput!.value = '0.7';
    csInput!.dispatchEvent(new Event('input'));
    expect(state.genome.finalxform!.colorSpeed).toBeCloseTo(0.7, 5);
    expect(onChange).toHaveBeenCalledWith('finalxform.colorSpeed');
  });

  it('variation weight input mutates finalxform.variations[0].weight', () => {
    const { host, state, onChange } = setupOn();
    const varRow = host.querySelector('.pyr3-edit-var');
    expect(varRow).not.toBeNull();
    const weightInput = varRow!.querySelector('.pyr3-edit-var-weight') as HTMLInputElement;
    weightInput.value = '0.42';
    weightInput.dispatchEvent(new Event('input'));
    expect(state.genome.finalxform!.variations[0]!.weight).toBeCloseTo(0.42, 5);
    expect(onChange).toHaveBeenCalledWith('finalxform.variations.0.weight');
  });

  it('variation kind dropdown swaps the variation index and rebuilds the row', () => {
    const { host, state, onChange } = setupOn();
    const sel = host.querySelector('.pyr3-edit-var-kind') as HTMLSelectElement;
    sel.value = String(V.spherical);
    sel.dispatchEvent(new Event('change'));
    expect(state.genome.finalxform!.variations[0]!.index).toBe(V.spherical);
    expect(onChange).toHaveBeenCalledWith('finalxform.variations.0.index');
    expect(VARIATION_NAMES[V.spherical]).toBe('spherical');
  });

  it('+ var button adds a new variation', () => {
    const { host, state, onChange } = setupOn();
    expect(state.genome.finalxform!.variations.length).toBe(1);
    const addBtn = [...host.querySelectorAll('button.pyr3-edit-btn')].find((b) =>
      b.textContent === '+ var',
    ) as HTMLButtonElement;
    expect(addBtn).toBeDefined();
    addBtn.click();
    expect(state.genome.finalxform!.variations.length).toBe(2);
    expect(onChange).toHaveBeenCalledWith('finalxform.variations.1');
  });
});

describe('finalSection — card visibility', () => {
  it('hides the card body when inactive', () => {
    const { host } = setupOff();
    const card = host.querySelector('.pyr3-edit-final-card') as HTMLElement;
    expect(card.style.display).toBe('none');
  });

  it('shows the card body when active', () => {
    const { host } = setupOn();
    const card = host.querySelector('.pyr3-edit-final-card') as HTMLElement;
    expect(card.style.display).toBe('block');
  });
});
