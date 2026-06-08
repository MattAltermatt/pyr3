// @vitest-environment happy-dom
//
// #176 (2026-06-07): Size + W × H + Quality MOVED to the shared render-mode-bar
// (`src/render-mode-bar.ts`) above the canvas in both viewer + editor. This
// section now hosts only oversample + spatial filter (radius + shape) + a
// subtitle pointing at the bar for the moved widgets. Tests assert (a) the
// moved widgets are GONE, (b) the subtitle is present, (c) the remaining
// oversample / filter widgets still wire correctly.
//
// Phase 7 task 7.7 (historical): section refactored to row primitives
// (buildRow / buildNumberInput / buildDropdown / buildPair). Tests drive
// scrubby numeric cells via the dblclick → type → Enter pattern; dropdowns
// via .value + change event.

import { describe, expect, it, vi } from 'vitest';
import { renderSection } from './edit-section-render';
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
  document.body.appendChild(host);
  const state = createEditState(generateRandomGenome(seededRng(1)), 1);
  const onChange = vi.fn();
  renderSection.build(host, state, onChange);
  return { host, state, onChange };
}

function typeInto(cell: HTMLElement, value: string): void {
  // Plain `<input>` (W×H + quality after 2026-06-05) → set value + fire
  // input event directly. Scrubby `<span>` → dblclick to enter text mode,
  // then type-and-Enter through the inner input.
  if (cell instanceof HTMLInputElement) {
    cell.value = value;
    cell.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const inp = cell.querySelector('input') as HTMLInputElement;
  inp.value = value;
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

describe('renderSection', () => {
  it('exposes the SectionMount contract', () => {
    expect(renderSection.key).toBe('render');
    expect(renderSection.title).toContain('RENDER');
    expect(typeof renderSection.build).toBe('function');
  });

  it('renders subtitle + oversample + filter rows (size/quality/W×H moved to the bar in #176)', () => {
    const { host } = mount();
    // Moved-to-bar widgets are GONE from this panel
    expect(host.querySelector('.pyr3-edit-render-size-preset')).toBeNull();
    expect(host.querySelector('.pyr3-edit-render-width')).toBeNull();
    expect(host.querySelector('.pyr3-edit-render-height')).toBeNull();
    expect(host.querySelector('.pyr3-edit-render-quality')).toBeNull();
    // Remaining widgets stay
    expect(host.querySelector('.pyr3-edit-render-oversample')).not.toBeNull();
    expect(host.querySelector('.pyr3-edit-render-filter-radius')).not.toBeNull();
    expect(host.querySelector('.pyr3-edit-render-filter-shape')).not.toBeNull();
  });

  it('shows the bar-redirect subtitle', () => {
    const { host } = mount();
    const subtitle = host.querySelector('.pyr3-edit-section-render__subtitle');
    expect(subtitle).not.toBeNull();
    expect(subtitle?.textContent).toMatch(/see size & render quality on the bar above/i);
  });

  it('W × H row stripped (moved to render-mode-bar)', () => {
    // The old buildPair sub-grid assertion no longer applies — the W × H pair
    // lives on the render-mode-bar now. The panel should not have a wh-row.
    const { host } = mount();
    const whRow = host.querySelector('.pyr3-edit-render-wh-row');
    expect(whRow).toBeNull();
    // Keep the rest of the original test body intact below by short-circuiting.
    if (whRow === null) return;
    const pair = whRow.querySelector('.pyr3-pair') as HTMLElement;
    expect(pair).not.toBeNull();
    expect(pair.style.gridTemplateColumns).toBe('1fr auto 1fr');
    // Separator is the `×` glyph.
    expect(pair.querySelector('.pyr3-pair-sep')?.textContent).toBe('×');
    // Both inputs land inside the pair sub-grid as siblings of the sep.
    expect(pair.querySelector('.pyr3-edit-render-width')).not.toBeNull();
    expect(pair.querySelector('.pyr3-edit-render-height')).not.toBeNull();
  });

  // Size preset + W × H + Quality tests moved to render-mode-bar.test.ts in
  // #176. The bar is the new single source for those widgets.

  it('editing oversample writes state.genome.oversample and fires onChange("oversample")', () => {
    const { host, state, onChange } = mount();
    const os = host.querySelector<HTMLSelectElement>('.pyr3-edit-render-oversample')!;
    os.value = '2';
    os.dispatchEvent(new Event('change'));
    expect(state.genome.oversample).toBe(2);
    expect(onChange).toHaveBeenCalledWith('oversample');
  });

  it('editing filter radius lazy-inits spatialFilter from {0.5, gaussian} then writes the new value', () => {
    const { host, state, onChange } = mount();
    expect(state.genome.spatialFilter).toBeUndefined();
    const fr = host.querySelector<HTMLElement>('.pyr3-edit-render-filter-radius')!;
    typeInto(fr, '0.75');
    expect(state.genome.spatialFilter).toEqual({ radius: 0.75, shape: 'gaussian' });
    expect(onChange).toHaveBeenCalledWith('spatialFilter.radius');
  });

  it('editing filter shape lazy-inits spatialFilter and writes the new shape', () => {
    const { host, state, onChange } = mount();
    expect(state.genome.spatialFilter).toBeUndefined();
    const fs = host.querySelector<HTMLSelectElement>('.pyr3-edit-render-filter-shape')!;
    fs.value = 'mitchell';
    fs.dispatchEvent(new Event('change'));
    expect(state.genome.spatialFilter).toEqual({ radius: 0.5, shape: 'mitchell' });
    expect(onChange).toHaveBeenCalledWith('spatialFilter.shape');
  });

  it('preserves existing spatialFilter.radius when shape is edited', () => {
    const { host, state } = mount();
    state.genome.spatialFilter = { radius: 1.25, shape: 'gaussian' };
    const fs = host.querySelector<HTMLSelectElement>('.pyr3-edit-render-filter-shape')!;
    fs.value = 'lanczos3';
    fs.dispatchEvent(new Event('change'));
    expect(state.genome.spatialFilter).toEqual({ radius: 1.25, shape: 'lanczos3' });
  });
});
