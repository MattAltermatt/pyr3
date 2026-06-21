// Shared section/prose DOM builders for the /how-it-works guide (#347).
// DOM-mounting → SEAM_EXEMPT. No innerHTML.
import { COLORS } from '../ui-tokens';

export function buildSection(id: string, heading: string): HTMLElement {
  const sec = document.createElement('section');
  sec.id = id;                  // anchor deep-links (#chaos-game)
  Object.assign(sec.style, { margin: '48px 0 0' });
  const h2 = document.createElement('h2');
  h2.textContent = heading;
  Object.assign(h2.style, { fontSize: '22px', fontWeight: '700', color: COLORS.text.primary, margin: '0 0 12px' });
  sec.appendChild(h2);
  return sec;
}

export function para(text: string): HTMLElement {
  const p = document.createElement('p');
  p.textContent = text;
  Object.assign(p.style, { margin: '0 0 14px', color: COLORS.text.muted });
  return p;
}
