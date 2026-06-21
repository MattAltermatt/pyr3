// Shared affordance-vocab settings widgets for the /screensaver landing card
// AND the live ⚙ overlay during playback (#355). DRY: both surfaces build the
// same field rows. Dimensions = a dropdown over SIZE_PRESETS; Quality = a
// button-tier group over QUALITY_PRESETS — matching the rest of the app. Output
// section sits LAST in both cards.
import { COLORS } from './ui-tokens';
import { SIZE_PRESETS, QUALITY_PRESETS } from './load-intent';
import { parseSecondsInput, parseNumericInput, type SlideshowPrefs, type AnimationPrefs } from './screensaver-prefs';
import type { InterestLevel } from './screensaver-interest';
import { frameCount } from './screensaver-animation';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function sectionHeader(title: string): HTMLElement {
  const h = el('div', 'pyr3-screensaver-sec');
  h.textContent = title;
  Object.assign(h.style, {
    padding: '9px 14px',
    background: COLORS.bg.info,
    borderLeft: `3px solid ${COLORS.border}`,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    color: COLORS.text.primary,
  });
  return h;
}

function fieldRow(labelText: string, control: HTMLElement): HTMLElement {
  const row = el('div', 'pyr3-screensaver-field');
  Object.assign(row.style, {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '11px 16px', borderBottom: `1px solid ${COLORS.bg.bar}`,
  });
  const label = el('label');
  label.textContent = labelText;
  Object.assign(label.style, { flex: '0 0 168px', fontSize: '13px', color: COLORS.text.primary });
  const ctl = el('div');
  Object.assign(ctl.style, { flex: '1', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' });
  ctl.append(control);
  row.append(label, ctl);
  return row;
}

function helperLine(text: string): HTMLElement {
  const h = el('div', 'pyr3-screensaver-helper');
  h.textContent = text;
  Object.assign(h.style, {
    fontSize: '11px', color: COLORS.text.dim,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    padding: '2px 16px 10px', lineHeight: '1.5',
  });
  return h;
}

function numberBox(value: number, onCommit: (n: number) => void, parse: (s: string) => number | null): HTMLInputElement {
  const inp = el('input', 'pyr3-edit-num');
  inp.type = 'text';
  inp.value = String(value);
  Object.assign(inp.style, {
    background: COLORS.bg.input, border: `1px solid ${COLORS.border}`, borderRadius: '6px',
    color: COLORS.text.primary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12.5px', padding: '5px 9px', width: '90px',
  });
  const commit = (): void => {
    const n = parse(inp.value);
    if (n !== null) { onCommit(n); }
    else { inp.value = String(value); }
  };
  inp.addEventListener('change', commit);
  inp.addEventListener('blur', commit);
  return inp;
}

export function buildDimsDropdown(
  width: number, height: number,
  onChange: (w: number, h: number) => void,
): HTMLSelectElement {
  const sel = el('select', 'pyr3-screensaver-ddl');
  Object.assign(sel.style, {
    background: COLORS.bg.input, border: `1px solid ${COLORS.border}`, borderRadius: '6px',
    color: COLORS.text.primary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12.5px', padding: '6px 10px', cursor: 'pointer',
  });
  let matched = false;
  for (const group of SIZE_PRESETS) {
    const og = el('optgroup');
    og.label = group.group;
    for (const item of group.items) {
      const opt = el('option');
      opt.value = `${item.w}x${item.h}`;
      opt.textContent = `${item.label} — ${item.w}×${item.h}`;
      if (item.w === width && item.h === height) { opt.selected = true; matched = true; }
      og.append(opt);
    }
    sel.append(og);
  }
  // Custom (current dims not in any preset).
  const custom = el('option');
  custom.value = `${width}x${height}`;
  custom.textContent = `Custom — ${width}×${height}`;
  if (!matched) custom.selected = true;
  sel.append(custom);

  sel.addEventListener('change', () => {
    const [w, h] = sel.value.split('x').map(Number);
    if (Number.isFinite(w) && Number.isFinite(h)) onChange(w!, h!);
  });
  return sel;
}

export function buildQualityTiers(q: number, onChange: (q: number) => void): HTMLElement {
  const group = el('div', 'pyr3-screensaver-qgrp');
  Object.assign(group.style, { display: 'inline-flex', gap: '4px' });
  const btns = new Map<number, HTMLButtonElement>();
  const paint = (active: number): void => {
    for (const [val, b] of btns) {
      const on = val === active;
      b.style.background = on ? COLORS.bg.action : COLORS.bg.input;
      b.style.color = on ? COLORS.flame.top : COLORS.text.muted;
      b.style.borderColor = on ? COLORS.flame.mid : COLORS.border;
    }
  };
  for (const tier of QUALITY_PRESETS) {
    const b = el('button');
    b.type = 'button';
    b.textContent = String(tier);
    Object.assign(b.style, {
      border: `1px solid ${COLORS.border}`, borderRadius: '6px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px',
      padding: '5px 11px', cursor: 'pointer',
    });
    b.addEventListener('click', () => { onChange(tier); paint(tier); });
    btns.set(tier, b);
    group.append(b);
  }
  paint(q);
  return group;
}

function interestSeg(level: InterestLevel, onChange: (l: InterestLevel) => void): HTMLElement {
  const seg = el('div', 'pyr3-screensaver-seg');
  Object.assign(seg.style, {
    display: 'inline-flex', border: `1px solid ${COLORS.border}`, borderRadius: '7px', overflow: 'hidden',
  });
  const levels: { v: InterestLevel; label: string }[] = [
    { v: 'off', label: 'Off' }, { v: 'normal', label: 'Normal' }, { v: 'aggressive', label: 'Aggressive' },
  ];
  const btns = new Map<InterestLevel, HTMLButtonElement>();
  const paint = (active: InterestLevel): void => {
    for (const [v, b] of btns) {
      const on = v === active;
      b.style.background = on ? COLORS.bg.action : COLORS.bg.input;
      b.style.color = on ? COLORS.flame.top : COLORS.text.muted;
    }
  };
  for (const { v, label } of levels) {
    const b = el('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset.level = v;
    Object.assign(b.style, {
      border: 'none', borderRight: `1px solid ${COLORS.border}`,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12.5px',
      padding: '5px 12px', cursor: 'pointer',
    });
    b.addEventListener('click', () => { onChange(v); paint(v); });
    btns.set(v, b);
    seg.append(b);
  }
  paint(level);
  return seg;
}

/** Slideshow settings card body. Output section LAST. */
export function buildSlideshowSettings(p: SlideshowPrefs, onChange: (p: SlideshowPrefs) => void): HTMLElement {
  const cur: SlideshowPrefs = { ...p };
  const root = el('div', 'pyr3-screensaver-settings-body');

  root.append(sectionHeader('Pacing & selection'));
  root.append(fieldRow('Dwell per flame', numberBox(cur.dwellSec, (n) => { cur.dwellSec = n; onChange({ ...cur }); }, parseSecondsInput)));
  root.append(fieldRow('Skip boring flames', interestSeg(cur.interest, (l) => { cur.interest = l; onChange({ ...cur }); })));
  root.append(helperLine('Hides dull, washed-out, or near-empty flames before they’re shown. Normal skips the obviously boring · Aggressive keeps only the strongest.'));

  root.append(sectionHeader('Output'));
  root.append(fieldRow('Dimensions', buildDimsDropdown(cur.width, cur.height, (w, h) => { cur.width = w; cur.height = h; onChange({ ...cur }); })));
  root.append(fieldRow('Quality', buildQualityTiers(cur.quality, (q) => { cur.quality = q; onChange({ ...cur }); })));
  return root;
}

/** Animation settings card body. Timeline → Pacing → Output (last). */
export function buildAnimationSettings(
  p: AnimationPrefs,
  onChange: (p: AnimationPrefs) => void,
  onPickFile: () => void,
  fileLabel: () => string,
): HTMLElement {
  const cur: AnimationPrefs = { ...p };
  const root = el('div', 'pyr3-screensaver-settings-body');

  root.append(sectionHeader('Timeline'));
  const chip = el('button', 'pyr3-screensaver-filechip');
  chip.type = 'button';
  const chipLabel = el('span');
  chipLabel.textContent = fileLabel();
  Object.assign(chip.style, {
    display: 'inline-flex', alignItems: 'center', gap: '8px',
    background: COLORS.bg.input, border: `1px solid ${COLORS.border}`, borderRadius: '7px',
    padding: '6px 11px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px', color: COLORS.flame.top, cursor: 'pointer',
  });
  chip.append(document.createTextNode('📂 '), chipLabel);
  chip.addEventListener('click', onPickFile);
  // expose label updater so the host can refresh after a pick
  (chip as HTMLElement & { _setLabel?: (s: string) => void })._setLabel = (s) => { chipLabel.textContent = s; };
  root.append(fieldRow('Source', chip));

  root.append(sectionHeader('Pacing'));
  const framesReadout = el('span');
  Object.assign(framesReadout.style, { fontSize: '11px', color: COLORS.text.dim, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' });
  const refreshFrames = (): void => {
    framesReadout.textContent = `→ ${frameCount(cur.durationSec, cur.updateIntervalSec)} frames${cur.loop ? ', loops' : ''}`;
  };
  refreshFrames();
  // "Animate for" is shown in MINUTES (durationSec is stored in seconds).
  root.append(fieldRow('Animate for (min)', numberBox(Math.round(cur.durationSec / 60), (min) => { cur.durationSec = min * 60; refreshFrames(); onChange({ ...cur }); }, parseNumericInput)));
  const updateRow = fieldRow('Update every (s)', numberBox(cur.updateIntervalSec, (n) => { cur.updateIntervalSec = n; refreshFrames(); onChange({ ...cur }); }, parseSecondsInput));
  updateRow.querySelector('div')!.append(framesReadout);
  root.append(updateRow);

  root.append(sectionHeader('Output'));
  root.append(fieldRow('Dimensions', buildDimsDropdown(cur.width, cur.height, (w, h) => { cur.width = w; cur.height = h; onChange({ ...cur }); })));
  root.append(fieldRow('Quality', buildQualityTiers(cur.quality, (q) => { cur.quality = q; onChange({ ...cur }); })));
  return root;
}
