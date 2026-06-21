// Section 7 colour + glow demo for /how-it-works (#347). Accumulates a
// weight-skewed Sierpinski into a density grid — tracking BOTH how many points
// hit each cell AND the colour of the xforms that put them there — then paints
// it two ways: raw linear (nearly black) vs log-density + gamma (the glow).
// Coloured by xform, matching the prose + the palette strip. A gamma slider
// tunes the glow. DOM-mounting → SEAM_EXEMPT. No innerHTML.
import { COLORS } from '../ui-tokens';
import { makeRng, initChaosState, runFuse, stepChaos, sierpinskiWithWeights } from '../learn-chaos';

const GRID = 150;       // density grid resolution (square)
const SAMPLES = 200_000;

/** hsl(h, s, l) → [r,g,b] in 0..1 (matches the dots' hsl(hue 85% 60%)). */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

interface Accum { density: Float32Array; colR: Float32Array; colG: Float32Array; colB: Float32Array; max: number }

/** Run a weight-skewed Sierpinski (8:2:1 → genuine high dynamic range) and
 *  accumulate per-cell hit count + summed xform colour. */
function accumulate(): Accum {
  const flame = sierpinskiWithWeights(8, 2, 1);
  const xformRgb = flame.xforms.map((xf) => hslToRgb(xf.hue, 0.85, 0.6));
  const density = new Float32Array(GRID * GRID);
  const colR = new Float32Array(GRID * GRID);
  const colG = new Float32Array(GRID * GRID);
  const colB = new Float32Array(GRID * GRID);
  const rng = makeRng(4);
  let state = runFuse(flame, initChaosState(), rng, 25);
  let max = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const r = stepChaos(flame, state, rng); state = r.state;
    const gx = Math.floor(r.point.x * GRID);
    const gy = Math.floor((1 - r.point.y) * GRID);
    if (gx < 0 || gx >= GRID || gy < 0 || gy >= GRID) continue;
    const idx = gy * GRID + gx;
    const v = ++density[idx]!;
    const rgb = xformRgb[r.point.xform]!;
    colR[idx]! += rgb[0]; colG[idx]! += rgb[1]; colB[idx]! += rgb[2];
    if (v > max) max = v;
  }
  return { density, colR, colG, colB, max };
}

/** Paint a pane: `level(count)` maps hit-count → 0..1 brightness; the cell's
 *  averaged xform colour tints it. */
function paint(ctx: CanvasRenderingContext2D, a: Accum, level: (count: number, max: number) => number): void {
  const img = ctx.createImageData(GRID, GRID);
  for (let i = 0; i < a.density.length; i++) {
    const c = a.density[i]!;
    const o = i * 4;
    if (c > 0) {
      const lev = level(c, a.max);
      img.data[o] = Math.round((a.colR[i]! / c) * lev * 255);
      img.data[o + 1] = Math.round((a.colG[i]! / c) * lev * 255);
      img.data[o + 2] = Math.round((a.colB[i]! / c) * lev * 255);
    }
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export function buildGlowDemo(): HTMLElement {
  const acc = accumulate();
  const card = document.createElement('div');
  Object.assign(card.style, { border: `1px solid ${COLORS.border}`, borderRadius: '8px', background: '#060608', padding: '12px', margin: '16px 0' });

  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' });
  const makePane = (title: string): { wrap: HTMLElement; canvas: HTMLCanvasElement } => {
    const wrap = document.createElement('div'); wrap.style.textAlign = 'center';
    const c = document.createElement('canvas'); c.width = GRID; c.height = GRID;
    Object.assign(c.style, { width: '180px', height: '180px', imageRendering: 'pixelated', border: `1px solid ${COLORS.border}` });
    const cap = document.createElement('div'); cap.textContent = title;
    Object.assign(cap.style, { fontSize: '12px', color: COLORS.text.muted, marginTop: '6px' });
    wrap.append(c, cap); return { wrap, canvas: c };
  };
  const linear = makePane('raw counts (linear)');
  const glow = makePane('log density + gamma');
  row.append(linear.wrap, glow.wrap);
  card.append(row);

  // raw: linear count/max → near-black, only the hottest cells show.
  paint(linear.canvas.getContext('2d')!, acc, (c, max) => c / max);
  const glowCtx = glow.canvas.getContext('2d')!;
  const repaintGlow = (g: number): void => paint(glowCtx, acc, (c, max) => Math.pow(Math.log(1 + c) / Math.log(1 + max), 1 / g));

  const gWrap = document.createElement('div');
  Object.assign(gWrap.style, { textAlign: 'center', marginTop: '12px', fontSize: '12px', color: COLORS.text.muted });
  const gSlider = document.createElement('input'); gSlider.type = 'range'; gSlider.min = '1'; gSlider.max = '4'; gSlider.step = '0.1'; gSlider.value = '2.2';
  gSlider.style.width = '180px';
  const gLabel = document.createElement('span');
  const refreshGamma = (): void => { const g = +gSlider.value; repaintGlow(g); gLabel.textContent = ` gamma: ${g.toFixed(1)}`; };
  gSlider.addEventListener('input', refreshGamma);
  gWrap.append(document.createTextNode('gamma '), gSlider, gLabel);
  card.append(gWrap);
  refreshGamma();

  // palette strip — each xform's colour coordinate samples a gradient.
  const palWrap = document.createElement('div');
  Object.assign(palWrap.style, { marginTop: '16px', textAlign: 'center' });
  const palCap = document.createElement('div');
  palCap.textContent = 'Each xform carries a colour coordinate that looks up the palette:';
  Object.assign(palCap.style, { fontSize: '12px', color: COLORS.text.muted, marginBottom: '6px' });
  const strip = document.createElement('canvas'); strip.width = 300; strip.height = 28;
  Object.assign(strip.style, { width: '100%', maxWidth: '300px', height: '28px', borderRadius: '4px', display: 'block', margin: '0 auto' });
  const sctx = strip.getContext('2d')!;
  const grad = sctx.createLinearGradient(0, 0, strip.width, 0);
  grad.addColorStop(0.0, 'hsl(0 85% 60%)');
  grad.addColorStop(0.5, 'hsl(140 85% 60%)');
  grad.addColorStop(1.0, 'hsl(215 85% 60%)');
  sctx.fillStyle = grad; sctx.fillRect(0, 0, strip.width, strip.height);
  const ticks = document.createElement('div');
  Object.assign(ticks.style, { display: 'flex', justifyContent: 'space-between', maxWidth: '300px', margin: '2px auto 0', fontSize: '11px', color: COLORS.text.dim });
  for (const name of ['A', 'B', 'C']) { const t = document.createElement('span'); t.textContent = name; ticks.append(t); }
  palWrap.append(palCap, strip, ticks);
  card.append(palWrap);

  return card;
}
