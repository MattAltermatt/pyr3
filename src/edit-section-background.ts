// pyr3 — shared background-color control (#27).
//
// Background is one genome field (`genome.background` = [r,g,b] in 0..1) shown
// in TWO lenses — Output → Tonemap and Color → Palette — so the user can set it
// next to the tone knobs OR judge it against the palette. Both mount points use
// THIS one widget and stay in sync via `state.backgroundListeners`: whichever
// instance the user edits notifies the other to refresh its swatch (no onChange
// re-fire, so there's no feedback loop).
//
// Preserves the #351 fix: the native <input type="color"> is a full-size,
// interactable, transparent overlay ON TOP of the visible swatch (a programmatic
// .click() on a hidden input does NOT reliably open the OS picker in Chrome).

import { type EditState } from './edit-state';
import { buildColorSwatch } from './edit-primitives';
import { hexToRgb01, rgb01ToHex } from './edit-section-global';

/** Build a background-color control. Returns the control element (to place in a
 *  row) plus a disposer that unregisters its mirror listener (call on teardown,
 *  #300). */
export function buildBackgroundControl(
  state: EditState,
  onChange: (path: string) => void,
): { el: HTMLElement; dispose: () => void } {
  const initialHex = rgb01ToHex(state.genome.background ?? [0, 0, 0]);

  // #351 — full-size transparent overlay input catches the click directly.
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'pyr3-edit-color';
  colorInput.value = initialHex;
  colorInput.style.position = 'absolute';
  colorInput.style.inset = '0';
  colorInput.style.width = '100%';
  colorInput.style.height = '100%';
  colorInput.style.margin = '0';
  colorInput.style.padding = '0';
  colorInput.style.border = 'none';
  colorInput.style.opacity = '0';
  colorInput.style.cursor = 'pointer';

  const swatch = buildColorSwatch({ color: initialHex, onClick: () => colorInput.click() });
  swatch.style.height = '22px';
  swatch.style.minHeight = '22px';
  swatch.style.pointerEvents = 'none'; // let the overlaid input receive clicks

  colorInput.addEventListener('input', () => {
    const rgb = hexToRgb01(colorInput.value);
    state.genome.background = rgb;
    swatch.style.background = colorInput.value;
    // Mirror to the other lens's control(s), then notify the host to re-render.
    for (const l of state.backgroundListeners ?? []) l(rgb);
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

  // Mirror listener — refresh THIS control when another instance edits the
  // shared field. Does NOT call onChange (the editing instance already did).
  const listener = (rgb: readonly [number, number, number]): void => {
    const hex = rgb01ToHex(rgb);
    colorInput.value = hex;
    swatch.style.background = hex;
  };
  (state.backgroundListeners ??= []).push(listener);
  const dispose = (): void => {
    const arr = state.backgroundListeners;
    if (arr) {
      const i = arr.indexOf(listener);
      if (i >= 0) arr.splice(i, 1);
    }
  };

  return { el: ctrlWrap, dispose };
}
