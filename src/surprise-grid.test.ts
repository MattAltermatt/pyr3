import { describe, it, expect } from 'vitest';
import { computeGrid, DENSITY_PX } from './surprise-grid';

describe('computeGrid (#surprise-v2)', () => {
  it('fill mode: tiles at the density target, count = cols*rows, fits width', () => {
    const g = computeGrid({ w: 1920, h: 1080, gap: 8 }, { mode: 'fill', density: 'm' });
    expect(g.cols).toBeGreaterThan(0);
    expect(g.rows).toBeGreaterThan(0);
    expect(g.count).toBe(g.cols * g.rows);
    expect(g.cols * (g.tile + 8)).toBeLessThanOrEqual(1920 + 8);
    expect(Math.abs(g.tile - DENSITY_PX.m)).toBeLessThan(DENSITY_PX.m); // near target
  });
  it('set mode: exactly N tiles, no vertical overflow (no scroll)', () => {
    const g = computeGrid({ w: 1920, h: 1080, gap: 8 }, { mode: 'set', n: 24 });
    expect(g.count).toBe(24);
    expect(g.cols * g.rows).toBeGreaterThanOrEqual(24);
    expect(g.rows * (g.tile + 8)).toBeLessThanOrEqual(1080 + 8);
    expect(g.tile).toBeGreaterThan(0);
  });
  it('set mode large N shrinks tiles rather than scrolling', () => {
    const g = computeGrid({ w: 1280, h: 720, gap: 6 }, { mode: 'set', n: 100 });
    expect(g.count).toBe(100);
    expect(g.rows * (g.tile + 6)).toBeLessThanOrEqual(720 + 6);
  });
  it('set mode n=1 yields a single large tile within the viewport', () => {
    const g = computeGrid({ w: 1000, h: 800, gap: 8 }, { mode: 'set', n: 1 });
    expect(g.count).toBe(1);
    expect(g.tile).toBeLessThanOrEqual(800);
  });
});
