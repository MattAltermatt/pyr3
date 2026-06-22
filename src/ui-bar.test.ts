// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import {
  mountAboutBar,
  mountBar,
  mountBarChrome,
  mountEditBar,
  mountGalleryBar,
  type BarOpts,
  type EditBarOpts,
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
    mode: 'esf',
    onOpenFile: vi.fn(),
    onRenderQuality: vi.fn(),
    onNavigate: vi.fn(),
    onSave: vi.fn(),
    onSaveFlame: vi.fn(),
    onSurpriseMe: vi.fn(),
    onEditFlame: vi.fn(),
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

function makeEditOpts(over: Partial<EditBarOpts> = {}): EditBarOpts {
  return {
    webgpu: STUB_WEBGPU,
    onOpenFile: vi.fn(),
    onReroll: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSizeChange: vi.fn(),
    onQualityChange: vi.fn(),
    onSaveFlame: vi.fn(),
    onSave: vi.fn(),
    onTabClick: vi.fn(),
    ...over,
  };
}

describe('#356 — bar ethos sweep (verb-heavy surfaces keep a slim 2nd row)', () => {
  // The #367 restructure folded the few viewer/editor verbs into the identity
  // row's right gutter and dropped the action bar. The two remaining surfaces on
  // the old layout — the gradient editor and the ESF corpus viewer — are
  // verb-heavy (gradient) or nav-primary (esf), so they KEEP a second row;
  // only the light/secondary controls move up into the identity-row gutter.

  it('esf: Save Flame + Edit move to the identity-row gutter; corpus nav + dice keep the slim action row', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountBar(root, makeBarOpts({ mode: 'esf' }));
    const gutter = root.querySelector('.pyr3-bar-info .pyr3-bar-info-actions')!;
    expect(gutter.querySelector('.pyr3-bar-save-flame'), 'Save Flame in the gutter').toBeTruthy();
    expect(gutter.querySelector('.pyr3-bar-edit-flame'), 'Edit in the gutter').toBeTruthy();
    // The corpus walker + 🎲 dice are the surface's primary affordance — they
    // stay as their own slim strip, not buried among the verbs.
    const actionRow = root.querySelector('.pyr3-bar-action')!;
    expect(actionRow.querySelector('.pyr3-bar-viewer-dice'), 'dice stays on the action row').toBeTruthy();
    expect(actionRow.querySelector('.pyr3-bar-nav'), 'corpus nav stays on the action row').toBeTruthy();
    expect(gutter.querySelector('.pyr3-bar-viewer-dice'), 'dice not pulled into the gutter').toBeNull();
    expect(gutter.querySelector('.pyr3-bar-nav'), 'corpus nav not pulled into the gutter').toBeNull();
  });

  it('esf: the slim action row carries ONLY the corpus strip (no leftover verbs)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountBar(root, makeBarOpts({ mode: 'esf' }));
    const actionRow = root.querySelector('.pyr3-bar-action')!;
    // Save Flame + Edit verbs have moved up; they must not also remain on the row.
    expect(actionRow.querySelector('.pyr3-bar-save-flame')).toBeNull();
    expect(actionRow.querySelector('.pyr3-bar-edit-flame')).toBeNull();
  });
});

describe('gallery info row — three-column with centered page-nav (#103 Phase 4 Task 4.1)', () => {
  it('info row is a 3-column grid (1fr | auto | 1fr) keeping the page-nav cluster centered', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountGalleryBar(root, makeGalleryOpts({ page: 1, totalPages: 100 }));
    const row = root.querySelector('.pyr3-bar-info-gallery') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.style.display).toBe('grid');
    expect(row.style.gridTemplateColumns).toBe('1fr auto 1fr');
  });

  it('page-text element has min-width: 160px (prev/next pills do not shift)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountGalleryBar(root, makeGalleryOpts({ page: 1, totalPages: 100 }));
    const pageLabel = root.querySelector('.pyr3-bar-page-label') as HTMLElement;
    expect(pageLabel).not.toBeNull();
    expect(pageLabel.style.minWidth).toBe('160px');
  });

  it('filter button is in the right column (right of the centered page-nav cluster)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountGalleryBar(root, makeGalleryOpts({ page: 1, totalPages: 100 }));
    const row = root.querySelector('.pyr3-bar-info-gallery') as HTMLElement;
    expect(row).not.toBeNull();
    // The row has three direct children: left placeholder, center page-nav,
    // right filter-cluster. The filter pill lives inside the third child.
    expect(row.children.length).toBe(3);
    const rightCol = row.children[2] as HTMLElement;
    expect(rightCol.querySelector('.pyr3-bar-filter-pill')).not.toBeNull();
    // And it must NOT appear inside the center column.
    const centerCol = row.children[1] as HTMLElement;
    expect(centerCol.querySelector('.pyr3-bar-filter-pill')).toBeNull();
  });

  it('prev pill left position does not change as the page number digit count grows', () => {
    // Snapshot test: rendering "page 1 of 5798" vs "page 4278 of 5798" must
    // keep the prev pill anchored at the same horizontal offset (the pinned
    // 160px min-width on the page-text element absorbs the digit-count delta).
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const handle = mountGalleryBar(root, makeGalleryOpts({ page: 1, totalPages: 5798 }));

    const prevPill = root.querySelectorAll('.pyr3-nav-pill')[0] as HTMLElement;
    const pageLabel = root.querySelector('.pyr3-bar-page-label') as HTMLElement;
    expect(pageLabel.textContent).toBe('page 1 of 5798');
    const leftAtPage1 = prevPill.getBoundingClientRect().left;

    handle.setPage(4278);
    expect(pageLabel.textContent).toBe('page 4278 of 5798');
    const leftAtPage4278 = prevPill.getBoundingClientRect().left;

    expect(leftAtPage4278).toBe(leftAtPage1);
  });
});

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
    expect(root.querySelector('.pyr3-nav')).toBeTruthy();
    expect(root.querySelector('.pyr3-nav-top[data-nav-top="viewer"].active')).toBeTruthy();
    expect(root.querySelector('.pyr3-nav-top[data-nav-top="editor"].active')).toBeFalsy();
    expect(root.querySelector('.pyr3-right-cluster')).toBeTruthy();
    expect(handle.middleSlot.classList.contains('pyr3-middle-slot')).toBe(true);

    handle.destroy();
    expect(root.children).toHaveLength(0);
  });

  it('mounts the nav menu and highlights the active surface under its parent menu', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const handle = mountBarChrome(root, {
      surface: 'gallery',
      webgpu: { available: true } as WebGPUStatus,
      onTabClick: vi.fn(),
    });
    // #264 — gallery lives under the ESF dropdown, so ESF (top) + Gallery (leaf)
    // both carry the active class.
    expect(root.querySelector('.pyr3-nav-top[data-nav-top="esf"].active')).toBeTruthy();
    expect(root.querySelector('.pyr3-nav-item[data-nav-sub="gallery"].active')).toBeTruthy();
    handle.destroy();
  });

  it('surface: "about" highlights the Help menu (About moved under Help, #420)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const handle = mountBarChrome(root, {
      surface: 'about',
      webgpu: { available: true } as WebGPUStatus,
      onTabClick: vi.fn(),
    });
    expect(root.querySelector('.pyr3-nav')).toBeTruthy();
    expect(root.querySelector('.pyr3-nav-top[data-nav-top="help"].active')).toBeTruthy();
    expect(root.querySelector('.pyr3-nav-item[data-nav-sub="about"].active')).toBeTruthy();
    handle.destroy();
  });

  it('surface: "variations" highlights the Discover menu (Variations lives under Discover)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const handle = mountBarChrome(root, {
      surface: 'variations',
      webgpu: { available: true } as WebGPUStatus,
      onTabClick: vi.fn(),
    });
    expect(root.querySelector('.pyr3-nav-top[data-nav-top="discover"].active')).toBeTruthy();
    expect(root.querySelector('.pyr3-nav-item[data-nav-sub="variations"].active')).toBeTruthy();
    handle.destroy();
  });

  it('surface: "surprise" highlights the Discover menu (Surprise lives under Discover)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const handle = mountBarChrome(root, {
      surface: 'surprise',
      webgpu: { available: true } as WebGPUStatus,
      onTabClick: vi.fn(),
    });
    expect(root.querySelector('.pyr3-nav-top[data-nav-top="discover"].active')).toBeTruthy();
    expect(root.querySelector('.pyr3-nav-item[data-nav-sub="surprise"].active')).toBeTruthy();
    handle.destroy();
  });

  it('TabSurface type accepts every nav surface', () => {
    // Compile-time assertion — purely for the type re-export contract.
    const surfaces: TabSurface[] = [
      'viewer', 'gallery', 'editor', 'about', 'variations', 'surprise',
    ];
    expect(surfaces).toHaveLength(6);
  });

  it('renders a run offline CTA button in the right cluster instead of fork it', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const handle = mountBarChrome(root, {
      surface: 'viewer',
      webgpu: { available: true } as WebGPUStatus,
      onTabClick: vi.fn(),
    });

    const allCta = Array.from(root.querySelectorAll('.pyr3-bar-cta')) as HTMLElement[];
    const forkCta = allCta.find((c) => c.textContent?.includes('fork it'));
    expect(forkCta).toBeUndefined();

    const offlineCta = allCta.find((c) => c.textContent?.includes('run offline'));
    expect(offlineCta).toBeTruthy();
    expect(offlineCta!.textContent).toContain('run offline');
    expect(offlineCta!.textContent).toContain('desktop CLI');

    handle.destroy();
  });

  it('clicking the run offline CTA opens the dropdown menu and clicking outside closes it', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const handle = mountBarChrome(root, {
      surface: 'viewer',
      webgpu: { available: true } as WebGPUStatus,
      onTabClick: vi.fn(),
    });

    const allCta = Array.from(root.querySelectorAll('.pyr3-bar-cta')) as HTMLElement[];
    const offlineCta = allCta.find((c) => c.textContent?.includes('run offline'))!;

    expect(document.querySelector('.pyr3-offline-menu')).toBeNull();

    offlineCta.click();

    const menu = document.querySelector('.pyr3-offline-menu') as HTMLElement;
    expect(menu).not.toBeNull();
    expect(menu.textContent).toContain('Render at any quality on your own GPU');
    expect(menu.textContent).toContain('Source & CLI Guide');

    // Wait for the open event listener to attach via setTimeout
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Click inside the menu should not close it
    menu.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.pyr3-offline-menu')).not.toBeNull();

    // Click outside should close it
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector('.pyr3-offline-menu')).toBeNull();

    handle.destroy();
  });
});

describe('mountAboutBar', () => {
  it('highlights the About leaf under the Help menu as the you-are-here cue (#420)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const handle = mountAboutBar(root, {
      webgpu: { available: true } as WebGPUStatus,
      onTabClick: vi.fn(),
    });
    // About moved into the Help menu (#420) — its leaf + the Help top go active.
    expect(root.querySelector('[data-nav-sub="about"].active')).toBeTruthy();
    expect(root.querySelector('[data-nav-top="help"].active')).toBeTruthy();
    handle.destroy();
  });

  it('clears prior children from root before mounting (matches mountBar / mountEditBar / mountGalleryBar)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const stale = document.createElement('div');
    stale.className = 'stale-prior-content';
    stale.textContent = 'leftover';
    root.appendChild(stale);
    mountAboutBar(root, {
      webgpu: { available: true } as WebGPUStatus,
      onTabClick: vi.fn(),
    });
    expect(root.querySelector('.stale-prior-content')).toBeNull();
  });

  it('exposes a middleSlot on the handle (DRY substrate contract — matches mountBar / mountGalleryBar / mountEditBar)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const handle = mountAboutBar(root, {
      webgpu: { available: true } as WebGPUStatus,
      onTabClick: vi.fn(),
    });
    expect(handle.middleSlot).toBeInstanceOf(HTMLElement);
    expect(handle.middleSlot.classList.contains('pyr3-middle-slot')).toBe(true);
    // Caller can append the About body into it — round-trip the contract.
    const probe = document.createElement('div');
    probe.className = 'about-body-probe';
    handle.middleSlot.appendChild(probe);
    expect(root.querySelector('.about-body-probe')).toBe(probe);
  });
});

describe('viewer action row — Save Flame + Save Render (#103 Phase 3 Task 3.3)', () => {
  it('renders TWO distinct save buttons (Save Flame secondary + Save Render primary)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountBar(root, makeBarOpts());

    const saveFlame = root.querySelector('.pyr3-bar-save-flame') as HTMLElement;
    const saveRender = root.querySelector('.pyr3-bar-save-render') as HTMLElement;
    expect(saveFlame).not.toBeNull();
    expect(saveRender).not.toBeNull();
    expect(saveFlame.textContent).toContain('Save Flame');
    expect(saveRender.textContent).toContain('Save Render');
  });

  it('Save Render carries primary-CTA styling (pyr3-btn-primary class)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountBar(root, makeBarOpts());
    const saveRender = root.querySelector('.pyr3-bar-save-render') as HTMLElement;
    expect(saveRender.classList.contains('pyr3-btn-primary')).toBe(true);
  });

  it('Save Flame uses standard secondary styling (pyr3-btn class)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountBar(root, makeBarOpts());
    const saveFlame = root.querySelector('.pyr3-bar-save-flame') as HTMLElement;
    expect(saveFlame.classList.contains('pyr3-btn')).toBe(true);
    expect(saveFlame.classList.contains('pyr3-btn-primary')).toBe(false);
  });

  it('clicking Save Render fires the existing onSave handler with the composed filename', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const onSave = vi.fn();
    const bar = mountBar(root, makeBarOpts({ onSave }));
    bar.setMeta({ flameName: 'electricsheep.247.19679' });
    bar.setQuality({ width: 1920, height: 1080, spp: 50, tierLabel: 'Standard' });
    const saveRender = root.querySelector('.pyr3-bar-save-render') as HTMLElement;
    saveRender.click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0]).toContain('electricsheep.247.19679');
    expect(onSave.mock.calls[0]![0]).toMatch(/\.png$/);
  });

  it('clicking Save Flame fires onSaveFlame with a .pyr3.json filename', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const onSaveFlame = vi.fn();
    const bar = mountBar(root, makeBarOpts({ onSaveFlame }));
    bar.setMeta({ flameName: 'electricsheep.247.19679' });
    bar.setQuality({ width: 1920, height: 1080, spp: 50, tierLabel: 'Standard' });
    const saveFlame = root.querySelector('.pyr3-bar-save-flame') as HTMLElement;
    saveFlame.click();
    expect(onSaveFlame).toHaveBeenCalledTimes(1);
    const fn = onSaveFlame.mock.calls[0]![0] as string;
    expect(fn).toContain('electricsheep.247.19679');
    expect(fn).toMatch(/\.pyr3\.json$/);
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

describe('viewer mode split — basic vs esf (#264)', () => {
  const openBtn = (root: HTMLElement): HTMLElement | null =>
    ([...root.querySelectorAll('.pyr3-bar-btn')].find((b) => b.textContent?.includes('Open')) as HTMLElement | undefined) ?? null;

  it('esf mode shows Surprise + corpus nav, hides 📂 Open', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountBar(root, makeBarOpts({ mode: 'esf' }));
    expect(root.querySelector('.pyr3-bar-viewer-dice')).not.toBeNull();
    expect(root.querySelector('.pyr3-bar-nav')).not.toBeNull();
    expect(openBtn(root)).toBeNull();
  });

  it('basic mode shows 📂 Open, hides Surprise + corpus nav', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountBar(root, makeBarOpts({ mode: 'basic' }));
    expect(openBtn(root)).not.toBeNull();
    expect(root.querySelector('.pyr3-bar-viewer-dice')).toBeNull();
    expect(root.querySelector('.pyr3-bar-nav')).toBeNull();
  });

  it('renders "✏️ Edit" in both modes and fires onEditFlame on click', () => {
    for (const mode of ['basic', 'esf'] as const) {
      document.body.innerHTML = '<div id="root"></div>';
      const root = document.getElementById('root')!;
      const onEditFlame = vi.fn();
      mountBar(root, makeBarOpts({ mode, onEditFlame }));
      const edit = root.querySelector('.pyr3-bar-edit-flame') as HTMLElement;
      expect(edit).not.toBeNull();
      edit.click();
      expect(onEditFlame).toHaveBeenCalledOnce();
    }
  });

  it('basic mode chrome marks the Viewer menu active; esf marks ESF', () => {
    document.body.innerHTML = '<div id="b"></div>';
    const basic = document.getElementById('b')!;
    mountBar(basic, makeBarOpts({ mode: 'basic' }));
    expect(basic.querySelector('.pyr3-nav-top[data-nav-top="viewer"].active')).not.toBeNull();

    document.body.innerHTML = '<div id="e"></div>';
    const esf = document.getElementById('e')!;
    mountBar(esf, makeBarOpts({ mode: 'esf' }));
    expect(esf.querySelector('.pyr3-nav-top[data-nav-top="esf"].active')).not.toBeNull();
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

describe('editor info row — read-only identity + dims (#346)', () => {
  it('drops editable naming, keeps the read-only loaded chip (#346)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const h = mountEditBar(root, makeEditOpts());
    // editable naming gone:
    expect(root.querySelector('.pyr3-bar-name-input')).toBeNull();
    expect(root.querySelector('.pyr3-bar-nick-input')).toBeNull();
    expect(root.querySelector('.pyr3-bar-name-preview')).toBeNull();
    expect(root.querySelector('.pyr3-bar-templates-link')).toBeNull();
    // info row carries no editable-naming INPUTS (the read-only chip is a
    // span). #367 moved the action verbs into the info row's right zone, so
    // buttons now live here — but never naming inputs.
    const infoRow = root.querySelector('.pyr3-bar-info') as HTMLElement;
    expect(infoRow).not.toBeNull();
    expect(infoRow.querySelectorAll('input').length).toBe(0);
    // the action verbs sit in the right zone (#367):
    expect(infoRow.querySelector('.pyr3-bar-info-actions .pyr3-edit-open')).not.toBeNull();
    // read-only identity KEPT + still driven by setMeta:
    h.setMeta({ flameName: 'ember', authorNick: 'mu' });
    const chip = root.querySelector('.pyr3-bar-loaded-source') as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain('ember');
    h.destroy();
  });

  it('dimensions readout shows `${width}×${height}` and uses the amber quality class', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const handle = mountEditBar(root, makeEditOpts());
    handle.setDimensions({ width: 1920, height: 1080 });
    const dims = root.querySelector('.pyr3-bar-info .pyr3-bar-quality') as HTMLElement;
    expect(dims).not.toBeNull();
    expect(dims.textContent).toBe('1920×1080');
  });
});

describe('editor action row — Open · Reroll · Size · QUALITY · Save Flame · Save Render (#103 Phase 6 Task 6.2)', () => {
  it('renders the action row with all six controls in order', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountEditBar(root, makeEditOpts());

    const actionRow = root.querySelector('.pyr3-bar-info-actions') as HTMLElement;
    expect(actionRow).not.toBeNull();

    const openBtn = actionRow.querySelector('.pyr3-edit-open') as HTMLElement;
    const rerollBtn = actionRow.querySelector('.pyr3-edit-reroll') as HTMLElement;
    const sizeBtn = actionRow.querySelector('.pyr3-bar-size') as HTMLElement;
    const qualityLabel = actionRow.querySelector('.pyr3-bar-quality-label') as HTMLElement;
    const qualityGroup = actionRow.querySelector('.pyr3-bar-quality-group') as HTMLElement;
    const saveFlame = actionRow.querySelector('.pyr3-bar-save-flame') as HTMLElement;
    const saveRender = actionRow.querySelector('.pyr3-bar-save-render') as HTMLElement;

    expect(openBtn).not.toBeNull();
    expect(rerollBtn).not.toBeNull();
    expect(sizeBtn).not.toBeNull();
    expect(qualityLabel).not.toBeNull();
    expect(qualityGroup).not.toBeNull();
    expect(saveFlame).not.toBeNull();
    expect(saveRender).not.toBeNull();

    // Document order: Open → Reroll → Size → QUALITY label → QUALITY group → Save Flame → Save Render
    const ordered = [openBtn, rerollBtn, sizeBtn, qualityLabel, qualityGroup, saveFlame, saveRender];
    for (let i = 1; i < ordered.length; i++) {
      const earlier =
        ordered[i - 1]!.compareDocumentPosition(ordered[i]!) & Node.DOCUMENT_POSITION_FOLLOWING;
      expect(earlier).toBeTruthy();
    }

    expect(openBtn.textContent).toContain('Open');
    expect(rerollBtn.textContent).toContain('Reroll');
    expect(saveFlame.textContent).toContain('Save Flame');
    expect(saveRender.textContent).toContain('Save Render');
  });

  it('Save Render carries the primary-CTA class', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountEditBar(root, makeEditOpts());
    const saveRender = root.querySelector('.pyr3-bar-save-render') as HTMLElement;
    expect(saveRender.classList.contains('pyr3-btn-primary')).toBe(true);
  });

  it('Save Flame uses standard secondary styling (pyr3-btn class)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountEditBar(root, makeEditOpts());
    const saveFlame = root.querySelector('.pyr3-bar-save-flame') as HTMLElement;
    expect(saveFlame.classList.contains('pyr3-btn')).toBe(true);
    expect(saveFlame.classList.contains('pyr3-btn-primary')).toBe(false);
  });

  it('clicking Open fires onOpenFile', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const onOpenFile = vi.fn();
    mountEditBar(root, makeEditOpts({ onOpenFile }));
    (root.querySelector('.pyr3-edit-open') as HTMLElement).click();
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  it('clicking Reroll fires onReroll', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const onReroll = vi.fn();
    mountEditBar(root, makeEditOpts({ onReroll }));
    (root.querySelector('.pyr3-edit-reroll') as HTMLElement).click();
    expect(onReroll).toHaveBeenCalledTimes(1);
  });

  it('renders QUALITY numeric group 10/25/50/75/100', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountEditBar(root, makeEditOpts());
    const qLabel = root.querySelector(
      '.pyr3-bar-info-actions .pyr3-bar-quality-label',
    ) as HTMLElement;
    expect(qLabel?.textContent?.toLowerCase()).toBe('quality');
    const buttons = Array.from(
      root.querySelectorAll('.pyr3-bar-info-actions .pyr3-bar-quality-btn:not(.pyr3-bar-settle-btn)'),
    ) as HTMLButtonElement[];
    const labels = buttons.map((b) => b.textContent);
    expect(labels).toEqual(['10', '25', '50', '75', '100']);
  });

  it('highlights the active quality button in amber based on the current spp', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const handle = mountEditBar(root, makeEditOpts());
    handle.setQuality(75);
    const buttons = Array.from(
      root.querySelectorAll('.pyr3-bar-info-actions .pyr3-bar-quality-btn:not(.pyr3-bar-settle-btn)'),
    ) as HTMLButtonElement[];
    const active = buttons.filter((b) => b.classList.contains('on'));
    expect(active).toHaveLength(1);
    expect(active[0]!.textContent).toBe('75');
  });

  it('clicking a QUALITY button fires onQualityChange with that spp', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const onQualityChange = vi.fn();
    mountEditBar(root, makeEditOpts({ onQualityChange }));
    const buttons = Array.from(
      root.querySelectorAll('.pyr3-bar-info-actions .pyr3-bar-quality-btn:not(.pyr3-bar-settle-btn)'),
    ) as HTMLButtonElement[];
    buttons.find((b) => b.textContent === '100')!.click();
    expect(onQualityChange).toHaveBeenCalledWith(100);
  });

  // #367 — the editor's SETTLE ladder moved out of the bar into the panel
  // topbar (edit-ui.ts), next to the `settle` scrubby. Its behaviour is now
  // covered by edit-ui.test.ts; the bar no longer renders a settle ladder.
  it('no longer renders a SETTLE ladder on the bar (moved to the panel, #367)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountEditBar(root, makeEditOpts());
    expect(root.querySelector('.pyr3-bar-settle-btn')).toBeNull();
    expect(root.querySelector('.pyr3-bar-settle-label')).toBeNull();
  });

  it('clicking a Size menu item fires onSizeChange with the chosen dimensions', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const onSizeChange = vi.fn();
    mountEditBar(root, makeEditOpts({ onSizeChange }));
    const sizeBtn = root.querySelector('.pyr3-bar-info-actions .pyr3-bar-size') as HTMLElement;
    sizeBtn.click();
    const menu = document.querySelector('.pyr3-size-menu') as HTMLElement;
    expect(menu).not.toBeNull();
    const items = Array.from(menu.querySelectorAll('.pyr3-size-item')) as HTMLElement[];
    items[0]!.click(); // first item under "Common" = HD = 1920×1080
    expect(onSizeChange).toHaveBeenCalledWith(1920, 1080);
  });

  it('size menu in editor does NOT carry the "open in Editor" deflect footer', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountEditBar(root, makeEditOpts());
    const sizeBtn = root.querySelector('.pyr3-bar-info-actions .pyr3-bar-size') as HTMLElement;
    sizeBtn.click();
    const menu = document.querySelector('.pyr3-size-menu') as HTMLElement;
    const footer = menu.querySelector('.pyr3-size-footer');
    expect(footer).toBeNull();
    expect(menu.textContent ?? '').not.toContain('open in Editor');
  });

  it('does NOT render the viewer-side right cluster (no surprise / prev / next)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountEditBar(root, makeEditOpts());
    expect(root.querySelector('.pyr3-bar-viewer-dice')).toBeNull();
    expect(root.querySelector('.pyr3-bar-nav')).toBeNull();
  });

  it('clicking Save Flame fires onSaveFlame', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const onSaveFlame = vi.fn();
    mountEditBar(root, makeEditOpts({ onSaveFlame }));
    (root.querySelector('.pyr3-bar-save-flame') as HTMLElement).click();
    expect(onSaveFlame).toHaveBeenCalledTimes(1);
  });

  it('clicking Save Render fires onSave', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const onSave = vi.fn();
    mountEditBar(root, makeEditOpts({ onSave }));
    (root.querySelector('.pyr3-bar-save-render') as HTMLElement).click();
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});


describe('#418 — esf Browse: corpus strip + progress relocate to the bottom-bar host', () => {
  it('mounts the action row into esfBottomBarHost (not the bar root) when provided', () => {
    const root = document.createElement('div');
    const host = document.createElement('div');
    mountBar(root, makeBarOpts({ mode: 'esf', esfBottomBarHost: host }));
    expect(host.querySelector('.pyr3-bar-action')).toBeTruthy();
    expect(root.querySelector('.pyr3-bar-action')).toBeNull();
  });

  it('mounts the render-progress (tier3) row into esfBottomBarHost on showProgress', () => {
    const root = document.createElement('div');
    const host = document.createElement('div');
    const bar = mountBar(root, makeBarOpts({ mode: 'esf', esfBottomBarHost: host }));
    bar.showProgress({ label: 'Rendering', percent: 0.5, etaSeconds: 3, samples: 1_000_000, onCancel: () => {} });
    expect(host.querySelector('.pyr3-bar-tier3')).toBeTruthy();
    expect(root.querySelector('.pyr3-bar-tier3')).toBeNull();
  });

  it('without a host, the esf action row stays in the bar root (default unchanged)', () => {
    const root = document.createElement('div');
    mountBar(root, makeBarOpts({ mode: 'esf' }));
    expect(root.querySelector('.pyr3-bar-action')).toBeTruthy();
  });
});

describe('#419 — gallery: page-nav strip relocates to galleryBottomBarHost', () => {
  function makeGalleryOpts(over: Partial<GalleryBarOpts> = {}): GalleryBarOpts {
    return {
      webgpu: STUB_WEBGPU, page: 1, totalPages: 10,
      onPrevPage: vi.fn(), onNextPage: vi.fn(), onRandomPage: vi.fn(),
      activeAxes: 0, onFilterToggle: vi.fn(), onTabClick: vi.fn(),
      ...over,
    };
  }
  it('mounts the page-nav info row into galleryBottomBarHost when provided', () => {
    const root = document.createElement('div');
    const host = document.createElement('div');
    mountGalleryBar(root, makeGalleryOpts({ galleryBottomBarHost: host }));
    expect(host.querySelector('.pyr3-bar-info-gallery')).toBeTruthy();
    expect(root.querySelector('.pyr3-bar-info-gallery')).toBeNull();
  });
  it('without a host, the page-nav row stays in the bar root (default unchanged)', () => {
    const root = document.createElement('div');
    mountGalleryBar(root, makeGalleryOpts());
    expect(root.querySelector('.pyr3-bar-info-gallery')).toBeTruthy();
  });
});
