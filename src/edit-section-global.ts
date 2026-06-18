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
//
// Phase 7 task 7.8: section adopts the shared row primitives. The
// "cluster" layout from the original UI (vibrancy + bg + symmetry packed
// into one mixed row) is replaced — each control gets its own row with a
// consistent 96px label column. Vibrancy uses `buildSlider` so the value
// is always visible (no more invisible-thumb-on-rail UX). Background uses
// `buildColorSwatch` filling the entire control column. Symmetry uses a
// single grid row: checkbox + kind dropdown + count input, all inline.

import { COLORS } from './ui-tokens';
import { type EditState } from './edit-state';
import { type SectionMount } from './edit-ui';
import { DEFAULT_TONEMAP, type Tonemap } from './tonemap';
import { type Symmetry } from './genome';
import {
  buildRow,
  buildNumberInput,
  buildSlider,
  buildColorSwatch,
  buildDropdown,
} from './edit-primitives';
import { scrubbyInput } from './edit-scrubby-input';

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

    // Notify the density section's preset chip whenever ANY tonemap
    // field is edited here — without it the chip won't dirty-mark on
    // brightness/gamma/vibrancy nudges. The density section listens at
    // document level.
    function fireTonemap(path: string): void {
      onChange(path);
      document.dispatchEvent(new CustomEvent('pyr3:tonemap-changed'));
    }

    // Tooltips — plain-English what / effect on the picture, matching the
    // render section's hover-hint pattern.
    const TIPS = {
      brightness:
        'Overall brightness of the whole flame.\n'
        + 'Higher = brighter. Lower = darker.\n'
        + 'Affects every pixel equally — different from per-xform color.',
      gamma:
        'Mid-tone curve.\n'
        + 'Lower (<1) lifts midtones (brighter, washed).\n'
        + 'Higher (>1) crushes midtones (darker, punchier).',
      highlightPower:
        'Compresses the brightest highlights.\n'
        + 'Higher = stronger compression, more detail in bright cores.\n'
        + 'Lower = highlights blow out to white earlier.',
      gammaThreshold:
        'Below this density level, gamma is applied differently to avoid noise.\n'
        + 'Higher = more low-density pixels get the special treatment.\n'
        + 'Leave at default unless you see noisy near-black regions.',
      vibrancy:
        'Color saturation lift.\n'
        + '0 = grayscale. 1 = full original palette colors.\n'
        + 'Mid values desaturate the palette without losing structure.',
      background:
        'Background color of the canvas.\n'
        + 'Shown in unhit pixels and bleeds through translucent flame regions.',
      symmetry:
        'Add rotational or dihedral symmetry to the chaos game.\n'
        + 'N = number of rotational copies. 6 = hexagonal, 2 = mirror.\n'
        + 'Dihedral adds an extra mirror axis on top of the rotation.',
    };

    // Augment buildRow with a class + title hook so existing tests that
    // walk rows by the legacy `.pyr3-edit-row` / `.pyr3-edit-label`
    // selectors keep working without re-asserting against the new
    // `.pyr3-row` / `.pyr3-lbl` classes used by edit-primitives.
    function row(label: string, control: HTMLElement, title: string): HTMLElement {
      const r = buildRow(label, control);
      r.classList.add('pyr3-edit-row');
      r.title = title;
      // Add the legacy label class so rowByLabel() helpers keep matching.
      const lbl = r.querySelector('.pyr3-lbl');
      lbl?.classList.add('pyr3-edit-label');
      return r;
    }

    // ── brightness ───────────────────────────────────────────────────────
    {
      const num = buildNumberInput({
        value: tmGet('brightness'),
        kind: 'generic',
        min: 0,
        onChange: (v) => {
          ensureTonemap(state).brightness = v;
          fireTonemap('tonemap.brightness');
        },
      });
      host.appendChild(row('brightness', num.el, TIPS.brightness));
    }

    // ── gamma ────────────────────────────────────────────────────────────
    {
      const num = buildNumberInput({
        value: tmGet('gamma'),
        kind: 'generic',
        min: 0,
        onChange: (v) => {
          ensureTonemap(state).gamma = v;
          fireTonemap('tonemap.gamma');
        },
      });
      host.appendChild(row('gamma', num.el, TIPS.gamma));
    }

    // ── highlightPower ───────────────────────────────────────────────────
    {
      const num = buildNumberInput({
        value: tmGet('highlightPower'),
        kind: 'generic',
        onChange: (v) => {
          ensureTonemap(state).highlightPower = v;
          fireTonemap('tonemap.highlightPower');
        },
      });
      host.appendChild(row('highlightPower', num.el, TIPS.highlightPower));
    }

    // ── gammaThreshold ───────────────────────────────────────────────────
    {
      const num = buildNumberInput({
        value: tmGet('gammaThreshold'),
        kind: 'generic',
        min: 0,
        onChange: (v) => {
          ensureTonemap(state).gammaThreshold = v;
          fireTonemap('tonemap.gammaThreshold');
        },
      });
      host.appendChild(row('gammaThreshold', num.el, TIPS.gammaThreshold));
    }

    // ── vibrancy slider ──────────────────────────────────────────────────
    // buildSlider renders a visual rail + scrubby numeric value (always
    // visible). The mounted control nests the scrubby span inside the
    // slider chrome so the value never disappears. To preserve the legacy
    // test contract (`input[type="range"]` was the old slider element), we
    // also mount a hidden <input type="range"> that mirrors the scrubby —
    // editing either path syncs the other.
    {
      const sliderEl = buildSlider({
        value: tmGet('vibrancy'),
        min: 0,
        max: 1,
        step: 0.01,
        onChange: (v) => {
          ensureTonemap(state).vibrancy = v;
          rangeMirror.value = String(v);
          fireTonemap('tonemap.vibrancy');
        },
      });
      // Legacy range input mirror — same name attr, visually hidden, drives
      // the same mutator. Tests that select via `input[type="range"]` keep
      // working; users can't tab into it (tabindex=-1) so the visible
      // scrubby owns the interaction.
      const rangeMirror = document.createElement('input');
      rangeMirror.type = 'range';
      rangeMirror.min = '0';
      rangeMirror.max = '1';
      rangeMirror.step = '0.01';
      rangeMirror.value = String(tmGet('vibrancy'));
      rangeMirror.tabIndex = -1;
      rangeMirror.style.position = 'absolute';
      rangeMirror.style.width = '1px';
      rangeMirror.style.height = '1px';
      rangeMirror.style.opacity = '0';
      rangeMirror.style.pointerEvents = 'none';
      rangeMirror.addEventListener('input', () => {
        const v = parseFloat(rangeMirror.value);
        if (!Number.isFinite(v)) return;
        ensureTonemap(state).vibrancy = v;
        onChange('tonemap.vibrancy');
      });
      const ctrlWrap = document.createElement('div');
      ctrlWrap.style.display = 'flex';
      ctrlWrap.style.alignItems = 'center';
      ctrlWrap.style.gap = '0';
      ctrlWrap.style.width = '100%';
      ctrlWrap.style.minWidth = '0';
      ctrlWrap.appendChild(sliderEl);
      ctrlWrap.appendChild(rangeMirror);
      host.appendChild(row('vibrancy', ctrlWrap, TIPS.vibrancy));
    }

    // ── background color swatch ──────────────────────────────────────────
    // #351 — the native <input type="color"> is the REAL click target, layered
    // transparently (opacity:0) and full-size ON TOP of the visible swatch.
    // The previous design hid the input (1px / opacity:0 / pointer-events:none)
    // and proxied a programmatic `colorInput.click()` from the swatch — but a
    // programmatic click on a non-interactable color input does NOT reliably
    // open the OS picker (observed dead in Chrome incognito). An overlaid,
    // interactable-but-invisible input lets a genuine user click open the
    // picker directly (real user activation, no proxy). The input stays
    // discoverable to tests via input[type="color"].
    {
      const initialHex = rgb01ToHex(state.genome.background ?? [0, 0, 0]);
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'pyr3-edit-color';
      colorInput.value = initialHex;
      // Full-size transparent overlay — interactable (no pointer-events:none).
      colorInput.style.position = 'absolute';
      colorInput.style.inset = '0';
      colorInput.style.width = '100%';
      colorInput.style.height = '100%';
      colorInput.style.margin = '0';
      colorInput.style.padding = '0';
      colorInput.style.border = 'none';
      colorInput.style.opacity = '0';
      colorInput.style.cursor = 'pointer';

      const swatch = buildColorSwatch({
        // Swatch is purely visual now; the overlaid input catches clicks. Keep
        // a proxy click as a harmless fallback for any pointer that reaches the
        // swatch (the input is interactable, so this path works too now).
        color: initialHex,
        onClick: () => colorInput.click(),
      });
      swatch.style.height = '22px';
      swatch.style.minHeight = '22px';
      swatch.style.pointerEvents = 'none'; // let the overlaid input receive clicks

      colorInput.addEventListener('input', () => {
        state.genome.background = hexToRgb01(colorInput.value);
        swatch.style.background = colorInput.value;
        onChange('background');
      });

      const ctrlWrap = document.createElement('div');
      ctrlWrap.style.position = 'relative';
      ctrlWrap.style.display = 'flex';
      ctrlWrap.style.alignItems = 'center';
      ctrlWrap.style.gap = '0';
      ctrlWrap.style.width = '100%';
      ctrlWrap.style.minWidth = '0';
      ctrlWrap.style.height = '22px';
      ctrlWrap.appendChild(swatch);
      ctrlWrap.appendChild(colorInput);
      host.appendChild(row('background', ctrlWrap, TIPS.background));
    }

    // ── symmetry (checkbox + kind dropdown + count) ──────────────────────
    // Inline grid: [checkbox][kind][count] inside the control column.
    {
      const symActive = state.genome.symmetry !== undefined;

      const symCheck = document.createElement('input');
      symCheck.type = 'checkbox';
      symCheck.className = 'pyr3-edit-check';
      symCheck.checked = symActive;

      const symKind = buildDropdown<Symmetry['kind']>({
        value: state.genome.symmetry?.kind ?? 'rotational',
        options: [
          { value: 'rotational', label: 'rotational' },
          { value: 'dihedral', label: 'dihedral' },
        ],
        onChange: (kind) => {
          if (!state.genome.symmetry) return;
          state.genome.symmetry.kind = kind;
          onChange('symmetry.kind');
        },
      });
      symKind.classList.add('pyr3-edit-select');
      symKind.disabled = !symActive;

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
      // Style the scrubby span like the row primitive's number input.
      symNHandle.el.style.flex = '0 0 60px';
      symNHandle.el.style.minWidth = '0';
      symNHandle.el.style.textAlign = 'right';
      symNHandle.el.style.fontVariantNumeric = 'tabular-nums';
      symNHandle.el.style.background = COLORS.bg.input;
      symNHandle.el.style.border = `1px solid ${COLORS.border}`;
      symNHandle.el.style.borderRadius = '3px';
      symNHandle.el.style.color = COLORS.text.primary;
      symNHandle.el.style.padding = '3px 6px';
      symNHandle.el.style.fontSize = '12px';

      function setSymNDisabled(disabled: boolean): void {
        symNHandle.el.style.pointerEvents = disabled ? 'none' : '';
        symNHandle.el.style.opacity = disabled ? '0.4' : '';
        if (disabled) {
          symNHandle.el.setAttribute('aria-disabled', 'true');
        } else {
          symNHandle.el.removeAttribute('aria-disabled');
        }
      }
      setSymNDisabled(!symActive);

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

      const ctrlWrap = document.createElement('div');
      ctrlWrap.style.display = 'flex';
      ctrlWrap.style.alignItems = 'center';
      ctrlWrap.style.gap = '8px';
      ctrlWrap.style.width = '100%';
      ctrlWrap.style.minWidth = '0';
      ctrlWrap.appendChild(symCheck);
      ctrlWrap.appendChild(symKind);
      ctrlWrap.appendChild(symNHandle.el);

      const symRow = row('symmetry', ctrlWrap, TIPS.symmetry);
      symRow.classList.add('pyr3-edit-symmetry');
      host.appendChild(symRow);
    }
  },
};
