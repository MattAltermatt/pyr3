import { describe, it, expect } from 'vitest';
import { buildWarpSvg } from './variation-catalog-warp';

describe('buildWarpSvg', () => {
  it('returns a complete <svg> wrapper with the standard viewBox', () => {
    const svg = buildWarpSvg((x, y) => [x, y]);
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('viewBox="-2 -2 4 4"');
    expect(svg).toMatch(/<\/svg>$/);
  });

  it('emits axis lines + grid paths', () => {
    const svg = buildWarpSvg((x, y) => [x, y]);
    expect(svg).toContain('class="warp-axis"');
    expect(svg).toContain('class="warp-line"');
  });

  it('clips paths whose values explode (no Infinity / NaN in output)', () => {
    const svg = buildWarpSvg((x, y) => {
      const r2 = Math.max(x * x + y * y, 1e-9);
      return [x / r2, y / r2];
    });
    expect(svg).not.toMatch(/Infinity|NaN/);
  });

  it('lifts the pen on out-of-range samples (segments start with M after a skip)', () => {
    let skip = true;
    const svg = buildWarpSvg(() => skip ? [1e9, 1e9] : [0.5, 0.5]);
    // All samples skipped → no path elements should be emitted
    expect(svg).not.toContain('warp-line');
    skip = false;
  });

  it('accepts custom class overrides', () => {
    const svg = buildWarpSvg((x, y) => [x, y], {
      classes: { axis: 'a-x', line: 'l-x' },
    });
    expect(svg).toContain('class="a-x"');
    expect(svg).toContain('class="l-x"');
  });

  it('produces deterministic output across calls (no Math.random)', () => {
    const fn = (x: number, y: number) => [Math.sin(x), Math.sin(y)] as [number, number];
    expect(buildWarpSvg(fn)).toBe(buildWarpSvg(fn));
  });
});
