// pyr3 — /v1/edit density-emitter section.
//
// Surfaces TWO related controls under one section header:
//
//   1. **Tonemap preset strip** (Phase 7 task 7.10): six named presets
//      (`default · soft · vivid · punchy · cinematic · crystal`) that
//      write all five tonemap fields (gamma / gammaThreshold / vibrancy
//      / brightness / contrast) at once. Per the spec the section name
//      "DENSITY EMITTER" refers to the tonemap stack (post-DE colour
//      compression) as the user perceives it. The header carries a
//      preset chip + dirty marker (`vivid` clean, `vivid*` after manual
//      edit) tracking the live tonemap state across sessions. The chip
//      updates on density-section edits AND on the cross-section custom
//      event `pyr3:tonemap-changed` (fired by edit-section-global.ts so
//      brightness/gamma/vibrancy edits over there reflect here).
//
//   2. **Engine DE params** (existing): maxRad / minRad / curve sliders
//      + the engine's adaptive-Gaussian preset dropdown. Same lane
//      routing as before (fast lane — present()-only re-render).
//
// onChange paths (all fast lane per pathLane in src/edit-state.ts):
//   - density.maxRad / density.minRad / density.curve
//   - density.preset → coalesces to onChange('density.maxRad') (the
//     fast-lane scheduler dedupes the per-field paths fired in the same tick)
//   - tonemap.<field> when a preset is applied
//
// Tooltip popovers — every labeled field carries a `?` info icon (via
// `buildInfoIcon`) that toggles a right-anchored explainer. Click again
// or outside to dismiss.

import { type SectionMount } from './edit-ui';
import { type Density, DEFAULT_DENSITY } from './density';
import { scrubbyInput, type ScrubbyHandle } from './edit-scrubby-input';
import { DEFAULT_TONEMAP, type Tonemap } from './tonemap';
import {
  DENSITY_PRESETS as TONEMAP_PRESETS,
  type DensityPreset as TonemapPreset,
} from './edit-preset-density';
import { COLORS } from './ui-tokens';
import { buildButton } from './edit-primitives';
import { buildInfoIcon } from './edit-tooltip';

// Cross-section event: fired when any tonemap field is edited outside the
// density section (e.g. brightness in Global). The density section
// subscribes so the header chip + strip highlight stay accurate.
export const TONEMAP_CHANGED_EVENT = 'pyr3:tonemap-changed';

// Match the live tonemap against the named-preset list. Only the 4
// real tonemap fields (gamma / gammaThreshold / vibrancy / brightness)
// participate — `contrast` is a TUNING-FLAG placeholder on the preset
// table and has no Tonemap counterpart on this engine, so we skip it.
function matchTonemapPreset(t: Tonemap | undefined): string | null {
  const tm = t ?? DEFAULT_TONEMAP;
  for (const p of TONEMAP_PRESETS) {
    if (
      approxEq(tm.gamma, p.gamma)
      && approxEq(tm.gammaThreshold, p.gammaThreshold)
      && approxEq(tm.vibrancy, p.vibrancy)
      && approxEq(tm.brightness, p.brightness)
    ) {
      return p.name;
    }
  }
  return null;
}

function approxEq(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

export const densitySection: SectionMount = {
  key: 'density',
  title: '💫 DENSITY EMITTER',
  build(host, state, onChange) {
    host.classList.add('pyr3-edit-section-density');

    function ensureDensity(): Density {
      if (!state.genome.density) {
        state.genome.density = { ...DEFAULT_DENSITY };
      }
      return state.genome.density;
    }

    function ensureTonemap(): Tonemap {
      if (!state.genome.tonemap) {
        state.genome.tonemap = { ...DEFAULT_TONEMAP };
      }
      return state.genome.tonemap;
    }

    // ── Tonemap preset strip — top of section body ──────────────────────────
    // Six buttons; clicking applies all five preset values to tonemap.
    // Active preset gets pressed btn-accent styling; clicking a button
    // again resnaps a dirtied preset (`vivid*` → `vivid`).
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
      el: HTMLElement;
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
      // Tiny coloured "vibe" dot to the left of the label to signal the
      // preset's character (warm/cool/neutral). Inline prepend so the
      // existing buildButton label flow stays intact.
      const dot = document.createElement('span');
      dot.style.display = 'inline-block';
      dot.style.width = '6px';
      dot.style.height = '6px';
      dot.style.borderRadius = '50%';
      dot.style.background = p.vibe;
      dot.style.marginRight = '5px';
      btnEl.insertBefore(dot, btnEl.firstChild);

      const handle: PresetBtnHandle = {
        el: btnEl,
        preset: p,
        setActive(active: boolean): void {
          if (active) {
            btnEl.classList.add('active');
            // Pressed-state styling — swap to accent variant visuals.
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
      };
      presetButtons.push(handle);
      presetStrip.appendChild(btnEl);
    }
    host.appendChild(presetStrip);

    function applyTonemapPreset(p: TonemapPreset): void {
      const tm = ensureTonemap();
      tm.gamma = p.gamma;
      tm.gammaThreshold = p.gammaThreshold;
      tm.vibrancy = p.vibrancy;
      tm.brightness = p.brightness;
      // contrast is a no-op TUNING-FLAG field — preserved on the preset
      // for future engine work; not written to Tonemap (which has no
      // contrast field today).
      onChange('tonemap.gamma');
      onChange('tonemap.gammaThreshold');
      onChange('tonemap.vibrancy');
      onChange('tonemap.brightness');
      // Notify the cross-section so the strip/chip on this section
      // re-evaluates dirty-state vs. the just-applied preset.
      document.dispatchEvent(new CustomEvent(TONEMAP_CHANGED_EVENT));
      refreshTonemapChip();
    }

    // ── Three slider+number rows (maxRad / minRad / curve) ──────────────────
    // 2026-06-05: the engine-DE preset dropdown (`crisp / standard / smooth`)
    // was dropped — the tonemap preset strip above already serves the
    // "quick-start defaults" affordance for this section, and the three
    // sliders below let advanced users tune maxRad/minRad/curve directly.
    interface SliderPair {
      slider: HTMLInputElement;
      number: HTMLElement;
      handle: ScrubbyHandle;
    }

    function makeRow(
      labelText: string,
      cls: string,
      min: number,
      max: number,
      step: number,
      onScrub: (v: number) => void,
      tooltip: { title: string; body: string; hint?: string },
    ): SliderPair {
      const row = document.createElement('div');
      row.className = `pyr3-edit-density-row ${cls}-row`;
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';
      row.style.marginTop = '6px';

      const lab = document.createElement('span');
      lab.textContent = labelText;
      lab.style.width = '96px';
      lab.style.color = COLORS.text.muted;
      lab.style.fontSize = '12px';

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(min);
      slider.max = String(max);
      slider.step = String(step);
      slider.className = `${cls}-slider`;
      slider.style.flex = '1 1 auto';

      const handle = scrubbyInput({
        value: 0,
        kind: 'generic',
        min,
        max,
        minStep: step,
        onInput: onScrub,
      });
      const number = handle.el;
      number.classList.add(`${cls}-number`);
      number.style.width = '60px';

      row.append(lab, slider, number, buildInfoIcon(tooltip));
      host.appendChild(row);
      return { slider, number, handle };
    }

    // Forward-declare so the makeRow onScrub callbacks can reference setField
    // (function declarations below are hoisted within this build() scope).
    const maxRadPair = makeRow('maxRad', 'pyr3-edit-density-maxRad', 0, 30, 0.5, (v) => {
      maxRadPair.slider.value = String(v);
      setField('maxRad', v);
    }, {
      title: 'MAX RADIUS',
      body:
        'Maximum blur radius around each scatter point. '
        + 'Higher = softer, glowier image. Lower = sharper, more granular.',
      hint: 'At 0, density estimation is off (raw point cloud).',
    });
    const minRadPair = makeRow('minRad', 'pyr3-edit-density-minRad', 0, 30, 0.1, (v) => {
      minRadPair.slider.value = String(v);
      setField('minRad', v);
    }, {
      title: 'MIN RADIUS',
      body:
        'Minimum blur radius — the floor for dense areas. '
        + 'Dense regions use this; sparse regions blur up to maxRad.',
      hint: 'Keep at or below maxRad.',
    });
    const curvePair = makeRow('curve', 'pyr3-edit-density-curve', 0.1, 2.0, 0.05, (v) => {
      curvePair.slider.value = String(v);
      setField('curve', v);
    }, {
      title: 'CURVE',
      body:
        'How density maps to blur radius. '
        + '< 1 = aggressive (sparse areas reach maxRad quickly). '
        + '> 1 = gentle (only the sparsest areas get close to maxRad).',
      hint: 'Default 0.4 works for most flames.',
    });

    // ── Header chip + dirty marker ─────────────────────────────────────────
    // The chip lives in the header sibling (parent's previousElementSibling
    // when the section is mounted via mountEditUi). On rebuild the chip
    // re-mounts.
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
    // Avoid header click handlers (toggle collapse) from firing on chip
    // clicks — readable info only.
    chip.addEventListener('click', (ev) => ev.stopPropagation());

    // Track the last applied preset so dirty-state can show the user
    // *what they were aiming at* even after they nudge values manually.
    // Persists for the lifetime of this section build; resets on rebuild.
    state.lastDensityPreset = state.lastDensityPreset; // ensure key exists

    function refreshTonemapChip(): void {
      const cleanMatch = matchTonemapPreset(state.genome.tonemap);
      let name: string | null = null;
      let dirty = false;
      if (cleanMatch) {
        name = cleanMatch;
        dirty = false;
        // Remember the cleanly-applied preset for future dirty-tracking.
        state.lastDensityPreset = name;
      } else if (state.lastDensityPreset) {
        name = state.lastDensityPreset;
        dirty = true;
      }
      chip.textContent = name ? (dirty ? `${name}*` : name) : '';
      chip.style.display = name ? '' : 'none';
      chip.style.opacity = dirty ? '0.7' : '1';
      // Update preset-strip active highlight.
      for (const pb of presetButtons) {
        const isActive = !dirty && pb.preset.name === name;
        const isDirtyOf = dirty && pb.preset.name === name;
        pb.setActive(isActive || isDirtyOf);
      }
    }

    // Mount chip into the header. Defer to a microtask so the section's
    // wrap parent is already in the DOM when build() runs.
    Promise.resolve().then(() => {
      const header = findHeader();
      if (!header) return;
      // Remove a prior chip if this section re-mounts.
      header.querySelectorAll('.pyr3-edit-density-chip').forEach((n) => n.remove());
      header.appendChild(chip);
      refreshTonemapChip();
    });

    // Cross-section tonemap-changed event → refresh chip + strip.
    function onTonemapChanged(): void {
      if (!host.isConnected) {
        document.removeEventListener(TONEMAP_CHANGED_EVENT, onTonemapChanged as EventListener);
        return;
      }
      refreshTonemapChip();
    }
    document.addEventListener(TONEMAP_CHANGED_EVENT, onTonemapChanged as EventListener);

    // ── Engine DE state mutators ───────────────────────────────────────────

    function syncWidgets(): void {
      const d = ensureDensity();
      maxRadPair.slider.value = String(d.maxRad);
      maxRadPair.handle.setValue(d.maxRad);
      minRadPair.slider.value = String(d.minRad);
      minRadPair.handle.setValue(d.minRad);
      curvePair.slider.value = String(d.curve);
      curvePair.handle.setValue(d.curve);
    }

    function setField(field: keyof Density, value: number): void {
      if (!Number.isFinite(value)) return;
      const d = ensureDensity();
      d[field] = value;
      onChange(`density.${field}`);
    }

    function bindSlider(pair: SliderPair, field: keyof Density): void {
      pair.slider.addEventListener('input', () => {
        const n = Number(pair.slider.value);
        if (!Number.isFinite(n)) return;
        pair.handle.setValue(n);
        setField(field, n);
      });
    }

    bindSlider(maxRadPair, 'maxRad');
    bindSlider(minRadPair, 'minRad');
    bindSlider(curvePair, 'curve');

    syncWidgets();
  },
};
