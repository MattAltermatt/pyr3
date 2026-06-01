// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { mountBar, mountGalleryBar, type BarOpts, type GalleryBarOpts } from './ui-bar';
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
    estimateCost: () => ({ width: 1024, height: 1024, mb: 4, fits: true }),
    ...over,
  };
}

describe('mountBar — gallery link', () => {
  it('left zone contains a gallery link with href pointing at /v1/gallery', () => {
    const root = document.createElement('div');
    mountBar(root, makeBarOpts());
    const links = Array.from(root.querySelectorAll('a'));
    const gallery = links.find((a) => a.textContent === 'gallery') as HTMLAnchorElement | undefined;
    expect(gallery).toBeDefined();
    expect(gallery!.getAttribute('href')).toMatch(/\/v1\/gallery$/);
  });

  it('setGalleryHref updates the link to the page-N URL', () => {
    const root = document.createElement('div');
    const handle = mountBar(root, makeBarOpts());
    handle.setGalleryHref(27);
    const gallery = Array.from(root.querySelectorAll('a')).find(
      (a) => a.textContent === 'gallery',
    ) as HTMLAnchorElement;
    expect(gallery.getAttribute('href')).toMatch(/\/v1\/gallery\/p\/27$/);
  });
});

function makeGalleryOpts(over: Partial<GalleryBarOpts> = {}): GalleryBarOpts {
  return {
    webgpu: STUB_WEBGPU,
    page: 1,
    totalPages: 0,
    onPrevPage: vi.fn(),
    onNextPage: vi.fn(),
    onRandomPage: vi.fn(),
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
