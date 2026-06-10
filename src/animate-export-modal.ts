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

export interface AnimateExportFormValues {
  begin: number;
  end: number;
  dtime: number;
  qs: number;
  prefix: string;
  outDir: string;
}

export interface AnimateExportModalOpts {
  host: HTMLElement;
  /** Defaults derived from the loaded Animation's keyframe time range. */
  defaults: Pick<AnimateExportFormValues, 'begin' | 'end' | 'dtime' | 'qs' | 'prefix'>;
  onStart(values: AnimateExportFormValues): void;
  onCancel(): void;
  onClose(): void;
  /** Pop a native OS folder picker. Resolves to the absolute path the
   *  user selected, `null` if dismissed, or an Error with a surfacable
   *  message on a missing-picker / failure. Caller wires this to
   *  POST /api/pick-dir when running under pyr3 serve. */
  pickDirectory?(): Promise<string | null>;
}

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

  const beginIn = makeNumberInput('begin (frame)', opts.defaults.begin, 0, 1);
  const endIn = makeNumberInput('end (frame)', opts.defaults.end, 0, 1);
  const dtimeIn = makeNumberInput('dtime (stride)', opts.defaults.dtime, 1, 1);
  const qsIn = makeNumberInput('quality scale', opts.defaults.qs, 0.05, 0.05);
  const prefixIn = makeTextInput('prefix', opts.defaults.prefix, 'optional filename prefix');
  const outDirIn = makeTextInput('output dir', '', 'absolute or relative to pyr3 serve cwd');
  outDirIn.input.required = true;
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

  form.append(beginIn.row, endIn.row, dtimeIn.row, qsIn.row, prefixIn.row, outDirIn.row);

  const formNote = document.createElement('div');
  formNote.textContent =
    'Files: <prefix><frame:05>.png. Existing files in the directory are overwritten.';
  Object.assign(formNote.style, {
    fontSize: '11px',
    color: '#666',
    marginTop: '6px',
  });
  panel.appendChild(formNote);

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
      opts.onStart(values);
    } else if (state === 'done') {
      opts.onClose();
    }
  });

  buttons.append(dismiss, action);
  opts.host.appendChild(root);

  // ── helpers ────────────────────────────────────────────────────────────
  function readForm(): AnimateExportFormValues {
    return {
      begin: Number(beginIn.input.value),
      end: Number(endIn.input.value),
      dtime: Math.max(1, Math.floor(Number(dtimeIn.input.value) || 1)),
      qs: Math.max(0.01, Number(qsIn.input.value) || 1),
      prefix: prefixIn.input.value,
      outDir: outDirIn.input.value.trim(),
    };
  }

  function validate(v: AnimateExportFormValues): string | null {
    if (v.outDir.length === 0) return 'output dir is required';
    if (!Number.isFinite(v.begin) || !Number.isFinite(v.end)) return 'begin / end must be numbers';
    if (v.end < v.begin) return 'end must be ≥ begin';
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
