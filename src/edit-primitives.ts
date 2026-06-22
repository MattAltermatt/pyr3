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
  // Border is owned by the `.pyr3-edit-num` class (1px sides + a 2px accent
  // bottom-rule = the #373 drag-to-edit hint + focus brighten). Setting an
  // inline `border` here would beat the class and suppress the accent underline
  // on every buildNumberInput field (colorSpeed, xaos, vibrancy, DE params…) —
  // so we deliberately do NOT set border inline. (#373)
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

/** The element buildSlider returns — an HTMLElement with a programmatic
 *  `setValue` (updates the displayed value/fill without firing onChange). */
export interface SliderControl extends HTMLElement {
  setValue(v: number): void;
}

export function buildSlider(opts: SliderOpts): SliderControl {
  const wrap = document.createElement('div');
  wrap.className = 'pyr3-slider';
  wrap.style.display = 'grid';
  wrap.style.gridTemplateColumns = '1fr auto';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '8px';
  wrap.style.minWidth = '0';
  // Grow to fill the row's control column (#373). Without this the grid wrap
  // is content-sized inside its flex parent (.pyr3-ctrl), so the 1fr rail
  // collapsed to 0px — the slider read as a bare handle dot, no visible track.
  wrap.style.flex = '1 1 0';
  wrap.style.width = '100%';

  // Visual rail (left) — interactive. Click-anywhere snaps the handle to
  // that point and drag-anywhere updates the value continuously. The
  // numeric value to the right still supports drag-to-scrub + dbl-click
  // type-to-enter, so power users have all three affordances.
  const rail = document.createElement('div');
  rail.className = 'pyr3-slider-rail';
  rail.style.position = 'relative';
  // 12px tall click target with a 2px visual stripe centered inside —
  // a 4px-tall rail is too narrow to grab reliably.
  rail.style.height = '12px';
  rail.style.background = 'transparent';
  rail.style.borderRadius = '2px';
  rail.style.minWidth = '0';
  rail.style.cursor = 'pointer';
  rail.style.touchAction = 'none';
  // Inner stripe + fill draw the visible rail.
  const stripe = document.createElement('div');
  stripe.style.position = 'absolute';
  stripe.style.left = '0';
  stripe.style.right = '0';
  stripe.style.top = '50%';
  stripe.style.height = '5px';
  stripe.style.transform = 'translateY(-50%)';
  // Visible neutral track (#373) — was COLORS.bg.input (#0a0a0c), nearly
  // identical to the panel so the rail read as a stray dot. A lighter track
  // makes every buildSlider field a legible slider behind the orange fill.
  stripe.style.background = '#34343e';
  stripe.style.borderRadius = '3px';
  stripe.style.pointerEvents = 'none';
  rail.appendChild(stripe);

  const fill = document.createElement('div');
  fill.className = 'pyr3-slider-fill';
  fill.style.position = 'absolute';
  fill.style.left = '0';
  fill.style.top = '50%';
  fill.style.height = '5px';
  fill.style.transform = 'translateY(-50%)';
  // Warm amber→orange fill (#373) — matches the flame palette + accent vocabulary.
  fill.style.background = `linear-gradient(90deg, ${COLORS.flame.mid}, ${COLORS.flame.top})`;
  fill.style.borderRadius = '3px';
  fill.style.pointerEvents = 'none';

  const handle = document.createElement('div');
  handle.className = 'pyr3-slider-handle';
  handle.style.position = 'absolute';
  handle.style.top = '50%';
  handle.style.width = '12px';
  handle.style.height = '12px';
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

  // Click-anywhere-on-rail = jump-to-value + start drag. While dragging,
  // pointermove updates value continuously; release/cancel ends the drag.
  function valueFromClientX(clientX: number): number {
    const rect = rail.getBoundingClientRect();
    const range = opts.max - opts.min;
    if (rect.width <= 0 || range <= 0) return opts.min;
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    let v = opts.min + t * range;
    if (opts.step !== undefined && opts.step > 0) {
      v = opts.min + Math.round((v - opts.min) / opts.step) * opts.step;
    }
    return Math.max(opts.min, Math.min(opts.max, v));
  }
  function commitFromX(clientX: number): void {
    const v = valueFromClientX(clientX);
    updateVisual(v);
    scrubby.setValue(v);
    opts.onChange(v);
  }
  let railDragActive = false;
  rail.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    railDragActive = true;
    try { rail.setPointerCapture(ev.pointerId); } catch { /* ignored */ }
    commitFromX(ev.clientX);
    ev.preventDefault();
  });
  rail.addEventListener('pointermove', (ev) => {
    if (!railDragActive) return;
    commitFromX(ev.clientX);
  });
  function endRailDrag(ev: PointerEvent): void {
    if (!railDragActive) return;
    railDragActive = false;
    try { rail.releasePointerCapture(ev.pointerId); } catch { /* ignored */ }
  }
  rail.addEventListener('pointerup', endRailDrag);
  rail.addEventListener('pointercancel', endRailDrag);

  // Expose a programmatic setter so callers (preset/undo/external sync) can
  // update the displayed value WITHOUT firing onChange — mirrors scrubby's
  // setValue contract. Non-breaking: SliderControl extends HTMLElement (#373).
  const control = wrap as unknown as SliderControl;
  control.setValue = (v: number): void => {
    updateVisual(v);
    scrubby.setValue(v);
  };

  return control;
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
// Two visual looks across three named variants for the editor's action surface:
//   plain    — dark gradient bg, dark border, normal text (the SECONDARY look)
//   accent   — renders IDENTICALLY to `plain` (post-#373 — the warm-tint look
//              was retired; the variant name is kept as a semantic seam so
//              call sites that mean "named action" don't have to churn)
//   primary  — filled flame gradient, dark text, glow shadow (popped CTA)
//
// Hover lift: plain/accent → border + bg brighten on a dark base; primary
// keeps its bright fill but brightens the glow.
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
    // 'plain' and 'accent' both render the canonical SECONDARY look (#373 button
    // vocab) — the workhorse tier. `fit`, `Reset HSL`, `reset to identity` etc.
    // all converge here so the panel reads consistently. The loud filled
    // 'primary' tier below stays the one true add/apply emphasis.
    case 'plain':
    case 'accent': {
      btn.style.background = '#1a1a20';
      btn.style.border = '1px solid #34343e';
      btn.style.color = '#cfcfd6';
      btn.addEventListener('mouseenter', () => {
        btn.style.borderColor = '#55556a';
        btn.style.background = '#202028';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.borderColor = '#34343e';
        btn.style.background = '#1a1a20';
      });
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

// ── Expander (Tier-4 action expander) ──────────────────────────────────────
// The canonical disclosure/action bar for any settings surface. Orange
// accent-bar styling lives in the shared `.pyr3-aff-expander` class
// (src/edit-ui.ts EDIT_CSS). See docs/ui-affordance-system.md (#373). Built on
// native <details>/<summary> so open-state toggling is free; callers append
// fold content into `.body`.
export interface ExpanderOpts {
  /** Summary content — plain label text, or a prebuilt element (e.g. label + ? icon). */
  summary: string | HTMLElement;
  /** Initial open state (default false). */
  open?: boolean;
  /** Stable key for undo/redo open-state restore (sets data-subpanel, #358). */
  subpanelKey?: string;
}

export interface ExpanderResult {
  details: HTMLDetailsElement;
  summary: HTMLElement;
  /** Append your fold content here. */
  body: HTMLDivElement;
}

export function buildExpander(opts: ExpanderOpts): ExpanderResult {
  const details = document.createElement('details');
  details.className = 'pyr3-aff-expander';
  if (opts.open) details.open = true;
  if (opts.subpanelKey) details.dataset.subpanel = opts.subpanelKey;
  const summary = document.createElement('summary');
  if (typeof opts.summary === 'string') summary.textContent = opts.summary;
  else summary.appendChild(opts.summary);
  const body = document.createElement('div');
  body.className = 'pyr3-aff-expander-body';
  details.append(summary, body);
  return { details, summary, body };
}
