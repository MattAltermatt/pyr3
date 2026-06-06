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

  it('classifies all 4 DC entries + all 4 JWF entries', () => {
    const rows = listVariations();
    expect(rows.filter(r => r.source === 'dc')).toHaveLength(4);
    expect(rows.filter(r => r.source === 'jwf')).toHaveLength(4);
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

  it('renders all 107 variations across three groups', () => {
    expect(host.querySelectorAll('.pyr3-cat-item').length).toBe(107);
    expect(host.querySelectorAll('.pyr3-cat-group-head').length).toBe(3);
  });

  it('header count shows the grand total', () => {
    expect(host.querySelector('.pyr3-cat-sidebar-count')!.textContent).toBe('107');
  });

  it('search filters by name', () => {
    handle.setSearch('jul');
    // julia, julian, juliascope, wedge_julia
    expect(host.querySelectorAll('.pyr3-cat-item').length).toBe(4);
  });

  it('search filters by V-number prefix', () => {
    handle.setSearch('v10');
    // V10 hyperbolic + V100..V106 = 8 matches
    expect(host.querySelectorAll('.pyr3-cat-item').length).toBe(8);
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
    expect(host.querySelectorAll('.pyr3-cat-item').length).toBe(8); // only DC + JWF
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
