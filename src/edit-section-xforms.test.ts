// @vitest-environment happy-dom
//
// Unit smoke for the Xforms section. Mount the section into a detached
// host div + drive DOM events to verify each editable field writes the
// genome and emits the right onChange path. The section is happy-dom-only
// (no GPU); the slow-lane integration that re-iterates on those onChange
// callbacks is covered by the lane-scheduler tests in edit-state.test.ts.

import { describe, expect, it, vi } from 'vitest';
import { xformsSection } from './edit-section-xforms';
import { createEditState } from './edit-state';
import { generateRandomGenome } from './edit-seed';
import { V } from './variations';
import { type EditState } from './edit-state';
import { type Genome } from './genome';

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

function mount(genomeOrSeed: number | Genome = 1): {
  host: HTMLDivElement;
  state: EditState;
  onChange: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement('div');
  const genome =
    typeof genomeOrSeed === 'number'
      ? generateRandomGenome(seededRng(genomeOrSeed))
      : genomeOrSeed;
  const state = createEditState(genome, 1);
  const onChange = vi.fn();
  xformsSection.build(host, state, onChange);
  return { host, state, onChange };
}

function cards(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll('.pyr3-edit-xform-card')] as HTMLElement[];
}

function fireInput(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input'));
  if (el.tagName === 'SELECT') el.dispatchEvent(new Event('change'));
}

describe('xformsSection — DOM smoke', () => {
  it('exposes the canonical SectionMount contract', () => {
    expect(xformsSection.key).toBe('xforms');
    expect(xformsSection.title).toBe('🧬 XFORMS');
    expect(typeof xformsSection.build).toBe('function');
  });

  it('renders one card per xform in the genome', () => {
    const { host, state } = mount(1);
    expect(cards(host).length).toBe(state.genome.xforms.length);
    expect(cards(host).length).toBeGreaterThanOrEqual(2);
  });

  it('shows xform count and an + add button in the header', () => {
    const { host, state } = mount(1);
    const countEl = host.querySelector('.pyr3-edit-xforms-count') as HTMLElement;
    expect(countEl.textContent).toBe(`(${state.genome.xforms.length})`);
    const buttons = [...host.querySelectorAll('.pyr3-edit-icon-btn')] as HTMLButtonElement[];
    expect(buttons.find((b) => b.textContent === '+ add')).toBeTruthy();
  });
});

describe('xformsSection — header weight + delete', () => {
  it('weight input updates genome + emits xforms.${i}.weight', () => {
    const { host, state, onChange } = mount(1);
    const card0 = cards(host)[0]!;
    const weightInput = card0.querySelector(
      '.pyr3-edit-xform-header .pyr3-edit-num',
    ) as HTMLInputElement;
    fireInput(weightInput, '0.42');
    expect(state.genome.xforms[0]!.weight).toBeCloseTo(0.42, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.weight');
  });

  it('delete button removes the xform + emits .removed', () => {
    const { host, state, onChange } = mount(1);
    const initial = state.genome.xforms.length;
    expect(initial).toBeGreaterThan(1);
    const card1 = cards(host)[1]!;
    const delBtn = card1.querySelector(
      '.pyr3-edit-xform-header .pyr3-edit-icon-btn',
    ) as HTMLButtonElement;
    delBtn.click();
    expect(state.genome.xforms.length).toBe(initial - 1);
    expect(onChange).toHaveBeenCalledWith('xforms.1.removed');
    expect(cards(host).length).toBe(initial - 1);
  });

  it('delete button is disabled when only one xform remains', () => {
    const genome = generateRandomGenome(seededRng(1));
    // Trim to one xform.
    genome.xforms = [genome.xforms[0]!];
    const { host } = mount(genome);
    const card0 = cards(host)[0]!;
    const delBtn = card0.querySelector(
      '.pyr3-edit-xform-header .pyr3-edit-icon-btn',
    ) as HTMLButtonElement;
    expect(delBtn.disabled).toBe(true);
  });
});

describe('xformsSection — add xform', () => {
  it('+ add pushes a new xform with sensible defaults', () => {
    const { host, state, onChange } = mount(1);
    const before = state.genome.xforms.length;
    const addBtn = [...host.querySelectorAll('.pyr3-edit-xforms-header .pyr3-edit-icon-btn')].find(
      (b) => b.textContent === '+ add',
    ) as HTMLButtonElement;
    addBtn.click();
    expect(state.genome.xforms.length).toBe(before + 1);
    expect(cards(host).length).toBe(before + 1);
    const added = state.genome.xforms[before]!;
    expect(added.a).toBe(1);
    expect(added.e).toBe(1);
    expect(added.b).toBe(0);
    expect(added.weight).toBe(1);
    expect(added.variations.length).toBe(1);
    expect(added.variations[0]!.index).toBe(V.linear);
    expect(onChange).toHaveBeenCalledWith(`xforms.${before}.added`);
  });
});

describe('xformsSection — color / colorSpeed / opacity', () => {
  it('color slider writes genome.xforms[0].color + emits xforms.0.color', () => {
    const { host, state, onChange } = mount(1);
    const card0 = cards(host)[0]!;
    const slider = card0.querySelector('.pyr3-edit-slider') as HTMLInputElement;
    fireInput(slider, '0.25');
    expect(state.genome.xforms[0]!.color).toBeCloseTo(0.25, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.color');
  });

  it('colorSpeed number + opacity slider write their respective paths', () => {
    const { host, state, onChange } = mount(1);
    const card0 = cards(host)[0]!;
    // Body field order is: color slider, colorSpeed number, opacity slider,
    // then affine rows. Grab the colorSpeed number input directly.
    const body = card0.querySelector('.pyr3-edit-xform-body') as HTMLElement;
    const bodyNumberInputs = body.querySelectorAll('.pyr3-edit-num');
    // First body number input is colorSpeed.
    const colorSpeedInput = bodyNumberInputs[0] as HTMLInputElement;
    fireInput(colorSpeedInput, '0.31');
    expect(state.genome.xforms[0]!.colorSpeed).toBeCloseTo(0.31, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.colorSpeed');

    // Opacity is the SECOND slider in the body (first is color).
    const sliders = body.querySelectorAll('.pyr3-edit-slider');
    const opacitySlider = sliders[1] as HTMLInputElement;
    fireInput(opacitySlider, '0.7');
    expect(state.genome.xforms[0]!.opacity).toBeCloseTo(0.7, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.opacity');
  });
});

describe('xformsSection — affine pre-transform', () => {
  it('each of a/b/c/d/e/f writes the genome and emits the dotted path', () => {
    const { host, state, onChange } = mount(1);
    const card0 = cards(host)[0]!;
    const rows = card0.querySelectorAll('.pyr3-edit-affine-row');
    // First two affine rows are pre-transform (then 2 more for post).
    const preRow1 = rows[0]!; // a, b, c
    const preRow2 = rows[1]!; // d, e, f
    const inputs1 = preRow1.querySelectorAll('.pyr3-edit-num');
    const inputs2 = preRow2.querySelectorAll('.pyr3-edit-num');

    fireInput(inputs1[0] as HTMLInputElement, '1.5');
    expect(state.genome.xforms[0]!.a).toBeCloseTo(1.5, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.a');

    fireInput(inputs1[1] as HTMLInputElement, '-0.5');
    expect(state.genome.xforms[0]!.b).toBeCloseTo(-0.5, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.b');

    fireInput(inputs1[2] as HTMLInputElement, '0.25');
    expect(state.genome.xforms[0]!.c).toBeCloseTo(0.25, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.c');

    fireInput(inputs2[0] as HTMLInputElement, '0.9');
    expect(state.genome.xforms[0]!.d).toBeCloseTo(0.9, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.d');

    fireInput(inputs2[1] as HTMLInputElement, '-1.1');
    expect(state.genome.xforms[0]!.e).toBeCloseTo(-1.1, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.e');

    fireInput(inputs2[2] as HTMLInputElement, '0.05');
    expect(state.genome.xforms[0]!.f).toBeCloseTo(0.05, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.f');
  });
});

describe('xformsSection — post-transform toggle', () => {
  it('checking the post toggle initialises identity post + enables inputs', () => {
    const { host, state, onChange } = mount(1);
    const card0 = cards(host)[0]!;
    expect(state.genome.xforms[0]!.post).toBeUndefined();
    const postCheckbox = card0.querySelector('.pyr3-edit-checkbox') as HTMLInputElement;
    postCheckbox.checked = true;
    postCheckbox.dispatchEvent(new Event('change'));
    expect(state.genome.xforms[0]!.post).toEqual({
      a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
    });
    expect(onChange).toHaveBeenCalledWith('xforms.0.post');
    // Post inputs (rows 3 + 4) should be enabled now.
    const rows = card0.querySelectorAll('.pyr3-edit-affine-row');
    const postRow1Inputs = rows[2]!.querySelectorAll(
      '.pyr3-edit-num',
    ) as NodeListOf<HTMLInputElement>;
    expect(postRow1Inputs[0]!.disabled).toBe(false);
  });

  it('unchecking sets post = undefined + disables inputs', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.xforms[0]!.post = { a: 2, b: 0, c: 0, d: 0, e: 2, f: 0 };
    const { host, state, onChange } = mount(genome);
    const card0 = cards(host)[0]!;
    const postCheckbox = card0.querySelector('.pyr3-edit-checkbox') as HTMLInputElement;
    expect(postCheckbox.checked).toBe(true);
    postCheckbox.checked = false;
    postCheckbox.dispatchEvent(new Event('change'));
    expect(state.genome.xforms[0]!.post).toBeUndefined();
    expect(onChange).toHaveBeenCalledWith('xforms.0.post');
    const rows = card0.querySelectorAll('.pyr3-edit-affine-row');
    const postRow1Inputs = rows[2]!.querySelectorAll(
      '.pyr3-edit-num',
    ) as NodeListOf<HTMLInputElement>;
    expect(postRow1Inputs[0]!.disabled).toBe(true);
  });

  it('post-input edits write genome.xforms[i].post.<key>', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.xforms[0]!.post = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
    const { host, state, onChange } = mount(genome);
    const card0 = cards(host)[0]!;
    const rows = card0.querySelectorAll('.pyr3-edit-affine-row');
    const postRow1Inputs = rows[2]!.querySelectorAll(
      '.pyr3-edit-num',
    ) as NodeListOf<HTMLInputElement>;
    fireInput(postRow1Inputs[0]!, '3.25');
    expect(state.genome.xforms[0]!.post!.a).toBeCloseTo(3.25, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.post.a');
  });
});

describe('xformsSection — variations chain', () => {
  it('renders one variation row per existing variation', () => {
    const { host, state } = mount(1);
    const card0 = cards(host)[0]!;
    const varRows = card0.querySelectorAll('.pyr3-edit-var-row');
    expect(varRows.length).toBe(state.genome.xforms[0]!.variations.length);
  });

  it('variation weight write hits xforms.${i}.variations.${j}.weight', () => {
    const { host, state, onChange } = mount(1);
    const card0 = cards(host)[0]!;
    const row0 = card0.querySelector('.pyr3-edit-var-row') as HTMLElement;
    const weightInput = row0.querySelector(
      '.pyr3-edit-var-header .pyr3-edit-num',
    ) as HTMLInputElement;
    fireInput(weightInput, '0.77');
    expect(state.genome.xforms[0]!.variations[0]!.weight).toBeCloseTo(0.77, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.variations.0.weight');
  });

  it('linear kind has no params; julian kind shows power + dist labels', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.xforms[0]!.variations = [{ index: V.linear, weight: 1 }];
    const { host, state, onChange } = mount(genome);
    const card0 = cards(host)[0]!;
    const row0 = card0.querySelector('.pyr3-edit-var-row') as HTMLElement;
    let paramRow = row0.querySelector('.pyr3-edit-var-params') as HTMLElement;
    expect(paramRow.children.length).toBe(0);

    // Flip to julian.
    const select = row0.querySelector('.pyr3-edit-select') as HTMLSelectElement;
    select.value = String(V.julian);
    select.dispatchEvent(new Event('change'));
    expect(state.genome.xforms[0]!.variations[0]!.index).toBe(V.julian);
    expect(onChange).toHaveBeenCalledWith('xforms.0.variations.0.index');
    paramRow = row0.querySelector('.pyr3-edit-var-params') as HTMLElement;
    // julian has power + dist → 2 labeled fields.
    expect(paramRow.children.length).toBe(2);
    const labels = [...paramRow.querySelectorAll('.pyr3-edit-field-label')].map((e) =>
      (e.textContent ?? '').trim(),
    );
    expect(labels).toEqual(['power', 'dist']);
  });

  it('param edit writes xforms.${i}.variations.${j}.param0', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.xforms[0]!.variations = [{ index: V.julian, weight: 1, param0: 2, param1: 1 }];
    const { host, state, onChange } = mount(genome);
    const card0 = cards(host)[0]!;
    const row0 = card0.querySelector('.pyr3-edit-var-row') as HTMLElement;
    const paramInputs = row0.querySelectorAll(
      '.pyr3-edit-var-params .pyr3-edit-num',
    ) as NodeListOf<HTMLInputElement>;
    fireInput(paramInputs[0]!, '5');
    expect(state.genome.xforms[0]!.variations[0]!.param0).toBe(5);
    expect(onChange).toHaveBeenCalledWith('xforms.0.variations.0.param0');
    fireInput(paramInputs[1]!, '3');
    expect(state.genome.xforms[0]!.variations[0]!.param1).toBe(3);
    expect(onChange).toHaveBeenCalledWith('xforms.0.variations.0.param1');
  });
});

describe('xformsSection — xaos row', () => {
  it('renders one xaos input per xform when there are 2+ xforms', () => {
    const { host, state } = mount(1);
    const card0 = cards(host)[0]!;
    const xaosInputs = card0.querySelectorAll(
      '.pyr3-edit-xaos-row .pyr3-edit-num',
    ) as NodeListOf<HTMLInputElement>;
    expect(xaosInputs.length).toBe(state.genome.xforms.length);
  });

  it('xaos input write initialises xaos array (with 1s) + writes index k', () => {
    const { host, state, onChange } = mount(1);
    expect(state.genome.xforms[0]!.xaos).toBeUndefined();
    const card0 = cards(host)[0]!;
    const xaosInputs = card0.querySelectorAll(
      '.pyr3-edit-xaos-row .pyr3-edit-num',
    ) as NodeListOf<HTMLInputElement>;
    fireInput(xaosInputs[1]!, '0.5');
    expect(state.genome.xforms[0]!.xaos).toBeDefined();
    expect(state.genome.xforms[0]!.xaos![1]).toBeCloseTo(0.5, 6);
    expect(state.genome.xforms[0]!.xaos![0]).toBe(1); // pre-filled default
    expect(onChange).toHaveBeenCalledWith('xforms.0.xaos.1');
  });

  it('omits the xaos row when there is only one xform', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.xforms = [genome.xforms[0]!];
    const { host } = mount(genome);
    expect(host.querySelector('.pyr3-edit-xaos-row')).toBeNull();
  });
});

describe('xformsSection — per-xform collapse', () => {
  it('clicking the card header toggles xformCollapse[i]', () => {
    const { host, state } = mount(1);
    const card0 = cards(host)[0]!;
    const header = card0.querySelector('.pyr3-edit-xform-header') as HTMLElement;
    const body = card0.querySelector('.pyr3-edit-xform-body') as HTMLElement;
    const chev = card0.querySelector(
      '.pyr3-edit-xform-header .pyr3-edit-chev',
    ) as HTMLElement;

    expect(state.xformCollapse[0]).toBeUndefined();
    expect(chev.textContent).toBe('▼');
    expect(body.style.display).toBe('block');

    header.click();
    expect(state.xformCollapse[0]).toBe(true);
    expect(chev.textContent).toBe('▶');
    expect(body.style.display).toBe('none');

    header.click();
    expect(state.xformCollapse[0]).toBe(false);
    expect(chev.textContent).toBe('▼');
    expect(body.style.display).toBe('block');
  });
});
