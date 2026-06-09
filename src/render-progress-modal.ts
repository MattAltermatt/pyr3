// Render progress modal — used by Save Render (#176).
//
// Mounts a fixed-position modal into the host element synchronously, so the
// caller can `await requestAnimationFrame(...)` once to guarantee first paint
// lands before GPU dispatch saturates the device. The host ticks
// `setProgress(fraction | info)` between dispatch batches and calls `close()`
// when the render completes or aborts. The Cancel button surfaces an abort
// path back to the host via `onCancel()`.
//
// #195 — setProgress accepts either a bare fraction (legacy) or a richer
// progress info object with `samples` + `etaSeconds`, surfaced as inline
// `samples / target` + `~M:SS remaining` readouts below the progress bar.
//
// CSS lives in Task 8's verify-cycle work — this module ships DOM structure
// + data attributes only, which is what the tests assert against.

export interface RenderProgressModalOpts {
  host: HTMLElement;
  sizeLabel: string;
  qualityLabel: string;
  /** #195 — total samples this render will accumulate. When present, the
   *  modal shows a `<samples> / <targetSamples>` readout that ticks alongside
   *  the percentage. Omit when the target isn't known up-front (legacy callers
   *  that pre-date the orchestrator's targetSamples plumbing). */
  targetSamples?: number;
  onCancel(): void;
}

/** #195 — richer setProgress payload. Either a bare fraction (legacy) or
 *  an object carrying the orchestrator's per-chunk ProgressInfo so the modal
 *  can show ETA + iteration count without duplicating the orchestrator's
 *  tracking layer. */
export interface RenderProgressInfo {
  percent: number;
  samples?: number;
  etaSeconds?: number;
}

export interface RenderProgressModalHandle {
  setProgress(input: number | RenderProgressInfo): void;
  close(): void;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Format a sample count as a compact M / K string ("4.2M", "120k", "850").
 *  Drops trailing ".0" so "4.0M" reads as "4M". Used by the modal's iteration
 *  readout — a raw 8,290,000 is noise; "8.3M / 16.6M" reads at a glance. */
function formatSamples(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1_000_000) {
    const m = (n / 1_000_000).toFixed(1).replace(/\.0$/, '');
    return `${m}M`;
  }
  if (n >= 1000) {
    const k = (n / 1000).toFixed(0);
    return `${k}k`;
  }
  return `${Math.round(n)}`;
}

/** Format remaining seconds as `M:SS` (or `<1s` for sub-second). Returns empty
 *  string for non-finite / negative input so the readout collapses when ETA
 *  isn't computable (e.g. before the first chunk completes). */
function formatEta(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '';
  if (s < 1) return '<1s';
  const secs = Math.round(s);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const sec = secs % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function openRenderProgressModal(
  opts: RenderProgressModalOpts,
): RenderProgressModalHandle {
  const root = document.createElement('div');
  root.setAttribute('data-render-progress-modal', '');
  root.className = 'pyr3-render-progress-modal';

  const panel = document.createElement('div');
  panel.className = 'pyr3-render-progress-modal-panel';
  root.appendChild(panel);

  const title = document.createElement('div');
  title.className = 'pyr3-render-progress-modal-title';
  title.textContent = `Rendering — ${opts.sizeLabel} · Q ${opts.qualityLabel}`;
  panel.appendChild(title);

  const barWrap = document.createElement('div');
  barWrap.className = 'pyr3-render-progress-modal-bar';
  panel.appendChild(barWrap);

  const fill = document.createElement('div');
  fill.setAttribute('data-progress-fill', '');
  fill.className = 'pyr3-render-progress-modal-fill';
  fill.style.width = '0%';
  barWrap.appendChild(fill);

  const pct = document.createElement('div');
  pct.setAttribute('data-progress-pct', '');
  pct.className = 'pyr3-render-progress-modal-pct';
  pct.textContent = '0 %';
  panel.appendChild(pct);

  // #195 — ETA + iteration count row. Both default to empty so a bare-fraction
  // caller (legacy) doesn't show stale info. Updated by setProgress when an
  // info object lands.
  const stats = document.createElement('div');
  stats.setAttribute('data-progress-stats', '');
  stats.className = 'pyr3-render-progress-modal-stats';
  stats.style.fontSize = '12px';
  stats.style.opacity = '0.75';
  stats.style.marginTop = '6px';
  stats.style.display = 'flex';
  stats.style.justifyContent = 'space-between';
  stats.style.gap = '12px';

  const samplesEl = document.createElement('span');
  samplesEl.setAttribute('data-progress-samples', '');
  samplesEl.textContent = '';
  const etaEl = document.createElement('span');
  etaEl.setAttribute('data-progress-eta', '');
  etaEl.textContent = '';
  stats.append(samplesEl, etaEl);
  panel.appendChild(stats);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.setAttribute('data-cancel', '');
  cancel.className = 'pyr3-render-progress-modal-cancel';
  cancel.textContent = '✕ Cancel';
  cancel.addEventListener('click', () => {
    opts.onCancel();
  });
  panel.appendChild(cancel);

  opts.host.appendChild(root);

  let closed = false;

  return {
    setProgress(input: number | RenderProgressInfo): void {
      if (closed) return;
      const info: RenderProgressInfo = typeof input === 'number'
        ? { percent: input }
        : input;
      const f = clamp01(info.percent);
      const pctValue = Math.round(f * 100);
      pct.textContent = `${pctValue} %`;
      fill.style.width = `${pctValue}%`;
      // #195 — samples readout. Empty when the caller doesn't supply samples.
      if (typeof info.samples === 'number') {
        const target = opts.targetSamples;
        samplesEl.textContent = typeof target === 'number' && target > 0
          ? `${formatSamples(info.samples)} / ${formatSamples(target)} samples`
          : `${formatSamples(info.samples)} samples`;
      } else {
        samplesEl.textContent = '';
      }
      // #195 — ETA readout. Empty until orchestrator has at least one chunk
      // timing to extrapolate from (it ships `etaSeconds=0` mid-flight before
      // the first chunk completes; formatEta returns '<1s' there, which is
      // useful enough — caller doesn't need to gate the field).
      if (typeof info.etaSeconds === 'number') {
        const eta = formatEta(info.etaSeconds);
        etaEl.textContent = eta !== '' ? `~${eta} remaining` : '';
      } else {
        etaEl.textContent = '';
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (root.parentNode) {
        root.parentNode.removeChild(root);
      }
    },
  };
}
