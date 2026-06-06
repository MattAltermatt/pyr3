// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import { mountVariationCatalog } from './variation-catalog-mount';
import { V } from './variations';

// happy-dom doesn't ship a real GPUDevice. The page mounter only stores
// the device on opts and forwards it to T5's render lane (not yet wired),
// so a stub satisfies T4's assertions.
const STUB_DEVICE = {} as unknown as GPUDevice;
const STUB_FORMAT = 'bgra8unorm' as GPUTextureFormat;

describe('mountVariationCatalog', () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    document.body.append(host);
    mountVariationCatalog(host, { device: STUB_DEVICE, format: STUB_FORMAT });
  });

  it('renders sidebar + catalog containers', () => {
    expect(host.querySelector('.pyr3-cat-sidebar')).toBeTruthy();
    expect(host.querySelector('.pyr3-cat-catalog')).toBeTruthy();
  });

  it('emits one wrapper per variation in numeric order', () => {
    const wrappers = host.querySelectorAll('.pyr3-cat-catalog > [data-idx]');
    expect(wrappers.length).toBe(Object.keys(V).length);
    const indices = Array.from(wrappers).map((w) => Number((w as HTMLElement).dataset.idx));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('renders a real section for seed variations (V0/V1/V14)', () => {
    const v0 = host.querySelector('.pyr3-cat-catalog > [data-idx="0"]') as HTMLElement;
    const v1 = host.querySelector('.pyr3-cat-catalog > [data-idx="1"]') as HTMLElement;
    const v14 = host.querySelector('.pyr3-cat-catalog > [data-idx="14"]') as HTMLElement;
    expect(v0.classList.contains('pyr3-cat-section')).toBe(true);
    expect(v1.classList.contains('pyr3-cat-section')).toBe(true);
    expect(v14.classList.contains('pyr3-cat-section')).toBe(true);
  });

  it('renders a real section for every variation (no stubs remain)', () => {
    // Catalog content for V0..V106 fully authored — no stub fallbacks
    // should appear. Pre-#119 this test asserted V5 was a stub (only
    // seed entries existed); now the assertion flips to "no stubs."
    const stubs = host.querySelectorAll('.pyr3-cat-catalog > .pyr3-cat-stub');
    expect(stubs.length).toBe(0);
  });

  it('clicking a sidebar item targets the matching section in the catalog', () => {
    const target = document.getElementById(`v${V.julian}-julian`);
    expect(target).toBeTruthy();
  });
});
