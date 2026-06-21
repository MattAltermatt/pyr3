// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { mountWelcomeCard, welcomeAlreadySeen } from './welcome-card';

function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string): string | null => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string): void => void m.set(k, v),
  };
}

function makeOpts(
  over: Partial<{
    onBrowseGallery: () => void;
    onOpen: () => void;
    onEdit: () => void;
    onLearnIfs: () => void;
    storage: ReturnType<typeof fakeStorage>;
  }> = {},
) {
  return {
    onBrowseGallery: vi.fn(),
    onOpen: vi.fn(),
    onEdit: vi.fn(),
    onLearnIfs: vi.fn(),
    storage: fakeStorage(),
    ...over,
  };
}

const SEEN = 'pyr3.welcome.seen';

describe('welcome-card (#338)', () => {
  it('mounts a dismissible welcome card with the four discovery links when unseen', () => {
    document.body.innerHTML = '<div id="zone"></div>';
    const zone = document.getElementById('zone')!;
    const h = mountWelcomeCard(zone, makeOpts());
    expect(h).not.toBeNull();
    expect(zone.querySelector('.pyr3-welcome')).toBeTruthy();
    expect(zone.querySelector('[data-role="welcome-gallery"]')).toBeTruthy();
    expect(zone.querySelector('[data-role="welcome-open"]')).toBeTruthy();
    expect(zone.querySelector('[data-role="welcome-edit"]')).toBeTruthy();
    expect(zone.querySelector('[data-role="welcome-ifs"]')).toBeTruthy();
    expect(zone.querySelector('[data-role="welcome-dismiss"]')).toBeTruthy();
  });

  it('does NOT mount (returns null, no DOM) when the seen flag is already set', () => {
    document.body.innerHTML = '<div id="zone"></div>';
    const zone = document.getElementById('zone')!;
    const h = mountWelcomeCard(zone, makeOpts({ storage: fakeStorage({ [SEEN]: '1' }) }));
    expect(h).toBeNull();
    expect(zone.querySelector('.pyr3-welcome')).toBeNull();
  });

  it('welcomeAlreadySeen reflects the stored flag', () => {
    expect(welcomeAlreadySeen(fakeStorage())).toBe(false);
    expect(welcomeAlreadySeen(fakeStorage({ [SEEN]: '1' }))).toBe(true);
  });

  it('clicking ✕ dismisses the card and persists the seen flag', () => {
    document.body.innerHTML = '<div id="zone"></div>';
    const zone = document.getElementById('zone')!;
    const opts = makeOpts();
    mountWelcomeCard(zone, opts);
    (zone.querySelector('[data-role="welcome-dismiss"]') as HTMLElement).click();
    expect(zone.querySelector('.pyr3-welcome')).toBeNull();
    expect(opts.storage.getItem(SEEN)).toBe('1');
  });

  it('each discovery link fires its callback but does NOT dismiss (card stays, not marked seen)', () => {
    // #338 — links open in a new tab; the card persists until ✕ / Escape.
    for (const [role, cb] of [
      ['welcome-gallery', 'onBrowseGallery'],
      ['welcome-open', 'onOpen'],
      ['welcome-edit', 'onEdit'],
      ['welcome-ifs', 'onLearnIfs'],
    ] as const) {
      document.body.innerHTML = '<div id="zone"></div>';
      const zone = document.getElementById('zone')!;
      const opts = makeOpts();
      mountWelcomeCard(zone, opts);
      (zone.querySelector(`[data-role="${role}"]`) as HTMLElement).click();
      expect(opts[cb], `${role} fires ${cb}`).toHaveBeenCalledTimes(1);
      expect(opts.storage.getItem(SEEN), `${role} does NOT mark seen`).toBeNull();
      expect(zone.querySelector('.pyr3-welcome'), `${role} keeps the card up`).toBeTruthy();
    }
  });

  it('Escape dismisses the card and marks it seen', () => {
    document.body.innerHTML = '<div id="zone"></div>';
    const zone = document.getElementById('zone')!;
    const opts = makeOpts();
    mountWelcomeCard(zone, opts);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(zone.querySelector('.pyr3-welcome')).toBeNull();
    expect(opts.storage.getItem(SEEN)).toBe('1');
  });

  it('after dismiss, a second mount is a no-op (returns null) — once-ever contract', () => {
    document.body.innerHTML = '<div id="zone"></div>';
    const zone = document.getElementById('zone')!;
    const storage = fakeStorage();
    mountWelcomeCard(zone, makeOpts({ storage }));
    (zone.querySelector('[data-role="welcome-dismiss"]') as HTMLElement).click();
    const second = mountWelcomeCard(zone, makeOpts({ storage }));
    expect(second).toBeNull();
    expect(zone.querySelector('.pyr3-welcome')).toBeNull();
  });
});
