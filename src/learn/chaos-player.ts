// Reusable Canvas2D chaos-game "player" for the /how-it-works demos (#347).
// Two modes:
//   'step'   (§2) — +1/+5/+50/+1000/Play/Reset controls, opaque colored dots,
//                   annotated jump-line + move readout at small steps. The demo
//                   IS the stepping.
//   'result' (§4/§5/§6) — no step controls; on mount/control-change it
//                   auto-animates the fill (~1s) with ADDITIVE low-alpha dots so
//                   density shows as brightness. The demo is about the finished
//                   shape responding to a control, not the stepping.
// DOM-mounting → SEAM_EXEMPT. No innerHTML.

import { COLORS } from '../ui-tokens';
import {
  makeRng, initChaosState, runFuse, stepChaos,
  type DemoFlame, type ChaosState, type PlottedPoint,
} from '../learn-chaos';

export interface PlayerView { cx: number; cy: number; scale: number } // world→canvas
export interface ChaosPlayerOpts {
  flame: DemoFlame;
  size?: number;            // square canvas px (default 360)
  view?: PlayerView;        // default fits the unit square [0,1]²
  annotate?: boolean;       // §2: jump line + readout (default false)
  seed?: number;            // rng seed (default 1)
  mode?: 'step' | 'result'; // default 'step' (see file header)
  initialPoints?: number;   // 'result' mode: total points the auto-fill animates to (default 30000)
  moveLabel?: (p: PlottedPoint, flame: DemoFlame) => string; // readout text
}
export interface ChaosPlayerHandle { el: HTMLElement; reset(): void; destroy(): void }

const STEP_SIZES = [1, 5, 50, 1000] as const;
// Play adds points at a watchable rate (~3k/sec at 60fps) — the Sierpinski is
// basically complete by ~6k points, so a slow drip lets you see it build.
const PLAY_PER_FRAME = 50;

export function mountChaosPlayer(opts: ChaosPlayerOpts): ChaosPlayerHandle {
  const size = opts.size ?? 360;
  let view = opts.view ?? { cx: 0.5, cy: 0.5, scale: size * 0.92 };
  const annotate = opts.annotate ?? false;
  const mode = opts.mode ?? 'step';
  const additive = mode === 'result'; // density-as-brightness
  let destroyed = false;
  let io: IntersectionObserver | null = null;
  let filled = false;

  const card = document.createElement('div');
  Object.assign(card.style, {
    border: `1px solid ${COLORS.border}`, borderRadius: '8px',
    background: '#060608', padding: '12px', margin: '16px 0',
  });

  // Two stacked canvases: dots (persistent) + overlay (cleared each draw).
  const stage = document.createElement('div');
  Object.assign(stage.style, { position: 'relative', width: `${size}px`, height: `${size}px`, margin: '0 auto' });
  const dots = document.createElement('canvas'); dots.width = size; dots.height = size;
  const overlay = document.createElement('canvas'); overlay.width = size; overlay.height = size;
  Object.assign(overlay.style, { position: 'absolute', left: '0', top: '0' });
  stage.append(dots, overlay);
  card.append(stage);

  const dctx = dots.getContext('2d')!;
  const octx = overlay.getContext('2d')!;

  let rng = makeRng(opts.seed ?? 1);
  let state: ChaosState = initChaosState();
  let prev: { x: number; y: number } | null = null;
  let raf = 0;

  const toCanvas = (x: number, y: number): [number, number] => [
    size / 2 + (x - view.cx) * view.scale,
    size / 2 - (y - view.cy) * view.scale, // flip y (world up = screen up)
  ];

  function clearAll(): void {
    // 'lighter' (additive) would ADD on clear — reset to source-over to wipe,
    // then restore additive blending for the dots in 'result' mode.
    dctx.globalCompositeOperation = 'source-over';
    dctx.fillStyle = '#060608'; dctx.fillRect(0, 0, size, size);
    if (additive) dctx.globalCompositeOperation = 'lighter';
    octx.clearRect(0, 0, size, size);
  }

  function plot(p: PlottedPoint): void {
    const [px, py] = toCanvas(p.x, p.y);
    const xf = opts.flame.xforms[p.xform];
    const rgb = xf?.rgb; // explicit palette colour wins over hue
    if (additive) {
      // low-alpha additive: overlapping points accumulate into brightness so
      // denser regions glow — density made visible (§4 weights, §5/§6 shape).
      dctx.fillStyle = rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.32)` : `hsl(${xf?.hue ?? 30} 90% 58% / 0.32)`;
      dctx.fillRect(px, py, 2, 2);
    } else {
      dctx.fillStyle = rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.9)` : `hsl(${xf?.hue ?? 30} 85% 60% / 0.9)`;
      dctx.fillRect(px, py, 1.6, 1.6);
    }
  }

  function drawAnnotation(p: PlottedPoint): void {
    octx.clearRect(0, 0, size, size);
    const [cxp, cyp] = toCanvas(p.x, p.y);
    if (prev) {
      const [ppx, ppy] = toCanvas(prev.x, prev.y);
      octx.strokeStyle = 'rgba(255,255,255,0.7)'; octx.lineWidth = 0.9;
      octx.setLineDash([3, 3]); octx.beginPath(); octx.moveTo(ppx, ppy); octx.lineTo(cxp, cyp); octx.stroke();
      octx.setLineDash([]);
    }
    octx.fillStyle = '#fff'; octx.beginPath(); octx.arc(cxp, cyp, 3.5, 0, Math.PI * 2); octx.fill();
  }

  // Readout (annotated mode only).
  const readout = document.createElement('div');
  Object.assign(readout.style, {
    margin: '8px 0 0', fontSize: '12px', color: COLORS.text.muted,
    minHeight: '17px', fontFamily: 'ui-monospace, Menlo, monospace',
  });
  if (annotate) card.append(readout);

  const counter = document.createElement('span');
  Object.assign(counter.style, { marginLeft: 'auto', color: COLORS.text.dim });

  function burst(n: number): void {
    let last: PlottedPoint | null = null;
    for (let i = 0; i < n; i++) {
      const r = stepChaos(opts.flame, state, rng);
      state = r.state; plot(r.point); last = r.point;
      if (i < n - 1) prev = { x: r.point.x, y: r.point.y };
    }
    if (last) {
      const showAnno = annotate && n <= 5;
      if (showAnno) { drawAnnotation(last); readout.textContent = opts.moveLabel ? opts.moveLabel(last, opts.flame) : ''; }
      else { octx.clearRect(0, 0, size, size); readout.textContent = ''; }
      prev = { x: last.x, y: last.y };
    }
    counter.textContent = `${state.count.toLocaleString()} pts`;
  }

  // 'result' mode: animate the fill to `total` points over ~2s (≈120 frames),
  // a watchable build that stops once the attractor is visually complete.
  function animateFill(total: number): void {
    const perFrame = Math.max(1, Math.ceil(total / 120));
    let done = 0;
    const loop = (): void => {
      if (destroyed) return;
      const n = Math.min(perFrame, total - done);
      burst(n); done += n;
      raf = done < total ? requestAnimationFrame(loop) : 0;
    };
    raf = requestAnimationFrame(loop); // defer first batch off the IO callback's sync stack
  }

  // Auto-fit the view to the attractor by sampling points and taking trimmed
  // (2nd–98th percentile) bounds — robust to unbounded variation tails. Used in
  // 'result' mode when the caller doesn't pin an explicit view, so any variation
  // frames itself instead of clipping or sitting tiny.
  function autoFitView(): PlayerView {
    const N = 4000;
    const xs: number[] = [], ys: number[] = [];
    let r2 = makeRng(opts.seed ?? 1);
    let s = runFuse(opts.flame, initChaosState(), r2, 25);
    for (let i = 0; i < N; i++) {
      const out = stepChaos(opts.flame, s, r2); s = out.state;
      if (Number.isFinite(out.point.x) && Number.isFinite(out.point.y)) { xs.push(out.point.x); ys.push(out.point.y); }
    }
    if (xs.length < 10) return { cx: 0.5, cy: 0.5, scale: size * 0.92 };
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const lo = Math.floor(xs.length * 0.02), hi = Math.floor(xs.length * 0.98);
    const minX = xs[lo]!, maxX = xs[hi]!, minY = ys[lo]!, maxY = ys[hi]!;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const span = Math.max(maxX - minX, maxY - minY, 1e-3) * 1.12;
    return { cx, cy, scale: (size * 0.9) / span };
  }

  function reset(): void {
    stopPlay();
    if (mode === 'result' && !opts.view) view = autoFitView();
    rng = makeRng(opts.seed ?? 1);
    state = runFuse(opts.flame, initChaosState(), rng, 25);
    prev = { x: state.x, y: state.y };
    clearAll();
    counter.textContent = '0 pts';
    readout.textContent = '';
    if (mode === 'result') {
      // Start the build when the demo scrolls into view (not on mount, which is
      // usually below the fold — you'd miss the animation entirely). On a control
      // change the new player mounts already in-view, so it fires immediately.
      filled = false;
      io?.disconnect();
      io = new IntersectionObserver((entries) => {
        if (!filled && entries.some((e) => e.isIntersecting)) {
          filled = true;
          animateFill(opts.initialPoints ?? 8000);
        }
      }, { threshold: 0.4 });
      io.observe(card);
    }
  }

  // Controls.
  const controls = document.createElement('div');
  Object.assign(controls.style, { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px', fontSize: '12px' });
  const mkBtn = (label: string, on: () => void): HTMLButtonElement => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    Object.assign(b.style, { font: 'inherit', color: COLORS.text.primary, background: 'transparent',
      border: `1px solid ${COLORS.border}`, borderRadius: '5px', padding: '4px 9px', cursor: 'pointer' });
    b.addEventListener('click', on); return b;
  };
  const stepLabel = document.createElement('span'); stepLabel.textContent = 'step:'; stepLabel.style.color = COLORS.text.muted;
  controls.append(stepLabel);
  for (const n of STEP_SIZES) controls.append(mkBtn(`+${n}`, () => { stopPlay(); burst(n); }));

  let playing = false;
  const playBtn = mkBtn('▶ Play', () => togglePlay());
  function togglePlay(): void { playing ? stopPlay() : startPlay(); }
  function startPlay(): void {
    playing = true; playBtn.textContent = '❚❚ Pause';
    // The `playing` guard is defence-in-depth: stopPlay()/destroy() already
    // cancelAnimationFrame(raf), but a tick queued just before that fires once
    // more — the guard skips the extra burst + reschedule. Don't remove it.
    const tick = (): void => { if (!playing) return; burst(PLAY_PER_FRAME); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  }
  function stopPlay(): void { playing = false; playBtn.textContent = '▶ Play'; if (raf) cancelAnimationFrame(raf); raf = 0; }
  controls.append(playBtn);
  controls.append(mkBtn('↺ Reset', () => { reset(); }));
  controls.append(counter);
  // 'result' mode has no step controls — the section's own control (slider /
  // dropdown / checkbox) drives a rebuild, which re-animates the fill. It still
  // shows a points counter so it's clear the demo is accumulating, not static.
  if (mode === 'step') {
    card.append(controls);
  } else {
    const crow = document.createElement('div');
    Object.assign(crow.style, { display: 'flex', justifyContent: 'flex-end', marginTop: '8px', fontSize: '12px' });
    counter.style.marginLeft = '0';
    crow.append(counter);
    card.append(crow);
  }

  reset();

  return {
    el: card,
    reset,
    destroy: () => { destroyed = true; stopPlay(); io?.disconnect(); card.remove(); },
  };
}
