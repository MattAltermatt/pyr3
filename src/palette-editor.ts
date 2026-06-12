// pyr3 — /v1/gradient stop-bar gradient editor (#115, Model A).
//
// A standalone color-stop gradient widget. The working state IS the genome's
// `Palette` shape ({name, stops, hue?, mode?}); the 256-LUT is derived on
// demand via `bakeLUT` (so the strip preview always matches the GPU render,
// including 'smooth'/'step' interpolation).
//
// Interaction (Model A, mirrors the curve-editor gesture idiom in
// edit-section-curves.ts — plain mouse events, no pointer-capture):
//   - drag a handle      → move its t (clamped to neighbors; endpoints pinned 0/1)
//   - double-click strip → add a stop (color sampled from the gradient there)
//   - select + Delete    → remove the selected interior stop (min 2)
// Color-pick (handle click → HSV picker) + interpolation toggle land in Task 7;
// the transforms toolbar + resample land in Task 8. Both append into the
// `[data-role="controls"]` region this task lays down.

import { type Palette, type ColorStop, type PaletteMode, bakeLUT, PALETTE_SIZE } from './palette';
import { COLORS } from './ui-tokens';
import { buildDropdown, buildButton } from './edit-primitives';
import { mountColorPicker, type ColorPickerHandle } from './color-picker';
import {
  reverseStops, mirrorStops, rotateStops, invertLuminanceStops, resampleToN,
} from './palette-transforms';

export interface PaletteEditorOpts {
  initial: Palette;
  onChange: (p: Palette) => void;
}
export interface PaletteEditorHandle {
  getPalette(): Palette;
  setPalette(p: Palette): void;
  /** #269 Phase 2 — programmatically select a stop by index (e.g. when the user
   *  clicks a flame region that maps to it): highlights it AND opens the HSV
   *  picker anchored to its handle, same as a bar-handle click. */
  selectStop(idx: number): void;
  destroy(): void;
}

const HIT_FRAC = 0.03; // handle hit radius in fractional strip coords
const EDGE = 1e-3; // min gap from endpoints / neighbors

// ── pure helpers ──────────────────────────────────────────────────────────
function clone(p: Palette): Palette {
  return { name: p.name, stops: p.stops.map((s) => ({ ...s })), hue: p.hue, mode: p.mode };
}

function hitHandle(stops: ColorStop[], t: number): number {
  let best = -1;
  let bd = HIT_FRAC;
  stops.forEach((s, i) => {
    const d = Math.abs(s.t - t);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function clampT(stops: ColorStop[], idx: number, t: number): number {
  if (idx === 0) return 0;
  if (idx === stops.length - 1) return 1;
  const lo = stops[idx - 1]!.t + EDGE;
  const hi = stops[idx + 1]!.t - EDGE;
  return Math.max(lo, Math.min(hi, t));
}

// Sample the baked palette color at fractional position t.
function colorAt(p: Palette, t: number): { r: number; g: number; b: number } {
  const lut = bakeLUT(p.stops, p.hue ?? 0, p.mode ?? 'linear');
  const i = Math.max(0, Math.min(PALETTE_SIZE - 1, Math.round(t * (PALETTE_SIZE - 1))));
  return { r: lut[i * 4 + 0]!, g: lut[i * 4 + 1]!, b: lut[i * 4 + 2]! };
}

const to255 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
const rgbCss = (r: number, g: number, b: number) => `rgb(${to255(r)},${to255(g)},${to255(b)})`;

// CSS gradient sampled at full 256-LUT resolution so the preview faithfully
// matches the baked LUT (and the GPU render) — a coarse sample drops sharp
// peaks (e.g. a lone white stop under 'smooth' interpolation). (#115)
function stripGradientCss(p: Palette): string {
  const lut = bakeLUT(p.stops, p.hue ?? 0, p.mode ?? 'linear');
  const parts: string[] = [];
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const pct = ((i / (PALETTE_SIZE - 1)) * 100).toFixed(2);
    parts.push(`${rgbCss(lut[i * 4]!, lut[i * 4 + 1]!, lut[i * 4 + 2]!)} ${pct}%`);
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

export function mountPaletteEditor(host: HTMLElement, opts: PaletteEditorOpts): PaletteEditorHandle {
  let palette = clone(opts.initial);
  let selectedIdx = -1;
  let dragIdx = -1;
  let dragMoved = false;
  let deleteBtn: HTMLElement | undefined; // assigned below; render() syncs its enabled state

  // ── DOM scaffold ──────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'pyr3-palette-editor';
  Object.assign(root.style, { display: 'block', userSelect: 'none' });

  const stripWrap = document.createElement('div');
  Object.assign(stripWrap.style, { position: 'relative', width: '100%', margin: '6px 0 18px' });

  const strip = document.createElement('div');
  strip.dataset['role'] = 'strip';
  Object.assign(strip.style, {
    position: 'relative', width: '100%', height: '40px', borderRadius: '3px',
    border: `1px solid ${COLORS.border}`, cursor: 'crosshair',
  });

  const handles = document.createElement('div'); // overlay; pointer-events pass through
  Object.assign(handles.style, {
    position: 'absolute', inset: '0', pointerEvents: 'none',
  });
  strip.appendChild(handles);
  stripWrap.appendChild(strip);
  root.appendChild(stripWrap);

  // Controls region — Task 7 (interp) + Task 8 (transforms/resample) append here.
  const controls = document.createElement('div');
  controls.dataset['role'] = 'controls';
  Object.assign(controls.style, { display: 'flex', flexDirection: 'column', gap: '8px' });
  root.appendChild(controls);

  host.appendChild(root);

  // ── render ────────────────────────────────────────────────────────────
  function render(): void {
    strip.style.background = stripGradientCss(palette);
    handles.replaceChildren();
    palette.stops.forEach((s, i) => {
      const sel = i === selectedIdx;
      const h = document.createElement('div');
      h.dataset['role'] = 'handle';
      h.dataset['idx'] = String(i);
      if (sel) h.dataset['selected'] = 'true';
      Object.assign(h.style, {
        position: 'absolute',
        top: sel ? '-9px' : '-4px',
        width: sel ? '18px' : '12px',
        height: sel ? '58px' : '48px',
        marginLeft: sel ? '-9px' : '-6px',
        left: `${s.t * 100}%`,
        borderRadius: '3px',
        border: `2px solid ${sel ? '#ffffff' : 'rgba(255,255,255,0.6)'}`,
        outline: sel ? `2px solid ${COLORS.flame.top}` : 'none',
        outlineOffset: '1px',
        background: rgbCss(s.r, s.g, s.b),
        boxShadow: sel
          ? `0 0 11px 2px ${COLORS.flame.top}`
          : '0 0 0 1px rgba(0,0,0,0.6)',
        zIndex: sel ? '3' : '1',
        pointerEvents: 'none',
      });
      handles.appendChild(h);
    });
    if (deleteBtn) {
      const on = canDelete();
      deleteBtn.style.opacity = on ? '1' : '0.4';
      deleteBtn.style.pointerEvents = on ? 'auto' : 'none';
      deleteBtn.title = on
        ? 'remove the selected stop'
        : 'select a middle stop to remove it (endpoints stay)';
    }
  }

  function emit(): void {
    opts.onChange(clone(palette));
  }

  // ── geometry ──────────────────────────────────────────────────────────
  function tForEvent(clientX: number): number {
    const r = strip.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / (r.width || 1)));
  }

  // ── gestures ──────────────────────────────────────────────────────────
  function onMouseDown(e: MouseEvent): void {
    const t = tForEvent(e.clientX);
    const idx = hitHandle(palette.stops, t);
    selectedIdx = idx;
    dragIdx = idx;
    dragMoved = false;
    render();
  }
  function onMouseMove(e: MouseEvent): void {
    if (dragIdx < 0) return;
    dragMoved = true;
    const t = clampT(palette.stops, dragIdx, tForEvent(e.clientX));
    palette.stops[dragIdx]!.t = t;
    render();
    emit();
  }
  function onMouseUp(): void {
    dragIdx = -1;
  }
  function onDblClick(e: MouseEvent): void {
    const t = Math.max(EDGE, Math.min(1 - EDGE, tForEvent(e.clientX)));
    const c = colorAt(palette, t);
    palette.stops.push({ t, r: c.r, g: c.g, b: c.b });
    palette.stops.sort((a, b) => a.t - b.t);
    selectedIdx = palette.stops.findIndex((s) => s.t === t);
    render();
    emit();
  }
  // A stop is removable only if it's a selected interior stop and removing it
  // keeps at least 2 stops (endpoints are permanent).
  function canDelete(): boolean {
    return selectedIdx > 0 && selectedIdx < palette.stops.length - 1 && palette.stops.length > 2;
  }
  function deleteSelected(): void {
    if (!canDelete()) return;
    palette.stops.splice(selectedIdx, 1);
    selectedIdx = -1;
    render();
    emit();
  }
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    deleteSelected();
  }

  strip.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  strip.addEventListener('dblclick', onDblClick);
  document.addEventListener('keydown', onKeyDown);

  // ── Task 7: interpolation toggle (linear / smooth / step) ──────────────
  const interp = buildDropdown<PaletteMode>({
    value: palette.mode ?? 'linear',
    options: [
      { value: 'linear', label: 'linear' },
      { value: 'smooth', label: 'smooth' },
      { value: 'step', label: 'step' },
    ],
    onChange: (mode) => { palette.mode = mode; render(); emit(); },
  });
  interp.dataset['role'] = 'interp';
  const interpRow = document.createElement('label');
  Object.assign(interpRow.style, {
    display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: COLORS.text.muted,
  });
  interpRow.append('interpolation', interp);
  controls.appendChild(interpRow);

  // delete-stop button — a discoverable alternative to selecting a stop and
  // pressing Delete/Backspace. render() dims it when no interior stop is selected.
  deleteBtn = buildButton({ variant: 'plain', label: '🗑 delete stop', onClick: () => deleteSelected() });
  deleteBtn.dataset['role'] = 'delete-stop';
  deleteBtn.style.alignSelf = 'flex-start';
  controls.appendChild(deleteBtn);

  // ── Task 7: handle click → HSV color picker ────────────────────────────
  let picker: ColorPickerHandle | null = null;
  function closePicker(): void { if (picker) { picker.destroy(); picker = null; } }
  // Select a stop by index: highlight it and open the HSV picker anchored to
  // its handle. Shared by bar-handle clicks (onClick) and the #269 Phase 2
  // flame-click → select-its-stop path (handle.selectStop).
  function selectStop(idx: number): void {
    if (idx < 0 || idx >= palette.stops.length) return;
    selectedIdx = idx;
    render();
    closePicker();
    const stop = palette.stops[idx]!;
    const anchorEl = (handles.children[idx] as HTMLElement | undefined) ?? strip;
    picker = mountColorPicker(host, {
      initial: { r: stop.r, g: stop.g, b: stop.b },
      anchor: anchorEl,
      onChange: (rgb) => {
        const s2 = palette.stops[idx];
        if (!s2) return;
        s2.r = rgb.r; s2.g = rgb.g; s2.b = rgb.b;
        render();
        emit();
      },
      onClose: () => { picker = null; },
    });
  }
  function onClick(e: MouseEvent): void {
    if (dragMoved) return; // a drag, not a click
    const idx = hitHandle(palette.stops, tForEvent(e.clientX));
    if (idx < 0) return; // empty strip — dblclick adds, click does nothing
    selectStop(idx);
  }
  strip.addEventListener('click', onClick);

  // ── Task 8: lossless whole-palette transforms ──────────────────────────
  function applyTransform(fn: (s: ColorStop[]) => ColorStop[]): void {
    palette.stops = fn(palette.stops);
    selectedIdx = -1;
    closePicker();
    render();
    emit();
  }
  const toolbar = document.createElement('div');
  Object.assign(toolbar.style, { display: 'flex', flexWrap: 'wrap', gap: '6px' });
  const transforms: Array<[string, string, (s: ColorStop[]) => ColorStop[]]> = [
    ['reverse', '⇄ reverse', reverseStops],
    ['mirror', '⊙ mirror', mirrorStops],
    ['rotate', '↻ rotate', (s) => rotateStops(s, 1 / 12)],
    ['invert', '◐ invert lum', invertLuminanceStops],
  ];
  for (const [role, label, fn] of transforms) {
    const btn = buildButton({ variant: 'plain', label, onClick: () => applyTransform(fn) });
    btn.dataset['role'] = role;
    toolbar.appendChild(btn);
  }
  controls.appendChild(toolbar);

  // ── Task 8: resample an existing palette to N editable handles ─────────
  const resampleRow = document.createElement('div');
  Object.assign(resampleRow.style, {
    display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: COLORS.text.muted,
  });
  const resampleN = document.createElement('input');
  resampleN.type = 'number';
  resampleN.dataset['role'] = 'resample-n';
  resampleN.value = '10';
  resampleN.min = '2';
  resampleN.max = '64';
  Object.assign(resampleN.style, {
    width: '56px', background: COLORS.bg.input, color: COLORS.text.primary,
    border: `1px solid ${COLORS.border}`, borderRadius: '3px', padding: '2px 4px',
  });
  const resampleBtn = buildButton({
    variant: 'plain', label: 'resample to N', onClick: () => {
      const n = Math.max(2, Math.min(64, Math.round(Number(resampleN.value) || 10)));
      applyTransform((s) => resampleToN(s, n, palette.mode ?? 'linear'));
    },
  });
  resampleBtn.dataset['role'] = 'resample';
  resampleRow.append('reshape:', resampleN, resampleBtn);
  controls.appendChild(resampleRow);

  render();

  return {
    getPalette: () => clone(palette),
    setPalette: (p: Palette) => { palette = clone(p); selectedIdx = -1; closePicker(); render(); },
    selectStop: (idx: number) => selectStop(idx),
    destroy: () => {
      closePicker();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKeyDown);
      root.remove();
    },
  };
}
