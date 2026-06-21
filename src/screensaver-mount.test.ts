// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountScreensaverPage, resolveDimOverride } from './screensaver-mount';
import { _clearScreensaverPrefs } from './screensaver-prefs';

// happy-dom v20 doesn't expose localStorage globally; provide a Map-backed
// stub so the landing card's prefs read/write don't ReferenceError.
function makeLocalStorageStub(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => Array.from(m.keys())[i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeLocalStorageStub());
  document.body.replaceChildren();
  _clearScreensaverPrefs();
});

describe('mountScreensaverPage', () => {
  it('renders the landing card', () => {
    mountScreensaverPage({ root: document.body });
    expect(document.querySelector('.pyr3-screensaver-card')).toBeTruthy();
  });

  it('renders the two-tile mode chooser', () => {
    mountScreensaverPage({ root: document.body });
    const card = document.querySelector('.pyr3-screensaver-card');
    expect(card).toBeTruthy();
    expect(card!.textContent).toContain('Slideshow');
    expect(card!.textContent).toContain('Animation');
  });

  it('hides the landing card after Play (slideshow, preview mode)', () => {
    mountScreensaverPage({ root: document.body });
    const play = document.querySelector<HTMLButtonElement>('[data-screensaver-play]');
    play!.click();
    expect(
      document.querySelector('.pyr3-screensaver-card')?.classList.contains('hidden'),
    ).toBe(true);
  });

  it('Stop returns to the landing card', () => {
    const handle = mountScreensaverPage({ root: document.body });
    const play = document.querySelector<HTMLButtonElement>('[data-screensaver-play]');
    play!.click();
    handle.stop();
    expect(
      document.querySelector('.pyr3-screensaver-card')?.classList.contains('hidden'),
    ).toBe(false);
  });
});

// #321 — junk ?w=/?h= overrides must fall back to the screen dim, not NaN.
describe('resolveDimOverride', () => {
  it('returns the fallback for a null/empty override', () => {
    expect(resolveDimOverride(null, 1920)).toBe(1920);
    expect(resolveDimOverride('', 1080)).toBe(1080);
  });
  it('returns the fallback for non-numeric / non-positive junk', () => {
    expect(resolveDimOverride('abc', 1920)).toBe(1920);
    expect(resolveDimOverride('-5', 1920)).toBe(1920);
    expect(resolveDimOverride('0', 1920)).toBe(1920);
    expect(resolveDimOverride('NaN', 1920)).toBe(1920);
  });
  it('accepts a finite positive override', () => {
    expect(resolveDimOverride('2560', 1920)).toBe(2560);
  });
});
