// pyr3 — /v1/edit viewport section.
//
// Four number inputs (scale, cx, cy, rotate) plus a 🎯 fit button at the top.
// Number inputs use the browser's native up/down spinners — no custom ◀/▶
// steppers (those were redundant alongside the built-in spinner UI).
//
// `rotate` is optional on the Genome — we display 0 when undefined and only
// write back to state when the value is non-zero (cleaner JSON round-trip:
// the field stays absent for "no rotation" flames).
//
// 🎯 fit runs a CPU chaos sampler (src/edit-fit-viewport.ts) to compute the
// (cx, cy, scale) that frames the entire flame in the genome's render dims
// (or the preview dims when genome.size is unset). Updates state + inputs
// in one shot; the slow-lane scheduler picks up the three onChange calls
// and coalesces them into one re-iterate.

import { type SectionMount } from './edit-ui';
import { type EditState } from './edit-state';
import { computeFitViewport } from './edit-fit-viewport';

type ViewportField = 'scale' | 'cx' | 'cy' | 'rotate';

interface FieldSpec {
  key: ViewportField;
  label: string;
  read(state: EditState): number;
  write(state: EditState, value: number): void;
}

const FIELDS: readonly FieldSpec[] = [
  {
    key: 'scale',
    label: 'scale',
    read: (s) => s.genome.scale,
    write: (s, v) => { s.genome.scale = v; },
  },
  {
    key: 'cx',
    label: 'cx',
    read: (s) => s.genome.cx,
    write: (s, v) => { s.genome.cx = v; },
  },
  {
    key: 'cy',
    label: 'cy',
    read: (s) => s.genome.cy,
    write: (s, v) => { s.genome.cy = v; },
  },
  {
    key: 'rotate',
    label: 'rotate',
    read: (s) => s.genome.rotate ?? 0,
    // Drop the field back to undefined when the user zeros it — matches the
    // serializer's "absent = no rotation" convention.
    write: (s, v) => {
      if (v === 0) s.genome.rotate = undefined;
      else s.genome.rotate = v;
    },
  },
];

/** Resolve the canvas dims used as the target for fit. Prefers genome.size
 *  (the final render dim — what the user actually cares about framing),
 *  falls back to state.preview when size is unset. */
function fitCanvasDims(state: EditState): { width: number; height: number } {
  const size = state.genome.size;
  if (size && size.width > 0 && size.height > 0) {
    return { width: size.width, height: size.height };
  }
  return { width: state.preview.width, height: state.preview.height };
}

export const viewportSection: SectionMount = {
  key: 'viewport',
  title: '📐 VIEWPORT',
  build(host, state, onChange) {
    host.classList.add('pyr3-edit-section-viewport');

    // Fit button — top of the section. Matches the editor's canonical
    // pyr3-edit-btn style (same as 🖼️ render PNG / 🎲 reroll / 📂 open).
    const fitRow = document.createElement('div');
    fitRow.className = 'pyr3-edit-buttons';
    fitRow.style.marginBottom = '6px';
    const fitBtn = document.createElement('button');
    fitBtn.type = 'button';
    fitBtn.className = 'pyr3-edit-btn pyr3-edit-viewport-fit';
    fitBtn.textContent = '🎯 fit';
    fitBtn.title = 'Move cx / cy / scale so the entire flame fits inside the render area';
    fitRow.appendChild(fitBtn);
    host.appendChild(fitRow);

    // Track each row's input so the fit button can sync displayed values
    // after rewriting state.
    const inputs: Partial<Record<ViewportField, HTMLInputElement>> = {};

    for (const spec of FIELDS) {
      const row = document.createElement('div');
      row.className = `pyr3-edit-viewport-row pyr3-edit-viewport-${spec.key}`;
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';
      row.style.marginBottom = '4px';

      const label = document.createElement('span');
      label.textContent = spec.label;
      label.className = 'pyr3-edit-viewport-label';
      label.style.width = '54px';
      label.style.fontSize = '11px';
      label.style.color = 'var(--text-dim, #888)';

      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.className = `pyr3-edit-viewport-input pyr3-edit-viewport-${spec.key}-input`;
      input.style.flex = '1 1 auto';
      input.style.minWidth = '0';
      input.value = String(spec.read(state));
      inputs[spec.key] = input;

      row.append(label, input);
      host.appendChild(row);

      input.addEventListener('input', () => {
        const n = Number(input.value);
        if (!Number.isFinite(n)) return; // tolerate transient blank / `-` while typing
        spec.write(state, n);
        onChange(spec.key);
      });
    }

    // When the canvas pan/zoom listener (src/edit-canvas-nav.ts) mutates
    // cx/cy/scale outside the panel, the inputs would otherwise show stale
    // values. edit-mount fires 'pyr3:viewport-changed' on panelHost; we
    // listen at document level so the dispatch site doesn't need to know
    // about the panel layout. The listener self-removes once the section's
    // host is detached (next rebuildPanel), so accumulated rerolls don't
    // leak listeners.
    function syncInputsFromState(): void {
      if (!host.isConnected) {
        document.removeEventListener('pyr3:viewport-changed', syncInputsFromState as EventListener);
        return;
      }
      if (inputs.scale) inputs.scale.value = String(Math.round(state.genome.scale * 1e6) / 1e6);
      if (inputs.cx) inputs.cx.value = String(Math.round(state.genome.cx * 1e6) / 1e6);
      if (inputs.cy) inputs.cy.value = String(Math.round(state.genome.cy * 1e6) / 1e6);
      if (inputs.rotate) inputs.rotate.value = String(state.genome.rotate ?? 0);
    }
    document.addEventListener('pyr3:viewport-changed', syncInputsFromState as EventListener);

    fitBtn.addEventListener('click', () => {
      const dims = fitCanvasDims(state);
      const fit = computeFitViewport(state.genome, dims.width, dims.height);
      if (!fit) {
        // No-op for degenerate genomes (empty xforms, all-zero weights,
        // singleton-attractor). Surface a tiny visual nudge so the click
        // doesn't feel ignored. (Guard for happy-dom / test envs which
        // don't implement WAAPI .animate.)
        if (typeof fitBtn.animate === 'function') {
          fitBtn.animate(
            [{ background: '#3a2a2a' }, { background: '' }],
            { duration: 350 },
          );
        }
        return;
      }
      const rounded = (n: number): number => Math.round(n * 1e6) / 1e6;
      state.genome.scale = rounded(fit.scale);
      state.genome.cx = rounded(fit.cx);
      state.genome.cy = rounded(fit.cy);
      if (inputs.scale) inputs.scale.value = String(state.genome.scale);
      if (inputs.cx) inputs.cx.value = String(state.genome.cx);
      if (inputs.cy) inputs.cy.value = String(state.genome.cy);
      // Schedule the slow-lane fire on each path; the lane scheduler dedups
      // them into a single re-iterate.
      onChange('scale');
      onChange('cx');
      onChange('cy');
    });
  },
};
