// @vitest-environment happy-dom
//
// Unit tests for the /v1/edit viewport section. Covers DOM smoke, per-field
// number-input mutation + onChange path, and ◀/▶ stepper deltas (plain / shift
// / ctrl).

import { describe, expect, it, vi } from 'vitest';
import { viewportSection, stepperDelta } from './edit-section-viewport';
import { createEditState } from './edit-state';
import { generateRandomGenome } from './edit-seed';

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
  // Pin known starting values so stepper-delta tests have stable arithmetic.
  state.genome.scale = 200;
  state.genome.cx = 0;
  state.genome.cy = 0;
  state.genome.rotate = undefined;
  const onChange = vi.fn();
  viewportSection.build(host, state, onChange);
  return { host, state, onChange };
}

describe('viewportSection — DOM smoke', () => {
  it('renders 4 number inputs (scale, cx, cy, rotate)', () => {
    const { host } = mount();
    expect(host.querySelector('.pyr3-edit-viewport-scale-input')).toBeTruthy();
    expect(host.querySelector('.pyr3-edit-viewport-cx-input')).toBeTruthy();
    expect(host.querySelector('.pyr3-edit-viewport-cy-input')).toBeTruthy();
    expect(host.querySelector('.pyr3-edit-viewport-rotate-input')).toBeTruthy();
    expect(host.querySelectorAll('.pyr3-edit-viewport-input').length).toBe(4);
  });

  it('renders 8 stepper buttons (4 fields × ◀ / ▶)', () => {
    const { host } = mount();
    expect(host.querySelectorAll('.pyr3-edit-viewport-stepper').length).toBe(8);
  });

  it('initial input values reflect genome (rotate=undefined shows as 0)', () => {
    const { host } = mount();
    const scale = host.querySelector('.pyr3-edit-viewport-scale-input') as HTMLInputElement;
    const cx = host.querySelector('.pyr3-edit-viewport-cx-input') as HTMLInputElement;
    const rot = host.querySelector('.pyr3-edit-viewport-rotate-input') as HTMLInputElement;
    expect(scale.value).toBe('200');
    expect(cx.value).toBe('0');
    expect(rot.value).toBe('0');
  });
});

describe('viewportSection — input mutation', () => {
  it('scale input writes genome.scale + fires onChange("scale")', () => {
    const { host, state, onChange } = mount();
    const scale = host.querySelector('.pyr3-edit-viewport-scale-input') as HTMLInputElement;
    scale.value = '350';
    scale.dispatchEvent(new Event('input'));
    expect(state.genome.scale).toBe(350);
    expect(onChange).toHaveBeenCalledWith('scale');
  });

  it('cx input writes genome.cx + fires onChange("cx")', () => {
    const { host, state, onChange } = mount();
    const cx = host.querySelector('.pyr3-edit-viewport-cx-input') as HTMLInputElement;
    cx.value = '0.5';
    cx.dispatchEvent(new Event('input'));
    expect(state.genome.cx).toBe(0.5);
    expect(onChange).toHaveBeenCalledWith('cx');
  });

  it('cy input writes genome.cy + fires onChange("cy")', () => {
    const { host, state, onChange } = mount();
    const cy = host.querySelector('.pyr3-edit-viewport-cy-input') as HTMLInputElement;
    cy.value = '-1.25';
    cy.dispatchEvent(new Event('input'));
    expect(state.genome.cy).toBe(-1.25);
    expect(onChange).toHaveBeenCalledWith('cy');
  });

  it('rotate input writes genome.rotate when non-zero', () => {
    const { host, state, onChange } = mount();
    const rot = host.querySelector('.pyr3-edit-viewport-rotate-input') as HTMLInputElement;
    rot.value = '45';
    rot.dispatchEvent(new Event('input'));
    expect(state.genome.rotate).toBe(45);
    expect(onChange).toHaveBeenCalledWith('rotate');
  });

  it('rotate=0 clears genome.rotate back to undefined', () => {
    const { host, state } = mount();
    state.genome.rotate = 30;
    const rot = host.querySelector('.pyr3-edit-viewport-rotate-input') as HTMLInputElement;
    rot.value = '0';
    rot.dispatchEvent(new Event('input'));
    expect(state.genome.rotate).toBeUndefined();
  });
});

describe('viewportSection — stepper buttons', () => {
  it('plain ▶ click adds 1', () => {
    const { host, state, onChange } = mount();
    const btn = host.querySelector('.pyr3-edit-viewport-scale-next') as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.genome.scale).toBe(201);
    expect(onChange).toHaveBeenCalledWith('scale');
  });

  it('plain ◀ click subtracts 1', () => {
    const { host, state } = mount();
    const btn = host.querySelector('.pyr3-edit-viewport-scale-prev') as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.genome.scale).toBe(199);
  });

  it('shift-click ▶ adds 10', () => {
    const { host, state } = mount();
    const btn = host.querySelector('.pyr3-edit-viewport-scale-next') as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    expect(state.genome.scale).toBe(210);
  });

  it('shift-click ◀ subtracts 10', () => {
    const { host, state } = mount();
    const btn = host.querySelector('.pyr3-edit-viewport-scale-prev') as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    expect(state.genome.scale).toBe(190);
  });

  it('ctrl-click ▶ adds 0.1', () => {
    const { host, state } = mount();
    const btn = host.querySelector('.pyr3-edit-viewport-cx-next') as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true }));
    expect(state.genome.cx).toBeCloseTo(0.1, 10);
  });

  it('meta-click ◀ subtracts 0.1 (mac modifier)', () => {
    const { host, state } = mount();
    const btn = host.querySelector('.pyr3-edit-viewport-cy-prev') as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent('click', { metaKey: true, bubbles: true }));
    expect(state.genome.cy).toBeCloseTo(-0.1, 10);
  });

  it('stepper writes also update the input value', () => {
    const { host } = mount();
    const btn = host.querySelector('.pyr3-edit-viewport-scale-next') as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const input = host.querySelector('.pyr3-edit-viewport-scale-input') as HTMLInputElement;
    expect(input.value).toBe('201');
  });
});

describe('stepperDelta helper', () => {
  it('plain click → ±1', () => {
    expect(stepperDelta(new MouseEvent('click'), 1)).toBe(1);
    expect(stepperDelta(new MouseEvent('click'), -1)).toBe(-1);
  });
  it('shift click → ±10', () => {
    expect(stepperDelta(new MouseEvent('click', { shiftKey: true }), 1)).toBe(10);
    expect(stepperDelta(new MouseEvent('click', { shiftKey: true }), -1)).toBe(-10);
  });
  it('ctrl click → ±0.1', () => {
    expect(stepperDelta(new MouseEvent('click', { ctrlKey: true }), 1)).toBeCloseTo(0.1, 10);
    expect(stepperDelta(new MouseEvent('click', { ctrlKey: true }), -1)).toBeCloseTo(-0.1, 10);
  });
  it('shift takes precedence over ctrl', () => {
    expect(stepperDelta(new MouseEvent('click', { shiftKey: true, ctrlKey: true }), 1)).toBe(10);
  });
});
