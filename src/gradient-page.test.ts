// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountGradientPage } from './gradient-page';
import { listMine } from './palette-library';

function installLocalStorageStub(): void {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as unknown as Storage;
}

describe('gradient-page (#115 T11)', () => {
  beforeEach(() => installLocalStorageStub());

  it('mounts editor + the four actions', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const h = mountGradientPage({ root });
    expect(root.querySelector('[data-role="strip"]')).toBeTruthy();
    for (const r of ['browse', 'save', 'export', 'import'])
      expect(root.querySelector(`[data-role="${r}"]`)).toBeTruthy();
    h.destroy();
  });

  it('saves the current palette to the mine library', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const h = mountGradientPage({ root });
    (root.querySelector('[data-role="name"]') as HTMLInputElement).value = 'mypal';
    (root.querySelector('[data-role="save"]') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(listMine().map((p) => p.name)).toContain('mypal');
    h.destroy();
  });

  it('Reset restores the seed palette', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const seed = { name: 'seedpal', stops: [
      { t: 0, r: 0, g: 0, b: 0 }, { t: 0.5, r: 0.5, g: 0.5, b: 0.5 }, { t: 1, r: 1, g: 1, b: 1 },
    ] };
    const h = mountGradientPage({ root, initialPalette: seed });
    expect(root.querySelectorAll('[data-role="handle"]').length).toBe(3);
    // mutate: resample to 8 handles
    (root.querySelector('[data-role="resample-n"]') as HTMLInputElement).value = '8';
    (root.querySelector('[data-role="resample"]') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(root.querySelectorAll('[data-role="handle"]').length).toBe(8);
    // reset
    (root.querySelector('[data-role="reset"]') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(root.querySelectorAll('[data-role="handle"]').length).toBe(3);
    expect((root.querySelector('[data-role="name"]') as HTMLInputElement).value).toBe('seedpal');
    h.destroy();
  });
});
