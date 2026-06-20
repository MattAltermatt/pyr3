// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { buildBackgroundControl } from './edit-section-background';
import { createEditState } from './edit-state';
import { generateRandomGenome } from './edit-seed';

function makeState() {
  return createEditState(generateRandomGenome(() => 0.5), 1);
}
function inputOf(el: HTMLElement): HTMLInputElement {
  return el.querySelector('input[type="color"]') as HTMLInputElement;
}

describe('buildBackgroundControl (#27 mirror)', () => {
  it('editing one control writes the genome and mirrors to the other', () => {
    const state = makeState();
    const onChange = vi.fn();
    const a = buildBackgroundControl(state, onChange);
    const b = buildBackgroundControl(state, onChange);
    const inputA = inputOf(a.el);
    inputA.value = '#ff0000';
    inputA.dispatchEvent(new Event('input'));
    expect(state.genome.background).toEqual([1, 0, 0]);
    expect(inputOf(b.el).value).toBe('#ff0000'); // mirrored without an explicit edit
    expect(onChange).toHaveBeenCalledWith('background');
  });

  it('the #351 overlay structure is preserved (interactable full-size input)', () => {
    const state = makeState();
    const { el } = buildBackgroundControl(state, vi.fn());
    const input = inputOf(el);
    expect(input.style.position).toBe('absolute');
    expect(input.style.width).toBe('100%');
    expect(input.style.opacity).toBe('0');
    expect(input.style.pointerEvents).not.toBe('none');
    expect((el.querySelector('.pyr3-color-swatch') as HTMLElement).style.pointerEvents).toBe('none');
  });

  it('dispose() unregisters the mirror listener', () => {
    const state = makeState();
    const a = buildBackgroundControl(state, vi.fn());
    const b = buildBackgroundControl(state, vi.fn());
    b.dispose();
    const inputA = inputOf(a.el);
    inputA.value = '#0000ff';
    inputA.dispatchEvent(new Event('input'));
    expect(inputOf(b.el).value).not.toBe('#0000ff'); // disposed → not mirrored
  });
});
