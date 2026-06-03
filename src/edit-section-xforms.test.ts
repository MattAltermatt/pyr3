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
      '.pyr3-edit-xform-header .pyr3-edit-xform-del',
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
      '.pyr3-edit-xform-header .pyr3-edit-xform-del',
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
    // Body section order (v2): affine → variations → post → color → xaos.
    // Target the color/opacity controls by their stable classes rather than
    // by index, so future reorders don't break this test.
    const colorSpeedInput = card0.querySelector('.pyr3-edit-color-speed') as HTMLInputElement;
    fireInput(colorSpeedInput, '0.31');
    expect(state.genome.xforms[0]!.colorSpeed).toBeCloseTo(0.31, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.colorSpeed');

    const opacitySlider = card0.querySelector('.pyr3-edit-opacity-slider') as HTMLInputElement;
    fireInput(opacitySlider, '0.7');
    expect(state.genome.xforms[0]!.opacity).toBeCloseTo(0.7, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.opacity');
  });
});

describe('xforms section v2 — affine block', () => {
  it('renders 5 decomposed fields (scale x/y, rotation, position x/y)', () => {
    const { host } = mount(1);
    const card = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    expect(card.querySelector('.pyr3-edit-aff-scaleX')).toBeTruthy();
    expect(card.querySelector('.pyr3-edit-aff-scaleY')).toBeTruthy();
    expect(card.querySelector('.pyr3-edit-aff-rotation')).toBeTruthy();
    expect(card.querySelector('.pyr3-edit-aff-positionX')).toBeTruthy();
    expect(card.querySelector('.pyr3-edit-aff-positionY')).toBeTruthy();
  });

  it('renders a mini affine viz canvas in each expanded card', () => {
    const { host } = mount(1);
    const card = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    expect(card.querySelector('canvas.pyr3-edit-aff-viz')).toBeTruthy();
  });

  it('renders shape-presets / shear / raw-matrix fold-ups', () => {
    const { host } = mount(1);
    const card = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    expect(card.querySelector('.pyr3-edit-aff-presets')).toBeTruthy();
    expect(card.querySelector('.pyr3-edit-aff-shear-fold')).toBeTruthy();
    expect(card.querySelector('.pyr3-edit-aff-raw-fold')).toBeTruthy();
  });

  it('editing rotation writes back to a/b/c/d/e/f via decomposedToRaw', () => {
    const genome = generateRandomGenome(seededRng(1));
    const xf = genome.xforms[0]!;
    xf.a = 1; xf.b = 0; xf.c = 0; xf.d = 0; xf.e = 1; xf.f = 0;
    const { host, state, onChange } = mount(genome);
    const card = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    const rotInput = card.querySelector('.pyr3-edit-aff-rotation input') as HTMLInputElement;
    rotInput.value = '90';
    rotInput.dispatchEvent(new Event('input'));
    const out = state.genome.xforms[0]!;
    expect(out.a).toBeCloseTo(0, 6);
    expect(out.b).toBeCloseTo(-1, 6);
    expect(out.d).toBeCloseTo(1, 6);
    expect(out.e).toBeCloseTo(0, 6);
    expect(onChange).toHaveBeenCalled();
  });

  it('preset click overwrites the 5 decomposed fields', () => {
    const { host, state } = mount(1);
    const card = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    const presetsDet = card.querySelector(
      '.pyr3-edit-aff-presets details',
    ) as HTMLDetailsElement;
    presetsDet.open = true;
    const flipY = card.querySelector(
      '.pyr3-edit-preset[data-preset="flip-y"]',
    ) as HTMLButtonElement;
    flipY.click();
    const xf = state.genome.xforms[0]!;
    expect(xf.e).toBeCloseTo(-1, 6);
    expect(xf.a).toBeCloseTo(1, 6);
  });

  it('shear fold-up auto-opens when the genome contains a non-zero shear matrix', () => {
    const genome = generateRandomGenome(seededRng(1));
    // Build a shear-y matrix: a=1, b=0.5, d=0, e=1 → shear = 0.5
    genome.xforms[0]!.a = 1;
    genome.xforms[0]!.b = 0.5;
    genome.xforms[0]!.d = 0;
    genome.xforms[0]!.e = 1;
    const { host } = mount(genome);
    const card = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    const shearFold = card.querySelector(
      '.pyr3-edit-aff-shear-fold',
    ) as HTMLDetailsElement;
    expect(shearFold.open).toBe(true);
  });

  it('raw-matrix fold-up edit writes a/b/c/d/e/f', () => {
    const { host, state, onChange } = mount(1);
    const card = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    const rawFold = card.querySelector(
      '.pyr3-edit-aff-raw-fold',
    ) as HTMLDetailsElement;
    rawFold.open = true;
    const aInput = card.querySelector(
      '.pyr3-edit-aff-raw-a input',
    ) as HTMLInputElement;
    aInput.value = '1.5';
    aInput.dispatchEvent(new Event('input'));
    expect(state.genome.xforms[0]!.a).toBeCloseTo(1.5, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.a');
  });
});

describe('xforms section v2 — post-transform', () => {
  it('post checkbox is unchecked when xform.post is undefined; no decomposed block', () => {
    const { host, state } = mount(1);
    expect(state.genome.xforms[0]!.post).toBeUndefined();
    const card = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    const postToggle = card.querySelector('.pyr3-edit-post-toggle') as HTMLInputElement;
    expect(postToggle.checked).toBe(false);
    // No post decomposed block mounted yet.
    expect(card.querySelector('.pyr3-edit-aff-post')).toBeNull();
  });

  it('checking the post toggle instantiates identity post + mounts decomposed block', () => {
    const { host, state, onChange } = mount(1);
    const card = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    const postToggle = card.querySelector('.pyr3-edit-post-toggle') as HTMLInputElement;
    postToggle.checked = true;
    postToggle.dispatchEvent(new Event('change'));
    expect(state.genome.xforms[0]!.post).toEqual({
      a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
    });
    expect(onChange).toHaveBeenCalledWith('xforms.0.post');
    expect(card.querySelector('.pyr3-edit-aff-post')).toBeTruthy();
  });

  it('unchecking the post toggle clears xform.post + removes decomposed block', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.xforms[0]!.post = { a: 2, b: 0, c: 0, d: 0, e: 2, f: 0 };
    const { host, state, onChange } = mount(genome);
    const card = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    const postToggle = card.querySelector('.pyr3-edit-post-toggle') as HTMLInputElement;
    expect(postToggle.checked).toBe(true);
    expect(card.querySelector('.pyr3-edit-aff-post')).toBeTruthy();
    postToggle.checked = false;
    postToggle.dispatchEvent(new Event('change'));
    expect(state.genome.xforms[0]!.post).toBeUndefined();
    expect(onChange).toHaveBeenCalledWith('xforms.0.post');
    expect(card.querySelector('.pyr3-edit-aff-post')).toBeNull();
  });

  it('post decomposed edit writes xforms.${i}.post.<field>', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.xforms[0]!.post = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
    const { host, state, onChange } = mount(genome);
    const card = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    const postBlock = card.querySelector('.pyr3-edit-aff-post') as HTMLElement;
    const rotInput = postBlock.querySelector(
      '.pyr3-edit-aff-rotation input',
    ) as HTMLInputElement;
    rotInput.value = '90';
    rotInput.dispatchEvent(new Event('input'));
    // 90° rotation on identity → a≈0, b≈-1, d≈1, e≈0
    const post = state.genome.xforms[0]!.post!;
    expect(post.a).toBeCloseTo(0, 6);
    expect(post.b).toBeCloseTo(-1, 6);
    expect(post.d).toBeCloseTo(1, 6);
    expect(post.e).toBeCloseTo(0, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.post.rotation');
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
    // linear → no params
    const g1 = generateRandomGenome(seededRng(1));
    g1.xforms[0]!.variations = [{ index: V.linear, weight: 1 }];
    const { host: host1 } = mount(g1);
    const row1 = cards(host1)[0]!.querySelector('.pyr3-edit-var-row') as HTMLElement;
    const paramRow1 = row1.querySelector('.pyr3-edit-var-params') as HTMLElement;
    expect(paramRow1.children.length).toBe(0);

    // julian → power + dist labels (kind initialised via genome rather than
    // the picker; the picker UI is exercised by edit-variation-picker.test.ts).
    const g2 = generateRandomGenome(seededRng(1));
    g2.xforms[0]!.variations = [{ index: V.julian, weight: 1 }];
    const { host: host2 } = mount(g2);
    const row2 = cards(host2)[0]!.querySelector('.pyr3-edit-var-row') as HTMLElement;
    const paramRow2 = row2.querySelector('.pyr3-edit-var-params') as HTMLElement;
    expect(paramRow2.children.length).toBe(2);
    const labels = [...paramRow2.querySelectorAll('.pyr3-edit-field-label')].map((e) =>
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

describe('xforms section v2 — variation rows', () => {
  it('replaces kind <select> with a picker-trigger button', () => {
    const { host } = mount();
    const card = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    // Old <select> should be gone.
    expect(card.querySelector('.pyr3-edit-var-row select')).toBeNull();
    // New picker-trigger button present.
    expect(card.querySelector('.pyr3-edit-var-kind-btn')).toBeTruthy();
  });

  it('per-row active checkbox toggles variation.active', () => {
    const { host, state, onChange } = mount();
    const card = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    const cbx = card.querySelector('.pyr3-edit-var-active') as HTMLInputElement;
    expect(cbx.checked).toBe(true);
    cbx.click();
    expect(state.genome.xforms[0]!.variations[0]!.active).toBe(false);
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('variations.0.active'));
  });

  it('+ var button opens the variation picker (no auto-insert)', () => {
    const { host, state } = mount();
    const originalLen = state.genome.xforms[0]!.variations.length;
    const card = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    const addBtn = card.querySelector('.pyr3-edit-var-add') as HTMLButtonElement;
    addBtn.click();
    // Picker mounted, but no new variation appended yet.
    expect(document.querySelector('.pyr3-var-picker')).toBeTruthy();
    expect(state.genome.xforms[0]!.variations.length).toBe(originalLen);
  });
});

describe('xforms section v2 — header active + solo', () => {
  it('renders an active checkbox in the card header', () => {
    const { host } = mount();
    const card = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    expect(card.querySelector('.pyr3-edit-xform-active')).toBeTruthy();
  });

  it('plain click toggles xform.active', () => {
    const { host, state } = mount();
    const card = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    const cbx = card.querySelector('.pyr3-edit-xform-active') as HTMLInputElement;
    cbx.click();
    expect(state.genome.xforms[0]!.active).toBe(false);
  });

  it('shift-click activates solo: all others go inactive', () => {
    const { host, state } = mount();
    expect(state.genome.xforms.length).toBeGreaterThanOrEqual(3);
    const firstCard = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    const cbx = firstCard.querySelector('.pyr3-edit-xform-active') as HTMLInputElement;
    cbx.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    for (let i = 1; i < state.genome.xforms.length; i++) {
      expect(state.genome.xforms[i]!.active).toBe(false);
    }
    expect(state.genome.xforms[0]!.active).not.toBe(false);
    expect(state.soloXformSnapshot).toBeTruthy();
  });

  it('shift-click same checkbox again restores the snapshot', () => {
    const { host, state } = mount();
    const card = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    const cbx = card.querySelector('.pyr3-edit-xform-active') as HTMLInputElement;
    cbx.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    // After rebuild, query the (new) checkbox.
    const card2 = host.querySelector('.pyr3-edit-xform-card') as HTMLElement;
    const cbx2 = card2.querySelector('.pyr3-edit-xform-active') as HTMLInputElement;
    cbx2.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    for (const xf of state.genome.xforms.slice(1)) {
      expect(xf.active).not.toBe(false);
    }
    expect(state.soloXformSnapshot).toBeUndefined();
  });
});
