// #174 — Color-grading Scopes section for /editor. Three diagnostics drawn
// on <canvas> 2D from the settled render: luminance waveform, RGB parade,
// vectorscope. Pure readback consumer of the #175 settledPixels seam — no
// GPU/shader path, parity rigs untouched. Binning math lives in src/scopes.ts
// (engine-clean); this module is the DOM side (canvas + draw + subscription).

import { type SectionMount } from './edit-ui';
import { type EditState, type SettledPixels } from './edit-state';
import { normalizeBins } from './channel-histogram';
import {
  computeWaveform,
  computeParade,
  computeVectorscope,
  type WaveformBins,
  type ParadeBins,
  type VectorBins,
} from './scopes';

const WAVE_W = 256, WAVE_H = 128;
const PARADE_SEG = 85, PARADE_GAP = 1, PARADE_H = 128;
const PARADE_W = PARADE_SEG * 3 + PARADE_GAP * 2; // 257
const VEC_SIZE = 160;

const PARADE_COLORS: [number, number, number][] = [
  [255, 77, 77], [77, 255, 122], [110, 150, 255],
];

function makeCanvas(w: number, h: number, label: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.className = 'pyr3-scope-canvas';
  c.setAttribute('aria-label', label);
  return c;
}

function labeledRow(label: string, hint: string, canvas: HTMLCanvasElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pyr3-scope';
  const lbl = document.createElement('div');
  lbl.className = 'pyr3-scope-label';
  const left = document.createElement('span'); left.textContent = label;
  const right = document.createElement('span'); right.textContent = hint;
  lbl.append(left, right);
  wrap.append(lbl, canvas);
  return wrap;
}

function drawWaveform(ctx: CanvasRenderingContext2D, wf: WaveformBins): void {
  const { width: W, height: H } = wf;
  const norm = normalizeBins(wf.lum, undefined, 'log');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let p = 0; p < W * H; p++) {
    const v = norm[p]!;
    if (v > 0) {
      const g = (40 + v * 215) | 0;
      d[p * 4] = g * 0.5; d[p * 4 + 1] = g; d[p * 4 + 2] = g * 0.5; d[p * 4 + 3] = 255;
    } else {
      d[p * 4 + 3] = 255; // opaque black
    }
  }
  ctx.putImageData(img, 0, 0);
}

function drawParade(ctx: CanvasRenderingContext2D, p: ParadeBins): void {
  const W = PARADE_W, H = p.height;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const channels: Uint32Array[] = [p.r, p.g, p.b];
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let ch = 0; ch < 3; ch++) {
    const norm = normalizeBins(channels[ch]!, undefined, 'log');
    const ox = ch * (p.segW + PARADE_GAP);
    const col = PARADE_COLORS[ch]!;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < p.segW; x++) {
        const v = norm[y * p.segW + x]!;
        if (v <= 0) continue;
        const k = 0.25 + v * 0.75;
        const di = (y * W + (x + ox)) * 4;
        d[di] = col[0] * k; d[di + 1] = col[1] * k; d[di + 2] = col[2] * k; d[di + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function drawVectorscope(ctx: CanvasRenderingContext2D, v: VectorBins): void {
  const S = v.size;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
  const c = S / 2, R = S / 2 - 6;
  // graticule
  ctx.strokeStyle = '#2a2f38'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(c, c, R * 0.5, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c - R, c); ctx.lineTo(c + R, c);
  ctx.moveTo(c, c - R); ctx.lineTo(c, c + R);
  ctx.stroke();
  // chroma density
  const norm = normalizeBins(v.density, undefined, 'log');
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let p = 0; p < S * S; p++) {
    const val = norm[p]!;
    if (val <= 0) continue;
    const g = (60 + val * 195) | 0;
    d[p * 4] = Math.min(255, d[p * 4]! + g);
    d[p * 4 + 1] = Math.min(255, d[p * 4 + 1]! + g);
    d[p * 4 + 2] = Math.min(255, d[p * 4 + 2]! + g);
    d[p * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export const scopesSection: SectionMount = {
  key: 'scopes',
  lens: 'color',
  title: '📊 SCOPES',
  // _onChange unused: scopes are read-only diagnostics with no editable
  // controls, but we keep the full SectionMount signature for consistency
  // with every other section (and to surface the arg if a control is added).
  build(host: HTMLElement, state: EditState, _onChange: (path: string) => void): void | (() => void) {
    host.classList.add('pyr3-edit-section-scopes');
    ensureScopeStyles();

    const waveCanvas = makeCanvas(WAVE_W, WAVE_H, 'Luminance waveform');
    const paradeCanvas = makeCanvas(PARADE_W, PARADE_H, 'RGB parade');
    const vecCanvas = makeCanvas(VEC_SIZE, VEC_SIZE, 'Vectorscope');
    vecCanvas.classList.add('pyr3-scope-canvas-square');

    host.append(
      labeledRow('Waveform', 'luma × x', waveCanvas),
      labeledRow('RGB Parade', 'R · G · B', paradeCanvas),
      labeledRow('Vectorscope', 'hue ∠ · sat r', vecCanvas),
    );

    // willReadFrequently: parade + vectorscope getImageData every settle to
    // composite over their fill/graticule; the flag silences Chrome's perf
    // warning and steers them to a CPU-backed surface (ideal for tiny scopes).
    const waveCtx = waveCanvas.getContext('2d')!;
    const paradeCtx = paradeCanvas.getContext('2d', { willReadFrequently: true })!;
    const vecCtx = vecCanvas.getContext('2d', { willReadFrequently: true })!;

    // Paint an empty graticule/black immediately so the section isn't blank
    // before the first settle.
    drawWaveform(waveCtx, { width: WAVE_W, height: WAVE_H, lum: new Uint32Array(WAVE_W * WAVE_H) });
    drawParade(paradeCtx, {
      segW: PARADE_SEG, height: PARADE_H,
      r: new Uint32Array(PARADE_SEG * PARADE_H),
      g: new Uint32Array(PARADE_SEG * PARADE_H),
      b: new Uint32Array(PARADE_SEG * PARADE_H),
    });
    drawVectorscope(vecCtx, { size: VEC_SIZE, density: new Uint32Array(VEC_SIZE * VEC_SIZE) });

    // #174 GRADED readback subscription — fires on each settled render with
    // the fully-graded canvas bytes (channelCurves + adjustments applied), i.e.
    // exactly what's on screen. A grading scope must reflect the graded output,
    // so edits to Color Curves / HSL move the scopes. (Contrast the curves
    // HISTOGRAM, which subscribes to the PRE-curve settledPixelsListeners feed.)
    //
    // Bin + redraw all three scopes unconditionally — even while collapsed — so
    // they already reflect the latest settle the moment the user expands the
    // section (no stale-blank until the next edit). 3 cheap bin passes over a
    // preview-sized buffer on settle (not per-frame) is sub-millisecond.
    const onGradedPixels = (px: SettledPixels): void => {
      drawWaveform(waveCtx, computeWaveform(px, WAVE_W, WAVE_H));
      drawParade(paradeCtx, computeParade(px, PARADE_SEG, PARADE_H));
      drawVectorscope(vecCtx, computeVectorscope(px, VEC_SIZE));
    };
    (state.gradedPixelsListeners ??= []).push(onGradedPixels);

    // Disposer — release the cross-DOM subscription (#300 leak-guard pattern).
    return () => {
      const listeners = state.gradedPixelsListeners;
      if (listeners) {
        const i = listeners.indexOf(onGradedPixels);
        if (i >= 0) listeners.splice(i, 1);
      }
    };
  },
};

let scopeStylesInjected = false;
function ensureScopeStyles(): void {
  if (typeof document === 'undefined' || scopeStylesInjected) return;
  if (document.getElementById('pyr3-scope-styles')) { scopeStylesInjected = true; return; }
  const style = document.createElement('style');
  style.id = 'pyr3-scope-styles';
  style.textContent = `
.pyr3-scope { margin-bottom: 12px; }
.pyr3-scope:last-child { margin-bottom: 0; }
.pyr3-scope-label {
  display: flex; justify-content: space-between;
  font-size: 10px; letter-spacing: .04em; text-transform: uppercase;
  color: var(--bar-muted, #7d8794); margin-bottom: 4px;
}
.pyr3-scope-canvas {
  width: 100%; display: block; background: #000;
  border: 1px solid var(--bar-border, #2a2a30); border-radius: 4px;
}
.pyr3-scope-canvas-square { width: ${VEC_SIZE}px; margin: 0 auto; }
`;
  document.head.appendChild(style);
  scopeStylesInjected = true;
}
