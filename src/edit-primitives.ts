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

// ── Slider with always-visible value display ─────────────────────────────
// Visual rail + fill + handle on the left, scrubby numeric value display
// on the right. The numeric is a scrubbyInput so drag-to-scrub works on
// the number itself; the rail is the visual chrome that tracks position.
// (Click-on-rail-to-set is intentionally not wired here — the scrubby
// handles all the input semantics. The rail is read-only chrome.)
export interface SliderOpts {
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

export function buildSlider(opts: SliderOpts): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pyr3-slider';
  wrap.style.display = 'grid';
  wrap.style.gridTemplateColumns = '1fr auto';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '8px';
  wrap.style.minWidth = '0';

  // Visual rail (left)
  const rail = document.createElement('div');
  rail.className = 'pyr3-slider-rail';
  rail.style.position = 'relative';
  rail.style.height = '4px';
  rail.style.background = COLORS.bg.input;
  rail.style.border = `1px solid ${COLORS.border}`;
  rail.style.borderRadius = '2px';
  rail.style.minWidth = '0';

  const fill = document.createElement('div');
  fill.className = 'pyr3-slider-fill';
  fill.style.position = 'absolute';
  fill.style.left = '0';
  fill.style.top = '0';
  fill.style.height = '100%';
  fill.style.background = COLORS.flame.mid;
  fill.style.borderRadius = '2px';

  const handle = document.createElement('div');
  handle.className = 'pyr3-slider-handle';
  handle.style.position = 'absolute';
  handle.style.top = '50%';
  handle.style.width = '10px';
  handle.style.height = '10px';
  handle.style.background = COLORS.flame.top;
  handle.style.border = `1px solid ${COLORS.flame.bot}`;
  handle.style.borderRadius = '50%';
  handle.style.transform = 'translate(-50%, -50%)';
  handle.style.pointerEvents = 'none';

  rail.appendChild(fill);
  rail.appendChild(handle);

  // Numeric value display (right) — uses scrubby for drag + dbl-click typing
  const value = document.createElement('div');
  value.className = 'pyr3-slider-value';
  value.style.minWidth = '52px';
  value.style.textAlign = 'right';
  value.style.color = COLORS.text.primary;
  value.style.fontSize = '12px';
  value.style.fontVariantNumeric = 'tabular-nums';

  // Position-update helper closes over rail/fill/handle.
  const updateVisual = (v: number): void => {
    const range = opts.max - opts.min;
    const t = range > 0 ? (v - opts.min) / range : 0;
    const pct = Math.max(0, Math.min(1, t)) * 100;
    fill.style.width = `${pct}%`;
    handle.style.left = `${pct}%`;
  };
  updateVisual(opts.value);

  const fmt = opts.format ?? defaultSliderFormat;
  const scrubby = scrubbyInput({
    value: opts.value,
    kind: 'generic',
    min: opts.min,
    max: opts.max,
    minStep: opts.step,
    format: fmt,
    onInput: (v) => {
      updateVisual(v);
      opts.onChange(v);
    },
    className: 'pyr3-slider-scrubby',
  });
  // The scrubby span IS the displayed value — let it carry the visual.
  scrubby.el.style.fontSize = '12px';
  scrubby.el.style.color = COLORS.text.primary;
  scrubby.el.style.fontVariantNumeric = 'tabular-nums';
  value.appendChild(scrubby.el);

  wrap.appendChild(rail);
  wrap.appendChild(value);
  return wrap;
}

function defaultSliderFormat(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const s = v.toFixed(3);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

// ── Toggle pill ───────────────────────────────────────────────────────────
// 32×18 pill switch. Class `pyr3-toggle` (with `on` appended when active).
// Click flips the state, fires onChange(next), and re-renders the dot.
export interface ToggleOpts {
  value: boolean;
  onChange: (next: boolean) => void;
}

export interface ToggleHandle extends HTMLElement {
  setValue(v: boolean): void;
}

export function buildToggle(opts: ToggleOpts): ToggleHandle {
  const el = document.createElement('div') as unknown as ToggleHandle;
  let value = opts.value;

  function paint(): void {
    el.className = value ? 'pyr3-toggle on' : 'pyr3-toggle';
    el.style.background = value ? COLORS.flame.mid : COLORS.bg.input;
    el.style.borderColor = value ? COLORS.flame.bot : COLORS.border;
    // dot position
    dot.style.left = value ? '16px' : '2px';
    dot.style.background = value ? COLORS.flame.top : COLORS.text.dim;
  }

  el.style.width = '32px';
  el.style.height = '18px';
  el.style.borderRadius = '10px';
  el.style.border = `1px solid ${COLORS.border}`;
  el.style.position = 'relative';
  el.style.cursor = 'pointer';
  el.style.flex = '0 0 auto';

  const dot = document.createElement('div');
  dot.className = 'pyr3-toggle-dot';
  dot.style.position = 'absolute';
  dot.style.top = '2px';
  dot.style.width = '12px';
  dot.style.height = '12px';
  dot.style.borderRadius = '50%';
  dot.style.transition = 'left 80ms ease, background 80ms ease';
  el.appendChild(dot);

  el.addEventListener('click', () => {
    value = !value;
    paint();
    opts.onChange(value);
  });

  el.setValue = (v: boolean): void => {
    value = v;
    paint();
  };

  paint();
  return el;
}

// ── Remove × button ──────────────────────────────────────────────────────
// 22×22 square `×` button. Transparent at rest; red-tinted on hover.
export interface RemoveButtonOpts {
  onClick: () => void;
  title?: string;
}

export function buildRemoveButton(opts: RemoveButtonOpts): HTMLElement {
  const btn = document.createElement('div');
  btn.className = 'pyr3-remove-btn';
  btn.textContent = '×';
  btn.style.width = '22px';
  btn.style.height = '22px';
  btn.style.display = 'flex';
  btn.style.alignItems = 'center';
  btn.style.justifyContent = 'center';
  btn.style.background = 'transparent';
  btn.style.border = `1px solid ${COLORS.border}`;
  btn.style.borderRadius = '3px';
  btn.style.cursor = 'pointer';
  btn.style.color = COLORS.text.muted;
  btn.style.fontSize = '16px';
  btn.style.lineHeight = '1';
  btn.style.flex = '0 0 auto';
  btn.style.userSelect = 'none';
  if (opts.title) btn.title = opts.title;

  const restColor = COLORS.text.muted;
  btn.addEventListener('mouseenter', () => {
    btn.style.color = COLORS.danger;
    btn.style.borderColor = COLORS.danger;
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.color = restColor;
    btn.style.borderColor = COLORS.border;
  });
  btn.addEventListener('click', opts.onClick);
  return btn;
}

// ── Button tiers ──────────────────────────────────────────────────────────
// Three visual variants for the editor's action surface:
//   plain    — dark gradient bg, dark border, normal text (default neutral)
//   accent   — warm-tint gradient, warm border, amber text (named action)
//   primary  — filled flame gradient, dark text, glow shadow (popped CTA)
//
// Hover lift logic: plain → border to flame.top; accent → border to flame.top;
// primary keeps its bright fill but brightens the glow.
export type ButtonVariant = 'plain' | 'accent' | 'primary';

export interface ButtonOpts {
  variant: ButtonVariant;
  label: string;
  onClick: () => void;
  icon?: string;
}

export function buildButton(opts: ButtonOpts): HTMLElement {
  const btn = document.createElement('div');
  btn.className = `pyr3-btn pyr3-btn-${opts.variant}`;
  btn.textContent = opts.icon ? `${opts.icon} ${opts.label}` : opts.label;
  btn.style.display = 'inline-flex';
  btn.style.alignItems = 'center';
  btn.style.justifyContent = 'center';
  btn.style.gap = '6px';
  btn.style.padding = '5px 10px';
  btn.style.borderRadius = '4px';
  btn.style.cursor = 'pointer';
  btn.style.fontSize = '12px';
  btn.style.lineHeight = '1.2';
  btn.style.userSelect = 'none';
  btn.style.flex = '0 0 auto';

  switch (opts.variant) {
    case 'plain': {
      btn.style.background = `linear-gradient(180deg, ${COLORS.bg.panel}, ${COLORS.bg.bar})`;
      btn.style.border = `1px solid ${COLORS.border}`;
      btn.style.color = COLORS.text.primary;
      const rest = COLORS.border;
      btn.addEventListener('mouseenter', () => { btn.style.borderColor = COLORS.flame.top; });
      btn.addEventListener('mouseleave', () => { btn.style.borderColor = rest; });
      break;
    }
    case 'accent': {
      // Warm tint: a darkened blend toward flame.bot for the bg.
      btn.style.background = `linear-gradient(180deg, ${COLORS.bg.action}, ${COLORS.bg.bar})`;
      btn.style.border = `1px solid ${COLORS.flame.bot}`;
      btn.style.color = COLORS.flame.top;
      const rest = COLORS.flame.bot;
      btn.addEventListener('mouseenter', () => { btn.style.borderColor = COLORS.flame.top; });
      btn.addEventListener('mouseleave', () => { btn.style.borderColor = rest; });
      break;
    }
    case 'primary': {
      btn.style.background = `linear-gradient(180deg, ${COLORS.flame.top}, ${COLORS.flame.mid} 60%, ${COLORS.flame.bot})`;
      btn.style.border = `1px solid ${COLORS.flame.bot}`;
      btn.style.color = COLORS.bg.page;
      btn.style.fontWeight = '600';
      btn.style.boxShadow = `0 0 12px ${COLORS.flame.mid}66, 0 1px 0 ${COLORS.flame.top}99 inset`;
      btn.addEventListener('mouseenter', () => {
        btn.style.boxShadow = `0 0 18px ${COLORS.flame.top}aa, 0 1px 0 ${COLORS.flame.top} inset`;
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.boxShadow = `0 0 12px ${COLORS.flame.mid}66, 0 1px 0 ${COLORS.flame.top}99 inset`;
      });
      break;
    }
  }

  btn.addEventListener('click', opts.onClick);
  return btn;
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
