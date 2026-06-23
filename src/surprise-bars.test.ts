// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { mountSurpriseBars } from './surprise-bars';
import { SURPRISE_SETTINGS_DEFAULT, type SurpriseSettings } from './surprise-prefs';

function setup(initial: Partial<SurpriseSettings> = {}) {
  let settings: SurpriseSettings = { ...SURPRISE_SETTINGS_DEFAULT, ...initial };
  const onChange = vi.fn((s: SurpriseSettings) => { settings = s; });
  const onResetGeneration = vi.fn();
  const onResetVariations = vi.fn();
  const host = document.createElement('div');
  const handle = mountSurpriseBars(host, {
    getSettings: () => settings,
    onChange, onResetGeneration, onResetVariations,
  });
  const q = (sel: string) => host.querySelector(sel) as HTMLElement | null;
  return { host, handle, onChange, onResetGeneration, onResetVariations,
    set: (s: SurpriseSettings) => { settings = s; }, get: () => settings, q };
}

describe('surprise-bars (#433)', () => {
  it('mounts both GENERATE and VARIATIONS bars', () => {
    const { q } = setup();
    expect(q('[data-bar="generate"]')).toBeTruthy();
    expect(q('[data-bar="variations"]')).toBeTruthy();
  });

  it('does NOT render a settings popover toggle or settings undo/redo', () => {
    const { q } = setup();
    expect(q('[data-role="settings-toggle"]')).toBeNull();
    expect(q('[data-role="settings-undo"]')).toBeNull();
    expect(q('[data-role="settings-redo"]')).toBeNull();
  });

  it('editing a density button fires onChange with the new density', () => {
    const { q, onChange } = setup({ density: 'm' });
    (q('[data-role="density-l"]') as HTMLButtonElement).click();
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0].density).toBe('l');
  });

  it('editing the xform-min number fires onChange with a clamped range', () => {
    const { q, onChange } = setup({ xformCount: [2, 4] });
    const min = q('[data-role="xform-min"]') as HTMLInputElement;
    min.value = '0';
    min.dispatchEvent(new Event('change'));
    expect(onChange.mock.calls.at(-1)![0].xformCount).toEqual([1, 4]); // clamped to >=1
  });

  it('Generate Reset calls onResetGeneration only', () => {
    const { q, onResetGeneration, onResetVariations } = setup();
    (q('[data-role="reset-generation"]') as HTMLButtonElement).click();
    expect(onResetGeneration).toHaveBeenCalledTimes(1);
    expect(onResetVariations).not.toHaveBeenCalled();
  });

  it('Variations Reset calls onResetVariations only', () => {
    const { q, onResetGeneration, onResetVariations } = setup();
    (q('[data-role="reset-variations"]') as HTMLButtonElement).click();
    expect(onResetVariations).toHaveBeenCalledTimes(1);
    expect(onResetGeneration).not.toHaveBeenCalled();
  });

  it('reset buttons live on their own bar', () => {
    const { q } = setup();
    expect(q('[data-bar="generate"] [data-role="reset-generation"]')).toBeTruthy();
    expect(q('[data-bar="variations"] [data-role="reset-variations"]')).toBeTruthy();
  });

  it('refresh() re-syncs displayed widgets after an external settings change', () => {
    const s = setup({ density: 'm' });
    expect((s.q('[data-role="density-m"]') as HTMLElement).classList.contains('on')).toBe(true);
    // external commit (e.g. a reset): swap settings, then refresh
    s.set({ ...SURPRISE_SETTINGS_DEFAULT, density: 's' });
    s.handle.refresh();
    expect((s.q('[data-role="density-s"]') as HTMLElement).classList.contains('on')).toBe(true);
    expect((s.q('[data-role="density-m"]') as HTMLElement).classList.contains('on')).toBe(false);
  });

  it('set-n is disabled in fill mode, enabled in set mode', () => {
    const fill = setup({ countMode: 'fill' });
    expect((fill.q('[data-role="set-n"]') as HTMLInputElement).disabled).toBe(true);
    const set = setup({ countMode: 'set' });
    expect((set.q('[data-role="set-n"]') as HTMLInputElement).disabled).toBe(false);
  });
});
