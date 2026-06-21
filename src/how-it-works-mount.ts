// /how-it-works — interactive guide to how fractal flames work (#347).
// Scrollytelling single-column page; CPU demos reuse the engine's real
// variation/affine math (no WebGPU). DOM-mounting → SEAM_EXEMPT.

import { COLORS } from './ui-tokens';
import { mountChaosPlayer, type ChaosPlayerHandle } from './learn/chaos-player';
import { buildSection, para } from './learn/sections';
import { buildSelfSimilar } from './learn/self-similar';
import { buildMandelbrot } from './learn/mandelbrot';
import { buildAffinePlayground } from './learn/affine-warp';
import {
  SIERPINSKI, sierpinskiWithWeights, catalogVariationFlame,
  type DemoFlame, type PlottedPoint, type VarKind,
} from './learn-chaos';
import { type RawAffine } from './affine-decompose';
import { buildGlowDemo } from './learn/glow';

export interface HowItWorksOpts {
  /** Base-aware in-app links (Editor / Viewer / Variations). */
  nav?: (route: string) => void;
}

export function mountHowItWorks(root: HTMLElement, opts: HowItWorksOpts = {}): void {
  const page = document.createElement('div');
  page.className = 'pyr3-howitworks';
  Object.assign(page.style, {
    maxWidth: '760px', margin: '0 auto', padding: '40px 24px 96px',
    color: COLORS.text.primary,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    lineHeight: '1.6', fontSize: '15px',
  });

  const h1 = document.createElement('h1');
  h1.textContent = 'How fractal flames work';
  Object.assign(h1.style, { fontSize: '34px', fontWeight: '800', margin: '0 0 8px 0' });
  page.appendChild(h1);

  const lede = document.createElement('p');
  lede.textContent =
    'A fractal flame is the answer to a simple game played a few million times. ' +
    'This page takes the renderer apart and lets you watch each piece do its job.';
  Object.assign(lede.style, { color: COLORS.text.muted, fontSize: '17px', margin: '0 0 32px 0' });
  page.appendChild(lede);

  // Live demo handles, torn down when the page unmounts.
  const handles: Array<{ destroy(): void }> = [];

  // §5/§6 share one default: spherical at a low linear↔variation mix — a gently
  // bent Sierpinski that still reads as the scaffold (user-chosen).
  const DEFAULT_VAR_KIND: VarKind = 'spherical';
  const DEFAULT_VAR_WEIGHT = 0.15;
  const CATALOG_VIEW = { cx: 0, cy: 0.2, scale: 170 } as const;

  // ── Section 0 · What is a fractal? ─────────────────────────────────────────
  const s0 = buildSection('what-is-a-fractal', '0 · What is a fractal?');
  s0.appendChild(para(
    'A fractal is a shape with detail at every scale — zoom in and you keep finding ' +
    'structure, often echoing the whole. Drag the slider: at each step every triangle ' +
    'splits into three smaller copies of itself, forever.'));
  s0.appendChild(buildSelfSimilar());
  page.appendChild(s0);

  // ── Section 1 · What is a fractal flame? ───────────────────────────────────
  const s1 = buildSection('what-is-a-flame', '1 · What is a fractal flame?');
  s1.appendChild(para(
    'There are two ways to draw a fractal. Escape-time fractals (like the Mandelbrot set) ' +
    'run a formula at every pixel and ask whether it races off to infinity. A fractal flame ' +
    'works the other way: it plays a random "chaos game" with a handful of transforms, ' +
    'dropping points that pile up into an attractor — the stable shape those points settle ' +
    'into. That attractor, softened and coloured, is the flame. "Iterated function system" ' +
    'just means applying the same few transforms over and over; remarkably, that endless ' +
    'repetition — with no per-pixel test at all — converges to a precise, repeatable shape.'));
  s1.appendChild(buildMandelbrot());
  page.appendChild(s1);

  // ── Section 2 · The chaos game (flagship) ──────────────────────────────────
  const s2 = buildSection('chaos-game', '2 · The chaos game');
  s2.appendChild(para(
    'Pick one of a few transforms at random. Apply it to your current point to get a new ' +
    'point, and draw a dot there. Repeat. That is the entire algorithm — yet the dots pile ' +
    'up into a precise shape, and they converge to the same shape no matter where you start. ' +
    'Step by one to watch a single move; jump to +1000 to watch the whole attractor appear.'));
  const cornerName = ['A (top)', 'B (left)', 'C (right)'];
  const cornerColor = ['red', 'green', 'blue'];
  const moveLabel = (p: PlottedPoint, _f: DemoFlame): string =>
    `chose xform ${String.fromCharCode(65 + p.xform)} (prob 1/3) → jumped halfway toward corner ` +
    `${cornerName[p.xform]!} → plotted a ${cornerColor[p.xform]!} point`;
  const player2 = mountChaosPlayer({ flame: SIERPINSKI, annotate: true, moveLabel, seed: 11 });
  handles.push(player2);
  s2.appendChild(player2.el);
  page.appendChild(s2);

  // ── Section 3 · Xforms = affine transforms ─────────────────────────────────
  const s3 = buildSection('xforms', '3 · Xforms — affine transforms');
  s3.appendChild(para(
    'Each transform ("xform") is an affine map — it can scale, rotate, shear, and move ' +
    'space. These are exactly the five controls the editor shows for every xform. Drag them ' +
    'and watch the unit square (outline) warp into its image (filled).'));
  s3.appendChild(buildAffinePlayground());
  page.appendChild(s3);

  // ── Section 4 · Weights ────────────────────────────────────────────────────
  const s4 = buildSection('weights', '4 · Weights — which xform fires');
  s4.appendChild(para(
    'Transforms are not picked evenly — each has a weight, and the chance of firing is its ' +
    'share of the total weight. Raise one weight and its corner darkens as more points land there.'));
  const holder4 = document.createElement('div'); s4.appendChild(holder4);
  let player4: ChaosPlayerHandle | null = null;
  const w4 = [1, 1, 1];
  function rebuild4(): void {
    if (player4) { player4.destroy(); const i = handles.indexOf(player4); if (i >= 0) handles.splice(i, 1); }
    player4 = mountChaosPlayer({ flame: sierpinskiWithWeights(w4[0]!, w4[1]!, w4[2]!), seed: 5, mode: 'result', initialPoints: 8000 });
    handles.push(player4); holder4.replaceChildren(player4.el);
  }
  const wWrap = document.createElement('div');
  Object.assign(wWrap.style, { display: 'flex', gap: '14px', fontSize: '12px', color: COLORS.text.muted, marginTop: '6px', flexWrap: 'wrap' });
  ['A', 'B', 'C'].forEach((name, i) => {
    const lab = document.createElement('label'); lab.textContent = `weight ${name} `;
    const inp = document.createElement('input'); inp.type = 'range'; inp.min = '1'; inp.max = '8'; inp.step = '1'; inp.value = '1';
    // rebuild on `change` (drag-release), not `input` — each rebuild re-runs a
    // 30k-point pre-fill, too heavy to do on every continuous input event.
    inp.addEventListener('change', () => { w4[i] = +inp.value; rebuild4(); });
    lab.appendChild(inp); wWrap.appendChild(lab);
  });
  s4.appendChild(wWrap); rebuild4(); page.appendChild(s4);

  // ── Section 5 · Variations (flagship #2) ───────────────────────────────────
  const s5 = buildSection('variations', '5 · Variations — the nonlinear bend');
  s5.appendChild(para(
    'So far every transform was a straight affine map, so the attractor is made of straight ' +
    'pieces. A variation adds a nonlinear bend after the affine — the same warp the engine ' +
    'applies. Pick a variation and drag the weight (the linear↔variation mix); at weight 0 ' +
    'you see the rigid affine polygon underneath. Each is rendered exactly like its tile on ' +
    'the Variations page — same Sierpinski scaffold, same colours. (These run on the CPU, so ' +
    'it\'s the catalog\'s core math, not all 323 GPU variations.)'));
  const holder5 = document.createElement('div');
  const controls5 = document.createElement('div');
  Object.assign(controls5.style, { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '6px', fontSize: '12px', color: COLORS.text.muted });
  const sel = document.createElement('select');
  Object.assign(sel.style, { font: 'inherit', fontSize: '12px',
    background: '#111', color: COLORS.text.primary, border: `1px solid ${COLORS.border}`, borderRadius: '5px', padding: '4px 8px' });
  // CPU-ready (parameter-free, deterministic) catalog variations. CURATION: pare
  // this list down to the favourites once chosen.
  const VAR_CHOICES = ['none', 'spherical', 'swirl', 'polar',
    'horseshoe', 'handkerchief', 'heart', 'hyperbolic', 'diamond', 'disc', 'edisc',
    'bubble', 'butterfly', 'petal', 'loonie', 'loonie3', 'scry', 'foci', 'elliptic',
    'cosine', 'eyefish'];
  for (const k of VAR_CHOICES) {
    const o = document.createElement('option'); o.value = k; o.textContent = k; sel.appendChild(o);
  }
  sel.value = DEFAULT_VAR_KIND;
  const weightInp = document.createElement('input');
  weightInp.type = 'range'; weightInp.min = '0'; weightInp.max = '1'; weightInp.step = '0.01';
  weightInp.value = String(DEFAULT_VAR_WEIGHT); // low mix — gently bent Sierpinski (user pick)
  const weightLab = document.createElement('label'); weightLab.append(document.createTextNode('weight '), weightInp);
  controls5.append(sel, weightLab);
  let player5: ChaosPlayerHandle | null = null;
  function rebuild5(): void {
    if (player5) { player5.destroy(); const i = handles.indexOf(player5); if (i >= 0) handles.splice(i, 1); }
    const kind = sel.value === 'none' ? null : (sel.value as VarKind);
    // Catalog-faithful: same scaffold/mix/colours + the catalog view (scale 170, cy 0.2).
    player5 = mountChaosPlayer({ flame: catalogVariationFlame(kind, +weightInp.value), size: 384, view: CATALOG_VIEW, seed: 9, mode: 'result', initialPoints: 8000 });
    handles.push(player5); holder5.replaceChildren(player5.el);
  }
  sel.addEventListener('change', rebuild5);
  weightInp.addEventListener('change', rebuild5); // 'change' (release): rebuild re-animates ~2s
  s5.append(controls5, holder5); rebuild5(); page.appendChild(s5);

  // ── Section 6 · The final xform (lens) ─────────────────────────────────────
  const s6 = buildSection('final-xform', '6 · The final xform — a lens');
  s6.appendChild(para(
    'A variation (section 5) bends each xform on its own. The final xform is different: it is ' +
    'one extra transform applied to EVERY point after its own xform, just before the dot is ' +
    'drawn — a single lens over the whole image. This is the spherical flame from section 5; ' +
    'toggle the lens and a fisheye pulls the entire attractor into a disk at once — one warp ' +
    'applied to everything, not per-xform.'));
  const holder6 = document.createElement('div');
  const lens = document.createElement('label'); lens.style.fontSize = '12px'; lens.style.color = COLORS.text.muted;
  const cb = document.createElement('input'); cb.type = 'checkbox'; lens.append(cb, document.createTextNode(' apply final xform (fisheye lens)'));
  const IDENTITY: RawAffine = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
  let player6: ChaosPlayerHandle | null = null;
  function rebuild6(): void {
    if (player6) { player6.destroy(); const i = handles.indexOf(player6); if (i >= 0) handles.splice(i, 1); }
    // The flame from §5 (spherical at the shared default weight) so §6 reads as
    // "that same flame, now lensed." The lens is a final xform carrying an
    // eyefish (fisheye) variation — a genuinely global warp distinct from §5's
    // per-xform bend. Lens-off uses §5's catalog view; lens-on auto-fits (the
    // eyefish pulls everything into a tighter disk).
    const base = catalogVariationFlame(DEFAULT_VAR_KIND, DEFAULT_VAR_WEIGHT);
    const flame: DemoFlame = cb.checked
      ? { ...base, finalXform: { affine: IDENTITY, variation: { kind: 'eyefish', weight: 1 } } }
      : base;
    player6 = mountChaosPlayer({ flame, size: 384, view: cb.checked ? undefined : CATALOG_VIEW, seed: 3, mode: 'result', initialPoints: 8000 });
    handles.push(player6); holder6.replaceChildren(player6.el);
  }
  cb.addEventListener('change', rebuild6);
  s6.append(lens, holder6); rebuild6(); page.appendChild(s6);

  // ── Section 7 · From points to a picture (colour + glow) ───────────────────
  const s7 = buildSection('to-a-picture', '7 · From points to a picture');
  s7.appendChild(para(
    'Millions of points land in the same pixels. Counting hits gives a density map; showing ' +
    'it raw is nearly black, because a few pixels dominate. Taking the logarithm and a gamma ' +
    'curve is what makes a flame glow. Colour comes from the xforms too: each point remembers ' +
    'which xform created it and takes that xform\'s colour, looked up from a palette — the ' +
    'same hues you saw the dots take on.'));
  s7.appendChild(buildGlowDemo());
  const costLink = para('');
  const costA = document.createElement('a');
  costA.href = '/help/ifs-and-render-cost.html'; costA.target = '_blank'; costA.rel = 'noopener noreferrer';
  costA.textContent = 'More on render cost & quality ↗'; costA.style.color = COLORS.flame.mid;
  costLink.appendChild(costA); s7.appendChild(costLink);
  page.appendChild(s7);

  // ── Section 8 · Go make one ────────────────────────────────────────────────
  const s8 = buildSection('go-make-one', '8 · Go make one');
  const goNav = opts.nav ?? ((r: string) => { window.location.href = r; });
  const cta = document.createElement('div');
  Object.assign(cta.style, { display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '8px' });
  const card8 = (title: string, desc: string, route: string): HTMLElement => {
    const b = document.createElement('button'); b.type = 'button';
    Object.assign(b.style, { flex: '1 1 180px', textAlign: 'left', cursor: 'pointer', background: '#0f0f13',
      border: `1px solid ${COLORS.border}`, borderRadius: '8px', padding: '14px', color: COLORS.text.primary, font: 'inherit' });
    const h = document.createElement('div'); h.textContent = title; Object.assign(h.style, { fontWeight: '700', marginBottom: '4px', color: COLORS.flame.top });
    const d = document.createElement('div'); d.textContent = desc; Object.assign(d.style, { fontSize: '12px', color: COLORS.text.muted });
    b.append(h, d); b.addEventListener('click', () => goNav(route)); return b;
  };
  cta.append(
    card8('Open the Editor →', 'Build your own flame: xforms, variations, colour.', '/editor'),
    card8('Open the Viewer →', 'Load and explore an existing flame.', '/viewer'),
    card8('Browse variations →', 'Every nonlinear bend in the engine.', '/variations'),
  );
  s8.appendChild(cta); page.appendChild(s8);

  root.appendChild(page);

  window.addEventListener('pagehide', () => { for (const h of handles) h.destroy(); }, { once: true });
}
