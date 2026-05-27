// Top-bar mount + state handle.
//
// Owns all UI chrome state per the v1 spec — two persistent tiers
// (identity row, action row) and an optional third tier (4K render
// progress) that mounts only mid-render.
//
// The module is intentionally self-contained: it injects its own
// stylesheet once on first mount and returns a handle the rest of
// the app uses to push state through. DOM construction uses
// createElement + textContent (never innerHTML) so flame names and
// author nicks from untrusted .flame XML can't smuggle script.

import type { WebGPUStatus } from './webgpu-check';

export interface BarMeta {
  flameName: string;
  authorNick?: string;
  sourceFilename?: string;
}

export interface BarOpts {
  webgpu: WebGPUStatus;
  onOpenFile: () => void;
  onRender4K: () => void;
  onShareLink: () => void;
  onWordmark: () => void;
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
  setBusy(busy: boolean): void;
  // Transient "rendering…" indicator next to the meta block, plus
  // disables tier-2 buttons. Use for slow quick renders or file
  // parsing — anything where the visitor would otherwise stare at
  // an unchanged UI wondering whether the app is dead.
  setLoading(loading: boolean): void;
  showProgress(p: ProgressDisplay): void;
  hideProgress(): void;
  showToast(text: string): void;
}

let stylesInjected = false;

export function mountBar(root: HTMLElement, opts: BarOpts): BarHandle {
  injectStylesOnce();
  root.replaceChildren();
  root.classList.add('pyr3-bar-root');

  const tier1 = buildTier1(opts);
  const tier2 = buildTier2(opts);
  root.append(tier1, tier2.row);

  let tier3: Tier3 | null = null;
  let toastTimeout: ReturnType<typeof setTimeout> | null = null;

  return {
    setMeta(meta) {
      renderMetaName(tier2.metaName, meta);
      tier2.metaFilename.textContent = meta.sourceFilename ?? '';
      tier2.metaFilename.style.display = meta.sourceFilename ? '' : 'none';
    },
    setBusy(busy) {
      for (const btn of [tier2.openBtn, tier2.renderBtn, tier2.shareBtn]) {
        btn.disabled = busy;
      }
    },
    setLoading(loading) {
      for (const btn of [tier2.openBtn, tier2.renderBtn, tier2.shareBtn]) {
        btn.disabled = loading;
      }
      tier2.status.textContent = loading ? 'rendering…' : '';
      tier2.status.classList.toggle('visible', loading);
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
      tier2.toast.textContent = text;
      tier2.toast.classList.add('visible');
      if (toastTimeout) clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => {
        tier2.toast.classList.remove('visible');
      }, 2500);
    },
  };
}

function buildTier1(opts: BarOpts): HTMLElement {
  const tier = el('div', 'pyr3-bar-tier1');

  const wordmark = el('a', 'pyr3-bar-wordmark') as HTMLAnchorElement;
  wordmark.href = '#';
  wordmark.textContent = '🔥 pyr3';
  wordmark.onclick = (e) => {
    e.preventDefault();
    opts.onWordmark();
  };

  const spacer = el('span');
  spacer.style.flex = '1';

  const webgpuChip = buildWebGPUChip(opts.webgpu);
  const pyr3Chip = buildCtaChip('WANT TO MAKE ONE?', 'pyr3 ↗', 'https://github.com/MattAltermatt/pyr3');
  const esfChip = buildCtaChip('WANT MORE SHEEP?', 'ESF ↗', 'https://github.com/MattAltermatt/electric-sheep-fold');

  tier.append(wordmark, spacer, webgpuChip, pyr3Chip, esfChip);
  return tier;
}

function buildWebGPUChip(status: WebGPUStatus): HTMLAnchorElement {
  const a = el('a', 'pyr3-bar-webgpu') as HTMLAnchorElement;
  const mark = el('span', 'pyr3-bar-webgpu-mark');
  const tag = el('span', 'pyr3-bar-webgpu-tag');
  if (status.available) {
    a.classList.add('ok');
    a.href = '/help/webgpu.html#what-is-webgpu';
    mark.textContent = '✓';
    tag.textContent = "what's this?";
  } else {
    a.classList.add('err');
    a.href = '/help/webgpu.html#why-not-working';
    mark.textContent = '✗';
    tag.textContent = 'why?';
  }
  a.append(document.createTextNode('WebGPU '), mark, document.createTextNode(' '), tag);
  return a;
}

function buildCtaChip(tagline: string, label: string, href: string): HTMLAnchorElement {
  const chip = el('a', 'pyr3-bar-cta') as HTMLAnchorElement;
  chip.href = href;
  chip.target = '_blank';
  chip.rel = 'noopener noreferrer';
  const tagEl = el('span', 'pyr3-bar-cta-tag');
  tagEl.textContent = tagline;
  const labelEl = el('span', 'pyr3-bar-cta-label');
  labelEl.textContent = label;
  chip.append(tagEl, labelEl);
  return chip;
}

interface Tier2 {
  row: HTMLElement;
  metaName: HTMLElement;
  metaFilename: HTMLElement;
  openBtn: HTMLButtonElement;
  renderBtn: HTMLButtonElement;
  shareBtn: HTMLButtonElement;
  toast: HTMLElement;
  status: HTMLElement;
}

function buildTier2(opts: BarOpts): Tier2 {
  const row = el('div', 'pyr3-bar-tier2');
  const meta = el('div', 'pyr3-bar-meta');
  const metaName = el('div', 'pyr3-bar-meta-name');
  const metaFilename = el('div', 'pyr3-bar-meta-filename');
  metaFilename.style.display = 'none';
  meta.append(metaName, metaFilename);

  const status = el('span', 'pyr3-bar-status');
  const toast = el('span', 'pyr3-bar-toast');
  const spacer = el('span');
  spacer.style.flex = '1';

  const openBtn = button('📂 Open .flame', 'pyr3-bar-btn', opts.onOpenFile);
  const renderBtn = button('🎯 Render 4K', 'pyr3-bar-btn pyr3-bar-btn-accent', opts.onRender4K);
  const shareBtn = button('🔗 Share link', 'pyr3-bar-btn', opts.onShareLink);

  row.append(meta, status, toast, spacer, openBtn, renderBtn, shareBtn);
  return { row, metaName, metaFilename, openBtn, renderBtn, shareBtn, toast, status };
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
  why.href = '/help/ifs-and-render-cost.html';
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
    target.append(document.createTextNode(' · '));
    const author = el('span', 'pyr3-bar-meta-author');
    author.textContent = `By ${meta.authorNick}`;
    target.append(author);
  }
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
  /* Buttons + chips don't want accidental text selection.
   * .pyr3-bar-meta-name / .pyr3-bar-meta-filename override this
   * so the visitor can copy the current flame's identity.
   */
  user-select: none;
}

.pyr3-bar-tier1 {
  display: flex; align-items: center; gap: 14px;
  padding: 8px 14px; font-size: 11px;
  background: var(--bar-bg-1); border-bottom: 1px solid var(--bar-border);
}
.pyr3-bar-wordmark {
  color: var(--accent); font-weight: 600; font-size: 12px;
  text-decoration: none; cursor: pointer;
}
.pyr3-bar-wordmark:hover { text-decoration: underline; }

.pyr3-bar-webgpu {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 9px; border-radius: 12px; font-size: 11px;
  text-decoration: none;
}
.pyr3-bar-webgpu.ok {
  color: var(--ok); background: rgba(154,255,122,0.08);
  border: 1px solid rgba(154,255,122,0.35);
}
.pyr3-bar-webgpu.err {
  color: var(--err); background: rgba(255,122,122,0.1);
  border: 1px solid rgba(255,122,122,0.4);
}
.pyr3-bar-webgpu-mark { font-weight: 700; }
.pyr3-bar-webgpu-tag { font-size: 9px; text-decoration: underline; opacity: 0.75; }

.pyr3-bar-cta {
  display: flex; flex-direction: column; align-items: center;
  line-height: 1.1; gap: 1px;
  text-decoration: none; cursor: pointer;
}
.pyr3-bar-cta-tag {
  color: var(--text-dim); font-size: 9px; letter-spacing: 0.05em;
}
.pyr3-bar-cta-label {
  color: var(--accent); font-weight: 500; font-size: 11px;
}
.pyr3-bar-cta:hover .pyr3-bar-cta-label { text-decoration: underline; }

.pyr3-bar-tier2 {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 14px; font-size: 11px;
  background: var(--bar-bg-2); border-bottom: 1px solid var(--bar-border);
}
.pyr3-bar-meta { display: flex; flex-direction: column; line-height: 1.2; }
.pyr3-bar-meta-name { color: var(--text); user-select: text; cursor: text; }
.pyr3-bar-meta-author { color: var(--text-muted); }
.pyr3-bar-meta-filename {
  color: var(--text-dim); font-family: ui-monospace, monospace; font-size: 9px;
  user-select: text; cursor: text;
}

.pyr3-bar-status {
  color: var(--accent); font-size: 10px; opacity: 0;
  margin-left: 12px; transition: opacity 0.2s ease;
  font-style: italic;
}
.pyr3-bar-status.visible { opacity: 1; animation: pyr3-pulse 1.4s ease-in-out infinite; }
@keyframes pyr3-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.pyr3-bar-toast {
  color: var(--accent); font-size: 10px; opacity: 0;
  margin-left: 10px; transition: opacity 0.15s ease;
}
.pyr3-bar-toast.visible { opacity: 1; }

.pyr3-bar-btn {
  font-size: 10px; padding: 3px 9px; border-radius: 3px;
  background: #222; color: var(--text); border: 1px solid #444;
  cursor: pointer; font-family: inherit;
}
.pyr3-bar-btn:hover:not(:disabled) { background: #2a2a30; }
.pyr3-bar-btn:disabled {
  background: #1a1a1f; color: #555; border-color: #2a2a30;
  cursor: not-allowed;
}
.pyr3-bar-btn-accent {
  background: var(--accent-soft); color: #ffb56e; border-color: var(--accent-border);
}
.pyr3-bar-btn-accent:hover:not(:disabled) { background: rgba(255,140,26,0.28); }
.pyr3-bar-btn-accent:disabled {
  background: #1f1810; color: #7a4a1a; border-color: #2e2014;
}

.pyr3-bar-tier3 {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 14px; font-size: 11px;
  background: var(--bar-bg-3); border-bottom: 1px solid var(--bar-border);
}
.pyr3-tier3-label { color: #ffb56e; font-weight: 500; white-space: nowrap; }
.pyr3-tier3-bar {
  flex: 1; height: 8px; min-width: 120px;
  background: #332215; border-radius: 4px; overflow: hidden;
}
.pyr3-tier3-fill {
  height: 100%; width: 0%;
  background: linear-gradient(90deg, var(--accent) 0%, #ffb56e 100%);
  transition: width 0.2s ease;
}
.pyr3-tier3-pct { color: #ffb56e; font-weight: 500; white-space: nowrap; }
.pyr3-tier3-eta { color: var(--text-dim); font-size: 10px; white-space: nowrap; }
.pyr3-tier3-why {
  color: var(--text-dim); font-size: 10px; text-decoration: underline;
  white-space: nowrap;
}
.pyr3-tier3-cancel {
  font-size: 10px; padding: 4px 11px; border-radius: 3px;
  background: #332215; color: #ffb56e; border: 1px solid var(--accent-border);
  font-weight: 500; cursor: pointer; white-space: nowrap; font-family: inherit;
}
.pyr3-tier3-cancel:hover { background: rgba(255,140,26,0.28); }
`;
