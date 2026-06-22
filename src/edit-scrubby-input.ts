// pyr3 — /editor scrubby-slider numeric input.
//
// Replaces input[type=number] cells with a click-drag-horizontally-to-scrub
// control (Blender / Photoshop / Figma pattern). Double-click swaps to
// native text-input mode for typing exact values.
//
// Sensitivity is percent-of-value with a per-`kind` minimum step floor:
//   delta_per_pixel = sign(dx) × max(MIN_STEP[kind], |value| × RATE)
//
// Pointer lock is best-effort. When granted (Chrome on user gesture) the
// drag scrubs indefinitely past the viewport edge via `event.movementX`.
// When denied (Safari, embedded contexts, happy-dom) the drag falls back
// to `clientX` deltas — same code path, only "infinite scrub" is lost.
//
// Spec: docs/superpowers/specs/2026-06-03-issue-105-scrubby-input-design.md

export type FieldKind =
  | 'weight'
  | 'color'
  | 'position'
  | 'rotation'
  | 'scale'
  | 'generic';

export const RATE = 0.005;

export const MIN_STEP: Record<FieldKind, number> = {
  weight: 0.0025,
  color: 0.005,
  position: 0.001,
  rotation: 0.05,
  scale: 0.005,
  generic: 0.001,
};

export interface ScrubbyInputOpts {
  value: number;
  onInput: (v: number) => void;
  kind?: FieldKind;
  minStep?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
  ariaLabel?: string;
  /** Optional extra class names appended after `pyr3-edit-num pyr3-scrubby`. */
  className?: string;
}

export interface ScrubbyHandle {
  el: HTMLSpanElement;
  setValue(v: number): void;
  destroy(): void;
}

function defaultFormat(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  // #396 — magnitude-aware precision. A flat toFixed(6) renders meaningless
  // width for large values (e.g. a viewport scale of 2268.0645231), which
  // overflows the panel field and shoves the trailing help icon off-screen.
  // Fewer decimals as magnitude grows keeps the displayed string short and
  // readable while staying well finer than the scrubby per-pixel step (which is
  // percent-of-value, so it coarsens with magnitude too). Display-only — text
  // mode still types the full-precision value.
  const abs = Math.abs(v);
  const decimals = abs >= 1000 ? 2 : abs >= 100 ? 3 : abs >= 1 ? 4 : 6;
  const s = v.toFixed(decimals);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

function clamp(v: number, min: number | undefined, max: number | undefined): number {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}

export function scrubbyInput(opts: ScrubbyInputOpts): ScrubbyHandle {
  const fmt = opts.format ?? defaultFormat;
  const floor = opts.minStep ?? MIN_STEP[opts.kind ?? 'generic'];

  let value = clamp(opts.value, opts.min, opts.max);
  let dragging = false;
  let startX = 0;
  let lastX = 0;
  let activePointerId: number | null = null;
  let textInput: HTMLInputElement | null = null;
  let preEditValue = value;

  const el = document.createElement('span');
  el.className = `pyr3-edit-num pyr3-scrubby${opts.className ? ' ' + opts.className : ''}`;
  el.setAttribute('role', 'spinbutton');
  el.setAttribute('tabindex', '0');
  if (opts.ariaLabel) el.setAttribute('aria-label', opts.ariaLabel);
  el.setAttribute('aria-valuenow', String(value));
  // Discoverability — surface both interaction affordances so users find
  // the keyboard-input path. Caller can still overwrite el.title to give
  // a more field-specific hint after construction.
  el.title = 'drag horizontally to scrub · double-click to type a value';
  el.textContent = fmt(value);

  function emit(): void {
    el.setAttribute('aria-valuenow', String(value));
    el.textContent = fmt(value);
    opts.onInput(value);
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (textInput) return; // ignore drag while in text mode
    dragging = true;
    startX = e.clientX;
    lastX = startX;
    activePointerId = e.pointerId;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // happy-dom may not implement pointer capture; non-fatal
    }
    try {
      // Fire-and-forget; we never await. The pointermove handler reads
      // document.pointerLockElement to decide which delta source to use.
      void (el as unknown as { requestPointerLock?: () => Promise<void> | void })
        .requestPointerLock?.();
    } catch {
      // ignored — graceful fallback to clientX-delta mode
    }
    el.classList.add('pyr3-scrubby-dragging');
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const locked = document.pointerLockElement === el;
    const dxPx = locked ? e.movementX : (e.clientX - lastX);
    lastX = e.clientX;
    if (dxPx === 0) return;
    // Modifiers: shift = coarse (×10), alt/option = fine (×0.1).
    // Ctrl is NOT used — on macOS ctrl-click triggers the native context
    // menu before pointerdown completes, so it can't drive a drag reliably.
    // Cmd (metaKey) is left free for browser shortcuts.
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const perPx = Math.max(floor, Math.abs(value) * RATE) * mult;
    value = clamp(value + dxPx * perPx, opts.min, opts.max);
    emit();
  }

  function endDrag(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    if (activePointerId !== null) {
      try {
        el.releasePointerCapture(activePointerId);
      } catch {
        // ignored
      }
      activePointerId = null;
    }
    if (document.pointerLockElement === el) {
      try {
        document.exitPointerLock();
      } catch {
        // ignored
      }
    }
    el.classList.remove('pyr3-scrubby-dragging');
    // Suppress the synthetic click that follows pointerup so a drag never
    // accidentally triggers parent click handlers (variation pickers, etc.).
    void e;
  }

  function enterTextMode(): void {
    if (textInput) return;
    preEditValue = value;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'pyr3-edit-num pyr3-scrubby-textmode';
    inp.value = String(value);
    if (opts.min !== undefined) inp.min = String(opts.min);
    if (opts.max !== undefined) inp.max = String(opts.max);
    // Match floor as a sensible default step in text mode.
    inp.step = String(floor);
    inp.style.width = Math.max(40, el.offsetWidth || 60) + 'px';

    function commit(): void {
      const parsed = Number(inp.value);
      if (Number.isFinite(parsed)) {
        value = clamp(parsed, opts.min, opts.max);
        emit();
      } else {
        value = preEditValue;
      }
      exitTextMode();
    }
    function cancel(): void {
      value = preEditValue;
      el.setAttribute('aria-valuenow', String(value));
      el.textContent = fmt(value);
      exitTextMode();
    }

    inp.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        commit();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        cancel();
      }
    });
    inp.addEventListener('blur', commit);

    textInput = inp;
    el.textContent = '';
    el.appendChild(inp);
    inp.focus();
    inp.select();
  }

  function exitTextMode(): void {
    if (!textInput) return;
    const inp = textInput;
    textInput = null;
    inp.remove();
    el.textContent = fmt(value);
  }

  function onDblClick(e: MouseEvent): void {
    if (dragging) return;
    e.preventDefault();
    enterTextMode();
  }

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('lostpointercapture', endDrag);
  el.addEventListener('dblclick', onDblClick);

  return {
    el,
    setValue(v: number): void {
      value = clamp(v, opts.min, opts.max);
      if (textInput) textInput.value = String(value);
      el.setAttribute('aria-valuenow', String(value));
      el.textContent = textInput ? '' : fmt(value);
      if (textInput) el.appendChild(textInput);
    },
    destroy(): void {
      exitTextMode();
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endDrag);
      el.removeEventListener('pointercancel', endDrag);
      el.removeEventListener('lostpointercapture', endDrag);
      el.removeEventListener('dblclick', onDblClick);
      el.remove();
    },
  };
}
