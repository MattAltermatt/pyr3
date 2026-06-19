// #338 — viewer first-load onboarding.
//
// A lightweight, dismissible welcome card shown ONCE (per browser) on the basic
// viewer's cold land, pointing first-time visitors at the three discovery paths:
// browse the gallery, open a flame, edit the current flame. It is non-blocking —
// the hero flame keeps rendering behind it — and is mounted only after first
// paint so the visitor sees the engine is alive first.
//
// The links open their destination in a new tab (wired in main.ts), so the card
// STAYS until the visitor explicitly dismisses it — only ✕ or Escape removes it
// and persists `pyr3.welcome.seen` so it never auto-shows again. A future reopen
// affordance can read the same key. DOM-mounting module (uses document) →
// listed in seam.test SEAM_EXEMPT.

const SEEN_KEY = 'pyr3.welcome.seen';

type MiniStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface WelcomeCardOpts {
  /** Navigate to the corpus browser (the richest discovery path). */
  onBrowseGallery: () => void;
  /** Open the local-file picker. */
  onOpen: () => void;
  /** Carry the current flame into the editor. */
  onEdit: () => void;
  /** Injectable for tests; defaults to globalThis.localStorage. */
  storage?: MiniStorage | null;
}

export interface WelcomeCardHandle {
  el: HTMLElement;
  dismiss: () => void;
}

function resolveStorage(s?: MiniStorage | null): MiniStorage | null {
  if (s !== undefined) return s;
  return globalThis.localStorage ?? null;
}

/** Whether the welcome card has already been dismissed in this browser. */
export function welcomeAlreadySeen(storage?: MiniStorage | null): boolean {
  const s = resolveStorage(storage);
  try {
    return s?.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

// #338 — the discovery links. Gallery leads (it's the deepest path); the
// TODO(#347) below is the seam for the interactive "How IFS works" guide link.
const LINKS = [
  { role: 'welcome-gallery', em: '🖼', label: 'Browse the flame gallery', lead: true, cb: 'onBrowseGallery' },
  { role: 'welcome-open', em: '📂', label: 'Open a flame file', lead: false, cb: 'onOpen' },
  { role: 'welcome-edit', em: '✏️', label: 'Edit this flame', lead: false, cb: 'onEdit' },
  // TODO(#347): when the interactive "How IFS / fractal flames work" guide page
  // ships, add a 4th link here — { role:'welcome-ifs', em:'🎓', label:'Learn how
  // fractal flames work', cb:'onLearnIfs' } — and thread an onLearnIfs callback
  // through WelcomeCardOpts + the main.ts mount site. (User-directive at #338
  // design time; see memory project-pyr3-338-welcome-ifs-link.)
] as const satisfies ReadonlyArray<{ role: string; em: string; label: string; lead: boolean; cb: keyof WelcomeCardOpts }>;

let stylesInjected = false;
function injectStylesOnce(): void {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'pyr3-welcome-styles';
  // Tokens (--accent, --border, …) come from index.html :root.
  style.textContent = `
    .pyr3-welcome {
      position: absolute; left: 18px; bottom: 18px; z-index: 40; width: 318px;
      background: rgba(18,18,22,0.94); border: 1px solid var(--accent-border, #884a1a);
      border-radius: 11px; padding: 15px 16px 14px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.55); backdrop-filter: blur(3px);
      color: var(--text, #ddd); font-size: 13px;
      animation: pyr3-welcome-in 220ms ease both;
    }
    @keyframes pyr3-welcome-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    .pyr3-welcome-x {
      position: absolute; top: 8px; right: 9px; width: 24px; height: 24px;
      background: transparent; border: none; color: var(--text-dim, #888);
      font-size: 14px; cursor: pointer; border-radius: 6px; line-height: 1;
    }
    .pyr3-welcome-x:hover { color: var(--text, #ddd); background: rgba(255,255,255,0.06); }
    .pyr3-welcome-title { margin: 0 0 5px; font-size: 14px; color: var(--text, #ddd); }
    .pyr3-welcome-lede { margin: 0 0 12px; font-size: 12.5px; color: #bbb; line-height: 1.5; }
    .pyr3-welcome-links { display: flex; flex-direction: column; gap: 7px; }
    .pyr3-welcome-link {
      display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
      padding: 8px 10px; border-radius: 7px; cursor: pointer;
      background: var(--bar-bg-1, #15151a); border: 1px solid var(--border, #2a2a30);
      color: var(--text, #ddd); font-size: 12.5px;
    }
    .pyr3-welcome-link:hover { border-color: var(--accent-border, #884a1a); background: var(--bar-bg-2, #1a1a20); }
    .pyr3-welcome-link.lead { background: var(--accent-soft, rgba(255,140,26,0.18)); border-color: var(--accent-border, #884a1a); }
    .pyr3-welcome-em { width: 18px; text-align: center; }
    .pyr3-welcome-arr { margin-left: auto; color: var(--text-dim, #888); }
  `;
  document.head.appendChild(style);
}

/**
 * Mount the first-load welcome card into `parent` (the basic viewer's canvas
 * zone). Returns null without touching the DOM if the user has already
 * dismissed it (the once-ever contract). The card removes itself + persists the
 * seen flag on any dismissal path.
 */
export function mountWelcomeCard(parent: HTMLElement, opts: WelcomeCardOpts): WelcomeCardHandle | null {
  const storage = resolveStorage(opts.storage);
  if (welcomeAlreadySeen(storage)) return null;
  injectStylesOnce();

  const card = document.createElement('div');
  card.className = 'pyr3-welcome';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Welcome to pyr3');

  let keyHandler: ((e: KeyboardEvent) => void) | null = null;
  const dismiss = (): void => {
    try {
      storage?.setItem(SEEN_KEY, '1');
    } catch {
      /* storage unavailable — dismiss visually anyway */
    }
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    card.remove();
  };

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'pyr3-welcome-x';
  close.textContent = '✕';
  close.title = 'Dismiss';
  close.dataset['role'] = 'welcome-dismiss';
  close.addEventListener('click', () => dismiss());

  const title = document.createElement('h3');
  title.className = 'pyr3-welcome-title';
  title.textContent = '👋 Welcome to pyr3';

  const lede = document.createElement('p');
  lede.className = 'pyr3-welcome-lede';
  lede.textContent = "A fractal-flame renderer in your browser — here's where to go next:";

  const links = document.createElement('div');
  links.className = 'pyr3-welcome-links';
  for (const link of LINKS) {
    const a = document.createElement('button');
    a.type = 'button';
    a.className = link.lead ? 'pyr3-welcome-link lead' : 'pyr3-welcome-link';
    a.dataset['role'] = link.role;
    const em = document.createElement('span');
    em.className = 'pyr3-welcome-em';
    em.textContent = link.em;
    const lbl = document.createElement('span');
    lbl.className = 'pyr3-welcome-label';
    lbl.textContent = link.label;
    const arr = document.createElement('span');
    arr.className = 'pyr3-welcome-arr';
    arr.textContent = '→';
    a.append(em, lbl, arr);
    a.addEventListener('click', () => {
      // #338 — the links open their destination in a NEW TAB (wired in main.ts),
      // so the card STAYS until the user explicitly dismisses it (✕ / Escape).
      // Following a link is not a dismissal.
      (opts[link.cb] as () => void)();
    });
    links.append(a);
  }

  keyHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') dismiss();
  };
  document.addEventListener('keydown', keyHandler);

  card.append(close, title, lede, links);
  parent.appendChild(card);
  return { el: card, dismiss };
}
