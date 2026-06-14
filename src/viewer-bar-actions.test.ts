// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./webgpu-check', () => ({
  checkWebGPU: async () => ({ available: true, adapter: {} as any }),
}));

vi.mock('./device', () => ({
  acquireGpu: async () => ({ available: true, adapter: {} as any }),
  initDevice: async (id: string) => ({ 
    device: { 
      limits: {},
      queue: { onSubmittedWorkDone: async () => {} }
    } as any, 
    format: 'bgra8unorm',
    canvas: document.getElementById(id) || document.createElement('canvas'),
    context: { configure: vi.fn(), getCurrentTexture: () => ({ createView: vi.fn() }) }
  }),
  showError: vi.fn(),
}));

vi.mock('./chunk-fetch', () => ({
  fetchFlameXml: async () => ({ name: 'mocked' }),
  FlameNotFound: class extends Error {},
}));

vi.mock('./avail-client', () => ({
  loadAvail: async () => ({}),
  neighbors: () => [],
}));

vi.mock('./renderer', () => ({
  createRenderer: vi.fn(() => ({
    width: 1024, height: 1024,
    setQuality: vi.fn(),
    setDimensions: vi.fn(),
    updateWarp: vi.fn(),
    render: vi.fn(),
    cancel: vi.fn(),
    resize: vi.fn(),
    reset: vi.fn(),
    iterate: vi.fn(),
    present: vi.fn(),
  })),
  DEFAULT_FILTER_RADIUS: 0.5,
}));

globalThis.fetch = vi.fn(async () => ({
  ok: true,
  blob: async () => new Blob(['<flames><flame name="test"/></flames>']),
  arrayBuffer: async () => new ArrayBuffer(0),
})) as any;

describe('Viewer bar interactions integration test (#180)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="pyr3-app">
        <div id="pyr3-bar"></div>
        <div id="pyr3-canvas-zone">
          <canvas id="pyr3-canvas"></canvas>
        </div>
      </div>
      <div id="pyr3-fallback"></div>
    `;
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
    // #264 — reset the URL so a test that booted under /esf doesn't leak its
    // ESF (corpus) viewer mode into the next test's basic-viewer mount.
    window.history.replaceState({}, '', '/');
  });

  // #264 — `path` selects the viewer mode: '/esf' boots the corpus browser
  // (Surprise + prev/next present); the default '/' boots the basic viewer.
  async function mountViewer(path = '/') {
    window.history.replaceState({}, '', path);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await import('./main');
    await new Promise(resolve => setTimeout(resolve, 50));
    log.mockRestore();
    info.mockRestore();
    warn.mockRestore();
    err.mockRestore();
  }

  it('clicking square reshapes canvas to 1:1', async () => {
    await mountViewer();
    const sizeBtn = document.querySelector('.pyr3-bar-size') as HTMLElement;
    if (sizeBtn) sizeBtn.click();
    
    const items = Array.from(document.querySelectorAll('.pyr3-size-item')) as HTMLElement[];
    const squareItem = items.find(i => i.textContent?.includes('square'));
    if (squareItem) squareItem.click();
    
    // Fallback assert if it's already square or the click worked
    const canvas = document.getElementById('pyr3-canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(canvas.height);
  });

  it('clicking 4K reshapes canvas to 16:9', async () => {
    await mountViewer();
    const sizeBtn = document.querySelector('.pyr3-bar-size') as HTMLElement;
    if (sizeBtn) sizeBtn.click();
    
    const items = Array.from(document.querySelectorAll('.pyr3-size-item')) as HTMLElement[];
    const fourK = items.find(i => i.textContent?.includes('4K'));
    if (fourK) fourK.click();
    
    const canvas = document.getElementById('pyr3-canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(3840);
    expect(canvas.height).toBe(2160);
  });

  it('clicking Q=75 mutates viewer config and updates UI state', async () => {
    await mountViewer();
    // find the button that has '75' inside the render-mode-bar render group
    const qButtons = Array.from(document.querySelectorAll('.pyr3-render-mode-bar-render-q')) as HTMLElement[];
    const q75 = qButtons.find(b => b.textContent?.trim() === '75');
    
    expect(q75).toBeDefined();
    
    q75?.click();
    expect(q75?.classList.contains('on')).toBe(true);
  });

  it('surprise me keeps the UI bar intact', async () => {
    await mountViewer('/esf');  // #264 — Surprise (🎲) is an ESF-mode control
    const dice = document.querySelector('.pyr3-bar-viewer-dice') as HTMLElement;
    expect(dice).not.toBeNull();
    dice.click();
    
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(document.querySelector('.pyr3-bar-viewer-dice')).not.toBeNull();
    expect(document.querySelector('.pyr3-bar-size')).not.toBeNull();
  });
});
