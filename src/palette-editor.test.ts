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

  it('#384: Backspace from a focused text input does NOT delete the selected stop', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountPaletteEditor(host, { initial: { name: 'x', stops: [
      { t: 0, r: 0, g: 0, b: 0 }, { t: 0.5, r: 0.5, g: 0.5, b: 0.5 }, { t: 1, r: 1, g: 1, b: 1 },
    ] }, onChange: () => {} });
    const strip = host.querySelector('[data-role="strip"]') as HTMLElement;
    mockRect(strip);
    // select the middle (interior) stop — the deletable precondition
    strip.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 12, bubbles: true }));
    // a Backspace whose target is a text input (e.g. the hex field) must be ignored
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(h.getPalette().stops.length).toBe(3); // stop NOT deleted
    input.remove();
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

  it('#473: a persistent delete hint is always visible (discoverability)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountPaletteEditor(host, { initial: { name: 'x', stops: [
      { t: 0, r: 0, g: 0, b: 0 }, { t: 0.5, r: 0.5, g: 0.5, b: 0.5 }, { t: 1, r: 1, g: 1, b: 1 },
    ] }, onChange: () => {} });
    const hint = host.querySelector('[data-role="delete-hint"]') as HTMLElement;
    expect(hint).toBeTruthy(); // present even when nothing is selected
    expect(hint.textContent).toMatch(/middle stop/i);
    h.destroy();
  });

  it('#473: disabled delete button reads as present-but-disabled (opacity 0.6, not 0.4)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountPaletteEditor(host, { initial: { name: 'x', stops: [
      { t: 0, r: 0, g: 0, b: 0 }, { t: 0.5, r: 0.5, g: 0.5, b: 0.5 }, { t: 1, r: 1, g: 1, b: 1 },
    ] }, onChange: () => {} });
    const strip = host.querySelector('[data-role="strip"]') as HTMLElement;
    mockRect(strip);
    const del = host.querySelector('[data-role="delete-stop"]') as HTMLElement;
    expect(del.style.opacity).toBe('0.6'); // nothing selected → dimmed but legible
    strip.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 12, bubbles: true }));
    expect(del.style.opacity).toBe('1'); // interior stop selected → fully enabled
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

describe('palette-editor split DOM + onSelect (#372)', () => {
  it('controlsHost relocates the controls region out of the bar root', () => {
    const bar = document.createElement('div');
    const panel = document.createElement('div');
    document.body.append(bar, panel);
    const h = mountPaletteEditor(bar, { initial: PYRE_PALETTE, onChange: () => {}, controlsHost: panel });
    expect(bar.querySelector('[data-role="controls"]')).toBeNull();
    expect(panel.querySelector('[data-role="controls"]')).not.toBeNull();
    // bar still owns the strip + handles
    expect(bar.querySelector('[data-role="strip"]')).not.toBeNull();
    h.destroy();
  });

  it('destroy removes the relocated controls region (no leak across re-mounts)', () => {
    const bar = document.createElement('div');
    const panel = document.createElement('div');
    document.body.append(bar, panel);
    // mount → destroy twice; the controls region must not accumulate in the panel
    for (let i = 0; i < 2; i++) {
      const h = mountPaletteEditor(bar, { initial: PYRE_PALETTE, onChange: () => {}, controlsHost: panel });
      h.destroy();
    }
    expect(panel.querySelectorAll('[data-role="controls"]').length).toBe(0);
    // and a fresh mount yields exactly one controls region (not zero, not two)
    const h = mountPaletteEditor(bar, { initial: PYRE_PALETTE, onChange: () => {}, controlsHost: panel });
    expect(panel.querySelectorAll('[data-role="controls"]').length).toBe(1);
    h.destroy();
  });

  it('controls default to the bar root when no controlsHost is given', () => {
    const bar = document.createElement('div');
    document.body.append(bar);
    const h = mountPaletteEditor(bar, { initial: PYRE_PALETTE, onChange: () => {} });
    expect(bar.querySelector('[data-role="controls"]')).not.toBeNull();
    h.destroy();
  });

  it('onSelect fires with the selected stop index on selectStop', () => {
    const bar = document.createElement('div');
    document.body.append(bar);
    let last: number | null = null;
    const h = mountPaletteEditor(bar, {
      initial: { name: 'x', stops: [
        { t: 0, r: 0, g: 0, b: 0 }, { t: 0.5, r: 1, g: 0, b: 0 }, { t: 1, r: 1, g: 1, b: 1 },
      ] },
      onChange: () => {},
      onSelect: (idx) => { last = idx; },
    });
    h.selectStop(1);
    expect(last).toBe(1);
    h.destroy();
  });

  it('showHint mounts a bar-hint overlay and is a no-op-safe clear (point-to-paint spotlight)', () => {
    const bar = document.createElement('div');
    document.body.append(bar);
    const h = mountPaletteEditor(bar, { initial: PYRE_PALETTE, onChange: () => {} });
    // the spotlight overlay lives on the strip, under the handles
    const hintOverlay = bar.querySelector('[data-role="bar-hint-overlay"]');
    expect(hintOverlay).not.toBeNull();
    // a histogram + a null clear both run without throwing
    const hist = new Float32Array(64).fill(0);
    hist[10] = 1; hist[11] = 0.5;
    expect(() => h.showHint(hist)).not.toThrow();
    expect(() => h.showHint(null)).not.toThrow();
    h.destroy();
  });

  it('onHoverT reports the CONTINUOUS cursor position on strip mousemove (whole bar live)', () => {
    const bar = document.createElement('div');
    document.body.append(bar);
    const seen: (number | null)[] = [];
    const h = mountPaletteEditor(bar, { initial: { name: 'x', stops: [
      { t: 0, r: 0, g: 0, b: 0 }, { t: 1, r: 1, g: 1, b: 1 },
    ] }, onChange: () => {}, onHoverT: (t) => { seen.push(t); } });
    const strip = bar.querySelector('[data-role="strip"]') as HTMLElement;
    mockRect(strip, 200);
    // mid-bar (x=130/200) maps to t≈0.65 — NOT snapped to a stop at 0 or 1
    strip.dispatchEvent(new MouseEvent('mousemove', { clientX: 130, clientY: 0, bubbles: true }));
    expect(seen[seen.length - 1]).toBeCloseTo(0.65, 2);
    // left edge → t≈0
    strip.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0, bubbles: true }));
    expect(seen[seen.length - 1]).toBeCloseTo(0, 5);
    strip.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(seen[seen.length - 1]).toBeNull(); // leaving clears
    h.destroy();
  });
});
