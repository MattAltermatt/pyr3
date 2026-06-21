// src/timeline-context-panel.ts
// #283 — a slide-up overlay that hosts the /v1/animate selection editor over the
// flame preview, above the static options/track/scrub spine. Presentation only:
// no timeline knowledge — it opens/closes and hands back a contentHost. Because
// it is absolutely positioned over the flame, opening it never reflows the spine.
// createElement only (no innerHTML — see no-innerhtml.test.ts).

export interface ContextPanelOpts {
  /** Fired by the ✕ button OR a click on the overlay outside the panel. */
  onDismiss: () => void;
}

export interface ContextPanelHandle {
  /** The editor mounts its content in here. */
  contentHost: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

export function mountContextPanel(overlayHost: HTMLElement, opts: ContextPanelOpts): ContextPanelHandle {
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'absolute', left: '0', right: '0', bottom: '0', zIndex: '8',
    // Capped to the flame area so tall content (many xform rows) never overflows
    // the overlay's overflow:hidden and clips the ✕ — the body scrolls instead.
    minHeight: '96px', maxHeight: '100%',
    display: 'flex', flexDirection: 'column',
    // #408 — themed (was teal-bordered CLI monospace).
    background: 'var(--bar-bg-2, #1a1a20)', borderTop: '1px solid var(--accent-border, #884a1a)',
    boxShadow: '0 -12px 34px rgba(0,0,0,0.6)', transform: 'translateY(100%)',
    transition: 'transform 0.2s ease', pointerEvents: 'none',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  });

  // Fixed header bar keeps the ✕ reachable regardless of body scroll.
  const headerBar = document.createElement('div');
  Object.assign(headerBar.style, {
    flex: '0 0 auto', display: 'flex', justifyContent: 'flex-end',
    padding: '6px 8px 0', pointerEvents: 'none',
  });
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close';
  Object.assign(closeBtn.style, {
    background: 'transparent', border: '1px solid var(--bar-border, #2a2a30)', color: 'var(--text-dim, #888)',
    borderRadius: '4px', cursor: 'pointer', padding: '1px 9px',
    fontFamily: 'inherit', pointerEvents: 'auto',
  });
  closeBtn.addEventListener('click', () => opts.onDismiss());
  headerBar.appendChild(closeBtn);
  panel.appendChild(headerBar);

  const contentHost = document.createElement('div');
  Object.assign(contentHost.style, { flex: '1 1 auto', overflowY: 'auto', padding: '4px 16px 14px' });
  panel.appendChild(contentHost);

  overlayHost.appendChild(panel);

  let open = false;

  // Decide inside/outside by where the press STARTED (mousedown fires before any
  // re-render). Using the click target is unsafe: editing a control (linger pill,
  // reset) rebuilds the editor mid-click, detaching the target, so a contains()
  // check on it would read "outside" and wrongly dismiss. mousedown-origin also
  // means a drag that begins inside the panel (the xform widget) never dismisses.
  let pressedInside = false;
  const onDown = (e: MouseEvent): void => { pressedInside = panel.contains(e.target as Node); };
  const onClick = (): void => {
    if (!open || pressedInside) return; // press began inside the panel → keep open
    opts.onDismiss();
  };
  overlayHost.addEventListener('mousedown', onDown);
  overlayHost.addEventListener('click', onClick);

  // Escape always closes, regardless of focus.
  const onKey = (e: KeyboardEvent): void => { if (open && e.key === 'Escape') opts.onDismiss(); };
  document.addEventListener('keydown', onKey);

  return {
    contentHost,
    open(): void {
      open = true;
      panel.style.transform = 'translateY(0)';
      panel.style.pointerEvents = 'auto';
    },
    close(): void {
      open = false;
      panel.style.transform = 'translateY(100%)';
      panel.style.pointerEvents = 'none';
    },
    isOpen(): boolean { return open; },
    destroy(): void {
      overlayHost.removeEventListener('mousedown', onDown);
      overlayHost.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      panel.remove();
    },
  };
}
