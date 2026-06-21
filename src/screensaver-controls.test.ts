// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createControlBar } from './screensaver-controls';

const noop = (): void => {};
const base = { onPlayPause: noop, onFullscreen: noop, onExit: noop };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('control bar', () => {
  it('reveals, then auto-hides after idleMs', () => {
    const bar = createControlBar({ transport: 'slideshow', idleMs: 3000, ...base });
    expect(bar.isVisible()).toBe(false);
    bar.reveal();
    expect(bar.isVisible()).toBe(true);
    vi.advanceTimersByTime(2999);
    expect(bar.isVisible()).toBe(true);
    vi.advanceTimersByTime(2);
    expect(bar.isVisible()).toBe(false);
    bar.destroy();
  });

  it('does not auto-hide while the pointer hovers the bar; re-arms on leave', () => {
    const bar = createControlBar({ transport: 'slideshow', idleMs: 1000, ...base });
    bar.reveal();
    bar.el.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(2000);
    expect(bar.isVisible()).toBe(true); // hover holds it open past idleMs
    bar.el.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(1001);
    expect(bar.isVisible()).toBe(false); // leave re-arms the countdown
    bar.destroy();
  });

  it('reveal() restarts the idle countdown', () => {
    const bar = createControlBar({ transport: 'slideshow', idleMs: 1000, ...base });
    bar.reveal();
    vi.advanceTimersByTime(900);
    bar.reveal(); // re-arm
    vi.advanceTimersByTime(900);
    expect(bar.isVisible()).toBe(true); // would have hidden at 1000 without re-arm
    vi.advanceTimersByTime(200);
    expect(bar.isVisible()).toBe(false);
    bar.destroy();
  });

  it('slideshow transport shows prev/next, no restart/progress', () => {
    const bar = createControlBar({ transport: 'slideshow', ...base, onPrev: noop, onNext: noop });
    expect(bar.el.querySelector('[data-act="prev"]')).not.toBeNull();
    expect(bar.el.querySelector('[data-act="next"]')).not.toBeNull();
    expect(bar.el.querySelector('[data-act="settings"]')).toBeNull();
    expect(bar.el.querySelector('.pyr3-screensaver-ctrl-prog')).toBeNull();
  });

  it('animation transport: prev/next (frame step) + progress bar, no restart/settings', () => {
    const bar = createControlBar({ transport: 'animation', ...base, onPrev: noop, onNext: noop });
    expect(bar.el.querySelector('[data-act="prev"]')).not.toBeNull();
    expect(bar.el.querySelector('[data-act="next"]')).not.toBeNull();
    expect(bar.el.querySelector('[data-act="restart"]')).toBeNull();
    expect(bar.el.querySelector('[data-act="settings"]')).toBeNull();
    expect(bar.el.querySelector('.pyr3-screensaver-ctrl-prog')).not.toBeNull();
  });

  it('hides the name block when name + meta are empty (nameless timeline)', () => {
    const bar = createControlBar({ transport: 'animation', ...base, onPrev: noop, onNext: noop });
    bar.setFlameName('', '');
    expect((bar.el.querySelector('.pyr3-screensaver-ctrl-name') as HTMLElement).style.display).toBe('none');
    bar.setFlameName('my.timeline.json', '🎞️ animation');
    expect((bar.el.querySelector('.pyr3-screensaver-ctrl-name') as HTMLElement).style.display).toBe('flex');
  });

  it('setPaused swaps the glyph; setFlameName fills both lines', () => {
    const bar = createControlBar({ transport: 'slideshow', ...base });
    const play = bar.el.querySelector('[data-act="play"]')!;
    expect(play.textContent).toBe('⏸');
    bar.setPaused(true);
    expect(play.textContent).toBe('▶');
    bar.setFlameName('electricsheep 248.23554', 'gen 248 · id 23554');
    expect(bar.el.textContent).toContain('248.23554');
    bar.destroy();
  });

  it('a click on play fires onPlayPause', () => {
    const onPlayPause = vi.fn();
    const bar = createControlBar({ transport: 'slideshow', ...base, onPlayPause });
    (bar.el.querySelector('[data-act="play"]') as HTMLButtonElement).click();
    expect(onPlayPause).toHaveBeenCalledOnce();
    bar.destroy();
  });
});
