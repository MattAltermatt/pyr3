// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountGradientPage, gradReturnNav } from './gradient-page';
import { writeGradientHandoff, consumeGradientReturn } from './edit-state';
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

const FLAME_PAL = {
  name: 'flame', stops: Array.from({ length: 256 }, (_, i) => ({
    t: i / 255, r: i / 255, g: 0, b: 1 - i / 255,
  })),
};

describe('gradient page round-trip mode', () => {
  beforeEach(() => { installLocalStorageStub(); document.body.replaceChildren(); });

  it('shows read-only strip + Modify + Apply when a handoff is present', () => {
    writeGradientHandoff(FLAME_PAL);
    const root = document.createElement('div');
    mountGradientPage({ root });
    expect(root.querySelector('.pyr3-gradient-readonly-strip')).toBeTruthy();
    expect(root.querySelector('[data-role="modify"]')).toBeTruthy();
    expect(root.querySelector('[data-role="apply"]')).toBeTruthy();
  });

  it('no Apply button in standalone mode', () => {
    const root = document.createElement('div');
    mountGradientPage({ root });
    expect(root.querySelector('[data-role="apply"]')).toBeNull();
  });

  it('Modify → confirm resamples to ~16 editable stops', () => {
    writeGradientHandoff(FLAME_PAL);
    const root = document.createElement('div');
    mountGradientPage({ root });
    (root.querySelector('[data-role="modify"]') as HTMLElement).click();
    (root.querySelector('[data-role="modify-confirm"]') as HTMLElement).click();
    // the live editor is now mounted (read-only strip gone)
    expect(root.querySelector('.pyr3-gradient-readonly-strip')).toBeNull();
  });

  it('Apply writes the return payload and navigates', () => {
    writeGradientHandoff(FLAME_PAL);
    let navd = false;
    gradReturnNav.go = () => { navd = true; };
    const root = document.createElement('div');
    mountGradientPage({ root });
    (root.querySelector('[data-role="apply"]') as HTMLElement).click();
    expect(consumeGradientReturn()).toBeTruthy();
    expect(navd).toBe(true);
  });

  it('Reset before Modify does NOT bypass the gate (stays read-only)', () => {
    // Regression (#266 review): Reset must not silently mount the live editor
    // before the user opts into the lossy conversion via Modify + confirm.
    writeGradientHandoff(FLAME_PAL);
    const root = document.createElement('div');
    mountGradientPage({ root });
    (root.querySelector('[data-role="reset"]') as HTMLElement).click();
    // Gate intact: read-only strip + Modify button still present, no editor.
    expect(root.querySelector('.pyr3-gradient-readonly-strip')).toBeTruthy();
    expect(root.querySelector('[data-role="modify"]')).toBeTruthy();
    expect(root.querySelector('[data-role="handle"]')).toBeNull();
  });

  function makeStops(n: number): { t: number; r: number; g: number; b: number }[] {
    return Array.from({ length: n }, (_, i) => ({
      t: i / (n - 1), r: i / (n - 1), g: 0.5, b: 1 - i / (n - 1),
    }));
  }

  it('an already-sparse gradient opens editable — sparse fallback, no gate (#266)', () => {
    // ≤16 stops → opens directly editable even without the editable flag
    // (durable fallback that survives a reload losing custom provenance).
    writeGradientHandoff({ name: 'custom gradient', stops: makeStops(16) });
    const root = document.createElement('div');
    mountGradientPage({ root });
    expect(root.querySelector('.pyr3-gradient-readonly-strip')).toBeNull();
    expect(root.querySelector('[data-role="modify"]')).toBeNull();
    expect(root.querySelectorAll('[data-role="handle"]').length).toBe(16); // live editor
    expect(root.querySelector('[data-role="apply"]')).toBeTruthy();        // still round-trip
    expect(root.querySelector('[data-role="cancel-return"]')).toBeTruthy();
  });

  it('a custom gradient with >16 stops opens editable via the editable flag (#266)', () => {
    // 30 hand-placed stops, flagged custom (paletteSource was 'custom') → the
    // provenance flag wins over stop-count: opens editable, no Modify gate.
    writeGradientHandoff({ name: 'custom gradient', stops: makeStops(30) }, true);
    const root = document.createElement('div');
    mountGradientPage({ root });
    expect(root.querySelector('.pyr3-gradient-readonly-strip')).toBeNull();
    expect(root.querySelector('[data-role="modify"]')).toBeNull();
    expect(root.querySelectorAll('[data-role="handle"]').length).toBe(30);
  });

  it('a dense palette stays gated even when flagged custom (#266)', () => {
    // 256 stops (a library palette pulled in via Browse, applied as custom) is
    // too dense to render handle-per-stop → still goes behind the Modify gate.
    writeGradientHandoff({ name: 'custom gradient', stops: makeStops(256) }, true);
    const root = document.createElement('div');
    mountGradientPage({ root });
    expect(root.querySelector('.pyr3-gradient-readonly-strip')).toBeTruthy();
    expect(root.querySelector('[data-role="modify"]')).toBeTruthy();
  });

  it('Cancel, return to flame navigates WITHOUT writing a return (#266)', () => {
    writeGradientHandoff(FLAME_PAL);
    let navd = false;
    gradReturnNav.go = () => { navd = true; };
    const root = document.createElement('div');
    mountGradientPage({ root });
    (root.querySelector('[data-role="cancel-return"]') as HTMLElement).click();
    expect(navd).toBe(true);
    expect(consumeGradientReturn()).toBeNull(); // flame keeps its palette
  });
});
