// #460 — "Color mode" section in the editor's Color lens.
//
// Relocates the palette / flow / trap-distance color-mode controls out of the
// shared render-mode-bar (where they used to live for both viewer and editor)
// into an editor-only Color-lens section. The viewer is now strictly
// palette-only; flow + trap are creative tools that belong with editing.
//
// Color mode is a sticky per-browser VIEWING pref (ColorModeConfig in
// localStorage), NOT a genome field — the same contract as before. On any
// change the section persists via saveColorModeConfig and signals the editor
// with onChange('color-mode'); edit-mount's onPathChange reloads the cfg and
// schedules a slow-lane re-iterate (color is baked at splat time).
//
// Affordance system (#373, docs/ui-affordance-system.md): controls are built
// from the shared primitives — buildRow (Tier-3 row grid) + buildDropdown +
// buildNumberInput (Tier-5 scrubby) + buildSlider — so the section matches the
// rest of the editor by class, not copy-pasted CSS. All nodes via createElement
// (no-innerHTML invariant).

import { type SectionMount } from './edit-ui';
import { type EditState } from './edit-state';
import { buildRow, buildDropdown, buildNumberInput, buildSlider, buildPair } from './edit-primitives';
import {
  type ColorModeConfig,
  type TrapConfig,
  loadColorModeConfig,
  saveColorModeConfig,
} from './render-mode-config';

/** The path edit-mount.onPathChange recognises as "color-mode pref changed →
 *  reload cfg + slow-lane re-iterate" (NOT a genome edit). */
export const COLOR_MODE_CHANGE_PATH = 'color-mode';

export const colorModeSection: SectionMount = {
  key: 'color-mode',
  lens: 'color',
  title: 'Color mode',
  build(host: HTMLElement, _state: EditState, onChange: (path: string) => void): void {
    host.classList.add('pyr3-edit-section-color-mode');
    const cfg = loadColorModeConfig();
    // Mutable working copy; each control updates its field then emits.
    let mode = cfg.mode;
    let flowStrength = cfg.flowStrength;
    let flowScale = cfg.flowScale;
    const trap: TrapConfig = { ...cfg.trap };

    function emit(): void {
      saveColorModeConfig({ mode, flowStrength, flowScale, trap: { ...trap } });
      paint();
      onChange(COLOR_MODE_CHANGE_PATH);
    }

    // ── mode selector (Tier-3 row + Tier dropdown) ─────────────────────────
    const modeSelect = buildDropdown<ColorModeConfig['mode']>({
      value: mode,
      options: [
        { value: 'palette', label: 'Palette' },
        { value: 'flow', label: 'Flow' },
        { value: 'trap-distance', label: 'Trap' },
      ],
      onChange: (v) => { mode = v; emit(); },
    });
    modeSelect.dataset['renderColorMode'] = '';
    host.appendChild(buildRow('Mode', modeSelect));

    // ── flow controls (#459) ───────────────────────────────────────────────
    const flowGroup = document.createElement('div');
    flowGroup.dataset['flowControls'] = '';
    const flowStrengthSlider = buildSlider({
      value: flowStrength, min: 0, max: 1, step: 0.05,
      format: (v) => v.toFixed(2),
      onChange: (v) => { flowStrength = v; emit(); },
    });
    flowStrengthSlider.dataset['flowStrength'] = '';
    const flowScaleSlider = buildSlider({
      value: flowScale, min: 0.5, max: 32, step: 0.5,
      format: (v) => v.toFixed(1),
      onChange: (v) => { flowScale = v; emit(); },
    });
    flowScaleSlider.dataset['flowScale'] = '';
    flowGroup.append(buildRow('Strength', flowStrengthSlider), buildRow('Scale', flowScaleSlider));
    host.appendChild(flowGroup);

    // ── trap controls (#460) ───────────────────────────────────────────────
    const trapGroup = document.createElement('div');
    trapGroup.dataset['trapControls'] = '';

    const trapKind = buildDropdown<TrapConfig['kind']>({
      value: trap.kind,
      options: [{ value: 'point', label: 'Point' }, { value: 'circle', label: 'Circle' }, { value: 'line', label: 'Line' }],
      onChange: (v) => { trap.kind = v; emit(); },
    });
    trapKind.dataset['trapKind'] = '';

    const trapFalloff = buildDropdown<TrapConfig['mode']>({
      value: trap.mode,
      options: [{ value: 'glow', label: 'Glow' }, { value: 'rings', label: 'Rings' }],
      onChange: (v) => { trap.mode = v; emit(); },
    });
    trapFalloff.dataset['trapMode'] = '';

    const cx = buildNumberInput({ value: trap.cx, kind: 'position', step: 0.05, precision: 2, onChange: (n) => { trap.cx = n; emit(); } });
    cx.el.dataset['trapCx'] = '';
    const cy = buildNumberInput({ value: trap.cy, kind: 'position', step: 0.05, precision: 2, onChange: (n) => { trap.cy = n; emit(); } });
    cy.el.dataset['trapCy'] = '';
    const radius = buildNumberInput({ value: trap.radius, kind: 'generic', min: 0.01, step: 0.05, precision: 2, onChange: (n) => { trap.radius = n; emit(); } });
    radius.el.dataset['trapRadius'] = '';
    const angle = buildNumberInput({ value: trap.angle, kind: 'rotation', step: 5, precision: 0, onChange: (n) => { trap.angle = n; emit(); } });
    angle.el.dataset['trapAngle'] = '';
    const falloff = buildNumberInput({ value: trap.falloff, kind: 'generic', min: 0, step: 0.25, precision: 2, onChange: (n) => { trap.falloff = n; emit(); } });
    falloff.el.dataset['trapFalloff'] = '';
    const freq = buildNumberInput({ value: trap.freq, kind: 'generic', min: 0.1, step: 0.5, precision: 1, onChange: (n) => { trap.freq = n; emit(); } });
    freq.el.dataset['trapFreq'] = '';
    const strengthSlider = buildSlider({
      value: trap.strength, min: 0, max: 1, step: 0.05,
      format: (v) => v.toFixed(2),
      onChange: (v) => { trap.strength = v; emit(); },
    });
    strengthSlider.dataset['trapStrength'] = '';

    const shapeRow = buildRow('Shape', trapKind);
    const falloffModeRow = buildRow('Falloff', trapFalloff);
    const centerRow = buildRow('Center', buildPair(cx.el, '·', cy.el));
    const radiusRow = buildRow('Radius', radius.el);
    const angleRow = buildRow('Angle', angle.el);
    const falloffRow = buildRow('Falloff amt', falloff.el);
    const freqRow = buildRow('Frequency', freq.el);
    const strengthRow = buildRow('Strength', strengthSlider);
    trapGroup.append(shapeRow, falloffModeRow, centerRow, radiusRow, angleRow, falloffRow, freqRow, strengthRow);
    host.appendChild(trapGroup);

    // buildRow sets an INLINE `display:grid`, which beats the `[hidden]` UA
    // rule — so toggle the per-row display directly (grid|none). The group divs
    // have no inline display, so `.hidden` works for those.
    const showRow = (row: HTMLElement, show: boolean): void => {
      row.style.display = show ? 'grid' : 'none';
    };
    function paint(): void {
      flowGroup.hidden = mode !== 'flow';
      trapGroup.hidden = mode !== 'trap-distance';
      const isCircle = trap.kind === 'circle';
      const isLine = trap.kind === 'line';
      const isRings = trap.mode === 'rings';
      showRow(radiusRow, isCircle);
      showRow(angleRow, isLine);
      showRow(falloffRow, !isRings);  // glow falloff amount
      showRow(freqRow, isRings);
    }
    paint();
  },
};
