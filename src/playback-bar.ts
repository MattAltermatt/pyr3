// Playback transport for the /v1/animate surface (P6 of Animation milestone
// #17 / #211; reworked #276). Pure DOM, framework-free, mounted under a canvas.
// Caller owns the rAF playback loop and pushes time updates via setTime();
// onScrub fires while the user drags the ruler; onPlayToggle on play/pause;
// onStep / onJump / onSpeedChange from the transport controls.
//
// #276 — the bare range slider is replaced by a linear time ruler (shared
// tick/scrub code from timeline-scale.ts), so the transport reads like the
// section "timing bar": tick markings, click-to-seek, a draggable playhead.

import { linearScale, fitPxPerSec, tickLayout, renderTicks, attachScrub, type Scale } from './timeline-scale';

export interface PlaybackBarOpts {
  /** Range of the time scrubber (typically the animation's keyframe time span). */
  tMin: number;
  tMax: number;
  /** Initial scrubber position. */
  initialT: number;
  /** Fires as the user drags / clicks the ruler. */
  onScrub: (t: number) => void;
  /** Fires when the user toggles play/pause. */
  onPlayToggle: (isPlaying: boolean) => void;
  /** #276 — step one frame back (-1) / forward (+1). */
  onStep?: (dir: -1 | 1) => void;
  /** #276 — jump to start / end. */
  onJump?: (where: 'start' | 'end') => void;
  /** #276 — playback speed multiplier changed (0.5 / 1 / 2 / 4). */
  onSpeedChange?: (mult: number) => void;
}

export interface PlaybackBarHandle {
  /** Current scrubber time. The caller's play-loop reads this on each tick. */
  getTime(): number;
  /** Update the scrubber position + time readout. Called by the playback loop. */
  setTime(t: number): void;
  /** #276 — change the time range (evolve/pause edits resize the timeline). */
  setDuration(tMax: number): void;
  /** Whether playback is currently active. */
  isPlaying(): boolean;
  setPlaying(p: boolean): void;
  /** Enable/disable all transport controls (no-jump empty state). */
  setEnabled(on: boolean): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

export function mountPlaybackBar(host: HTMLElement, opts: PlaybackBarOpts): PlaybackBarHandle {
  const root = document.createElement('div');
  root.className = 'pyr3-playback-bar';
  // #408 — transparent so the cohesive bottom dock (controls wrapper) provides
  // the ground; sans font matches the action bar; the only internal divider is
  // the token-coloured top rule.
  Object.assign(root.style, {
    display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px 16px',
    background: 'transparent', color: 'var(--text, #ddd)',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif', fontSize: '12px',
    borderTop: '1px solid var(--bar-border, #2a2a30)',
  });

  // --- control row ---------------------------------------------------------
  const ctlRow = document.createElement('div');
  Object.assign(ctlRow.style, { display: 'flex', alignItems: 'center', gap: '8px' });

  const ctlBtn = (cls: string, txt: string, title: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = txt; b.title = title;
    // #408 — match the action bar's .pyr3-animate-bar-btn treatment.
    Object.assign(b.style, {
      background: 'var(--bar-bg-3, #0f0f13)', border: '1px solid var(--bar-border, #2a2a30)',
      color: 'var(--text, #ddd)', cursor: 'pointer', padding: '4px 8px',
      borderRadius: '5px', fontSize: '12px',
    });
    b.addEventListener('mouseenter', () => { if (!b.disabled) b.style.background = 'var(--accent-soft, rgba(255,140,26,0.18))'; });
    b.addEventListener('mouseleave', () => { b.style.background = 'var(--bar-bg-3, #0f0f13)'; });
    b.addEventListener('click', fn);
    return b;
  };

  const jumpStart = ctlBtn('pyr3-pb-jump-start', '◀◀', 'Jump to start', () => opts.onJump?.('start'));
  const stepBack = ctlBtn('pyr3-pb-step-back', '◀▮', 'Step back one frame', () => opts.onStep?.(-1));
  const playBtn = ctlBtn('pyr3-playback-bar-play', '▶', 'Play / pause', () => {
    playing = !playing;
    updateButton();
    opts.onPlayToggle(playing);
  });
  const stepFwd = ctlBtn('pyr3-pb-step-fwd', '▮▶', 'Step forward one frame', () => opts.onStep?.(1));
  const jumpEnd = ctlBtn('pyr3-pb-jump-end', '▶▶', 'Jump to end', () => opts.onJump?.('end'));

  const speed = document.createElement('select');
  speed.className = 'pyr3-pb-speed';
  for (const m of [0.5, 1, 2, 4]) {
    const o = document.createElement('option');
    o.value = String(m); o.textContent = `${m}×`;
    if (m === 1) o.selected = true;
    speed.appendChild(o);
  }
  Object.assign(speed.style, {
    background: 'var(--bar-bg-3, #0f0f13)', color: 'var(--text, #ddd)',
    border: '1px solid var(--bar-border, #2a2a30)',
    borderRadius: '5px', fontSize: '12px', padding: '2px 4px',
  });
  speed.title = 'Playback speed (1× = real authored duration)';
  speed.addEventListener('change', () => opts.onSpeedChange?.(Number(speed.value)));

  const timeReadout = document.createElement('span');
  timeReadout.className = 'pyr3-playback-bar-time';
  // #408 — keep monospace for the numeric readout (tabular numerals — stops the
  // time jittering as digits change); only the teal colour is re-tokened.
  Object.assign(timeReadout.style, {
    minWidth: '120px', marginLeft: 'auto', textAlign: 'right',
    color: 'var(--text-dim, #888)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  });

  ctlRow.append(jumpStart, stepBack, playBtn, stepFwd, jumpEnd, speed, timeReadout);

  // --- ruler row -----------------------------------------------------------
  const rulerRow = document.createElement('div');
  Object.assign(rulerRow.style, { position: 'relative', height: '26px', marginTop: '2px' });

  const playhead = document.createElement('div');
  Object.assign(playhead.style, {
    position: 'absolute', top: '0', bottom: '0', width: '3px',
    background: '#ff8c1a', boxShadow: '0 0 5px rgba(255,140,26,.9)', left: '0',
    cursor: 'ew-resize', zIndex: '4',
  });

  root.append(ctlRow, rulerRow);
  host.appendChild(root);

  // --- state ---------------------------------------------------------------
  let playing = false;
  let tMin = opts.tMin;
  let tMax = opts.tMax;
  let curT = opts.initialT;
  let scale: Scale = makeScale();

  function viewportPx(): number { return rulerRow.clientWidth || 600; }
  /** Linear scale over [tMin, tMax] (offset so animation-mode tMin≠0 works). */
  function makeScale(): Scale {
    const span = Math.max(tMax - tMin, 1e-6);
    const pps = fitPxPerSec(span, viewportPx());
    const base = linearScale(span, pps);
    return {
      contentWidth: base.contentWidth,
      timeToX: (t) => base.timeToX(t - tMin),
      xToTime: (x) => tMin + base.xToTime(x),
    };
  }
  function relayout(): void {
    scale = makeScale();
    const span = Math.max(tMax - tMin, 1e-6);
    renderTicks(rulerRow, tickLayout(span, fitPxPerSec(span, viewportPx()), viewportPx()));
    rulerRow.appendChild(playhead); // renderTicks cleared the row — re-add the cached node
    playhead.style.left = `${scale.timeToX(curT)}px`;
  }

  function updateButton(): void {
    playBtn.textContent = playing ? '⏸' : '▶';
    // #408 — the playing state takes the accent so the transport has hierarchy.
    playBtn.style.borderColor = playing ? 'var(--accent, #ff8c1a)' : 'var(--bar-border, #2a2a30)';
    playBtn.style.color = playing ? 'var(--accent, #ff8c1a)' : 'var(--text, #ddd)';
  }

  const detachScrub = attachScrub({
    strip: rulerRow, playhead, getScale: () => scale,
    onSeek: (t) => {
      curT = t;
      playhead.style.left = `${scale.timeToX(t)}px`;
      timeReadout.textContent = formatReadout(t, tMax);
      opts.onScrub(t);
    },
  });

  timeReadout.textContent = formatReadout(curT, tMax);
  relayout();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => relayout()) : null;
  ro?.observe(rulerRow);

  return {
    getTime(): number { return curT; },
    setTime(t: number): void {
      curT = t;
      playhead.style.left = `${scale.timeToX(t)}px`;
      timeReadout.textContent = formatReadout(t, tMax);
    },
    setDuration(next: number): void {
      tMax = Math.max(next, tMin + 1e-6);
      relayout();
      timeReadout.textContent = formatReadout(curT, tMax);
    },
    isPlaying(): boolean { return playing; },
    setPlaying(p: boolean): void {
      if (playing === p) return;
      playing = p;
      updateButton();
    },
    setEnabled(on: boolean): void {
      for (const b of [jumpStart, stepBack, playBtn, stepFwd, jumpEnd]) b.disabled = !on;
      speed.disabled = !on;
      root.style.opacity = on ? '1' : '0.45';
    },
    show(): void { root.style.display = 'flex'; },
    hide(): void { root.style.display = 'none'; },
    destroy(): void { detachScrub(); ro?.disconnect(); root.remove(); },
  };
}

function formatReadout(t: number, max: number): string {
  const digits = max >= 100 ? 0 : max >= 10 ? 1 : 2;
  return `t = ${t.toFixed(digits)} / ${max.toFixed(digits)}`;
}
