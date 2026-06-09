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

describe('render progress modal — #195 ETA + iteration readouts', () => {
  it('shows samples / target when both are present', () => {
    const handle = openRenderProgressModal(makeOpts({ targetSamples: 8_290_000 }));
    handle.setProgress({ percent: 0.5, samples: 4_100_000, etaSeconds: 12 });
    const samples = document.body.querySelector('[data-progress-samples]') as HTMLElement;
    expect(samples.textContent).toBe('4.1M / 8.3M samples');
  });

  it('formats ETA seconds as ~M:SS', () => {
    const handle = openRenderProgressModal(makeOpts({ targetSamples: 1_000_000 }));
    handle.setProgress({ percent: 0.3, samples: 300_000, etaSeconds: 75 });
    const eta = document.body.querySelector('[data-progress-eta]') as HTMLElement;
    expect(eta.textContent).toBe('~1:15 remaining');
  });

  it('formats ETA under a minute as ~Ns', () => {
    const handle = openRenderProgressModal(makeOpts({ targetSamples: 1_000_000 }));
    handle.setProgress({ percent: 0.9, samples: 900_000, etaSeconds: 8 });
    const eta = document.body.querySelector('[data-progress-eta]') as HTMLElement;
    expect(eta.textContent).toBe('~8s remaining');
  });

  it('hides ETA when etaSeconds is missing', () => {
    const handle = openRenderProgressModal(makeOpts({ targetSamples: 1_000_000 }));
    handle.setProgress({ percent: 0.5, samples: 500_000 });
    const eta = document.body.querySelector('[data-progress-eta]') as HTMLElement;
    expect(eta.textContent).toBe('');
  });

  it('drops the / target suffix when targetSamples is omitted', () => {
    const handle = openRenderProgressModal(makeOpts());
    handle.setProgress({ percent: 0.5, samples: 500_000, etaSeconds: 10 });
    const samples = document.body.querySelector('[data-progress-samples]') as HTMLElement;
    expect(samples.textContent).toBe('500k samples');
  });

  it('legacy bare-number setProgress still updates percent', () => {
    const handle = openRenderProgressModal(makeOpts({ targetSamples: 1_000_000 }));
    handle.setProgress(0.42);
    const pct = document.body.querySelector('[data-progress-pct]') as HTMLElement;
    const samples = document.body.querySelector('[data-progress-samples]') as HTMLElement;
    expect(pct.textContent).toBe('42 %');
    expect(samples.textContent).toBe('');
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
