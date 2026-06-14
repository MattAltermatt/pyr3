// @vitest-environment happy-dom
//
// P7 (#212) — capability-gate assertions for the Export sequence button on
// /v1/animate. Mounting the page doesn't require a real GPU device since
// nothing touches `device` until an Animation is loaded (handleFile); the
// button stamp itself is purely DOM + capability lookup.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { mountAnimatePage, wrapPlaybackTime, playbackTimeAt, computeOutputAwarePreviewDims } from './animate-mount';
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

describe('wrapPlaybackTime (#248)', () => {
  it('wraps a sub-unit span without overshooting tMax', () => {
    // Span 0.5: a time past tMax wraps back into [tMin, tMax), not past it.
    expect(wrapPlaybackTime(0.6, 0, 0.5)).toBeCloseTo(0.1, 10);
    expect(wrapPlaybackTime(0.3, 0, 0.5)).toBeCloseTo(0.3, 10); // in range, unchanged
    expect(wrapPlaybackTime(0.5, 0, 0.5)).toBeCloseTo(0.5, 10); // exactly tMax stays
  });

  it('never returns a time outside [tMin, tMax] (no endpoint extrapolation)', () => {
    for (const t of [-5, 0.6, 1.2, 100]) {
      const w = wrapPlaybackTime(t, 0, 0.5);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(0.5);
    }
  });

  it('large integer span (ESF corpus) wraps by modulo', () => {
    expect(wrapPlaybackTime(12, 0, 10)).toBeCloseTo(2, 10);
    expect(wrapPlaybackTime(7, 0, 10)).toBeCloseTo(7, 10); // in range
  });

  it('degenerate zero span pins to tMin', () => {
    expect(wrapPlaybackTime(5, 2, 2)).toBe(2);
  });
});

describe('playbackTimeAt (real-time, #276)', () => {
  it('1× advances one timeline second per real second', () => {
    expect(playbackTimeAt(0, 1000, 1, 0, 30)).toBeCloseTo(1, 6);
    expect(playbackTimeAt(0, 5000, 1, 0, 30)).toBeCloseTo(5, 6);
  });
  it('scales with speed', () => {
    expect(playbackTimeAt(0, 1000, 2, 0, 30)).toBeCloseTo(2, 6);
    expect(playbackTimeAt(0, 1000, 0.5, 0, 30)).toBeCloseTo(0.5, 6);
  });
  it('wraps within the span', () => {
    expect(playbackTimeAt(0, 32000, 1, 0, 30)).toBeCloseTo(2, 6); // 32 s into a 30 s span → 2 s
  });
  it('respects a non-zero start time', () => {
    expect(playbackTimeAt(10, 1000, 1, 0, 30)).toBeCloseTo(11, 6);
  });
});

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
    const load = buttons.find((b) => b.textContent?.includes('Load'));
    const exportBtn = buttons.find((b) => b.hasAttribute('data-export-sequence'));
    expect(load).toBeTruthy();
    expect(exportBtn).toBeTruthy();
  });
});

describe('computeOutputAwarePreviewDims', () => {
  it('caps the chosen output size to the preview max, preserving aspect', () => {
    // square 2000 output, preview cap 800×600 → min(800/2000, 600/2000)=0.3 → 600×600
    expect(computeOutputAwarePreviewDims({ width: 2000, height: 2000 }, 800, 600))
      .toEqual({ width: 600, height: 600 });
  });
  it('caps a 16:9 4K output to the preview width', () => {
    // 3840×2160 into 1280×720 → 0.333 → 1280×720
    expect(computeOutputAwarePreviewDims({ width: 3840, height: 2160 }, 1280, 720))
      .toEqual({ width: 1280, height: 720 });
  });
  it('keeps a small output unchanged (never upscales)', () => {
    expect(computeOutputAwarePreviewDims({ width: 400, height: 300 }, 800, 600))
      .toEqual({ width: 400, height: 300 });
  });
});
