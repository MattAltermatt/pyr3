// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountContextPanel } from './timeline-context-panel';

function overlay(): HTMLElement {
  const o = document.createElement('div');
  document.body.appendChild(o);
  return o;
}

beforeEach(() => { document.body.replaceChildren(); });

describe('mountContextPanel', () => {
  it('mounts a panel into the overlay host and exposes a contentHost', () => {
    const host = overlay();
    const p = mountContextPanel(host, { onDismiss: () => {} });
    expect(host.contains(p.contentHost)).toBe(true);
    expect(p.isOpen()).toBe(false);
  });

  it('open() shows the panel, close() hides it', () => {
    const p = mountContextPanel(overlay(), { onDismiss: () => {} });
    p.open();
    expect(p.isOpen()).toBe(true);
    const panel = p.contentHost.parentElement!;
    expect(panel.style.transform).toBe('translateY(0)');
    expect(panel.style.pointerEvents).toBe('auto');
    p.close();
    expect(p.isOpen()).toBe(false);
    expect(panel.style.transform).toBe('translateY(100%)');
  });

  it('✕ click fires onDismiss exactly once', () => {
    let dismissed = 0;
    const p = mountContextPanel(overlay(), { onDismiss: () => { dismissed++; } });
    p.open();
    const btn = p.contentHost.parentElement!.querySelector('button')!;
    // Real press: mousedown on ✕ (inside panel) then click — the overlay handler
    // must not also fire (pressedInside guards the double-dismiss).
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dismissed).toBe(1);
  });

  // Simulate a real click: mousedown then click on the same target.
  const press = (el: Element): void => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };

  it('a click that starts on the overlay outside the panel dismisses (only when open)', () => {
    const host = overlay();
    let dismissed = 0;
    const p = mountContextPanel(host, { onDismiss: () => { dismissed++; } });
    press(host);                  // closed → no dismiss
    expect(dismissed).toBe(0);
    p.open();
    press(host);                  // open + press began outside panel → dismiss
    expect(dismissed).toBe(1);
  });

  it('a click that starts inside the panel does NOT dismiss', () => {
    let dismissed = 0;
    const p = mountContextPanel(overlay(), { onDismiss: () => { dismissed++; } });
    p.open();
    press(p.contentHost);
    expect(dismissed).toBe(0);
  });

  it('a control that re-renders (detaches its target) mid-click does NOT dismiss', () => {
    // Regression: editing a linger pill rebuilds the editor, removing the clicked
    // node before the click bubbles. mousedown-origin keeps the panel open.
    const host = overlay();
    let dismissed = 0;
    const p = mountContextPanel(host, { onDismiss: () => { dismissed++; } });
    p.open();
    const pill = document.createElement('button');
    p.contentHost.appendChild(pill);
    pill.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); // press inside
    pill.remove();                                                       // re-render detaches it
    host.dispatchEvent(new MouseEvent('click', { bubbles: true }));      // bubbles to overlay
    expect(dismissed).toBe(0);
  });

  it('Escape closes the panel when open', () => {
    let dismissed = 0;
    const p = mountContextPanel(overlay(), { onDismiss: () => { dismissed++; } });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dismissed).toBe(0);    // closed → ignored
    p.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dismissed).toBe(1);
  });

  it('destroy() removes the panel and its listeners', () => {
    const host = overlay();
    let dismissed = 0;
    const p = mountContextPanel(host, { onDismiss: () => { dismissed++; } });
    p.open();
    p.destroy();
    expect(host.querySelector('button')).toBeNull();
    press(host);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dismissed).toBe(0);    // listeners gone
  });
});
