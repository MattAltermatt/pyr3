// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { isMobile, MOBILE_MAX_WIDTH, onMobileChange } from './mobile';

describe('isMobile', () => {
  const orig = { iw: window.innerWidth, mm: window.matchMedia };
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: orig.iw });
    window.matchMedia = orig.mm;
  });

  it('is false on a wide desktop viewport', () => {
    window.innerWidth = 1280;
    expect(isMobile()).toBe(false);
  });

  it('is true at or below the breakpoint', () => {
    window.innerWidth = MOBILE_MAX_WIDTH;
    expect(isMobile()).toBe(true);
    window.innerWidth = 375;
    expect(isMobile()).toBe(true);
  });

  it('is true just above the breakpoint when the pointer is coarse', () => {
    window.innerWidth = MOBILE_MAX_WIDTH + 100;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    expect(isMobile()).toBe(true);
  });

  it('is false above the breakpoint with a fine pointer', () => {
    window.innerWidth = MOBILE_MAX_WIDTH + 100;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    expect(isMobile()).toBe(false);
  });
});

describe('onMobileChange', () => {
  const orig = { iw: window.innerWidth, mm: window.matchMedia };
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: orig.iw });
    window.matchMedia = orig.mm;
  });

  it('fires only when the verdict changes across a resize', () => {
    const cb = vi.fn();
    const teardown = onMobileChange(cb);

    // Still desktop → no fire.
    window.innerWidth = 1100;
    window.dispatchEvent(new Event('resize'));
    expect(cb).not.toHaveBeenCalled();

    // Cross into mobile → one fire(true).
    window.innerWidth = 400;
    window.dispatchEvent(new Event('resize'));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(true);

    // Back to desktop → one fire(false).
    window.innerWidth = 1280;
    window.dispatchEvent(new Event('resize'));
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith(false);

    teardown();
    window.innerWidth = 400;
    window.dispatchEvent(new Event('resize'));
    expect(cb).toHaveBeenCalledTimes(2); // no fire after teardown
  });
});
