// pyr3 — /v1/edit viewport section.
//
// Four number inputs (scale, cx, cy, rotate) each paired with ◀/▶ stepper
// buttons. Click = ±1, shift-click = ±10, ctrl-click = ±0.1 (matches the
// evolve viewport-card UX).
//
// `rotate` is optional on the Genome — we display 0 when undefined and only
// write back to state when the value is non-zero (cleaner JSON round-trip:
// the field stays absent for "no rotation" flames).
//
// onChange paths (slow lane per pathLane in src/edit-state.ts):
//   - scale  → onChange('scale')
//   - cx     → onChange('cx')
//   - cy     → onChange('cy')
//   - rotate → onChange('rotate')

import { type SectionMount } from './edit-ui';
import { type EditState } from './edit-state';

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

/** Compute the stepper delta from a MouseEvent's modifier keys.
 *  shift = ±10 · ctrl/meta = ±0.1 · plain = ±1. `direction` is +1 or -1. */
export function stepperDelta(ev: MouseEvent, direction: 1 | -1): number {
  let magnitude = 1;
  if (ev.shiftKey) magnitude = 10;
  else if (ev.ctrlKey || ev.metaKey) magnitude = 0.1;
  return magnitude * direction;
}

export const viewportSection: SectionMount = {
  key: 'viewport',
  title: '📐 VIEWPORT',
  build(host, state, onChange) {
    host.classList.add('pyr3-edit-section-viewport');

    for (const spec of FIELDS) {
      const row = document.createElement('div');
      row.className = `pyr3-edit-viewport-row pyr3-edit-viewport-${spec.key}`;
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '4px';
      row.style.marginBottom = '4px';

      const label = document.createElement('span');
      label.textContent = spec.label;
      label.className = 'pyr3-edit-viewport-label';
      label.style.width = '54px';
      label.style.fontSize = '11px';
      label.style.color = 'var(--text-dim, #888)';

      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = `pyr3-edit-viewport-stepper pyr3-edit-viewport-${spec.key}-prev`;
      prevBtn.textContent = '◀';
      prevBtn.title = 'click: -1 · shift: -10 · ctrl: -0.1';

      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.className = `pyr3-edit-viewport-input pyr3-edit-viewport-${spec.key}-input`;
      input.style.flex = '1 1 auto';
      input.style.minWidth = '0';
      input.value = String(spec.read(state));

      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = `pyr3-edit-viewport-stepper pyr3-edit-viewport-${spec.key}-next`;
      nextBtn.textContent = '▶';
      nextBtn.title = 'click: +1 · shift: +10 · ctrl: +0.1';

      row.append(label, prevBtn, input, nextBtn);
      host.appendChild(row);

      function commit(next: number): void {
        if (!Number.isFinite(next)) return;
        spec.write(state, next);
        // Keep the input synced (stepper writes don't trip an `input` event,
        // and we round to 6 decimals to avoid showing 0.30000000000000004).
        const rounded = Math.round(next * 1e6) / 1e6;
        input.value = String(rounded);
        onChange(spec.key);
      }

      input.addEventListener('input', () => {
        const n = Number(input.value);
        if (!Number.isFinite(n)) return; // tolerate transient blank / `-` while typing
        spec.write(state, n);
        onChange(spec.key);
      });

      prevBtn.addEventListener('click', (ev) => {
        commit(spec.read(state) + stepperDelta(ev as MouseEvent, -1));
      });
      nextBtn.addEventListener('click', (ev) => {
        commit(spec.read(state) + stepperDelta(ev as MouseEvent, 1));
      });
    }
  },
};
