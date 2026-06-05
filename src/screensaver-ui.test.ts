// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountScreensaverLanding } from './screensaver-ui';
import { _clearScreensaverPrefs, DEFAULTS } from './screensaver-prefs';

// Map-backed localStorage stub — happy-dom v20 doesn't expose `localStorage`
// globally under vitest. See src/edit-mount.test.ts for the canonical pattern.
function makeStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => { store.delete(k); },
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorageStub());
  document.body.innerHTML = '';
  _clearScreensaverPrefs();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mountScreensaverLanding', () => {
  it('renders mode picker + 5 ladders + Play button', () => {
    mountScreensaverLanding(document.body, { onPlay: () => {} });
    expect(document.querySelector('[data-screensaver-mode="slideshow"]')).toBeTruthy();
    expect(document.querySelector('[data-screensaver-mode="build-up"]')).toBeTruthy();
    expect(document.querySelector('[data-screensaver-ladder="buildUpSec"]')).toBeTruthy();
    expect(document.querySelector('[data-screensaver-ladder="restSec"]')).toBeTruthy();
    expect(document.querySelector('[data-screensaver-ladder="holdSec"]')).toBeTruthy();
    expect(document.querySelector('[data-screensaver-ladder="buildUpQ"]')).toBeTruthy();
    expect(document.querySelector('[data-screensaver-ladder="slideshowQ"]')).toBeTruthy();
    expect(document.querySelector('[data-screensaver-play]')).toBeTruthy();
  });

  it('quality ladders show the spec’d [50, 100, 200, 500] presets', () => {
    mountScreensaverLanding(document.body, { onPlay: () => {} });
    for (const field of ['buildUpQ', 'slideshowQ']) {
      const presets = document.querySelectorAll<HTMLButtonElement>(
        `[data-screensaver-ladder="${field}"] button[data-value]`,
      );
      const values = Array.from(presets).map((b) => Number(b.dataset.value));
      expect(values).toEqual([50, 100, 200, 500]);
    }
  });

  it('quality default for build-up is 50, slideshow is 100', () => {
    mountScreensaverLanding(document.body, { onPlay: () => {} });
    const buildUpQInput = document.querySelector<HTMLInputElement>(
      '[data-screensaver-ladder="buildUpQ"] input',
    );
    const slideshowQInput = document.querySelector<HTMLInputElement>(
      '[data-screensaver-ladder="slideshowQ"] input',
    );
    expect(Number(buildUpQInput!.value)).toBe(DEFAULTS.buildUpQ);
    expect(Number(slideshowQInput!.value)).toBe(DEFAULTS.slideshowQ);
  });

  it('clicking a quality preset updates the freeform input', () => {
    mountScreensaverLanding(document.body, { onPlay: () => {} });
    const btn = document.querySelector<HTMLButtonElement>(
      '[data-screensaver-ladder="buildUpQ"] button[data-value="200"]',
    );
    btn!.click();
    const input = document.querySelector<HTMLInputElement>(
      '[data-screensaver-ladder="buildUpQ"] input',
    );
    expect(Number(input!.value)).toBe(200);
  });

  it('initializes from DEFAULTS when prefs absent', () => {
    mountScreensaverLanding(document.body, { onPlay: () => {} });
    const input = document.querySelector<HTMLInputElement>(
      '[data-screensaver-ladder="buildUpSec"] input',
    );
    expect(input).toBeTruthy();
    expect(Number(input!.value)).toBe(DEFAULTS.buildUpSec);
  });

  it('clicking a ladder preset updates the freeform input', () => {
    mountScreensaverLanding(document.body, { onPlay: () => {} });
    const btn = document.querySelector<HTMLButtonElement>(
      '[data-screensaver-ladder="buildUpSec"] button[data-value="60"]',
    );
    btn!.click();
    const input = document.querySelector<HTMLInputElement>(
      '[data-screensaver-ladder="buildUpSec"] input',
    );
    expect(Number(input!.value)).toBe(60);
  });

  it('Play fires callback with current prefs', () => {
    const onPlay = vi.fn();
    mountScreensaverLanding(document.body, { onPlay });
    const slideshow = document.querySelector<HTMLElement>(
      '[data-screensaver-mode="slideshow"]',
    );
    slideshow!.click();
    const play = document.querySelector<HTMLButtonElement>('[data-screensaver-play]');
    play!.click();
    expect(onPlay).toHaveBeenCalledOnce();
    expect(onPlay.mock.calls[0]![0].mode).toBe('slideshow');
  });

  it('Play call persists prefs', () => {
    mountScreensaverLanding(document.body, { onPlay: () => {} });
    const btn = document.querySelector<HTMLButtonElement>(
      '[data-screensaver-ladder="holdSec"] button[data-value="30"]',
    );
    btn!.click();
    const play = document.querySelector<HTMLButtonElement>('[data-screensaver-play]');
    play!.click();
    const stored = localStorage.getItem('pyr3.screensaver.prefs');
    expect(stored).toContain('"holdSec":30');
  });
});
