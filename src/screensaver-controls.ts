// Screensaver in-playback control bar (#355).
//
// ONE fade-in surface that folds together what used to be three: the keyboard
// hints strip, the "now playing" pill, and the I-key info overlay. Fades in on
// activity (host calls reveal() on mousemove/keydown), fades out after idleMs.
// Transport buttons differ per mode: slideshow has prev/next; animation has a
// restart + a progress bar. Real icon buttons, keyboard shortcut as tooltip.
import { COLORS } from './ui-tokens';

export type Transport = 'slideshow' | 'animation';

export interface ControlBarOpts {
  transport: Transport;
  onPlayPause: () => void;
  onFullscreen: () => void;
  onExit: () => void;
  // slideshow: prev/next FLAME · animation: step one FRAME back/forward
  onPrev?: () => void;
  onNext?: () => void;
  /** Idle ms before the bar auto-hides. Default 3000. */
  idleMs?: number;
}

export interface ControlBar {
  el: HTMLElement;
  /** Show the bar and (re)start the idle countdown. */
  reveal(): void;
  /** Swap the play/pause glyph. */
  setPaused(paused: boolean): void;
  /** Update the inline flame name + meta line. */
  setFlameName(name: string, meta: string): void;
  /** Animation only — 0..1 progress fill. */
  setProgress(frac: number): void;
  isVisible(): boolean;
  destroy(): void;
}

interface BtnSpec {
  act: string;
  glyph: string;
  tip: string;
  fn?: () => void;
  primary?: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

export function createControlBar(opts: ControlBarOpts): ControlBar {
  const idleMs = opts.idleMs ?? 3000;
  const bar = el('div', 'pyr3-screensaver-ctrlbar');
  Object.assign(bar.style, {
    position: 'absolute',
    left: '50%',
    bottom: '22px',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 10px',
    background: 'rgba(12,12,14,0.9)',
    border: `1px solid ${COLORS.border}`,
    borderRadius: '12px',
    boxShadow: '0 8px 30px rgba(0,0,0,0.66)',
    zIndex: '12',
    opacity: '0',
    transition: 'opacity 0.25s',
    pointerEvents: 'none',
  });

  // Flame name / context block (folds in the old info overlay).
  const nameWrap = el('div', 'pyr3-screensaver-ctrl-name');
  Object.assign(nameWrap.style, {
    display: 'flex', flexDirection: 'column',
    padding: '2px 12px 2px 6px',
    borderRight: `1px solid ${COLORS.border}`, marginRight: '6px',
  });
  const nameLine = el('span');
  Object.assign(nameLine.style, {
    fontSize: '13px', color: COLORS.text.primary, fontWeight: '600',
    maxWidth: '180px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  });
  const metaLine = el('span');
  Object.assign(metaLine.style, {
    fontSize: '10.5px', color: COLORS.text.dim,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  });
  nameWrap.append(nameLine, metaLine);
  bar.append(nameWrap);

  function makeBtn(spec: BtnSpec): HTMLButtonElement {
    const b = el('button', 'pyr3-screensaver-ctrl-btn');
    b.dataset.act = spec.act;
    b.textContent = spec.glyph;
    b.title = `${spec.tip}`;
    Object.assign(b.style, {
      width: '38px', height: '38px', borderRadius: '9px',
      border: '1px solid transparent',
      background: spec.primary ? COLORS.bg.action : 'transparent',
      color: spec.primary ? COLORS.flame.top : COLORS.text.primary,
      // All glyphs are TEXT symbols (no emoji) rendered at a single fixed size,
      // grid-centred, so every icon reads the same visual size.
      display: 'grid', placeItems: 'center',
      fontSize: '15px', lineHeight: '1', cursor: 'pointer',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    });
    if (spec.fn) b.addEventListener('click', spec.fn);
    return b;
  }

  const playBtn = makeBtn({ act: 'play', glyph: '⏸', tip: 'Pause / resume (Space)', fn: opts.onPlayPause, primary: true });

  // Both transports share the same prev/play/next layout. Slideshow's prev/next
  // skip to the previous/next FLAME; animation's step one FRAME back/forward.
  const stepBackTip = opts.transport === 'animation' ? 'Step back' : 'Previous (←)';
  const stepFwdTip = opts.transport === 'animation' ? 'Step forward' : 'Next (→)';
  bar.append(
    makeBtn({ act: 'prev', glyph: '|◀', tip: stepBackTip, fn: opts.onPrev }),
    playBtn,
    makeBtn({ act: 'next', glyph: '▶|', tip: stepFwdTip, fn: opts.onNext }),
  );
  bar.append(
    makeBtn({ act: 'fullscreen', glyph: '⛶', tip: 'Fullscreen (F)', fn: opts.onFullscreen }),
    makeBtn({ act: 'exit', glyph: '✕', tip: 'Exit (Esc)', fn: opts.onExit }),
  );

  // Animation progress bar.
  let progFill: HTMLElement | null = null;
  if (opts.transport === 'animation') {
    const wrap = el('div', 'pyr3-screensaver-ctrl-prog');
    Object.assign(wrap.style, {
      position: 'absolute', left: '0', right: '0', bottom: '0',
      height: '3px', background: 'rgba(255,255,255,0.08)',
      borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', overflow: 'hidden',
    });
    progFill = el('div');
    Object.assign(progFill.style, {
      height: '100%', width: '0%',
      background: `linear-gradient(90deg, ${COLORS.flame.bot}, ${COLORS.flame.mid}, ${COLORS.flame.top})`,
    });
    wrap.append(progFill);
    bar.append(wrap);
  }

  let visible = false;
  let hovering = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  function clearTimer(): void { if (timer !== null) { clearTimeout(timer); timer = null; } }
  function show(): void {
    visible = true;
    bar.style.opacity = '1';
    bar.style.pointerEvents = 'auto';
  }
  function scheduleHide(): void {
    clearTimer();
    // Never auto-hide while the pointer is over the bar — the user is reaching
    // for a control. mouseleave re-arms the countdown.
    if (hovering) return;
    timer = setTimeout(() => {
      visible = false;
      bar.style.opacity = '0';
      bar.style.pointerEvents = 'none';
      timer = null;
    }, idleMs);
  }
  bar.addEventListener('mouseenter', () => { hovering = true; clearTimer(); show(); });
  bar.addEventListener('mouseleave', () => { hovering = false; scheduleHide(); });

  return {
    el: bar,
    reveal() {
      show();
      scheduleHide();
    },
    setPaused(paused) {
      playBtn.textContent = paused ? '▶' : '⏸';
      playBtn.title = paused ? 'Resume (Space)' : 'Pause (Space)';
    },
    setFlameName(name, meta) {
      nameLine.textContent = name;
      metaLine.textContent = meta;
      // Hide the whole name block (incl. its right divider) when there's
      // nothing to show — keeps the bar tight for a nameless timeline.
      nameWrap.style.display = name || meta ? 'flex' : 'none';
    },
    setProgress(frac) {
      if (progFill) progFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    },
    isVisible() { return visible; },
    destroy() { clearTimer(); bar.remove(); },
  };
}
