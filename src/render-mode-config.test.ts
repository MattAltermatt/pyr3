// @vitest-environment happy-dom
//
// #176 Task 1 — render-mode-config tests
//
// PreviewRenderConfig is the workstation-pref-shaped config (tier + quality)
// that drives the editor's live preview canvas. Persists to localStorage
// per-browser per-origin. Aspect ratio for the preview canvas derives from
// genome.size (render side) — preview tier picks scale only.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PREVIEW_CONFIG,
  PREVIEW_TIER_LONGEST_EDGE,
  computePreviewDims,
  loadPreviewConfig,
  savePreviewConfig,
} from './render-mode-config';

// Map-backed localStorage stub. happy-dom's Storage prototype is unreliable
// across Node versions (see reference-node24-ci-vs-node26-local memory);
// stubbing globalThis.localStorage with a Map is the project convention
// (palette-picker.test.ts uses this same pattern).
function installLocalStorageStub(): void {
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
}
installLocalStorageStub();

describe('DEFAULT_PREVIEW_CONFIG', () => {
  it('tier=balanced quality=30', () => {
    expect(DEFAULT_PREVIEW_CONFIG).toEqual({ tier: 'balanced', quality: 30 });
  });
});

describe('PREVIEW_TIER_LONGEST_EDGE', () => {
  it('maps tiers to longest-edge caps', () => {
    expect(PREVIEW_TIER_LONGEST_EDGE).toEqual({ fast: 512, balanced: 1024, sharp: 1536 });
  });
});

describe('computePreviewDims', () => {
  it('landscape 4K render at balanced — caps long edge to 1024, aspect preserved', () => {
    const dims = computePreviewDims('balanced', { width: 3840, height: 2160 });
    expect(dims.width).toBe(1024);
    // 2160 * (1024/3840) = 576
    expect(dims.height).toBe(576);
  });

  it('portrait render at balanced — caps long edge (height) to 1024', () => {
    const dims = computePreviewDims('balanced', { width: 1290, height: 2796 });
    expect(dims.height).toBe(1024);
    // 1290 * (1024/2796) ≈ 472.45 → 472 rounded
    expect(dims.width).toBe(472);
  });

  it('square render at sharp — caps both to 1536', () => {
    const dims = computePreviewDims('sharp', { width: 4096, height: 4096 });
    expect(dims).toEqual({ width: 1536, height: 1536 });
  });

  it('render smaller than tier cap — returns render dims unchanged (no upscale)', () => {
    const dims = computePreviewDims('balanced', { width: 800, height: 600 });
    expect(dims).toEqual({ width: 800, height: 600 });
  });

  it('render exactly at tier cap — returns render dims unchanged', () => {
    const dims = computePreviewDims('balanced', { width: 1024, height: 768 });
    expect(dims).toEqual({ width: 1024, height: 768 });
  });

  it('fast tier landscape — caps to 512', () => {
    const dims = computePreviewDims('fast', { width: 3840, height: 2160 });
    expect(dims.width).toBe(512);
    // 2160 * (512/3840) = 288
    expect(dims.height).toBe(288);
  });

  it('odd-aspect render maintains aspect', () => {
    // ultra-wide 3000×500 (aspect ~6:1) at balanced (cap=1024)
    const dims = computePreviewDims('balanced', { width: 3000, height: 500 });
    expect(dims.width).toBe(1024);
    // 500 * (1024/3000) ≈ 170.67 → 171 rounded
    expect(dims.height).toBe(171);
  });

  it('floors fractional render dims before computing', () => {
    const dims = computePreviewDims('fast', { width: 1024.7, height: 768.3 });
    // longest edge = 1024 (floored), cap = 512, scale = 0.5
    // width  = round(1024 * 0.5) = 512
    // height = round(768 * 0.5) = 384
    expect(dims).toEqual({ width: 512, height: 384 });
  });

  it('handles degenerate render dims (0 or negative) — never returns dims < 1', () => {
    const dims = computePreviewDims('balanced', { width: 0, height: 0 });
    expect(dims.width).toBeGreaterThanOrEqual(1);
    expect(dims.height).toBeGreaterThanOrEqual(1);
  });
});

describe('loadPreviewConfig', () => {
  beforeEach(() => globalThis.localStorage.clear());
  afterEach(() => globalThis.localStorage.clear());

  it('missing key → DEFAULT_PREVIEW_CONFIG', () => {
    expect(loadPreviewConfig()).toEqual(DEFAULT_PREVIEW_CONFIG);
  });

  it('malformed JSON → DEFAULT_PREVIEW_CONFIG', () => {
    globalThis.localStorage.setItem('pyr3-preview-config', 'not-json');
    expect(loadPreviewConfig()).toEqual(DEFAULT_PREVIEW_CONFIG);
  });

  it('_v mismatch → DEFAULT_PREVIEW_CONFIG', () => {
    globalThis.localStorage.setItem(
      'pyr3-preview-config',
      JSON.stringify({ tier: 'fast', quality: 10, _v: 999 }),
    );
    expect(loadPreviewConfig()).toEqual(DEFAULT_PREVIEW_CONFIG);
  });

  it('well-formed config → returns the stored values', () => {
    globalThis.localStorage.setItem(
      'pyr3-preview-config',
      JSON.stringify({ tier: 'sharp', quality: 50, _v: 1 }),
    );
    expect(loadPreviewConfig()).toEqual({ tier: 'sharp', quality: 50 });
  });

  it('invalid tier string → DEFAULT_PREVIEW_CONFIG', () => {
    globalThis.localStorage.setItem(
      'pyr3-preview-config',
      JSON.stringify({ tier: 'turbo', quality: 50, _v: 1 }),
    );
    expect(loadPreviewConfig()).toEqual(DEFAULT_PREVIEW_CONFIG);
  });

  it('quality out of [10,50] range clamps to range', () => {
    globalThis.localStorage.setItem(
      'pyr3-preview-config',
      JSON.stringify({ tier: 'fast', quality: 100, _v: 1 }),
    );
    expect(loadPreviewConfig()).toEqual({ tier: 'fast', quality: 50 });
  });

  it('quality below 10 clamps to 10', () => {
    globalThis.localStorage.setItem(
      'pyr3-preview-config',
      JSON.stringify({ tier: 'fast', quality: 5, _v: 1 }),
    );
    expect(loadPreviewConfig()).toEqual({ tier: 'fast', quality: 10 });
  });

  it('NaN quality → default quality (30)', () => {
    globalThis.localStorage.setItem(
      'pyr3-preview-config',
      JSON.stringify({ tier: 'balanced', quality: 'foo', _v: 1 }),
    );
    expect(loadPreviewConfig().quality).toBe(30);
  });

  it('null in stored slot → defaults', () => {
    globalThis.localStorage.setItem('pyr3-preview-config', 'null');
    expect(loadPreviewConfig()).toEqual(DEFAULT_PREVIEW_CONFIG);
  });
});

describe('savePreviewConfig', () => {
  beforeEach(() => globalThis.localStorage.clear());
  afterEach(() => globalThis.localStorage.clear());

  it('writes to localStorage with _v stamped', () => {
    savePreviewConfig({ tier: 'fast', quality: 30 });
    const raw = globalThis.localStorage.getItem('pyr3-preview-config');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ tier: 'fast', quality: 30, _v: 1 });
  });

  it('round-trips through loadPreviewConfig', () => {
    savePreviewConfig({ tier: 'sharp', quality: 40 });
    expect(loadPreviewConfig()).toEqual({ tier: 'sharp', quality: 40 });
  });

  it('clamps out-of-range quality on save', () => {
    savePreviewConfig({ tier: 'balanced', quality: 9001 });
    expect(loadPreviewConfig().quality).toBe(50);
  });

  it('overwrites prior stored config', () => {
    savePreviewConfig({ tier: 'fast', quality: 10 });
    savePreviewConfig({ tier: 'sharp', quality: 50 });
    expect(loadPreviewConfig()).toEqual({ tier: 'sharp', quality: 50 });
  });
});
