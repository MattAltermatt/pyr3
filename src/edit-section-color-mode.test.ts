// @vitest-environment happy-dom
//
// #460 — the Color-lens "Color mode" section (palette / flow / trap-distance),
// relocated out of the render-mode-bar. Verifies it mounts the selector +
// param groups, toggles them by mode/kind (the select-driven paths; the scrubby
// number/slider primitives are covered by edit-primitives' own tests), persists
// ColorModeConfig, and signals the editor via onChange('color-mode').

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { colorModeSection, COLOR_MODE_CHANGE_PATH } from './edit-section-color-mode';
import { loadColorModeConfig } from './render-mode-config';
import { type EditState } from './edit-state';

function installLocalStorageStub(): void {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  (globalThis as { localStorage: Storage }).localStorage = stub as unknown as Storage;
}

function mount(): { host: HTMLElement; onChange: ReturnType<typeof vi.fn> } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const onChange = vi.fn();
  colorModeSection.build(host, {} as EditState, onChange);
  return { host, onChange };
}

const rowOf = (host: HTMLElement, key: string): HTMLElement =>
  (host.querySelector(`[data-${key}]`) as HTMLElement).closest('.pyr3-row') as HTMLElement;
// rows toggle via inline style.display (buildRow sets inline display:grid, which
// would beat the [hidden] attribute) — see the section's paint().
const rowHidden = (row: HTMLElement): boolean => row.style.display === 'none';

beforeEach(() => installLocalStorageStub());
afterEach(() => { document.body.innerHTML = ''; });

describe('edit-section-color-mode (#460)', () => {
  it('is a Color-lens section keyed color-mode', () => {
    expect(colorModeSection.lens).toBe('color');
    expect(colorModeSection.key).toBe('color-mode');
  });

  it('mounts a mode selector with palette/flow/trap-distance', () => {
    const { host } = mount();
    const sel = host.querySelector('[data-render-color-mode]') as HTMLSelectElement;
    expect(sel).toBeTruthy();
    expect([...sel.options].map((o) => o.value)).toEqual(['palette', 'flow', 'trap-distance']);
  });

  it('flow + trap groups are hidden in palette mode', () => {
    const { host } = mount();
    expect((host.querySelector('[data-flow-controls]') as HTMLElement).hidden).toBe(true);
    expect((host.querySelector('[data-trap-controls]') as HTMLElement).hidden).toBe(true);
  });

  it('selecting flow shows flow controls + persists + signals color-mode', () => {
    const { host, onChange } = mount();
    const sel = host.querySelector('[data-render-color-mode]') as HTMLSelectElement;
    sel.value = 'flow';
    sel.dispatchEvent(new Event('change'));
    expect((host.querySelector('[data-flow-controls]') as HTMLElement).hidden).toBe(false);
    expect((host.querySelector('[data-trap-controls]') as HTMLElement).hidden).toBe(true);
    expect(loadColorModeConfig().mode).toBe('flow');
    expect(onChange).toHaveBeenCalledWith(COLOR_MODE_CHANGE_PATH);
  });

  it('selecting trap shows trap controls; geometry rows toggle by kind + falloff', () => {
    const { host } = mount();
    const sel = host.querySelector('[data-render-color-mode]') as HTMLSelectElement;
    sel.value = 'trap-distance';
    sel.dispatchEvent(new Event('change'));
    expect((host.querySelector('[data-trap-controls]') as HTMLElement).hidden).toBe(false);
    const radius = rowOf(host, 'trap-radius');
    const angle = rowOf(host, 'trap-angle');
    const falloff = rowOf(host, 'trap-falloff');
    const freq = rowOf(host, 'trap-freq');
    // default point + glow → radius/angle hidden, falloff shown, freq hidden.
    expect(rowHidden(radius)).toBe(true);
    expect(rowHidden(angle)).toBe(true);
    expect(rowHidden(falloff)).toBe(false);
    expect(rowHidden(freq)).toBe(true);
    const kind = host.querySelector('[data-trap-kind]') as HTMLSelectElement;
    const mode = host.querySelector('[data-trap-mode]') as HTMLSelectElement;
    kind.value = 'circle'; kind.dispatchEvent(new Event('change'));
    expect(rowHidden(radius)).toBe(false);
    mode.value = 'rings'; mode.dispatchEvent(new Event('change'));
    expect(rowHidden(freq)).toBe(false);
    expect(rowHidden(falloff)).toBe(true);
    kind.value = 'line'; kind.dispatchEvent(new Event('change'));
    expect(rowHidden(angle)).toBe(false);
  });

  it('trap kind select persists into ColorModeConfig + signals color-mode', () => {
    const { host, onChange } = mount();
    const sel = host.querySelector('[data-render-color-mode]') as HTMLSelectElement;
    sel.value = 'trap-distance';
    sel.dispatchEvent(new Event('change'));
    const kind = host.querySelector('[data-trap-kind]') as HTMLSelectElement;
    kind.value = 'circle';
    kind.dispatchEvent(new Event('change'));
    const cfg = loadColorModeConfig();
    expect(cfg.mode).toBe('trap-distance');
    expect(cfg.trap.kind).toBe('circle');
    expect(onChange).toHaveBeenLastCalledWith(COLOR_MODE_CHANGE_PATH);
  });
});
