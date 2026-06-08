import { type EditState } from './edit-state';
import { buildRow, buildSlider, buildButton } from './edit-primitives';

export function createHslSection(
  state: EditState,
  onChange: (path: string) => void,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'pyr3-edit-section-body';

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
  container.appendChild(buildRow('Hue Shift', hueSlider));

  // Saturation
  const satSlider = buildSlider({
    value: getAdjust().sat,
    min: 0,
    max: 200,
    step: 1,
    format: (v) => `${Math.round(v)}%`,
    onChange: (v) => setAdjust('sat', v),
  });
  container.appendChild(buildRow('Saturation', satSlider));

  // Lightness
  const lightSlider = buildSlider({
    value: getAdjust().light,
    min: -100,
    max: 100,
    step: 1,
    format: (v) => `${Math.round(v)}%`,
    onChange: (v) => setAdjust('light', v),
  });
  container.appendChild(buildRow('Lightness', lightSlider));

  // Reset
  const resetBtn = buildButton({
    label: 'Reset HSL',
    variant: 'plain',
    onClick: () => {
      state.genome.hslAdjust = undefined;
      onChange('hslAdjust');
      // No easy way to push state back into the sliders built by buildSlider
      // because they capture their initial value. The panel will re-mount
      // on rebuild, but hsl is fast lane so it doesn't remount automatically.
      // Wait, we can dispatch a pyr3:refresh-hsl event and handle it inside 
      // the inputs, but buildSlider doesn't expose a setValue.
      // Actually, since we're returning an HTMLElement, we can just replace 
      // the contents or we can trigger a full remount if needed. 
      // If we trigger a rebuild lane, it will remount. Let's do that for reset.
      onChange('rebuild');
    },
  });
  container.appendChild(buildRow('', resetBtn));

  return container;
}

export const hslSection = {
  key: 'hsl' as const,
  title: 'HSL Adjust',
  build: (host: HTMLElement, state: EditState, onChange: (path: string) => void): void => {
    host.appendChild(createHslSection(state, onChange));
  },
};
