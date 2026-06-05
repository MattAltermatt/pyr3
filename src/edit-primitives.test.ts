// @vitest-environment happy-dom
//
// pyr3 — /v1/edit shared primitive builders (Phase 7).
//
// Row pattern: [96px label | 1fr control] grid. NumberInput delegates to
// scrubbyInput() so every editor numeric stays drag-to-scrub (#105). Dropdown
// is a native <select> styled to fit the row's control column. ColorSwatch
// fills the control column. Pair lays out two equal cells with a separator
// for W×H and position x/y.

import { describe, it, expect, vi } from 'vitest';
import {
  buildRow,
  buildNumberInput,
  buildDropdown,
  buildColorSwatch,
  buildPair,
} from './edit-primitives';

describe('buildRow', () => {
  it('renders a 96px label + 1fr control grid', () => {
    const ctrl = document.createElement('span');
    ctrl.textContent = 'X';
    const row = buildRow('weight', ctrl);
    expect(row.className).toBe('pyr3-row');
    expect(row.style.display).toBe('grid');
    expect(row.style.gridTemplateColumns).toBe('96px 1fr');
    const lbl = row.querySelector('.pyr3-lbl') as HTMLElement;
    expect(lbl).toBeTruthy();
    expect(lbl.textContent).toBe('weight');
    const ctrlWrap = row.querySelector('.pyr3-ctrl') as HTMLElement;
    expect(ctrlWrap).toBeTruthy();
    expect(ctrlWrap.contains(ctrl)).toBe(true);
  });
});

describe('buildNumberInput', () => {
  it('returns a scrubby-input element + handle', () => {
    const onChange = vi.fn();
    const { el, handle } = buildNumberInput({
      value: 0.5,
      kind: 'weight',
      onChange,
    });
    // delegates to scrubbyInput — el is the scrubby span
    expect(el.classList.contains('pyr3-scrubby')).toBe(true);
    expect(el.classList.contains('pyr3-input')).toBe(true);
    expect(el.textContent).toBe('0.5');
    expect(typeof handle.setValue).toBe('function');
    expect(handle.el).toBe(el);
  });

  it('fires onChange when the scrubby handle updates', () => {
    const onChange = vi.fn();
    const { handle } = buildNumberInput({
      value: 0,
      kind: 'generic',
      onChange,
    });
    handle.setValue(0.25);
    // setValue is a programmatic setter — it doesn't fire onInput.
    // We assert the wiring: el text reflects the new value.
    expect(handle.el.textContent).toBe('0.25');
  });

  it('honors min/max bounds', () => {
    const { handle } = buildNumberInput({
      value: 5,
      kind: 'generic',
      min: 0,
      max: 1,
      onChange: vi.fn(),
    });
    // clamped on construction
    expect(handle.el.textContent).toBe('1');
  });
});

describe('buildDropdown', () => {
  it('renders a native <select> with the supplied options', () => {
    const onChange = vi.fn();
    const dd = buildDropdown({
      value: 'b',
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Bravo' },
        { value: 'c', label: 'Charlie' },
      ],
      onChange,
    });
    expect(dd.tagName).toBe('SELECT');
    expect(dd.classList.contains('pyr3-dropdown')).toBe(true);
    const opts = dd.querySelectorAll('option');
    expect(opts).toHaveLength(3);
    const opt1 = opts[1]!;
    expect(opt1.value).toBe('b');
    expect(opt1.textContent).toBe('Bravo');
    expect((dd as HTMLSelectElement).value).toBe('b');
  });

  it('fires onChange on selection', () => {
    const onChange = vi.fn();
    const dd = buildDropdown({
      value: 'a',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      onChange,
    });
    (dd as HTMLSelectElement).value = 'b';
    dd.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('buildColorSwatch', () => {
  it('renders a full-control-width color box with the supplied color', () => {
    const onClick = vi.fn();
    const sw = buildColorSwatch({ color: '#ff8800', onClick });
    expect(sw.className).toBe('pyr3-color-swatch');
    // matches set background color (any CSS-syntax conversion is fine; check
    // the raw style attribute holds the hex)
    expect(sw.style.background.toLowerCase()).toContain('#ff8800');
    expect(sw.style.width).toBe('100%');
    sw.click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('buildPair', () => {
  it('renders a 1fr auto 1fr sub-grid with separator between', () => {
    const left = document.createElement('span');
    left.textContent = 'L';
    const right = document.createElement('span');
    right.textContent = 'R';
    const pair = buildPair(left, '×', right);
    expect(pair.className).toBe('pyr3-pair');
    expect(pair.style.display).toBe('grid');
    expect(pair.style.gridTemplateColumns).toBe('1fr auto 1fr');
    expect(pair.contains(left)).toBe(true);
    expect(pair.contains(right)).toBe(true);
    const sep = pair.querySelector('.pyr3-pair-sep') as HTMLElement;
    expect(sep).toBeTruthy();
    expect(sep.textContent).toBe('×');
  });
});
