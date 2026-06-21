// Section 3 affine-transform playground for /how-it-works (#347): a reference
// grid + unit square warped live by the 5 decomposed fields (scale x/y,
// rotation, shear, move) — the same view the editor exposes. Reuses
// decomposedToRaw so the math matches the editor exactly.
// DOM-mounting → SEAM_EXEMPT. No innerHTML.
import { COLORS } from '../ui-tokens';
import { decomposedToRaw, type RawAffine } from '../affine-decompose';

interface FieldSpec { key: string; label: string; min: number; max: number; step: number; val: number }
const FIELDS: FieldSpec[] = [
  { key: 'scaleX', label: 'scale x', min: -1.5, max: 1.5, step: 0.01, val: 0.5 },
  { key: 'scaleY', label: 'scale y', min: -1.5, max: 1.5, step: 0.01, val: 0.5 },
  { key: 'rotDeg', label: 'rotation°', min: -180, max: 180, step: 1, val: 0 },
  { key: 'shear',  label: 'shear',  min: -1, max: 1, step: 0.01, val: 0 },
  { key: 'posX',   label: 'move x', min: -1, max: 1, step: 0.01, val: 0 },
  { key: 'posY',   label: 'move y', min: -1, max: 1, step: 0.01, val: 0 },
];

export function buildAffinePlayground(): HTMLElement {
  const size = 360; const scale = size * 0.28; // world units → px
  const card = document.createElement('div');
  Object.assign(card.style, { border: `1px solid ${COLORS.border}`, borderRadius: '8px', background: '#060608', padding: '12px', margin: '16px 0' });

  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  Object.assign(canvas.style, { display: 'block', margin: '0 auto' });
  const ctx = canvas.getContext('2d')!;
  const toC = (x: number, y: number): [number, number] => [size / 2 + x * scale, size / 2 - y * scale];
  const apply = (m: RawAffine, x: number, y: number): [number, number] => [m.a * x + m.b * y + m.c, m.d * x + m.e * y + m.f];

  const inputs: Record<string, HTMLInputElement> = {};

  function draw(): void {
    ctx.fillStyle = '#060608'; ctx.fillRect(0, 0, size, size);
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
    for (let g = -2; g <= 2; g++) {
      const [ax, ay] = toC(g, -2); const [bx, by] = toC(g, 2); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      const [cx, cy] = toC(-2, g); const [dx, dy] = toC(2, g); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(dx, dy); ctx.stroke();
    }
    const sq: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    // source unit square outline
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.beginPath();
    sq.forEach((p, i) => { const [cx, cy] = toC(p[0], p[1]); if (i) ctx.lineTo(cx, cy); else ctx.moveTo(cx, cy); }); ctx.closePath(); ctx.stroke();
    // transformed square
    const m = decomposedToRaw({
      scaleX: +inputs.scaleX!.value, scaleY: +inputs.scaleY!.value,
      rotation: (+inputs.rotDeg!.value) * Math.PI / 180, shear: +inputs.shear!.value,
      positionX: +inputs.posX!.value, positionY: +inputs.posY!.value,
    });
    ctx.fillStyle = COLORS.flame.mid + 'cc'; ctx.beginPath();
    sq.forEach((p, i) => { const [wx, wy] = apply(m, p[0], p[1]); const [cx, cy] = toC(wx, wy); if (i) ctx.lineTo(cx, cy); else ctx.moveTo(cx, cy); }); ctx.closePath(); ctx.fill();
  }

  const sliderWrap = document.createElement('div');
  Object.assign(sliderWrap.style, { marginTop: '12px', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '4px 10px', alignItems: 'center', fontSize: '12px' });
  for (const f of FIELDS) {
    const lab = document.createElement('label'); lab.textContent = f.label; lab.style.color = COLORS.text.muted;
    const inp = document.createElement('input'); inp.type = 'range'; inp.min = String(f.min); inp.max = String(f.max); inp.step = String(f.step); inp.value = String(f.val);
    const v = document.createElement('span'); v.style.color = COLORS.text.dim; v.style.fontFamily = 'ui-monospace, Menlo, monospace';
    inputs[f.key] = inp;
    inp.addEventListener('input', () => { v.textContent = (+inp.value).toFixed(2); draw(); });
    v.textContent = (+inp.value).toFixed(2);
    sliderWrap.append(lab, inp, v);
  }
  card.append(canvas, sliderWrap);
  draw();
  return card;
}
