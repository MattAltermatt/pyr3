// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  thirdsLines, gridLines, ringRadii, spokeLines, attachComposeOverlay, composeShows,
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
    const prefs = { composeOn: true, thirds: true, center: true, grid: true, rings: true, spokes: true, spokeFold: 6 };
    const h = attachComposeOverlay(host, { getPrefs: () => prefs, getContentRect: () => R });
    expect(() => h.draw()).not.toThrow();
  });
});

describe('composeShows (#364 master gate)', () => {
  const sel = { thirds: true, center: false, grid: false, rings: false, spokes: false, spokeFold: 6 };
  it('master off → never shows, even with a selection', () => {
    expect(composeShows({ composeOn: false, ...sel })).toBe(false);
  });
  it('master on + a selection → shows', () => {
    expect(composeShows({ composeOn: true, ...sel })).toBe(true);
  });
  it('master on + empty selection → does not show', () => {
    expect(composeShows({ ...COMPOSE_PREFS_DEFAULT })).toBe(false); // default: on, all guides off
  });
});
