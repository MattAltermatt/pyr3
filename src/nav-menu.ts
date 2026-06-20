// #264 — top-of-page navigation: 5 menus, 4 click-dropdowns + 1 direct link.
// Replaces the flat buildTabs() row. DOM-built (no innerHTML); SEAM_EXEMPT.
// Pure presentation: leaf clicks call onNavigate(route, newTab); the host
// (mountBarChrome) does the actual window.location navigation. The component
// owns its dropdown open/close state + document-level dismiss listeners, which
// it tears down when the host dispatches a `pyr3:destroy` event on the <nav>.

export type NavSubKey =
  | 'editor' | 'animate' | 'screensaver'
  | 'esf' | 'gallery' | 'esf-source' | 'variations' | 'surprise' | 'about' | 'showcase'
  | 'help-color' | 'help-ifs' | 'help-webgpu';

export type NavTopKey = 'viewer' | 'editor' | 'animate' | 'esf' | 'discover';

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
  { key: 'discover', label: 'Discover', items: [
    { key: 'surprise',    label: 'Surprise',        route: '/surprise' },
    { key: 'variations',  label: 'Variations',      route: '/variations' },
    { key: 'about',       label: 'About',           route: '/about' },
    { key: 'help-color',  label: 'Color',           route: '/help/direct-color-variations.html', newTab: true },
    { key: 'help-ifs',    label: 'How flames work', route: '/help/ifs-and-render-cost.html',      newTab: true },
    { key: 'help-webgpu', label: 'WebGPU',          route: '/help/webgpu.html',                   newTab: true },
    // #264 — trailing slash: /showcase/ is the deployed static dir (deploy.yml
    // extracts the showcase Release tar there). /showcase 301-redirects to it on
    // prod; the slash skips that hop. NOTE: absent in `npm run dev` (the bundle
    // ships only at deploy time), so locally this falls back to the viewer.
    { key: 'showcase',    label: 'Showcase',        route: '/showcase/',                          newTab: true },
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
}
.pyr3-nav-item:hover { background: rgba(255,255,255,0.07); color: #fff; }
.pyr3-nav-item.active { color: #ffbe3e; }
.pyr3-nav-divider { height: 1px; margin: 4px 6px; background: #2c2c34; }
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

  for (const top of NAV_MODEL) {
    nav.append(buildTop(top, currentSurface, onNavigate, toggle, closeAll));
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

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pyr3-nav-toptab';
  btn.textContent = top.label + (top.items ? ' ▾' : '');
  wrap.append(btn);

  // Direct link (Viewer) — no dropdown.
  if (top.route && !top.items) {
    if (current === top.key) wrap.classList.add('active');
    btn.addEventListener('click', () => { closeAll(); onNavigate(top.route!); });
    return wrap;
  }

  // Dropdown.
  const panel = document.createElement('div');
  panel.className = 'pyr3-nav-panel';
  panel.hidden = true;
  for (const leaf of top.items!) {
    if (leaf.divider) {
      const div = document.createElement('div');
      div.className = 'pyr3-nav-divider';
      panel.append(div);
    }
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'pyr3-nav-item';
    item.dataset.navSub = leaf.key;
    item.textContent = leaf.label;
    if (leaf.key === current) { item.classList.add('active'); wrap.classList.add('active'); }
    item.addEventListener('click', () => { closeAll(); onNavigate(leaf.route, leaf.newTab); });
    panel.append(item);
  }
  wrap.append(panel);
  btn.addEventListener('click', () => toggle(wrap));
  return wrap;
}
