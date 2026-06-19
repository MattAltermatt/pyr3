// @vitest-environment happy-dom
//
// pyr3 — info-icon + anchored popover primitive (Phase 7 visual overhaul).
//
// Click an `?` icon to toggle an explainer popover anchored to the icon's
// nearest `.pyr3-section` ancestor. Right-side by default; falls back to
// left when the viewport has no room.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildInfoIcon } from './edit-tooltip';

describe('buildInfoIcon', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    // Belt-and-braces: clear any leaked tooltips between tests.
    document.querySelectorAll('.pyr3-tooltip').forEach((n) => n.remove());
  });

  it('returns a `?` icon element with class pyr3-info-icon', () => {
    const icon = buildInfoIcon({ title: 'gamma', body: 'controls overall brightness curve' });
    expect(icon.className).toBe('pyr3-info-icon');
    expect(icon.textContent).toBe('?');
  });

  it('click toggles a .pyr3-tooltip popover; second click dismisses', () => {
    const sect = document.createElement('div');
    sect.className = 'pyr3-section';
    sect.getBoundingClientRect = () => ({
      left: 200, right: 600, top: 100, bottom: 500,
      x: 200, y: 100, width: 400, height: 400, toJSON: () => ({}),
    } as DOMRect);

    const icon = buildInfoIcon({ title: 'gamma', body: 'brightness curve' });
    sect.appendChild(icon);
    document.body.appendChild(sect);

    icon.click();
    expect(document.querySelector('.pyr3-tooltip')).toBeTruthy();
    icon.click();
    expect(document.querySelector('.pyr3-tooltip')).toBeFalsy();
  });

  it('click outside the popover dismisses it', async () => {
    const sect = document.createElement('div');
    sect.className = 'pyr3-section';
    sect.getBoundingClientRect = () => ({
      left: 200, right: 600, top: 100, bottom: 500,
      x: 200, y: 100, width: 400, height: 400, toJSON: () => ({}),
    } as DOMRect);

    const outside = document.createElement('div');

    const icon = buildInfoIcon({ title: 't', body: 'b' });
    sect.appendChild(icon);
    document.body.appendChild(sect);
    document.body.appendChild(outside);

    icon.click();
    expect(document.querySelector('.pyr3-tooltip')).toBeTruthy();

    // The capture-phase outside-click handler is registered on a microtask
    // delay; flush macrotasks before dispatching.
    await new Promise((r) => setTimeout(r, 0));
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.pyr3-tooltip')).toBeFalsy();
  });

  it('popover renders title + body + optional hint', () => {
    const sect = document.createElement('div');
    sect.className = 'pyr3-section';
    sect.getBoundingClientRect = () => ({
      left: 100, right: 500, top: 50, bottom: 450,
      x: 100, y: 50, width: 400, height: 400, toJSON: () => ({}),
    } as DOMRect);
    const icon = buildInfoIcon({ title: 'vibrancy', body: 'saturation lift', hint: 'leave at 1.0' });
    sect.appendChild(icon);
    document.body.appendChild(sect);

    icon.click();
    const tip = document.querySelector('.pyr3-tooltip') as HTMLElement;
    expect(tip).toBeTruthy();
    expect(tip.textContent).toContain('vibrancy');
    expect(tip.textContent).toContain('saturation lift');
    expect(tip.textContent).toContain('leave at 1.0');
    const hint = tip.querySelector('.pyr3-tooltip-hint');
    expect(hint).toBeTruthy();
  });

  it('anchors right of the section when there is room', () => {
    const sect = document.createElement('div');
    sect.className = 'pyr3-section';
    sect.getBoundingClientRect = () => ({
      left: 100, right: 400, top: 50, bottom: 450,
      x: 100, y: 50, width: 300, height: 400, toJSON: () => ({}),
    } as DOMRect);

    // generous viewport
    vi.stubGlobal('innerWidth', 1600);

    const icon = buildInfoIcon({ title: 't', body: 'b' });
    sect.appendChild(icon);
    document.body.appendChild(sect);

    icon.click();
    const tip = document.querySelector('.pyr3-tooltip') as HTMLElement;
    expect(tip).toBeTruthy();
    // right anchor → left = section.right + gap
    const leftPx = parseInt(tip.style.left, 10);
    expect(leftPx).toBeGreaterThanOrEqual(400);

    vi.unstubAllGlobals();
  });

  it('falls back to left of the section when right has no room', () => {
    const sect = document.createElement('div');
    sect.className = 'pyr3-section';
    sect.getBoundingClientRect = () => ({
      left: 100, right: 400, top: 50, bottom: 450,
      x: 100, y: 50, width: 300, height: 400, toJSON: () => ({}),
    } as DOMRect);

    // viewport too narrow for right-anchor tooltip (250px wide + 14gap)
    vi.stubGlobal('innerWidth', 500);

    const icon = buildInfoIcon({ title: 't', body: 'b' });
    sect.appendChild(icon);
    document.body.appendChild(sect);

    icon.click();
    const tip = document.querySelector('.pyr3-tooltip') as HTMLElement;
    expect(tip).toBeTruthy();
    // left-fallback → left ≤ section.left - tipWidth
    const leftPx = parseInt(tip.style.left, 10);
    expect(leftPx).toBeLessThan(100);

    vi.unstubAllGlobals();
  });

  it('clamps the popover within the viewport for a right-edge icon with no section (#343)', () => {
    // An icon hard against the right edge, NOT inside a .pyr3-section (the
    // render-mode-bar / top-bar case). Without a clamp the popover ran
    // off-screen — regression guard.
    vi.stubGlobal('innerWidth', 500);
    vi.stubGlobal('innerHeight', 400);

    const icon = buildInfoIcon({ title: 't', body: 'b' });
    icon.getBoundingClientRect = () => ({
      left: 480, right: 496, top: 20, bottom: 36,
      x: 480, y: 20, width: 16, height: 16, toJSON: () => ({}),
    } as DOMRect);
    document.body.appendChild(icon);

    icon.click();
    const tip = document.querySelector('.pyr3-tooltip') as HTMLElement;
    expect(tip).toBeTruthy();
    const leftPx = parseInt(tip.style.left, 10);
    // TOOLTIP_WIDTH 250 + 8px margins must fit inside the 500px viewport:
    // 8 ≤ left ≤ 500 − 250 − 8 (= 242).
    expect(leftPx).toBeGreaterThanOrEqual(8);
    expect(leftPx).toBeLessThanOrEqual(242);

    vi.unstubAllGlobals();
  });
});
