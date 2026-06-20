// #118 — soft UX nudge for slow renders at high quality. When the user
// is actively editing AND the settled-render duration crosses a threshold
// AND the PREVIEW quality is above a sensible interactive value, surface
// a dismissible toast suggesting they drop the preview quality for snappier
// iteration. One-click [Drop to q=N] action; [Dismiss] hides for a
// cooldown window. Auto-hides after AUTO_HIDE_MS so the toast doesn't
// linger forever.
//
// Trigger conditions (all must hold):
//   1. Last onPathChange was within EDIT_WINDOW_MS (user is editing, not
//      just panning around the canvas — pan/zoom does NOT recordEdit())
//   2. At least SLOW_RENDER_COUNT settle renders in the last
//      SLOW_RENDER_WINDOW_MS each exceeded SLOW_RENDER_MS
//   3. Current quality > QUALITY_THRESHOLD
//   4. Not currently in cooldown from a prior dismissal
//
// #369 — the nudge measures the live PREVIEW settle render (which iterates at
// previewCfg.quality, the 10..50 ladder), so getQuality/setQuality are wired to
// the PREVIEW quality, NOT the 50..500 render-side genome.quality (which only
// affects Save Render). The thresholds below are calibrated to that 10..50 scale:
// fire only when there's real headroom to drop (>30), and drop to the snappy end
// of the ladder (10).
const SLOW_RENDER_MS = 800;
const EDIT_WINDOW_MS = 5_000;
const SLOW_RENDER_WINDOW_MS = 3_000;
const SLOW_RENDER_COUNT = 2;
const QUALITY_THRESHOLD = 30;
const DROP_TO_QUALITY = 10;
const COOLDOWN_MS = 60_000;
const AUTO_HIDE_MS = 30_000;

import { COLORS } from './ui-tokens';

export interface SlowRenderNudgeOpts {
  /** Where the toast mounts. Should be a positioned parent (the editor
   *  canvas wrapper is the natural choice). */
  host: HTMLElement;
  /** Read the live PREVIEW quality (previewCfg.quality, the 10..50 ladder).
   *  Called each time recordRender fires to evaluate the trigger condition. */
  getQuality: () => number;
  /** Apply a PREVIEW-quality change on the [Drop to q=N] action. The host
   *  re-iterates the preview at the new density and refreshes the bar (#369). */
  setQuality: (q: number) => void;
  /** Optional clock override for tests. Defaults to performance.now. */
  now?: () => number;
}

export interface SlowRenderNudgeHandle {
  /** Mark the user as actively editing. Call from onPathChange ONLY
   *  (NOT from pan/zoom or programmatic mutators). */
  recordEdit(): void;
  /** Record a settle-render's wall-clock duration in ms. Called after
   *  the GPU work for that render is observed complete (queue
   *  onSubmittedWorkDone resolved). */
  recordRender(durationMs: number): void;
  /** Tear down the toast + listeners. Call from rebuildPanel / destroy. */
  destroy(): void;
}

interface NudgeState {
  lastEditAt: number;
  slowRenders: number[]; // timestamps of recent slow renders (ms-since-epoch via now())
  cooldownUntil: number;
  visible: boolean;
  autoHideTimer: ReturnType<typeof setTimeout> | null;
}

export function createSlowRenderNudge(opts: SlowRenderNudgeOpts): SlowRenderNudgeHandle {
  const now = opts.now ?? (() => performance.now());

  const state: NudgeState = {
    lastEditAt: -Infinity,
    slowRenders: [],
    cooldownUntil: -Infinity,
    visible: false,
    autoHideTimer: null,
  };

  // ── Toast DOM ────────────────────────────────────────────────────
  const toast = document.createElement('div');
  toast.className = 'pyr3-slow-render-nudge';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  Object.assign(toast.style, {
    position: 'absolute',
    top: '12px',
    right: '12px',
    zIndex: '8000',
    padding: '12px 14px',
    maxWidth: '320px',
    background: COLORS.bg.panel,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '6px',
    color: COLORS.text.primary,
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    fontSize: '13px',
    lineHeight: '1.45',
    boxShadow: '0 6px 22px rgba(0,0,0,0.6)',
    display: 'none',
  } as Partial<CSSStyleDeclaration>);

  const headline = document.createElement('div');
  headline.style.fontWeight = '600';
  headline.style.marginBottom = '4px';
  headline.style.color = COLORS.flame.top;
  headline.textContent = 'Render is slow';

  const body = document.createElement('div');
  body.style.color = COLORS.text.muted;
  body.style.marginBottom = '10px';
  // Body text rewritten per-show so it can name the current quality.
  body.textContent = '';

  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.gap = '8px';

  function styleBtn(b: HTMLButtonElement, primary: boolean): void {
    Object.assign(b.style, {
      flex: '0 0 auto',
      padding: '5px 10px',
      fontSize: '12px',
      fontFamily: 'ui-monospace, monospace',
      borderRadius: '3px',
      cursor: 'pointer',
      background: primary ? COLORS.flame.top : 'transparent',
      color: primary ? COLORS.bg.page : COLORS.text.primary,
      border: `1px solid ${primary ? COLORS.flame.top : COLORS.border}`,
    } as Partial<CSSStyleDeclaration>);
  }

  const dropBtn = document.createElement('button');
  dropBtn.type = 'button';
  dropBtn.textContent = `Drop to q=${DROP_TO_QUALITY}`;
  styleBtn(dropBtn, true);
  dropBtn.addEventListener('click', () => {
    opts.setQuality(DROP_TO_QUALITY);
    hideToast(/* enterCooldown */ true);
  });

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.textContent = 'Dismiss';
  styleBtn(dismissBtn, false);
  dismissBtn.addEventListener('click', () => hideToast(/* enterCooldown */ true));

  btnRow.append(dropBtn, dismissBtn);
  toast.append(headline, body, btnRow);
  opts.host.appendChild(toast);

  // ── Show / hide ───────────────────────────────────────────────────
  function showToast(): void {
    if (state.visible) return;
    state.visible = true;
    const q = opts.getQuality();
    body.textContent =
      `Preview is iterating slowly at quality ${q}. Drop to ${DROP_TO_QUALITY} for ` +
      `snappier editing — your Save-Render quality is unaffected.`;
    toast.style.display = 'block';
    if (state.autoHideTimer !== null) clearTimeout(state.autoHideTimer);
    state.autoHideTimer = setTimeout(() => {
      // Auto-hide without cooldown — user wasn't paying attention; if
      // the condition recurs we want to re-surface.
      hideToast(/* enterCooldown */ false);
    }, AUTO_HIDE_MS);
  }

  function hideToast(enterCooldown: boolean): void {
    state.visible = false;
    toast.style.display = 'none';
    if (state.autoHideTimer !== null) {
      clearTimeout(state.autoHideTimer);
      state.autoHideTimer = null;
    }
    if (enterCooldown) {
      state.cooldownUntil = now() + COOLDOWN_MS;
    }
  }

  // ── Trigger evaluation ───────────────────────────────────────────
  function shouldShow(): boolean {
    if (state.visible) return false;
    const t = now();
    if (t < state.cooldownUntil) return false;
    if (t - state.lastEditAt > EDIT_WINDOW_MS) return false;
    if (opts.getQuality() <= QUALITY_THRESHOLD) return false;
    // Count slow renders in the recent window.
    const cutoff = t - SLOW_RENDER_WINDOW_MS;
    let count = 0;
    for (let i = state.slowRenders.length - 1; i >= 0; i--) {
      const ts = state.slowRenders[i]!;
      if (ts < cutoff) break;
      count++;
    }
    return count >= SLOW_RENDER_COUNT;
  }

  // ── Public API ───────────────────────────────────────────────────
  function recordEdit(): void {
    state.lastEditAt = now();
  }

  function recordRender(durationMs: number): void {
    if (durationMs < SLOW_RENDER_MS) return;
    const t = now();
    state.slowRenders.push(t);
    // Trim old entries so the array doesn't grow unbounded.
    const cutoff = t - SLOW_RENDER_WINDOW_MS;
    while (state.slowRenders.length > 0 && state.slowRenders[0]! < cutoff) {
      state.slowRenders.shift();
    }
    if (shouldShow()) showToast();
  }

  function destroy(): void {
    if (state.autoHideTimer !== null) clearTimeout(state.autoHideTimer);
    state.autoHideTimer = null;
    toast.remove();
  }

  return { recordEdit, recordRender, destroy };
}

// Exported for tests that want to assert thresholds without re-importing
// internal constants by hand.
export const SLOW_RENDER_NUDGE_THRESHOLDS = {
  SLOW_RENDER_MS,
  EDIT_WINDOW_MS,
  SLOW_RENDER_WINDOW_MS,
  SLOW_RENDER_COUNT,
  QUALITY_THRESHOLD,
  DROP_TO_QUALITY,
  COOLDOWN_MS,
  AUTO_HIDE_MS,
} as const;
