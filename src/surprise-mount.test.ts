// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mountSurprisePage } from './surprise-mount';
import * as render from './surprise-render';

function makeStorageStub(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null, removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); } } as Storage;
}
beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorageStub());
  // stub the GPU renderer: never actually renders — keeps the wall in "pending" state
  vi.spyOn(render, 'makeGpuRenderThumb').mockReturnValue({ renderThumb: () => new Promise(() => {}), destroy: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('mountSurprisePage', () => {
  const opts = { device: {} as unknown as GPUDevice, format: 'rgba8unorm' as GPUTextureFormat };
  it('renders the Surprise-more control and an empty tray', () => {
    const host = document.createElement('div');
    const h = mountSurprisePage(host, opts);
    expect(host.textContent).toContain('Surprise more');
    expect(host.querySelector('[data-role="tray"]')).toBeTruthy();
    expect(host.querySelector('[data-role="tray-empty"]')).toBeTruthy();
    h.destroy();
  });
  it('lays out BATCH tile slots in the wall', () => {
    const host = document.createElement('div');
    const h = mountSurprisePage(host, opts);
    expect(host.querySelectorAll('[data-role="tile"]').length).toBeGreaterThanOrEqual(16);
    h.destroy();
  });
  it('destroy() empties the host', () => {
    const host = document.createElement('div');
    mountSurprisePage(host, opts).destroy();
    expect(host.childElementCount).toBe(0);
  });
});
