// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { buildEasingPanel } from './animate-easing-panel';
import { type Animation } from './animation';

function anim(nKeyframes: number): Animation {
  return {
    keyframes: Array.from({ length: nKeyframes }, (_, i) => ({
      name: 'k', time: i, cx: 0, cy: 0, scale: 1, xforms: [], palette: { name: 'p', stops: [] },
    })) as Animation['keyframes'],
    interpolation: 'linear', interpolation_type: 'linear', palette_interpolation: 'rgb',
    hsv_rgb_palette_blend: 0, ntemporal_samples: 1, temporal_filter_type: 'box',
    temporal_filter_width: 1, temporal_filter_exp: 0,
  };
}

describe('buildEasingPanel', () => {
  it('renders one row per segment (keyframes-1)', () => {
    const el = buildEasingPanel({ animation: anim(3), onChange: () => {} });
    expect(el.querySelectorAll('select').length).toBe(2);
    expect(el.querySelectorAll('svg').length).toBe(2);
  });
  it('each select offers all five presets', () => {
    const el = buildEasingPanel({ animation: anim(2), onChange: () => {} });
    expect(Array.from(el.querySelectorAll('select option')).map((o) => (o as HTMLOptionElement).value))
      .toEqual(['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold']);
  });
  it('reflects an existing preset selection', () => {
    const a = anim(2);
    a.segmentEasing = [{ kind: 'preset', name: 'easeOut' }];
    const el = buildEasingPanel({ animation: a, onChange: () => {} });
    expect((el.querySelector('select') as HTMLSelectElement).value).toBe('easeOut');
  });
  it('fires onChange(segmentIndex, curve) when a select changes', () => {
    const onChange = vi.fn();
    const el = buildEasingPanel({ animation: anim(2), onChange });
    const sel = el.querySelector('select') as HTMLSelectElement;
    sel.value = 'easeIn';
    sel.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith(0, { kind: 'preset', name: 'easeIn' });
  });
  it('draws each thumbnail as an SVG <path> (no innerHTML)', () => {
    const el = buildEasingPanel({ animation: anim(2), onChange: () => {} });
    const path = el.querySelector('svg path');
    expect(path).not.toBeNull();
    expect((path as SVGPathElement).getAttribute('d')!.length).toBeGreaterThan(0);
  });
});
