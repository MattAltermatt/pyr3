// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mountPaletteGenerator } from './edit-palette-generator';
import { createEditState } from './edit-state';
import { generateRandomGenome } from './edit-seed';

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setup() {
  const state = createEditState(generateRandomGenome(seededRng(1)), 1);
  const paths: string[] = [];
  let refreshed = 0;
  const host = document.createElement('div');
  mountPaletteGenerator(host, state, (p: string) => paths.push(p), () => { refreshed++; });
  return { state, paths, host, getRefreshed: () => refreshed };
}

describe('mountPaletteGenerator (live + undo-able)', () => {
  it('mounts the controls but no Apply / Cancel buttons', () => {
    const { host } = setup();
    const btnText = [...host.querySelectorAll('.pyr3-btn')].map((b) => b.textContent ?? '');
    expect(btnText.some((t) => /apply/i.test(t))).toBe(false);
    expect(btnText.some((t) => /cancel/i.test(t))).toBe(false);
    // 🎲 reroll is the only button
    expect(btnText.some((t) => /🎲/.test(t))).toBe(true);
    // controls present: hue/chroma/lightness sliders + shades/reverse toggles
    expect(host.querySelectorAll('.pyr3-slider').length).toBeGreaterThanOrEqual(3);
    expect(host.querySelectorAll('.pyr3-toggle').length).toBeGreaterThanOrEqual(2);
  });

  it('opening (mount) does NOT commit a palette change on its own', () => {
    const { state, paths } = setup();
    expect(paths).not.toContain('palette');
    expect(state.genome.palette.name).not.toBe('generated');
  });

  it('a setting change commits a generated palette via onChange("palette") (undo-able)', () => {
    const { state, paths, host, getRefreshed } = setup();
    const before = state.genome.palette;
    const toggle = host.querySelector('.pyr3-toggle') as HTMLElement; // Shades mode
    toggle.click();
    expect(paths).toContain('palette');         // routes through the editor undo path
    expect(paths).not.toContain('palette-preview'); // no special no-history lane anymore
    expect(state.genome.palette).not.toBe(before);
    expect(state.genome.palette.name).toBe('generated');
    expect(getRefreshed()).toBeGreaterThan(0);  // host ribbon/chip/launcher refreshed
  });

  it('stamps generator provenance (palette.gen) on commit', () => {
    const { state, host } = setup();
    [...host.querySelectorAll('.pyr3-btn')].find((b) => /🎲/.test(b.textContent ?? ''))!.dispatchEvent(new Event('click'));
    const gen = state.genome.palette.gen;
    expect(gen).toBeDefined();
    expect(gen!.mode).toBe('rainbow');
    expect(typeof gen!.seed).toBe('number');
    expect(typeof gen!.hue).toBe('number');
  });

  it('re-mounting reads palette.gen so controls re-sync after undo/rebuild', () => {
    // Simulate the post-undo state: palette already carries shades-mode provenance.
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    state.genome.palette = {
      name: 'generated', stops: state.genome.palette.stops,
      gen: { mode: 'shades', hue: 220, chroma: 0.6, lightness: 0.65, lightFrom: 0.1, lightTo: 0.9, loops: 1, direction: 1, stops: 16, seed: 4242 },
    };
    const host = document.createElement('div');
    mountPaletteGenerator(host, state, () => {}, () => {});
    // Shades-mode controls (Dark end / Light end) appear → init came from palette.gen
    const labels = [...host.querySelectorAll('*')].map((e) => e.textContent ?? '');
    expect(labels.some((t) => /Dark end/.test(t))).toBe(true);
    expect(labels.some((t) => /Light end/.test(t))).toBe(true);
  });

  it('🎲 reroll commits an undo-able change', () => {
    const { paths, host } = setup();
    const dice = [...host.querySelectorAll('.pyr3-btn')].find((b) => /🎲/.test(b.textContent ?? '')) as HTMLElement;
    dice.click();
    expect(paths.filter((p) => p === 'palette').length).toBeGreaterThanOrEqual(1);
  });
});
