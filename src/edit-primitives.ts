// pyr3 — /v1/edit shared primitive builders (Phase 7 visual overhaul).
//
// All editor section bodies adopt these row-shaped primitives so layouts
// stay consistent across Render / Global / Viewport / Density / xforms /
// Final / Palette. The control column is the single 1fr cell carrying
// inputs, sliders, swatches, dropdowns, etc.
//
// CRITICAL: every editor numeric input MUST delegate to scrubbyInput()
// (#105). buildNumberInput is the canonical seam — sections must not
// instantiate plain <input type="text"> for numerics.

import { COLORS } from './ui-tokens';
import {
  scrubbyInput,
  type FieldKind,
  type ScrubbyHandle,
} from './edit-scrubby-input';

// ── Row ───────────────────────────────────────────────────────────────────
// [96px label | 1fr control] grid. The single canonical row shape.
export function buildRow(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'pyr3-row';
  row.style.display = 'grid';
  row.style.gridTemplateColumns = '96px 1fr';
  row.style.alignItems = 'center';
  row.style.gap = '12px';
  row.style.minHeight = '28px';

  const lbl = document.createElement('span');
  lbl.className = 'pyr3-lbl';
  lbl.textContent = label;
  lbl.style.color = COLORS.text.muted;
  lbl.style.fontSize = '12px';

  const ctrl = document.createElement('div');
  ctrl.className = 'pyr3-ctrl';
  ctrl.style.display = 'flex';
  ctrl.style.alignItems = 'center';
  ctrl.style.gap = '6px';
  ctrl.style.minWidth = '0';
  ctrl.appendChild(control);

  row.appendChild(lbl);
  row.appendChild(ctrl);
  return row;
}

// ── Number input (scrubby) ───────────────────────────────────────────────
// Delegates to scrubbyInput() — drag-to-scrub + dbl-click-to-type. The
// row-control width policy is applied here so callers don't need to know
// about the underlying scrubby chrome.
export interface NumberInputOpts {
  value: number;
  kind: FieldKind;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  onChange: (n: number) => void;
}

export interface NumberInputResult {
  el: HTMLElement;
  handle: ScrubbyHandle;
}

export function buildNumberInput(opts: NumberInputOpts): NumberInputResult {
  const fmt = opts.precision !== undefined
    ? (v: number): string => (Number.isFinite(v) ? v.toFixed(opts.precision!) : String(v))
    : undefined;
  const handle = scrubbyInput({
    value: opts.value,
    kind: opts.kind,
    min: opts.min,
    max: opts.max,
    minStep: opts.step,
    format: fmt,
    onInput: opts.onChange,
    className: 'pyr3-input',
  });
  // Row-control width policy. tabular-nums keeps wiggling digits from
  // jostling adjacent controls under the cursor.
  handle.el.style.flex = '1 1 0';
  handle.el.style.minWidth = '0';
  handle.el.style.textAlign = 'right';
  handle.el.style.fontVariantNumeric = 'tabular-nums';
  handle.el.style.background = COLORS.bg.input;
  handle.el.style.border = `1px solid ${COLORS.border}`;
  handle.el.style.borderRadius = '3px';
  handle.el.style.color = COLORS.text.primary;
  handle.el.style.padding = '3px 6px';
  handle.el.style.fontSize = '12px';
  return { el: handle.el, handle };
}

// ── Dropdown ──────────────────────────────────────────────────────────────
// Native <select> styled to fit the row's control column. The size dropdown
// in ui-bar.ts uses a custom popover (it lives outside grid rows); this
// primitive is the lighter row-fit shape.
export interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
}

export interface DropdownOpts<T extends string = string> {
  value: T;
  options: ReadonlyArray<DropdownOption<T>>;
  onChange: (next: T) => void;
}

export function buildDropdown<T extends string = string>(opts: DropdownOpts<T>): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'pyr3-dropdown';
  sel.style.flex = '1 1 0';
  sel.style.minWidth = '0';
  sel.style.background = COLORS.bg.input;
  sel.style.color = COLORS.text.primary;
  sel.style.border = `1px solid ${COLORS.border}`;
  sel.style.borderRadius = '3px';
  sel.style.padding = '3px 6px';
  sel.style.fontSize = '12px';
  for (const o of opts.options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = opts.value;
  sel.addEventListener('change', () => {
    opts.onChange(sel.value as T);
  });
  return sel;
}

// ── Color swatch ─────────────────────────────────────────────────────────
// Full-control-column color box used for the GLOBAL background-color row.
export interface ColorSwatchOpts {
  color: string;
  onClick: () => void;
}

export function buildColorSwatch(opts: ColorSwatchOpts): HTMLElement {
  const sw = document.createElement('div');
  sw.className = 'pyr3-color-swatch';
  sw.style.width = '100%';
  sw.style.minHeight = '22px';
  sw.style.background = opts.color;
  sw.style.border = `1px solid ${COLORS.border}`;
  sw.style.borderRadius = '3px';
  sw.style.cursor = 'pointer';
  sw.addEventListener('click', opts.onClick);
  return sw;
}

// ── Pair ──────────────────────────────────────────────────────────────────
// Sub-grid `1fr auto 1fr` for W×H, position x/y, etc. The separator is a
// plain span; callers pass any character ('×', ',', '/').
export function buildPair(left: HTMLElement, sep: string, right: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pyr3-pair';
  wrap.style.display = 'grid';
  wrap.style.gridTemplateColumns = '1fr auto 1fr';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '6px';
  wrap.style.width = '100%';
  wrap.style.minWidth = '0';

  const sepEl = document.createElement('span');
  sepEl.className = 'pyr3-pair-sep';
  sepEl.textContent = sep;
  sepEl.style.color = COLORS.text.dim;
  sepEl.style.fontSize = '12px';

  wrap.appendChild(left);
  wrap.appendChild(sepEl);
  wrap.appendChild(right);
  return wrap;
}
