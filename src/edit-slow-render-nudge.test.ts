// @vitest-environment happy-dom
//
// #118 — slow-render nudge threshold logic. The component shows a toast
// when:
//   (1) user is actively editing (recordEdit was called recently)
//   (2) recent settle renders exceed the slow threshold (a pattern, not
//       a single outlier)
//   (3) current quality > QUALITY_THRESHOLD
//   (4) not in cooldown
// Inverse cases (each predicate broken individually) keep the toast
// hidden. Dismiss + Drop both enter cooldown; auto-hide does not.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSlowRenderNudge,
  SLOW_RENDER_NUDGE_THRESHOLDS,
} from './edit-slow-render-nudge';

const T = SLOW_RENDER_NUDGE_THRESHOLDS;

interface Setup {
  host: HTMLElement;
  setQuality: ReturnType<typeof vi.fn>;
  quality: { value: number };
  clock: { now: number };
  handle: ReturnType<typeof createSlowRenderNudge>;
}

function setup(initialQuality = 50): Setup {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const setQuality = vi.fn();
  const quality = { value: initialQuality };
  const clock = { now: 1_000_000 };
  const handle = createSlowRenderNudge({
    host,
    getQuality: () => quality.value,
    setQuality: (q) => {
      quality.value = q;
      setQuality(q);
    },
    now: () => clock.now,
  });
  return { host, setQuality, quality, clock, handle };
}

function toast(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.pyr3-slow-render-nudge');
}

function isVisible(host: HTMLElement): boolean {
  const t = toast(host);
  return !!t && (t as HTMLElement).style.display !== 'none';
}

function feedSlowRenders(s: Setup, count: number): void {
  for (let i = 0; i < count; i++) {
    s.handle.recordRender(T.SLOW_RENDER_MS + 100);
    s.clock.now += 50;
  }
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('#118 — slow-render nudge', () => {
  it('mounts a hidden toast on creation', () => {
    const s = setup();
    expect(toast(s.host)).toBeTruthy();
    expect(isVisible(s.host)).toBe(false);
  });

  it('does NOT show after a single slow render — needs a pattern', () => {
    const s = setup();
    s.handle.recordEdit();
    s.handle.recordRender(T.SLOW_RENDER_MS + 200);
    expect(isVisible(s.host)).toBe(false);
  });

  it('SHOWS after N consecutive slow renders during active editing', () => {
    const s = setup();
    s.handle.recordEdit();
    feedSlowRenders(s, T.SLOW_RENDER_COUNT);
    expect(isVisible(s.host)).toBe(true);
  });

  it('does NOT show when quality is at or below threshold', () => {
    const s = setup(T.QUALITY_THRESHOLD); // exactly the threshold → no nudge
    s.handle.recordEdit();
    feedSlowRenders(s, T.SLOW_RENDER_COUNT);
    expect(isVisible(s.host)).toBe(false);
  });

  it('does NOT show without a recent edit (e.g. pure pan/zoom)', () => {
    const s = setup();
    // No recordEdit() call — pan/zoom would skip it.
    feedSlowRenders(s, T.SLOW_RENDER_COUNT);
    expect(isVisible(s.host)).toBe(false);
  });

  it('does NOT show after the edit window expires', () => {
    const s = setup();
    s.handle.recordEdit();
    s.clock.now += T.EDIT_WINDOW_MS + 100;
    feedSlowRenders(s, T.SLOW_RENDER_COUNT);
    expect(isVisible(s.host)).toBe(false);
  });

  it('does NOT count renders below the slow threshold', () => {
    const s = setup();
    s.handle.recordEdit();
    for (let i = 0; i < T.SLOW_RENDER_COUNT + 2; i++) {
      s.handle.recordRender(T.SLOW_RENDER_MS - 50);
    }
    expect(isVisible(s.host)).toBe(false);
  });

  it('clears the slow-render history outside the window', () => {
    const s = setup();
    s.handle.recordEdit();
    s.handle.recordRender(T.SLOW_RENDER_MS + 100);
    // Advance past the slow-render window, then one more slow render.
    s.clock.now += T.SLOW_RENDER_WINDOW_MS + 100;
    s.handle.recordEdit();
    s.handle.recordRender(T.SLOW_RENDER_MS + 100);
    // Only 1 slow render in the recent window → still below threshold.
    expect(isVisible(s.host)).toBe(false);
  });

  it('[Drop to q=N] calls setQuality(DROP_TO_QUALITY) and hides the toast', () => {
    const s = setup();
    s.handle.recordEdit();
    feedSlowRenders(s, T.SLOW_RENDER_COUNT);
    expect(isVisible(s.host)).toBe(true);
    const dropBtn = toast(s.host)!.querySelectorAll('button')[0]!;
    dropBtn.click();
    expect(s.setQuality).toHaveBeenCalledWith(T.DROP_TO_QUALITY);
    expect(isVisible(s.host)).toBe(false);
  });

  it('[Dismiss] hides without changing quality and enters cooldown', () => {
    const s = setup();
    s.handle.recordEdit();
    feedSlowRenders(s, T.SLOW_RENDER_COUNT);
    expect(isVisible(s.host)).toBe(true);
    const dismissBtn = toast(s.host)!.querySelectorAll('button')[1]!;
    dismissBtn.click();
    expect(s.setQuality).not.toHaveBeenCalled();
    expect(isVisible(s.host)).toBe(false);
    // Re-trigger conditions during cooldown — should stay hidden.
    s.handle.recordEdit();
    feedSlowRenders(s, T.SLOW_RENDER_COUNT);
    expect(isVisible(s.host)).toBe(false);
  });

  it('re-surfaces after the cooldown expires', () => {
    const s = setup();
    s.handle.recordEdit();
    feedSlowRenders(s, T.SLOW_RENDER_COUNT);
    const dismissBtn = toast(s.host)!.querySelectorAll('button')[1]!;
    dismissBtn.click();
    // Advance past cooldown.
    s.clock.now += T.COOLDOWN_MS + 100;
    s.handle.recordEdit();
    feedSlowRenders(s, T.SLOW_RENDER_COUNT);
    expect(isVisible(s.host)).toBe(true);
  });

  it('destroy() removes the toast from the DOM', () => {
    const s = setup();
    expect(toast(s.host)).toBeTruthy();
    s.handle.destroy();
    expect(toast(s.host)).toBeFalsy();
  });
});
