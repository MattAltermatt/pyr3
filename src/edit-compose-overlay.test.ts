// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  thirdsLines, gridLines, ringRadii, spokeLines, attachComposeOverlay, composeShows,
  goldenSpiralPoints, resolveSpokeFold, anyComposeGuideSelected, type Rect,
} from './edit-compose-overlay';
import { COMPOSE_PREFS_DEFAULT } from './edit-state';

const R = { x: 0, y: 0, w: 300, h: 150 };

describe('compose geometry (#364)', () => {
  it('thirdsLines: 2 vertical + 2 horizontal at 1/3 & 2/3', () => {
    const ls = thirdsLines(R);
    expect(ls).toHaveLength(4);
    expect(ls).toContainEqual([100, 0, 100, 150]);
    expect(ls).toContainEqual([200, 0, 200, 150]);
    expect(ls).toContainEqual([0, 50, 300, 50]);
    expect(ls).toContainEqual([0, 100, 300, 100]);
  });
  it('gridLines(n=4): 3 interior lines per axis = 6 total', () => {
    expect(gridLines(R, 4)).toHaveLength(6);
  });
  it('ringRadii: centered, radii at R/3, 2R/3, R of inscribed radius', () => {
    const { cx, cy, radii } = ringRadii(R); // inscribed radius = min(300,150)/2 = 75
    expect([cx, cy]).toEqual([150, 75]);
    expect(radii).toEqual([25, 50, 75]);
  });
  it('spokeLines: `fold` lines all starting at center', () => {
    expect(spokeLines(R, 6)).toHaveLength(6);
    for (const [x0, y0] of spokeLines(R, 6)) { expect([x0, y0]).toEqual([150, 75]); }
  });
});

describe('attachComposeOverlay', () => {
  function stub(el: HTMLElement) {
    el.getBoundingClientRect = () =>
      ({ x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 150, width: 300, height: 150, toJSON() {} }) as DOMRect;
  }
  it('mounts a canvas and removes it on destroy', () => {
    const host = document.createElement('div'); stub(host);
    const h = attachComposeOverlay(host, { getPrefs: () => ({ ...COMPOSE_PREFS_DEFAULT }), getContentRect: () => R });
    h.draw();
    expect(host.querySelector('canvas.pyr3-edit-compose-overlay')).toBeTruthy();
    h.destroy();
    expect(host.querySelector('canvas.pyr3-edit-compose-overlay')).toBeFalsy();
  });
  it('draws every guide active without throwing', () => {
    const host = document.createElement('div'); stub(host);
    const prefs = { ...COMPOSE_PREFS_DEFAULT, composeOn: true, thirds: true, center: true, grid: true, rings: true, spokes: true, goldenSpiral: true };
    const h = attachComposeOverlay(host, { getPrefs: () => prefs, getContentRect: () => R });
    expect(() => h.draw()).not.toThrow();
  });
});

describe('composeShows (#364 master gate)', () => {
  const sel = { ...COMPOSE_PREFS_DEFAULT, composeOn: true, thirds: true };
  it('master off → never shows, even with a selection', () => {
    expect(composeShows({ ...sel, composeOn: false })).toBe(false);
  });
  it('master on + a selection → shows', () => {
    expect(composeShows({ ...sel, composeOn: true })).toBe(true);
  });
  it('master on + empty selection → does not show', () => {
    expect(composeShows({ ...COMPOSE_PREFS_DEFAULT })).toBe(false); // default: on, all guides off
  });
  it('golden spiral alone arms the master gate (#402)', () => {
    expect(composeShows({ ...COMPOSE_PREFS_DEFAULT, goldenSpiral: true })).toBe(true);
  });
});

describe('anyComposeGuideSelected (shared guide-set source of truth)', () => {
  it('false when no guide is selected, regardless of master', () => {
    expect(anyComposeGuideSelected({ ...COMPOSE_PREFS_DEFAULT, composeOn: true })).toBe(false);
  });
  it('true for any single guide — including the golden spiral (#402)', () => {
    for (const k of ['thirds', 'center', 'grid', 'rings', 'spokes', 'goldenSpiral'] as const) {
      expect(anyComposeGuideSelected({ ...COMPOSE_PREFS_DEFAULT, [k]: true })).toBe(true);
    }
  });
});

describe('goldenSpiralPoints (#402)', () => {
  const R: Rect = { x: 10, y: 20, w: 300, h: 200 };
  it('returns a dense polyline within the content rect bbox', () => {
    const pts = goldenSpiralPoints(R, 0);
    expect(pts.length).toBeGreaterThan(50);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(R.x - 0.5);
      expect(x).toBeLessThanOrEqual(R.x + R.w + 0.5);
      expect(y).toBeGreaterThanOrEqual(R.y - 0.5);
      expect(y).toBeLessThanOrEqual(R.y + R.h + 0.5);
    }
  });
  it('orientation flips mirror across the rect center', () => {
    const ccx = R.x + R.w / 2, ccy = R.y + R.h / 2;
    const base = goldenSpiralPoints(R, 0);
    const flipX = goldenSpiralPoints(R, 1); // X flip
    const flipY = goldenSpiralPoints(R, 3); // Y flip
    for (let i = 0; i < base.length; i++) {
      expect(flipX[i]![0]).toBeCloseTo(2 * ccx - base[i]![0], 6);
      expect(flipX[i]![1]).toBeCloseTo(base[i]![1], 6);
      expect(flipY[i]![0]).toBeCloseTo(base[i]![0], 6);
      expect(flipY[i]![1]).toBeCloseTo(2 * ccy - base[i]![1], 6);
    }
  });
});

describe('resolveSpokeFold (#403 — spokes auto-match symmetry)', () => {
  it('auto mode uses the genome symmetry order when present', () => {
    const p = { ...COMPOSE_PREFS_DEFAULT, spokes: true, spokesAuto: true, spokeFold: 6 };
    expect(resolveSpokeFold(p, 5)).toBe(5);
  });
  it('auto mode falls back to the manual fold when no symmetry', () => {
    const p = { ...COMPOSE_PREFS_DEFAULT, spokes: true, spokesAuto: true, spokeFold: 6 };
    expect(resolveSpokeFold(p, null)).toBe(6);
  });
  it('manual mode ignores the symmetry order', () => {
    const p = { ...COMPOSE_PREFS_DEFAULT, spokes: true, spokesAuto: false, spokeFold: 6 };
    expect(resolveSpokeFold(p, 5)).toBe(6);
  });
});
