// @vitest-environment happy-dom

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
  const state = createEditState(generateRandomGenome(seededRng(1)), 1);
  const onChange = vi.fn();
  renderSection.build(host, state, onChange);
  return { host, state, onChange };
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

  it('manual width edit flips preset dropdown to "Custom"', () => {
    const { host, state } = mount();
    const preset = host.querySelector<HTMLSelectElement>('.pyr3-edit-render-size-preset')!;
    // Snap to a known preset first.
    preset.value = '1080p';
    preset.dispatchEvent(new Event('change'));
    expect(preset.value).toBe('1080p');

    const width = host.querySelector<HTMLInputElement>('.pyr3-edit-render-width')!;
    width.value = '1234';
    width.dispatchEvent(new Event('input'));
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

    const height = host.querySelector<HTMLInputElement>('.pyr3-edit-render-height')!;
    height.value = '999';
    height.dispatchEvent(new Event('input'));
    expect(state.genome.size!.height).toBe(999);
    expect(preset.value).toBe('Custom');
  });

  it('editing quality writes state.genome.quality and fires onChange("quality")', () => {
    const { host, state, onChange } = mount();
    const q = host.querySelector<HTMLInputElement>('.pyr3-edit-render-quality')!;
    q.value = '250';
    q.dispatchEvent(new Event('input'));
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
    const fr = host.querySelector<HTMLInputElement>('.pyr3-edit-render-filter-radius')!;
    fr.value = '0.75';
    fr.dispatchEvent(new Event('input'));
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
