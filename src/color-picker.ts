import { rgbToHsv, hsvToRgb } from './color-math';
import { COLORS } from './ui-tokens';

export interface ColorPickerOpts {
  initial: { r: number; g: number; b: number };
  anchor: HTMLElement;
  onChange: (rgb: { r: number; g: number; b: number }) => void;
  onClose?: () => void;
}
export interface ColorPickerHandle { destroy(): void }

const to255 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((c) => to255(c).toString(16).padStart(2, '0')).join('');
function parseHex(s: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function mountColorPicker(host: HTMLElement, opts: ColorPickerOpts): ColorPickerHandle {
  let { h, s, v } = rgbToHsv(opts.initial.r, opts.initial.g, opts.initial.b);

  const root = document.createElement('div');
  root.className = 'pyr3-color-picker';
  Object.assign(root.style, {
    position: 'absolute', zIndex: '60', padding: '8px', borderRadius: '6px',
    background: COLORS.bg.panel, border: `1px solid ${COLORS.border}`, width: '200px',
  });

  const sv = document.createElement('canvas'); sv.width = 180; sv.height = 140;
  Object.assign(sv.style, { width: '100%', height: '120px', cursor: 'crosshair', display: 'block' });
  const hue = document.createElement('canvas'); hue.width = 180; hue.height = 14;
  Object.assign(hue.style, { width: '100%', height: '14px', cursor: 'pointer', display: 'block', marginTop: '6px' });
  const hex = document.createElement('input'); hex.dataset['role'] = 'hex'; hex.type = 'text';
  Object.assign(hex.style, { width: '100%', marginTop: '6px', boxSizing: 'border-box',
    background: COLORS.bg.input, color: COLORS.text.primary, border: `1px solid ${COLORS.border}` });

  // Header with a close (✕) button — clicking outside or pressing Escape also dismisses.
  const head = document.createElement('div');
  Object.assign(head.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px',
  });
  const ttl = document.createElement('span');
  ttl.textContent = 'color';
  Object.assign(ttl.style, { fontSize: '11px', color: COLORS.text.muted });
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.dataset['role'] = 'close';
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, {
    background: 'transparent', color: COLORS.text.muted, border: 'none',
    cursor: 'pointer', fontSize: '13px', lineHeight: '1', padding: '2px 4px',
  });
  head.append(ttl, closeBtn);

  root.append(head, sv, hue, hex); host.appendChild(root);

  function emit(): void {
    const rgb = hsvToRgb(h, s, v);
    hex.value = toHex(rgb.r, rgb.g, rgb.b);
    opts.onChange(rgb);
    paint();
  }
  function paint(): void {
    const svc = sv.getContext('2d'); if (!svc) return;
    for (let y = 0; y < sv.height; y++) for (let x = 0; x < sv.width; x++) {
      const c = hsvToRgb(h, x / (sv.width - 1), 1 - y / (sv.height - 1));
      svc.fillStyle = toHex(c.r, c.g, c.b); svc.fillRect(x, y, 1, 1);
    }
    const hc = hue.getContext('2d'); if (!hc) return;
    for (let x = 0; x < hue.width; x++) {
      const c = hsvToRgb((x / (hue.width - 1)) * 360, 1, 1);
      hc.fillStyle = toHex(c.r, c.g, c.b); hc.fillRect(x, 0, 1, hue.height);
    }
  }
  const svPos = (e: MouseEvent) => { const r = sv.getBoundingClientRect();
    s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)); emit(); };
  const huePos = (e: MouseEvent) => { const r = hue.getBoundingClientRect();
    h = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 360; emit(); };
  let dragSv = false, dragHue = false;
  sv.addEventListener('mousedown', (e) => { dragSv = true; svPos(e); });
  hue.addEventListener('mousedown', (e) => { dragHue = true; huePos(e); });
  const move = (e: MouseEvent) => { if (dragSv) svPos(e); else if (dragHue) huePos(e); };
  const up = () => { dragSv = false; dragHue = false; };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  hex.addEventListener('change', () => { const p = parseHex(hex.value); if (p) {
    const hsv = rgbToHsv(p.r, p.g, p.b); h = hsv.h; s = hsv.s; v = hsv.v; emit(); } });

  const ar = opts.anchor.getBoundingClientRect();
  root.style.left = `${ar.left}px`; root.style.top = `${ar.bottom + 4}px`;
  paint(); hex.value = toHex(opts.initial.r, opts.initial.g, opts.initial.b);

  // ── dismissal: ✕ button, click-outside, Escape ──────────────────────────
  function onOutside(e: MouseEvent): void {
    if (!root.contains(e.target as Node)) close();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }
  function close(): void {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey);
    root.remove();
    opts.onClose?.();
  }
  closeBtn.addEventListener('click', close);
  // Defer the outside-click listener so the click that OPENED the picker
  // (still propagating) doesn't immediately dismiss it.
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey);
  }, 0);

  return { destroy: close };
}
