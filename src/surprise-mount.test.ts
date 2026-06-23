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
  // stub the GPU renderer: never resolves — keeps tiles in "pending" state.
  vi.spyOn(render, 'makeGpuRenderThumb').mockReturnValue({ renderThumb: () => new Promise(() => {}), destroy: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('mountSurprisePage (v2 #surprise-v2)', () => {
  const opts = { device: {} as unknown as GPUDevice, format: 'rgba8unorm' as GPUTextureFormat };

  it('renders the 🎲 Reroll control + settings toggle + wall undo/redo, and NO tray', () => {
    const host = document.createElement('div');
    const h = mountSurprisePage(host, opts);
    expect(host.querySelector('[data-role="reroll"]')?.textContent).toContain('Reroll');
    expect(host.querySelector('[data-role="settings-toggle"]')).toBeTruthy();
    expect(host.querySelector('[data-role="wall-undo"]')).toBeTruthy();
    expect(host.querySelector('[data-role="wall-redo"]')).toBeTruthy();
    expect(host.querySelector('[data-role="tray"]')).toBeNull(); // tray removed
    h.destroy();
  });

  it('lays out at least one tile slot on boot', () => {
    const host = document.createElement('div');
    const h = mountSurprisePage(host, opts);
    expect(host.querySelectorAll('[data-role="tile"]').length).toBeGreaterThanOrEqual(1);
    h.destroy();
  });

  it('clicking a tile opens the editor in a new tab (window.open)', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const host = document.createElement('div');
    const h = mountSurprisePage(host, opts);
    const tile = host.querySelector('[data-role="tile"]') as HTMLElement;
    tile.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(open).toHaveBeenCalledWith('/editor', '_blank', 'noopener');
    h.destroy();
  });

  it('the settings toggle reveals the settings panel host', () => {
    const host = document.createElement('div');
    const h = mountSurprisePage(host, opts);
    const panelHost = host.querySelector('[data-role="panel-host"]') as HTMLElement;
    expect(panelHost.style.display).toBe('none');
    (host.querySelector('[data-role="settings-toggle"]') as HTMLElement).click();
    expect(panelHost.style.display).not.toBe('none');
    h.destroy();
  });

  it('the Reroll button is not in the dirty/apply state on boot', () => {
    const host = document.createElement('div');
    const h = mountSurprisePage(host, opts);
    const reroll = host.querySelector('[data-role="reroll"]') as HTMLElement;
    expect(reroll.classList.contains('dirty')).toBe(false);
    expect(reroll.textContent).toBe('🎲 Reroll');
    h.destroy();
  });

  it('Stop is enabled while rendering and disabled after it halts (#surprise-v2)', () => {
    const host = document.createElement('div');
    const h = mountSurprisePage(host, opts);
    const stop = host.querySelector('[data-role="stop"]') as HTMLButtonElement;
    // GPU stub never resolves → tiles stay queued → rendering in progress.
    expect(stop.disabled).toBe(false);
    stop.click();
    expect(stop.disabled).toBe(true); // halted → idle
    h.destroy();
  });

  it('destroy() empties the host', () => {
    const host = document.createElement('div');
    mountSurprisePage(host, opts).destroy();
    expect(host.childElementCount).toBe(0);
  });
});
