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

  it('renders the 🎲 Reroll control + three bars + wall undo/redo, and NO tray/popover/standalone-stop', () => {
    const host = document.createElement('div');
    const h = mountSurprisePage(host, opts);
    // Reroll exists (text is state-dependent — "■ Stop" while the boot wall renders).
    expect(host.querySelector('[data-role="reroll"]')).toBeTruthy();
    // The standalone Stop button was retired — Reroll doubles as Stop.
    expect(host.querySelector('[data-role="stop"]')).toBeNull();
    // #433 — the ⚙ popover is gone; GENERATE + VARIATIONS are always-visible bars.
    expect(host.querySelector('[data-role="settings-toggle"]')).toBeNull();
    expect(host.querySelector('[data-bar="generate"]')).toBeTruthy();
    expect(host.querySelector('[data-bar="variations"]')).toBeTruthy();
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

  it('per-bar Reset commits without rerolling (#433)', () => {
    const host = document.createElement('div');
    const h = mountSurprisePage(host, opts);
    const tilesBefore = host.querySelectorAll('[data-role="tile"]').length;
    // change a generation knob then reset it — wall must not regenerate (apply
    // waits for 🎲 Reroll), so the dirty cue should be set, tiles unchanged.
    (host.querySelector('[data-role="density-l"]') as HTMLButtonElement).click();
    (host.querySelector('[data-role="reset-generation"]') as HTMLButtonElement).click();
    expect(host.querySelectorAll('[data-role="tile"]').length).toBe(tilesBefore);
    h.destroy();
  });

  it('the Reroll button is not in the dirty/apply state on boot', () => {
    const host = document.createElement('div');
    const h = mountSurprisePage(host, opts);
    const reroll = host.querySelector('[data-role="reroll"]') as HTMLButtonElement;
    expect(reroll.classList.contains('dirty')).toBe(false);
    reroll.click(); // halt the boot render → idle
    expect(reroll.textContent).toBe('🎲 Reroll');
    expect(reroll.classList.contains('dirty')).toBe(false);
    h.destroy();
  });

  it('Reroll doubles as Stop: shows ■ Stop while rendering, halts on click, then idles to 🎲 Reroll', () => {
    const host = document.createElement('div');
    const h = mountSurprisePage(host, opts);
    const reroll = host.querySelector('[data-role="reroll"]') as HTMLButtonElement;
    // GPU stub never resolves → tiles stay queued → rendering in progress.
    expect(reroll.textContent).toBe('■ Stop');
    expect(reroll.classList.contains('stopping')).toBe(true);
    reroll.click(); // halt
    expect(reroll.textContent).toBe('🎲 Reroll');
    expect(reroll.classList.contains('stopping')).toBe(false);
    h.destroy();
  });

  it('destroy() empties the host', () => {
    const host = document.createElement('div');
    mountSurprisePage(host, opts).destroy();
    expect(host.childElementCount).toBe(0);
  });
});
