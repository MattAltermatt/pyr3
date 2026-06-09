// @vitest-environment happy-dom
//
// Unit tests for the shared render-mode bar (#176 Task 3). The bar mounts in
// both the editor (/v1/edit) and the viewer (/v1) and splits into a PREVIEW
// side (tier + quality, off-ladder default 25) and a RENDER side (size
// dropdown + W/H + quality + Save Render).
//
// DOM contract is hook-attribute-driven (data-tier, data-preview-q,
// data-render-q, data-render-w, data-render-h, data-render-q-input,
// data-render-preset-label, data-save-render, data-side) so tests don't
// couple to CSS class names that Task 8 will lock in.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountRenderModeBar, type RenderModeBarOpts } from './render-mode-bar';
import {
  DEFAULT_PREVIEW_CONFIG,
  loadPreviewConfig,
  type PreviewRenderConfig,
} from './render-mode-config';

// Map-backed localStorage stub — Storage.prototype spies trip CI per the
// project's auto-memory note; install onto globalThis.localStorage instead.
function installLocalStorageStub(): { clear: () => void } {
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  (globalThis as { localStorage: Storage }).localStorage = stub as unknown as Storage;
  return { clear: () => store.clear() };
}

interface TestHarness {
  host: HTMLElement;
  preview: PreviewRenderConfig;
  renderSize: { width: number; height: number };
  renderQuality: number;
  saveCalls: number;
  toastCalls: string[];
  changeCalls: number;
  canSaveFlag: boolean;
  opts: RenderModeBarOpts;
}

function makeHarness(over: Partial<TestHarness> = {}): TestHarness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const h: TestHarness = {
    host,
    preview: { ...DEFAULT_PREVIEW_CONFIG },
    renderSize: { width: 3840, height: 2160 },
    renderQuality: 100,
    saveCalls: 0,
    toastCalls: [],
    changeCalls: 0,
    canSaveFlag: true,
    opts: null as unknown as RenderModeBarOpts,
    ...over,
  };
  h.opts = {
    host: h.host,
    getPreviewConfig: () => h.preview,
    setPreviewConfig: (cfg) => { h.preview = cfg; },
    getRenderSize: () => h.renderSize,
    setRenderSize: (s) => { h.renderSize = s; },
    getRenderQuality: () => h.renderQuality,
    setRenderQuality: (q) => { h.renderQuality = q; },
    onSaveRender: vi.fn(async () => { h.saveCalls++; }),
    canSave: () => h.canSaveFlag,
    showToast: (m) => { h.toastCalls.push(m); },
    onChange: () => { h.changeCalls++; },
  };
  return h;
}

beforeEach(() => {
  installLocalStorageStub();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('render-mode-bar — shell', () => {
  it('mounts a PREVIEW side and a RENDER side', () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    expect(h.host.querySelector('[data-side="preview"]')).toBeTruthy();
    expect(h.host.querySelector('[data-side="render"]')).toBeTruthy();
  });

  it('PREVIEW side carries the side label', () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const side = h.host.querySelector('[data-side="preview"]') as HTMLElement;
    expect(side.textContent?.toUpperCase()).toContain('PREVIEW');
  });

  it('RENDER side carries the side label', () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const side = h.host.querySelector('[data-side="render"]') as HTMLElement;
    expect(side.textContent?.toUpperCase()).toContain('RENDER');
  });

  it('exposes 3 tier buttons (fast/balanced/sharp) with Balanced on by default', () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const tiers = h.host.querySelectorAll('[data-tier]');
    expect(tiers.length).toBe(3);
    const balanced = h.host.querySelector('[data-tier="balanced"]') as HTMLElement;
    expect(balanced.classList.contains('on')).toBe(true);
  });

  it('exposes 5 preview quality buttons (10/20/30/40/50), Q30 highlighted on default', () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const qs = h.host.querySelectorAll('[data-preview-q]');
    expect(qs.length).toBe(5);
    const vals = [...qs].map((e) => (e as HTMLElement).dataset['previewQ']);
    expect(vals).toEqual(['10', '20', '30', '40', '50']);
    // Default quality 30 is on-ladder — exactly one button highlighted.
    const on = h.host.querySelectorAll('[data-preview-q].on');
    expect(on.length).toBe(1);
    expect((on[0] as HTMLElement).dataset['previewQ']).toBe('30');
  });

  it('exposes 4 render quality buttons (50/75/100/200) with 100 highlighted by default', () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const qs = h.host.querySelectorAll('[data-render-q]');
    expect(qs.length).toBe(4);
    const vals = [...qs].map((e) => (e as HTMLElement).dataset['renderQ']);
    expect(vals).toEqual(['50', '75', '100', '200']);
    const on = h.host.querySelector('[data-render-q="100"]') as HTMLElement;
    expect(on.classList.contains('on')).toBe(true);
  });

  it('exposes W and H number inputs reflecting the render size', () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const w = h.host.querySelector('[data-render-w]') as HTMLInputElement;
    const hi = h.host.querySelector('[data-render-h]') as HTMLInputElement;
    expect(w.value).toBe('3840');
    expect(hi.value).toBe('2160');
  });

  it('exposes a size preset dropdown', () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const sel = h.host.querySelector('select[data-render-preset]') as HTMLSelectElement;
    expect(sel).toBeTruthy();
  });

  it('exposes a render quality text input + a Save Render button', () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    expect(h.host.querySelector('[data-render-q-input]')).toBeTruthy();
    expect(h.host.querySelector('[data-save-render]')).toBeTruthy();
  });
});

describe('render-mode-bar — preview tier + quality', () => {
  it('tier click updates config, persists, fires onChange', () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const fast = h.host.querySelector('[data-tier="fast"]') as HTMLElement;
    fast.click();
    expect(h.preview.tier).toBe('fast');
    expect(loadPreviewConfig().tier).toBe('fast');
    expect(h.changeCalls).toBeGreaterThanOrEqual(1);
    // Highlight follows.
    expect(fast.classList.contains('on')).toBe(true);
    const balanced = h.host.querySelector('[data-tier="balanced"]') as HTMLElement;
    expect(balanced.classList.contains('on')).toBe(false);
  });

  it('preview quality click sets quality + persists + highlights', () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const q30 = h.host.querySelector('[data-preview-q="30"]') as HTMLElement;
    q30.click();
    expect(h.preview.quality).toBe(30);
    expect(loadPreviewConfig().quality).toBe(30);
    expect(q30.classList.contains('on')).toBe(true);
  });
});

describe('render-mode-bar — render size', () => {
  it('picking a size preset (4K) sets size and fills W/H', () => {
    const h = makeHarness({ renderSize: { width: 1024, height: 1024 } });
    mountRenderModeBar(h.opts);
    const sel = h.host.querySelector('select[data-render-preset]') as HTMLSelectElement;
    // Preset values are encoded "<w>x<h>"; pick 4K.
    sel.value = '3840x2160';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.renderSize).toEqual({ width: 3840, height: 2160 });
    const w = h.host.querySelector('[data-render-w]') as HTMLInputElement;
    const hi = h.host.querySelector('[data-render-h]') as HTMLInputElement;
    expect(w.value).toBe('3840');
    expect(hi.value).toBe('2160');
    expect(h.changeCalls).toBeGreaterThanOrEqual(1);
  });

  it('typing W sets size and switches preset label to Custom', () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const w = h.host.querySelector('[data-render-w]') as HTMLInputElement;
    w.value = '2000';
    w.dispatchEvent(new Event('input', { bubbles: true }));
    w.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.renderSize.width).toBe(2000);
    const label = h.host.querySelector('[data-render-preset-label]') as HTMLElement;
    expect(label.textContent).toMatch(/custom/i);
  });

  it('typing H sets size and switches preset label to Custom', () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const hi = h.host.querySelector('[data-render-h]') as HTMLInputElement;
    hi.value = '1234';
    hi.dispatchEvent(new Event('input', { bubbles: true }));
    hi.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.renderSize.height).toBe(1234);
    const label = h.host.querySelector('[data-render-preset-label]') as HTMLElement;
    expect(label.textContent).toMatch(/custom/i);
  });

  it('setRenderSizePreset(name) host-override updates size + label', () => {
    const h = makeHarness({ renderSize: { width: 1024, height: 1024 } });
    const handle = mountRenderModeBar(h.opts);
    handle.setRenderSizePreset('HD');
    expect(h.renderSize).toEqual({ width: 1920, height: 1080 });
    const w = h.host.querySelector('[data-render-w]') as HTMLInputElement;
    expect(w.value).toBe('1920');
  });
});

describe('render-mode-bar — render quality', () => {
  it('render quality button click sets quality + highlights', () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const q200 = h.host.querySelector('[data-render-q="200"]') as HTMLElement;
    q200.click();
    expect(h.renderQuality).toBe(200);
    expect(q200.classList.contains('on')).toBe(true);
  });

  it('render quality text input accepts 150 in range', () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const inp = h.host.querySelector('[data-render-q-input]') as HTMLInputElement;
    inp.value = '150';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.renderQuality).toBe(150);
    // Off-ladder → no button highlighted.
    const on = h.host.querySelectorAll('[data-render-q].on');
    expect(on.length).toBe(0);
    expect(h.toastCalls.length).toBe(0);
  });

  it('render quality > 200 clamps to 200 and fires toast', () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const inp = h.host.querySelector('[data-render-q-input]') as HTMLInputElement;
    inp.value = '600';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.renderQuality).toBe(200);
    expect(inp.value).toBe('200');
    expect(h.toastCalls.length).toBe(1);
    expect(h.toastCalls[0]).toMatch(/CLI binary/i);
  });

  it('render quality < 1 clamps to 1', () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const inp = h.host.querySelector('[data-render-q-input]') as HTMLInputElement;
    inp.value = '-5';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.renderQuality).toBe(1);
  });
});

describe('render-mode-bar — render quality cap under pyr3 serve (#201)', () => {
  // The bar reads the active cap from the memoized capability descriptor.
  // Stub it via vi.mock so each test picks its own ceiling.
  it('with unlimited max_quality, accepts 500 and shows a soft-warn toast', async () => {
    const cap = await import('./capability');
    cap._resetCapabilityForTest();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        backend: 'dawn-node',
        max_quality: null,
        can_write_files: true,
        can_render_animation: true,
      }),
    }) as never;
    await cap.fetchCapability();

    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const inp = h.host.querySelector('[data-render-q-input]') as HTMLInputElement;
    expect(inp.getAttribute('max')).toBeNull(); // no hard ceiling in unlimited mode
    inp.value = '500';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.renderQuality).toBe(500); // not clamped
    expect(inp.value).toBe('500');
    // input + change events both fire; unclamped value stays 500 across both
    // so the soft-warn toast fires twice. The signal we care about: it fired.
    expect(h.toastCalls.length).toBeGreaterThanOrEqual(1);
    expect(h.toastCalls.every((m) => /Backend render.*q=500/i.test(m))).toBe(true);

    cap._resetCapabilityForTest();
  });

  it('with unlimited max_quality, q <= 200 does not toast', async () => {
    const cap = await import('./capability');
    cap._resetCapabilityForTest();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        backend: 'dawn-node',
        max_quality: null,
        can_write_files: true,
        can_render_animation: true,
      }),
    }) as never;
    await cap.fetchCapability();

    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const inp = h.host.querySelector('[data-render-q-input]') as HTMLInputElement;
    inp.value = '150';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.renderQuality).toBe(150);
    expect(h.toastCalls).toEqual([]);

    cap._resetCapabilityForTest();
  });
});

describe('render-mode-bar — Save Render button', () => {
  it('clicking Save Render calls onSaveRender', async () => {
    const h = makeHarness();
    mountRenderModeBar(h.opts);
    const btn = h.host.querySelector('[data-save-render]') as HTMLButtonElement;
    btn.click();
    // The mock is async; settle a microtask.
    await Promise.resolve();
    expect(h.saveCalls).toBe(1);
  });

  it('Save Render disabled when canSave() returns false', () => {
    const h = makeHarness({ canSaveFlag: false });
    mountRenderModeBar(h.opts);
    const btn = h.host.querySelector('[data-save-render]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('handle.refresh() re-reads canSave + size + quality', () => {
    const h = makeHarness({ canSaveFlag: false });
    const handle = mountRenderModeBar(h.opts);
    const btn = h.host.querySelector('[data-save-render]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    h.canSaveFlag = true;
    h.renderSize = { width: 1920, height: 1080 };
    h.renderQuality = 75;
    handle.refresh();
    expect(btn.disabled).toBe(false);
    expect((h.host.querySelector('[data-render-w]') as HTMLInputElement).value).toBe('1920');
    expect((h.host.querySelector('[data-render-h]') as HTMLInputElement).value).toBe('1080');
    const q75 = h.host.querySelector('[data-render-q="75"]') as HTMLElement;
    expect(q75.classList.contains('on')).toBe(true);
  });
});

describe('render-mode-bar — destroy', () => {
  it('destroy() removes the bar DOM from the host', () => {
    const h = makeHarness();
    const handle = mountRenderModeBar(h.opts);
    expect(h.host.children.length).toBeGreaterThan(0);
    handle.destroy();
    expect(h.host.children.length).toBe(0);
  });
});
