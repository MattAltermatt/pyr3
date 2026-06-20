// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { buildNavMenu } from './nav-menu';

describe('nav-menu structure (#264)', () => {
  it('renders 5 top-level items in order', () => {
    const el = buildNavMenu('viewer', vi.fn());
    const tops = el.querySelectorAll('[data-nav-top]');
    expect([...tops].map((t) => t.getAttribute('data-nav-top')))
      .toEqual(['viewer', 'editor', 'animate', 'esf', 'discover']);
  });
  it('Editor is a direct link (no submenu — Gradient retired, #372)', () => {
    const el = buildNavMenu('viewer', vi.fn());
    expect(el.querySelectorAll('[data-nav-top="editor"] [data-nav-sub]').length).toBe(0);
  });
  it('Animate menu has Timeline + Screensaver', () => {
    const el = buildNavMenu('viewer', vi.fn());
    const subs = el.querySelectorAll('[data-nav-top="animate"] [data-nav-sub]');
    expect([...subs].map((s) => s.getAttribute('data-nav-sub'))).toEqual(['animate', 'screensaver']);
  });
  it('Flame Gallery menu has Browse + Gallery + ESF source link (#340)', () => {
    const el = buildNavMenu('viewer', vi.fn());
    const top = el.querySelector('[data-nav-top="esf"]') as HTMLElement;
    expect((top.querySelector('.pyr3-nav-toptab') as HTMLElement).textContent).toContain('Flame Gallery');
    const subs = top.querySelectorAll('[data-nav-sub]');
    expect([...subs].map((s) => s.getAttribute('data-nav-sub'))).toEqual(['esf', 'gallery', 'esf-source']);
  });
  it('ESF source leaf is an external new-tab link (#340)', () => {
    const onNav = vi.fn();
    const el = buildNavMenu('viewer', onNav);
    document.body.append(el);
    (el.querySelector('[data-nav-sub="esf-source"]') as HTMLButtonElement).click();
    expect(onNav).toHaveBeenLastCalledWith('https://github.com/MattAltermatt/electric-sheep-fold', true);
    el.dispatchEvent(new Event('pyr3:destroy'));
    el.remove();
  });
  it('Discover menu includes variations + about + showcase + help pages', () => {
    const el = buildNavMenu('viewer', vi.fn());
    const subs = [...el.querySelectorAll('[data-nav-top="discover"] [data-nav-sub]')]
      .map((s) => s.getAttribute('data-nav-sub'));
    expect(subs).toContain('surprise');
    expect(subs).toContain('variations');
    expect(subs).toContain('about');
    expect(subs).toContain('showcase');
    expect(subs).toContain('help-webgpu');
  });
  it('Viewer is a direct link (no submenu panel)', () => {
    const el = buildNavMenu('viewer', vi.fn());
    expect(el.querySelectorAll('[data-nav-top="viewer"] [data-nav-sub]').length).toBe(0);
  });
  it('direct-link click navigates without newTab', () => {
    const onNav = vi.fn();
    const el = buildNavMenu('editor', onNav);
    (el.querySelector('[data-nav-top="viewer"] .pyr3-nav-toptab') as HTMLButtonElement).click();
    expect(onNav).toHaveBeenCalledWith('/viewer');
  });
  it('leaf click navigates to its route; help leaf carries newTab', () => {
    const onNav = vi.fn();
    const el = buildNavMenu('viewer', onNav);
    document.body.append(el);
    (el.querySelector('[data-nav-sub="screensaver"]') as HTMLButtonElement).click();
    expect(onNav).toHaveBeenLastCalledWith('/screensaver', undefined);
    (el.querySelector('[data-nav-sub="help-webgpu"]') as HTMLButtonElement).click();
    expect(onNav).toHaveBeenLastCalledWith('/help/webgpu.html', true);
    el.dispatchEvent(new Event('pyr3:destroy'));
    el.remove();
  });
});

describe('nav-menu active-state (#264)', () => {
  const cases: [string, string, string][] = [
    // surface,      activeTop,  activeSub
    ['viewer',      'viewer',   ''],
    ['editor',      'editor',   ''],
    ['animate',     'animate',  'animate'],
    ['screensaver', 'animate',  'screensaver'],
    ['esf',         'esf',      'esf'],
    ['gallery',     'esf',      'gallery'],
    ['variations',  'discover', 'variations'],
    ['about',       'discover', 'about'],
  ];
  it.each(cases)('surface %s → top %s active', (surface, top) => {
    const el = buildNavMenu(surface, vi.fn());
    expect(el.querySelector(`[data-nav-top="${top}"]`)?.classList.contains('active')).toBe(true);
  });
  it.each(cases.filter(([, , sub]) => sub))('surface %s → sub %s active', (surface, _top, sub) => {
    const el = buildNavMenu(surface, vi.fn());
    expect(el.querySelector(`[data-nav-sub="${sub}"]`)?.classList.contains('active')).toBe(true);
  });
});

describe('nav-menu dropdown (#264)', () => {
  function mount(surface = 'viewer'): HTMLElement {
    const el = buildNavMenu(surface, vi.fn());
    document.body.append(el);
    return el;
  }
  function teardown(el: HTMLElement): void {
    el.dispatchEvent(new Event('pyr3:destroy'));
    el.remove();
  }
  const panel = (el: HTMLElement, top: string): HTMLElement =>
    el.querySelector(`[data-nav-top="${top}"] .pyr3-nav-panel`) as HTMLElement;
  const toptab = (el: HTMLElement, top: string): HTMLButtonElement =>
    el.querySelector(`[data-nav-top="${top}"] .pyr3-nav-toptab`) as HTMLButtonElement;

  // #372 — Editor is now a direct link (Gradient retired), so these dropdown
  // tests use 'animate' (Timeline + Screensaver) as the example multi-item menu.
  it('clicking a top toggle opens its panel', () => {
    const el = mount();
    expect(panel(el, 'animate').hidden).toBe(true);
    toptab(el, 'animate').click();
    expect(panel(el, 'animate').hidden).toBe(false);
    teardown(el);
  });
  it('clicking the same toggle again closes it', () => {
    const el = mount();
    toptab(el, 'animate').click();
    toptab(el, 'animate').click();
    expect(panel(el, 'animate').hidden).toBe(true);
    teardown(el);
  });
  it('opening one panel closes the previously open one', () => {
    const el = mount();
    toptab(el, 'animate').click();
    toptab(el, 'esf').click();
    expect(panel(el, 'animate').hidden).toBe(true);
    expect(panel(el, 'esf').hidden).toBe(false);
    teardown(el);
  });
  it('Escape closes the open panel', () => {
    const el = mount();
    toptab(el, 'animate').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel(el, 'animate').hidden).toBe(true);
    teardown(el);
  });
  it('outside mousedown closes the open panel', () => {
    const el = mount();
    toptab(el, 'animate').click();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(panel(el, 'animate').hidden).toBe(true);
    teardown(el);
  });
  it('mousedown inside the open panel does NOT close it', () => {
    const el = mount();
    toptab(el, 'animate').click();
    panel(el, 'animate').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(panel(el, 'animate').hidden).toBe(false);
    teardown(el);
  });
  it('pyr3:destroy removes document listeners (Escape no longer closes)', () => {
    const el = mount();
    toptab(el, 'animate').click();
    teardown(el);
    // After teardown the listener is gone; re-mount a fresh nav and confirm the
    // stale listener from the destroyed one does not interfere.
    const el2 = mount();
    toptab(el2, 'animate').click();
    expect(panel(el2, 'animate').hidden).toBe(false);
    teardown(el2);
  });
});
