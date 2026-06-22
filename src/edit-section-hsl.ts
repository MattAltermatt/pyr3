import { type EditState } from './edit-state';
import { buildRow, buildSlider, buildButton } from './edit-primitives';
import { COLORS } from './ui-tokens';

export function createHslSection(
  state: EditState,
  onChange: (path: string) => void,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'pyr3-edit-section-body';

  const help = document.createElement('div');
  help.style.padding = '8px 12px';
  help.style.marginBottom = '12px';
  help.style.fontSize = '12px';
  help.style.color = COLORS.text.muted;
  help.style.lineHeight = '1.4';
  help.style.background = COLORS.bg.info;
  help.style.border = `1px solid ${COLORS.border}`;
  help.style.borderRadius = '4px';
  help.textContent = 'Global post-processing color filter. Applies instantly over the final image, unlike Palette Hue which alters the base colors during the slow iteration pass.';
  container.appendChild(help);

  function getAdjust() {
    return state.genome.hslAdjust ?? { hue: 0, sat: 100, light: 0 };
  }
  function setAdjust(key: 'hue' | 'sat' | 'light', val: number) {
    if (!state.genome.hslAdjust) {
      state.genome.hslAdjust = { hue: 0, sat: 100, light: 0 };
    }
    state.genome.hslAdjust[key] = val;
    onChange(`hslAdjust.${key}`);
  }

  // Hue
  const hueSlider = buildSlider({
    value: getAdjust().hue,
    min: -180,
    max: 180,
    step: 1,
    format: (v) => `${Math.round(v)}°`,
    onChange: (v) => setAdjust('hue', v),
  });
  const hueRow = buildRow('Hue Shift', hueSlider);
  hueRow.title = "Rotates the hue of the final image pixels globally.";
  container.appendChild(hueRow);

  // Saturation
  const satSlider = buildSlider({
    value: getAdjust().sat,
    min: 0,
    max: 200,
    step: 1,
    format: (v) => `${Math.round(v)}%`,
    onChange: (v) => setAdjust('sat', v),
  });
  const satRow = buildRow('Saturation', satSlider);
  satRow.title = "Multiplies the saturation of the final image. 100% is neutral.";
  container.appendChild(satRow);

  // Lightness
  const lightSlider = buildSlider({
    value: getAdjust().light,
    min: -100,
    max: 100,
    step: 1,
    format: (v) => `${Math.round(v)}%`,
    onChange: (v) => setAdjust('light', v),
  });
  const lightRow = buildRow('Lightness', lightSlider);
  lightRow.title = "Adds or subtracts overall lightness post-tonemap. 0% is neutral.";
  container.appendChild(lightRow);

  // Reset
  const resetBtn = buildButton({
    label: 'Reset HSL',
    variant: 'plain',
    onClick: () => {
      state.genome.hslAdjust = undefined;
      onChange('hslAdjust');
      // buildSlider captures its initial value and exposes no setValue, so the
      // cleared adjustment can't be pushed back into the existing sliders. HSL
      // is fast-lane and doesn't remount on its own — fire a rebuild-lane change
      // to force a full remount, which rebuilds the sliders from the reset state.
      onChange('rebuild');
    },
  });
  container.appendChild(buildRow('', resetBtn));

  return container;
}

export const hslSection = {
  key: 'hsl' as const,
  lens: 'color' as const,
  title: 'HSL Adjust',
  build: (host: HTMLElement, state: EditState, onChange: (path: string) => void): void => {
    host.appendChild(createHslSection(state, onChange));
  },
};
