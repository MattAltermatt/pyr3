// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { openAnimateExportModal } from './animate-export-modal';
import { type ExportEstimate } from './animate-estimate';

const baseOpts = {
  defaults: { begin: 0, end: 9, dtime: 1, qs: 1, prefix: '' },
  onStart: () => {},
  onCancel: () => {},
  onClose: () => {},
};

beforeEach(() => {
  document.body.replaceChildren();
});

describe('animate export modal — up-front estimate (#226)', () => {
  it('renders the estimate line from the estimate hook on open', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const estimate = vi.fn(
      (): ExportEstimate => ({ frames: 10, totalSamples: 5_000_000, seconds: 4 }),
    );
    const handle = openAnimateExportModal({ host, ...baseOpts, estimate });
    const line = host.querySelector('[data-export-estimate]');
    expect(line).not.toBeNull();
    expect(estimate).toHaveBeenCalledTimes(1);
    expect(line!.textContent).toContain('10 frames');
    expect(line!.textContent).toContain('est. time 0:04');
    expect(line!.textContent).toContain('this machine');
    handle.close();
  });

  it('recomputes the estimate when a cost field changes', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const estimate = vi.fn(
      (range: { begin: number; end: number }): ExportEstimate => ({
        frames: range.end - range.begin + 1,
        totalSamples: 1000,
        seconds: 1,
      }),
    );
    const handle = openAnimateExportModal({ host, ...baseOpts, estimate });
    const beginInput = host.querySelectorAll('input[type=number]')[0] as HTMLInputElement;
    beginInput.value = '5';
    beginInput.dispatchEvent(new Event('input'));
    // initial call + the input-driven recompute
    expect(estimate.mock.calls.length).toBeGreaterThanOrEqual(2);
    const last = estimate.mock.calls[estimate.mock.calls.length - 1]![0];
    expect(last.begin).toBe(5);
    handle.close();
  });

  it('hides the estimate line when no estimate hook is provided', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = openAnimateExportModal({ host, ...baseOpts });
    const line = host.querySelector('[data-export-estimate]') as HTMLElement;
    expect(line.style.display).toBe('none');
    handle.close();
  });
});
