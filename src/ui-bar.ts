// Top-bar mount + state handle.
//
// Single slim row (v1.0 polish) — three flex zones:
//   · left:   wordmark (→ home) · about · flame name · "by nick"
//   · center: Open
//   · right:  WebGPU pill · "fork it" octocat · "more flames" octocat
// Plus an optional progress detail row that mounts only during render.
//
// DOM is built with createElement + textContent (never innerHTML) so flame
// names + author nicks from untrusted .flame XML can't smuggle script. The SVG
// octocat is assembled via createElementNS for the same reason.

import type { WebGPUStatus } from './webgpu-check';

export interface BarMeta {
  flameName: string;
  authorNick?: string;
  /** Accepted for back-compat; not shown in the v1.0 bar. */
  sourceFilename?: string;
}

export interface BarOpts {
  webgpu: WebGPUStatus;
  onOpenFile: () => void;
  /** Render the current flame at 4K via the decoupled orchestrator.
   *  Opt-in heavy render — quick mode stays the default first paint. */
  onRender4K: () => void;
}

export interface ProgressDisplay {
  label: string;
  percent: number;
  etaSeconds: number;
  samples: number;
  onCancel: () => void;
}

export interface BarHandle {
  setMeta(meta: BarMeta): void;
  // Disables the Open button during a load-in-flight.
  setBusy(busy: boolean): void;
  showProgress(p: ProgressDisplay): void;
  hideProgress(): void;
  showToast(text: string): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
// Canonical GitHub octocat mark.
const OCTOCAT_PATH =
  'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z';

let stylesInjected = false;

export function mountBar(root: HTMLElement, opts: BarOpts): BarHandle {
  injectStylesOnce();
  root.replaceChildren();
  root.classList.add('pyr3-bar-root');

  const row = el('div', 'pyr3-bar-row');

  // ---- left zone: wordmark · about · name · by nick ----
  const left = el('div', 'pyr3-zone-left');
  const wordmark = el('a', 'pyr3-bar-wordmark') as HTMLAnchorElement;
  wordmark.href = import.meta.env.BASE_URL; // home (welcome flame), base-aware
  wordmark.textContent = '🔥 pyr3';
  const about = el('a', 'pyr3-bar-about') as HTMLAnchorElement;
  about.href = `${import.meta.env.BASE_URL}help/about.html`;
  about.textContent = 'about';
  const metaName = el('div', 'pyr3-bar-meta-name');
  left.append(wordmark, sep(), about, sep(), metaName);

  // ---- center zone: Open · 4K ----
  const center = el('div', 'pyr3-zone-center');
  const openBtn = button('📂 Open', 'pyr3-bar-btn', opts.onOpenFile);
  const render4kBtn = button('🎯 4K', 'pyr3-bar-btn', opts.onRender4K);
  render4kBtn.title = 'Render the current flame at 4K — watch it build progressively';
  center.append(openBtn, render4kBtn);

  // ---- right zone: WebGPU pill · octocat CTAs ----
  const right = el('div', 'pyr3-zone-right');
  const webgpuChip = buildWebGPUChip(opts.webgpu);
  const forkCta = buildOctocatCta('fork it', 'pyr3 on github', 'https://github.com/MattAltermatt/pyr3');
  const sheepCta = buildOctocatCta('more flames', 'electric sheep fold', 'https://github.com/MattAltermatt/electric-sheep-fold');
  right.append(webgpuChip, forkCta, sheepCta);

  row.append(left, center, right);
  root.append(row);

  let tier3: Tier3 | null = null;
  let toastTimeout: ReturnType<typeof setTimeout> | null = null;
  // Toast rides in the left zone next to the meta name.
  const toast = el('span', 'pyr3-bar-toast');
  left.append(toast);

  return {
    setMeta(meta) {
      renderMetaName(metaName, meta);
    },
    setBusy(busy) {
      openBtn.disabled = busy;
      render4kBtn.disabled = busy;
    },
    showProgress(p) {
      if (!tier3) {
        tier3 = buildTier3();
        root.append(tier3.row);
      }
      tier3.label.textContent = p.label;
      tier3.fill.style.width = `${Math.round(p.percent * 100)}%`;
      tier3.pct.textContent = `${Math.round(p.percent * 100)}%`;
      tier3.eta.textContent = `~${Math.max(0, Math.round(p.etaSeconds))}s left · ${formatSamples(p.samples)}`;
      tier3.cancel.onclick = p.onCancel;
    },
    hideProgress() {
      if (tier3) {
        tier3.row.remove();
        tier3 = null;
      }
    },
    showToast(text) {
      toast.textContent = text;
      toast.classList.add('visible');
      if (toastTimeout) clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => toast.classList.remove('visible'), 2500);
    },
  };
}

function buildWebGPUChip(status: WebGPUStatus): HTMLAnchorElement {
  const a = el('a', 'pyr3-bar-webgpu') as HTMLAnchorElement;
  if (status.available) {
    a.classList.add('ok');
    a.href = `${import.meta.env.BASE_URL}help/webgpu.html#what-is-webgpu`;
    a.textContent = 'WebGPU ✓';
  } else {
    a.classList.add('err');
    a.href = `${import.meta.env.BASE_URL}help/webgpu.html#why-not-working`;
    a.textContent = 'WebGPU ✗ why?';
  }
  return a;
}

function buildOctocatCta(topLabel: string, sub: string, href: string): HTMLAnchorElement {
  const a = el('a', 'pyr3-bar-cta') as HTMLAnchorElement;
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  const top = el('span', 'pyr3-cta-top');
  top.append(octocat(), document.createTextNode(topLabel));
  const arr = el('span', 'pyr3-cta-arr');
  arr.textContent = '↗';
  top.append(arr);
  const tag = el('span', 'pyr3-cta-tag');
  tag.textContent = sub;
  a.append(top, tag);
  return a;
}

function octocat(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.classList.add('pyr3-octocat');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', OCTOCAT_PATH);
  svg.appendChild(path);
  return svg;
}

interface Tier3 {
  row: HTMLElement;
  label: HTMLElement;
  fill: HTMLElement;
  pct: HTMLElement;
  eta: HTMLElement;
  cancel: HTMLButtonElement;
}

function buildTier3(): Tier3 {
  const row = el('div', 'pyr3-bar-tier3');
  const label = el('span', 'pyr3-tier3-label');
  const bar = el('div', 'pyr3-tier3-bar');
  const fill = el('div', 'pyr3-tier3-fill');
  bar.append(fill);
  const pct = el('span', 'pyr3-tier3-pct');
  const eta = el('span', 'pyr3-tier3-eta');
  const why = el('a', 'pyr3-tier3-why') as HTMLAnchorElement;
  why.href = `${import.meta.env.BASE_URL}help/ifs-and-render-cost.html`;
  why.target = '_blank';
  why.rel = 'noopener noreferrer';
  why.textContent = 'Why so long? ↗';
  const cancel = button('✕ Cancel', 'pyr3-tier3-cancel', () => {});
  row.append(label, bar, pct, eta, why, cancel);
  return { row, label, fill, pct, eta, cancel };
}

function renderMetaName(target: HTMLElement, meta: BarMeta): void {
  target.replaceChildren();
  const name = document.createElement('strong');
  name.textContent = meta.flameName || 'Untitled';
  target.append(name);
  if (meta.authorNick) {
    target.append(sep());
    const author = el('span', 'pyr3-bar-meta-author');
    author.textContent = `by ${meta.authorNick}`;
    target.append(author);
  }
}

function sep(): HTMLElement {
  const s = el('span', 'pyr3-bar-sep');
  s.textContent = '·';
  return s;
}

function el(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function button(label: string, className: string, onclick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = className;
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

function formatSamples(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M samples`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K samples`;
  return `${n} samples`;
}

function injectStylesOnce(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = BAR_CSS;
  document.head.appendChild(style);
}

const BAR_CSS = `
.pyr3-bar-root {
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  user-select: none;
}
.pyr3-bar-row {
  display: flex; align-items: center;
  padding: 8px 14px; font-size: 12px;
  background: var(--bar-bg-2); border-bottom: 1px solid var(--bar-border);
}
.pyr3-zone-left { flex: 1 1 0; display: flex; align-items: center; gap: 8px; min-width: 0; }
.pyr3-zone-center { flex: 0 0 auto; display: flex; justify-content: center; gap: 8px; }
.pyr3-zone-right { flex: 1 1 0; display: flex; align-items: center; gap: 14px; justify-content: flex-end; }

.pyr3-bar-wordmark {
  color: var(--accent); font-weight: 600; text-decoration: none; white-space: nowrap;
}
.pyr3-bar-wordmark:hover { text-decoration: underline; }
.pyr3-bar-about { color: var(--text-dim); font-size: 11px; text-decoration: none; white-space: nowrap; }
.pyr3-bar-about:hover { color: var(--text-muted); text-decoration: underline; }
.pyr3-bar-sep { color: var(--text-dim); }
.pyr3-bar-meta-name { color: var(--text); user-select: text; cursor: text; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pyr3-bar-meta-author { color: var(--text-muted); }

.pyr3-bar-webgpu {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 14px; border-radius: 14px; font-size: 12px; font-weight: 500;
  text-decoration: none; white-space: nowrap;
}
.pyr3-bar-webgpu.ok { color: var(--ok); background: rgba(154,255,122,0.10); border: 1px solid rgba(154,255,122,0.5); }
.pyr3-bar-webgpu.err { color: var(--err); background: rgba(255,122,122,0.1); border: 1px solid rgba(255,122,122,0.4); }

.pyr3-bar-cta { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 1px; line-height: 1.15; text-decoration: none; }
.pyr3-cta-top { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); font-size: 12px; font-weight: 500; white-space: nowrap; }
.pyr3-octocat { width: 15px; height: 15px; fill: currentColor; }
.pyr3-cta-arr { font-size: 10px; }
.pyr3-cta-tag { color: var(--text-dim); font-size: 9px; letter-spacing: 0.02em; white-space: nowrap; }
.pyr3-bar-cta:hover .pyr3-cta-top { text-decoration: underline; }

.pyr3-bar-btn {
  font-size: 11px; padding: 4px 14px; border-radius: 3px;
  background: #222; color: var(--text); border: 1px solid #444; cursor: pointer; font-family: inherit;
}
.pyr3-bar-btn:hover:not(:disabled) { background: #2a2a30; }
.pyr3-bar-btn:disabled { background: #1a1a1f; color: #555; border-color: #2a2a30; cursor: not-allowed; }

.pyr3-bar-toast { color: var(--accent); font-size: 10px; opacity: 0; margin-left: 10px; transition: opacity 0.15s ease; }
.pyr3-bar-toast.visible { opacity: 1; }

.pyr3-bar-tier3 {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 14px; font-size: 11px;
  background: var(--bar-bg-3); border-bottom: 1px solid var(--bar-border);
}
.pyr3-tier3-label { color: #ffb56e; font-weight: 500; white-space: nowrap; }
.pyr3-tier3-bar { flex: 1; height: 8px; min-width: 120px; background: #332215; border-radius: 4px; overflow: hidden; }
.pyr3-tier3-fill { height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent) 0%, #ffb56e 100%); transition: width 0.2s ease; }
.pyr3-tier3-pct { color: #ffb56e; font-weight: 500; white-space: nowrap; }
.pyr3-tier3-eta { color: var(--text-dim); font-size: 10px; white-space: nowrap; }
.pyr3-tier3-why { color: var(--text-dim); font-size: 10px; text-decoration: underline; white-space: nowrap; }
.pyr3-tier3-cancel {
  font-size: 10px; padding: 4px 11px; border-radius: 3px;
  background: #332215; color: #ffb56e; border: 1px solid var(--accent-border);
  font-weight: 500; cursor: pointer; white-space: nowrap; font-family: inherit;
}
.pyr3-tier3-cancel:hover { background: rgba(255,140,26,0.28); }
`;
