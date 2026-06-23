// @vitest-environment happy-dom
//
// Surprise Wall generation settings-panel widget tests. The panel is purely
// presentational: it reads SurpriseSettings via a getter and emits the full
// updated object through onChange on every control edit. No persistence here.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SURPRISE_SETTINGS_DEFAULT, type SurpriseSettings } from './surprise-prefs';
import {
  mountSurpriseSettingsPanel,
  type SurpriseSettingsPanelHandle,
} from './surprise-settings-panel';

function setup(initial?: Partial<SurpriseSettings>, opts?: {
  canUndo?: boolean;
  canRedo?: boolean;
}) {
  let settings: SurpriseSettings = { ...SURPRISE_SETTINGS_DEFAULT, ...initial };
  const onChange = vi.fn((next: SurpriseSettings) => { settings = next; });
  const onReset = vi.fn();
  const onUndo = vi.fn();
  const onRedo = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const handle = mountSurpriseSettingsPanel(host, {
    getSettings: () => settings,
    onChange,
    onReset,
    onUndo,
    onRedo,
    canUndo: () => opts?.canUndo ?? true,
    canRedo: () => opts?.canRedo ?? true,
  });
  const q = (role: string) => host.querySelector<HTMLElement>(`[data-role="${role}"]`);
  const setSettings = (next: SurpriseSettings) => { settings = next; };
  return { host, handle, onChange, onReset, onUndo, onRedo, q, setSettings, get settings() { return settings; } };
}

let active: SurpriseSettingsPanelHandle | null = null;
afterEach(() => {
  if (active) { active.destroy(); active = null; }
  document.body.replaceChildren();
});

describe('mountSurpriseSettingsPanel', () => {
  it('renders all the controls', () => {
    const t = setup();
    active = t.handle;
    for (const role of [
      'count-fill', 'count-set', 'set-n',
      'xform-min', 'xform-max', 'blend-min', 'blend-max',
      'pick-preferred', 'mode-bias', 'mode-only',
      'reset', 'settings-undo', 'settings-redo',
    ]) {
      expect(t.q(role), `missing data-role=${role}`).toBeTruthy();
    }
    // Density: three controls, one per density value.
    const densities = t.host.querySelectorAll('[data-role="density"]');
    expect(densities.length).toBe(3);
    expect(t.host.querySelector('[data-role="density"][data-density="s"]')).toBeTruthy();
    expect(t.host.querySelector('[data-role="density"][data-density="m"]')).toBeTruthy();
    expect(t.host.querySelector('[data-role="density"][data-density="l"]')).toBeTruthy();
  });

  it('changing set-n fires onChange with the new setN', () => {
    const t = setup({ countMode: 'set', setN: 24 });
    active = t.handle;
    const input = t.q('set-n') as HTMLInputElement;
    input.value = '40';
    input.dispatchEvent(new Event('change'));
    expect(t.onChange).toHaveBeenCalled();
    expect(t.settings.setN).toBe(40);
  });

  it('clamps set-n to >= 1', () => {
    const t = setup({ countMode: 'set', setN: 5 });
    active = t.handle;
    const input = t.q('set-n') as HTMLInputElement;
    input.value = '0';
    input.dispatchEvent(new Event('change'));
    expect(t.settings.setN).toBe(1);
  });

  it('clicking density "l" fires onChange with density:l', () => {
    const t = setup({ density: 'm' });
    active = t.handle;
    const lBtn = t.host.querySelector<HTMLElement>('[data-role="density"][data-density="l"]')!;
    lBtn.click();
    expect(t.onChange).toHaveBeenCalled();
    expect(t.settings.density).toBe('l');
  });

  it('editing xform-min / xform-max fires onChange with the new range', () => {
    const t = setup({ xformCount: [2, 4] });
    active = t.handle;
    const min = t.q('xform-min') as HTMLInputElement;
    min.value = '3';
    min.dispatchEvent(new Event('change'));
    expect(t.settings.xformCount[0]).toBe(3);

    const max = t.q('xform-max') as HTMLInputElement;
    max.value = '6';
    max.dispatchEvent(new Event('change'));
    expect(t.settings.xformCount[1]).toBe(6);
  });

  it('editing blend-min / blend-max fires onChange with the new range', () => {
    const t = setup({ blendPerXform: [1, 3] });
    active = t.handle;
    const min = t.q('blend-min') as HTMLInputElement;
    min.value = '2';
    min.dispatchEvent(new Event('change'));
    expect(t.settings.blendPerXform[0]).toBe(2);
    const max = t.q('blend-max') as HTMLInputElement;
    max.value = '5';
    max.dispatchEvent(new Event('change'));
    expect(t.settings.blendPerXform[1]).toBe(5);
  });

  it('count-fill / count-set radios fire onChange with the mode', () => {
    const t = setup({ countMode: 'fill' });
    active = t.handle;
    (t.q('count-set') as HTMLInputElement).click();
    expect(t.settings.countMode).toBe('set');
    (t.q('count-fill') as HTMLInputElement).click();
    expect(t.settings.countMode).toBe('fill');
  });

  it('mode-bias / mode-only radios fire onChange with the preferMode', () => {
    const t = setup({ preferMode: 'bias' });
    active = t.handle;
    (t.q('mode-only') as HTMLInputElement).click();
    expect(t.settings.preferMode).toBe('only');
    (t.q('mode-bias') as HTMLInputElement).click();
    expect(t.settings.preferMode).toBe('bias');
  });

  it('clicking reset fires onReset', () => {
    const t = setup();
    active = t.handle;
    (t.q('reset') as HTMLElement).click();
    expect(t.onReset).toHaveBeenCalledTimes(1);
  });

  it('clicking settings-undo fires onUndo; disabled when canUndo is false', () => {
    const t = setup({}, { canUndo: false });
    active = t.handle;
    const undo = t.q('settings-undo') as HTMLButtonElement;
    expect(undo.disabled).toBe(true);

    const t2 = setup({}, { canUndo: true });
    const undo2 = t2.q('settings-undo') as HTMLButtonElement;
    expect(undo2.disabled).toBe(false);
    undo2.click();
    expect(t2.onUndo).toHaveBeenCalledTimes(1);
    t2.handle.destroy();
  });

  it('clicking settings-redo fires onRedo; disabled when canRedo is false', () => {
    const t = setup({}, { canRedo: false });
    active = t.handle;
    const redo = t.q('settings-redo') as HTMLButtonElement;
    expect(redo.disabled).toBe(true);
    const t2 = setup({}, { canRedo: true });
    (t2.q('settings-redo') as HTMLButtonElement).click();
    expect(t2.onRedo).toHaveBeenCalledTimes(1);
    t2.handle.destroy();
  });

  it('shows a preferred count', () => {
    const t = setup({ preferred: [1, 5, 9] });
    active = t.handle;
    expect(t.host.textContent).toContain('3');
  });

  it('clicking pick-preferred opens the variation picker without throwing', () => {
    const t = setup({ preferred: [1, 2] });
    active = t.handle;
    expect(() => (t.q('pick-preferred') as HTMLElement).click()).not.toThrow();
    // The picker mounts on document.body with the shared shell class.
    expect(document.querySelector('.pyr3-picker')).toBeTruthy();
  });

  it('refresh() re-reads getSettings and re-applies control values', () => {
    const t = setup({ setN: 10, density: 'm' });
    active = t.handle;
    // External mutation of the settings the getter returns.
    t.setSettings({ ...t.settings, setN: 99, density: 'l' });
    t.handle.refresh();
    expect((t.q('set-n') as HTMLInputElement).value).toBe('99');
    const lBtn = t.host.querySelector<HTMLElement>('[data-role="density"][data-density="l"]')!;
    expect(lBtn.getAttribute('aria-pressed') === 'true' || lBtn.classList.contains('on')).toBe(true);
  });

  it('lists preferred variations as removable chips; × removes one (#surprise-v2)', () => {
    const t = setup({ preferred: [1, 2] });
    active = t.handle;
    const chips = t.host.querySelectorAll('.pyr3-surprise-settings-chip');
    expect(chips.length).toBe(2);
    (chips[0]!.querySelector('.pyr3-surprise-settings-chip-rm') as HTMLElement).click();
    expect(t.onChange).toHaveBeenCalled();
    const last = t.onChange.mock.calls.at(-1)![0] as SurpriseSettings;
    expect(last.preferred).toEqual([2]); // removed idx 1, kept 2
  });
});
