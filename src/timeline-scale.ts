// #276 — shared time↔x scale + tick layout for the /animate timeline bars.
// Two scales feed the same ruler/scrub code: a LINEAR scale (bottom transport)
// and a piecewise SEGMENT scale (the node/edge section track). Pure geometry
// here; the DOM scrub helper + tick renderer live below (still framework-free).

export interface Scale {
  timeToX(t: number): number;
  xToTime(x: number): number;
  contentWidth: number;
}

export interface TickMark { t: number; x: number; label: string }
export interface TickSet { major: TickMark[]; minor: TickMark[] }

/** Linear px/sec scale over [0, durationSec]. */
export function linearScale(durationSec: number, pxPerSec: number): Scale {
  const dur = Math.max(0, durationSec);
  const pps = pxPerSec > 0 ? pxPerSec : 1;
  return {
    timeToX: (t) => t * pps,
    xToTime: (x) => Math.min(dur, Math.max(0, x / pps)),
    contentWidth: dur * pps,
  };
}

/** px/sec that fits the whole duration into `viewportPx`. */
export function fitPxPerSec(durationSec: number, viewportPx: number): number {
  if (durationSec <= 0 || viewportPx <= 0) return 1;
  return viewportPx / durationSec;
}

/** Minimal segment shape (mirrors timeline-sections LayoutSeg; kept local to
 *  avoid a circular import). */
export interface ScaleSeg { x: number; w: number; tStart: number; tEnd: number }

/** Piecewise time↔x for the node/edge section track. Generalises the old
 *  playheadX(): nodes compress time (often zero-width), edges span proportionally. */
export function segmentScale(segs: ScaleSeg[]): Scale {
  const contentWidth = segs.length ? Math.max(...segs.map((s) => s.x + s.w)) : 0;
  const tMin = segs.length ? segs[0]!.tStart : 0;
  const tMax = segs.length ? segs[segs.length - 1]!.tEnd : 0;
  return {
    contentWidth,
    timeToX(t) {
      if (!segs.length) return 0;
      if (t <= tMin) return segs[0]!.x;
      if (t >= tMax) return segs[segs.length - 1]!.x + segs[segs.length - 1]!.w;
      for (const s of segs) {
        if (t >= s.tStart && t <= s.tEnd) {
          const span = s.tEnd - s.tStart;
          return span <= 0 ? s.x : s.x + ((t - s.tStart) / span) * s.w;
        }
      }
      return segs[segs.length - 1]!.x + segs[segs.length - 1]!.w;
    },
    xToTime(x) {
      if (!segs.length) return 0;
      const cx = Math.min(contentWidth, Math.max(0, x));
      for (const s of segs) {
        if (cx >= s.x && cx <= s.x + s.w) {
          const span = s.tEnd - s.tStart;
          return s.w <= 0 ? s.tStart : s.tStart + ((cx - s.x) / s.w) * span;
        }
      }
      return tMax;
    },
  };
}

// Human-friendly tick intervals (seconds). Lowest that yields ≥ MIN_LABEL_GAP px.
const TICK_LADDER = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const MIN_LABEL_GAP = 48; // px between MAJOR labels
const MIN_MINOR_GAP = 6;  // px between minor ticks

function fmtTick(t: number): string {
  if (t >= 60) {
    const m = Math.floor(t / 60);
    const s = Math.round(t % 60);
    return s === 0 ? `${m}m` : `${m}m${String(s).padStart(2, '0')}s`;
  }
  return Number.isInteger(t) ? `${t}s` : `${t.toFixed(1)}s`;
}

/** Major (labelled) + minor ticks chosen so major labels never collide. */
export function tickLayout(durationSec: number, pxPerSec: number, _viewportPx: number): TickSet {
  const dur = Math.max(0, durationSec);
  const pps = pxPerSec > 0 ? pxPerSec : 1;
  if (dur <= 0) return { major: [{ t: 0, x: 0, label: '0s' }], minor: [] };

  const majorInterval =
    TICK_LADDER.find((iv) => iv * pps >= MIN_LABEL_GAP) ?? TICK_LADDER[TICK_LADDER.length - 1]!;
  const minorInterval =
    TICK_LADDER.find((iv) => iv * pps >= MIN_MINOR_GAP && iv <= majorInterval) ?? majorInterval;

  const major: TickMark[] = [];
  for (let t = 0; t <= dur + 1e-9; t += majorInterval) {
    major.push({ t, x: t * pps, label: fmtTick(t) });
  }
  const minor: TickMark[] = [];
  for (let t = 0; t <= dur + 1e-9; t += minorInterval) {
    if (Math.abs((t / majorInterval) - Math.round(t / majorInterval)) < 1e-6) continue; // skip majors
    minor.push({ t, x: t * pps, label: '' });
  }
  return { major, minor };
}

// ---------------------------------------------------------------------------
// DOM helpers (framework-free; no GPU — Chrome-verified, not vitest-dispatched)
// ---------------------------------------------------------------------------

/** Draw major+minor ticks (and major labels) into `strip`. Rebuilds children;
 *  call only on duration/zoom change, never per-seek. Labels ride the BOTTOM edge. */
export function renderTicks(strip: HTMLElement, ticks: TickSet): void {
  strip.replaceChildren();
  const mk = (x: number, h: string, color: string): HTMLDivElement => {
    const d = document.createElement('div');
    Object.assign(d.style, {
      position: 'absolute', bottom: '0', left: `${x}px`, width: '1px', height: h,
      background: color, pointerEvents: 'none',
    });
    return d;
  };
  for (const m of ticks.minor) strip.appendChild(mk(m.x, '5px', '#3a3a44'));
  for (const m of ticks.major) {
    strip.appendChild(mk(m.x, '9px', '#5a5a66'));
    const lbl = document.createElement('div');
    lbl.textContent = m.label;
    Object.assign(lbl.style, {
      position: 'absolute', bottom: '10px', left: `${m.x + 3}px`,
      fontSize: '9px', color: '#888', fontFamily: 'ui-monospace,monospace', pointerEvents: 'none',
    });
    strip.appendChild(lbl);
  }
}

export interface ScrubOpts {
  /** Strip element whose local x is the seek surface. */
  strip: HTMLElement;
  /** The (already-mounted) draggable playhead element. */
  playhead: HTMLElement;
  /** Current scale provider (re-read each pointer event so zoom changes apply). */
  getScale: () => Scale;
  /** Fires on click + during drag. `final` true on pointerup. */
  onSeek: (t: number, final: boolean) => void;
  /** Optional: render a "12.4s" bubble near the cursor while dragging. */
  bubble?: HTMLElement;
}

/** Wire click-to-seek + drag-to-scrub on a strip and its playhead handle.
 *  Returns a detach fn. Uses pointer capture so the drag survives leaving the strip. */
export function attachScrub(opts: ScrubOpts): () => void {
  const { strip, playhead, getScale, onSeek, bubble } = opts;
  let dragging = false;

  const xFromEvent = (e: PointerEvent): number => {
    const rect = strip.getBoundingClientRect();
    return e.clientX - rect.left + strip.scrollLeft;
  };
  const emit = (e: PointerEvent, final: boolean): void => {
    const scale = getScale();
    const t = scale.xToTime(xFromEvent(e));
    if (bubble) {
      bubble.textContent = `${t.toFixed(1)}s`;
      bubble.style.left = `${scale.timeToX(t)}px`;
      bubble.style.display = dragging ? 'block' : 'none';
    }
    onSeek(t, final);
  };
  const onDown = (e: PointerEvent): void => {
    dragging = true;
    try { strip.setPointerCapture(e.pointerId); } catch { /* jsdom / no capture */ }
    emit(e, false);
  };
  const onMove = (e: PointerEvent): void => { if (dragging) emit(e, false); };
  const onUp = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    if (bubble) bubble.style.display = 'none';
    emit(e, true);
  };
  strip.style.cursor = 'pointer';
  strip.addEventListener('pointerdown', onDown);
  strip.addEventListener('pointermove', onMove);
  strip.addEventListener('pointerup', onUp);
  // Playhead sits ABOVE the strip (it's a DOM child), so a press on it would
  // bubble and fire onDown a second time. Handle it directly + stop propagation.
  const onPlayheadDown = (e: PointerEvent): void => { e.stopPropagation(); onDown(e); };
  playhead.addEventListener('pointerdown', onPlayheadDown);
  return () => {
    strip.removeEventListener('pointerdown', onDown);
    strip.removeEventListener('pointermove', onMove);
    strip.removeEventListener('pointerup', onUp);
    playhead.removeEventListener('pointerdown', onPlayheadDown);
  };
}
