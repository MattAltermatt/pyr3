// Render progress modal — used by Save Render (#176).
//
// Mounts a fixed-position modal into the host element synchronously, so the
// caller can `await requestAnimationFrame(...)` once to guarantee first paint
// lands before GPU dispatch saturates the device. The host ticks
// `setProgress(fraction)` between dispatch batches and calls `close()` when
// the render completes or aborts. The Cancel button surfaces an abort path
// back to the host via `onCancel()`.
//
// CSS lives in Task 8's verify-cycle work — this module ships DOM structure
// + data attributes only, which is what the tests assert against.

export interface RenderProgressModalOpts {
  host: HTMLElement;
  sizeLabel: string;
  qualityLabel: string;
  onCancel(): void;
}

export interface RenderProgressModalHandle {
  setProgress(fraction: number): void;
  close(): void;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
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
    setProgress(fraction: number): void {
      if (closed) return;
      const f = clamp01(fraction);
      const pctValue = Math.round(f * 100);
      pct.textContent = `${pctValue} %`;
      fill.style.width = `${pctValue}%`;
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
