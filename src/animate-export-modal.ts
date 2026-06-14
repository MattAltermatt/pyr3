// Modal for /v1/animate's Export Sequence button (#212). Two states in one
// shell:
//
//   1. Form  — user fills begin/end/dtime/qs/prefix/out_dir, hits Start.
//   2. Progress — frame counter + bar + ETA + Cancel.
//
// Pattern after src/render-progress-modal.ts. Caller handles the actual
// /api/animate POST (via src/animate-export.ts) and ticks setProgress; this
// module owns the DOM + form input + cancel button.
//
// Per the issue spec: out_dir is a plain `<input type="text">` because
// browsers can't pick a folder from a regular page; the backend resolves
// relative paths against the `pyr3 serve` cwd. The input is blank by
// default — the user must type a path before Start lights up.

import { type ExportRange, type ExportEstimate, formatExportEstimate } from './animate-estimate';

export type AnimateExportFormValues =
  | { mode: 'animation'; begin: number; end: number; dtime: number; qs: number; prefix: string; outDir: string; resume: boolean }
  | { mode: 'timeline'; fps: number; quality: number; prefix: string; outDir: string; resume: boolean };

interface BaseModalOpts {
  host: HTMLElement;
  /** #274 — output dimensions chosen in the viewer chrome. Echoed read-only so
   *  the user confirms the export resolution before Start. */
  outputSize: { width: number; height: number };
  onCancel(): void;
  onClose(): void;
  /** Pop a native OS folder picker. Resolves to the absolute path the
   *  user selected, `null` if dismissed, or an Error with a surfacable
   *  message on a missing-picker / failure. Caller wires this to
   *  POST /api/pick-dir when running under pyr3 serve. */
  pickDirectory?(): Promise<string | null>;
}

/** Animation export — begin/end frame + dtime stride + qs scale (#212/#226). */
interface AnimationModalOpts extends BaseModalOpts {
  mode: 'animation';
  /** Defaults derived from the loaded Animation's keyframe time range. */
  defaults: { begin: number; end: number; dtime: number; qs: number; prefix: string };
  onStart(values: Extract<AnimateExportFormValues, { mode: 'animation' }>): void;
  estimate?(range: ExportRange): ExportEstimate;
}

/** Timeline export (#227) — fps + absolute quality; renders the whole timeline.
 *  A read-only "duration → N frames" line replaces begin/end/dtime. */
interface TimelineModalOpts extends BaseModalOpts {
  mode: 'timeline';
  /** Σ clip durations — drives the read-only frames readout. */
  durationSeconds: number;
  defaults: { fps: number; quality: number; prefix: string };
  onStart(values: Extract<AnimateExportFormValues, { mode: 'timeline' }>): void;
  estimate?(range: { fps: number; quality: number }): ExportEstimate;
}

export type AnimateExportModalOpts = AnimationModalOpts | TimelineModalOpts;

export interface AnimateExportProgressInfo {
  frame: number;
  total: number;
  percent: number;
  written?: string;
  elapsedSeconds: number;
  etaSeconds: number;
}

export interface AnimateExportModalHandle {
  /** Switch the modal from form state to progress state. Idempotent. */
  showProgress(): void;
  /** Tick the progress UI. No-op before showProgress() is called. */
  setProgress(info: AnimateExportProgressInfo): void;
  /** Show a terminal message (success or cancellation) above the close
   *  button. The modal stays open until the user dismisses it. */
  showResult(label: string, tone: 'info' | 'success' | 'error'): void;
  /** Remove the modal DOM. Idempotent. */
  close(): void;
}

function formatEta(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '';
  if (s < 1) return '<1s';
  const secs = Math.round(s);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const sec = secs % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** Concrete example filename(s) for the current form — actual prefix, actual
 *  frame range, actual zero-pad width (≥5, auto-widened to fit the last frame,
 *  matching the backend). Shows `first … last` so the user sees exactly what
 *  lands on disk. */
function frameNameExample(v: AnimateExportFormValues, durationSeconds: number): string {
  let first: number;
  let last: number;
  if (v.mode === 'timeline') {
    const count = Math.max(1, Math.round(durationSeconds * v.fps));
    first = 0;
    last = count - 1;
  } else if (!Number.isFinite(v.begin) || !Number.isFinite(v.end) || v.end < v.begin) {
    first = 0;
    last = 0;
  } else {
    const step = Math.max(1, Math.floor(v.dtime));
    const count = Math.floor((v.end - v.begin) / step) + 1;
    first = v.begin;
    last = v.begin + (count - 1) * step;
  }
  const pad = Math.max(5, String(last).length);
  const name = (n: number): string => `${v.prefix}${String(n).padStart(pad, '0')}.png`;
  return first === last ? name(first) : `${name(first)} … ${name(last)}`;
}

function makeNumberInput(label: string, value: number, min?: number, step?: number): {
  row: HTMLElement;
  input: HTMLInputElement;
} {
  const row = document.createElement('label');
  Object.assign(row.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '12px',
    color: '#ccc',
  });
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  labelEl.style.minWidth = '110px';
  const input = document.createElement('input');
  input.type = 'number';
  input.value = String(value);
  if (min !== undefined) input.min = String(min);
  if (step !== undefined) input.step = String(step);
  Object.assign(input.style, {
    flex: '1',
    background: '#1a1a1a',
    border: '1px solid #333',
    color: '#eee',
    padding: '4px 8px',
    borderRadius: '3px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
  });
  row.append(labelEl, input);
  return { row, input };
}

function makeTextInput(label: string, value: string, placeholder?: string): {
  row: HTMLElement;
  input: HTMLInputElement;
} {
  const row = document.createElement('label');
  Object.assign(row.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '12px',
    color: '#ccc',
  });
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  labelEl.style.minWidth = '110px';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  if (placeholder) input.placeholder = placeholder;
  Object.assign(input.style, {
    flex: '1',
    background: '#1a1a1a',
    border: '1px solid #333',
    color: '#eee',
    padding: '4px 8px',
    borderRadius: '3px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
  });
  row.append(labelEl, input);
  return { row, input };
}

function makeBrowseButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('data-pick-dir', '');
  btn.textContent = 'Browse…';
  Object.assign(btn.style, {
    background: '#1a1a1a',
    border: '1px solid #333',
    color: '#eee',
    cursor: 'pointer',
    padding: '4px 10px',
    borderRadius: '3px',
    fontSize: '12px',
    whiteSpace: 'nowrap',
  });
  return btn;
}

export function openAnimateExportModal(
  opts: AnimateExportModalOpts,
): AnimateExportModalHandle {
  const root = document.createElement('div');
  root.setAttribute('data-animate-export-modal', '');
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '1000',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  });

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    background: '#0e0e0e',
    border: '1px solid #2a2a2a',
    borderRadius: '6px',
    padding: '20px 24px',
    minWidth: '420px',
    maxWidth: '560px',
    boxShadow: '0 18px 48px rgba(0,0,0,0.6)',
    color: '#eee',
  });
  root.appendChild(panel);

  const title = document.createElement('div');
  title.textContent = 'Export sequence';
  Object.assign(title.style, {
    fontSize: '14px',
    color: '#fff',
    marginBottom: '4px',
  });
  panel.appendChild(title);

  const sub = document.createElement('div');
  sub.textContent = 'Renders each frame on the backend and writes PNGs to a folder on disk.';
  Object.assign(sub.style, {
    fontSize: '11px',
    color: '#888',
    marginBottom: '16px',
  });
  panel.appendChild(sub);

  // Inline validation strip — declared up front so the form row builders
  // (Browse click handler) can close over it without TDZ-ordering jitter.
  const validationMsg = document.createElement('div');
  Object.assign(validationMsg.style, {
    fontSize: '11px',
    color: '#f99',
    marginTop: '8px',
    minHeight: '14px',
  });

  // ── form state ──────────────────────────────────────────────────────────
  const form = document.createElement('div');
  Object.assign(form.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  });
  panel.appendChild(form);

  // Mode-specific cost fields. Animation: begin/end/dtime/qs. Timeline: a
  // read-only duration→frames readout + fps + absolute quality (#227).
  let beginIn!: ReturnType<typeof makeNumberInput>;
  let endIn!: ReturnType<typeof makeNumberInput>;
  let dtimeIn!: ReturnType<typeof makeNumberInput>;
  let qsIn!: ReturnType<typeof makeNumberInput>;
  let fpsIn!: ReturnType<typeof makeNumberInput>;
  let qualityIn!: ReturnType<typeof makeNumberInput>;
  let framesReadout: HTMLElement | null = null;
  if (opts.mode === 'animation') {
    beginIn = makeNumberInput('begin (frame)', opts.defaults.begin, 0, 1);
    endIn = makeNumberInput('end (frame)', opts.defaults.end, 0, 1);
    dtimeIn = makeNumberInput('dtime (stride)', opts.defaults.dtime, 1, 1);
    qsIn = makeNumberInput('quality scale', opts.defaults.qs, 0.05, 0.05);
  } else {
    framesReadout = document.createElement('div');
    Object.assign(framesReadout.style, { fontSize: '12px', color: '#bbb', marginBottom: '2px' });
    fpsIn = makeNumberInput('fps', opts.defaults.fps, 1, 1);
    qualityIn = makeNumberInput('quality', opts.defaults.quality, 1, 1);
  }
  const prefixIn = makeTextInput('prefix', opts.defaults.prefix, 'optional filename prefix');
  const outDirIn = makeTextInput('output dir *', '', 'required — absolute or relative to pyr3 serve cwd');
  outDirIn.input.required = true;
  outDirIn.input.dataset['outDir'] = '';

  // #277 — advisory shown when the typed path is relative. A relative (or
  // blank) path resolves against the `pyr3 serve` cwd, which is usually the
  // repo — a careless export then dumps thousands of PNGs into the project
  // folder. Non-blocking: relative paths are legal if the user knows their cwd.
  const outDirWarn = document.createElement('div');
  outDirWarn.setAttribute('data-out-dir-warn', '');
  Object.assign(outDirWarn.style, {
    fontSize: '11px',
    color: '#db9',
    marginTop: '-2px',
    minHeight: '0',
  });

  // #274 — read-only echo of the output resolution chosen in the viewer chrome.
  const dimsEcho = document.createElement('div');
  Object.assign(dimsEcho.style, { fontSize: '12px', color: '#bbb', marginBottom: '2px' });
  dimsEcho.textContent = `Output: ${opts.outputSize.width}×${opts.outputSize.height}`;

  // #275 — resume / skip-existing. Default ON; uncheck = overwrite/re-render all.
  const resumeRow = document.createElement('label');
  Object.assign(resumeRow.style, {
    display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#ccc',
  });
  const resumeIn = document.createElement('input');
  resumeIn.type = 'checkbox';
  resumeIn.checked = true;
  resumeIn.dataset['resume'] = '';
  const resumeLabel = document.createElement('span');
  resumeLabel.textContent = 'Skip frames already rendered';
  resumeRow.append(resumeIn, resumeLabel);
  // Tuck a Browse button into the out_dir row when the caller provides a
  // pickDirectory hook (only does on pyr3 serve, where /api/pick-dir is wired).
  if (opts.pickDirectory) {
    const browse = makeBrowseButton();
    browse.addEventListener('click', async () => {
      browse.disabled = true;
      browse.style.opacity = '0.5';
      try {
        const picked = await opts.pickDirectory!();
        if (picked) {
          outDirIn.input.value = picked;
          validationMsg.textContent = '';
          syncOutDir();
        }
      } catch (err) {
        validationMsg.textContent =
          err instanceof Error ? err.message : 'native folder picker failed';
      } finally {
        browse.disabled = false;
        browse.style.opacity = '1';
      }
    });
    outDirIn.row.appendChild(browse);
  }

  if (opts.mode === 'animation') {
    form.append(dimsEcho, beginIn.row, endIn.row, dtimeIn.row, qsIn.row, prefixIn.row, outDirIn.row, outDirWarn, resumeRow);
  } else {
    form.append(dimsEcho, framesReadout!, fpsIn.row, qualityIn.row, prefixIn.row, outDirIn.row, outDirWarn, resumeRow);
  }

  // #226 — live up-front estimate line. Recomputed whenever a cost-affecting
  // field changes. Hidden when no estimate hook is wired (e.g. tests / gh-pages
  // where export is never reachable).
  const estimateLine = document.createElement('div');
  estimateLine.setAttribute('data-export-estimate', '');
  Object.assign(estimateLine.style, {
    fontSize: '11px',
    color: '#9cd',
    marginTop: '8px',
    minHeight: '14px',
  });
  form.appendChild(estimateLine);

  function refreshEstimate(): void {
    const v = readForm();
    if (v.mode === 'timeline' && framesReadout) {
      const frames = Math.max(1, Math.round((opts as TimelineModalOpts).durationSeconds * v.fps));
      framesReadout.textContent = `duration ${(opts as TimelineModalOpts).durationSeconds.toFixed(2)}s → ${frames} frames`;
    }
    if (!opts.estimate) {
      estimateLine.style.display = 'none';
      return;
    }
    const est = v.mode === 'animation'
      ? (opts as AnimationModalOpts).estimate!({ begin: v.begin, end: v.end, dtime: v.dtime, qs: v.qs })
      : (opts as TimelineModalOpts).estimate!({ fps: v.fps, quality: v.quality });
    estimateLine.textContent = formatExportEstimate(est);
  }

  const formNote = document.createElement('div');
  Object.assign(formNote.style, {
    fontSize: '11px',
    color: '#666',
    marginTop: '6px',
  });
  panel.appendChild(formNote);

  // Live file-name hint: the `<prefix><frame:05>.png` template + a concrete
  // example using the actual prefix + frame range, so the user sees the real
  // names before rendering. Recomputed as prefix / fps / begin-end-dtime change.
  function refreshFileNote(): void {
    const v = readForm();
    const dur = opts.mode === 'timeline' ? (opts as TimelineModalOpts).durationSeconds : 0;
    formNote.textContent =
      `Files: <prefix><frame:05>.png — e.g. ${frameNameExample(v, dur)}. `
      + (v.resume
        ? 'Existing frames skipped (resume).'
        : 'Existing files in the directory are overwritten.');
  }

  function refreshForm(): void {
    refreshEstimate();
    refreshFileNote();
  }

  // #277 — true if the path is absolute (POSIX `/…` or Windows `C:\…` / `C:/…`).
  // A relative path resolves against the `pyr3 serve` cwd, so warn on it.
  function isAbsolutePath(p: string): boolean {
    return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
  }

  // #277 — gate Start on a non-empty output dir (disabled+dim over post-click
  // error, per the no-jump UX convention) and surface the relative-path
  // advisory. Called on every outDir input, after Browse, and at init.
  function syncOutDir(): void {
    const dir = outDirIn.input.value.trim();
    const ready = dir.length > 0;
    action.disabled = !ready;
    action.style.opacity = ready ? '1' : '0.5';
    action.style.cursor = ready ? 'pointer' : 'not-allowed';
    action.title = ready ? '' : 'Set an output directory to enable export';
    // Empty → explain *why* Start is blocked (the required destination).
    // Non-empty relative → foot-gun advisory. Absolute → no message.
    outDirWarn.textContent = !ready
      ? '⚠ Output directory required — set a destination to enable Start'
      : !isAbsolutePath(dir)
        ? '⚠ relative path — resolves against the pyr3 serve working directory'
        : '';
  }

  const costInputs = opts.mode === 'animation' ? [beginIn, endIn, dtimeIn, qsIn] : [fpsIn, qualityIn];
  for (const f of [...costInputs, prefixIn]) {
    f.input.addEventListener('input', refreshForm);
  }
  resumeIn.addEventListener('change', refreshForm);
  refreshForm();

  panel.appendChild(validationMsg);

  // ── progress state (hidden until showProgress) ──────────────────────────
  const progress = document.createElement('div');
  Object.assign(progress.style, {
    display: 'none',
    flexDirection: 'column',
    gap: '8px',
  });
  panel.appendChild(progress);

  const progressLine = document.createElement('div');
  progressLine.setAttribute('data-progress-line', '');
  progressLine.style.fontSize = '12px';
  progressLine.textContent = 'starting…';
  progress.appendChild(progressLine);

  const barWrap = document.createElement('div');
  Object.assign(barWrap.style, {
    height: '6px',
    background: '#222',
    borderRadius: '3px',
    overflow: 'hidden',
  });
  const fill = document.createElement('div');
  fill.setAttribute('data-progress-fill', '');
  Object.assign(fill.style, {
    height: '100%',
    width: '0%',
    background: '#9cd',
    transition: 'width 120ms linear',
  });
  barWrap.appendChild(fill);
  progress.appendChild(barWrap);

  const etaLine = document.createElement('div');
  etaLine.setAttribute('data-progress-eta', '');
  Object.assign(etaLine.style, {
    fontSize: '11px',
    color: '#888',
    minHeight: '14px',
  });
  progress.appendChild(etaLine);

  const resultLine = document.createElement('div');
  resultLine.setAttribute('data-result', '');
  Object.assign(resultLine.style, {
    fontSize: '12px',
    marginTop: '6px',
    minHeight: '16px',
  });
  panel.appendChild(resultLine);

  // ── buttons ─────────────────────────────────────────────────────────────
  const buttons = document.createElement('div');
  Object.assign(buttons.style, {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '16px',
  });
  panel.appendChild(buttons);

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.setAttribute('data-dismiss', '');
  dismiss.textContent = 'Cancel';
  Object.assign(dismiss.style, {
    background: 'transparent',
    border: '1px solid #444',
    color: '#ccc',
    cursor: 'pointer',
    padding: '6px 14px',
    borderRadius: '3px',
    fontSize: '12px',
  });
  dismiss.addEventListener('click', () => {
    opts.onCancel();
  });

  const action = document.createElement('button');
  action.type = 'button';
  action.setAttribute('data-action', '');
  action.textContent = 'Start';
  Object.assign(action.style, {
    background: '#244',
    border: '1px solid #466',
    color: '#cff',
    cursor: 'pointer',
    padding: '6px 14px',
    borderRadius: '3px',
    fontSize: '12px',
  });
  action.addEventListener('click', () => {
    if (state === 'form') {
      const values = readForm();
      const err = validate(values);
      if (err) {
        validationMsg.textContent = err;
        return;
      }
      validationMsg.textContent = '';
      // `values.mode` matches `opts.mode` by construction (readForm reads the
      // mode-appropriate fields); the union widening defeats TS narrowing here.
      (opts.onStart as (v: AnimateExportFormValues) => void)(values);
    } else if (state === 'done') {
      opts.onClose();
    }
  });

  buttons.append(dismiss, action);
  opts.host.appendChild(root);

  // #277 — live-sync the Start gate + relative-path advisory as the user types,
  // and set the initial disabled state (outDir starts blank).
  outDirIn.input.addEventListener('input', syncOutDir);
  syncOutDir();

  // ── helpers ────────────────────────────────────────────────────────────
  function readForm(): AnimateExportFormValues {
    const prefix = prefixIn.input.value;
    const outDir = outDirIn.input.value.trim();
    const resume = resumeIn.checked;
    if (opts.mode === 'animation') {
      return {
        mode: 'animation',
        begin: Number(beginIn.input.value),
        end: Number(endIn.input.value),
        dtime: Math.max(1, Math.floor(Number(dtimeIn.input.value) || 1)),
        qs: Math.max(0.01, Number(qsIn.input.value) || 1),
        prefix,
        outDir,
        resume,
      };
    }
    return {
      mode: 'timeline',
      fps: Math.max(1, Math.floor(Number(fpsIn.input.value) || 30)),
      quality: Math.max(1, Math.floor(Number(qualityIn.input.value) || 200)),
      prefix,
      outDir,
      resume,
    };
  }

  function validate(v: AnimateExportFormValues): string | null {
    if (v.outDir.length === 0) return 'output dir is required';
    if (v.mode === 'animation') {
      if (!Number.isFinite(v.begin) || !Number.isFinite(v.end)) return 'begin / end must be numbers';
      if (v.end < v.begin) return 'end must be ≥ begin';
    } else if (!Number.isFinite(v.fps) || v.fps < 1) {
      return 'fps must be ≥ 1';
    }
    return null;
  }

  let state: 'form' | 'progress' | 'done' = 'form';
  let closed = false;

  return {
    showProgress(): void {
      if (closed || state !== 'form') return;
      state = 'progress';
      form.style.display = 'none';
      formNote.style.display = 'none';
      validationMsg.style.display = 'none';
      progress.style.display = 'flex';
      action.style.display = 'none';
      dismiss.textContent = '✕ Cancel export';
    },
    setProgress(info: AnimateExportProgressInfo): void {
      if (closed || state !== 'progress') return;
      const pct = Math.round(info.percent * 100);
      fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      progressLine.textContent = `frame ${info.frame} / ${info.total} (${pct}%)`;
      const eta = formatEta(info.etaSeconds);
      const elapsed = formatEta(info.elapsedSeconds);
      etaLine.textContent = eta !== ''
        ? `~${eta} remaining · elapsed ${elapsed}`
        : `elapsed ${elapsed}`;
    },
    showResult(label: string, tone: 'info' | 'success' | 'error'): void {
      if (closed) return;
      state = 'done';
      resultLine.textContent = label;
      resultLine.style.color = tone === 'error' ? '#f99' : tone === 'success' ? '#9d9' : '#ccc';
      dismiss.style.display = 'none';
      action.style.display = 'inline-block';
      action.textContent = 'Close';
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
