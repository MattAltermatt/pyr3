// @vitest-environment happy-dom
//
// Phase 7 task 7.7: section refactored to row primitives (buildRow /
// buildNumberInput / buildDropdown / buildPair). Tests drive scrubby
// numeric cells via the dblclick → type → Enter pattern; dropdowns via
// .value + change event. The W × H pair sits in a `1fr auto 1fr` sub-grid
// so neither input clips at narrow panel widths — asserted explicitly.

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

  it('renders preset + W/H + quality + oversample + filter rows', () => {
    const { host } = mount();
    expect(host.querySelector('.pyr3-edit-render-size-preset')).not.toBeNull();
    expect(host.querySelector('.pyr3-edit-render-width')).not.toBeNull();
    expect(host.querySelector('.pyr3-edit-render-height')).not.toBeNull();
    expect(host.querySelector('.pyr3-edit-render-quality')).not.toBeNull();
    expect(host.querySelector('.pyr3-edit-render-oversample')).not.toBeNull();
    expect(host.querySelector('.pyr3-edit-render-filter-radius')).not.toBeNull();
    expect(host.querySelector('.pyr3-edit-render-filter-shape')).not.toBeNull();
  });

  it('W × H row uses buildPair sub-grid (1fr auto 1fr) so both inputs fit', () => {
    // Verify the pair primitive's structural shape — the W/H inputs sit in
    // a 3-column sub-grid with the `×` separator pinned center. This is the
    // failing assertion the task spec calls out.
    const { host } = mount();
    const whRow = host.querySelector('.pyr3-edit-render-wh-row') as HTMLElement;
    expect(whRow).not.toBeNull();
    const pair = whRow.querySelector('.pyr3-pair') as HTMLElement;
    expect(pair).not.toBeNull();
    expect(pair.style.gridTemplateColumns).toBe('1fr auto 1fr');
    // Separator is the `×` glyph.
    expect(pair.querySelector('.pyr3-pair-sep')?.textContent).toBe('×');
    // Both inputs land inside the pair sub-grid as siblings of the sep.
    expect(pair.querySelector('.pyr3-edit-render-width')).not.toBeNull();
    expect(pair.querySelector('.pyr3-edit-render-height')).not.toBeNull();
  });

  it('size preset "1080p" writes state.genome.size = {1920, 1080} and fires onChange', () => {
    const { host, state, onChange } = mount();
    const preset = host.querySelector<HTMLSelectElement>('.pyr3-edit-render-size-preset')!;
    preset.value = '1080p';
    preset.dispatchEvent(new Event('change'));
    expect(state.genome.size).toEqual({ width: 1920, height: 1080 });
    expect(onChange).toHaveBeenCalledWith('size.width');
    expect(onChange).toHaveBeenCalledWith('size.height');
  });

  it('size preset "4K" writes 3840×2160', () => {
    const { host, state } = mount();
    const preset = host.querySelector<HTMLSelectElement>('.pyr3-edit-render-size-preset')!;
    preset.value = '4K';
    preset.dispatchEvent(new Event('change'));
    expect(state.genome.size).toEqual({ width: 3840, height: 2160 });
  });

  it('Size dropdown surfaces SIZE_PRESETS (HD, 4K, square, iPhone 15 Pro, …)', () => {
    const { host } = mount();
    const preset = host.querySelector<HTMLSelectElement>('.pyr3-edit-render-size-preset')!;
    const values = Array.from(preset.querySelectorAll('option')).map((o) => o.value);
    // A few signal entries — full list lives in load-intent.ts:SIZE_PRESETS.
    expect(values).toContain('HD');
    expect(values).toContain('4K');
    expect(values).toContain('square');
    expect(values).toContain('iPhone 15 Pro');
    // Legacy aliases preserved so existing fixtures + tests don't break.
    expect(values).toContain('1080p');
    expect(values).toContain('Square');
    expect(values).toContain('Custom');
  });

  it('manual width edit flips preset dropdown to "Custom"', () => {
    const { host, state } = mount();
    const preset = host.querySelector<HTMLSelectElement>('.pyr3-edit-render-size-preset')!;
    // Snap to a known preset first.
    preset.value = '1080p';
    preset.dispatchEvent(new Event('change'));
    expect(preset.value).toBe('1080p');

    const width = host.querySelector<HTMLElement>('.pyr3-edit-render-width')!;
    typeInto(width, '1234');
    expect(state.genome.size!.width).toBe(1234);
    expect(state.genome.size!.height).toBe(1080);
    expect(preset.value).toBe('Custom');
  });

  it('manual height edit flips preset dropdown to "Custom"', () => {
    const { host, state } = mount();
    const preset = host.querySelector<HTMLSelectElement>('.pyr3-edit-render-size-preset')!;
    preset.value = 'Square';
    preset.dispatchEvent(new Event('change'));
    expect(preset.value).toBe('Square');

    const height = host.querySelector<HTMLElement>('.pyr3-edit-render-height')!;
    typeInto(height, '999');
    expect(state.genome.size!.height).toBe(999);
    expect(preset.value).toBe('Custom');
  });

  it('editing quality writes state.genome.quality and fires onChange("quality")', () => {
    const { host, state, onChange } = mount();
    const q = host.querySelector<HTMLElement>('.pyr3-edit-render-quality')!;
    typeInto(q, '250');
    expect(state.genome.quality).toBe(250);
    expect(onChange).toHaveBeenCalledWith('quality');
  });

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
