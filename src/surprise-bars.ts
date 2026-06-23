// pyr3 — Surprise Wall generation settings bars (#433). SEAM_EXEMPT.
//
// Replaces the old `⚙ Settings` popover (surprise-settings-panel.ts, retired in
// #433). The generator knobs are surfaced onto two always-visible labelled
// bars — GENERATE (count / thumbnail / xforms / blend) and VARIATIONS
// (preferred picker + bias/only) — each carrying its own SCOPED reset:
//   - GENERATE ↺ Reset → resetGeneration() (count/thumbnail/xforms/blend only)
//   - VARIATIONS ↺ Reset → resetVariations() (preferred/bias-only only)
// The settings-history undo/redo is gone; the wall reroll undo/redo lives in
// the ACTIONS bar (built by surprise-mount.ts). Built with createElement/
// textContent only — NEVER innerHTML (mirrors edit-compose-menu.ts).
//
// Controls (each carries a stable `data-role` for tests + the wall mount):
//   count-fill / count-set radios · set-n number · density-s/m/l buttons ·
//   xform-min / xform-max · blend-min / blend-max · pick-preferred ·
//   preferred-chips · mode-bias / mode-only radios · reset-generation ·
//   reset-variations.

import { openVariationPicker } from './edit-variation-picker';
import { VARIATION_NAMES } from './variations';
import { type SurpriseSettings } from './surprise-prefs';

export interface SurpriseBarsCallbacks {
  getSettings: () => SurpriseSettings;
  onChange: (next: SurpriseSettings) => void;  // fired on any control edit
  onResetGeneration: () => void;                // GENERATE bar ↺ Reset
  onResetVariations: () => void;                // VARIATIONS bar ↺ Reset
}

export interface SurpriseBarsHandle {
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

export function mountSurpriseBars(
  host: HTMLElement,
  cb: SurpriseBarsCallbacks,
): SurpriseBarsHandle {
  const root = document.createElement('div');
  root.className = 'pyr3-surprise-bars-host';

  // ── shared builders ────────────────────────────────────────────────────
  function makeBar(barKey: string, labelText: string): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'pyr3-surprise-bar';
    bar.dataset.bar = barKey;
    const lab = document.createElement('span');
    lab.className = 'pyr3-surprise-bar-label';
    lab.textContent = labelText;
    bar.appendChild(lab);
    return bar;
  }
  function fieldLabel(text: string): HTMLElement {
    const s = document.createElement('span');
    s.className = 'pyr3-surprise-bar-field';
    s.textContent = text;
    return s;
  }
  function numInput(role: string, value: number): HTMLInputElement {
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = '1'; inp.step = '1';
    inp.dataset.role = role;
    inp.value = String(value);
    inp.className = 'pyr3-surprise-bar-num';
    return inp;
  }
  function dash(): HTMLElement {
    const d = document.createElement('span');
    d.className = 'pyr3-surprise-bar-dash'; d.textContent = '–';
    return d;
  }
  function spacer(): HTMLElement {
    const s = document.createElement('span');
    s.className = 'pyr3-surprise-bar-spacer';
    return s;
  }
  function resetButton(role: string, title: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.role = role;
    b.className = 'pyr3-surprise-bar-reset';
    b.textContent = '↺ Reset'; b.title = title;
    return b;
  }

  // ══ GENERATE bar ════════════════════════════════════════════════════════
  const genBar = makeBar('generate', 'Generate');

  // count mode (fill / set) + set N
  genBar.appendChild(fieldLabel('Count'));
  const fillRadio = document.createElement('input');
  fillRadio.type = 'radio'; fillRadio.name = 'pyr3-surprise-count';
  fillRadio.dataset.role = 'count-fill';
  const fillLabel = document.createElement('label');
  fillLabel.className = 'pyr3-surprise-bar-radio';
  fillLabel.append(fillRadio, document.createTextNode(' Fill'));

  const setRadio = document.createElement('input');
  setRadio.type = 'radio'; setRadio.name = 'pyr3-surprise-count';
  setRadio.dataset.role = 'count-set';
  const setLabel = document.createElement('label');
  setLabel.className = 'pyr3-surprise-bar-radio';
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
  genBar.append(fillLabel, setLabel, setN);

  // thumbnail size (S / M / L)
  genBar.appendChild(fieldLabel('Thumb'));
  const densityBtns = new Map<SurpriseSettings['density'], HTMLButtonElement>();
  const densityGroup = document.createElement('span');
  densityGroup.className = 'pyr3-surprise-bar-seg';
  for (const d of DENSITIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.role = `density-${d.key}`;
    btn.dataset.density = d.key;
    btn.textContent = d.label;
    btn.className = 'pyr3-surprise-bar-density';
    btn.addEventListener('click', () => cb.onChange({ ...cb.getSettings(), density: d.key }));
    densityBtns.set(d.key, btn);
    densityGroup.appendChild(btn);
  }
  genBar.appendChild(densityGroup);

  // # xforms range
  genBar.appendChild(fieldLabel('Xforms'));
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
  genBar.append(xformMin, dash(), xformMax);

  // blend / xform range
  genBar.appendChild(fieldLabel('Blend'));
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
  genBar.append(blendMin, dash(), blendMax);

  genBar.appendChild(spacer());
  const genReset = resetButton('reset-generation',
    'Reset generation knobs only (count / thumbnail / xforms / blend)');
  genReset.addEventListener('click', () => cb.onResetGeneration());
  genBar.appendChild(genReset);

  // ══ VARIATIONS bar ══════════════════════════════════════════════════════
  const varBar = makeBar('variations', 'Variations');

  varBar.appendChild(fieldLabel('Preferred'));
  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.dataset.role = 'pick-preferred';
  pickBtn.textContent = 'Choose…';
  pickBtn.className = 'pyr3-surprise-bar-pick';
  const prefCount = document.createElement('span');
  prefCount.className = 'pyr3-surprise-bar-pref-count';
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
  varBar.append(pickBtn, prefCount);

  // Selected preferred variations as removable chips. (#surprise-v2)
  const prefChips = document.createElement('div');
  prefChips.className = 'pyr3-surprise-bar-chips';
  prefChips.dataset.role = 'preferred-chips';
  varBar.appendChild(prefChips);

  function renderChips(): void {
    prefChips.replaceChildren();
    for (const idx of cb.getSettings().preferred) {
      const chip = document.createElement('span');
      chip.className = 'pyr3-surprise-bar-chip';
      chip.dataset.vidx = String(idx);
      const name = document.createElement('span');
      name.textContent = VARIATION_NAMES[idx] ?? `#${idx}`;
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'pyr3-surprise-bar-chip-rm';
      rm.textContent = '×'; rm.title = 'Remove';
      rm.addEventListener('click', () => {
        const cur = cb.getSettings();
        cb.onChange({ ...cur, preferred: cur.preferred.filter((i) => i !== idx) });
      });
      chip.append(name, rm);
      prefChips.appendChild(chip);
    }
  }

  // preferred mode (bias / only)
  const biasRadio = document.createElement('input');
  biasRadio.type = 'radio'; biasRadio.name = 'pyr3-surprise-prefmode';
  biasRadio.dataset.role = 'mode-bias';
  const biasLabel = document.createElement('label');
  biasLabel.className = 'pyr3-surprise-bar-radio';
  biasLabel.append(biasRadio, document.createTextNode(' Bias'));

  const onlyRadio = document.createElement('input');
  onlyRadio.type = 'radio'; onlyRadio.name = 'pyr3-surprise-prefmode';
  onlyRadio.dataset.role = 'mode-only';
  const onlyLabel = document.createElement('label');
  onlyLabel.className = 'pyr3-surprise-bar-radio';
  onlyLabel.append(onlyRadio, document.createTextNode(' Only'));

  biasRadio.addEventListener('change', () => {
    if (biasRadio.checked) cb.onChange({ ...cb.getSettings(), preferMode: 'bias' });
  });
  onlyRadio.addEventListener('change', () => {
    if (onlyRadio.checked) cb.onChange({ ...cb.getSettings(), preferMode: 'only' });
  });
  varBar.append(biasLabel, onlyLabel);

  varBar.appendChild(spacer());
  const varReset = resetButton('reset-variations',
    'Reset variation knobs only (preferred / bias-only)');
  varReset.addEventListener('click', () => cb.onResetVariations());
  varBar.appendChild(varReset);

  root.append(genBar, varBar);

  // ── refresh: re-read settings + re-apply every control's display ───────
  function refresh(): void {
    const s = cb.getSettings();
    fillRadio.checked = s.countMode === 'fill';
    setRadio.checked = s.countMode === 'set';
    setN.value = String(s.setN);
    setN.disabled = s.countMode !== 'set';
    for (const [key, btn] of densityBtns) {
      const on = key === s.density;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    xformMin.value = String(s.xformCount[0]);
    xformMax.value = String(s.xformCount[1]);
    blendMin.value = String(s.blendPerXform[0]);
    blendMax.value = String(s.blendPerXform[1]);
    prefCount.textContent = `(${s.preferred.length})`;
    renderChips();
    biasRadio.checked = s.preferMode === 'bias';
    onlyRadio.checked = s.preferMode === 'only';
  }

  host.appendChild(root);
  refresh();

  return {
    refresh,
    destroy(): void { root.remove(); },
  };
}
