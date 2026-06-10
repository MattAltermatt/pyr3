// @vitest-environment happy-dom
//
// P7 (#212) — capability-gate assertions for the Export sequence button on
// /v1/animate. Mounting the page doesn't require a real GPU device since
// nothing touches `device` until an Animation is loaded (handleFile); the
// button stamp itself is purely DOM + capability lookup.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { mountAnimatePage } from './animate-mount';
import { _resetCapabilityForTest, fetchCapability, GHPAGES_DEFAULT } from './capability';

function fakeDevice(): GPUDevice {
  return {} as GPUDevice;
}
function fakeFormat(): GPUTextureFormat {
  return 'rgba8unorm' as GPUTextureFormat;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  _resetCapabilityForTest();
  document.body.replaceChildren();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function primeCapability(cap: typeof GHPAGES_DEFAULT | { backend: 'dawn-node'; max_quality: null; can_write_files: boolean; can_render_animation: boolean }): Promise<void> {
  globalThis.fetch = ((async () => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(cap),
  })) as unknown) as typeof fetch;
  await fetchCapability();
}

describe('mountAnimatePage — Export button capability gate', () => {
  it('disables Export with the install-pyr3 tooltip on gh-pages', async () => {
    await primeCapability(GHPAGES_DEFAULT);
    const root = document.createElement('div');
    document.body.appendChild(root);

    mountAnimatePage({ root, device: fakeDevice(), format: fakeFormat() });

    const btn = root.querySelector<HTMLButtonElement>('[data-export-sequence]');
    expect(btn).toBeTruthy();
    expect(btn!.disabled).toBe(true);
    expect(btn!.title).toMatch(/Install pyr3 locally/);
  });

  it('disables Export with a "load a flame" tooltip when pyr3 serve is hosting but nothing is loaded', async () => {
    await primeCapability({
      backend: 'dawn-node',
      max_quality: null,
      can_write_files: true,
      can_render_animation: true,
    });
    const root = document.createElement('div');
    document.body.appendChild(root);

    mountAnimatePage({ root, device: fakeDevice(), format: fakeFormat() });

    const btn = root.querySelector<HTMLButtonElement>('[data-export-sequence]');
    expect(btn).toBeTruthy();
    expect(btn!.disabled).toBe(true);
    expect(btn!.title).toMatch(/Load a multi-keyframe/);
    expect(btn!.title).not.toMatch(/Install pyr3 locally/);
  });

  it('click on the disabled Export button does NOT open a modal', async () => {
    await primeCapability(GHPAGES_DEFAULT);
    const root = document.createElement('div');
    document.body.appendChild(root);

    mountAnimatePage({ root, device: fakeDevice(), format: fakeFormat() });

    const btn = root.querySelector<HTMLButtonElement>('[data-export-sequence]')!;
    btn.click();
    expect(document.querySelector('[data-animate-export-modal]')).toBeNull();
  });

  it('renders the Load button alongside Export', async () => {
    await primeCapability(GHPAGES_DEFAULT);
    const root = document.createElement('div');
    document.body.appendChild(root);

    mountAnimatePage({ root, device: fakeDevice(), format: fakeFormat() });

    // Load button by content match — no data attribute for it.
    const buttons = Array.from(root.querySelectorAll('button'));
    const load = buttons.find((b) => b.textContent?.includes('Load .flam3'));
    const exportBtn = buttons.find((b) => b.hasAttribute('data-export-sequence'));
    expect(load).toBeTruthy();
    expect(exportBtn).toBeTruthy();
  });
});
