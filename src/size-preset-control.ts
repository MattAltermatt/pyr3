// Reusable output-size widget: SIZE_PRESETS dropdown + "Custom" sentinel + W×H
// number inputs, kept in sync. Mirrors render-mode-bar.ts:187-264. DOM is built
// with createElement only (no innerHTML — src/no-innerhtml.test.ts invariant).
import { SIZE_PRESETS } from './load-intent';

export interface SizePresetControlOpts {
  initial: { width: number; height: number };
  onChange(size: { width: number; height: number }): void;
}

export interface SizePresetControlHandle {
  el: HTMLElement;
  getSize(): { width: number; height: number };
  /** Programmatic update — syncs select + inputs WITHOUT firing onChange. */
  setSize(size: { width: number; height: number }): void;
}

function matchPresetValue(size: { width: number; height: number }): string {
  for (const g of SIZE_PRESETS) {
    for (const e of g.items) {
      if (e.w === size.width && e.h === size.height) return `${e.w}x${e.h}`;
    }
  }
  return '__custom__';
}

export function createSizePresetControl(opts: SizePresetControlOpts): SizePresetControlHandle {
  let size = { width: opts.initial.width, height: opts.initial.height };

  const el = document.createElement('div');
  Object.assign(el.style, { display: 'flex', alignItems: 'center', gap: '6px' });

  const select = document.createElement('select');
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.textContent = 'Custom';
  select.appendChild(customOpt);
  for (const g of SIZE_PRESETS) {
    const og = document.createElement('optgroup');
    og.label = g.group;
    for (const e of g.items) {
      const o = document.createElement('option');
      o.value = `${e.w}x${e.h}`;
      o.textContent = e.label;
      og.appendChild(o);
    }
    select.appendChild(og);
  }

  const wIn = document.createElement('input');
  wIn.type = 'number';
  wIn.min = '1';
  wIn.dataset['sizeW'] = '';
  wIn.style.width = '72px';
  const hIn = document.createElement('input');
  hIn.type = 'number';
  hIn.min = '1';
  hIn.dataset['sizeH'] = '';
  hIn.style.width = '72px';
  const times = document.createElement('span');
  times.textContent = '×';

  el.append(select, wIn, times, hIn);

  function syncInputs(): void {
    if (document.activeElement !== wIn) wIn.value = String(size.width);
    if (document.activeElement !== hIn) hIn.value = String(size.height);
    select.value = matchPresetValue(size);
  }

  select.addEventListener('change', () => {
    if (select.value === '__custom__') return;
    const m = /^(\d+)x(\d+)$/.exec(select.value);
    if (!m) return;
    size = { width: Number(m[1]), height: Number(m[2]) };
    syncInputs();
    opts.onChange({ ...size });
  });

  function onDimInput(): void {
    const w = Math.max(1, Math.floor(Number(wIn.value) || 1));
    const h = Math.max(1, Math.floor(Number(hIn.value) || 1));
    size = { width: w, height: h };
    select.value = matchPresetValue(size);
    opts.onChange({ ...size });
  }
  wIn.addEventListener('input', onDimInput);
  hIn.addEventListener('input', onDimInput);

  syncInputs();

  return {
    el,
    getSize: () => ({ ...size }),
    setSize: (next) => {
      size = { width: next.width, height: next.height };
      syncInputs();
    },
  };
}
