// pyr3 — /v1/edit info-icon + anchored popover (Phase 7 visual overhaul).
//
// buildInfoIcon returns a `?` glyph; clicking it toggles an explainer
// popover anchored to the icon's nearest `.pyr3-section` ancestor. The
// popover renders an amber title, a body paragraph, and an optional dim
// "leave at default" hint. Right-side anchor by default; falls back to
// the left when the viewport has no room.
//
// The outside-click dismissal handler is wired in the capture phase on
// the next macrotask so the click that opened the tooltip doesn't
// immediately close it.

import { COLORS } from './ui-tokens';

const TOOLTIP_WIDTH = 250;
const ANCHOR_GAP = 14;

export interface InfoIconOpts {
  title: string;
  body: string;
  hint?: string;
}

export function buildInfoIcon(opts: InfoIconOpts): HTMLElement {
  const icon = document.createElement('span');
  icon.className = 'pyr3-info-icon';
  icon.textContent = '?';
  icon.style.display = 'inline-flex';
  icon.style.alignItems = 'center';
  icon.style.justifyContent = 'center';
  icon.style.width = '14px';
  icon.style.height = '14px';
  icon.style.fontSize = '10px';
  icon.style.borderRadius = '50%';
  icon.style.border = `1px solid ${COLORS.border}`;
  icon.style.background = 'transparent';
  icon.style.color = COLORS.text.muted;
  icon.style.cursor = 'help';
  icon.style.userSelect = 'none';
  icon.style.marginLeft = '4px';
  icon.style.flex = '0 0 auto';

  icon.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleTooltip(icon, opts);
  });
  return icon;
}

function toggleTooltip(anchor: HTMLElement, opts: InfoIconOpts): void {
  const existing = document.querySelector('.pyr3-tooltip');
  if (existing) {
    existing.remove();
    return;
  }
  const tip = buildTooltipBody(opts);
  // Anchor beside the whole section panel when we're inside one (editor
  // accordion), else beside the icon itself (bar / topbar controls).
  const sect = anchor.closest('.pyr3-section') as HTMLElement | null;
  document.body.appendChild(tip);
  positionTooltip(tip, sect ?? anchor);

  // Outside-click dismiss — register on the next macrotask so the click
  // that opened us doesn't immediately close us.
  setTimeout(() => {
    const dismiss = (ev: MouseEvent): void => {
      if (!tip.contains(ev.target as Node)) {
        tip.remove();
        document.removeEventListener('click', dismiss, true);
      }
    };
    document.addEventListener('click', dismiss, true);
  }, 0);
}

function buildTooltipBody(opts: InfoIconOpts): HTMLElement {
  const tip = document.createElement('div');
  tip.className = 'pyr3-tooltip';
  tip.style.position = 'fixed';
  tip.style.zIndex = '200';
  tip.style.width = `${TOOLTIP_WIDTH}px`;
  tip.style.padding = '10px 12px';
  tip.style.background = COLORS.bg.panel;
  tip.style.border = `1px solid ${COLORS.border}`;
  tip.style.borderRadius = '4px';
  tip.style.boxShadow = '0 4px 18px rgba(0,0,0,0.6)';
  tip.style.color = COLORS.text.primary;
  tip.style.fontSize = '12px';
  tip.style.lineHeight = '1.4';

  const title = document.createElement('div');
  title.className = 'pyr3-tooltip-title';
  title.textContent = opts.title;
  title.style.color = COLORS.flame.top;
  title.style.fontWeight = '600';
  title.style.marginBottom = '4px';
  tip.appendChild(title);

  const body = document.createElement('div');
  body.className = 'pyr3-tooltip-body';
  body.textContent = opts.body;
  body.style.color = COLORS.text.primary;
  tip.appendChild(body);

  if (opts.hint) {
    const hint = document.createElement('div');
    hint.className = 'pyr3-tooltip-hint';
    hint.textContent = opts.hint;
    hint.style.marginTop = '6px';
    // Readable on the dark panel — distinguished by italics, NOT by a
    // low-contrast gray (gray-on-black is hard to read).
    hint.style.color = COLORS.text.primary;
    hint.style.fontStyle = 'italic';
    tip.appendChild(hint);
  }
  return tip;
}

function positionTooltip(tip: HTMLElement, anchorEl: HTMLElement): void {
  const r = anchorEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const M = 8; // keep at least this much gap from any viewport edge
  // Measured rendered size (TOOLTIP_WIDTH is the content box; padding + border
  // make the real width larger, so clamp against the actual offsetWidth).
  // Falls back to TOOLTIP_WIDTH when offsetWidth is 0 (no layout — e.g. the
  // happy-dom test environment).
  const w = tip.offsetWidth || TOOLTIP_WIDTH;

  // Prefer the right of the anchor; flip to the left when it wouldn't fit.
  let left = r.right + ANCHOR_GAP;
  if (left + w + M > vw) {
    left = r.left - w - ANCHOR_GAP;
  }
  // Clamp into the viewport so a right-edge icon (e.g. the render-mode-bar's
  // Transparent toggle) can never push the popover off-screen.
  left = Math.max(M, Math.min(left, vw - w - M));

  // Align to the anchor's top, then clamp vertically (the tip is already in
  // the DOM, so offsetHeight is measurable).
  let top = r.top;
  top = Math.max(M, Math.min(top, vh - tip.offsetHeight - M));

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
