// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { attachGradientOverlay } from './edit-gradient-overlay';
import { PYRE_PALETTE } from './palette';

function fixture() {
  const host = document.createElement('div');
  const controls = document.createElement('div');
  document.body.append(host, controls);
  return { host, controls };
}

describe('edit-gradient-overlay (#372)', () => {
  it('attach mounts a bar host over the canvas host; destroy removes it', () => {
    const { host, controls } = fixture();
    const h = attachGradientOverlay(host, {
      getPalette: () => PYRE_PALETTE,
      onChange: () => {},
      controlsHost: controls,
      onSelect: () => {},
      onHoverT: () => {},
    });
    expect(host.querySelector('.pyr3-edit-gradient-overlay')).not.toBeNull();
    // controls land in the SEPARATE subpanel host, not on the canvas overlay
    expect(controls.querySelector('[data-role="controls"]')).not.toBeNull();
    expect(host.querySelector('[data-role="controls"]')).toBeNull();
    h.destroy();
    expect(host.querySelector('.pyr3-edit-gradient-overlay')).toBeNull();
  });

  it('setPalette + selectStop forward to the embedded editor without throwing', () => {
    const { host, controls } = fixture();
    let selected: number | null = null;
    const h = attachGradientOverlay(host, {
      getPalette: () => PYRE_PALETTE,
      onChange: () => {},
      controlsHost: controls,
      onSelect: (idx) => { selected = idx; },
      onHoverT: () => {},
    });
    h.setPalette({ name: 'x', stops: [
      { t: 0, r: 0, g: 0, b: 0 }, { t: 0.5, r: 1, g: 0, b: 0 }, { t: 1, r: 1, g: 1, b: 1 },
    ] });
    h.selectStop(1);
    expect(selected).toBe(1);
    h.destroy();
  });
});
