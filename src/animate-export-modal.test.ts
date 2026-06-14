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
    const outDirInput = host.querySelector('input[required]') as HTMLInputElement;
    outDirInput.value = '/tmp/out';
    outDirInput.dispatchEvent(new Event('input'));
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
    outDir.dispatchEvent(new Event('input'));
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

describe('animate export modal — Start gated on output dir (#277)', () => {
  it('disables + dims Start while output dir is empty, enables once typed', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = openAnimateExportModal({ host, ...baseOpts });
    const action = host.querySelector('[data-action]') as HTMLButtonElement;
    const outDir = host.querySelector('input[data-out-dir]') as HTMLInputElement;
    const warn = host.querySelector('[data-out-dir-warn]') as HTMLElement;
    // Empty on open → blocked, with a clear "required" reason tied to the dir.
    expect(action.disabled).toBe(true);
    expect(Number(action.style.opacity)).toBeLessThan(1);
    expect((warn.textContent ?? '').toLowerCase()).toContain('required');
    // Type an absolute path → enabled, advisory clears.
    outDir.value = '/tmp/out';
    outDir.dispatchEvent(new Event('input'));
    expect(action.disabled).toBe(false);
    expect(action.style.opacity).toBe('1');
    expect(warn.textContent).toBe('');
    // Clear again → blocked + required message returns (whitespace = empty).
    outDir.value = '   ';
    outDir.dispatchEvent(new Event('input'));
    expect(action.disabled).toBe(true);
    expect((warn.textContent ?? '').toLowerCase()).toContain('required');
    handle.close();
  });

  it('does not fire onStart while Start is disabled (empty dir)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let started = false;
    const handle = openAnimateExportModal({ host, ...baseOpts, onStart: () => { started = true; } });
    (host.querySelector('[data-action]') as HTMLButtonElement).click();
    expect(started).toBe(false);
    handle.close();
  });

  it('Browse picking a directory enables Start', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = openAnimateExportModal({
      host, ...baseOpts, pickDirectory: async () => '/picked/dir',
    });
    const action = host.querySelector('[data-action]') as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    const browse = host.querySelector('[data-pick-dir]') as HTMLButtonElement;
    browse.click();
    await Promise.resolve();
    await Promise.resolve();
    expect((host.querySelector('input[data-out-dir]') as HTMLInputElement).value).toBe('/picked/dir');
    expect(action.disabled).toBe(false);
    handle.close();
  });

  it('warns when the path is relative (resolves against the serve cwd)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = openAnimateExportModal({ host, ...baseOpts });
    const outDir = host.querySelector('input[data-out-dir]') as HTMLInputElement;
    outDir.value = 'frames';
    outDir.dispatchEvent(new Event('input'));
    const warn = host.querySelector('[data-out-dir-warn]') as HTMLElement;
    expect(warn.textContent ?? '').toMatch(/relative/i);
    // Absolute path clears the warning.
    outDir.value = '/tmp/frames';
    outDir.dispatchEvent(new Event('input'));
    expect(warn.textContent).toBe('');
    handle.close();
  });
});

describe('animate export modal — readable ETA + preview (#279)', () => {
  it('renders D/H/M/S remaining + a finish clock time', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = openAnimateExportModal({ host, ...baseOpts });
    handle.showProgress();
    handle.setProgress({ frame: 13, total: 603, percent: 0.02, elapsedSeconds: 341, etaSeconds: 15455 });
    const eta = host.querySelector('[data-progress-eta]')!.textContent!;
    expect(eta).toContain('4h 17m 35s remaining');
    expect(eta).toContain('finishes ~');
    expect(eta).toContain('elapsed 5m 41s');
    handle.close();
  });

  it('shows the last-frame thumbnail when a thumb is provided', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = openAnimateExportModal({ host, ...baseOpts });
    handle.showProgress();
    const dataUri = 'data:image/png;base64,iVBORw0KGgo=';
    handle.setProgress({ frame: 1, total: 10, percent: 0.1, elapsedSeconds: 1, etaSeconds: 9, thumb: dataUri });
    const img = host.querySelector('[data-progress-preview]') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toBe(dataUri);
    handle.close();
  });
});
