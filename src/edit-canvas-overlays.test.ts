// @vitest-environment happy-dom

import { describe, it, expect, vi } from 'vitest';
import { attachCanvasOverlays } from './edit-canvas-overlays';
import { GIZMO_PREFS_DEFAULT } from './edit-state';

describe('attachCanvasOverlays', () => {
  it('modify:[flame|xform] segments reflect + switch the mode', () => {
    const host = document.createElement('div');
    const prefs = { ...GIZMO_PREFS_DEFAULT }; // editOnCanvas:false (flame) by default
    const onChange = vi.fn();
    const ov = attachCanvasOverlays(host, {
      getPrefs: () => prefs,
      onChange: (p) => { Object.assign(prefs, p); onChange(p); },
    });
    const flameSeg = host.querySelector<HTMLButtonElement>('[data-overlay="mode-flame"]')!;
    const xformSeg = host.querySelector<HTMLButtonElement>('[data-overlay="mode-xform"]')!;
    expect(flameSeg.getAttribute('aria-pressed')).toBe('true');
    expect(xformSeg.getAttribute('aria-pressed')).toBe('false');
    xformSeg.click();
    expect(onChange).toHaveBeenCalled();
    expect(prefs.editOnCanvas).toBe(true);
    expect(xformSeg.getAttribute('aria-pressed')).toBe('true');
    expect(flameSeg.getAttribute('aria-pressed')).toBe('false');
    flameSeg.click();
    expect(prefs.editOnCanvas).toBe(false);
    ov.destroy();
    expect(host.querySelector('[data-overlay="mode-xform"]')).toBeFalsy();
  });

  it('updates the live readout text without rebuilding the node', () => {
    const host = document.createElement('div');
    const prefs = { ...GIZMO_PREFS_DEFAULT };
    const ov = attachCanvasOverlays(host, { getPrefs: () => prefs, onChange: () => {} });
    const readout = host.querySelector('[data-overlay="readout"]')!;
    ov.setReadout('pos 0.1, 0.2');
    expect(readout.textContent).toContain('pos 0.1');
    ov.setReadout(null);
    expect(readout.textContent).toBe('');
    expect(host.querySelector('[data-overlay="readout"]')).toBe(readout); // same node
  });

  // ── #376 PRE|POST lens pill ────────────────────────────────────────────
  it('lens pill is hidden when the xform has no post', () => {
    const host = document.createElement('div');
    const prefs = { ...GIZMO_PREFS_DEFAULT, editOnCanvas: true };
    attachCanvasOverlays(host, {
      getPrefs: () => prefs, onChange: () => {},
      getLens: () => 'pre', setLens: () => {}, hasPost: () => false,
    });
    const pill = host.querySelector('[data-overlay="lens"]') as HTMLElement;
    expect(pill).toBeTruthy();              // element exists
    expect(pill.style.display).toBe('none'); // but hidden (no post)
  });

  it('lens pill shows + switches lens when a post exists', () => {
    const host = document.createElement('div');
    const prefs = { ...GIZMO_PREFS_DEFAULT, editOnCanvas: true };
    let lens: 'pre' | 'post' = 'pre';
    const ov = attachCanvasOverlays(host, {
      getPrefs: () => prefs, onChange: () => {},
      getLens: () => lens, setLens: (l) => { lens = l; }, hasPost: () => true,
    });
    ov.sync();
    const pill = host.querySelector('[data-overlay="lens"]') as HTMLElement;
    expect(pill.style.display).not.toBe('none');
    const preSeg = host.querySelector<HTMLButtonElement>('[data-overlay="lens-pre"]')!;
    const postSeg = host.querySelector<HTMLButtonElement>('[data-overlay="lens-post"]')!;
    expect(preSeg.getAttribute('aria-pressed')).toBe('true');
    postSeg.click();
    expect(lens).toBe('post');
    expect(postSeg.getAttribute('aria-pressed')).toBe('true');
    expect(preSeg.getAttribute('aria-pressed')).toBe('false');
  });

  // ── #364 compose split button ──────────────────────────────────────────
  it('compose split: label toggles master, caret opens picker, dot reflects active', () => {
    const host = document.createElement('div');
    const prefs = { ...GIZMO_PREFS_DEFAULT, editOnCanvas: true };
    let active = false;
    const onCompose = vi.fn();
    const onComposeToggle = vi.fn();
    const ov = attachCanvasOverlays(host, {
      getPrefs: () => prefs, onChange: () => {},
      onCompose, onComposeToggle, composeActive: () => active,
    });
    const label = host.querySelector('[data-overlay="compose"]') as HTMLButtonElement;
    const caret = host.querySelector('[data-overlay="compose-menu"]') as HTMLButtonElement;
    expect(label).toBeTruthy();
    expect(caret).toBeTruthy();
    // dot off, then reflects composeActive after sync
    expect(label.getAttribute('aria-pressed')).toBe('false');
    active = true; ov.sync();
    expect(label.getAttribute('aria-pressed')).toBe('true');
    // label → master toggle; caret → open picker
    label.click();
    expect(onComposeToggle).toHaveBeenCalled();
    expect(onCompose).not.toHaveBeenCalled();
    caret.click();
    expect(onCompose).toHaveBeenCalled();
  });
});
