// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import {
  mountAboutBar,
  mountBar,
  mountBarChrome,
  mountGalleryBar,
  type BarOpts,
  type GalleryBarOpts,
  type TabSurface,
} from './ui-bar';
import type { WebGPUStatus } from './webgpu-check';

// Mock the WebGPU adapter shape — mountBar / mountGalleryBar only read
// `available`, so a stub adapter is enough.
const STUB_WEBGPU: WebGPUStatus = { available: true, adapter: {} as GPUAdapter };

function makeBarOpts(over: Partial<BarOpts> = {}): BarOpts {
  return {
    webgpu: STUB_WEBGPU,
    onOpenFile: vi.fn(),
    onRenderQuality: vi.fn(),
    onNavigate: vi.fn(),
    onSave: vi.fn(),
    onSurpriseMe: vi.fn(),
    estimateCost: () => ({ width: 1024, height: 1024, mb: 4, fits: true }),
    onTabClick: vi.fn(),
    ...over,
  };
}

// Phase 2 of #103 will replace setGalleryHref with the chrome-tab transfer
// rule (viewer-only currentFlame → gallery URL via `app-state`). Task 1.4
// dropped the visible gallery anchor when mountBar adopted mountBarChrome
// (the chrome's tab group carries gallery navigation now); setGalleryHref
// stays on BarHandle as a no-op stub for back-compat with the existing
// main.ts call site, so no test asserts on its DOM effect anymore.

function makeGalleryOpts(over: Partial<GalleryBarOpts> = {}): GalleryBarOpts {
  return {
    webgpu: STUB_WEBGPU,
    page: 1,
    totalPages: 0,
    onPrevPage: vi.fn(),
    onNextPage: vi.fn(),
    onRandomPage: vi.fn(),
    activeAxes: 0,
    onFilterToggle: vi.fn(),
    onTabClick: vi.fn(),
    ...over,
  };
}

describe('mountGalleryBar — 🎲 random-page pill (#50)', () => {
  it('center cluster contains a labeled 🎲 pill', () => {
    const root = document.createElement('div');
    mountGalleryBar(root, makeGalleryOpts({ page: 1, totalPages: 100 }));
    const dice = root.querySelector('.pyr3-bar-gallery-dice');
    expect(dice).not.toBeNull();
    expect(dice!.textContent).toBe('🎲 random page');
  });

  it('clicking the dice fires onRandomPage', () => {
    const root = document.createElement('div');
    const onRandom = vi.fn();
    mountGalleryBar(root, makeGalleryOpts({ page: 1, totalPages: 100, onRandomPage: onRandom }));
    const dice = root.querySelector('.pyr3-bar-gallery-dice') as HTMLAnchorElement;
    dice.click();
    expect(onRandom).toHaveBeenCalledTimes(1);
  });

  it('dice remains active at page bounds (prev/next disable but dice does not)', () => {
    const root = document.createElement('div');
    const onRandom = vi.fn();
    mountGalleryBar(root, makeGalleryOpts({ page: 1, totalPages: 10, onRandomPage: onRandom }));
    const dice = root.querySelector('.pyr3-bar-gallery-dice') as HTMLAnchorElement;
    expect(dice.classList.contains('disabled')).toBe(false);
    dice.click();
    expect(onRandom).toHaveBeenCalledTimes(1);
  });

  it('row carries the pyr3-bar-info-gallery class so the center cluster centers via the balanced-zone CSS', () => {
    const root = document.createElement('div');
    mountGalleryBar(root, makeGalleryOpts({ page: 1, totalPages: 10 }));
    const row = root.querySelector('.pyr3-bar-info-gallery');
    expect(row).not.toBeNull();
  });
});

describe('mountGalleryBar', () => {
  it('renders prev pill, page label, and next pill in the center cluster', () => {
    const root = document.createElement('div');
    mountGalleryBar(root, makeGalleryOpts({ page: 5, totalPages: 100 }));
    const center = root.querySelector('.pyr3-bar-gallery-nav') as HTMLElement | null;
    expect(center).not.toBeNull();
    expect(center!.textContent).toContain('‹ prev');
    expect(center!.textContent).toContain('page 5 of 100');
    expect(center!.textContent).toContain('next ›');
  });

  it('setPage updates the visible page-of-M label', () => {
    const root = document.createElement('div');
    const handle = mountGalleryBar(root, makeGalleryOpts({ page: 1, totalPages: 100 }));
    handle.setPage(27, 5778);
    const label = root.querySelector('.pyr3-bar-page-label') as HTMLElement;
    expect(label.textContent).toBe('page 27 of 5778');
  });

  it('disables the prev pill on page 1 and the next pill on the last page', () => {
    const root = document.createElement('div');
    const handle = mountGalleryBar(root, makeGalleryOpts({ page: 1, totalPages: 10 }));
    const prev = root.querySelectorAll('.pyr3-nav-pill')[0] as HTMLElement;
    const next = root.querySelectorAll('.pyr3-nav-pill')[1] as HTMLElement;
    expect(prev.classList.contains('disabled')).toBe(true);
    expect(next.classList.contains('disabled')).toBe(false);
    handle.setPage(10);
    expect(prev.classList.contains('disabled')).toBe(false);
    expect(next.classList.contains('disabled')).toBe(true);
  });

  it('fires onPrevPage / onNextPage when their pills are clicked', () => {
    const root = document.createElement('div');
    const onPrev = vi.fn();
    const onNext = vi.fn();
    mountGalleryBar(root, makeGalleryOpts({
      page: 5, totalPages: 10, onPrevPage: onPrev, onNextPage: onNext,
    }));
    const pills = Array.from(root.querySelectorAll('.pyr3-nav-pill')) as HTMLElement[];
    pills[0]!.click();
    pills[1]!.click();
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('disabled pills do not fire their callbacks', () => {
    const root = document.createElement('div');
    const onPrev = vi.fn();
    mountGalleryBar(root, makeGalleryOpts({
      page: 1, totalPages: 10, onPrevPage: onPrev,
    }));
    const prev = root.querySelectorAll('.pyr3-nav-pill')[0] as HTMLElement;
    prev.click();
    expect(onPrev).not.toHaveBeenCalled();
  });

  it('omits "of M" when totalPages is 0 (unknown corpus size)', () => {
    const root = document.createElement('div');
    mountGalleryBar(root, makeGalleryOpts({ page: 3, totalPages: 0 }));
    const label = root.querySelector('.pyr3-bar-page-label') as HTMLElement;
    expect(label.textContent).toBe('page 3');
  });

  it('destroy removes all gallery-bar nodes from root', () => {
    const root = document.createElement('div');
    const handle = mountGalleryBar(root, makeGalleryOpts());
    expect(root.children.length).toBeGreaterThan(0);
    handle.destroy();
    expect(root.children.length).toBe(0);
  });
});

describe('mountGalleryBar — [⚙ filters ▾] pill (#49)', () => {
  it('renders the pill with the wrench-and-caret label', () => {
    const root = document.createElement('div');
    mountGalleryBar(root, makeGalleryOpts({ page: 1, totalPages: 100 }));
    const pill = root.querySelector('.pyr3-bar-filter-pill');
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toContain('⚙ filters ▾');
  });

  it('badge is hidden when activeAxes is 0', () => {
    const root = document.createElement('div');
    mountGalleryBar(root, makeGalleryOpts({ activeAxes: 0 }));
    const badge = root.querySelector('.pyr3-bar-filter-badge') as HTMLSpanElement;
    expect(badge).not.toBeNull();
    expect(badge.style.display).toBe('none');
    expect(badge.textContent).toBe('');
  });

  it('badge shows "N active" when activeAxes ≥ 1', () => {
    const root = document.createElement('div');
    mountGalleryBar(root, makeGalleryOpts({ activeAxes: 2 }));
    const badge = root.querySelector('.pyr3-bar-filter-badge') as HTMLSpanElement;
    expect(badge.textContent).toBe('2 active');
    expect(badge.style.display).not.toBe('none');
  });

  it('setActiveAxes updates the badge at runtime', () => {
    const root = document.createElement('div');
    const handle = mountGalleryBar(root, makeGalleryOpts({ activeAxes: 0 }));
    const badge = root.querySelector('.pyr3-bar-filter-badge') as HTMLSpanElement;
    expect(badge.style.display).toBe('none');
    handle.setActiveAxes(3);
    expect(badge.textContent).toBe('3 active');
    expect(badge.style.display).not.toBe('none');
    handle.setActiveAxes(0);
    expect(badge.style.display).toBe('none');
  });

  it('clicking the pill fires onFilterToggle', () => {
    const root = document.createElement('div');
    const onFilterToggle = vi.fn();
    mountGalleryBar(root, makeGalleryOpts({ onFilterToggle }));
    const pill = root.querySelector('.pyr3-bar-filter-pill') as HTMLAnchorElement;
    pill.click();
    expect(onFilterToggle).toHaveBeenCalledTimes(1);
  });
});

describe('mountBarChrome', () => {
  it('renders the static chrome and exposes a middleSlot', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const webgpu: WebGPUStatus = { available: true } as WebGPUStatus;
    const onTabClick = vi.fn();

    const handle = mountBarChrome(root, {
      surface: 'viewer',
      webgpu,
      onTabClick,
    });

    expect(root.querySelector('.pyr3-brand')).toBeTruthy();
    expect(root.querySelector('.pyr3-tabs')).toBeTruthy();
    expect(root.querySelector('.pyr3-tab[data-surface="viewer"].active')).toBeTruthy();
    expect(root.querySelector('.pyr3-tab[data-surface="gallery"].active')).toBeFalsy();
    expect(root.querySelector('.pyr3-right-cluster')).toBeTruthy();
    expect(handle.middleSlot.classList.contains('pyr3-middle-slot')).toBe(true);

    handle.destroy();
    expect(root.children).toHaveLength(0);
  });

  it('routes tab clicks to onTabClick', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const onTabClick = vi.fn();
    const handle = mountBarChrome(root, {
      surface: 'gallery',
      webgpu: { available: true } as WebGPUStatus,
      onTabClick,
    });
    (root.querySelector('.pyr3-tab[data-surface="editor"]') as HTMLElement).click();
    expect(onTabClick).toHaveBeenCalledWith('editor');
    handle.destroy();
  });

  it('surface: "about" renders the tab group with NO tab active', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const handle = mountBarChrome(root, {
      surface: 'about',
      webgpu: { available: true } as WebGPUStatus,
      onTabClick: vi.fn(),
    });
    expect(root.querySelector('.pyr3-tabs')).toBeTruthy();
    expect(root.querySelector('.pyr3-tab.active')).toBeFalsy();
    handle.destroy();
  });

  it('TabSurface type accepts all four surfaces', () => {
    // Compile-time assertion — purely for the type re-export contract.
    const surfaces: TabSurface[] = ['viewer', 'gallery', 'editor', 'about'];
    expect(surfaces).toHaveLength(4);
  });
});

describe('mountAboutBar', () => {
  it('renders chrome with NO tab active (about lives in left cluster, not tabs)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const handle = mountAboutBar(root, {
      webgpu: { available: true } as WebGPUStatus,
      onTabClick: vi.fn(),
    });
    expect(root.querySelector('.pyr3-tab.active')).toBeFalsy();
    expect(root.querySelector('.pyr3-about-link.active')).toBeTruthy();
    handle.destroy();
  });
});

describe('viewer action row — Size + QUALITY (#103 Phase 3 Task 3.2)', () => {
  it('does NOT render an Advanced button', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountBar(root, makeBarOpts());
    const allText = root.textContent ?? '';
    expect(allText).not.toContain('Advanced');
    expect(root.querySelector('.pyr3-bar-advanced')).toBeNull();
  });

  it('renders a Size dropdown showing current dimensions with a ▾ caret', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const bar = mountBar(root, makeBarOpts());
    bar.setQuality({ width: 1920, height: 1080, spp: 50, tierLabel: 'Standard' });

    const sizeBtn = root.querySelector('.pyr3-bar-size') as HTMLElement;
    expect(sizeBtn).not.toBeNull();
    const txt = sizeBtn.textContent ?? '';
    expect(txt).toContain('1920×1080');
    expect(txt).toContain('▾');
  });

  it('renders a QUALITY label + numeric button group 10/25/50/75/100', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountBar(root, makeBarOpts());

    const qLabel = root.querySelector('.pyr3-bar-quality-label') as HTMLElement;
    expect(qLabel?.textContent?.toLowerCase()).toBe('quality');

    const qGroup = root.querySelectorAll('.pyr3-bar-quality-btn') as NodeListOf<HTMLButtonElement>;
    const labels = Array.from(qGroup).map((b) => b.textContent);
    expect(labels).toEqual(['10', '25', '50', '75', '100']);
  });

  it('highlights the active quality button in amber based on current spp', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const bar = mountBar(root, makeBarOpts());
    bar.setQuality({ width: 1920, height: 1080, spp: 50, tierLabel: 'Standard' });

    const buttons = Array.from(
      root.querySelectorAll('.pyr3-bar-quality-btn'),
    ) as HTMLButtonElement[];
    const active = buttons.filter((b) => b.classList.contains('on'));
    expect(active).toHaveLength(1);
    expect(active[0]!.textContent).toBe('50');
  });

  it('clicking a quality button fires onRenderQuality with that spp', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const onRenderQuality = vi.fn();
    const bar = mountBar(root, makeBarOpts({ onRenderQuality }));
    bar.setQuality({ width: 1920, height: 1080, spp: 50, tierLabel: 'Standard' });

    const buttons = Array.from(
      root.querySelectorAll('.pyr3-bar-quality-btn'),
    ) as HTMLButtonElement[];
    const q100 = buttons.find((b) => b.textContent === '100')!;
    q100.click();
    expect(onRenderQuality).toHaveBeenCalledTimes(1);
    const req = onRenderQuality.mock.calls[0]![0];
    expect(req.kind).toBe('custom');
    expect(req.spp).toBe(100);
  });

  it('clicking the Size button opens a categorized preset menu', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const bar = mountBar(root, makeBarOpts());
    bar.setQuality({ width: 1920, height: 1080, spp: 50, tierLabel: 'Standard' });

    const sizeBtn = root.querySelector('.pyr3-bar-size') as HTMLElement;
    sizeBtn.click();
    const menu = document.querySelector('.pyr3-size-menu') as HTMLElement;
    expect(menu).not.toBeNull();
    // Group headers present
    const headers = Array.from(menu.querySelectorAll('.pyr3-size-group')).map((g) => g.textContent);
    expect(headers).toContain('Common');
    expect(headers).toContain('Phone portrait');
    expect(headers).toContain('Tablet');
    // Footer link to Editor
    expect(menu.textContent ?? '').toContain('Custom size');
  });

  it('size menu item click fires onRenderQuality with the chosen dimensions long-edge', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const onRenderQuality = vi.fn();
    const bar = mountBar(root, makeBarOpts({ onRenderQuality }));
    bar.setQuality({ width: 1920, height: 1080, spp: 50, tierLabel: 'Standard' });

    const sizeBtn = root.querySelector('.pyr3-bar-size') as HTMLElement;
    sizeBtn.click();
    const items = Array.from(
      document.querySelectorAll('.pyr3-size-item'),
    ) as HTMLElement[];
    const fourK = items.find((i) => i.textContent?.includes('4K'))!;
    fourK.click();
    expect(onRenderQuality).toHaveBeenCalledTimes(1);
    const req = onRenderQuality.mock.calls[0]![0];
    expect(req.kind).toBe('custom');
    // 4K → 3840×2160; longEdge = 3840
    expect(req.longEdge).toBe(3840);
    expect(req.spp).toBe(50);
  });

  it('keeps the 🔥 surprise me and prev/next pills (does not remove the right cluster)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountBar(root, makeBarOpts());
    expect(root.querySelector('.pyr3-bar-viewer-dice')).not.toBeNull();
    expect(root.querySelector('.pyr3-bar-nav')).not.toBeNull();
  });
});

describe('viewer info row — all variations expanded (#103 Phase 3 Task 3.1)', () => {
  it('renders every variation inline with no +N collapse', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const bar = mountBar(root, makeBarOpts());
    bar.setMeta({ flameName: 'electricsheep.247.19679' });
    bar.setQuality({
      width: 1920, height: 1080, spp: 50, tierLabel: 'Standard',
    });
    bar.setVariations(['linear', 'julia', 'bent', 'fan', 'spherical', 'sinusoidal']);

    const variations = root.querySelector('.pyr3-bar-variations') as HTMLElement;
    expect(variations).not.toBeNull();
    const txt = variations.textContent ?? '';
    for (const v of ['linear', 'julia', 'bent', 'fan', 'spherical', 'sinusoidal']) {
      expect(txt).toContain(v);
    }
    // No `+N` truncation marker should appear, regardless of variation count.
    expect(txt).not.toMatch(/\+\d+/);
  });

  it('shows 12 variations all expanded (stress)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const bar = mountBar(root, makeBarOpts());
    const many = [
      'linear', 'julia', 'bent', 'fan', 'spherical', 'sinusoidal',
      'swirl', 'horseshoe', 'polar', 'handkerchief', 'heart', 'disc',
    ];
    bar.setVariations(many);
    const variations = root.querySelector('.pyr3-bar-variations') as HTMLElement;
    const txt = variations.textContent ?? '';
    for (const v of many) expect(txt).toContain(v);
    expect(txt).not.toMatch(/\+\d+/);
  });

  it('renders the info row with name, dim, quality, tier in flame-amber styling order', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const bar = mountBar(root, makeBarOpts());
    bar.setMeta({ flameName: 'electricsheep.247.19679' });
    bar.setQuality({ width: 1920, height: 1080, spp: 50, tierLabel: 'Standard' });

    // Name strong element (bold white)
    const nameStrong = root.querySelector('.pyr3-bar-meta-name strong') as HTMLElement;
    expect(nameStrong?.textContent).toBe('electricsheep.247.19679');

    // Quality span contains dim · q<n> · tier
    const quality = root.querySelector('.pyr3-bar-quality') as HTMLElement;
    expect(quality?.textContent ?? '').toContain('1920×1080');
    expect(quality?.textContent ?? '').toContain('q50');
    expect(quality?.textContent ?? '').toContain('Standard');
  });
});
