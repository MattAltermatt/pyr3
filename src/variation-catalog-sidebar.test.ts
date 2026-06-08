// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import {
  mountSidebar,
  listVariations,
  type SidebarHandle,
} from './variation-catalog-sidebar';
import { V } from './variations';

describe('listVariations', () => {
  it('returns every entry in V in numeric order', () => {
    const rows = listVariations();
    expect(rows).toHaveLength(Object.keys(V).length);
    const idxs = rows.map(r => r.idx);
    expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
  });

  it('classifies the DC family + at least the original JWF batch + the novel pyr3 originals', () => {
    const rows = listVariations();
    // DC family: 4 originals (dc_linear..dc_cylinder) plus newton (V220, #133),
    // pyr3's first position-warp + DC variation outside the V99..V102 range.
    // Novel pyr3 originals: V221..V224 (#133) — blaschke, cayley, complex_gamma,
    // lambert_w, grep-verified absent from JWildfire source.
    // JWF count grows as batches ship — lower-bound assertion stays loose.
    expect(rows.filter(r => r.source === 'dc')).toHaveLength(5);
    expect(rows.filter(r => r.source === 'novel')).toHaveLength(37);
    expect(rows.filter(r => r.source === 'jwf').length).toBeGreaterThanOrEqual(4);
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

  it('renders every variation across four groups', () => {
    const total = Object.keys(V).length;
    expect(host.querySelectorAll('.pyr3-cat-item').length).toBe(total);
    // flam3 / DC family / JWildfire ports / Novel pyr3 originals (#133).
    expect(host.querySelectorAll('.pyr3-cat-group-head').length).toBe(4);
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

  it('search filters by V-number prefix', () => {
    handle.setSearch('v10');
    // V10 hyperbolic + every V10x — count all V10..V10? matches dynamically.
    const expected = Object.values(V).filter(idx => ('v' + idx).includes('v10')).length;
    expect(host.querySelectorAll('.pyr3-cat-item').length).toBe(expected);
  });

  it('section with zero search matches hides its header', () => {
    handle.setSearch('cpow');
    // flam3=cpow (V41), jwf=cpow2 (V103) + cpow3 (V104); DC has no matches
    expect(host.querySelectorAll('.pyr3-cat-group-head').length).toBe(2);
  });

  it('clicking a group head toggles collapse', () => {
    const flam3Head = host.querySelector('.pyr3-cat-group-head[data-source="flam3"]') as HTMLElement;
    flam3Head.click();
    expect(host.querySelectorAll('.pyr3-cat-group-head.collapsed').length).toBe(1);
    // Only DC + JWF items visible.
    const nonFlam3 = Object.values(V).filter(idx => idx > 98).length;
    expect(host.querySelectorAll('.pyr3-cat-item').length).toBe(nonFlam3);
  });

  it('collapsed header still renders + can be re-expanded', () => {
    const dcHead = host.querySelector('.pyr3-cat-group-head[data-source="dc"]') as HTMLElement;
    dcHead.click();
    expect(host.querySelector('.pyr3-cat-group-head[data-source="dc"].collapsed')).toBeTruthy();
    dcHead.click();
    expect(host.querySelector('.pyr3-cat-group-head[data-source="dc"].collapsed')).toBeNull();
  });

  it('setActive(idx) marks the matching item active', () => {
    handle.setActive(V.julian);
    const active = host.querySelector('.pyr3-cat-item.active') as HTMLElement;
    expect(active.dataset.idx).toBe(String(V.julian));
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
