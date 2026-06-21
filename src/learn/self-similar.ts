// Section 0 self-similarity visual for /how-it-works (#347): a Sierpinski
// triangle drawn by recursive GEOMETRIC subdivision (distinct from §2's chaos
// game) with a depth slider — shows "the same shape at every scale".
// DOM-mounting → SEAM_EXEMPT. No innerHTML.
import { COLORS } from '../ui-tokens';

export function buildSelfSimilar(depthMax = 6): HTMLElement {
  const size = 340;
  const card = document.createElement('div');
  Object.assign(card.style, { border: `1px solid ${COLORS.border}`, borderRadius: '8px',
    background: '#060608', padding: '12px', margin: '16px 0', textAlign: 'center' });

  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const A: [number, number] = [size / 2, 18];
  const B: [number, number] = [22, size - 22];
  const C: [number, number] = [size - 22, size - 22];
  const mid = (p: [number, number], q: [number, number]): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];

  function tri(p: [number, number], q: [number, number], r: [number, number]): void {
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.lineTo(r[0], r[1]); ctx.closePath();
    ctx.fillStyle = COLORS.flame.mid; ctx.fill();
  }
  function recurse(p: [number, number], q: [number, number], r: [number, number], d: number): void {
    if (d === 0) { tri(p, q, r); return; }
    recurse(p, mid(p, q), mid(p, r), d - 1);
    recurse(mid(p, q), q, mid(q, r), d - 1);
    recurse(mid(p, r), mid(q, r), r, d - 1);
  }
  function draw(depth: number): void {
    ctx.fillStyle = '#060608'; ctx.fillRect(0, 0, size, size);
    recurse(A, B, C, depth);
  }

  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = String(depthMax); slider.value = '2';
  Object.assign(slider.style, { width: '200px', marginTop: '10px' });
  const label = document.createElement('div');
  Object.assign(label.style, { color: COLORS.text.muted, fontSize: '12px', marginTop: '4px' });
  const refresh = (): void => { const d = Number(slider.value); draw(d); label.textContent = `subdivision depth: ${d}`; };
  slider.addEventListener('input', refresh);

  card.append(canvas, document.createElement('br'), slider, label);
  refresh();
  return card;
}
