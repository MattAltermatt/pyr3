// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrubbyInput, MIN_STEP, RATE } from './edit-scrubby-input';

function pdown(el: HTMLElement, x: number, init: PointerEventInit = {}): void {
  el.dispatchEvent(
    new PointerEvent('pointerdown', {
      clientX: x,
      button: 0,
      pointerId: 1,
      bubbles: true,
      ...init,
    }),
  );
}
function pmove(el: HTMLElement, x: number, init: PointerEventInit = {}): void {
  el.dispatchEvent(
    new PointerEvent('pointermove', {
      clientX: x,
      pointerId: 1,
      bubbles: true,
      ...init,
    }),
  );
}
function pup(el: HTMLElement, x: number): void {
  el.dispatchEvent(
    new PointerEvent('pointerup', {
      clientX: x,
      pointerId: 1,
      bubbles: true,
    }),
  );
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('scrubbyInput — drag math', () => {
  it('emits per-pixel delta proportional to |value| × RATE for position kind', () => {
    const onInput = vi.fn();
    const { el } = scrubbyInput({ value: 0.5, onInput, kind: 'position' });
    document.body.appendChild(el);
    pdown(el, 100);
    pmove(el, 110); // dx = +10 px
    // |0.5| × 0.005 = 0.0025 > floor 0.001 → 0.0025/px; 10 px → +0.025
    expect(onInput).toHaveBeenLastCalledWith(expect.closeTo(0.525, 6));
    pup(el, 110);
  });

  it('uses MIN_STEP floor when |value| × RATE is below it (position floor 0.001)', () => {
    const onInput = vi.fn();
    const { el } = scrubbyInput({ value: 0.05, onInput, kind: 'position' });
    document.body.appendChild(el);
    pdown(el, 100);
    pmove(el, 101); // dx = +1 px
    // |0.05| × 0.005 = 0.00025; floor 0.001 wins → 0.001/px → +0.001
    expect(onInput).toHaveBeenLastCalledWith(expect.closeTo(0.051, 6));
    pup(el, 101);
  });

  it('uses kind=rotation floor (0.05) so large values self-scale by magnitude', () => {
    const onInput = vi.fn();
    const { el } = scrubbyInput({ value: 46, onInput, kind: 'rotation' });
    document.body.appendChild(el);
    pdown(el, 100);
    pmove(el, 101); // dx = +1 px
    // |46| × 0.005 = 0.23 > floor 0.05 → 0.23/px → +0.23
    expect(onInput).toHaveBeenLastCalledWith(expect.closeTo(46.23, 6));
    pup(el, 101);
  });

  it('negative-direction drag emits a decreasing value', () => {
    const onInput = vi.fn();
    const { el } = scrubbyInput({ value: 1.0, onInput, kind: 'scale' });
    document.body.appendChild(el);
    pdown(el, 100);
    pmove(el, 90); // dx = -10 px
    // |1| × 0.005 = 0.005 > floor 0.005 → 0.005/px → -0.05
    expect(onInput).toHaveBeenLastCalledWith(expect.closeTo(0.95, 6));
    pup(el, 90);
  });

  it('multi-step drag accumulates correctly', () => {
    const onInput = vi.fn();
    const { el } = scrubbyInput({ value: 0.5, onInput, kind: 'weight' });
    document.body.appendChild(el);
    pdown(el, 100);
    pmove(el, 110); // dx +10
    pmove(el, 120); // dx +10 from last
    // |0.5| × 0.005 = 0.0025 > floor 0.0025; +0.025 then +~0.025 again
    // After first move value≈0.525; second move uses |0.525|×0.005 ≈ 0.002625
    expect(onInput).toHaveBeenCalledTimes(2);
    const finalCall = onInput.mock.calls[1]![0] as number;
    expect(finalCall).toBeGreaterThan(0.55);
    expect(finalCall).toBeLessThan(0.56);
    pup(el, 120);
  });
});

describe('scrubbyInput — modifiers', () => {
  it('shift modifier multiplies delta ×10', () => {
    const onInput = vi.fn();
    const { el } = scrubbyInput({ value: 0.5, onInput, kind: 'position' });
    document.body.appendChild(el);
    pdown(el, 100);
    pmove(el, 101, { shiftKey: true }); // dx +1 px
    // 0.0025/px × 10 = 0.025/px → +0.025
    expect(onInput).toHaveBeenLastCalledWith(expect.closeTo(0.525, 6));
    pup(el, 101);
  });

  it('alt modifier multiplies delta ×0.1 (fine scrub)', () => {
    const onInput = vi.fn();
    const { el } = scrubbyInput({ value: 0.5, onInput, kind: 'position' });
    document.body.appendChild(el);
    pdown(el, 100);
    pmove(el, 110, { altKey: true }); // dx +10 px
    // 0.0025/px × 0.1 = 0.00025/px → +0.0025
    expect(onInput).toHaveBeenLastCalledWith(expect.closeTo(0.5025, 6));
    pup(el, 110);
  });

  it('ctrl is NOT a fine-scrub modifier (Mac context-menu conflict)', () => {
    const onInput = vi.fn();
    const { el } = scrubbyInput({ value: 0.5, onInput, kind: 'position' });
    document.body.appendChild(el);
    pdown(el, 100);
    pmove(el, 110, { ctrlKey: true }); // dx +10 px; ctrl ignored → ×1
    // 0.0025/px × 1 = 0.0025/px → +0.025
    expect(onInput).toHaveBeenLastCalledWith(expect.closeTo(0.525, 6));
    pup(el, 110);
  });
});

describe('scrubbyInput — bounds', () => {
  it('clamps to max', () => {
    const onInput = vi.fn();
    const { el } = scrubbyInput({ value: 0.99, onInput, kind: 'color', max: 1 });
    document.body.appendChild(el);
    pdown(el, 100);
    pmove(el, 200); // huge drag right
    expect(onInput).toHaveBeenLastCalledWith(1);
    pup(el, 200);
  });

  it('clamps to min', () => {
    const onInput = vi.fn();
    const { el } = scrubbyInput({ value: 0.01, onInput, kind: 'color', min: 0 });
    document.body.appendChild(el);
    pdown(el, 100);
    pmove(el, 0); // huge drag left
    expect(onInput).toHaveBeenLastCalledWith(0);
    pup(el, 0);
  });

  it('clamps initial value to bounds on construction', () => {
    const onInput = vi.fn();
    const { el } = scrubbyInput({ value: 5, onInput, kind: 'color', max: 1 });
    expect(el.textContent).toBe('1');
  });
});

describe('scrubbyInput — text mode', () => {
  it('double-click swaps to native input, focused and selected', () => {
    const onInput = vi.fn();
    const { el } = scrubbyInput({ value: 0.5, onInput, kind: 'weight' });
    document.body.appendChild(el);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const inp = el.querySelector('input') as HTMLInputElement;
    expect(inp).not.toBeNull();
    expect(inp.type).toBe('number');
    expect(inp.value).toBe('0.5');
    expect(document.activeElement).toBe(inp);
  });

  it('Enter commits typed value via onInput', () => {
    const onInput = vi.fn();
    const { el } = scrubbyInput({ value: 0.5, onInput, kind: 'weight' });
    document.body.appendChild(el);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const inp = el.querySelector('input') as HTMLInputElement;
    inp.value = '0.75';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onInput).toHaveBeenLastCalledWith(0.75);
    expect(el.querySelector('input')).toBeNull();
    expect(el.textContent).toBe('0.75');
  });

  it('Escape reverts to pre-edit value', () => {
    const onInput = vi.fn();
    const { el } = scrubbyInput({ value: 0.5, onInput, kind: 'weight' });
    document.body.appendChild(el);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const inp = el.querySelector('input') as HTMLInputElement;
    inp.value = '0.99';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onInput).not.toHaveBeenCalled();
    expect(el.textContent).toBe('0.5');
  });

  it('blur commits the typed value', () => {
    const onInput = vi.fn();
    const { el } = scrubbyInput({ value: 0.5, onInput, kind: 'weight' });
    document.body.appendChild(el);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const inp = el.querySelector('input') as HTMLInputElement;
    inp.value = '0.33';
    inp.dispatchEvent(new Event('blur'));
    expect(onInput).toHaveBeenLastCalledWith(0.33);
  });

  it('clamps typed value to bounds on commit', () => {
    const onInput = vi.fn();
    const { el } = scrubbyInput({ value: 0.5, onInput, kind: 'color', min: 0, max: 1 });
    document.body.appendChild(el);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const inp = el.querySelector('input') as HTMLInputElement;
    inp.value = '999';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onInput).toHaveBeenLastCalledWith(1);
  });
});

describe('scrubbyInput — pointer-lock fallback (happy-dom path)', () => {
  it('drag works without pointer lock (clientX delta fallback)', () => {
    // happy-dom does not implement requestPointerLock; pointerLockElement
    // stays null; the component reads e.clientX deltas instead of
    // e.movementX. Drag still emits correct values.
    expect(document.pointerLockElement).toBeFalsy();
    const onInput = vi.fn();
    const { el } = scrubbyInput({ value: 1, onInput, kind: 'scale' });
    document.body.appendChild(el);
    pdown(el, 100);
    pmove(el, 110);
    expect(onInput).toHaveBeenLastCalledWith(expect.closeTo(1.05, 6));
    pup(el, 110);
  });
});

describe('scrubbyInput — display formatting', () => {
  it('default format trims trailing zeros to max 6 decimals', () => {
    const { el } = scrubbyInput({ value: 0.5, onInput: vi.fn() });
    expect(el.textContent).toBe('0.5');
  });

  it('default format truncates beyond 6 decimals', () => {
    const { el } = scrubbyInput({ value: 0.123456789, onInput: vi.fn() });
    expect(el.textContent).toBe('0.123457');
  });

  it('custom format wins over default', () => {
    const { el } = scrubbyInput({
      value: 46.4826,
      onInput: vi.fn(),
      format: (v) => `${v.toFixed(2)}°`,
    });
    expect(el.textContent).toBe('46.48°');
  });

  it('#396: magnitude-aware precision keeps wide values short', () => {
    // A viewport scale of 2268.0645231 used to render all 7 decimals, overflowing
    // the panel field and clipping the trailing help icon.
    expect(scrubbyInput({ value: 2268.0645231, onInput: vi.fn() }).el.textContent).toBe('2268.06'); // >=1000 → 2dp
    expect(scrubbyInput({ value: 137.123456, onInput: vi.fn() }).el.textContent).toBe('137.123');   // >=100 → 3dp
    expect(scrubbyInput({ value: 4.987654, onInput: vi.fn() }).el.textContent).toBe('4.9877');       // >=1  → 4dp
    expect(scrubbyInput({ value: 0.123456789, onInput: vi.fn() }).el.textContent).toBe('0.123457');  // <1   → 6dp
    // Trailing zeros still strip cleanly across the bands.
    expect(scrubbyInput({ value: 1200, onInput: vi.fn() }).el.textContent).toBe('1200');
  });
});

describe('scrubbyInput — lifecycle', () => {
  it('setValue updates display without firing onInput', () => {
    const onInput = vi.fn();
    const { el, setValue } = scrubbyInput({ value: 0.5, onInput });
    document.body.appendChild(el);
    setValue(0.75);
    expect(el.textContent).toBe('0.75');
    expect(onInput).not.toHaveBeenCalled();
  });

  it('setValue clamps to bounds', () => {
    const onInput = vi.fn();
    const { el, setValue } = scrubbyInput({ value: 0.5, onInput, max: 1 });
    setValue(999);
    expect(el.textContent).toBe('1');
  });

  it('destroy removes the element and listeners', () => {
    const onInput = vi.fn();
    const { el, destroy } = scrubbyInput({ value: 0.5, onInput, kind: 'weight' });
    document.body.appendChild(el);
    destroy();
    expect(el.parentNode).toBe(null);
    // Dispatch on the detached el: must NOT fire onInput
    pdown(el, 100);
    pmove(el, 110);
    expect(onInput).not.toHaveBeenCalled();
  });
});

describe('scrubbyInput — constants', () => {
  it('exports the right RATE and MIN_STEP table', () => {
    expect(RATE).toBe(0.005);
    expect(MIN_STEP.weight).toBe(0.0025);
    expect(MIN_STEP.color).toBe(0.005);
    expect(MIN_STEP.position).toBe(0.001);
    expect(MIN_STEP.rotation).toBe(0.05);
    expect(MIN_STEP.scale).toBe(0.005);
    expect(MIN_STEP.generic).toBe(0.001);
  });
});
