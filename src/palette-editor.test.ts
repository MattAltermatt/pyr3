// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { mountPaletteEditor } from './palette-editor';
import { PYRE_PALETTE } from './palette';

function mockRect(el: HTMLElement, width = 200): void {
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width, height: 24, right: width, bottom: 24, x: 0, y: 0, toJSON() {} }) as DOMRect;
}

describe('palette-editor core (#115)', () => {
  it('mounts a strip and one handle per stop', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountPaletteEditor(host, { initial: PYRE_PALETTE, onChange: () => {} });
    expect(host.querySelector('[data-role="strip"]')).toBeTruthy();
    expect(host.querySelectorAll('[data-role="handle"]').length).toBe(PYRE_PALETTE.stops.length);
    h.destroy();
  });

  it('selectStop(idx) highlights the stop at that index (#269 Phase 2)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountPaletteEditor(host, { initial: { name: 'x', stops: [
      { t: 0, r: 0, g: 0, b: 0 }, { t: 0.5, r: 1, g: 0, b: 0 }, { t: 1, r: 1, g: 1, b: 1 },
    ] }, onChange: () => {} });
    h.selectStop(1);
    const handles = host.querySelectorAll('[data-role="handle"]');
    expect((handles[1] as HTMLElement).dataset['selected']).toBe('true');
    expect((handles[0] as HTMLElement).dataset['selected']).toBeUndefined();
    // out-of-range is a no-op (no throw, no selection change)
    h.selectStop(99);
    expect((host.querySelectorAll('[data-role="handle"]')[1] as HTMLElement).dataset['selected']).toBe('true');
    h.destroy();
  });

  it('setPalette swaps the working palette and re-renders handles', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountPaletteEditor(host, { initial: PYRE_PALETTE, onChange: () => {} });
    h.setPalette({ name: 'x', stops: [
      { t: 0, r: 0, g: 0, b: 0 }, { t: 1, r: 1, g: 1, b: 1 },
    ] });
    expect(host.querySelectorAll('[data-role="handle"]').length).toBe(2);
    expect(h.getPalette().stops.length).toBe(2);
    h.destroy();
  });

  it('emits onChange with a new stop when an empty strip area is double-clicked', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onChange = vi.fn();
    const h = mountPaletteEditor(host, { initial: { name: 'x', stops: [
      { t: 0, r: 0, g: 0, b: 0 }, { t: 1, r: 1, g: 1, b: 1 },
    ] }, onChange });
    const strip = host.querySelector('[data-role="strip"]') as HTMLElement;
    mockRect(strip);
    strip.dispatchEvent(new MouseEvent('dblclick', { clientX: 100, clientY: 12, bubbles: true }));
    expect(onChange).toHaveBeenCalled();
    expect(h.getPalette().stops.length).toBe(3);
    h.destroy();
  });

  it('deletes the selected interior stop on Delete (min 2 enforced)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onChange = vi.fn();
    const h = mountPaletteEditor(host, { initial: { name: 'x', stops: [
      { t: 0, r: 0, g: 0, b: 0 }, { t: 0.5, r: 0.5, g: 0.5, b: 0.5 }, { t: 1, r: 1, g: 1, b: 1 },
    ] }, onChange });
    const strip = host.querySelector('[data-role="strip"]') as HTMLElement;
    mockRect(strip);
    // select the middle stop (t=0.5 → clientX=100 of width 200)
    strip.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 12, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(h.getPalette().stops.length).toBe(2);
    h.destroy();
  });

  it('marks the selected handle with data-selected for a clear visual cue', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountPaletteEditor(host, { initial: { name: 'x', stops: [
      { t: 0, r: 0, g: 0, b: 0 }, { t: 0.5, r: 0.5, g: 0.5, b: 0.5 }, { t: 1, r: 1, g: 1, b: 1 },
    ] }, onChange: () => {} });
    const strip = host.querySelector('[data-role="strip"]') as HTMLElement;
    mockRect(strip);
    expect(host.querySelector('[data-role="handle"][data-selected="true"]')).toBeNull();
    strip.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 12, bubbles: true }));
    const sel = host.querySelectorAll('[data-role="handle"][data-selected="true"]');
    expect(sel.length).toBe(1);
    expect((sel[0] as HTMLElement).dataset['idx']).toBe('1'); // middle stop
    h.destroy();
  });

  it('the delete-stop button removes the selected interior stop', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountPaletteEditor(host, { initial: { name: 'x', stops: [
      { t: 0, r: 0, g: 0, b: 0 }, { t: 0.5, r: 0.5, g: 0.5, b: 0.5 }, { t: 1, r: 1, g: 1, b: 1 },
    ] }, onChange: () => {} });
    const strip = host.querySelector('[data-role="strip"]') as HTMLElement;
    mockRect(strip);
    const del = host.querySelector('[data-role="delete-stop"]') as HTMLElement;
    expect(del).toBeTruthy();
    expect(del.style.pointerEvents).toBe('none'); // nothing selected → disabled
    strip.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 12, bubbles: true })); // select middle
    expect(del.style.pointerEvents).toBe('auto'); // now enabled
    del.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(h.getPalette().stops.length).toBe(2);
    h.destroy();
  });
});

describe('palette-editor color-pick + interp (#115 T7)', () => {
  it('opens the color picker on handle click and applies a color change', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onChange = vi.fn();
    const h = mountPaletteEditor(host, { initial: { name: 'x', stops: [
      { t: 0, r: 0, g: 0, b: 0 }, { t: 1, r: 1, g: 1, b: 1 },
    ] }, onChange });
    (host.querySelectorAll('[data-role="handle"]')[0] as HTMLElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const hex = document.querySelector('input[data-role="hex"]') as HTMLInputElement;
    expect(hex).toBeTruthy();
    hex.value = '#3366ff';
    hex.dispatchEvent(new Event('change'));
    expect(h.getPalette().stops[0]!.b).toBeCloseTo(1, 1);
    h.destroy();
  });

  it('interp dropdown writes palette.mode', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountPaletteEditor(host, { initial: PYRE_PALETTE, onChange: () => {} });
    const sel = host.querySelector('select[data-role="interp"]') as HTMLSelectElement;
    sel.value = 'smooth';
    sel.dispatchEvent(new Event('change'));
    expect(h.getPalette().mode).toBe('smooth');
    h.destroy();
  });
});

describe('palette-editor transforms + resample (#115 T8)', () => {
  it('reverse button flips the gradient', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountPaletteEditor(host, { initial: { name: 'x', stops: [
      { t: 0, r: 0, g: 0, b: 0 }, { t: 1, r: 1, g: 1, b: 1 },
    ] }, onChange: () => {} });
    (host.querySelector('[data-role="reverse"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(h.getPalette().stops[0]!.r).toBeCloseTo(1, 5);
    h.destroy();
  });

  it('resample to N replaces the stop set', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountPaletteEditor(host, { initial: PYRE_PALETTE, onChange: () => {} });
    (host.querySelector('[data-role="resample-n"]') as HTMLInputElement).value = '8';
    (host.querySelector('[data-role="resample"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(h.getPalette().stops.length).toBe(8);
    h.destroy();
  });
});
