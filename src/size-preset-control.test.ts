// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { createSizePresetControl } from './size-preset-control';

describe('createSizePresetControl', () => {
  it('renders a select with a Custom sentinel + the 4K preset', () => {
    const c = createSizePresetControl({ initial: { width: 1920, height: 1080 }, onChange: () => {} });
    const select = c.el.querySelector('select')!;
    const opts = [...select.querySelectorAll('option')].map((o) => o.textContent);
    expect(opts).toContain('Custom');
    expect(opts).toContain('4K');
  });

  it('picking a preset fires onChange with that preset W×H', () => {
    const onChange = vi.fn();
    const c = createSizePresetControl({ initial: { width: 1920, height: 1080 }, onChange });
    const select = c.el.querySelector('select')!;
    select.value = '3840x2160';
    select.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ width: 3840, height: 2160 });
  });

  it('editing the W input fires onChange and lands the select on Custom', () => {
    const onChange = vi.fn();
    const c = createSizePresetControl({ initial: { width: 1920, height: 1080 }, onChange });
    const w = c.el.querySelector('input[data-size-w]') as HTMLInputElement;
    w.value = '1000';
    w.dispatchEvent(new Event('input'));
    expect(onChange).toHaveBeenCalledWith({ width: 1000, height: 1080 });
    expect((c.el.querySelector('select') as HTMLSelectElement).value).toBe('__custom__');
  });

  it('setSize updates inputs without firing onChange', () => {
    const onChange = vi.fn();
    const c = createSizePresetControl({ initial: { width: 1920, height: 1080 }, onChange });
    c.setSize({ width: 1080, height: 1080 });
    expect(c.getSize()).toEqual({ width: 1080, height: 1080 });
    expect(onChange).not.toHaveBeenCalled();
  });
});
