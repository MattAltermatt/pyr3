// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { openAnimateExportModal } from './animate-export-modal';
import { type ExportEstimate } from './animate-estimate';

const baseOpts = {
  mode: 'animation' as const,
  defaults: { begin: 0, end: 9, dtime: 1, qs: 1, prefix: '' },
  outputSize: { width: 800, height: 600 },
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

describe('animate export modal — timeline mode (#227)', () => {
  it('renders fps + quality fields and a duration→frames readout', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = openAnimateExportModal({
      host, mode: 'timeline', durationSeconds: 7.5,
      outputSize: { width: 800, height: 600 },
      defaults: { fps: 30, quality: 200, prefix: '' },
      onStart: () => {}, onCancel: () => {}, onClose: () => {},
    });
    expect(host.textContent ?? '').toContain('225 frames'); // 7.5 × 30
    const labels = Array.from(host.querySelectorAll('span')).map((s) => s.textContent);
    expect(labels).toContain('fps');
    expect(labels).toContain('quality');
    expect(labels).not.toContain('begin (frame)');
    handle.close();
  });

  it('file-name hint shows a concrete example reflecting prefix + frame range', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = openAnimateExportModal({
      host, mode: 'timeline', durationSeconds: 7.5,
      outputSize: { width: 800, height: 600 },
      defaults: { fps: 30, quality: 200, prefix: 'tl_' },
      onStart: () => {}, onCancel: () => {}, onClose: () => {},
    });
    const note = [...host.querySelectorAll('div')].map((d) => d.textContent).find((t) => t?.includes('Files:'));
    expect(note).toContain('e.g. tl_00000.png');
    expect(note).toContain('tl_00224.png'); // 7.5 × 30 = 225 frames → last index 224
    handle.close();
  });

  it('onStart yields mode/fps/quality/prefix/outDir', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let started: unknown = null;
    const handle = openAnimateExportModal({
      host, mode: 'timeline', durationSeconds: 1,
      outputSize: { width: 800, height: 600 },
      defaults: { fps: 30, quality: 200, prefix: 'tl_' },
      onStart: (v) => { started = v; }, onCancel: () => {}, onClose: () => {},
    });
    (host.querySelector('input[required]') as HTMLInputElement).value = '/tmp/out';
    (host.querySelector('[data-action]') as HTMLButtonElement).click();
    expect(started).toMatchObject({ mode: 'timeline', fps: 30, quality: 200, prefix: 'tl_', outDir: '/tmp/out' });
    handle.close();
  });
});

describe('animate export modal — output dims + resume (#274/#275)', () => {
  it('echoes the output dimensions and defaults resume ON in form values', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let started: { resume?: boolean } | null = null;
    const handle = openAnimateExportModal({
      host,
      mode: 'timeline',
      durationSeconds: 2,
      outputSize: { width: 3840, height: 2160 },
      defaults: { fps: 30, quality: 200, prefix: '' },
      onStart: (v) => { started = v; },
      onCancel: () => {},
      onClose: () => {},
    });
    expect(host.textContent).toContain('3840×2160');
    const resume = host.querySelector('input[data-resume]') as HTMLInputElement;
    expect(resume.checked).toBe(true);
    const outDir = host.querySelector('input[data-out-dir]') as HTMLInputElement;
    outDir.value = '/tmp/x';
    (host.querySelector('[data-action]') as HTMLButtonElement).click();
    expect(started!.resume).toBe(true);
    handle.close();
  });

  it('file-note copy reflects resume vs overwrite', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = openAnimateExportModal({
      host,
      mode: 'timeline',
      durationSeconds: 2,
      outputSize: { width: 800, height: 600 },
      defaults: { fps: 30, quality: 200, prefix: '' },
      onStart: () => {},
      onCancel: () => {},
      onClose: () => {},
    });
    const resume = host.querySelector('input[data-resume]') as HTMLInputElement;
    expect(host.textContent).toContain('frames skipped (resume)');
    resume.checked = false;
    resume.dispatchEvent(new Event('change'));
    expect(host.textContent).toContain('overwritten');
    handle.close();
  });
});
