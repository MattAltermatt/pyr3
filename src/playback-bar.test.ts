// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountPlaybackBar } from './playback-bar';

describe('playback bar enable state', () => {
  let host: HTMLElement;
  beforeEach(() => { host = document.createElement('div'); });

  it('renders disabled controls when setEnabled(false)', () => {
    const bar = mountPlaybackBar(host, {
      tMin: 0, tMax: 10, initialT: 0, onScrub: () => {}, onPlayToggle: () => {},
    });
    bar.setEnabled(false);
    const play = host.querySelector<HTMLButtonElement>('.pyr3-playback-bar-play')!;
    expect(play.disabled).toBe(true);
    bar.setEnabled(true);
    expect(play.disabled).toBe(false);
    bar.destroy();
  });

  it('fires onStep, onJump, onSpeedChange from the controls', () => {
    const calls: string[] = [];
    const bar = mountPlaybackBar(host, {
      tMin: 0, tMax: 10, initialT: 0, onScrub: () => {}, onPlayToggle: () => {},
      onStep: (d) => calls.push(`step${d}`),
      onJump: (w) => calls.push(`jump:${w}`),
      onSpeedChange: (m) => calls.push(`speed:${m}`),
    });
    host.querySelector<HTMLButtonElement>('.pyr3-pb-step-fwd')!.click();
    host.querySelector<HTMLButtonElement>('.pyr3-pb-jump-end')!.click();
    const sel = host.querySelector<HTMLSelectElement>('.pyr3-pb-speed')!;
    sel.value = '2'; sel.dispatchEvent(new Event('change'));
    expect(calls).toEqual(['step1', 'jump:end', 'speed:2']);
    bar.destroy();
  });

  it('setDuration updates the readout denominator', () => {
    const bar = mountPlaybackBar(host, { tMin: 0, tMax: 10, initialT: 0, onScrub: () => {}, onPlayToggle: () => {} });
    bar.setDuration(30);
    bar.setTime(5);
    expect(host.querySelector('.pyr3-playback-bar-time')!.textContent).toContain('/ 30');
    bar.destroy();
  });
});
