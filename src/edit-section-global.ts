// pyr3 — /editor global section.
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
  buildButton,
  buildNumberInput,
  buildSlider,
  buildDropdown,
} from './edit-primitives';
import { scrubbyInput } from './edit-scrubby-input';
import { infoIcon } from './help-text';
import { buildBackgroundControl } from './edit-section-background';
import { TONEMAP_PRESETS, type TonemapPreset } from './edit-preset-tonemap';

// Cross-section event: fired when any tonemap field is edited (here or
// elsewhere, e.g. a future surface). The preset strip below subscribes so
// the header chip + strip highlight stay accurate. (#397 — moved here with
// the strip from the old density section.)
export const TONEMAP_CHANGED_EVENT = 'pyr3:tonemap-changed';

// Match the live tonemap against the named-preset list. Only the 4 real
// tonemap fields (gamma / gammaThreshold / vibrancy / brightness) participate
// — `contrast` is a TUNING-FLAG placeholder on the preset table with no
// Tonemap counterpart on this engine, so we skip it.
function matchTonemapPreset(t: Tonemap | undefined): string | null {
  const tm = t ?? DEFAULT_TONEMAP;
  for (const p of TONEMAP_PRESETS) {
    if (
      approxEqTonemap(tm.gamma, p.gamma)
      && approxEqTonemap(tm.gammaThreshold, p.gammaThreshold)
      && approxEqTonemap(tm.vibrancy, p.vibrancy)
      && approxEqTonemap(tm.brightness, p.brightness)
    ) {
      return p.name;
    }
  }
  return null;
}

function approxEqTonemap(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

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

// Tooltips — plain-English what / effect on the picture, matching the
// render section's hover-hint pattern. Module-level so both the tonemap and
// symmetry sections (split out of the old GLOBAL section, #27) can share them.
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
  xformBlend:
    'Xform blend (#456): soft morph between xforms.\n'
    + '0 = off (the normal discrete IFS).\n'
    + 'Higher = more iterations blend two xforms’ outputs, smearing the\n'
    + 'attractor into a continuum of in-between shapes.',
};

// Augment buildRow with a class + title hook so existing tests that
// walk rows by the legacy `.pyr3-edit-row` / `.pyr3-edit-label`
// selectors keep working without re-asserting against the new
// `.pyr3-row` / `.pyr3-lbl` classes used by edit-primitives.
function row(
  label: string,
  control: HTMLElement,
  title: string,
  helpKey?: string,
): HTMLElement {
  const r = buildRow(label, control);
  r.classList.add('pyr3-edit-row');
  r.title = title;
  // Add the legacy label class so rowByLabel() helpers keep matching.
  const lbl = r.querySelector('.pyr3-lbl');
  lbl?.classList.add('pyr3-edit-label');
  // Visible `?` info icon appended into the control cell (the flex
  // `.pyr3-ctrl`, not the label cell — keeps the label's textContent
  // clean for rowByLabel matchers). Promotes the otherwise hover-only
  // `.title` help to an obvious affordance (#348).
  if (helpKey) r.querySelector('.pyr3-ctrl')?.appendChild(infoIcon(helpKey));
  return r;
}

// #27 — the old single GLOBAL section is dissolved into the 4-lens IA:
// tonemap + background → Output lens (this section); symmetry → Scene lens
// (globalSymmetrySection below).
export const globalTonemapSection: SectionMount = {
  key: 'global-tonemap',
  title: '🌐 Tonemap',
  lens: 'output',
  build(host: HTMLElement, state: EditState, onChange: (path: string) => void): (() => void) | void {
    host.replaceChildren();
    let backgroundDispose: (() => void) | undefined;

    // Helper: read current value via override-fallback so initial render
    // reflects DEFAULT_TONEMAP without forcing a lazy-init before the user
    // has touched anything.
    const tmGet = <K extends keyof Tonemap>(k: K): Tonemap[K] =>
      state.genome.tonemap?.[k] ?? DEFAULT_TONEMAP[k];

    // Widget refreshers — assigned when each field widget is built below, so
    // applyTonemapPreset() (defined earlier) can push the new values into the
    // visible controls (#397: the strip now sits next to these fields, so a
    // preset must update their displayed values, not just the render).
    let refreshBrightness: ((v: number) => void) | undefined;
    let refreshGamma: ((v: number) => void) | undefined;
    let refreshGammaThreshold: ((v: number) => void) | undefined;
    let refreshVibrancy: ((v: number) => void) | undefined;

    // Notify the preset strip's chip whenever ANY tonemap field is edited
    // here — without it the chip won't dirty-mark on brightness/gamma/vibrancy
    // nudges. The strip's listener (below) lives at document level.
    function fireTonemap(path: string): void {
      onChange(path);
      document.dispatchEvent(new CustomEvent(TONEMAP_CHANGED_EVENT));
    }

    // ── Tonemap preset strip — top of section body (#397, relocated) ───────
    // Six buttons; clicking applies four tonemap values (gamma /
    // gammaThreshold / vibrancy / brightness) at once. Active preset gets
    // pressed btn-accent styling; clicking again resnaps a dirtied preset
    // (`vivid*` → `vivid`). A header chip tracks the live preset name.
    const presetStrip = document.createElement('div');
    presetStrip.className = 'pyr3-edit-density-preset-strip';
    presetStrip.style.display = 'flex';
    presetStrip.style.flexWrap = 'wrap';
    presetStrip.style.gap = '4px';
    presetStrip.style.marginBottom = '8px';
    presetStrip.title =
      'Tonemap presets — apply four values at once '
      + '(gamma · gammaThreshold · vibrancy · brightness).\n'
      + 'Section header chip shows the current preset; * = manually nudged.';

    interface PresetBtnHandle {
      preset: TonemapPreset;
      setActive(active: boolean): void;
    }
    const presetButtons: PresetBtnHandle[] = [];

    for (const p of TONEMAP_PRESETS) {
      const btnEl = buildButton({
        variant: 'plain',
        label: p.name,
        onClick: () => applyTonemapPreset(p),
      });
      btnEl.classList.add('pyr3-edit-density-tonemap-preset', `pyr3-edit-density-tonemap-preset-${p.name}`);
      // Tiny coloured "vibe" dot to the left of the label.
      const dot = document.createElement('span');
      dot.style.display = 'inline-block';
      dot.style.width = '6px';
      dot.style.height = '6px';
      dot.style.borderRadius = '50%';
      dot.style.background = p.vibe;
      dot.style.marginRight = '5px';
      btnEl.insertBefore(dot, btnEl.firstChild);

      presetButtons.push({
        preset: p,
        setActive(active: boolean): void {
          if (active) {
            btnEl.classList.add('active');
            btnEl.style.background = `linear-gradient(180deg, ${COLORS.bg.action}, ${COLORS.bg.bar})`;
            btnEl.style.borderColor = COLORS.flame.top;
            btnEl.style.color = COLORS.flame.top;
          } else {
            btnEl.classList.remove('active');
            btnEl.style.background = `linear-gradient(180deg, ${COLORS.bg.panel}, ${COLORS.bg.bar})`;
            btnEl.style.borderColor = COLORS.border;
            btnEl.style.color = COLORS.text.primary;
          }
        },
      });
      presetStrip.appendChild(btnEl);
    }
    presetStrip.appendChild(infoIcon('density.tonemapPresets'));
    host.appendChild(presetStrip);

    function applyTonemapPreset(p: TonemapPreset): void {
      const tm = ensureTonemap(state);
      tm.gamma = p.gamma;
      tm.gammaThreshold = p.gammaThreshold;
      tm.vibrancy = p.vibrancy;
      tm.brightness = p.brightness;
      // contrast is a no-op TUNING-FLAG field — preserved on the preset for
      // future engine work; not written to Tonemap (which has no contrast
      // field today).
      onChange('tonemap.gamma');
      onChange('tonemap.gammaThreshold');
      onChange('tonemap.vibrancy');
      onChange('tonemap.brightness');
      // Push the new values into the visible field widgets so the displayed
      // numbers track the preset (not just the render).
      refreshBrightness?.(p.brightness);
      refreshGamma?.(p.gamma);
      refreshGammaThreshold?.(p.gammaThreshold);
      refreshVibrancy?.(p.vibrancy);
      document.dispatchEvent(new CustomEvent(TONEMAP_CHANGED_EVENT));
      refreshTonemapChip();
    }

    // ── Header chip + dirty marker ─────────────────────────────────────────
    // The chip lives in the section header sibling (host.parentElement's
    // `.pyr3-edit-section-header`). On rebuild the chip re-mounts.
    function findHeader(): HTMLElement | null {
      const wrap = host.parentElement;
      if (!wrap) return null;
      return wrap.querySelector('.pyr3-edit-section-header') as HTMLElement | null;
    }

    const chip = document.createElement('span');
    chip.className = 'pyr3-edit-density-chip';
    chip.style.marginLeft = 'auto';
    chip.style.fontSize = '10px';
    chip.style.fontFamily = 'ui-monospace, monospace';
    chip.style.color = COLORS.flame.top;
    chip.style.padding = '1px 6px';
    chip.style.borderRadius = '3px';
    chip.style.border = `1px solid ${COLORS.flame.bot}`;
    chip.style.background = COLORS.bg.action;
    chip.style.userSelect = 'none';
    chip.addEventListener('click', (ev) => ev.stopPropagation());

    function refreshTonemapChip(): void {
      const cleanMatch = matchTonemapPreset(state.genome.tonemap);
      let name: string | null = null;
      let dirty = false;
      if (cleanMatch) {
        name = cleanMatch;
        dirty = false;
        state.lastDensityPreset = name;
      } else if (state.lastDensityPreset) {
        name = state.lastDensityPreset;
        dirty = true;
      }
      chip.textContent = name ? (dirty ? `${name}*` : name) : '';
      chip.style.display = name ? '' : 'none';
      chip.style.opacity = dirty ? '0.7' : '1';
      for (const pb of presetButtons) {
        const isActive = !dirty && pb.preset.name === name;
        const isDirtyOf = dirty && pb.preset.name === name;
        pb.setActive(isActive || isDirtyOf);
      }
    }

    // Mount chip into the header on a microtask (wrap parent is in the DOM
    // by then).
    Promise.resolve().then(() => {
      const header = findHeader();
      if (!header) return;
      header.querySelectorAll('.pyr3-edit-density-chip').forEach((n) => n.remove());
      header.appendChild(chip);
      refreshTonemapChip();
    });

    // Cross-section tonemap-changed event → refresh chip + strip. Self-detaches
    // when this section's host disconnects.
    function onTonemapChanged(): void {
      if (!host.isConnected) {
        document.removeEventListener(TONEMAP_CHANGED_EVENT, onTonemapChanged as EventListener);
        return;
      }
      refreshTonemapChip();
    }
    document.addEventListener(TONEMAP_CHANGED_EVENT, onTonemapChanged as EventListener);

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
      refreshBrightness = (v) => num.handle.setValue(v);
      host.appendChild(row('brightness', num.el, TIPS.brightness, 'global.brightness'));
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
      refreshGamma = (v) => num.handle.setValue(v);
      host.appendChild(row('gamma', num.el, TIPS.gamma, 'global.gamma'));
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
      host.appendChild(row('highlightPower', num.el, TIPS.highlightPower, 'global.highlightPower'));
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
      refreshGammaThreshold = (v) => num.handle.setValue(v);
      host.appendChild(row('gammaThreshold', num.el, TIPS.gammaThreshold, 'global.gammaThreshold'));
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
      // Preset refresh: sync both the visible slider and the hidden mirror.
      // (The slider clamps to [0,1]; presets with vibrancy > 1 display at the
      // cap — the genome still carries the true value.)
      refreshVibrancy = (v) => {
        sliderEl.setValue(v);
        rangeMirror.value = String(v);
      };
      const ctrlWrap = document.createElement('div');
      ctrlWrap.style.display = 'flex';
      ctrlWrap.style.alignItems = 'center';
      ctrlWrap.style.gap = '0';
      ctrlWrap.style.width = '100%';
      ctrlWrap.style.minWidth = '0';
      ctrlWrap.appendChild(sliderEl);
      ctrlWrap.appendChild(rangeMirror);
      host.appendChild(row('vibrancy', ctrlWrap, TIPS.vibrancy, 'global.vibrancy'));
    }

    // ── background color swatch (shared widget, mirrored into Color/Palette — #27) ──
    // The #351 overlay-input behavior lives in buildBackgroundControl now; this
    // is one of two mount points (the other is the Palette section in the Color
    // lens), kept in sync via state.backgroundListeners.
    {
      const bg = buildBackgroundControl(state, onChange);
      backgroundDispose = bg.dispose;
      host.appendChild(row('background', bg.el, TIPS.background, 'global.background'));
    }

    return () => {
      backgroundDispose?.();
      document.removeEventListener(TONEMAP_CHANGED_EVENT, onTonemapChanged as EventListener);
    };
  },
};

export const globalSymmetrySection: SectionMount = {
  key: 'global-symmetry',
  // Catch-all "Structure" header — this scene-lens section holds the structural
  // IFS modifiers: symmetry (rotational/dihedral copies) + xform blend (#456 morph).
  title: '🌀 Structure',
  lens: 'scene',
  build(host: HTMLElement, state: EditState, onChange: (path: string) => void): void {
    host.replaceChildren();

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
      // Border owned by .pyr3-edit-num (1px sides + accent bottom-rule, #373) —
      // setting it inline would suppress the drag-to-edit underline.
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

      const symRow = row('symmetry', ctrlWrap, TIPS.symmetry, 'global.symmetry');
      symRow.classList.add('pyr3-edit-symmetry');
      host.appendChild(symRow);
    }

    // ── #456 xform blend λ (soft morph between xforms) ───────────────────
    {
      const blendSlider = buildSlider({
        value: state.genome.xformBlend ?? 0,
        min: 0,
        max: 1,
        step: 0.05,
        format: (v) => v.toFixed(2),
        onChange: (v) => {
          // Drop the field when 0 so a "no morph" flame keeps clean JSON.
          if (v === 0) state.genome.xformBlend = undefined;
          else state.genome.xformBlend = v;
          onChange('xformBlend');
        },
      });
      blendSlider.dataset['xformBlend'] = '';
      const blendRow = row('xform blend', blendSlider, TIPS.xformBlend, 'global.xformBlend');
      blendRow.classList.add('pyr3-edit-xform-blend');
      host.appendChild(blendRow);
    }
  },
};
