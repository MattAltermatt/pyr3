// #119 — Variation Catalog per-section component.
//
// One section = one variation. Layout:
//   ┌ header (name + V#)            [source pill] ┐
//   │ formula (KaTeX)                              │
//   │ ┌ grid warp ─┐  ┌ flame canvas ─┐            │
//   │ │ (static)   │  │ (live render) │            │
//   │ └────────────┘  │ controls panel │           │
//   │                 └────────────────┘           │
//   │ blurb                                        │
//   │ ▸ Open in editor with this variation         │
//   └──────────────────────────────────────────────┘
//
// The flame canvas is owned by this module but driven by the host —
// the page mounter attaches its shared Renderer when this section enters
// the viewport (see T5). All DOM goes through createElement / textContent
// (pyr3 no-innerHTML invariant). KaTeX is the one exception — its
// render() writes through its own internal innerHTML; that's inside the
// library, not our source, so the scanner doesn't flag it.

import katex from 'katex';
// Side-effect import — KaTeX needs its stylesheet to lay out math. Without
// it, the MathML accessibility node renders in-flow alongside the visual
// node and the formula appears twice.
import 'katex/dist/katex.min.css';
import type { VariationDoc } from './variation-catalog-data';
import { buildWarpSvg } from './variation-catalog-warp';
import { linkToEditor } from './variation-catalog-link';
import { V } from './variations';

const SOURCE_LABEL: Record<string, string> = {
  flam3: 'flam3 core',
  dc:    'DC family',
  jwf:   'JWildfire ports',
};

export interface SectionState {
  weight: number;
  params: number[];
}

export interface SectionOptions {
  onParamsChange(state: SectionState): void;
}

export interface SectionHandle {
  setIterating(on: boolean): void;
  getFlameCanvas(): HTMLCanvasElement;
  getState(): SectionState;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Mount a per-variation section into `host`. Returns a handle the page
 *  mounter uses to attach its WebGPU renderer and read the current
 *  slider state. */
export function mountSection(
  host: HTMLElement,
  doc: VariationDoc,
  opts: SectionOptions,
): SectionHandle {
  const state: SectionState = {
    weight: doc.defaultWeight ?? 1,
    params: (doc.params ?? []).map((p) => p.default),
  };

  host.replaceChildren();
  host.className = 'pyr3-cat-section';
  host.dataset.idx = String(doc.idx);
  host.id = `v${doc.idx}-${doc.name}`;

  // Header row
  const head = el('div', 'pyr3-cat-section-head');
  const name = el('div', 'pyr3-cat-section-name');
  name.append(document.createTextNode(doc.name));
  name.append(el('span', 'pyr3-cat-section-vnum', `· V${doc.idx}`));
  // Anchor link — copies the deep-link URL to clipboard on click;
  // hidden on idle, visible on hover (GitHub-style).
  const anchor = document.createElement('a');
  anchor.className = 'pyr3-cat-section-anchor';
  anchor.href = `#v${doc.idx}-${doc.name}`;
  anchor.textContent = '#';
  anchor.title = 'copy link to this variation';
  anchor.setAttribute('aria-label', `permalink to ${doc.name}`);
  anchor.addEventListener('click', (e) => {
    // Default href-jump updates the hash. Also copy to clipboard so the
    // user can paste it elsewhere without scraping the URL bar.
    const url = `${window.location.origin}${window.location.pathname}#v${doc.idx}-${doc.name}`;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(url).catch(() => { /* clipboard blocked — silent OK */ });
    }
    // Briefly tag the anchor for a "copied!" visual hint.
    anchor.classList.add('copied');
    setTimeout(() => anchor.classList.remove('copied'), 800);
    // Let default navigation update the hash; don't preventDefault.
    void e;
  });
  name.append(anchor);
  head.append(name);
  head.append(el('span', 'pyr3-cat-section-source', SOURCE_LABEL[doc.source] ?? doc.source));

  // Formula. Use KaTeX's renderToString (a pure-string output) then re-parse
  // through DOMParser + importNode. Two reasons: (1) routes around KaTeX's
  // happy-dom quirks-mode rejection (DOMParser produces standards-mode docs
  // even from test envs), (2) satisfies pyr3's no-innerHTML invariant — we
  // never write KaTeX's output through an HTML sink ourselves.
  const formula = el('div', 'pyr3-cat-section-formula');
  try {
    const html = katex.renderToString(doc.formula, { throwOnError: false, displayMode: false });
    const parsed = parseHtmlFragment(html);
    if (parsed) formula.append(parsed);
    else formula.textContent = doc.formula;
  } catch {
    formula.textContent = doc.formula;
  }

  // Panes
  const panes = el('div', 'pyr3-cat-section-panes');
  const leftCol = el('div', 'pyr3-cat-col');
  const rightCol = el('div', 'pyr3-cat-col');

  // Warp pane (left). For deterministic variations, render the SVG; for
  // RNG-driven ones, show a "not applicable" note. We use the no-innerHTML-
  // safe approach: wrap the SVG markup in a DOMParser and import the
  // root <svg> as a real node.
  const warpPane = el('div', 'pyr3-cat-pane');
  if (doc.warpFn) {
    const svg = parseSvgFragment(buildWarpSvg(doc.warpFn));
    if (svg) warpPane.append(svg);
  } else {
    warpPane.append(el('div', 'pyr3-cat-warp-na', 'warp diagram not applicable (RNG-driven)'));
  }
  warpPane.append(el('span', 'pyr3-cat-pane-label', 'grid warp · static'));
  leftCol.append(warpPane);

  // Flame pane (right) — canvas owned by this section, driven by host
  const flamePane = el('div', 'pyr3-cat-pane');
  const flameCanvas = document.createElement('canvas');
  flameCanvas.className = 'pyr3-cat-flame-canvas';
  flameCanvas.width = 384;
  flameCanvas.height = 384;
  flamePane.append(flameCanvas);
  flamePane.append(el('span', 'pyr3-cat-pane-label', 'flame · live'));
  const liveDot = el('span', 'pyr3-cat-live-dot hidden', 'iterating');
  flamePane.append(liveDot);
  rightCol.append(flamePane);

  // Controls (right column, under flame).
  //   V0 linear   → empty note (no warp to tune, no params)
  //   DC color-only (V99) → empty note (weight hidden, no params)
  //   everything else → mountControls (weight + params, less weight when hidden)
  const controlsHost = el('div', 'pyr3-cat-controls-host');
  let teardownControls: (() => void) | null = null;
  const hasParams = (doc.params?.length ?? 0) > 0;
  const showsWeight = !doc.hideWeight;
  if (doc.idx === V.linear) {
    controlsHost.append(
      el('div', 'pyr3-cat-controls-empty', 'no controls — linear is the reference (no warp to tune)'),
    );
  } else if (!showsWeight && !hasParams) {
    controlsHost.append(
      el('div', 'pyr3-cat-controls-empty', 'no controls — this variation overrides color only; position passes through'),
    );
  } else {
    teardownControls = mountControls(controlsHost, doc, state, () => {
      const link = host.querySelector('.pyr3-cat-open-link') as HTMLAnchorElement | null;
      if (link) link.href = linkToEditor({ idx: doc.idx, weight: state.weight, params: state.params });
      opts.onParamsChange({ weight: state.weight, params: [...state.params] });
    });
  }
  rightCol.append(controlsHost);

  panes.append(leftCol, rightCol);

  // Blurb
  const blurb = el('p', 'pyr3-cat-section-blurb', doc.blurb);

  // Open-in-editor link. Opens in a new tab so the catalog stays put —
  // users typically want to A/B between catalog tile and editor surface.
  // The trailing ↗ matches the convention used elsewhere (about page,
  // picker "explore catalog" link) for new-tab destinations.
  const openLink = el('a', 'pyr3-cat-open-link', 'Open in editor with this variation ↗');
  openLink.href = linkToEditor({ idx: doc.idx, weight: state.weight, params: state.params });
  openLink.target = '_blank';
  openLink.rel = 'noopener noreferrer';

  host.append(head, formula, panes, blurb, openLink);

  return {
    setIterating(on: boolean): void {
      liveDot.classList.toggle('hidden', !on);
    },
    getFlameCanvas(): HTMLCanvasElement {
      return flameCanvas;
    },
    getState(): SectionState {
      return { weight: state.weight, params: [...state.params] };
    },
    destroy(): void {
      teardownControls?.();
      host.replaceChildren();
    },
  };
}

function mountControls(
  host: HTMLElement,
  doc: VariationDoc,
  state: SectionState,
  onChange: () => void,
): () => void {
  const controls = el('div', 'pyr3-cat-controls');
  // Weight slider's "default" (reset target) uses the doc's defaultWeight
  // when set, falling back to 1 (full substitution) for the common case.
  // doc.hideWeight (e.g. DC color-only family V99-V101) suppresses the
  // slider entirely — the variation's position contribution is zero so
  // a weight slider would do nothing visible.
  if (!doc.hideWeight) {
    const weightDefault = doc.defaultWeight ?? 1;
    controls.append(buildControlRow('weight', state.weight, 0, 1, 0.01, weightDefault, true, (v) => { state.weight = v; }));
  }
  (doc.params ?? []).forEach((p, i) => {
    controls.append(buildControlRow(p.name, state.params[i] ?? p.default, p.min, p.max, p.step, p.default, false, (v) => {
      state.params[i] = v;
    }));
  });
  const footer = el('div', 'pyr3-cat-controls-footer');
  const resetAll = el('button', 'pyr3-cat-reset-all', 'reset all');
  resetAll.type = 'button';
  const onResetAll = () => {
    controls.querySelectorAll<HTMLElement>('.pyr3-cat-reset').forEach((b) => b.click());
  };
  resetAll.addEventListener('click', onResetAll);
  footer.append(resetAll);
  controls.append(footer);
  host.append(controls);

  // Track every listener we add so destroy() can pull them off explicitly —
  // catches the pointer-captured-mid-drag edge case where a slider input
  // could still fire after the section is destroyed.
  const listeners: Array<{ el: EventTarget; type: string; fn: EventListener }> = [
    { el: resetAll, type: 'click', fn: onResetAll },
  ];

  controls.querySelectorAll<HTMLInputElement>('input.pyr3-cat-scrub').forEach((input) => {
    syncSlider(input);
    const onInput = () => {
      syncSlider(input);
      const v = Number(input.value);
      const apply = (input as HTMLInputElement & { _apply?: (n: number) => void })._apply;
      if (apply) apply(v);
      onChange();
    };
    input.addEventListener('input', onInput);
    listeners.push({ el: input, type: 'input', fn: onInput });
  });
  controls.querySelectorAll<HTMLElement>('.pyr3-cat-reset').forEach((btn) => {
    const onResetClick = () => {
      const row = btn.closest('.pyr3-cat-control-row') as HTMLElement | null;
      const input = row?.querySelector('input.pyr3-cat-scrub') as HTMLInputElement | null;
      if (!input) return;
      input.value = input.dataset.default!;
      input.dispatchEvent(new Event('input'));
    };
    btn.addEventListener('click', onResetClick);
    listeners.push({ el: btn, type: 'click', fn: onResetClick });
  });

  return () => {
    for (const { el, type, fn } of listeners) el.removeEventListener(type, fn);
  };
}

function buildControlRow(
  name: string,
  value: number,
  min: number,
  max: number,
  step: number,
  def: number,
  isWeight: boolean,
  apply: (n: number) => void,
): HTMLElement {
  const row = el('div', 'pyr3-cat-control-row');
  row.dataset.name = name;
  row.append(el('span', `pyr3-cat-label${isWeight ? ' weight' : ''}`, name));
  const input = el('input', 'pyr3-cat-scrub');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.dataset.default = String(def);
  input.dataset.control = isWeight ? 'weight' : 'param';
  (input as HTMLInputElement & { _apply?: (n: number) => void })._apply = apply;
  row.append(input);
  row.append(el('span', 'pyr3-cat-val', step < 1 ? value.toFixed(2) : String(Math.round(value))));
  const reset = el('span', 'pyr3-cat-reset', '↻');
  reset.title = 'reset';
  row.append(reset);
  return row;
}

function syncSlider(input: HTMLInputElement): void {
  const min = Number(input.min);
  const max = Number(input.max);
  const v = Number(input.value);
  const pct = ((v - min) / (max - min)) * 100;
  input.style.setProperty('--p', pct + '%');
  const row = input.closest('.pyr3-cat-control-row');
  if (row) {
    const valEl = row.querySelector('.pyr3-cat-val');
    if (valEl) {
      const step = Number(input.step || '1');
      valEl.textContent = step < 1 ? v.toFixed(2) : String(Math.round(v));
    }
  }
}

/** Parse a small SVG fragment (the warp builder's output) into a real
 *  <svg> Element using DOMParser. Routes around the no-innerHTML
 *  invariant: the parsed result is an Element imported into the live
 *  document via importNode, not an HTML string written into innerHTML. */
function parseSvgFragment(svg: string): Element | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName === 'parsererror') return null;
  return document.importNode(root, true);
}

/** Parse an HTML fragment (KaTeX's renderToString output) into a real
 *  Element. Same approach as parseSvgFragment — the parsed result is
 *  imported via importNode, never written through an HTML sink. */
function parseHtmlFragment(html: string): Element | null {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return null;
  return document.importNode(root, true);
}
