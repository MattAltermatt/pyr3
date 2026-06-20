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
});
