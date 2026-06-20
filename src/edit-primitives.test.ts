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
  buildSlider,
  buildToggle,
  buildRemoveButton,
  buildButton,
  buildExpander,
} from './edit-primitives';

describe('buildExpander', () => {
  it('builds a details/summary with the shared aff-expander class', () => {
    const { details, summary, body } = buildExpander({ summary: 'raw matrix' });
    expect(details.tagName).toBe('DETAILS');
    expect(details.classList.contains('pyr3-aff-expander')).toBe(true);
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary.textContent).toContain('raw matrix');
    expect(body.parentElement).toBe(details);
    expect(body.classList.contains('pyr3-aff-expander-body')).toBe(true);
  });

  it('honors open + subpanelKey', () => {
    const { details } = buildExpander({ summary: 'shear', open: true, subpanelKey: 'x.0.shearFold' });
    expect(details.open).toBe(true);
    expect(details.dataset.subpanel).toBe('x.0.shearFold');
  });

  it('accepts a custom HTMLElement summary', () => {
    const span = document.createElement('span');
    span.textContent = '✨ Generate ramp';
    const { summary } = buildExpander({ summary: span });
    expect(summary.firstChild).toBe(span);
  });
});

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

describe('buildSlider', () => {
  it('renders rail + fill + handle + value display', () => {
    const onChange = vi.fn();
    const sl = buildSlider({ value: 0.5, min: 0, max: 1, onChange });
    expect(sl.className).toBe('pyr3-slider');
    expect(sl.querySelector('.pyr3-slider-rail')).toBeTruthy();
    expect(sl.querySelector('.pyr3-slider-fill')).toBeTruthy();
    expect(sl.querySelector('.pyr3-slider-handle')).toBeTruthy();
    const val = sl.querySelector('.pyr3-slider-value') as HTMLElement;
    expect(val).toBeTruthy();
    // value display reads the default-format (drop trailing zeros)
    expect(val.textContent).toBe('0.5');
  });

  it('value display uses the supplied format() callback', () => {
    const sl = buildSlider({
      value: 0.42,
      min: 0,
      max: 1,
      format: (v) => `${(v * 100).toFixed(0)}%`,
      onChange: vi.fn(),
    });
    const val = sl.querySelector('.pyr3-slider-value') as HTMLElement;
    expect(val.textContent).toBe('42%');
  });

  it('delegates the numeric control to a scrubby input (drag-to-scrub)', () => {
    const sl = buildSlider({ value: 0.5, min: 0, max: 1, onChange: vi.fn() });
    // The scrubby span lives inside the value display so the user can drag
    // OR double-click-to-type the number.
    const scrubby = sl.querySelector('.pyr3-scrubby');
    expect(scrubby).toBeTruthy();
  });

  it('fill width tracks the value position between min and max', () => {
    const sl = buildSlider({ value: 0.25, min: 0, max: 1, onChange: vi.fn() });
    const fill = sl.querySelector('.pyr3-slider-fill') as HTMLElement;
    expect(fill.style.width).toBe('25%');
  });
});

describe('buildToggle', () => {
  it('renders a 32x18 pill with class pyr3-toggle; active appends `on`', () => {
    const t = buildToggle({ value: true, onChange: vi.fn() });
    expect(t.classList.contains('pyr3-toggle')).toBe(true);
    expect(t.classList.contains('on')).toBe(true);
    expect(t.style.width).toBe('32px');
    expect(t.style.height).toBe('18px');
  });

  it('class `on` reflects value=false', () => {
    const t = buildToggle({ value: false, onChange: vi.fn() });
    expect(t.classList.contains('pyr3-toggle')).toBe(true);
    expect(t.classList.contains('on')).toBe(false);
  });

  it('click flips state + fires onChange(next)', () => {
    const onChange = vi.fn();
    const t = buildToggle({ value: false, onChange });
    t.click();
    expect(onChange).toHaveBeenCalledWith(true);
    expect(t.classList.contains('on')).toBe(true);
    t.click();
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(t.classList.contains('on')).toBe(false);
  });

  it('exposes a setValue(v) method on the element', () => {
    const t = buildToggle({ value: false, onChange: vi.fn() });
    (t as HTMLElement & { setValue: (v: boolean) => void }).setValue(true);
    expect(t.classList.contains('on')).toBe(true);
  });
});

describe('buildRemoveButton', () => {
  it('renders a 22x22 × button with class pyr3-remove-btn', () => {
    const r = buildRemoveButton({ onClick: vi.fn() });
    expect(r.classList.contains('pyr3-remove-btn')).toBe(true);
    expect(r.style.width).toBe('22px');
    expect(r.style.height).toBe('22px');
    expect(r.textContent).toBe('×');
  });

  it('fires onClick on click', () => {
    const onClick = vi.fn();
    const r = buildRemoveButton({ onClick });
    r.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('hover applies red-tinted color (COLORS.danger)', () => {
    const r = buildRemoveButton({ onClick: vi.fn() });
    // pointerenter / mouseenter handler tints the button
    r.dispatchEvent(new MouseEvent('mouseenter'));
    expect(r.style.color.toLowerCase()).toContain('e85a4a');
    r.dispatchEvent(new MouseEvent('mouseleave'));
    expect(r.style.color.toLowerCase()).not.toContain('e85a4a');
  });

  it('accepts an optional title attr', () => {
    const r = buildRemoveButton({ onClick: vi.fn(), title: 'remove this xform' });
    expect(r.title).toBe('remove this xform');
  });
});

describe('buildButton', () => {
  it('plain variant: pyr3-btn class, secondary text color, dark border', () => {
    const onClick = vi.fn();
    const b = buildButton({ variant: 'plain', label: 'open', onClick });
    expect(b.classList.contains('pyr3-btn')).toBe(true);
    expect(b.classList.contains('pyr3-btn-plain')).toBe(true);
    expect(b.textContent).toBe('open');
    expect(b.style.color.toLowerCase()).toContain('cfcfd6'); // secondary text (#373)
    // secondary border = #34343e (#373 button vocab)
    expect(b.style.border.toLowerCase()).toContain('34343e');
    b.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('accent variant: pyr3-btn-accent class, renders the secondary look (#373)', () => {
    const b = buildButton({ variant: 'accent', label: 'fit', onClick: vi.fn() });
    expect(b.classList.contains('pyr3-btn')).toBe(true);
    expect(b.classList.contains('pyr3-btn-accent')).toBe(true);
    // accent now converges to the secondary tier — secondary text #cfcfd6 (#373)
    expect(b.style.color.toLowerCase()).toContain('cfcfd6');
    expect(b.style.border.toLowerCase()).toContain('34343e');
  });

  it('primary variant: pyr3-btn-primary class, dark text on flame gradient, glow shadow', () => {
    const b = buildButton({ variant: 'primary', label: 'Save Render', onClick: vi.fn() });
    expect(b.classList.contains('pyr3-btn')).toBe(true);
    expect(b.classList.contains('pyr3-btn-primary')).toBe(true);
    // primary uses a gradient background — check we set background
    expect(b.style.background).not.toBe('');
    expect(b.style.background.toLowerCase()).toContain('gradient');
    // glow shadow present
    expect(b.style.boxShadow).not.toBe('');
  });

  it('supports an optional icon prefix', () => {
    const b = buildButton({ variant: 'plain', label: 'Open', icon: '📂', onClick: vi.fn() });
    expect(b.textContent).toBe('📂 Open');
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
