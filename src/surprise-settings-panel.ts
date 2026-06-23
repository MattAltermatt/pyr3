// pyr3 — Surprise Wall generation settings panel (#surprise-v2). SEAM_EXEMPT.
//
// A presentational widget for the Surprise Wall generator knobs. It reads the
// current SurpriseSettings via a getter and emits the FULL updated object
// through `onChange` on every control edit — no persistence, no generation
// here (those live in the prefs layer + the wall mount). Built with
// createElement/textContent only — NEVER innerHTML (mirrors edit-compose-menu.ts).
//
// Controls (each carries a stable `data-role` for tests + the wall mount):
//   count-fill / count-set radios · set-n number · density S/M/L buttons ·
//   xform-min / xform-max · blend-min / blend-max · pick-preferred (opens the
//   multi-select variation picker) · mode-bias / mode-only radios · reset ·
//   settings-undo / settings-redo.

import { openVariationPicker } from './edit-variation-picker';
import { VARIATION_NAMES } from './variations';
import { type SurpriseSettings } from './surprise-prefs';

export interface SurpriseSettingsPanelCallbacks {
  getSettings: () => SurpriseSettings;
  onChange: (next: SurpriseSettings) => void;  // fired on any control edit
  onReset: () => void;                          // "reset to default" button
  onUndo: () => void;                           // settings-history ↶
  onRedo: () => void;                           // settings-history ↷
  canUndo: () => boolean;                       // enable/disable ↶
  canRedo: () => boolean;                       // enable/disable ↷
}

export interface SurpriseSettingsPanelHandle {
  refresh(): void;
  destroy(): void;
}

/** Clamp to an integer >= 1, falling back to `fallback` on a non-finite input. */
function clampInt(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(1, Math.round(n)) : fallback;
}

const DENSITIES: Array<{ key: SurpriseSettings['density']; label: string }> = [
  { key: 's', label: 'S' },
  { key: 'm', label: 'M' },
  { key: 'l', label: 'L' },
];

export function mountSurpriseSettingsPanel(
  host: HTMLElement,
  cb: SurpriseSettingsPanelCallbacks,
): SurpriseSettingsPanelHandle {
  const root = document.createElement('div');
  root.className = 'pyr3-surprise-settings';

  // ── helpers ────────────────────────────────────────────────────────────
  function fieldRow(labelText: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pyr3-surprise-settings-row';
    const lab = document.createElement('span');
    lab.className = 'pyr3-surprise-settings-label';
    lab.textContent = labelText;
    row.appendChild(lab);
    return row;
  }

  function numInput(role: string, value: number): HTMLInputElement {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '1';
    inp.step = '1';
    inp.dataset.role = role;
    inp.value = String(value);
    inp.className = 'pyr3-surprise-settings-num';
    return inp;
  }

  // ── count mode (fill / set) + set N ────────────────────────────────────
  const countRow = fieldRow('Count');
  const fillRadio = document.createElement('input');
  fillRadio.type = 'radio';
  fillRadio.name = 'pyr3-surprise-count';
  fillRadio.dataset.role = 'count-fill';
  const fillLabel = document.createElement('label');
  fillLabel.append(fillRadio, document.createTextNode(' Fill'));

  const setRadio = document.createElement('input');
  setRadio.type = 'radio';
  setRadio.name = 'pyr3-surprise-count';
  setRadio.dataset.role = 'count-set';
  const setLabel = document.createElement('label');
  setLabel.append(setRadio, document.createTextNode(' Set'));

  const setN = numInput('set-n', cb.getSettings().setN);

  fillRadio.addEventListener('change', () => {
    if (fillRadio.checked) cb.onChange({ ...cb.getSettings(), countMode: 'fill' });
  });
  setRadio.addEventListener('change', () => {
    if (setRadio.checked) cb.onChange({ ...cb.getSettings(), countMode: 'set' });
  });
  setN.addEventListener('change', () => {
    const n = clampInt(setN.value, cb.getSettings().setN);
    setN.value = String(n);
    cb.onChange({ ...cb.getSettings(), setN: n });
  });
  countRow.append(fillLabel, setLabel, setN);
  root.appendChild(countRow);

  // ── thumbnail size (S / M / L) ─────────────────────────────────────────
  const densityRow = fieldRow('Thumbnail size');
  const densityBtns = new Map<SurpriseSettings['density'], HTMLButtonElement>();
  for (const d of DENSITIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.role = 'density';
    btn.dataset.density = d.key;
    btn.textContent = d.label;
    btn.className = 'pyr3-surprise-settings-density';
    btn.addEventListener('click', () => {
      cb.onChange({ ...cb.getSettings(), density: d.key });
    });
    densityBtns.set(d.key, btn);
    densityRow.appendChild(btn);
  }
  root.appendChild(densityRow);

  // ── # xforms range ─────────────────────────────────────────────────────
  const xformRow = fieldRow('# xforms');
  const xformMin = numInput('xform-min', cb.getSettings().xformCount[0]);
  const xformMax = numInput('xform-max', cb.getSettings().xformCount[1]);
  xformMin.addEventListener('change', () => {
    const cur = cb.getSettings();
    const lo = clampInt(xformMin.value, cur.xformCount[0]);
    xformMin.value = String(lo);
    cb.onChange({ ...cur, xformCount: [lo, cur.xformCount[1]] });
  });
  xformMax.addEventListener('change', () => {
    const cur = cb.getSettings();
    const hi = clampInt(xformMax.value, cur.xformCount[1]);
    xformMax.value = String(hi);
    cb.onChange({ ...cur, xformCount: [cur.xformCount[0], hi] });
  });
  const xformDash = document.createElement('span');
  xformDash.textContent = '–';
  xformRow.append(xformMin, xformDash, xformMax);
  root.appendChild(xformRow);

  // ── blend / xform range ────────────────────────────────────────────────
  const blendRow = fieldRow('Blend / xform');
  const blendMin = numInput('blend-min', cb.getSettings().blendPerXform[0]);
  const blendMax = numInput('blend-max', cb.getSettings().blendPerXform[1]);
  blendMin.addEventListener('change', () => {
    const cur = cb.getSettings();
    const lo = clampInt(blendMin.value, cur.blendPerXform[0]);
    blendMin.value = String(lo);
    cb.onChange({ ...cur, blendPerXform: [lo, cur.blendPerXform[1]] });
  });
  blendMax.addEventListener('change', () => {
    const cur = cb.getSettings();
    const hi = clampInt(blendMax.value, cur.blendPerXform[1]);
    blendMax.value = String(hi);
    cb.onChange({ ...cur, blendPerXform: [cur.blendPerXform[0], hi] });
  });
  const blendDash = document.createElement('span');
  blendDash.textContent = '–';
  blendRow.append(blendMin, blendDash, blendMax);
  root.appendChild(blendRow);

  // ── preferred variations (multi-select picker) + count ─────────────────
  const prefRow = fieldRow('Preferred');
  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.dataset.role = 'pick-preferred';
  pickBtn.textContent = 'Choose variations…';
  pickBtn.className = 'pyr3-surprise-settings-pick';
  const prefCount = document.createElement('span');
  prefCount.className = 'pyr3-surprise-settings-pref-count';
  pickBtn.addEventListener('click', () => {
    openVariationPicker({
      mode: 'multi',
      selected: new Set(cb.getSettings().preferred),
      onChange: (set) => cb.onChange({
        ...cb.getSettings(),
        preferred: [...set].sort((a, b) => a - b),
      }),
      onClose() { /* nothing to clean up; refresh is host-driven */ },
    });
  });
  prefRow.append(pickBtn, prefCount);
  root.appendChild(prefRow);

  // Selected preferred variations as removable chips. (#surprise-v2)
  const prefChips = document.createElement('div');
  prefChips.className = 'pyr3-surprise-settings-chips';
  prefChips.dataset.role = 'preferred-chips';
  root.appendChild(prefChips);

  function renderChips(): void {
    prefChips.replaceChildren();
    const pref = cb.getSettings().preferred;
    for (const idx of pref) {
      const chip = document.createElement('span');
      chip.className = 'pyr3-surprise-settings-chip';
      chip.dataset.vidx = String(idx);
      const name = document.createElement('span');
      name.textContent = VARIATION_NAMES[idx] ?? `#${idx}`;
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'pyr3-surprise-settings-chip-rm';
      rm.textContent = '×'; rm.title = 'Remove';
      rm.addEventListener('click', () => {
        const cur = cb.getSettings();
        cb.onChange({ ...cur, preferred: cur.preferred.filter((i) => i !== idx) });
      });
      chip.append(name, rm);
      prefChips.appendChild(chip);
    }
  }

  // ── preferred mode (bias / only) ───────────────────────────────────────
  const modeRow = fieldRow('Prefer mode');
  const biasRadio = document.createElement('input');
  biasRadio.type = 'radio';
  biasRadio.name = 'pyr3-surprise-prefmode';
  biasRadio.dataset.role = 'mode-bias';
  const biasLabel = document.createElement('label');
  biasLabel.append(biasRadio, document.createTextNode(' Bias'));

  const onlyRadio = document.createElement('input');
  onlyRadio.type = 'radio';
  onlyRadio.name = 'pyr3-surprise-prefmode';
  onlyRadio.dataset.role = 'mode-only';
  const onlyLabel = document.createElement('label');
  onlyLabel.append(onlyRadio, document.createTextNode(' Only'));

  biasRadio.addEventListener('change', () => {
    if (biasRadio.checked) cb.onChange({ ...cb.getSettings(), preferMode: 'bias' });
  });
  onlyRadio.addEventListener('change', () => {
    if (onlyRadio.checked) cb.onChange({ ...cb.getSettings(), preferMode: 'only' });
  });
  modeRow.append(biasLabel, onlyLabel);
  root.appendChild(modeRow);

  // ── actions: reset + settings undo/redo ────────────────────────────────
  const actionsRow = document.createElement('div');
  actionsRow.className = 'pyr3-surprise-settings-actions';

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.dataset.role = 'reset';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', () => cb.onReset());

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.dataset.role = 'settings-undo';
  undoBtn.textContent = '↶';
  undoBtn.title = 'Undo settings change';
  undoBtn.addEventListener('click', () => cb.onUndo());

  const redoBtn = document.createElement('button');
  redoBtn.type = 'button';
  redoBtn.dataset.role = 'settings-redo';
  redoBtn.textContent = '↷';
  redoBtn.title = 'Redo settings change';
  redoBtn.addEventListener('click', () => cb.onRedo());

  actionsRow.append(resetBtn, undoBtn, redoBtn);
  root.appendChild(actionsRow);

  // ── refresh: re-read settings + re-apply every control's display ───────
  function refresh(): void {
    const s = cb.getSettings();
    fillRadio.checked = s.countMode === 'fill';
    setRadio.checked = s.countMode === 'set';
    setN.value = String(s.setN);
    for (const [key, btn] of densityBtns) {
      const on = key === s.density;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    xformMin.value = String(s.xformCount[0]);
    xformMax.value = String(s.xformCount[1]);
    blendMin.value = String(s.blendPerXform[0]);
    blendMax.value = String(s.blendPerXform[1]);
    prefCount.textContent = `(${s.preferred.length} preferred)`;
    renderChips();
    biasRadio.checked = s.preferMode === 'bias';
    onlyRadio.checked = s.preferMode === 'only';
    undoBtn.disabled = !cb.canUndo();
    redoBtn.disabled = !cb.canRedo();
  }

  host.appendChild(root);
  refresh();

  return {
    refresh,
    destroy(): void { root.remove(); },
  };
}
