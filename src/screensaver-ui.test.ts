// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountScreensaverLanding } from './screensaver-ui';

// Map-backed localStorage stub (happy-dom v20 doesn't expose it under vitest).
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
  document.body.replaceChildren();
});
afterEach(() => vi.unstubAllGlobals());

const findButton = (needle: string): HTMLButtonElement =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(needle))!;

describe('mountScreensaverLanding — two-tile chooser', () => {
  it('renders two mode tiles + a Play button', () => {
    mountScreensaverLanding(document.body, { onPlay: () => {} });
    const text = document.body.textContent ?? '';
    expect(text).toContain('Slideshow');
    expect(text).toContain('Animation');
    expect(findButton('Play')).toBeTruthy();
  });

  it('defaults to slideshow and shows its settings (skip-boring + quality tiers + dims)', () => {
    mountScreensaverLanding(document.body, { onPlay: () => {} });
    expect(document.body.textContent).toContain('Skip boring flames');
    expect(document.querySelector('[data-level="normal"]')).not.toBeNull();
    expect(document.querySelector('.pyr3-screensaver-qgrp')).not.toBeNull();
    expect(document.querySelector('.pyr3-screensaver-ddl')).not.toBeNull();
  });

  it('selecting Animation reveals the timeline source picker + pacing', () => {
    mountScreensaverLanding(document.body, { onPlay: () => {} });
    findButton('Animation').click();
    expect(document.querySelector('.pyr3-screensaver-filechip')).not.toBeNull();
    expect(document.body.textContent).toContain('Animate for');
  });

  it('Play fires onPlay with mode slideshow and persists prefs', () => {
    const onPlay = vi.fn();
    mountScreensaverLanding(document.body, { onPlay });
    findButton('Play').click();
    expect(onPlay).toHaveBeenCalledOnce();
    expect(onPlay.mock.calls[0]![0].mode).toBe('slideshow');
    expect(localStorage.getItem('pyr3.screensaver.prefs')).not.toBeNull();
  });

  it('Play in animation mode without a loaded timeline errors and does not fire onPlay', () => {
    const onPlay = vi.fn();
    mountScreensaverLanding(document.body, { onPlay });
    findButton('Animation').click();
    findButton('Play').click();
    expect(onPlay).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Load a timeline file first');
  });
});
