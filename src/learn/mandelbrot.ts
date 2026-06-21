// Section 1 escape-time example for /how-it-works (#347): a small CPU-rendered
// Mandelbrot set — the "test every pixel with a formula" fractal, shown to
// contrast with the chaos-game / IFS approach the rest of the page covers.
// Pure Canvas2D, computed once. DOM-mounting → SEAM_EXEMPT. No innerHTML.
import { COLORS } from '../ui-tokens';

const SIZE = 220;
const MAX_ITER = 90;

export function buildMandelbrot(): HTMLElement {
  const card = document.createElement('div');
  Object.assign(card.style, { border: `1px solid ${COLORS.border}`, borderRadius: '8px', background: '#060608', padding: '12px', margin: '16px 0', textAlign: 'center' });

  const canvas = document.createElement('canvas'); canvas.width = SIZE; canvas.height = SIZE;
  Object.assign(canvas.style, { width: '220px', height: '220px', borderRadius: '4px' });
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(SIZE, SIZE);

  // Complex plane window framing the classic set.
  const reMin = -2.2, reSpan = 3.0, imMin = -1.5, imSpan = 3.0;
  for (let py = 0; py < SIZE; py++) {
    const ci = imMin + (py / SIZE) * imSpan;
    for (let px = 0; px < SIZE; px++) {
      const cr = reMin + (px / SIZE) * reSpan;
      // iterate z = z² + c until it escapes (|z| > 2) or we give up.
      let zr = 0, zi = 0, i = 0;
      for (; i < MAX_ITER; i++) {
        const zr2 = zr * zr, zi2 = zi * zi;
        if (zr2 + zi2 > 4) break;
        zi = 2 * zr * zi + ci; zr = zr2 - zi2 + cr;
      }
      const o = (py * SIZE + px) * 4;
      if (i >= MAX_ITER) {
        img.data[o] = 6; img.data[o + 1] = 6; img.data[o + 2] = 10; // inside → near-black
      } else {
        const t = i / MAX_ITER; // smooth-ish warm ramp
        img.data[o] = Math.round(9 * (1 - t) * t * t * t * 255);
        img.data[o + 1] = Math.round(15 * (1 - t) * (1 - t) * t * t * 255);
        img.data[o + 2] = Math.round(8.5 * (1 - t) * (1 - t) * (1 - t) * t * 255);
      }
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const cap = document.createElement('div');
  cap.textContent = 'An escape-time fractal (the Mandelbrot set): a formula is tested at every pixel.';
  Object.assign(cap.style, { fontSize: '12px', color: COLORS.text.muted, marginTop: '8px' });

  card.append(canvas, cap);
  return card;
}
