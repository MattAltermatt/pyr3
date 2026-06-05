// @vitest-environment happy-dom
//
// Unit tests for the /v1/edit viewport section.

import { describe, expect, it, vi } from 'vitest';
import { viewportSection } from './edit-section-viewport';
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
  // Pin known starting values for deterministic input-value assertions.
  state.genome.scale = 200;
  state.genome.cx = 0;
  state.genome.cy = 0;
  state.genome.rotate = undefined;
  // Pin render dims so fit() targets a known canvas size.
  state.genome.size = { width: 1920, height: 1080 };
  const onChange = vi.fn();
  viewportSection.build(host, state, onChange);
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

describe('viewportSection — DOM smoke', () => {
  it('renders 4 number inputs (scale, cx, cy, rotate)', () => {
    const { host } = mount();
    expect(host.querySelector('.pyr3-edit-viewport-scale-input')).toBeTruthy();
    expect(host.querySelector('.pyr3-edit-viewport-cx-input')).toBeTruthy();
    expect(host.querySelector('.pyr3-edit-viewport-cy-input')).toBeTruthy();
    expect(host.querySelector('.pyr3-edit-viewport-rotate-input')).toBeTruthy();
    expect(host.querySelectorAll('.pyr3-edit-viewport-input').length).toBe(4);
  });

  it('renders a 🎯 fit button at the top of the section', () => {
    const { host } = mount();
    const btn = host.querySelector('.pyr3-edit-viewport-fit') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('fit');
    // The fit button should sit above the field rows so users see the
    // action affordance before the inputs.
    const firstRow = host.firstElementChild as HTMLElement;
    expect(firstRow.querySelector('.pyr3-edit-viewport-fit')).toBe(btn);
  });

  it('matches the canonical pyr3-edit-btn style (same as render PNG / reroll)', () => {
    const { host } = mount();
    const btn = host.querySelector('.pyr3-edit-viewport-fit') as HTMLButtonElement;
    expect(btn.classList.contains('pyr3-edit-btn')).toBe(true);
  });

  it('🎯 fit uses buildButton with the accent variant (task 7.9)', () => {
    const { host } = mount();
    const btn = host.querySelector('.pyr3-edit-viewport-fit') as HTMLElement;
    expect(btn.classList.contains('pyr3-btn')).toBe(true);
    expect(btn.classList.contains('pyr3-btn-accent')).toBe(true);
    // The 🎯 emoji icon is rendered ahead of the label text.
    expect(btn.textContent).toContain('🎯');
    expect(btn.textContent).toContain('fit');
  });

  it('rows use the shared 96px-label grid (.pyr3-row)', () => {
    const { host } = mount();
    const rows = host.querySelectorAll('.pyr3-row');
    expect(rows.length).toBe(4);
    for (const r of rows) {
      expect((r as HTMLElement).style.gridTemplateColumns).toBe('96px 1fr');
    }
  });

  it('does NOT render the legacy ◀ / ▶ stepper buttons', () => {
    const { host } = mount();
    expect(host.querySelectorAll('.pyr3-edit-viewport-stepper').length).toBe(0);
  });

  it('initial input values reflect genome (rotate=undefined shows as 0)', () => {
    const { host } = mount();
    const scale = host.querySelector('.pyr3-edit-viewport-scale-input') as HTMLElement;
    const cx = host.querySelector('.pyr3-edit-viewport-cx-input') as HTMLElement;
    const rot = host.querySelector('.pyr3-edit-viewport-rotate-input') as HTMLElement;
    expect(scale.textContent).toBe('200');
    expect(cx.textContent).toBe('0');
    expect(rot.textContent).toBe('0');
  });
});

describe('viewportSection — input mutation', () => {
  it('scale input writes genome.scale + fires onChange("scale")', () => {
    const { host, state, onChange } = mount();
    typeInto(host.querySelector('.pyr3-edit-viewport-scale-input') as HTMLElement, '350');
    expect(state.genome.scale).toBe(350);
    expect(onChange).toHaveBeenCalledWith('scale');
  });

  it('cx input writes genome.cx + fires onChange("cx")', () => {
    const { host, state, onChange } = mount();
    typeInto(host.querySelector('.pyr3-edit-viewport-cx-input') as HTMLElement, '0.5');
    expect(state.genome.cx).toBe(0.5);
    expect(onChange).toHaveBeenCalledWith('cx');
  });

  it('cy input writes genome.cy + fires onChange("cy")', () => {
    const { host, state, onChange } = mount();
    typeInto(host.querySelector('.pyr3-edit-viewport-cy-input') as HTMLElement, '-1.25');
    expect(state.genome.cy).toBe(-1.25);
    expect(onChange).toHaveBeenCalledWith('cy');
  });

  it('rotate input writes genome.rotate when non-zero', () => {
    const { host, state, onChange } = mount();
    typeInto(host.querySelector('.pyr3-edit-viewport-rotate-input') as HTMLElement, '45');
    expect(state.genome.rotate).toBe(45);
    expect(onChange).toHaveBeenCalledWith('rotate');
  });

  it('rotate=0 clears genome.rotate back to undefined', () => {
    const { host, state } = mount();
    state.genome.rotate = 30;
    typeInto(host.querySelector('.pyr3-edit-viewport-rotate-input') as HTMLElement, '0');
    expect(state.genome.rotate).toBeUndefined();
  });
});

describe('viewportSection — 🎯 fit button', () => {
  it('rewrites scale + cx + cy + fires onChange three times', () => {
    const { host, state, onChange } = mount();
    const btn = host.querySelector('.pyr3-edit-viewport-fit') as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Fit on a contractive-affine random genome should yield finite values.
    expect(Number.isFinite(state.genome.scale)).toBe(true);
    expect(state.genome.scale).toBeGreaterThan(0);
    expect(Number.isFinite(state.genome.cx)).toBe(true);
    expect(Number.isFinite(state.genome.cy)).toBe(true);
    expect(onChange).toHaveBeenCalledWith('scale');
    expect(onChange).toHaveBeenCalledWith('cx');
    expect(onChange).toHaveBeenCalledWith('cy');
  });

  it('syncs the visible input values after fitting', () => {
    const { host, state } = mount();
    const btn = host.querySelector('.pyr3-edit-viewport-fit') as HTMLButtonElement;
    const scale = host.querySelector('.pyr3-edit-viewport-scale-input') as HTMLElement;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(scale.textContent).toBe(String(state.genome.scale));
  });

  it('does NOT fire onChange when the genome has no xforms (degenerate)', () => {
    const { host, state, onChange } = mount();
    state.genome.xforms = [];
    const btn = host.querySelector('.pyr3-edit-viewport-fit') as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();
    // Genome state should be untouched.
    expect(state.genome.scale).toBe(200);
    expect(state.genome.cx).toBe(0);
    expect(state.genome.cy).toBe(0);
  });
});
