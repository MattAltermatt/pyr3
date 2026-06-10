// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import {
  mountSidebar,
  listVariations,
  type SidebarHandle,
} from './variation-catalog-sidebar';
import { V, getDisplayLabel } from './variations';

describe('listVariations', () => {
  it('returns every entry in V in numeric order', () => {
    const rows = listVariations();
    expect(rows).toHaveLength(Object.keys(V).length);
    const idxs = rows.map(r => r.idx);
    expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
  });

  it('classifies by provenance only — Direct-Color is not a source bucket (#222)', () => {
    const rows = listVariations();
    // #222: source is pure provenance (flam3 / jwf / novel), mirroring the
    // display-label namespace (V… / JWF… / P…). The Direct-Color capability is
    // orthogonal — carried by DC_VARIATION_SET, surfaced as a per-section pill.
    // The four dc_* ports (V99..V102 = JWF0..JWF3) classify as jwf; the
    // DC-capable pyr3 originals (newton P0, magnetic_pendulum P45, escape-time
    // P90..P93) classify as novel. No row is sourced 'dc'.
    expect(rows.some(r => (r.source as string) === 'dc')).toBe(false);
    expect(rows.filter(r => r.source === 'novel').length).toBeGreaterThanOrEqual(49);
    // jwf now also holds the four dc_* ports on top of the JWF port batches.
    expect(rows.filter(r => r.source === 'jwf').length).toBeGreaterThanOrEqual(8);
  });
});

describe('mountSidebar', () => {
  let host: HTMLElement;
  let handle: SidebarHandle;
  let jumpedTo: number[];

  beforeEach(() => {
    document.body.innerHTML = '<div id="host"></div>';
    host = document.getElementById('host')!;
    jumpedTo = [];
    handle = mountSidebar(host, { onJump: idx => jumpedTo.push(idx) });
  });

  it('renders every variation across three provenance groups (#222)', () => {
    const total = Object.keys(V).length;
    expect(host.querySelectorAll('.pyr3-cat-item').length).toBe(total);
    // flam3 / JWildfire ports / Novel pyr3 originals — DC is no longer a group.
    expect(host.querySelectorAll('.pyr3-cat-group-head').length).toBe(3);
  });

  it('header count shows the grand total', () => {
    expect(host.querySelector('.pyr3-cat-sidebar-count')!.textContent).toBe(String(Object.keys(V).length));
  });

  it('search filters by name', () => {
    handle.setSearch('jul');
    // julia, julian, juliascope, wedge_julia, juliaq (#114 batch 2b-a),
    // phoenix_julia (#121 L6), julia_outside (#121 L8), e_julia (#121 L10)
    expect(host.querySelectorAll('.pyr3-cat-item').length).toBe(8);
  });

  it('search filters by display label prefix', () => {
    handle.setSearch('jwf10');
    // JWF10 + JWF100..JWF109.
    const expected = Object.values(V).filter(idx => getDisplayLabel(idx).toLowerCase().includes('jwf10')).length;
    expect(host.querySelectorAll('.pyr3-cat-item').length).toBe(expected);
  });

  it('section with zero search matches hides its header', () => {
    handle.setSearch('cpow');
    // flam3=cpow (V41), jwf=cpow2 (V103) + cpow3 (V104); novel has no matches
    expect(host.querySelectorAll('.pyr3-cat-group-head').length).toBe(2);
  });

  it('clicking a group head toggles collapse', () => {
    const flam3Head = host.querySelector('.pyr3-cat-group-head[data-source="flam3"]') as HTMLElement;
    flam3Head.click();
    expect(host.querySelectorAll('.pyr3-cat-group-head.collapsed').length).toBe(1);
    // Only jwf + novel items visible (everything past the flam3 range).
    const nonFlam3 = Object.values(V).filter(idx => idx > 98).length;
    expect(host.querySelectorAll('.pyr3-cat-item').length).toBe(nonFlam3);
  });

  it('collapsed header still renders + can be re-expanded', () => {
    const novelHead = host.querySelector('.pyr3-cat-group-head[data-source="novel"]') as HTMLElement;
    novelHead.click();
    expect(host.querySelector('.pyr3-cat-group-head[data-source="novel"].collapsed')).toBeTruthy();
    novelHead.click();
    expect(host.querySelector('.pyr3-cat-group-head[data-source="novel"].collapsed')).toBeNull();
  });

  it('setActive(idx) marks the matching item active', () => {
    handle.setActive(V.julian);
    const active = host.querySelector('.pyr3-cat-item.active') as HTMLElement;
    expect(active.dataset.idx).toBe(String(V.julian));
  });

  it('item href uses the display-label namespace, not the raw idx (#215)', () => {
    // juliaq is registry idx 109 → JWF10; its href must read #jwf10-…, not #v109-….
    const jwf = host.querySelector(`.pyr3-cat-item[data-idx="${V.juliaq}"]`) as HTMLAnchorElement;
    expect(jwf.getAttribute('href')).toBe('#jwf10-juliaq');
    // flam3 stays on the v-namespace.
    const flam3 = host.querySelector(`.pyr3-cat-item[data-idx="${V.julian}"]`) as HTMLAnchorElement;
    expect(flam3.getAttribute('href')).toBe('#v14-julian');
  });

  it('clicking an item fires onJump with the idx', () => {
    const item = host.querySelector(`.pyr3-cat-item[data-idx="${V.julian}"]`) as HTMLElement;
    item.click();
    expect(jumpedTo).toEqual([V.julian]);
  });

  it('destroy() empties the host', () => {
    handle.destroy();
    expect(host.innerHTML).toBe('');
  });
});
