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
  document.body.appendChild(host); // text-mode swap needs the host in document
  return { host, state, onChange };
}

// Drive a scrubby cell by double-clicking into text mode, typing, pressing Enter.
function typeInto(cell: HTMLElement, value: string): void {
  cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const inp = cell.querySelector('input') as HTMLInputElement;
  inp.value = value;
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

function activeCheckbox(host: HTMLElement): HTMLInputElement {
  // The first checkbox is always the section-level "active" toggle.
  return host.querySelector('input[type="checkbox"]') as HTMLInputElement;
}

function setupOn(): {
  host: HTMLDivElement;
  state: ReturnType<typeof createEditState>;
  onChange: ReturnType<typeof vi.fn>;
} {
  const env = setupOff();
  const check = activeCheckbox(env.host);
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
    const check = activeCheckbox(host);
    expect(check).not.toBeNull();
    expect(check.checked).toBe(false);
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
    const check = activeCheckbox(host);
    expect(check.checked).toBe(true);
  });
});

describe('finalSection — toggle behaviour', () => {
  it('toggling on initialises a default finalxform', () => {
    const { host, state, onChange } = setupOff();
    expect(state.genome.finalxform).toBeUndefined();

    const check = activeCheckbox(host);
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

    const check = activeCheckbox(host);
    check.checked = false;
    check.dispatchEvent(new Event('change'));

    expect(state.genome.finalxform).toBeUndefined();
    expect(onChange).toHaveBeenCalledWith('finalxform.active');
  });

  it('toggling off then on produces a fresh default (no stale prior state)', () => {
    const { host, state } = setupOn();
    state.genome.finalxform!.color = 0.9;
    const check = activeCheckbox(host);
    check.checked = false;
    check.dispatchEvent(new Event('change'));
    check.checked = true;
    check.dispatchEvent(new Event('change'));
    expect(state.genome.finalxform!.color).toBe(0.5);
  });
});

describe('finalSection — v2 affine block', () => {
  it('renders 5 decomposed fields + mini-viz canvas', () => {
    const { host } = setupOn();
    const card = host.querySelector('.pyr3-edit-final-card') as HTMLElement;
    expect(card.querySelector('.pyr3-edit-aff-scaleX')).toBeTruthy();
    expect(card.querySelector('.pyr3-edit-aff-scaleY')).toBeTruthy();
    expect(card.querySelector('.pyr3-edit-aff-rotation')).toBeTruthy();
    expect(card.querySelector('.pyr3-edit-aff-positionX')).toBeTruthy();
    expect(card.querySelector('.pyr3-edit-aff-positionY')).toBeTruthy();
    expect(card.querySelector('canvas.pyr3-edit-aff-viz')).toBeTruthy();
  });

  it('renders shear / raw-matrix fold-ups (shape-presets fold-up replaced by quick-ops strip in Task 8.3)', () => {
    const { host } = setupOn();
    const card = host.querySelector('.pyr3-edit-final-card') as HTMLElement;
    expect(card.querySelector('.pyr3-edit-aff-shear-fold')).toBeTruthy();
    expect(card.querySelector('.pyr3-edit-aff-raw-fold')).toBeTruthy();
  });

  it('editing rotation writes back to a/b/c/d/e/f via decomposedToRaw', () => {
    const { host, state, onChange } = setupOn();
    // Default finalxform is identity; rotating 90° should produce
    // a≈0, b≈-1, d≈1, e≈0.
    const card = host.querySelector('.pyr3-edit-final-card') as HTMLElement;
    const rotCell = card.querySelector('.pyr3-edit-aff-rotation .pyr3-edit-num') as HTMLElement;
    typeInto(rotCell, '90');
    const fx = state.genome.finalxform!;
    expect(fx.a).toBeCloseTo(0, 5);
    expect(fx.b).toBeCloseTo(-1, 5);
    expect(fx.d).toBeCloseTo(1, 5);
    expect(fx.e).toBeCloseTo(0, 5);
    expect(onChange).toHaveBeenCalledWith('finalxform.rotation');
  });

  it('raw-matrix fold-up edit writes a..f via finalxform.<key>', () => {
    const { host, state, onChange } = setupOn();
    const card = host.querySelector('.pyr3-edit-final-card') as HTMLElement;
    const rawFold = card.querySelector('.pyr3-edit-aff-raw-fold') as HTMLDetailsElement;
    rawFold.open = true;
    const aCell = card.querySelector('.pyr3-edit-aff-raw-a .pyr3-edit-num') as HTMLElement;
    typeInto(aCell, '1.5');
    expect(state.genome.finalxform!.a).toBeCloseTo(1.5, 5);
    expect(onChange).toHaveBeenCalledWith('finalxform.a');
  });

  it('shear fold-up auto-opens when finalxform has a non-zero shear', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    state.genome.finalxform = {
      a: 1, b: 0.5, c: 0, d: 0, e: 1, f: 0,
      weight: 1, color: 0.5, colorSpeed: 0.5, opacity: 1,
      variations: [{ index: V.linear, weight: 1 }],
    };
    finalSection.build(host, state, () => {});
    const card = host.querySelector('.pyr3-edit-final-card') as HTMLElement;
    const shearFold = card.querySelector('.pyr3-edit-aff-shear-fold') as HTMLDetailsElement;
    expect(shearFold.open).toBe(true);
  });
});

describe('finalSection — quick-ops strip + reset', () => {
  it('renders 7 quick-op buttons from QUICK_OPS_DEFS', () => {
    const { host } = setupOn();
    const card = host.querySelector('.pyr3-edit-final-card') as HTMLElement;
    const strip = card.querySelector('.pyr3-edit-aff-quickops') as HTMLElement;
    expect(strip).toBeTruthy();
    expect(strip.querySelectorAll('.pyr3-edit-quickop').length).toBe(7);
  });

  it('clicking rotate+45 mutates the finalxform affine', () => {
    const { host, state, onChange } = setupOn();
    const card = host.querySelector('.pyr3-edit-final-card') as HTMLElement;
    const rot45 = card.querySelector('.pyr3-edit-quickop[data-op="rotate+45"]') as HTMLElement;
    rot45.click();
    const k = Math.SQRT1_2;
    expect(state.genome.finalxform!.a).toBeCloseTo(k, 6);
    expect(onChange).toHaveBeenCalledWith('finalxform.quickop');
  });

  it('reset-to-identity is rendered with btn-accent and resets the affine', () => {
    const { host, state, onChange } = setupOn();
    const card = host.querySelector('.pyr3-edit-final-card') as HTMLElement;
    const fx = state.genome.finalxform!;
    fx.a = 2; fx.b = 0.3; fx.c = 0.42; fx.d = 0.1; fx.e = 1.7; fx.f = -0.7;
    const reset = card.querySelector('.pyr3-edit-aff-reset') as HTMLElement;
    expect(reset).toBeTruthy();
    expect(reset.classList.contains('pyr3-btn-accent')).toBe(true);
    reset.click();
    expect(fx.a).toBeCloseTo(1, 6);
    expect(fx.e).toBeCloseTo(1, 6);
    expect(fx.c).toBeCloseTo(0.42, 6);
    expect(fx.f).toBeCloseTo(-0.7, 6);
    expect(onChange).toHaveBeenCalledWith('finalxform.reset');
  });
});

describe('finalSection — color block', () => {
  it('color slider mutates finalxform.color', () => {
    const { host, state, onChange } = setupOn();
    const slider = host.querySelector('.pyr3-edit-color-slider') as HTMLInputElement;
    slider.value = '0.72';
    slider.dispatchEvent(new Event('input'));
    expect(state.genome.finalxform!.color).toBeCloseTo(0.72, 5);
    expect(onChange).toHaveBeenCalledWith('finalxform.color');
  });

  it('opacity slider mutates finalxform.opacity', () => {
    const { host, state, onChange } = setupOn();
    const slider = host.querySelector('.pyr3-edit-opacity-slider') as HTMLInputElement;
    slider.value = '0.4';
    slider.dispatchEvent(new Event('input'));
    expect(state.genome.finalxform!.opacity).toBeCloseTo(0.4, 5);
    expect(onChange).toHaveBeenCalledWith('finalxform.opacity');
  });

  it('colorSpeed scrubby mutates finalxform.colorSpeed', () => {
    const { host, state, onChange } = setupOn();
    const csCell = host.querySelector('.pyr3-edit-color-speed') as HTMLElement;
    typeInto(csCell, '0.7');
    expect(state.genome.finalxform!.colorSpeed).toBeCloseTo(0.7, 5);
    expect(onChange).toHaveBeenCalledWith('finalxform.colorSpeed');
  });
});

describe('finalSection — post-transform', () => {
  it('post toggle is unchecked when post is undefined; no post block mounted', () => {
    const { host, state } = setupOn();
    expect(state.genome.finalxform!.post).toBeUndefined();
    const card = host.querySelector('.pyr3-edit-final-card') as HTMLElement;
    const postToggle = card.querySelector('.pyr3-edit-post-toggle') as HTMLInputElement;
    expect(postToggle.checked).toBe(false);
    expect(card.querySelector('.pyr3-edit-aff-post')).toBeNull();
  });

  it('checking the post toggle instantiates identity post + mounts decomposed block', () => {
    const { host, state, onChange } = setupOn();
    const card = host.querySelector('.pyr3-edit-final-card') as HTMLElement;
    const postToggle = card.querySelector('.pyr3-edit-post-toggle') as HTMLInputElement;
    postToggle.checked = true;
    postToggle.dispatchEvent(new Event('change'));
    expect(state.genome.finalxform!.post).toEqual({ a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 });
    expect(onChange).toHaveBeenCalledWith('finalxform.post');
    expect(card.querySelector('.pyr3-edit-aff-post')).toBeTruthy();
  });

  it('unchecking the post toggle clears finalxform.post', () => {
    const { host, state, onChange } = setupOn();
    const card = host.querySelector('.pyr3-edit-final-card') as HTMLElement;
    const postToggle = card.querySelector('.pyr3-edit-post-toggle') as HTMLInputElement;
    postToggle.checked = true;
    postToggle.dispatchEvent(new Event('change'));
    postToggle.checked = false;
    postToggle.dispatchEvent(new Event('change'));
    expect(state.genome.finalxform!.post).toBeUndefined();
    expect(onChange).toHaveBeenCalledWith('finalxform.post');
  });

  it('post decomposed edit writes finalxform.post.<field>', () => {
    const { host, state, onChange } = setupOn();
    const card = host.querySelector('.pyr3-edit-final-card') as HTMLElement;
    const postToggle = card.querySelector('.pyr3-edit-post-toggle') as HTMLInputElement;
    postToggle.checked = true;
    postToggle.dispatchEvent(new Event('change'));
    const postBlock = card.querySelector('.pyr3-edit-aff-post') as HTMLElement;
    const rotCell = postBlock.querySelector('.pyr3-edit-aff-rotation .pyr3-edit-num') as HTMLElement;
    typeInto(rotCell, '90');
    const post = state.genome.finalxform!.post!;
    expect(post.a).toBeCloseTo(0, 5);
    expect(post.b).toBeCloseTo(-1, 5);
    expect(post.d).toBeCloseTo(1, 5);
    expect(post.e).toBeCloseTo(0, 5);
    expect(onChange).toHaveBeenCalledWith('finalxform.post.rotation');
  });
});

describe('finalSection — variations chain', () => {
  it('renders one variation row per existing variation', () => {
    const { host, state } = setupOn();
    const card = host.querySelector('.pyr3-edit-final-card') as HTMLElement;
    const rows = card.querySelectorAll('.pyr3-edit-var-row');
    expect(rows.length).toBe(state.genome.finalxform!.variations.length);
  });

  it('variation weight write hits finalxform.variations.0.weight', () => {
    const { host, state, onChange } = setupOn();
    const row = host.querySelector('.pyr3-edit-var-row') as HTMLElement;
    const weightCell = row.querySelector('.pyr3-edit-var-header .pyr3-edit-num') as HTMLElement;
    typeInto(weightCell, '0.42');
    expect(state.genome.finalxform!.variations[0]!.weight).toBeCloseTo(0.42, 5);
    expect(onChange).toHaveBeenCalledWith('finalxform.variations.0.weight');
  });

  it('variation kind picker button shows the current variation name', () => {
    const { host } = setupOn();
    const btn = host.querySelector('.pyr3-edit-var-kind-btn') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe(VARIATION_NAMES[V.linear]);
  });

  it('julian kind shows power + dist param labels', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    state.genome.finalxform = {
      a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
      weight: 1, color: 0.5, colorSpeed: 0.5, opacity: 1,
      variations: [{ index: V.julian, weight: 1, param0: 2, param1: 1 }],
    };
    finalSection.build(host, state, () => {});
    const card = host.querySelector('.pyr3-edit-final-card') as HTMLElement;
    const paramRow = card.querySelector('.pyr3-edit-var-params') as HTMLElement;
    expect(paramRow.children.length).toBe(2);
    const labels = [...paramRow.querySelectorAll('.pyr3-edit-field-label')].map((e) =>
      (e.textContent ?? '').trim(),
    );
    expect(labels).toEqual(['power', 'dist']);
  });

  it('param edit writes finalxform.variations.0.param0', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    state.genome.finalxform = {
      a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
      weight: 1, color: 0.5, colorSpeed: 0.5, opacity: 1,
      variations: [{ index: V.julian, weight: 1, param0: 2, param1: 1 }],
    };
    const onChange = vi.fn();
    finalSection.build(host, state, onChange);
    document.body.appendChild(host);
    const card = host.querySelector('.pyr3-edit-final-card') as HTMLElement;
    const paramCells = card.querySelectorAll('.pyr3-edit-var-params .pyr3-edit-num') as NodeListOf<HTMLElement>;
    typeInto(paramCells[0]!, '5');
    expect(state.genome.finalxform!.variations[0]!.param0).toBe(5);
    expect(onChange).toHaveBeenCalledWith('finalxform.variations.0.param0');
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
