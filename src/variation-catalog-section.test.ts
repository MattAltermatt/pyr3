// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import { mountSection, type SectionHandle, type SectionState } from './variation-catalog-section';
import { getCatalogDoc } from './variation-catalog-data';
import { V } from './variations';

describe('mountSection', () => {
  let host: HTMLElement;
  let lastChange: SectionState | null;
  let handle: SectionHandle;

  function mount(idx: number): SectionHandle {
    lastChange = null;
    host = document.createElement('div');
    document.body.append(host);
    handle = mountSection(host, getCatalogDoc(idx)!, {
      onParamsChange: (s) => { lastChange = s; },
    });
    return handle;
  }

  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('renders header + source pill + formula + 2 panes + blurb + open-link', () => {
    mount(V.sinusoidal);
    expect(host.querySelector('.pyr3-cat-section-name')?.textContent).toContain('sinusoidal');
    expect(host.querySelector('.pyr3-cat-section-name')?.textContent).toContain('V1');
    expect(host.querySelector('.pyr3-cat-section-source')?.textContent).toContain('flam3');
    expect(host.querySelector('.pyr3-cat-section-formula')).toBeTruthy();
    expect(host.querySelectorAll('.pyr3-cat-pane').length).toBe(2);
    expect(host.querySelector('.pyr3-cat-section-blurb')?.textContent).toBeTruthy();
    const link = host.querySelector('.pyr3-cat-open-link') as HTMLAnchorElement;
    expect(link.href).toContain('from=catalog');
    expect(link.href).toContain('v=1');
  });

  it('renders the desktop "Create with this" link deep-linking /creator?vars=<name> (#448)', () => {
    mount(V.sinusoidal);
    const create = host.querySelector('.pyr3-cat-section-create') as HTMLAnchorElement | null;
    expect(create).toBeTruthy();
    expect(create!.getAttribute('href')).toBe('/creator?vars=sinusoidal');
  });

  it('mounts an SVG warp diagram for variations with warpFn', () => {
    mount(V.sinusoidal);
    expect(host.querySelector('.pyr3-cat-pane svg')).toBeTruthy();
  });

  it('exposes a canvas for the flame pane', () => {
    const h = mount(V.sinusoidal);
    expect(h.getFlameCanvas()).toBeInstanceOf(HTMLCanvasElement);
  });

  it('V0 linear renders the controls-empty note instead of sliders', () => {
    mount(V.linear);
    expect(host.querySelector('.pyr3-cat-controls-empty')).toBeTruthy();
    expect(host.querySelector('input.pyr3-cat-scrub')).toBeNull();
  });

  it('non-V0 entries get a weight slider', () => {
    mount(V.sinusoidal);
    const w = host.querySelector('input[data-control="weight"]') as HTMLInputElement;
    expect(w).toBeTruthy();
    expect(w.value).toBe('1');
  });

  it('parameterized variations render one scrubby per param', () => {
    mount(V.julian);
    expect(host.querySelectorAll('input[data-control="param"]').length).toBe(2);
  });

  it('weight slider input fires onParamsChange', () => {
    mount(V.sinusoidal);
    const w = host.querySelector('input[data-control="weight"]') as HTMLInputElement;
    w.value = '0.4';
    w.dispatchEvent(new Event('input'));
    expect(lastChange?.weight).toBeCloseTo(0.4);
  });

  it('reset button restores a param to its default', () => {
    mount(V.julian);
    const power = host.querySelector('input[data-control="param"]') as HTMLInputElement;
    power.value = '7';
    power.dispatchEvent(new Event('input'));
    expect(lastChange?.params[0]).toBe(7);
    // Reset for the POWER row is the SECOND .pyr3-cat-reset (the first is
    // the weight row's reset). Use the power row's own scope.
    const powerRow = power.closest('.pyr3-cat-control-row') as HTMLElement;
    (powerRow.querySelector('.pyr3-cat-reset') as HTMLElement).click();
    // Catalog-specific default for julian.power is 2 (overrides
    // VARIATION_DEFAULTS=[1,1] which would render as degenerate identity).
    expect(lastChange?.params[0]).toBe(2);
  });

  it('updates the open-in-editor link as state changes', () => {
    mount(V.julian);
    const w = host.querySelector('input[data-control="weight"]') as HTMLInputElement;
    w.value = '0.5';
    w.dispatchEvent(new Event('input'));
    const link = host.querySelector('.pyr3-cat-open-link') as HTMLAnchorElement;
    expect(link.href).toContain('w=0.5');
  });

  it('setIterating(true) un-hides the live dot', () => {
    const h = mount(V.sinusoidal);
    const dot = host.querySelector('.pyr3-cat-live-dot') as HTMLElement;
    expect(dot.classList.contains('hidden')).toBe(true);
    h.setIterating(true);
    expect(dot.classList.contains('hidden')).toBe(false);
  });

  it('destroy() empties the host', () => {
    const h = mount(V.sinusoidal);
    h.destroy();
    expect(host.childNodes.length).toBe(0);
  });
});
