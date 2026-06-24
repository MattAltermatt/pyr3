// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { buildMobileInterstitial } from './mobile-interstitial';

describe('buildMobileInterstitial', () => {
  it('renders surface-specific copy and a view-flames action', () => {
    const onView = vi.fn();
    const el = buildMobileInterstitial('editor', onView);
    expect(el.textContent).toContain('bigger screen');
    const btn = el.querySelector('button');
    expect(btn).not.toBeNull();
    btn!.click();
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('uses distinct headings per surface', () => {
    expect(buildMobileInterstitial('editor', () => {}).textContent).toContain('editor');
    expect(buildMobileInterstitial('animate', () => {}).textContent).toContain('animation');
    expect(buildMobileInterstitial('screensaver', () => {}).textContent).toContain('screensaver');
  });
});
