// @vitest-environment happy-dom
//
// pyr3 — /v1/edit shell. Focused coverage for the SETTLE control in the
// panel topbar (#367 moved the ladder here, next to the `settle` scrubby).

import { describe, expect, it, vi } from 'vitest';
import { mountEditUi, groupByLens, EDIT_CSS, type SectionMount } from './edit-ui';
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

function mount(over: Partial<Parameters<typeof mountEditUi>[3]> = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const host = document.getElementById('host')!;
  const state = createEditState(generateRandomGenome(seededRng(1)), 1);
  const handle = mountEditUi(host, state, [], {
    onChange: vi.fn(),
    settleDelayMs: 500,
    ...over,
  });
  return { host, handle };
}

describe('edit-ui affordance vocabulary CSS (#373)', () => {
  it('ships the shared Tier-4 expander class', () => {
    expect(EDIT_CSS).toContain('.pyr3-aff-expander');
    expect(EDIT_CSS).toContain('var(--accent-border');
  });
  it('strengthens section headers with a structural left-rule (Tier 2)', () => {
    expect(EDIT_CSS).toMatch(/\.pyr3-edit-section-header[^}]*border-left:\s*3px[^}]*var\(--structure/s);
  });
  it('keeps the .pyr3-scrubby base layout-only (Tier-5 affordance lives on .pyr3-edit-num, #373 decision B)', () => {
    // The drag-to-edit hint is a 2px accent bottom-rule on the boxed .pyr3-edit-num
    // field (XFORM_CSS), not a dashed underline on the bare scrubby — so the base
    // .pyr3-scrubby rule must NOT paint a border (would double up on boxed fields).
    expect(EDIT_CSS).toMatch(/\.pyr3-scrubby\s*\{(?:(?!border)[^}])*\}/s);
  });
});

describe('edit-ui SETTLE control (#367)', () => {
  it('renders the SETTLE ladder (200/500/1000/2000) in the panel topbar', () => {
    const { host } = mount();
    const ladder = host.querySelector('.pyr3-edit-settle-ladder') as HTMLElement;
    expect(ladder).not.toBeNull();
    const labels = [...ladder.querySelectorAll('.pyr3-bar-settle-btn')].map((b) => b.textContent);
    expect(labels).toEqual(['200', '500', '1000', '2000']);
    // it lives in the same row as the `settle` scrubby
    expect(ladder.closest('.pyr3-edit-named')?.querySelector('.pyr3-edit-settle-input')).not.toBeNull();
  });

  it('highlights the ladder button matching the initial settle value', () => {
    const { host } = mount({ settleDelayMs: 1000 });
    const active = [...host.querySelectorAll('.pyr3-bar-settle-btn.on')];
    expect(active).toHaveLength(1);
    expect(active[0]!.textContent).toBe('1000');
  });

  it('clicking a ladder button fires onSettleDelayChange and re-highlights', () => {
    const onSettleDelayChange = vi.fn();
    const { host } = mount({ settleDelayMs: 500, onSettleDelayChange });
    const btn = [...host.querySelectorAll('.pyr3-bar-settle-btn')]
      .find((b) => b.textContent === '2000') as HTMLButtonElement;
    btn.click();
    expect(onSettleDelayChange).toHaveBeenCalledWith(2000);
    const active = [...host.querySelectorAll('.pyr3-bar-settle-btn.on')];
    expect(active.map((b) => b.textContent)).toEqual(['2000']);
  });

  it('setSettleDelayMs(off-ladder) leaves no ladder button highlighted', () => {
    const { host, handle } = mount({ settleDelayMs: 500 });
    handle.setSettleDelayMs(750);
    expect(host.querySelectorAll('.pyr3-bar-settle-btn.on')).toHaveLength(0);
  });
});

const lensStub = (key: string, lens: string): SectionMount =>
  ({ key, title: key, lens, build: () => undefined } as unknown as SectionMount);

describe('groupByLens (#27)', () => {
  it('buckets sections by lens, preserving order within a lens', () => {
    const secs = [
      lensStub('xforms', 'xform'),
      lensStub('palette', 'color'),
      lensStub('final', 'xform'),
      lensStub('render', 'output'),
    ];
    const g = groupByLens(secs);
    expect(g.xform.map((s) => s.key)).toEqual(['xforms', 'final']);
    expect(g.color.map((s) => s.key)).toEqual(['palette']);
    expect(g.output.map((s) => s.key)).toEqual(['render']);
    expect(g.scene).toEqual([]);
  });

  it('returns all four lens buckets even when empty', () => {
    const g = groupByLens([]);
    expect(Object.keys(g).sort()).toEqual(['color', 'output', 'scene', 'xform']);
  });
});

describe('edit-ui lens bar (#27)', () => {
  function mountWithLenses() {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host')!;
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    const sections: SectionMount[] = [
      { key: 'xforms', lens: 'xform', title: 'XF', build: (h) => { h.textContent = 'xf-body'; } },
      { key: 'palette', lens: 'color', title: 'PAL', build: (h) => { h.textContent = 'pal-body'; } },
    ];
    mountEditUi(host, state, sections, { onChange: vi.fn(), settleDelayMs: 500 });
    return { host, state };
  }

  function wrapByTitle(host: HTMLElement, title: string): HTMLElement {
    for (const w of host.querySelectorAll('.pyr3-edit-section')) {
      if (w.querySelector('.pyr3-edit-section-title')?.textContent === title) return w as HTMLElement;
    }
    throw new Error(`wrap not found: ${title}`);
  }

  it('renders the four lens buttons in order', () => {
    const { host } = mountWithLenses();
    const btns = [...host.querySelectorAll('.pyr3-edit-lensbtn')].map((b) => b.textContent);
    expect(btns).toEqual(['XForm', 'Scene', 'Color', 'Output']);
  });

  it('defaults to the xform lens: shows xform sections, hides the rest', () => {
    const { host } = mountWithLenses();
    expect(wrapByTitle(host, 'XF').style.display).toBe('block');
    expect(wrapByTitle(host, 'PAL').style.display).toBe('none');
    expect(host.querySelector('.pyr3-edit-lensbtn.on')?.textContent).toBe('XForm');
  });

  it('clicking a lens button switches the visible sections + updates state', () => {
    const { host, state } = mountWithLenses();
    const colorBtn = [...host.querySelectorAll('.pyr3-edit-lensbtn')]
      .find((b) => b.textContent === 'Color') as HTMLButtonElement;
    colorBtn.click();
    expect(wrapByTitle(host, 'XF').style.display).toBe('none');
    expect(wrapByTitle(host, 'PAL').style.display).toBe('block');
    expect(state.activeLens).toBe('color');
    expect(host.querySelector('.pyr3-edit-lensbtn.on')?.textContent).toBe('Color');
  });
});

describe('Color lens group dividers (#358)', () => {
  const grpStub = (key: string, lens: string, group?: string): SectionMount =>
    ({ key, title: key, lens, group, build: (h: HTMLElement) => { h.textContent = key; } } as unknown as SectionMount);

  function mountGrouped(activeLens: string) {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host')!;
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    state.activeLens = activeLens as typeof state.activeLens;
    const sections: SectionMount[] = [
      grpStub('palette', 'color', 'palette'),
      grpStub('hsl', 'color', 'grading'),
      grpStub('curves', 'color', 'grading'),
      grpStub('density', 'output'), // no group → no header
    ];
    mountEditUi(host, state, sections, { onChange: vi.fn(), settleDelayMs: 500 });
    return host;
  }

  it('renders one static group header per group, in declared order', () => {
    const host = mountGrouped('color');
    const headers = [...host.querySelectorAll('.pyr3-edit-group-header')];
    expect(headers).toHaveLength(2);
    expect(headers[0]!.textContent).toContain('Palette');
    expect(headers[1]!.textContent).toContain('Grading');
  });

  it('hides group headers when their lens is inactive', () => {
    const host = mountGrouped('output');
    const headers = [...host.querySelectorAll('.pyr3-edit-group-header')] as HTMLElement[];
    expect(headers).toHaveLength(2);
    for (const h of headers) expect(h.style.display).toBe('none');
  });
});
