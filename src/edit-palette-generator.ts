// pyr3 — "✨ Generate ramp" control panel (#267, #358). Lives inside the Palette
// section of the Color lens. Builds a palette procedurally via the pure
// generateRamp(). Every setting change is a LIVE, undo-able edit: it mutates
// state.genome.palette and routes through onChange('palette') — the editor's
// normal debounced-history path — so each gesture becomes one Cmd/Ctrl+Z step,
// exactly like every other control in the panel. No Apply/Cancel ritual; Undo
// is the revert.
import { type EditState } from './edit-state';
import { buildRow, buildSlider, buildButton, buildToggle } from './edit-primitives';
import { scrubbyInput } from './edit-scrubby-input';
import { paletteFromStops } from './palette';
import { generateRamp, seedToHue, defaultRampMeta, type RampParams } from './palette-generate';

export function mountPaletteGenerator(
  host: HTMLElement,
  state: EditState,
  onChange: (path: string) => void,
  /** Called after the generator mutates state.genome.palette so the host palette
   *  section can repaint its ribbon + chip + launcher (#358). */
  onPaletteChange?: () => void,
): void {
  // Initialize controls from the current palette's generator provenance if it
  // was made here — so after undo/redo (which restores palette.gen via history)
  // the controls re-sync to the restored palette instead of snapping to defaults.
  const prior = state.genome.palette.gen ?? defaultRampMeta();
  let seed = prior.seed;
  const params: RampParams = {
    mode: prior.mode, hue: prior.hue, chroma: prior.chroma, lightness: prior.lightness,
    lightFrom: prior.lightFrom, lightTo: prior.lightTo, loops: prior.loops,
    direction: prior.direction, stops: prior.stops,
  };

  const controls = document.createElement('div');

  // Apply the current params live + commit as a normal, undo-able edit. The
  // editor debounces history (one entry per gesture), so a slider drag collapses
  // to a single Cmd/Ctrl+Z step rather than spamming the stack. There is NO
  // separate in-generator preview strip — the generator REPLACES the palette
  // live, so the PALETTE section ribbon above is the single live preview (#358).
  function commit(): void {
    const stops = generateRamp(params);
    // Stamp generator provenance onto the palette so undo/redo restores the
    // control values too (gen rides the history snapshot; editor-only — not
    // serialized). #358
    state.genome.palette = { ...paletteFromStops('generated', stops), gen: { ...params, seed } };
    onPaletteChange?.();
    onChange('palette');
  }

  function renderControls(): void {
    controls.replaceChildren();

    // Mode: Rainbow (toggle off) / Shades (toggle on)
    const modeToggle = buildToggle({
      value: params.mode === 'shades',
      onChange: (on) => { params.mode = on ? 'shades' : 'rainbow'; renderControls(); commit(); },
    });
    controls.appendChild(buildRow('Shades mode', modeToggle));

    // Hue (both modes) — bounded slider 0..360
    const hueSlider = buildSlider({
      value: params.hue, min: 0, max: 360, step: 1,
      format: (v) => `${Math.round(v)}°`,
      onChange: (v) => { params.hue = v; commit(); },
    });
    controls.appendChild(buildRow(params.mode === 'shades' ? 'Hue' : 'Start hue', hueSlider));

    // Chroma (both) — bounded 0..1
    const chromaSlider = buildSlider({
      value: params.chroma, min: 0, max: 1, step: 0.01,
      format: (v) => v.toFixed(2),
      onChange: (v) => { params.chroma = v; commit(); },
    });
    controls.appendChild(buildRow('Chroma', chromaSlider));

    if (params.mode === 'rainbow') {
      const lightSlider = buildSlider({
        value: params.lightness, min: 0, max: 1, step: 0.01,
        format: (v) => v.toFixed(2),
        onChange: (v) => { params.lightness = v; commit(); },
      });
      controls.appendChild(buildRow('Lightness', lightSlider));

      const loops = scrubbyInput({
        value: params.loops, kind: 'generic', minStep: 1, min: 1, max: 12,
        format: (v) => String(Math.round(v)), ariaLabel: 'loops',
        onInput: (v) => { params.loops = Math.max(1, Math.round(v)); commit(); },
      });
      controls.appendChild(buildRow('Loops', loops.el));

      const dirToggle = buildToggle({
        value: params.direction === -1,
        onChange: (on) => { params.direction = on ? -1 : 1; commit(); },
      });
      controls.appendChild(buildRow('Reverse (ccw)', dirToggle));
    } else {
      const fromSlider = buildSlider({
        value: params.lightFrom, min: 0, max: 1, step: 0.01,
        format: (v) => v.toFixed(2),
        onChange: (v) => { params.lightFrom = v; commit(); },
      });
      controls.appendChild(buildRow('Dark end', fromSlider));
      const toSlider = buildSlider({
        value: params.lightTo, min: 0, max: 1, step: 0.01,
        format: (v) => v.toFixed(2),
        onChange: (v) => { params.lightTo = v; commit(); },
      });
      controls.appendChild(buildRow('Light end', toSlider));
    }

    // Seed scrubby + 🎲 reroll (sets a reproducible start hue)
    const seedScrubby = scrubbyInput({
      value: seed, kind: 'generic', minStep: 1, min: 0, max: 999999,
      format: (v) => String(Math.round(v)), ariaLabel: 'seed',
      onInput: (v) => { seed = Math.round(v); params.hue = seedToHue(seed); renderControls(); commit(); },
    });
    const dice = buildButton({
      variant: 'plain', label: '🎲',
      onClick: () => {
        seed = (Math.floor((seed * 2654435761 + 40503) % 1000000) + 1) >>> 0;
        params.hue = seedToHue(seed);
        renderControls();
        commit();
      },
    });
    const seedRow = document.createElement('div');
    seedRow.style.display = 'flex';
    seedRow.style.gap = '6px';
    seedRow.append(seedScrubby.el, dice);
    controls.appendChild(buildRow('Seed', seedRow));
  }

  renderControls();
  host.appendChild(controls);
}
