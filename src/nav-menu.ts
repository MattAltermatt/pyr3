// #264 — top-of-page navigation: 5 menus, 4 click-dropdowns + 1 direct link.
// Replaces the flat buildTabs() row. DOM-built (no innerHTML); SEAM_EXEMPT.
// Pure presentation: leaf clicks call onNavigate(route, newTab); the host
// (mountBarChrome) does the actual window.location navigation. The component
// owns its dropdown open/close state + document-level dismiss listeners, which
// it tears down when the host dispatches a `pyr3:destroy` event on the <nav>.

import { isMobile } from './mobile';

export type NavSubKey =
  | 'editor' | 'animate' | 'screensaver'
  | 'esf' | 'gallery' | 'esf-source' | 'variations' | 'surprise' | 'about' | 'showcase'
  | 'help-color' | 'help-ifs' | 'help-cost' | 'help-webgpu';

export type NavTopKey = 'viewer' | 'editor' | 'surprise' | 'animate' | 'esf' | 'discover' | 'help';

/** #66 — top-nav keys hidden on mobile (creation surfaces). The routes still
 *  resolve to a "needs desktop" interstitial; they're just not advertised. */
const MOBILE_HIDDEN_TOP_KEYS: ReadonlySet<NavTopKey> = new Set(['editor', 'animate']);

export interface NavLeaf {
  key: NavSubKey;
  label: string;
  route: string;
  newTab?: boolean;
  /** #340 — render a thin separator above this leaf (sets off external/provenance
   *  links from the in-app surfaces). */
  divider?: boolean;
}
export interface NavTop {
  key: NavTopKey;
  label: string;
  /** Present → direct link (Viewer). Absent → dropdown driven by `items`. */
  route?: string;
  items?: NavLeaf[];
}

export const NAV_MODEL: NavTop[] = [
  { key: 'viewer', label: 'Viewer', route: '/viewer' },
  // #372 — the standalone Gradient page was retired (palette editing moved into
  // the Flame editor's Color lens), so Editor is now a direct link, not a menu.
  { key: 'editor', label: 'Editor', route: '/editor' },
  // #437 — Surprise promoted out of the Discover dropdown to its own top-level
  // "Creator" link. Keyed `surprise` (internal surface id) so the surface lights
  // it active; the public route was renamed /surprise → /creator.
  { key: 'surprise', label: 'Creator', route: '/creator' },
  { key: 'animate', label: 'Animate', items: [
    { key: 'animate',     label: 'Timeline',    route: '/animate' },
    { key: 'screensaver', label: 'Screensaver', route: '/screensaver' },
  ]},
  // #340 — renamed from the opaque "ESF" acronym. The Electric Sheep Fold
  // name keeps a home via the provenance link at the bottom of the menu.
  { key: 'esf', label: 'Flame Gallery', items: [
    { key: 'esf',        label: 'Browse',  route: '/esf' },
    { key: 'gallery',    label: 'Gallery', route: '/esf/gallery' },
    { key: 'esf-source', label: 'Electric Sheep Fold ↗',
      route: 'https://github.com/MattAltermatt/electric-sheep-fold', newTab: true, divider: true },
  ]},
  // #420 — Discover is now the *exploration* menu only (show me flames / the
  // engine). The learning/reference items moved to the new Help menu below.
  // #437 — Surprise left here for its own top-level "Creator" link (above).
  { key: 'discover', label: 'Discover', items: [
    // #264 — trailing slash: /showcase/ is the deployed static dir (deploy.yml
    // extracts the showcase Release tar there). /showcase 301-redirects to it on
    // prod; the slash skips that hop. NOTE: absent in `npm run dev` (the bundle
    // ships only at deploy time), so locally this falls back to the viewer.
    { key: 'showcase',    label: 'Showcase',        route: '/showcase/',                          newTab: true },
    { key: 'variations',  label: 'Variations',      route: '/variations' },
  ]},
  // #420 — Help: the learn/reference menu. "How flames work" leads (the in-app
  // interactive guide, same-tab SPA, #347); the three static help pages (#406)
  // follow; About sits last, set off by a divider as the meta/colophon entry
  // (it left the brand cluster — its left-cluster link was retired in #420).
  { key: 'help', label: 'Help', items: [
    { key: 'help-ifs',    label: 'How flames work', route: '/how-it-works' },
    { key: 'help-color',  label: 'Direct-color variations', route: '/help/direct-color-variations.html', newTab: true },
    // The render-cost help page's #why-not-working anchor is still deep-linked
    // from the editor render bar.
    { key: 'help-cost',   label: 'Render cost & quality', route: '/help/ifs-and-render-cost.html', newTab: true },
    { key: 'help-webgpu', label: 'WebGPU',          route: '/help/webgpu.html',                   newTab: true },
    { key: 'about',       label: 'About',           route: '/about', divider: true },
  ]},
];

const NAV_STYLE_ID = 'pyr3-nav-style';

function injectNavStylesOnce(): void {
  if (document.getElementById(NAV_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = NAV_STYLE_ID;
  style.textContent = `
.pyr3-nav { display: flex; align-items: center; gap: 4px; }
.pyr3-nav-top { position: relative; }
.pyr3-nav-toptab {
  font: inherit; font-size: 13px; color: #c9c9d2; background: transparent;
  border: 0; padding: 6px 10px; border-radius: 6px; cursor: pointer; white-space: nowrap;
  /* #407 — direct-link tabs are now <a>; kill the underline + inherit our color. */
  display: inline-block; text-decoration: none;
}
.pyr3-nav-toptab:hover { background: rgba(255,255,255,0.06); color: #fff; }
.pyr3-nav-top.active > .pyr3-nav-toptab { color: #ffbe3e; }
.pyr3-nav-top.open > .pyr3-nav-toptab { background: rgba(255,255,255,0.08); color: #fff; }
.pyr3-nav-panel {
  position: absolute; top: 100%; left: 0; margin-top: 4px; z-index: 60;
  min-width: 168px; padding: 5px; border-radius: 8px;
  background: #17171c; border: 1px solid #2c2c34; box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  display: flex; flex-direction: column; gap: 1px;
}
/* The panel sets display:flex, which would otherwise override the UA
   [hidden]{display:none}. Restore hide-when-hidden explicitly. */
.pyr3-nav-panel[hidden] { display: none; }
.pyr3-nav-item {
  font: inherit; font-size: 13px; text-align: left; color: #c9c9d2;
  background: transparent; border: 0; padding: 7px 10px; border-radius: 5px;
  cursor: pointer; white-space: nowrap;
  /* #407 — leaf items are now <a>; full-width block + no underline. */
  display: block; text-decoration: none;
}
.pyr3-nav-item:hover { background: rgba(255,255,255,0.07); color: #fff; }
.pyr3-nav-item.active { color: #ffbe3e; }
.pyr3-nav-divider { height: 1px; margin: 4px 6px; background: #2c2c34; }
/* #66 — mobile hamburger. The ☰ toggle is a touch-sized tap target; its panel
   is a scrollable vertical list of every destination (dropdown tops flatten to
   a caption + their leaves). */
.pyr3-nav-hamburger-btn { font-size: 18px; padding: 4px 10px; line-height: 1; }
.pyr3-nav-panel-mobile {
  min-width: 200px; max-height: 70vh; overflow-y: auto;
}
.pyr3-nav-mobile-header {
  font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  color: #7d7d88; padding: 8px 10px 3px;
}
.pyr3-nav-mobile-leaf { padding-left: 18px; }
`;
  document.head.append(style);
}

/**
 * Build the top-nav menu. `currentSurface` is the active TabSurface string
 * (from main.ts currentTabSurface). `onNavigate(route, newTab)` fires on any
 * leaf/direct-link click. Returns the `<nav>` element; dispatch a `pyr3:destroy`
 * Event on it to remove the document-level dismiss listeners.
 */
export function buildNavMenu(
  currentSurface: string,
  onNavigate: (route: string, newTab?: boolean) => void,
): HTMLElement {
  injectNavStylesOnce();
  const nav = document.createElement('nav');
  nav.className = 'pyr3-nav';

  let openWrap: HTMLElement | null = null;
  function closeAll(): void {
    if (!openWrap) return;
    const panel = openWrap.querySelector('.pyr3-nav-panel') as HTMLElement | null;
    if (panel) panel.hidden = true;
    openWrap.classList.remove('open');
    openWrap = null;
  }
  function toggle(wrap: HTMLElement): void {
    const panel = wrap.querySelector('.pyr3-nav-panel') as HTMLElement;
    const willOpen = panel.hidden;
    closeAll();
    if (willOpen) { panel.hidden = false; wrap.classList.add('open'); openWrap = wrap; }
  }

  const mobile = isMobile();
  const visibleTops = NAV_MODEL.filter((t) => !(mobile && MOBILE_HIDDEN_TOP_KEYS.has(t.key)));
  if (mobile) {
    // #66 — on mobile the nav collapses to a single ☰ hamburger: the 5 reduced
    // destinations don't fit a 320px row, so they live in a tap-to-open vertical
    // panel (dropdown tops flatten into a section header + their leaves).
    nav.classList.add('pyr3-nav-mobile');
    nav.append(buildHamburger(visibleTops, currentSurface, onNavigate, toggle, closeAll));
  } else {
    for (const top of visibleTops) {
      nav.append(buildTop(top, currentSurface, onNavigate, toggle, closeAll));
    }
  }

  const onDocMouseDown = (e: MouseEvent): void => {
    if (openWrap && !openWrap.contains(e.target as Node)) closeAll();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeAll(); };
  document.addEventListener('mousedown', onDocMouseDown);
  document.addEventListener('keydown', onKey);
  nav.addEventListener('pyr3:destroy', () => {
    document.removeEventListener('mousedown', onDocMouseDown);
    document.removeEventListener('keydown', onKey);
  });

  return nav;
}

/**
 * #407 — a click counts as "plain left-click" (intercept for SPA nav) unless it
 * carries a modifier (cmd/ctrl/shift/alt) or a non-primary button. Those keep
 * the browser's native <a> behaviour (open in a new tab/window). Synthetic
 * clicks (`el.click()` in tests, or events without a button field) are treated
 * as plain so existing nav tests still drive onNavigate. Middle-click never
 * reaches here in modern browsers — it fires `auxclick`, so the <a href> opens
 * a new tab natively with no JS at all.
 */
export function isPlainLeftClick(e: MouseEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if (e.button !== undefined && e.button !== 0) return false;
  return true;
}

/**
 * #66 — the mobile hamburger. A single ☰ toggle whose dropdown panel flattens
 * every visible top entry into a vertical list: direct links (Viewer / Creator)
 * become items; dropdown tops (Flame Gallery / Discover / Help) become a section
 * header followed by their leaves. Reuses the same toggle/closeAll machinery and
 * `.pyr3-nav-item` styling as the desktop menus.
 */
function buildHamburger(
  tops: NavTop[],
  current: string,
  onNavigate: (r: string, n?: boolean) => void,
  toggle: (wrap: HTMLElement) => void,
  closeAll: () => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pyr3-nav-top pyr3-nav-hamburger';
  wrap.dataset.navTop = 'menu';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pyr3-nav-toptab pyr3-nav-hamburger-btn';
  btn.textContent = '☰';
  btn.setAttribute('aria-label', 'Menu');
  wrap.append(btn);

  const panel = document.createElement('div');
  panel.className = 'pyr3-nav-panel pyr3-nav-panel-mobile';
  panel.hidden = true;

  const linkItem = (label: string, route: string, key: string, newTab?: boolean): HTMLAnchorElement => {
    const item = document.createElement('a');
    item.className = 'pyr3-nav-item';
    item.dataset.navSub = key;
    item.href = route;
    item.textContent = label;
    if (newTab) { item.target = '_blank'; item.rel = 'noopener'; }
    if (key === current) item.classList.add('active');
    item.addEventListener('click', (e) => {
      if (!isPlainLeftClick(e)) return;     // let the browser open a new tab
      e.preventDefault();
      closeAll();
      onNavigate(route, newTab);
    });
    return item;
  };

  for (const top of tops) {
    if (top.route && !top.items) {
      panel.append(linkItem(top.label, top.route, top.key, undefined));
    } else if (top.items) {
      const header = document.createElement('div');
      header.className = 'pyr3-nav-mobile-header';
      header.textContent = top.label;
      panel.append(header);
      for (const leaf of top.items) {
        // #66 — on mobile, the in-app static help pages (/help/*.html) open
        // SAME-TAB: new tabs are awkward on phones and the back button returns
        // cleanly. Genuinely-external links (github ↗) and the separate Showcase
        // build keep their new-tab behaviour.
        const newTab = leaf.route.startsWith('/help/') ? false : leaf.newTab;
        const item = linkItem(leaf.label, leaf.route, leaf.key, newTab);
        item.classList.add('pyr3-nav-mobile-leaf');
        panel.append(item);
      }
    }
  }

  wrap.append(panel);
  btn.addEventListener('click', () => toggle(wrap));
  return wrap;
}

function buildTop(
  top: NavTop,
  current: string,
  onNavigate: (r: string, n?: boolean) => void,
  toggle: (wrap: HTMLElement) => void,
  closeAll: () => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pyr3-nav-top';
  wrap.dataset.navTop = top.key;

  // Direct link (Viewer / Editor) — a real <a> so cmd/ctrl/middle-click open a
  // new tab natively (#407). Plain left-click is intercepted for SPA routing.
  if (top.route && !top.items) {
    if (current === top.key) wrap.classList.add('active');
    const a = document.createElement('a');
    a.className = 'pyr3-nav-toptab';
    a.href = top.route;
    a.textContent = top.label;
    a.addEventListener('click', (e) => {
      if (!isPlainLeftClick(e)) return;     // let the browser open a new tab
      e.preventDefault();
      closeAll();
      onNavigate(top.route!);
    });
    wrap.append(a);
    return wrap;
  }

  // Dropdown header — stays a <button>; it toggles a panel, it isn't a link.
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pyr3-nav-toptab';
  btn.textContent = top.label + ' ▾';
  wrap.append(btn);

  const panel = document.createElement('div');
  panel.className = 'pyr3-nav-panel';
  panel.hidden = true;
  for (const leaf of top.items!) {
    if (leaf.divider) {
      const div = document.createElement('div');
      div.className = 'pyr3-nav-divider';
      panel.append(div);
    }
    // #407 — leaves are real <a href> too. External/new-tab leaves carry
    // target=_blank so even a JS-disabled plain click opens correctly.
    const item = document.createElement('a');
    item.className = 'pyr3-nav-item';
    item.dataset.navSub = leaf.key;
    item.href = leaf.route;
    item.textContent = leaf.label;
    if (leaf.newTab) { item.target = '_blank'; item.rel = 'noopener'; }
    if (leaf.key === current) { item.classList.add('active'); wrap.classList.add('active'); }
    item.addEventListener('click', (e) => {
      if (!isPlainLeftClick(e)) return;     // let the browser open a new tab
      e.preventDefault();
      closeAll();
      onNavigate(leaf.route, leaf.newTab);
    });
    panel.append(item);
  }
  wrap.append(panel);
  btn.addEventListener('click', () => toggle(wrap));
  return wrap;
}
