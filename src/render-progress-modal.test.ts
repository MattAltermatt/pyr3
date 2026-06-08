// @vitest-environment happy-dom
//
// Unit tests for the render progress modal used by Save Render (#176).
// The modal opens BEFORE GPU dispatch so the user sees something paint
// while the render saturates the device, and ticks a [0..1] progress
// fraction set by the host between dispatch batches.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { openRenderProgressModal, type RenderProgressModalOpts } from './render-progress-modal';

afterEach(() => {
  document.body.innerHTML = '';
});

function makeOpts(over: Partial<RenderProgressModalOpts> = {}): RenderProgressModalOpts {
  return {
    host: document.body,
    sizeLabel: '4K',
    qualityLabel: '100',
    onCancel: vi.fn(),
    ...over,
  };
}

describe('render progress modal — mount', () => {
  it('mounts modal DOM immediately into the host', () => {
    openRenderProgressModal(makeOpts());
    const root = document.body.querySelector('[data-render-progress-modal]');
    expect(root).toBeTruthy();
  });

  it('renders the title with em-dash and middot from labels', () => {
    openRenderProgressModal(makeOpts({ sizeLabel: '4K', qualityLabel: '100' }));
    const root = document.body.querySelector('[data-render-progress-modal]') as HTMLElement;
    expect(root.textContent).toContain('Rendering — 4K · Q 100');
  });

  it('exposes a progress fill and percentage element', () => {
    openRenderProgressModal(makeOpts());
    expect(document.body.querySelector('[data-progress-fill]')).toBeTruthy();
    expect(document.body.querySelector('[data-progress-pct]')).toBeTruthy();
  });

  it('exposes a cancel button', () => {
    openRenderProgressModal(makeOpts());
    expect(document.body.querySelector('[data-cancel]')).toBeTruthy();
  });
});

describe('render progress modal — setProgress', () => {
  it('formats 0.42 as "42 %"', () => {
    const handle = openRenderProgressModal(makeOpts());
    handle.setProgress(0.42);
    const pct = document.body.querySelector('[data-progress-pct]') as HTMLElement;
    expect(pct.textContent).toBe('42 %');
  });

  it('clamps negative fractions to 0 %', () => {
    const handle = openRenderProgressModal(makeOpts());
    handle.setProgress(-0.5);
    const pct = document.body.querySelector('[data-progress-pct]') as HTMLElement;
    expect(pct.textContent).toBe('0 %');
  });

  it('clamps >1 fractions to 100 %', () => {
    const handle = openRenderProgressModal(makeOpts());
    handle.setProgress(1.5);
    const pct = document.body.querySelector('[data-progress-pct]') as HTMLElement;
    expect(pct.textContent).toBe('100 %');
  });

  it('reflects fraction on the fill width style', () => {
    const handle = openRenderProgressModal(makeOpts());
    handle.setProgress(0.5);
    const fill = document.body.querySelector('[data-progress-fill]') as HTMLElement;
    expect(fill.style.width).toBe('50%');
  });
});

describe('render progress modal — cancel + close', () => {
  it('fires onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    openRenderProgressModal(makeOpts({ onCancel }));
    const btn = document.body.querySelector('[data-cancel]') as HTMLButtonElement;
    btn.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('close() removes the modal DOM', () => {
    const handle = openRenderProgressModal(makeOpts());
    expect(document.body.querySelector('[data-render-progress-modal]')).toBeTruthy();
    handle.close();
    expect(document.body.querySelector('[data-render-progress-modal]')).toBeNull();
  });

  it('multiple open + close cycles do not leak DOM', () => {
    for (let i = 0; i < 5; i++) {
      const handle = openRenderProgressModal(makeOpts());
      handle.setProgress(0.3);
      handle.close();
    }
    expect(document.body.querySelectorAll('[data-render-progress-modal]').length).toBe(0);
  });
});
