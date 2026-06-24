// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { buildNavMenu } from './nav-menu';
import { isMobile } from './mobile';

vi.mock('./mobile', () => ({ isMobile: vi.fn(() => false) }));

describe('nav-menu structure (#264)', () => {
  it('renders 7 top-level items in order (Creator added, #437)', () => {
    const el = buildNavMenu('viewer', vi.fn());
    const tops = el.querySelectorAll('[data-nav-top]');
    expect([...tops].map((t) => t.getAttribute('data-nav-top')))
      .toEqual(['viewer', 'editor', 'surprise', 'animate', 'esf', 'discover', 'help']);
  });
  it('collapses to a single ☰ hamburger on mobile (#66)', () => {
    (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const nav = buildNavMenu('viewer', () => {});
    // The horizontal nav is replaced by ONE hamburger top.
    const tops = [...nav.querySelectorAll('[data-nav-top]')].map((e) => (e as HTMLElement).dataset.navTop);
    expect(tops).toEqual(['menu']);
    const burger = nav.querySelector('.pyr3-nav-hamburger-btn');
    expect(burger?.textContent).toBe('☰');
    (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });
  it('hamburger panel lists the reduced destinations, not editor/animate (#66)', () => {
    (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const nav = buildNavMenu('viewer', () => {});
    const subs = [...nav.querySelectorAll('.pyr3-nav-panel-mobile [data-nav-sub]')]
      .map((e) => (e as HTMLElement).dataset.navSub);
    // direct links (viewer/surprise) + flattened dropdown leaves (esf/gallery,
    // showcase/variations, help leaves) are present; editor/animate/screensaver
    // (the hidden creation surfaces) are not.
    expect(subs).toContain('viewer');
    expect(subs).toContain('surprise');
    expect(subs).toContain('esf');
    expect(subs).toContain('variations');
    expect(subs).not.toContain('editor');
    expect(subs).not.toContain('animate');
    expect(subs).not.toContain('screensaver');
    (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });
  it('mobile hamburger opens in-app /help/ pages same-tab, external new-tab (#66)', () => {
    (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const nav = buildNavMenu('viewer', () => {});
    const leaf = (key: string) =>
      nav.querySelector(`.pyr3-nav-panel-mobile [data-nav-sub="${key}"]`) as HTMLAnchorElement | null;
    // in-app static help pages → same-tab (no target=_blank)
    expect(leaf('help-color')?.target).toBe('');
    expect(leaf('help-webgpu')?.target).toBe('');
    // genuinely external (github) keeps new-tab
    expect(leaf('esf-source')?.target).toBe('_blank');
    (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });
  it('shows the full 7-entry nav on desktop', () => {
    (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const nav = buildNavMenu('viewer', () => {});
    const tops = [...nav.querySelectorAll('[data-nav-top]')].map((e) => (e as HTMLElement).dataset.navTop);
    expect(tops).toEqual(['viewer', 'editor', 'surprise', 'animate', 'esf', 'discover', 'help']);
  });
  it('Editor is a direct link (no submenu — Gradient retired, #372)', () => {
    const el = buildNavMenu('viewer', vi.fn());
    expect(el.querySelectorAll('[data-nav-top="editor"] [data-nav-sub]').length).toBe(0);
  });
  it('Creator is a direct link to /creator (no submenu, #437; route renamed from /surprise)', () => {
    const el = buildNavMenu('viewer', vi.fn());
    const top = el.querySelector('[data-nav-top="surprise"]') as HTMLElement;
    expect((top.querySelector('.pyr3-nav-toptab') as HTMLElement).textContent).toBe('Creator');
    expect((top.querySelector('a.pyr3-nav-toptab') as HTMLAnchorElement).getAttribute('href')).toBe('/creator');
    expect(top.querySelectorAll('[data-nav-sub]').length).toBe(0);
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
  it('Discover is exploration only — Showcase + Variations (Surprise promoted to Creator, #437)', () => {
    const el = buildNavMenu('viewer', vi.fn());
    const subs = [...el.querySelectorAll('[data-nav-top="discover"] [data-nav-sub]')]
      .map((s) => s.getAttribute('data-nav-sub'));
    expect(subs).toEqual(['showcase', 'variations']);
    // Surprise left Discover for its own top-level Creator link (#437).
    expect(subs).not.toContain('surprise');
    // learning/reference items moved out to Help (#420)
    expect(subs).not.toContain('about');
    expect(subs).not.toContain('help-webgpu');
  });
  it('Help menu carries the learning/reference items incl. About (#420)', () => {
    const el = buildNavMenu('viewer', vi.fn());
    const top = el.querySelector('[data-nav-top="help"]') as HTMLElement;
    expect((top.querySelector('.pyr3-nav-toptab') as HTMLElement).textContent).toContain('Help');
    const subs = [...top.querySelectorAll('[data-nav-sub]')].map((s) => s.getAttribute('data-nav-sub'));
    expect(subs).toEqual(['help-ifs', 'help-color', 'help-cost', 'help-webgpu', 'about']);
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

describe('nav-menu modified-click → native new tab (#407)', () => {
  it('navigable entries are real <a href> anchors', () => {
    const el = buildNavMenu('viewer', vi.fn());
    const viewer = el.querySelector('[data-nav-top="viewer"] .pyr3-nav-toptab') as HTMLAnchorElement;
    expect(viewer.tagName).toBe('A');
    expect(viewer.getAttribute('href')).toBe('/viewer');
    const leaf = el.querySelector('[data-nav-sub="screensaver"]') as HTMLAnchorElement;
    expect(leaf.tagName).toBe('A');
    expect(leaf.getAttribute('href')).toBe('/screensaver');
  });
  it('new-tab leaves carry target=_blank + rel=noopener', () => {
    const el = buildNavMenu('viewer', vi.fn());
    const help = el.querySelector('[data-nav-sub="help-webgpu"]') as HTMLAnchorElement;
    expect(help.target).toBe('_blank');
    expect(help.rel).toBe('noopener');
  });
  it('cmd/ctrl-click on a direct link does NOT JS-navigate (browser opens a new tab)', () => {
    const onNav = vi.fn();
    const el = buildNavMenu('editor', onNav);
    const viewer = el.querySelector('[data-nav-top="viewer"] .pyr3-nav-toptab') as HTMLElement;
    viewer.dispatchEvent(new MouseEvent('click', { metaKey: true, bubbles: true, cancelable: true }));
    viewer.dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true, cancelable: true }));
    expect(onNav).not.toHaveBeenCalled();
  });
  it('cmd-click on a leaf does NOT JS-navigate', () => {
    const onNav = vi.fn();
    const el = buildNavMenu('viewer', onNav);
    document.body.append(el);
    const leaf = el.querySelector('[data-nav-sub="screensaver"]') as HTMLElement;
    leaf.dispatchEvent(new MouseEvent('click', { metaKey: true, bubbles: true, cancelable: true }));
    expect(onNav).not.toHaveBeenCalled();
    el.dispatchEvent(new Event('pyr3:destroy'));
    el.remove();
  });
  it('plain left-click still routes through onNavigate (and prevents default)', () => {
    const onNav = vi.fn();
    const el = buildNavMenu('editor', onNav);
    const viewer = el.querySelector('[data-nav-top="viewer"] .pyr3-nav-toptab') as HTMLElement;
    const ev = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true });
    viewer.dispatchEvent(ev);
    expect(onNav).toHaveBeenCalledWith('/viewer');
    expect(ev.defaultPrevented).toBe(true);
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
    ['surprise',    'surprise', ''],
    ['variations',  'discover', 'variations'],
    ['about',       'help',     'about'],
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
