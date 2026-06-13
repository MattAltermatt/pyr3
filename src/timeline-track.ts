// #227c — NLE timeline track: pure px↔time geometry + a GPU-free DOM lane.
// The render/interp engine lives in src/timeline.ts; this file only paints a
// duration-proportional clip strip and translates pointer x ↔ global time.
// DOM is built with createElement (no innerHTML, per the repo invariant).

import { type Timeline, timelineDuration } from './timeline';

export interface ClipBox {
  index: number;
  /** Px from the track's left edge. */
  xStart: number;
  xEnd: number;
  /** Px where the hold ends and the cross-fade wedge begins. Equals xEnd when
   *  the clip has no transition (incl. the last clip). */
  holdEndX: number;
  durationSec: number;
  transitionSec: number;
}

/** Lay clips out as duration-proportional boxes across a track of `trackW` px.
 *  A zero-total timeline (all clips duration 0 — e.g. a single static clip)
 *  falls back to equal-width boxes so the strip is still visible. */
export function clipLayout(tl: Timeline, trackW: number): ClipBox[] {
  const clips = tl.clips;
  const total = timelineDuration(tl);
  const n = clips.length;
  const boxes: ClipBox[] = [];
  if (total <= 0) {
    const w = n > 0 ? trackW / n : 0;
    for (let i = 0; i < n; i++) {
      const xStart = i * w;
      const xEnd = (i + 1) * w;
      boxes.push({
        index: i, xStart, xEnd, holdEndX: xEnd,
        durationSec: Math.max(0, clips[i]!.duration),
        transitionSec: 0,
      });
    }
    return boxes;
  }
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const dur = Math.max(0, clips[i]!.duration);
    const xStart = (acc / total) * trackW;
    acc += dur;
    const xEnd = (acc / total) * trackW;
    const isLast = i === n - 1;
    const trans = isLast ? 0 : Math.max(0, Math.min(clips[i]!.transitionDuration, dur));
    const holdFrac = dur > 0 ? (dur - trans) / dur : 1;
    const holdEndX = xStart + holdFrac * (xEnd - xStart);
    boxes.push({ index: i, xStart, xEnd, holdEndX, durationSec: dur, transitionSec: trans });
  }
  return boxes;
}

/** Pointer x (px, track-local) → global time, clamped to [0, timelineDuration]. */
export function trackXToTime(tl: Timeline, x: number, trackW: number): number {
  const total = timelineDuration(tl);
  if (total <= 0 || trackW <= 0) return 0;
  const frac = Math.max(0, Math.min(1, x / trackW));
  return frac * total;
}

/** Global time → playhead x (px, track-local), clamped to [0, trackW]. */
export function timeToTrackX(tl: Timeline, t: number, trackW: number): number {
  const total = timelineDuration(tl);
  if (total <= 0) return 0;
  const frac = Math.max(0, Math.min(1, t / total));
  return frac * trackW;
}

export interface TimelineTrackOpts {
  timeline: Timeline;
  /** Fired when the user drags the playhead. Hands back a global time. */
  onSeek: (t: number) => void;
}

export interface TimelineTrackHandle {
  /** Move the playhead to a global time (e.g. driven by auto-play). */
  setPlayhead(t: number): void;
  /** Drop a rendered thumbnail canvas into clip `index`'s block. */
  setThumbnail(index: number, thumb: HTMLCanvasElement): void;
  destroy(): void;
}

const TRACK_HEIGHT = 72;

export function mountTimelineTrack(
  host: HTMLElement,
  opts: TimelineTrackOpts,
): TimelineTrackHandle {
  const { timeline, onSeek } = opts;

  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'relative',
    height: `${TRACK_HEIGHT}px`,
    margin: '0 16px 8px',
    background: '#111',
    border: '1px solid #2a2a2a',
    borderRadius: '4px',
    overflow: 'hidden',
    cursor: 'pointer',
    userSelect: 'none',
    touchAction: 'none',
  });
  host.appendChild(root);

  const blocks: HTMLDivElement[] = [];
  const wedges: HTMLDivElement[] = [];
  const thumbHosts: HTMLDivElement[] = [];
  for (let i = 0; i < timeline.clips.length; i++) {
    const block = document.createElement('div');
    Object.assign(block.style, {
      position: 'absolute', top: '0', bottom: '0',
      borderRight: '1px solid #000', background: '#1b1b22', overflow: 'hidden',
    });
    const thumbHost = document.createElement('div');
    Object.assign(thumbHost.style, {
      position: 'absolute', inset: '0', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
    });
    block.appendChild(thumbHost);
    const wedge = document.createElement('div');
    Object.assign(wedge.style, {
      position: 'absolute', top: '0', bottom: '0', pointerEvents: 'none',
      background:
        'repeating-linear-gradient(45deg, rgba(156,205,221,0.18) 0 4px, rgba(0,0,0,0) 4px 8px)',
      borderLeft: '1px solid rgba(156,205,221,0.4)',
    });
    block.appendChild(wedge);
    root.appendChild(block);
    blocks.push(block);
    wedges.push(wedge);
    thumbHosts.push(thumbHost);
  }

  const playhead = document.createElement('div');
  Object.assign(playhead.style, {
    position: 'absolute', top: '0', bottom: '0', width: '2px',
    background: '#ff8c1a', pointerEvents: 'none', left: '0',
    boxShadow: '0 0 4px rgba(255,140,26,0.8)',
  });
  root.appendChild(playhead);

  let trackW = 0;
  let lastT = 0;

  function relayout(): void {
    trackW = root.clientWidth;
    const boxes = clipLayout(timeline, trackW);
    for (const b of boxes) {
      const block = blocks[b.index]!;
      block.style.left = `${b.xStart}px`;
      block.style.width = `${b.xEnd - b.xStart}px`;
      const wedge = wedges[b.index]!;
      if (b.transitionSec > 0) {
        wedge.style.display = 'block';
        wedge.style.left = `${b.holdEndX - b.xStart}px`;
        wedge.style.width = `${b.xEnd - b.holdEndX}px`;
      } else {
        wedge.style.display = 'none';
      }
    }
    playhead.style.left = `${timeToTrackX(timeline, lastT, trackW)}px`;
  }

  const ro = new ResizeObserver(() => relayout());
  ro.observe(root);
  relayout();

  let dragging = false;
  function seekFromEvent(e: PointerEvent): void {
    const rect = root.getBoundingClientRect();
    const t = trackXToTime(timeline, e.clientX - rect.left, rect.width);
    lastT = t;
    playhead.style.left = `${timeToTrackX(timeline, t, rect.width)}px`;
    onSeek(t);
  }
  root.addEventListener('pointerdown', (e) => {
    dragging = true;
    root.setPointerCapture(e.pointerId);
    seekFromEvent(e);
  });
  root.addEventListener('pointermove', (e) => { if (dragging) seekFromEvent(e); });
  root.addEventListener('pointerup', (e) => {
    dragging = false;
    if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
  });

  return {
    setPlayhead(t: number): void {
      lastT = t;
      // Read the live width — the cached `trackW` is 0 until the first
      // relayout() and can go stale across layout changes, which would pin the
      // playhead at the left edge when driven by playback / bar-scrub.
      const w = root.clientWidth || trackW;
      playhead.style.left = `${timeToTrackX(timeline, t, w)}px`;
    },
    setThumbnail(index: number, thumb: HTMLCanvasElement): void {
      const thost = thumbHosts[index];
      if (!thost) return;
      Object.assign(thumb.style, { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' });
      thost.replaceChildren(thumb);
    },
    destroy(): void {
      ro.disconnect();
      root.remove();
    },
  };
}
