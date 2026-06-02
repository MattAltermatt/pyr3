// Shared f64 CPU port of visualize_u32.wgsl / visualize_f32.wgsl tonemap math.
// Extracted verbatim from scripts/pyr3-027-f64-tonemap-oracle.ts so multiple
// probe scripts (#27, #72) share one reference implementation.

import { PREFILTER_WHITE } from '../src/calibration';

function rgb2hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = (g - b) / d;
    else if (mx === g) h = 2 + (b - r) / d;
    else h = 4 + (r - g) / d;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = mx > 0 ? d / mx : 0;
  return [h, s, mx];
}

function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const hh = h / 60;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  const ix = ((i % 6) + 6) % 6;
  if (ix === 0) return [v, t, p];
  if (ix === 1) return [q, v, p];
  if (ix === 2) return [p, v, t];
  if (ix === 3) return [p, q, v];
  if (ix === 4) return [t, p, v];
  return [v, p, q];
}

function calcAlpha(density: number, gInv: number, linrange: number): number {
  if (density <= 0) return 0;
  if (density < linrange) {
    const funcval = Math.pow(linrange, gInv);
    const frac = density / linrange;
    return (1 - frac) * density * (funcval / linrange) + frac * Math.pow(density, gInv);
  }
  return Math.pow(density, gInv);
}

function calcNewrgb(r: number, g: number, b: number, ls: number, highpow: number): [number, number, number] {
  if (ls === 0 || (r === 0 && g === 0 && b === 0)) return [0, 0, 0];
  const sR = ls * (r / PREFILTER_WHITE);
  const sG = ls * (g / PREFILTER_WHITE);
  const sB = ls * (b / PREFILTER_WHITE);
  let maxa = sR;
  let maxc = r / PREFILTER_WHITE;
  if (sG > maxa) { maxa = sG; maxc = g / PREFILTER_WHITE; }
  if (sB > maxa) { maxa = sB; maxc = b / PREFILTER_WHITE; }

  if (maxa > 255 && highpow >= 0) {
    const newls = 255 / maxc;
    const lsratio = Math.pow(newls / ls, highpow);
    const nr = (newls * (r / PREFILTER_WHITE)) / 255;
    const ng = (newls * (g / PREFILTER_WHITE)) / 255;
    const nb = (newls * (b / PREFILTER_WHITE)) / 255;
    const hsv = rgb2hsv(nr, ng, nb);
    hsv[1] *= lsratio;
    const out = hsv2rgb(hsv[0], hsv[1], hsv[2]);
    return [out[0] * 255, out[1] * 255, out[2] * 255];
  }
  const newls = 255 / maxc;
  let adjhlp = -highpow;
  if (adjhlp > 1) adjhlp = 1;
  if (maxa <= 255) adjhlp = 1;
  const mix = (1 - adjhlp) * newls + adjhlp * ls;
  return [mix * (r / PREFILTER_WHITE), mix * (g / PREFILTER_WHITE), mix * (b / PREFILTER_WHITE)];
}

export interface VizF64Inputs {
  hist: Float32Array | Uint32Array;
  histKind: 'f32' | 'u32';
  kernel1d: Float32Array;
  outW: number; outH: number;
  superW: number; superH: number;
  oversample: number;
  fwidth: number;
  k1: number; k2: number;
  gamma: number; vibrancy: number; highpow: number; linrange: number;
  background: [number, number, number];
}

export function visualizeF64(o: VizF64Inputs): Uint8Array {
  const out = new Uint8Array(o.outW * o.outH * 4);
  const gInv = 1 / o.gamma;
  const halfW = o.fwidth >>> 1;
  const isF32 = o.histKind === 'f32';

  for (let yi = 0; yi < o.outH; yi++) {
    for (let xi = 0; xi < o.outW; xi++) {
      const cx = xi * o.oversample + (o.oversample >>> 1);
      const cy = yi * o.oversample + (o.oversample >>> 1);

      let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
      for (let dy = 0; dy < o.fwidth; dy++) {
        const ky = o.kernel1d[dy]!;
        const sy = Math.min(Math.max(cy + dy - halfW, 0), o.superH - 1);
        for (let dx = 0; dx < o.fwidth; dx++) {
          const kx = o.kernel1d[dx]!;
          const sx = Math.min(Math.max(cx + dx - halfW, 0), o.superW - 1);
          const sb = (sy * o.superW + sx) * 4;
          const r = o.hist[sb + 0]!;
          const g = o.hist[sb + 1]!;
          const b = o.hist[sb + 2]!;
          const cnt = o.hist[sb + 3]!;
          const w = kx * ky;
          if (isF32) {
            sumR += r * w; sumG += g * w; sumB += b * w; sumA += cnt * w;
          } else if (cnt > 0) {
            const ls = (o.k1 * Math.log(1 + cnt * o.k2)) / cnt;
            sumR += r * ls * w; sumG += g * ls * w; sumB += b * ls * w; sumA += cnt * ls * w;
          }
        }
      }

      const oi = (yi * o.outW + xi) * 4;
      if (sumA <= 0) {
        out[oi + 0] = Math.round(o.background[0] * 255);
        out[oi + 1] = Math.round(o.background[1] * 255);
        out[oi + 2] = Math.round(o.background[2] * 255);
        out[oi + 3] = 255;
        continue;
      }

      const tmp = sumA / PREFILTER_WHITE;
      let alpha = calcAlpha(tmp, gInv, o.linrange);
      const lsAlpha = (o.vibrancy * 256 * alpha) / Math.max(tmp, 1e-12);
      alpha = Math.min(Math.max(alpha, 0), 1);

      const newrgb = calcNewrgb(sumR, sumG, sumB, lsAlpha, o.highpow);
      const perchR = (1 - o.vibrancy) * 256 * Math.pow(Math.max(sumR / PREFILTER_WHITE, 0), gInv);
      const perchG = (1 - o.vibrancy) * 256 * Math.pow(Math.max(sumG / PREFILTER_WHITE, 0), gInv);
      const perchB = (1 - o.vibrancy) * 256 * Math.pow(Math.max(sumB / PREFILTER_WHITE, 0), gInv);

      const compR = newrgb[0] + perchR + (1 - alpha) * 256 * o.background[0];
      const compG = newrgb[1] + perchG + (1 - alpha) * 256 * o.background[1];
      const compB = newrgb[2] + perchB + (1 - alpha) * 256 * o.background[2];

      out[oi + 0] = Math.min(255, Math.max(0, Math.round(Math.min(Math.max(compR / 256, 0), 1) * 255)));
      out[oi + 1] = Math.min(255, Math.max(0, Math.round(Math.min(Math.max(compG / 256, 0), 1) * 255)));
      out[oi + 2] = Math.min(255, Math.max(0, Math.round(Math.min(Math.max(compB / 256, 0), 1) * 255)));
      out[oi + 3] = 255;
    }
  }
  return out;
}
