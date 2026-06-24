// pyr3 — "this surface needs a desktop" card shown when a creation route is
// reached on mobile (#66). DOM-built (no innerHTML; see no-innerhtml.test.ts).
// SEAM_EXEMPT: touches document; browser-only.

export type HiddenSurface = 'editor' | 'animate' | 'screensaver';

const COPY: Record<HiddenSurface, { icon: string; heading: string; body: string }> = {
  editor: {
    icon: '✏️',
    heading: 'The editor needs a bigger screen',
    body: 'pyr3 flame editing lives on desktop. Open this on a laptop or desktop to edit and tweak.',
  },
  animate: {
    icon: '🎞️',
    heading: 'Animation needs a bigger screen',
    body: 'The animation timeline lives on desktop. Open this on a laptop or desktop to build sequences.',
  },
  screensaver: {
    icon: '🌙',
    heading: 'The screensaver needs a bigger screen',
    body: 'The screensaver runs on desktop. Open pyr3 on a laptop or desktop to watch the full-screen loop.',
  },
};

/** Build the interstitial card. `onViewFlames` is wired to the "View flames"
 *  button (host navigates to /viewer). Returns a root element to append. */
export function buildMobileInterstitial(surface: HiddenSurface, onViewFlames: () => void): HTMLElement {
  const { icon, heading, body } = COPY[surface];
  const root = document.createElement('div');
  root.className = 'pyr3-mobile-interstitial';
  root.style.cssText =
    'display:flex;flex-direction:column;align-items:center;justify-content:center;'
    + 'gap:14px;min-height:60vh;padding:32px 24px;text-align:center;color:#c9c9d2;';

  const iconEl = document.createElement('div');
  iconEl.textContent = icon;
  iconEl.style.fontSize = '40px';

  const h = document.createElement('h2');
  h.textContent = heading;
  h.style.cssText = 'font-size:18px;font-weight:600;color:#fff;margin:0;';

  const p = document.createElement('p');
  p.textContent = body;
  p.style.cssText = 'font-size:14px;line-height:1.5;max-width:34ch;margin:0;';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '← View flames';
  btn.style.cssText =
    'font:inherit;font-size:14px;color:#17171c;background:#ffbe3e;border:0;'
    + 'padding:10px 18px;border-radius:8px;cursor:pointer;margin-top:6px;';
  btn.addEventListener('click', onViewFlames);

  root.append(iconEl, h, p, btn);
  return root;
}
