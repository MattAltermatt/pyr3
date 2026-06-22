// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { attachComposeMenu } from './edit-compose-menu';
import { COMPOSE_PREFS_DEFAULT } from './edit-state';

function setup() {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  let prefs = { ...COMPOSE_PREFS_DEFAULT };
  const onChange = vi.fn((p) => { prefs = p; });
  const menu = attachComposeMenu({ getPrefs: () => prefs, onChange });
  return { anchor, menu, onChange, getPrefs: () => prefs };
}

describe('attachComposeMenu (#364)', () => {
  it('toggle() opens the popover with 6 guide checkboxes', () => {
    const { anchor, menu } = setup();
    menu.toggle(anchor);
    const boxes = document.querySelectorAll('.pyr3-compose-menu [data-guide]');
    expect(boxes).toHaveLength(6); // + golden spiral (#402)
    menu.destroy();
  });
  it('checking golden spiral flips its pref (#402)', () => {
    const { anchor, menu, getPrefs } = setup();
    menu.toggle(anchor);
    const box = document.querySelector('.pyr3-compose-menu [data-guide="goldenSpiral"]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(getPrefs().goldenSpiral).toBe(true);
    menu.destroy();
  });
  it('spiral orient stepper clamps to 0..3 (#402)', () => {
    const { anchor, menu, getPrefs } = setup();
    menu.toggle(anchor);
    const orient = document.querySelector('.pyr3-compose-menu [data-orient]') as HTMLInputElement;
    orient.value = '9';
    orient.dispatchEvent(new Event('change', { bubbles: true }));
    expect(getPrefs().spiralOrient).toBe(3);
    orient.value = '-2';
    orient.dispatchEvent(new Event('change', { bubbles: true }));
    expect(getPrefs().spiralOrient).toBe(0);
    menu.destroy();
  });
  it('spokes-auto checkbox sets spokesAuto + disables the fold stepper (#403)', () => {
    const { anchor, menu, getPrefs } = setup();
    menu.toggle(anchor);
    const auto = document.querySelector('.pyr3-compose-menu [data-spokes-auto]') as HTMLInputElement;
    const fold = document.querySelector('.pyr3-compose-menu [data-fold]') as HTMLInputElement;
    expect(fold.disabled).toBe(false);
    auto.checked = true;
    auto.dispatchEvent(new Event('change', { bubbles: true }));
    expect(getPrefs().spokesAuto).toBe(true);
    expect(fold.disabled).toBe(true);
    menu.destroy();
  });
  it('checking a guide fires onChange with that pref flipped', () => {
    const { anchor, menu, onChange, getPrefs } = setup();
    menu.toggle(anchor);
    const ringsBox = document.querySelector('.pyr3-compose-menu [data-guide="rings"]') as HTMLInputElement;
    ringsBox.checked = true;
    ringsBox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).toHaveBeenCalled();
    expect(getPrefs().rings).toBe(true);
    menu.destroy();
  });
  it('fold stepper clamps to 2..12', () => {
    const { anchor, menu, getPrefs } = setup();
    menu.toggle(anchor);
    const fold = document.querySelector('.pyr3-compose-menu [data-fold]') as HTMLInputElement;
    fold.value = '99';
    fold.dispatchEvent(new Event('change', { bubbles: true }));
    expect(getPrefs().spokeFold).toBe(12);
    fold.value = '1';
    fold.dispatchEvent(new Event('change', { bubbles: true }));
    expect(getPrefs().spokeFold).toBe(2);
    menu.destroy();
  });
  it('outside mousedown closes the popover', () => {
    const { anchor, menu } = setup();
    menu.toggle(anchor);
    expect(document.querySelector('.pyr3-compose-menu')).toBeTruthy();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('.pyr3-compose-menu')).toBeFalsy();
    menu.destroy();
  });
});
