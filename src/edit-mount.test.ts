// @vitest-environment happy-dom
//
// Unit smoke for the editor UI shell. The mountEditPage WebGPU path can't
// run under happy-dom (no GPUDevice), so we cover the DOM-shell behaviour
// via mountEditUi directly.

import { describe, expect, it, vi } from 'vitest';
import { mountEditUi, type SectionMount } from './edit-ui';
import { createEditState, type SectionKey } from './edit-state';
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

function makeSections(keys: SectionKey[]): SectionMount[] {
  return keys.map((k) => ({
    key: k,
    title: k.toUpperCase(),
    build: () => {},
  }));
}

describe('mountEditUi shell', () => {
  it('renders the action-button row (name + nick moved to page-level bar)', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    mountEditUi(host, state, [], { onChange: () => {} });
    // No name/nick inputs in the panel anymore; only the 4 action buttons.
    expect(host.querySelectorAll('.pyr3-edit-text').length).toBe(0);
    expect(host.querySelectorAll('.pyr3-edit-btn').length).toBe(4);
  });

  it('renders 7 section headers when 7 sections are passed', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    const all: SectionKey[] = ['palette', 'viewport', 'xforms', 'final', 'global', 'density', 'render'];
    mountEditUi(host, state, makeSections(all), { onChange: () => {} });
    expect(host.querySelectorAll('.pyr3-edit-section-header').length).toBe(7);
  });

  it('section header click toggles collapse state + chevron', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    mountEditUi(host, state, makeSections(['palette']), { onChange: () => {} });

    const header = host.querySelector('.pyr3-edit-section-header') as HTMLElement;
    const chev = header.querySelector('.pyr3-edit-chev') as HTMLElement;
    const body = host.querySelector('.pyr3-edit-section-body') as HTMLElement;

    expect(state.sectionCollapse.palette).toBe(false);
    expect(chev.textContent).toBe('▼');
    expect(body.style.display).toBe('block');

    header.click();
    expect(state.sectionCollapse.palette).toBe(true);
    expect(chev.textContent).toBe('▶');
    expect(body.style.display).toBe('none');

    header.click();
    expect(state.sectionCollapse.palette).toBe(false);
    expect(chev.textContent).toBe('▼');
    expect(body.style.display).toBe('block');
  });

  it('passes the build callback the section body host + state + onChange', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    const build = vi.fn();
    const onChange = vi.fn();
    mountEditUi(host, state, [{ key: 'palette', title: 'PAL', build }], { onChange });
    expect(build).toHaveBeenCalledTimes(1);
    const [bodyArg, stateArg, onChangeArg] = build.mock.calls[0]!;
    expect((bodyArg as HTMLElement).className).toBe('pyr3-edit-section-body');
    expect(stateArg).toBe(state);
    expect(onChangeArg).toBe(onChange);
  });

  it('destroy() removes the topbar + every section element', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    const ui = mountEditUi(host, state, makeSections(['palette', 'viewport']), { onChange: () => {} });
    expect(host.children.length).toBeGreaterThan(0);
    ui.destroy();
    expect(host.children.length).toBe(0);
  });

  it('reroll/open/save/png buttons render and fire their callbacks', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    const onReroll = vi.fn();
    const onOpenFile = vi.fn();
    const onSaveFile = vi.fn();
    const onRenderPng = vi.fn();
    mountEditUi(host, state, [], {
      onChange: () => {},
      onReroll,
      onOpenFile,
      onSaveFile,
      onRenderPng,
    });
    const buttons = host.querySelectorAll('.pyr3-edit-btn');
    expect(buttons.length).toBe(4);
    (buttons[0] as HTMLButtonElement).click();
    (buttons[1] as HTMLButtonElement).click();
    (buttons[2] as HTMLButtonElement).click();
    (buttons[3] as HTMLButtonElement).click();
    expect(onReroll).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onSaveFile).toHaveBeenCalledTimes(1);
    expect(onRenderPng).toHaveBeenCalledTimes(1);
  });
});
