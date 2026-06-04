// pyr3 — /v1/edit global section.
//
// Whole-flame knobs that don't belong to a single xform: tone-map (brightness,
// gamma, vibrancy, highlightPower, gammaThreshold), background color, and
// symmetry (kind + n). All tonemap fields lazy-init `genome.tonemap` from
// DEFAULT_TONEMAP on first edit so the user sees the canonical defaults
// reflected in the UI until they explicitly touch a knob. Background writes
// as `[r, g, b]` floats in 0..1 (matches genome.background and flam3's
// `<flame background="R G B">`).
//
// Lane routing (per src/edit-state.ts pathLane):
//   - tonemap.*, background → fast lane (present()-only re-render)
//   - symmetry.* → slow lane (chaos pool changes, must re-iterate)

import { type EditState } from './edit-state';
import { type SectionMount } from './edit-ui';
import { DEFAULT_TONEMAP, type Tonemap } from './tonemap';
import { type Symmetry } from './genome';
import { scrubbyInput, type FieldKind, type ScrubbyHandle } from './edit-scrubby-input';

// Hex `#rrggbb` → [r, g, b] floats in 0..1.
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1]!, 16);
  return [
    ((n >> 16) & 0xff) / 255,
    ((n >> 8) & 0xff) / 255,
    (n & 0xff) / 255,
  ];
}

// [r, g, b] floats in 0..1 → `#rrggbb`. Components are clamped to [0,1]
// before quantisation so a slightly-out-of-range stored value still produces
// a valid hex string for the color input element.
export function rgb01ToHex(rgb: readonly [number, number, number]): string {
  const q = (v: number): string => {
    const c = Math.max(0, Math.min(1, v));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${q(rgb[0])}${q(rgb[1])}${q(rgb[2])}`;
}

function ensureTonemap(state: EditState): Tonemap {
  if (!state.genome.tonemap) {
    state.genome.tonemap = { ...DEFAULT_TONEMAP };
  }
  return state.genome.tonemap;
}

function numberInput(
  value: number,
  onInput: (v: number) => void,
  opts: { kind?: FieldKind; min?: number; max?: number; minStep?: number; format?: (v: number) => string } = {},
): ScrubbyHandle {
  return scrubbyInput({
    value,
    onInput,
    kind: opts.kind ?? 'generic',
    ...(opts.min !== undefined ? { min: opts.min } : {}),
    ...(opts.max !== undefined ? { max: opts.max } : {}),
    ...(opts.minStep !== undefined ? { minStep: opts.minStep } : {}),
    ...(opts.format !== undefined ? { format: opts.format } : {}),
  });
}

function sliderInput(
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (v: number) => void,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.className = 'pyr3-edit-slider';
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onInput(v);
  });
  return input;
}

function labeledRow(label: string, ...controls: HTMLElement[]): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'pyr3-edit-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'pyr3-edit-label';
  labelEl.textContent = label;
  row.append(labelEl, ...controls);
  return row;
}

export const globalSection: SectionMount = {
  key: 'global',
  title: '🌐 GLOBAL',
  build(host: HTMLElement, state: EditState, onChange: (path: string) => void): void {
    host.replaceChildren();

    // Helper: read current value via override-fallback so initial render
    // reflects DEFAULT_TONEMAP without forcing a lazy-init before the user
    // has touched anything.
    const tmGet = <K extends keyof Tonemap>(k: K): Tonemap[K] =>
      state.genome.tonemap?.[k] ?? DEFAULT_TONEMAP[k];

    // ── brightness ───────────────────────────────────────────────────────
    host.appendChild(labeledRow(
      'brightness',
      numberInput(tmGet('brightness'), (v) => {
        ensureTonemap(state).brightness = v;
        onChange('tonemap.brightness');
      }, { kind: 'generic', min: 0 }).el,
    ));

    // ── gamma ────────────────────────────────────────────────────────────
    host.appendChild(labeledRow(
      'gamma',
      numberInput(tmGet('gamma'), (v) => {
        ensureTonemap(state).gamma = v;
        onChange('tonemap.gamma');
      }, { kind: 'generic', min: 0 }).el,
    ));

    // ── highlightPower ───────────────────────────────────────────────────
    host.appendChild(labeledRow(
      'highlightPower',
      numberInput(tmGet('highlightPower'), (v) => {
        ensureTonemap(state).highlightPower = v;
        onChange('tonemap.highlightPower');
      }, { kind: 'generic' }).el,
    ));

    // ── gammaThreshold ───────────────────────────────────────────────────
    host.appendChild(labeledRow(
      'gammaThreshold',
      numberInput(tmGet('gammaThreshold'), (v) => {
        ensureTonemap(state).gammaThreshold = v;
        onChange('tonemap.gammaThreshold');
      }, { kind: 'generic', min: 0 }).el,
    ));

    // ── vibrancy (0..1 slider) ───────────────────────────────────────────
    host.appendChild(labeledRow(
      'vibrancy',
      sliderInput(tmGet('vibrancy'), 0, 1, 0.01, (v) => {
        ensureTonemap(state).vibrancy = v;
        onChange('tonemap.vibrancy');
      }),
    ));

    // ── background color picker ──────────────────────────────────────────
    const bgInput = document.createElement('input');
    bgInput.type = 'color';
    bgInput.className = 'pyr3-edit-color';
    bgInput.value = rgb01ToHex(state.genome.background ?? [0, 0, 0]);
    bgInput.addEventListener('input', () => {
      state.genome.background = hexToRgb01(bgInput.value);
      onChange('background');
    });
    host.appendChild(labeledRow('background', bgInput));

    // ── symmetry (active toggle + kind dropdown + n number) ──────────────
    const symRow = document.createElement('div');
    symRow.className = 'pyr3-edit-row pyr3-edit-symmetry';

    const symLabel = document.createElement('span');
    symLabel.className = 'pyr3-edit-label';
    symLabel.textContent = 'symmetry';
    symRow.appendChild(symLabel);

    const symCheck = document.createElement('input');
    symCheck.type = 'checkbox';
    symCheck.className = 'pyr3-edit-check';
    symCheck.checked = state.genome.symmetry !== undefined;
    symRow.appendChild(symCheck);

    const symKind = document.createElement('select');
    symKind.className = 'pyr3-edit-select';
    for (const k of ['rotational', 'dihedral'] as const) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      symKind.appendChild(opt);
    }
    symKind.value = state.genome.symmetry?.kind ?? 'rotational';
    symKind.disabled = state.genome.symmetry === undefined;
    symKind.addEventListener('change', () => {
      if (!state.genome.symmetry) return;
      state.genome.symmetry.kind = symKind.value as Symmetry['kind'];
      onChange('symmetry.kind');
    });
    symRow.appendChild(symKind);

    const symNHandle = scrubbyInput({
      value: state.genome.symmetry?.n ?? 2,
      kind: 'generic',
      min: 1,
      minStep: 1,
      format: (v) => String(Math.round(v)),
      onInput: (v) => {
        if (!state.genome.symmetry) return;
        const rounded = Math.max(1, Math.round(v));
        state.genome.symmetry.n = rounded;
        onChange('symmetry.n');
      },
    });
    const symN = symNHandle.el;
    // Mirror the old disabled affordance for the scrubby span — pointer events
    // off + visually muted when symmetry is inactive.
    function setSymNDisabled(disabled: boolean): void {
      symN.style.pointerEvents = disabled ? 'none' : '';
      symN.style.opacity = disabled ? '0.4' : '';
      if (disabled) {
        symN.setAttribute('aria-disabled', 'true');
      } else {
        symN.removeAttribute('aria-disabled');
      }
    }
    setSymNDisabled(state.genome.symmetry === undefined);
    symRow.appendChild(symN);

    symCheck.addEventListener('change', () => {
      if (symCheck.checked) {
        state.genome.symmetry = { kind: 'rotational', n: 2 };
        symKind.disabled = false;
        setSymNDisabled(false);
        symKind.value = 'rotational';
        symNHandle.setValue(2);
      } else {
        state.genome.symmetry = undefined;
        symKind.disabled = true;
        setSymNDisabled(true);
      }
      onChange('symmetry.active');
    });

    host.appendChild(symRow);
  },
};
