// @vitest-environment happy-dom
//
// Unit smoke for the XForm-lens section (#350/#335). The v2 single-selection
// model replaced the v1 card-stack: a dropdown + action bar pick ONE xform and
// its detail fills the pane below; the final xform folds in as a second
// always-present selector row sharing that detail pane. We mount into a
// detached host and drive DOM events to verify selection, the action bar
// (add/remove/duplicate/reorder/active), the final row, and the detail content.
// Pure-genome op correctness (swap+xaos invariance, etc.) lives in
// xform-ops.test.ts; the slow-lane re-iterate wiring lives in edit-state.test.ts.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { xformsSection } from './edit-section-xforms';
import { createEditState } from './edit-state';
import { generateRandomGenome } from './edit-seed';
import { V } from './variations';
import { type EditState } from './edit-state';
import { type Genome } from './genome';
import { PYRE_PALETTE } from './palette';

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
  document.body.appendChild(host); // text-mode swap needs the host in document
  return { host, state, onChange };
}

const detail = (host: HTMLElement): HTMLElement =>
  host.querySelector('.pyr3-edit-xform-detail') as HTMLElement;
const select = (host: HTMLElement): HTMLSelectElement =>
  host.querySelector('.pyr3-edit-xform-select') as HTMLSelectElement;
const barButtons = (host: HTMLElement): HTMLButtonElement[] =>
  [...host.querySelectorAll('.pyr3-edit-xform-bar .pyr3-edit-bar-btn')] as HTMLButtonElement[];
const barButton = (host: HTMLElement, glyph: string): HTMLButtonElement =>
  barButtons(host).find((b) => b.textContent === glyph)!;

function fireChange(el: HTMLSelectElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('change'));
}

// Drive a scrubby cell by double-clicking into text mode, typing, pressing Enter.
function typeInto(cell: HTMLElement, value: string): void {
  cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const inp = cell.querySelector('input') as HTMLInputElement;
  inp.value = value;
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

function genomeWithVar(v: Record<string, number>): Genome {
  return {
    name: 'k',
    xforms: [{ a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, weight: 1, color: 0, colorSpeed: 0.5,
      variations: [v as unknown as Genome['xforms'][number]['variations'][number]] }],
    scale: 100, cx: 0, cy: 0, palette: PYRE_PALETTE,
  };
}

const pslot = (v: Record<string, number | undefined>, pk: string) => v[pk];

// ── SectionMount contract ────────────────────────────────────────────────────

describe('xformsSection — contract', () => {
  it('exposes the canonical SectionMount contract on the xform lens', () => {
    expect(xformsSection.key).toBe('xforms');
    expect(xformsSection.lens).toBe('xform');
    expect(xformsSection.title).toBe('🧬 XFORMS');
    expect(typeof xformsSection.build).toBe('function');
  });
});

// ── Selector dropdown ────────────────────────────────────────────────────────

describe('xformsSection — regular selector', () => {
  it('dropdown lists one option per regular xform', () => {
    const { host, state } = mount(1);
    const opts = [...select(host).options];
    expect(opts.length).toBe(state.genome.xforms.length);
    expect(opts[0]!.textContent).toBe(`xform 1 · of ${state.genome.xforms.length}`);
  });

  it('dropdown value reflects selectedXformIndex (default 0)', () => {
    const { host, state } = mount(1);
    expect(state.selectedXformIndex).toBe(0);
    expect(select(host).value).toBe('0');
  });

  it('selecting a different option updates selectedXformIndex + re-renders the detail', () => {
    const { host, state } = mount(1);
    fireChange(select(host), '1');
    expect(state.selectedXformIndex).toBe(1);
    expect(detail(host).querySelector('.pyr3-edit-detail-header')!.textContent).toBe('Editing xform 2');
  });

  it('the selected regular selector carries the orange selection ring', () => {
    const { host } = mount(1);
    const wrap = host.querySelector('.pyr3-edit-select-wrap') as HTMLElement;
    expect(wrap.classList.contains('pyr3-edit-selected')).toBe(true);
  });
});

// ── Action bar: add / remove / duplicate ─────────────────────────────────────

describe('xformsSection — action bar add/remove/duplicate', () => {
  it('＋ appends a new xform with linear defaults + selects it', () => {
    const { host, state, onChange } = mount(1);
    const before = state.genome.xforms.length;
    barButton(host, '＋').click();
    expect(state.genome.xforms.length).toBe(before + 1);
    expect(state.selectedXformIndex).toBe(before);
    const added = state.genome.xforms[before]!;
    expect(added.a).toBe(1);
    expect(added.e).toBe(1);
    expect(added.weight).toBe(1);
    expect(added.variations[0]!.index).toBe(V.linear);
    expect(onChange).toHaveBeenCalledWith('xforms.add');
  });

  it('🗑 removes the selected xform + emits xforms.remove', () => {
    const { host, state, onChange } = mount(1);
    const before = state.genome.xforms.length;
    expect(before).toBeGreaterThan(1);
    fireChange(select(host), '1');
    barButton(host, '🗑').click();
    expect(state.genome.xforms.length).toBe(before - 1);
    expect(onChange).toHaveBeenCalledWith('xforms.remove');
  });

  it('🗑 is disabled when only one xform remains', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.xforms = [genome.xforms[0]!];
    const { host } = mount(genome);
    expect(barButton(host, '🗑').disabled).toBe(true);
  });

  it('⧉ duplicates the selected xform + selects the copy', () => {
    const { host, state, onChange } = mount(1);
    const before = state.genome.xforms.length;
    state.genome.xforms[0]!.weight = 0.42;
    // re-render to pick up the weight (selection still 0)
    barButton(host, '⧉').click();
    expect(state.genome.xforms.length).toBe(before + 1);
    expect(state.selectedXformIndex).toBe(1);
    expect(state.genome.xforms[1]!.weight).toBe(0.42);
    expect(onChange).toHaveBeenCalledWith('xforms.duplicate');
  });
});

// ── Action bar: reorder (swap + xaos, #335) ──────────────────────────────────

describe('xformsSection — reorder ↑↓', () => {
  it('↑ swaps the selected xform with its predecessor + follows the selection', () => {
    const { host, state, onChange } = mount(1);
    state.genome.xforms[0]!.weight = 0.11;
    state.genome.xforms[1]!.weight = 0.88;
    fireChange(select(host), '1');
    barButton(host, '↑').click();
    expect(state.genome.xforms[0]!.weight).toBe(0.88);
    expect(state.genome.xforms[1]!.weight).toBe(0.11);
    expect(state.selectedXformIndex).toBe(0);
    expect(onChange).toHaveBeenCalledWith('xforms.reorder');
  });

  it('↑ is disabled for the first xform; ↓ for the last', () => {
    const { host, state } = mount(1);
    const n = state.genome.xforms.length;
    // selected = 0 → ↑ disabled, ↓ enabled
    expect(barButton(host, '↑').disabled).toBe(true);
    expect(barButton(host, '↓').disabled).toBe(false);
    fireChange(select(host), String(n - 1));
    expect(barButton(host, '↑').disabled).toBe(false);
    expect(barButton(host, '↓').disabled).toBe(true);
  });
});

// ── Action bar: active power + solo ──────────────────────────────────────────

describe('xformsSection — power toggle + solo', () => {
  it('plain click on the power button inactivates the selected xform', () => {
    const { host, state, onChange } = mount(1);
    const power = host.querySelector('.pyr3-edit-xform-active') as HTMLElement;
    expect(power.classList.contains('pyr3-edit-power')).toBe(true);
    power.click();
    expect(state.genome.xforms[0]!.active).toBe(false);
    expect(onChange).toHaveBeenCalledWith('xforms.0.active');
  });

  it('shift-click on the power button solos: all others inactive', () => {
    const { host, state } = mount(1);
    expect(state.genome.xforms.length).toBeGreaterThanOrEqual(3);
    const power = host.querySelector('.pyr3-edit-xform-active') as HTMLElement;
    power.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    for (let i = 1; i < state.genome.xforms.length; i++) {
      expect(state.genome.xforms[i]!.active).toBe(false);
    }
    expect(state.genome.xforms[0]!.active).not.toBe(false);
    expect(state.soloXformSnapshot).toBeTruthy();
  });

  it('shift-click the soloed power again restores the snapshot', () => {
    const { host, state } = mount(1);
    const power1 = host.querySelector('.pyr3-edit-xform-active') as HTMLElement;
    power1.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    const power2 = host.querySelector('.pyr3-edit-xform-active') as HTMLElement;
    power2.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
    for (const xf of state.genome.xforms.slice(1)) {
      expect(xf.active).not.toBe(false);
    }
    expect(state.soloXformSnapshot).toBeUndefined();
  });
});

// ── Final xform selector ─────────────────────────────────────────────────────

describe('xformsSection — final selector', () => {
  it('final row is always present (even with no finalxform)', () => {
    const { host, state } = mount(1);
    expect(state.genome.finalxform).toBeUndefined();
    const row = host.querySelector('.pyr3-edit-final-row') as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.querySelector('.pyr3-edit-final-label')!.textContent).toBe('✨ final');
    expect(row.querySelector('.pyr3-edit-final-tag')!.textContent).toBe('(none)');
  });

  it('final ⏻ creates an identity finalxform + selects it', () => {
    const { host, state, onChange } = mount(1);
    const finalPower = host.querySelector('.pyr3-edit-final-active') as HTMLElement;
    finalPower.click();
    expect(state.genome.finalxform).toBeDefined();
    expect(state.genome.finalxform!.a).toBe(1);
    expect(state.selectedXformIndex).toBe(-1);
    expect(onChange).toHaveBeenCalledWith('finalxform.active');
  });

  it('selecting final shows its detail with NO weight + NO xaos', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.finalxform = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, weight: 1, color: 0.5, colorSpeed: 0.5, variations: [{ index: V.linear, weight: 1 }] };
    const { host, state } = mount(genome);
    (host.querySelector('.pyr3-edit-final-row') as HTMLElement).click();
    expect(state.selectedXformIndex).toBe(-1);
    expect(detail(host).querySelector('.pyr3-edit-detail-header')!.textContent).toBe('Editing final xform');
    expect(detail(host).querySelector('.pyr3-edit-xform-weight')).toBeNull();
    expect(detail(host).querySelector('.pyr3-edit-xaos-row')).toBeNull();
    // ...but it DOES carry an affine + color block.
    expect(detail(host).querySelector('.pyr3-edit-aff-scaleX')).toBeTruthy();
    expect(detail(host).querySelector('.pyr3-edit-color-slider')).toBeTruthy();
  });

  it('#374: while FINAL is selected the regular dropdown shows a placeholder, so re-picking the displayed xform fires a real change', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.finalxform = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, weight: 1, color: 0.5, colorSpeed: 0.5, variations: [{ index: V.linear, weight: 1 }] };
    const { host, state } = mount(genome);
    (host.querySelector('.pyr3-edit-final-row') as HTMLElement).click();
    expect(state.selectedXformIndex).toBe(-1);
    const sel = select(host);
    // The native <select> no-ops when the picked value equals the shown value;
    // with FINAL active it must NOT claim a regular index, else re-picking the
    // would-be-shown xform 1 fires nothing. A leading placeholder owns the
    // selection instead — one extra option, value '', and it's the shown value.
    expect(sel.value).toBe('');
    expect(sel.options.length).toBe(state.genome.xforms.length + 1);
    expect(sel.options[0]!.value).toBe('');
    // The regular selector wrap loses its orange ring while FINAL owns selection.
    expect((host.querySelector('.pyr3-edit-select-wrap') as HTMLElement).classList.contains('pyr3-edit-selected')).toBe(false);
    // Picking xform 1 (index 0) is now a genuine value change → it switches.
    fireChange(sel, '0');
    expect(state.selectedXformIndex).toBe(0);
  });

  it('#374: picking the placeholder option itself is a no-op (stays on FINAL)', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.finalxform = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, weight: 1, color: 0.5, colorSpeed: 0.5, variations: [{ index: V.linear, weight: 1 }] };
    const { host, state } = mount(genome);
    (host.querySelector('.pyr3-edit-final-row') as HTMLElement).click();
    fireChange(select(host), '');
    expect(state.selectedXformIndex).toBe(-1);
  });

  it('final 🗑 clears the finalxform + falls selection back to xform 0', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.finalxform = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, weight: 1, color: 0.5, colorSpeed: 0.5, variations: [{ index: V.linear, weight: 1 }] };
    const { host, state, onChange } = mount(genome);
    (host.querySelector('.pyr3-edit-final-row') as HTMLElement).click();
    expect(state.selectedXformIndex).toBe(-1);
    // The final bar's 🗑 is the trash button inside the SECOND xform bar.
    const finalBar = host.querySelectorAll('.pyr3-edit-xform-bar')[1] as HTMLElement;
    const clearBtn = [...finalBar.querySelectorAll('.pyr3-edit-bar-btn')].find((b) => b.textContent === '🗑') as HTMLButtonElement;
    clearBtn.click();
    expect(state.genome.finalxform).toBeUndefined();
    expect(state.selectedXformIndex).toBe(0);
    expect(onChange).toHaveBeenCalledWith('finalxform.clear');
  });
});

// ── Detail pane: weight ──────────────────────────────────────────────────────

describe('xformsSection — detail weight', () => {
  it('weight scrubby updates genome + emits xforms.${i}.weight', () => {
    const { host, state, onChange } = mount(1);
    const weightCell = detail(host).querySelector('.pyr3-edit-xform-weight') as HTMLElement;
    typeInto(weightCell, '0.42');
    expect(state.genome.xforms[0]!.weight).toBeCloseTo(0.42, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.weight');
  });
});

// ── Detail pane: affine block ────────────────────────────────────────────────

describe('xformsSection — detail affine block', () => {
  it('renders 5 decomposed fields + mini viz + shear/raw folds', () => {
    const { host } = mount(1);
    const d = detail(host);
    expect(d.querySelector('.pyr3-edit-aff-scaleX')).toBeTruthy();
    expect(d.querySelector('.pyr3-edit-aff-scaleY')).toBeTruthy();
    expect(d.querySelector('.pyr3-edit-aff-rotation')).toBeTruthy();
    expect(d.querySelector('.pyr3-edit-aff-positionX')).toBeTruthy();
    expect(d.querySelector('.pyr3-edit-aff-positionY')).toBeTruthy();
    expect(d.querySelector('canvas.pyr3-edit-aff-viz')).toBeTruthy();
    expect(d.querySelector('.pyr3-edit-aff-shear-fold')).toBeTruthy();
    expect(d.querySelector('.pyr3-edit-aff-raw-fold')).toBeTruthy();
  });

  it('shear + raw-matrix folds use the shared orange accent-bar expander', () => {
    // Task 2 / decision Q1: the two hand-built folds now route through
    // buildExpander, so they carry the uniform `.pyr3-aff-expander` chrome.
    const d = detail(mount(1).host);
    const expanders = [...d.querySelectorAll('details.pyr3-aff-expander')];
    const summaries = expanders.map((e) =>
      (e.querySelector('summary')?.textContent ?? '').toLowerCase(),
    );
    expect(summaries.some((t) => t.includes('shear'))).toBe(true);
    expect(summaries.some((t) => t.includes('raw matrix'))).toBe(true);
  });

  it('editing rotation writes back to a/b/c/d/e/f via decomposedToRaw', () => {
    const genome = generateRandomGenome(seededRng(1));
    const xf = genome.xforms[0]!;
    xf.a = 1; xf.b = 0; xf.c = 0; xf.d = 0; xf.e = 1; xf.f = 0;
    const { host, state, onChange } = mount(genome);
    const rotCell = detail(host).querySelector('.pyr3-edit-aff-rotation .pyr3-edit-num') as HTMLElement;
    typeInto(rotCell, '90');
    const out = state.genome.xforms[0]!;
    expect(out.a).toBeCloseTo(0, 6);
    expect(out.b).toBeCloseTo(-1, 6);
    expect(out.d).toBeCloseTo(1, 6);
    expect(out.e).toBeCloseTo(0, 6);
    expect(onChange).toHaveBeenCalled();
  });

  it('shear fold auto-opens when the genome carries a non-zero shear', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.xforms[0]!.a = 1;
    genome.xforms[0]!.b = 0.5;
    genome.xforms[0]!.d = 0;
    genome.xforms[0]!.e = 1;
    const { host } = mount(genome);
    const shearFold = detail(host).querySelector('.pyr3-edit-aff-shear-fold') as HTMLDetailsElement;
    expect(shearFold.open).toBe(true);
  });

  it('raw-matrix fold edit writes a/b/c/d/e/f', () => {
    const { host, state, onChange } = mount(1);
    const rawFold = detail(host).querySelector('.pyr3-edit-aff-raw-fold') as HTMLDetailsElement;
    rawFold.open = true;
    const aCell = detail(host).querySelector('.pyr3-edit-aff-raw-a .pyr3-edit-num') as HTMLElement;
    typeInto(aCell, '1.5');
    expect(state.genome.xforms[0]!.a).toBeCloseTo(1.5, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.a');
  });
});

// ── Detail pane: quick-ops strip ─────────────────────────────────────────────

describe('xformsSection — detail quick-ops', () => {
  it('renders 7 quick-op buttons from QUICK_OPS_DEFS, in order', () => {
    const { host } = mount(1);
    const strip = detail(host).querySelector('.pyr3-edit-aff-quickops') as HTMLElement;
    expect(strip).toBeTruthy();
    const ids = [...strip.querySelectorAll('.pyr3-edit-quickop')].map((b) => (b as HTMLElement).dataset['op']);
    expect(ids).toEqual(['rotate+45', 'rotate-45', 'scale2x', 'scaleHalf', 'flipY', 'flipX', 'shear+0.1']);
  });

  it('rotate+45 increments the matrix + persists xforms.0.quickop', () => {
    const { host, state, onChange } = mount(1);
    const xf = state.genome.xforms[0]!;
    xf.a = 1; xf.b = 0; xf.c = 0; xf.d = 0; xf.e = 1; xf.f = 0;
    const rot45 = detail(host).querySelector('.pyr3-edit-quickop[data-op="rotate+45"]') as HTMLElement;
    rot45.click();
    const k = Math.SQRT1_2;
    expect(xf.a).toBeCloseTo(k, 6);
    expect(xf.b).toBeCloseTo(-k, 6);
    expect(xf.d).toBeCloseTo(k, 6);
    expect(xf.e).toBeCloseTo(k, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.quickop');
  });

  it('reset-to-identity uses btn-accent + writes identity preserving position', () => {
    const { host, state, onChange } = mount(1);
    const xf = state.genome.xforms[0]!;
    xf.a = 2; xf.b = 0.3; xf.c = 0.42; xf.d = 0.1; xf.e = 1.7; xf.f = -0.7;
    const reset = detail(host).querySelector('.pyr3-edit-aff-reset') as HTMLElement;
    expect(reset.classList.contains('pyr3-btn-accent')).toBe(true);
    reset.click();
    expect(xf.a).toBeCloseTo(1, 6);
    expect(xf.b).toBeCloseTo(0, 6);
    expect(xf.c).toBeCloseTo(0.42, 6);
    expect(xf.f).toBeCloseTo(-0.7, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.reset');
  });
});

// ── Detail pane: post-transform ──────────────────────────────────────────────

describe('xformsSection — detail post-transform', () => {
  it('post toggle starts off; no decomposed post block', () => {
    const { host, state } = mount(1);
    expect(state.genome.xforms[0]!.post).toBeUndefined();
    const postToggle = detail(host).querySelector('.pyr3-edit-post-toggle') as HTMLElement;
    expect(postToggle.classList.contains('pyr3-toggle')).toBe(true);
    expect(postToggle.classList.contains('on')).toBe(false);
    expect(detail(host).querySelector('.pyr3-edit-aff-post')).toBeNull();
  });

  it('clicking the post toggle instantiates identity post + mounts the block', () => {
    const { host, state, onChange } = mount(1);
    const postToggle = detail(host).querySelector('.pyr3-edit-post-toggle') as HTMLElement;
    postToggle.click();
    expect(state.genome.xforms[0]!.post).toEqual({ a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 });
    expect(onChange).toHaveBeenCalledWith('xforms.0.post');
    expect(detail(host).querySelector('.pyr3-edit-aff-post')).toBeTruthy();
  });

  it('post decomposed edit writes xforms.${i}.post.<field>', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.xforms[0]!.post = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
    const { host, state, onChange } = mount(genome);
    const postBlock = detail(host).querySelector('.pyr3-edit-aff-post') as HTMLElement;
    const rotCell = postBlock.querySelector('.pyr3-edit-aff-rotation .pyr3-edit-num') as HTMLElement;
    typeInto(rotCell, '90');
    const post = state.genome.xforms[0]!.post!;
    expect(post.a).toBeCloseTo(0, 6);
    expect(post.b).toBeCloseTo(-1, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.post.rotation');
  });
});

// ── Detail pane: variations chain ────────────────────────────────────────────

describe('xformsSection — detail variations chain', () => {
  it('renders one variation row per existing variation (picker-trigger button, not <select>)', () => {
    const { host, state } = mount(1);
    const rows = detail(host).querySelectorAll('.pyr3-edit-var-row');
    expect(rows.length).toBe(state.genome.xforms[0]!.variations.length);
    expect(detail(host).querySelector('.pyr3-edit-var-row select')).toBeNull();
    expect(detail(host).querySelector('.pyr3-edit-var-kind-btn')).toBeTruthy();
  });

  it('row layout is [toggle | name | weight | remove]', () => {
    const { host } = mount(1);
    const header = detail(host).querySelector('.pyr3-edit-var-row .pyr3-edit-var-header') as HTMLElement;
    expect(header.querySelector('.pyr3-edit-var-active.pyr3-toggle')).toBeTruthy();
    expect(header.querySelector('.pyr3-edit-var-kind-btn')).toBeTruthy();
    expect(header.querySelector('.pyr3-edit-var-weight')).toBeTruthy();
    expect(header.querySelector('.pyr3-remove-btn')).toBeTruthy();
  });

  it('variation weight write hits xforms.0.variations.0.weight', () => {
    const { host, state, onChange } = mount(1);
    const weightCell = detail(host).querySelector('.pyr3-edit-var-row .pyr3-edit-var-weight') as HTMLElement;
    typeInto(weightCell, '0.77');
    expect(state.genome.xforms[0]!.variations[0]!.weight).toBeCloseTo(0.77, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.variations.0.weight');
  });

  it('per-row toggle inactivates variation.active', () => {
    const { host, state, onChange } = mount(1);
    const toggle = detail(host).querySelector('.pyr3-edit-var-active') as HTMLElement;
    toggle.click();
    expect(state.genome.xforms[0]!.variations[0]!.active).toBe(false);
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('variations.0.active'));
  });

  it('linear kind has no params; julian shows power + dist', () => {
    const g1 = generateRandomGenome(seededRng(1));
    g1.xforms[0]!.variations = [{ index: V.linear, weight: 1 }];
    const { host: h1 } = mount(g1);
    expect((detail(h1).querySelector('.pyr3-edit-var-params') as HTMLElement).children.length).toBe(0);

    const g2 = generateRandomGenome(seededRng(1));
    g2.xforms[0]!.variations = [{ index: V.julian, weight: 1 }];
    const { host: h2 } = mount(g2);
    const params = detail(h2).querySelector('.pyr3-edit-var-params') as HTMLElement;
    expect(params.children.length).toBe(2);
    const labels = [...params.querySelectorAll('.pyr3-edit-field-label')].map((e) => (e.textContent ?? '').trim());
    expect(labels).toEqual(['power', 'dist']);
  });

  it('param edit writes xforms.0.variations.0.param0', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.xforms[0]!.variations = [{ index: V.julian, weight: 1, param0: 2, param1: 1 }];
    const { host, state, onChange } = mount(genome);
    const cells = detail(host).querySelectorAll('.pyr3-edit-var-params .pyr3-edit-num') as NodeListOf<HTMLElement>;
    typeInto(cells[0]!, '5');
    expect(state.genome.xforms[0]!.variations[0]!.param0).toBe(5);
    expect(onChange).toHaveBeenCalledWith('xforms.0.variations.0.param0');
  });

  it('+ var opens the picker without auto-insert', () => {
    const { host, state } = mount(1);
    const len = state.genome.xforms[0]!.variations.length;
    (detail(host).querySelector('.pyr3-edit-var-add') as HTMLButtonElement).click();
    expect(document.querySelector('.pyr3-var-picker')).toBeTruthy();
    expect(state.genome.xforms[0]!.variations.length).toBe(len);
    document.querySelectorAll('.pyr3-picker').forEach((p) => p.remove());
  });

  it('row remove deletes the variation from the chain', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.xforms[0]!.variations = [{ index: V.linear, weight: 1 }, { index: V.julian, weight: 0.5 }];
    const { host, state, onChange } = mount(genome);
    const rows = detail(host).querySelectorAll('.pyr3-edit-var-row');
    expect(rows.length).toBe(2);
    (rows[0]!.querySelector('.pyr3-edit-var-header .pyr3-remove-btn') as HTMLElement).click();
    expect(state.genome.xforms[0]!.variations.length).toBe(1);
    expect(state.genome.xforms[0]!.variations[0]!.index).toBe(V.julian);
    expect(onChange).toHaveBeenCalledWith('xforms.0.variations.0.removed');
  });
});

// ── Detail pane: color / colorSpeed / opacity ────────────────────────────────

describe('xformsSection — detail color block', () => {
  it('color slider write commits xforms.0.color', () => {
    const { host, state, onChange } = mount(1);
    const colorSlider = detail(host).querySelector('.pyr3-edit-color-slider') as HTMLElement;
    expect(colorSlider.classList.contains('pyr3-slider')).toBe(true);
    const valueCell = colorSlider.querySelector('.pyr3-slider-value > span') as HTMLElement;
    typeInto(valueCell, '0.25');
    expect(state.genome.xforms[0]!.color).toBeCloseTo(0.25, 5);
    expect(onChange).toHaveBeenCalledWith('xforms.0.color');
  });

  it('colorSpeed scrubby commits xforms.0.colorSpeed', () => {
    const { host, state, onChange } = mount(1);
    const cell = detail(host).querySelector('.pyr3-edit-color-speed') as HTMLElement;
    typeInto(cell, '0.31');
    expect(state.genome.xforms[0]!.colorSpeed).toBeCloseTo(0.31, 6);
    expect(onChange).toHaveBeenCalledWith('xforms.0.colorSpeed');
  });

  it('opacity slider write commits xforms.0.opacity', () => {
    const { host, state, onChange } = mount(1);
    const opacity = detail(host).querySelector('.pyr3-edit-opacity-slider') as HTMLElement;
    const valueCell = opacity.querySelector('.pyr3-slider-value > span') as HTMLElement;
    typeInto(valueCell, '0.7');
    expect(state.genome.xforms[0]!.opacity).toBeCloseTo(0.7, 5);
    expect(onChange).toHaveBeenCalledWith('xforms.0.opacity');
  });
});

// ── Detail pane: xaos row ────────────────────────────────────────────────────

describe('xformsSection — detail xaos row', () => {
  it('renders one xaos input per xform when there are 2+ xforms', () => {
    const { host, state } = mount(1);
    const cells = detail(host).querySelectorAll('.pyr3-edit-xaos-row .pyr3-edit-num') as NodeListOf<HTMLElement>;
    expect(cells.length).toBe(state.genome.xforms.length);
  });

  it('xaos write initialises the array (1s) + writes index k', () => {
    const { host, state, onChange } = mount(1);
    expect(state.genome.xforms[0]!.xaos).toBeUndefined();
    const cells = detail(host).querySelectorAll('.pyr3-edit-xaos-row .pyr3-edit-num') as NodeListOf<HTMLElement>;
    typeInto(cells[1]!, '0.5');
    expect(state.genome.xforms[0]!.xaos![1]).toBeCloseTo(0.5, 6);
    expect(state.genome.xforms[0]!.xaos![0]).toBe(1);
    expect(onChange).toHaveBeenCalledWith('xforms.0.xaos.1');
  });

  it('stamps data-help-key="xform.xaos" on the xaos accordion help icon (Q4)', () => {
    const { host } = mount(1);
    expect(detail(host).querySelector('[data-help-key="xform.xaos"]')).not.toBeNull();
  });

  it('omits the xaos row when there is only one xform', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.xforms = [genome.xforms[0]!];
    const { host } = mount(genome);
    expect(detail(host).querySelector('.pyr3-edit-xaos-row')).toBeNull();
  });
});

// ── Detail sub-accordions (#350 Phase 2.2) ──────────────────────────────────

function makeStorageStub(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  } as Storage;
}

describe('xformsSection — detail sub-accordions', () => {
  beforeEach(() => vi.stubGlobal('localStorage', makeStorageStub()));
  afterEach(() => vi.unstubAllGlobals());
  const accordions = (host: HTMLElement) =>
    [...detail(host).querySelectorAll('.pyr3-edit-accordion')] as HTMLElement[];
  const groupOf = (acc: HTMLElement) => acc.dataset['group'];
  const headerOf = (acc: HTMLElement) => acc.querySelector('.pyr3-edit-accordion-header') as HTMLElement;
  const bodyOf = (acc: HTMLElement) => acc.querySelector('.pyr3-edit-accordion-body') as HTMLElement;

  it('a regular (2+) xform shows Affine / Variations / Color / Xaos accordions', () => {
    const { host } = mount(1);
    expect(accordions(host).map(groupOf)).toEqual(['affine', 'variations', 'color', 'xaos']);
  });

  it('a single-xform genome omits the Xaos accordion', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.xforms = [genome.xforms[0]!];
    const { host } = mount(genome);
    expect(accordions(host).map(groupOf)).toEqual(['affine', 'variations', 'color']);
  });

  it('the final detail shows Affine / Variations / Color only (no Xaos)', () => {
    const genome = generateRandomGenome(seededRng(1));
    genome.finalxform = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, weight: 1, color: 0.5, colorSpeed: 0.5, variations: [{ index: V.linear, weight: 1 }] };
    const { host } = mount(genome);
    (host.querySelector('.pyr3-edit-final-row') as HTMLElement).click();
    expect(accordions(host).map(groupOf)).toEqual(['affine', 'variations', 'color']);
  });

  it('default collapse: Affine open, the rest folded', () => {
    const { host } = mount(1);
    const byGroup = Object.fromEntries(accordions(host).map((a) => [groupOf(a), bodyOf(a).style.display]));
    expect(byGroup['affine']).toBe('block');
    expect(byGroup['variations']).toBe('none');
    expect(byGroup['color']).toBe('none');
    expect(byGroup['xaos']).toBe('none');
  });

  it('content of a collapsed accordion is still in the DOM (display-toggle, not unmount)', () => {
    const { host } = mount(1);
    // Variations is collapsed by default, yet its rows exist.
    expect(detail(host).querySelector('.pyr3-edit-var-row')).toBeTruthy();
    expect(detail(host).querySelector('.pyr3-edit-color-slider')).toBeTruthy();
  });

  it('clicking a header toggles the body + persists the pref', () => {
    const { host, state } = mount(1);
    const affine = accordions(host).find((a) => groupOf(a) === 'affine')!;
    expect(bodyOf(affine).style.display).toBe('block');
    headerOf(affine).click();
    expect(bodyOf(affine).style.display).toBe('none');
    expect(state.xformDetailCollapse.affine).toBe(true);
    // Persisted to localStorage so the choice survives a remount.
    const raw = JSON.parse(localStorage.getItem('pyr3.editor.xformDetailCollapse')!);
    expect(raw.affine).toBe(true);
  });

  it('collapse pref carries to the next mount', () => {
    const { host: h1, state: s1 } = mount(1);
    const variations = [...detail(h1).querySelectorAll('.pyr3-edit-accordion')].find((a) => (a as HTMLElement).dataset['group'] === 'variations') as HTMLElement;
    // expand Variations (it defaults collapsed)
    (variations.querySelector('.pyr3-edit-accordion-header') as HTMLElement).click();
    expect(s1.xformDetailCollapse.variations).toBe(false);
    // a fresh state reads the persisted pref
    const { host: h2 } = mount(generateRandomGenome(seededRng(2)));
    const v2 = [...detail(h2).querySelectorAll('.pyr3-edit-accordion')].find((a) => (a as HTMLElement).dataset['group'] === 'variations') as HTMLElement;
    expect((v2.querySelector('.pyr3-edit-accordion-body') as HTMLElement).style.display).toBe('block');
  });
});

// ── variation-kind picker: param leak (#236) + cancel/revert loss (#237) ─────

describe('xformsSection — variation-kind picker (#236/#237/#261)', () => {
  afterEach(() => {
    document.querySelectorAll('.pyr3-picker').forEach((p) => p.remove());
  });

  it('#237: Cancel restores the original variation index AND tuned params', () => {
    const { host, state } = mount(genomeWithVar({ index: V.julian, weight: 1, param0: 2, param1: 0.5 }));
    (detail(host).querySelector('.pyr3-edit-var-kind-btn') as HTMLButtonElement).click();
    (document.querySelector(`.pyr3-picker-cell[data-vidx="${V.spirograph}"]`) as HTMLElement).click();
    (document.querySelector('.pyr3-picker-close') as HTMLElement).click();
    const v = state.genome.xforms[0]!.variations[0]! as unknown as Record<string, number | undefined>;
    expect(v.index).toBe(V.julian);
    expect(pslot(v, 'param0')).toBe(2);
    expect(pslot(v, 'param1')).toBe(0.5);
  });

  it('#237: Revert restores the original variation index AND tuned params', () => {
    const { host, state } = mount(genomeWithVar({ index: V.julian, weight: 1, param0: 2, param1: 0.5 }));
    (detail(host).querySelector('.pyr3-edit-var-kind-btn') as HTMLButtonElement).click();
    (document.querySelector(`.pyr3-picker-cell[data-vidx="${V.spirograph}"]`) as HTMLElement).click();
    (document.querySelector('.pyr3-picker-revert') as HTMLElement).click();
    const v = state.genome.xforms[0]!.variations[0]! as unknown as Record<string, number | undefined>;
    expect(v.index).toBe(V.julian);
    expect(pslot(v, 'param0')).toBe(2);
    expect(pslot(v, 'param1')).toBe(0.5);
  });

  it('#261: "+ var" add picker stamps the new kind\'s default params', () => {
    const { host, state } = mount(genomeWithVar({ index: V.linear, weight: 1 }));
    (detail(host).querySelector('.pyr3-edit-var-add') as HTMLButtonElement).click();
    (document.querySelector(`.pyr3-picker-cell[data-vidx="${V.ngon}"]`) as HTMLElement).click();
    (document.querySelector('.pyr3-picker-apply') as HTMLElement).click();
    const added = state.genome.xforms[0]!.variations[1]! as unknown as Record<string, number | undefined>;
    expect(added.index).toBe(V.ngon);
    expect(pslot(added, 'param0')).toBe(5);
    expect(pslot(added, 'param1')).toBe(3);
    expect(pslot(added, 'param2')).toBe(1);
    expect(pslot(added, 'param3')).toBe(2);
  });

  it('#236: kind change stamps new defaults and leaks NO stale high param slots', () => {
    const { host, state } = mount(genomeWithVar({
      index: V.spirograph, weight: 1,
      param0: 7, param1: 7, param2: 7, param3: 7, param4: 7,
      param5: 7, param6: 7, param7: 7, param8: 7,
    }));
    (detail(host).querySelector('.pyr3-edit-var-kind-btn') as HTMLButtonElement).click();
    (document.querySelector(`.pyr3-picker-cell[data-vidx="${V.ngon}"]`) as HTMLElement).click();
    (document.querySelector('.pyr3-picker-apply') as HTMLElement).click();
    const v = state.genome.xforms[0]!.variations[0]! as unknown as Record<string, number | undefined>;
    expect(v.index).toBe(V.ngon);
    expect(pslot(v, 'param3')).toBe(2);
    for (let i = 4; i < 10; i++) expect(pslot(v, `param${i}`)).toBeUndefined();
  });
});
