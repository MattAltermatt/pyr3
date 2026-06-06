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

describe('mountScreensaverLanding — Record mode tab (#111)', () => {
  it('renders 3 mode buttons (Slideshow, Build-up, Record)', () => {
    const host = document.createElement('div');
    document.body.append(host);
    mountScreensaverLanding(host, { onPlay: () => {}, isRecordingSupported: () => true });
    const btns = host.querySelectorAll<HTMLElement>('[data-screensaver-mode]');
    expect(btns.length).toBe(3);
    expect(btns[0]!.dataset.screensaverMode).toBe('slideshow');
    expect(btns[1]!.dataset.screensaverMode).toBe('build-up');
    expect(btns[2]!.dataset.screensaverMode).toBe('record');
  });

  it('disables Record button when recording is not supported', () => {
    const host = document.createElement('div');
    document.body.append(host);
    mountScreensaverLanding(host, { onPlay: () => {}, isRecordingSupported: () => false });
    const recordBtn = host.querySelector<HTMLButtonElement>('[data-screensaver-mode="record"]');
    expect(recordBtn?.disabled).toBe(true);
    expect(recordBtn?.title).toMatch(/Chromium/);
  });

  it('shows picker container only when mode = record', () => {
    const host = document.createElement('div');
    document.body.append(host);
    mountScreensaverLanding(host, { onPlay: () => {}, isRecordingSupported: () => true });
    const picker = host.querySelector('[data-screensaver-picker]');
    expect(picker?.classList.contains('hidden')).toBe(true);
    host.querySelector<HTMLButtonElement>('[data-screensaver-mode="record"]')!.click();
    expect(picker?.classList.contains('hidden')).toBe(false);
  });

  it('shows record ladders only in record mode; hides rest period', () => {
    const host = document.createElement('div');
    document.body.append(host);
    mountScreensaverLanding(host, { onPlay: () => {}, isRecordingSupported: () => true });
    host.querySelector<HTMLButtonElement>('[data-screensaver-mode="record"]')!.click();
    const visible = Array.from(
      host.querySelectorAll<HTMLElement>('[data-screensaver-ladder-block]')
    ).filter((el) => !el.classList.contains('hidden'));
    const fields = visible.map((el) => el.dataset.screensaverLadderBlock);
    expect(fields).toEqual(['recordTimeSec', 'recordQ', 'recordRamp']);
    const restBlock = host.querySelector<HTMLElement>(
      '[data-screensaver-ladder-block="restSec"]'
    );
    expect(restBlock?.classList.contains('hidden')).toBe(true);
  });

  it('Start button is disabled in record mode until a flame is picked', () => {
    const host = document.createElement('div');
    document.body.append(host);
    mountScreensaverLanding(host, { onPlay: () => {}, isRecordingSupported: () => true });
    host.querySelector<HTMLButtonElement>('[data-screensaver-mode="record"]')!.click();
    const play = host.querySelector<HTMLButtonElement>('[data-screensaver-play]');
    expect(play?.disabled).toBe(true);
    expect(play?.textContent).toContain('pick a flame');
  });

  it('falls back to build-up mode when stored prefs say record but support is missing', () => {
    localStorage.setItem(
      'pyr3.screensaver.prefs',
      JSON.stringify({ version: 4, ...DEFAULTS, mode: 'record' }),
    );
    const host = document.createElement('div');
    document.body.append(host);
    mountScreensaverLanding(host, { onPlay: () => {}, isRecordingSupported: () => false });
    const buildUpBtn = host.querySelector<HTMLButtonElement>('[data-screensaver-mode="build-up"]');
    expect(buildUpBtn?.classList.contains('on')).toBe(true);
  });
});
