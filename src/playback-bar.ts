// Playback scrubber widget for the /v1/animate surface (P6 of Animation
// milestone #17 / #211). Pure DOM, framework-free, mounted under a canvas.
// Caller owns the rAF playback loop and pushes time updates via setTime();
// onScrub fires while the user drags; onPlayToggle when the user hits play.

export interface PlaybackBarOpts {
  /** Range of the time scrubber (typically the animation's keyframe time span). */
  tMin: number;
  tMax: number;
  /** Initial scrubber position. */
  initialT: number;
  /** Fires as the user drags the scrubber. */
  onScrub: (t: number) => void;
  /** Fires when the user toggles play/pause. */
  onPlayToggle: (isPlaying: boolean) => void;
}

export interface PlaybackBarHandle {
  /** Current scrubber time. The caller's play-loop reads this on each tick
   *  to pick up where the user left the slider. */
  getTime(): number;
  /** Update the scrubber position + time readout. Called by the playback
   *  rAF loop (caller-owned) to keep the UI in sync. */
  setTime(t: number): void;
  /** Whether playback is currently active. */
  isPlaying(): boolean;
  setPlaying(p: boolean): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

export function mountPlaybackBar(host: HTMLElement, opts: PlaybackBarOpts): PlaybackBarHandle {
  const root = document.createElement('div');
  root.className = 'pyr3-playback-bar';
  root.style.display = 'flex';
  root.style.alignItems = 'center';
  root.style.gap = '12px';
  root.style.padding = '8px 16px';
  root.style.background = 'rgba(0,0,0,0.55)';
  root.style.color = '#eee';
  root.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  root.style.fontSize = '12px';
  root.style.borderTop = '1px solid #2a2a2a';

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'pyr3-playback-bar-play';
  playBtn.textContent = '▶';
  playBtn.style.background = 'transparent';
  playBtn.style.border = '1px solid #444';
  playBtn.style.color = '#eee';
  playBtn.style.cursor = 'pointer';
  playBtn.style.padding = '4px 10px';
  playBtn.style.borderRadius = '3px';
  playBtn.style.fontSize = '12px';
  playBtn.title = 'Play / pause';
  root.appendChild(playBtn);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'pyr3-playback-bar-scrub';
  slider.min = String(opts.tMin);
  slider.max = String(opts.tMax);
  slider.step = String(Math.max(0.001, (opts.tMax - opts.tMin) / 500));
  slider.value = String(opts.initialT);
  slider.style.flex = '1';
  root.appendChild(slider);

  const timeReadout = document.createElement('span');
  timeReadout.className = 'pyr3-playback-bar-time';
  timeReadout.style.minWidth = '120px';
  timeReadout.style.textAlign = 'right';
  timeReadout.style.color = '#9cd';
  timeReadout.textContent = formatReadout(opts.initialT, opts.tMax);
  root.appendChild(timeReadout);

  host.appendChild(root);

  let playing = false;

  function updateButton(): void {
    playBtn.textContent = playing ? '⏸' : '▶';
  }

  slider.addEventListener('input', () => {
    const t = Number(slider.value);
    timeReadout.textContent = formatReadout(t, opts.tMax);
    opts.onScrub(t);
  });

  playBtn.addEventListener('click', () => {
    playing = !playing;
    updateButton();
    opts.onPlayToggle(playing);
  });

  return {
    getTime(): number {
      return Number(slider.value);
    },
    setTime(t: number): void {
      slider.value = String(t);
      timeReadout.textContent = formatReadout(t, opts.tMax);
    },
    isPlaying(): boolean {
      return playing;
    },
    setPlaying(p: boolean): void {
      if (playing === p) return;
      playing = p;
      updateButton();
    },
    show(): void {
      root.style.display = 'flex';
    },
    hide(): void {
      root.style.display = 'none';
    },
    destroy(): void {
      root.remove();
    },
  };
}

function formatReadout(t: number, max: number): string {
  const digits = max >= 100 ? 0 : max >= 10 ? 1 : 2;
  return `t = ${t.toFixed(digits)} / ${max.toFixed(digits)}`;
}
