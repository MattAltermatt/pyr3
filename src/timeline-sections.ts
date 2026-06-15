// #227d — the editable "section model" timeline track: key-flame nodes joined
// by evolve sections. Pure geometry (sectionLayout/playheadX) + a createElement
// DOM lane (no innerHTML, per the repo invariant). Selection drives the
// inspector in timeline-section-editor.ts; scrub/play stays on the playback bar.

import { type Timeline } from './timeline';
import { segmentScale, attachScrub } from './timeline-scale';

export interface SectionLayoutOpts {
  /** Fixed px width of a key-flame node thumbnail. */
  nodeW: number;
  /** Minimum px width of an evolve bar. */
  edgeMinW: number;
  /** Px per evolve-second (bar width = max(edgeMinW, evolve*edgePxPerSec)). */
  edgePxPerSec: number;
}

export interface LayoutSeg {
  kind: 'node' | 'edge';
  /** node index (kind='node') OR section index i meaning i→i+1 (kind='edge'). */
  index: number;
  x: number;
  w: number;
  /** Global-time span this visual segment covers. */
  tStart: number;
  tEnd: number;
}

/** Lay a timeline out as node / edge / node / … segments. Node = a clip's
 *  leading hold (pause); edge = that clip's trailing evolve. */
export function sectionLayout(tl: Timeline, opts: SectionLayoutOpts): LayoutSeg[] {
  const { nodeW, edgeMinW, edgePxPerSec } = opts;
  const segs: LayoutSeg[] = [];
  const clips = tl.clips;
  let x = 0;
  let clipStart = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i]!;
    const dur = Math.max(0, c.duration);
    const evolve = Math.max(0, Math.min(c.transitionDuration, dur));
    const pause = dur - evolve;
    const isLast = i === clips.length - 1;
    // Node segment = the pause (leading hold) of this flame.
    segs.push({ kind: 'node', index: i, x, w: nodeW, tStart: clipStart, tEnd: clipStart + pause });
    x += nodeW;
    if (!isLast) {
      const w = Math.max(edgeMinW, evolve * edgePxPerSec);
      segs.push({
        kind: 'edge', index: i, x, w,
        tStart: clipStart + pause, tEnd: clipStart + pause + evolve,
      });
      x += w;
    }
    clipStart += dur;
  }
  return segs;
}

/** Forward map global time `t` → playhead x across a section layout. */
export function playheadX(segs: LayoutSeg[], t: number): number {
  if (segs.length === 0) return 0;
  const first = segs[0]!;
  const last = segs[segs.length - 1]!;
  if (t <= first.tStart) return first.x;
  if (t >= last.tEnd) return last.x + last.w;
  for (const s of segs) {
    if (t >= s.tStart && t <= s.tEnd) {
      const span = s.tEnd - s.tStart;
      if (span <= 0) return s.x; // zero-time node (pause 0)
      return s.x + ((t - s.tStart) / span) * s.w;
    }
  }
  return last.x + last.w;
}

// ---------------------------------------------------------------------------
// DOM lane
// ---------------------------------------------------------------------------

export type Selection =
  | { kind: 'node'; index: number }
  | { kind: 'section'; index: number }
  | null;

export interface SectionTrackOpts {
  timeline: Timeline;
  onSelectNode: (index: number) => void;
  onSelectSection: (index: number) => void;
  onAdd: () => void;
  /** #286 — insert a key flame at clip `index` (between two existing clips),
   *  growing the timeline. The trailing `onAdd` still appends. */
  onInsert: (index: number) => void;
  /** #276 — fires when the user clicks/drags the track background to scrub. */
  onSeek: (t: number, final: boolean) => void;
}

export interface SectionTrackHandle {
  setPlayhead(t: number): void;
  setSelection(sel: Selection): void;
  /** Drop a rendered thumbnail into node `index`. */
  setThumbnail(index: number, thumb: HTMLCanvasElement): void;
  /** Rebuild from a mutated timeline (e.g. after add/edit/remove). */
  rebuild(timeline: Timeline): void;
  destroy(): void;
}

// #276 — edgePxPerSec is now zoomable. DEFAULT keeps short evolves compact (a
// 30 s evolve reads tight, not sprawling); tune in Chrome verify. Node
// thumbnails stay fixed-width (a key flame is a time-point, not a span).
const DEFAULT_EDGE_PX_PER_SEC = 12;
const ZOOM_MIN = 3;
const ZOOM_MAX = 120;
const ZOOM_STEP = 1.5; // multiplicative per click
const BASE_TRACK_OPTS = { nodeW: 64, edgeMinW: 34 } as const;
const TRACK_HEIGHT = 96;

export function mountSectionTrack(host: HTMLElement, opts: SectionTrackOpts): SectionTrackHandle {
  let timeline = opts.timeline;
  let selection: Selection = null;
  let edgePxPerSec = DEFAULT_EDGE_PX_PER_SEC; // #276 — zoom state
  let lastT = 0;                              // #276 — last playhead time, for zoom re-sync
  const thumbs = new Map<number, HTMLCanvasElement>();

  const trackOpts = (): SectionLayoutOpts => ({ ...BASE_TRACK_OPTS, edgePxPerSec });

  // #276 — outer wrapper is the non-scrolling layer (holds the zoom control over
  // the top-right); `root` inside it is the horizontally-scrolling track viewport.
  const wrapper = document.createElement('div');
  Object.assign(wrapper.style, { position: 'relative', margin: '0 16px 8px' });
  host.appendChild(wrapper);

  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'relative', height: `${TRACK_HEIGHT}px`,
    background: '#0c0c0e', border: '1px solid #2a2a2a', borderRadius: '6px',
    overflowX: 'auto', overflowY: 'hidden', userSelect: 'none', whiteSpace: 'nowrap',
  });
  wrapper.appendChild(root);

  // #276 — zoom control, fixed over the track's top-right (in the wrapper, so it
  // ignores the track's horizontal scroll).
  function fitEdgePxPerSec(): number {
    const totalEvolve = timeline.clips.reduce(
      (a, c) => a + Math.max(0, Math.min(c.transitionDuration, c.duration)), 0);
    const nodePx = timeline.clips.length * BASE_TRACK_OPTS.nodeW;
    const avail = Math.max(100, root.clientWidth - nodePx - 100);
    return totalEvolve > 0
      ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, avail / totalEvolve))
      : DEFAULT_EDGE_PX_PER_SEC;
  }
  function syncPlayhead(): void {
    playhead.style.left = `${segmentScale(sectionLayout(timeline, trackOpts())).timeToX(lastT)}px`;
  }
  const zoomBox = document.createElement('div');
  Object.assign(zoomBox.style, {
    position: 'absolute', top: '4px', right: '6px', display: 'flex', gap: '4px', zIndex: '6',
  });
  const zoomBtn = (txt: string, title: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = txt; b.title = title;
    Object.assign(b.style, {
      background: '#181820', border: '1px solid #3a3a44', color: '#cdd',
      borderRadius: '3px', fontSize: '11px', cursor: 'pointer', padding: '1px 6px', fontFamily: 'inherit',
    });
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  zoomBox.append(
    zoomBtn('−', 'Zoom out', () => { edgePxPerSec = Math.max(ZOOM_MIN, edgePxPerSec / ZOOM_STEP); render(); syncPlayhead(); }),
    zoomBtn('fit', 'Fit timeline to width', () => { edgePxPerSec = fitEdgePxPerSec(); render(); syncPlayhead(); }),
    zoomBtn('+', 'Zoom in', () => { edgePxPerSec = Math.min(ZOOM_MAX, edgePxPerSec * ZOOM_STEP); render(); syncPlayhead(); }),
  );
  wrapper.appendChild(zoomBox);

  const lane = document.createElement('div');
  Object.assign(lane.style, { position: 'relative', height: '100%', display: 'inline-block', padding: '12px 0' });
  root.appendChild(lane);

  const playhead = document.createElement('div');
  Object.assign(playhead.style, {
    position: 'absolute', top: '6px', bottom: '6px', width: '3px',
    background: '#ff8c1a', boxShadow: '0 0 5px rgba(255,140,26,.9)', left: '0',
    cursor: 'ew-resize', zIndex: '4', // #276 — grabbable to scrub
  });
  lane.appendChild(playhead);

  // #276 — time bubble shown next to the cursor while dragging the playhead.
  const bubble = document.createElement('div');
  Object.assign(bubble.style, {
    position: 'absolute', top: '-2px', transform: 'translateX(-50%)', display: 'none',
    background: '#ff8c1a', color: '#1a1206', fontSize: '10px', padding: '1px 5px',
    borderRadius: '8px', fontFamily: 'ui-monospace,monospace', pointerEvents: 'none', zIndex: '7',
  });
  lane.appendChild(bubble);

  // #276 — lane background = seek surface; tiles stopPropagation so click=select
  // never also seeks. attachScrub re-reads the scale each event so zoom applies.
  const detachScrub = attachScrub({
    strip: lane, playhead, bubble,
    getScale: () => segmentScale(sectionLayout(timeline, trackOpts())),
    onSeek: (t, final) => { lastT = t; opts.onSeek(t, final); },
  });

  function render(): void {
    // Clear everything except the playhead + drag bubble (both are mutated by
    // reference and must survive a re-render — #276).
    for (const child of Array.from(lane.children)) {
      if (child !== playhead && child !== bubble) child.remove();
    }
    const segs = sectionLayout(timeline, trackOpts());
    let contentW = 0;
    for (const s of segs) {
      contentW = Math.max(contentW, s.x + s.w);
      if (s.kind === 'node') {
        const node = document.createElement('div');
        const selN = selection?.kind === 'node' && selection.index === s.index;
        Object.assign(node.style, {
          position: 'absolute', top: '12px', left: `${s.x}px`, width: `${s.w}px`,
          height: `${TRACK_HEIGHT - 24}px`, borderRadius: '7px', background: '#191922',
          boxShadow: selN ? '0 0 0 2px #ff8c1a' : '0 0 0 2px #000, 0 0 0 3px #333',
          overflow: 'hidden', cursor: 'pointer', zIndex: '2',
        });
        node.title = `key flame ${s.index + 1}`;
        const thumb = thumbs.get(s.index);
        if (thumb) {
          Object.assign(thumb.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'block' });
          node.appendChild(thumb);
        }
        // Pause cue (#227d): a node's hold is otherwise invisible on the track —
        // a flame holding 2s looks identical to one holding 0s. #280 — every
        // node's pause reads the same neutral chip (the terminal "end hold"
        // special-case is gone; a terminal pause is just a pause).
        const pauseSecs = s.tEnd - s.tStart;
        if (pauseSecs > 0) {
          const badge = document.createElement('div');
          badge.textContent = `⏸ ${pauseSecs.toFixed(1)}s`;
          badge.title = `Holds on this flame for ${pauseSecs.toFixed(1)}s.`;
          Object.assign(badge.style, {
            position: 'absolute', left: '3px', bottom: '3px',
            padding: '1px 5px', borderRadius: '8px', fontSize: '9px',
            fontFamily: 'ui-monospace,monospace', pointerEvents: 'none', zIndex: '3',
            background: 'rgba(0,0,0,.72)', color: '#cfe9f3',
          });
          node.appendChild(badge);
        }
        node.addEventListener('pointerdown', (e) => e.stopPropagation()); // #276 — click=select, not seek
        node.addEventListener('click', () => opts.onSelectNode(s.index));
        lane.appendChild(node);
      } else {
        const edge = document.createElement('div');
        const selE = selection?.kind === 'section' && selection.index === s.index;
        Object.assign(edge.style, {
          position: 'absolute', top: `${TRACK_HEIGHT / 2 - 13}px`, left: `${s.x}px`, width: `${s.w}px`,
          height: '26px', borderRadius: '13px', cursor: 'pointer', zIndex: '1',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'repeating-linear-gradient(90deg,#3a4a55 0 8px,#2a3640 8px 16px)',
          boxShadow: selE ? '0 0 0 2px #ff8c1a, inset 0 0 0 1px #9cd' : 'inset 0 0 0 1px #44545f',
        });
        const evolve = timeline.clips[s.index]!.transitionDuration;
        const lbl = document.createElement('span');
        lbl.textContent = `${evolve.toFixed(1)}s`;
        Object.assign(lbl.style, { fontSize: '10px', color: '#cfe9f3', fontFamily: 'ui-monospace,monospace', pointerEvents: 'none' });
        edge.appendChild(lbl);
        edge.addEventListener('pointerdown', (e) => e.stopPropagation()); // #276 — click=select, not seek
        edge.addEventListener('click', () => opts.onSelectSection(s.index));
        lane.appendChild(edge);

        // #286 — interior insert marker: a small ＋ over this gap inserts a key
        // flame between clip s.index and s.index+1 (insert index = s.index + 1).
        const ins = document.createElement('div');
        ins.textContent = '＋';
        ins.title = 'Insert a key flame here';
        Object.assign(ins.style, {
          position: 'absolute', top: '0px', left: `${s.x + s.w / 2 - 9}px`,
          width: '18px', height: '18px', borderRadius: '9px', border: '1px dashed #3a6',
          background: '#0c0c0e', color: '#bfe9cf', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: '11px', lineHeight: '1', cursor: 'pointer', zIndex: '3',
        });
        ins.addEventListener('pointerdown', (e) => e.stopPropagation()); // click=insert, not seek
        ins.addEventListener('click', (e) => { e.stopPropagation(); opts.onInsert(s.index + 1); });
        lane.appendChild(ins);
      }
    }
    // ＋ add affordance after the chain.
    const add = document.createElement('div');
    Object.assign(add.style, {
      position: 'absolute', top: '12px', left: `${contentW + 14}px`, width: '60px',
      height: `${TRACK_HEIGHT - 24}px`, borderRadius: '7px', border: '1px dashed #3a6',
      color: '#bfe9cf', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '11px', fontFamily: 'ui-monospace,monospace', cursor: 'pointer', textAlign: 'center', zIndex: '2',
    });
    add.textContent = '＋ add';
    add.title = 'Add a key flame';
    add.addEventListener('pointerdown', (e) => e.stopPropagation()); // #276 — click=add, not seek
    add.addEventListener('click', () => opts.onAdd());
    lane.appendChild(add);

    lane.style.width = `${contentW + 90}px`;
  }

  render();

  return {
    setPlayhead(t: number): void {
      lastT = t; // #276 — remembered so zoom changes can re-place the playhead
      playhead.style.left = `${playheadX(sectionLayout(timeline, trackOpts()), t)}px`;
    },
    setSelection(sel: Selection): void { selection = sel; render(); },
    setThumbnail(index: number, thumb: HTMLCanvasElement): void { thumbs.set(index, thumb); render(); },
    rebuild(next: Timeline): void { timeline = next; render(); },
    destroy(): void { detachScrub(); wrapper.remove(); thumbs.clear(); },
  };
}
