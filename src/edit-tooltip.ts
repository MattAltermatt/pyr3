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
  const sect = anchor.closest('.pyr3-section') as HTMLElement | null;
  document.body.appendChild(tip);
  if (sect) {
    anchorTooltip(tip, sect);
  } else {
    // No section ancestor — fall back to icon-anchored placement.
    const r = anchor.getBoundingClientRect();
    tip.style.left = `${r.right + ANCHOR_GAP}px`;
    tip.style.top = `${r.top}px`;
  }

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
    hint.style.color = COLORS.text.dim;
    hint.style.fontStyle = 'italic';
    tip.appendChild(hint);
  }
  return tip;
}

function anchorTooltip(tip: HTMLElement, sect: HTMLElement): void {
  const r = sect.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  if (r.right + ANCHOR_GAP + TOOLTIP_WIDTH < viewportWidth) {
    // Right anchor — fits.
    tip.style.left = `${r.right + ANCHOR_GAP}px`;
  } else {
    // Left fallback.
    tip.style.left = `${r.left - TOOLTIP_WIDTH - ANCHOR_GAP}px`;
  }
  tip.style.top = `${r.top}px`;
}
