// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { mountColorPicker } from './color-picker';

describe('color-picker', () => {
  it('mounts and emits onChange when hex is set', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const onChange = vi.fn();
    const h = mountColorPicker(host, { initial: { r: 1, g: 0, b: 0 }, anchor: host, onChange });
    const hex = host.querySelector('input[data-role="hex"]') as HTMLInputElement;
    expect(hex).toBeTruthy();
    hex.value = '#00ff00';
    hex.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.g).toBeCloseTo(1, 2); expect(last.r).toBeCloseTo(0, 2);
    h.destroy();
    expect(host.querySelector('input[data-role="hex"]')).toBeNull();
  });

  it('closes via the ✕ button and fires onClose', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const onClose = vi.fn();
    mountColorPicker(host, { initial: { r: 1, g: 0, b: 0 }, anchor: host, onChange: () => {}, onClose });
    (host.querySelector('button[data-role="close"]') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalled();
    expect(host.querySelector('.pyr3-color-picker')).toBeNull();
  });

  it('closes on an outside mousedown (deferred listener)', async () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    mountColorPicker(host, { initial: { r: 1, g: 0, b: 0 }, anchor: host, onChange: () => {} });
    await new Promise((r) => setTimeout(r, 0)); // let the deferred outside-listener attach
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(host.querySelector('.pyr3-color-picker')).toBeNull();
  });

  it('closes on Escape', async () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    mountColorPicker(host, { initial: { r: 1, g: 0, b: 0 }, anchor: host, onChange: () => {} });
    await new Promise((r) => setTimeout(r, 0));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(host.querySelector('.pyr3-color-picker')).toBeNull();
  });
});
