// Mount the /v1/animate page body. Owns: a canvas, a load-flame affordance,
// the playback scrubber. P6 of Animation milestone (#17 / #211).
//
// Structural analogue of screensaver-mount.ts: this module renders the body
// content into the container the bar's middleSlot hands it; the bar lives
// in #pyr3-bar and is mounted by main.ts via mountAnimateBar.
//
// The MVP UI: drop a multi-keyframe `.flam3` file onto the canvas zone (or
// pick via a button), the first keyframe renders, the playback scrubber
// appears under the canvas. Drag the slider to seek; play loops the keyframe
// time range over 4 s. Future iterations of this surface will grow keyframe
// linking, tween authoring, and an export button — those plug into the same
// container without touching the viewer.

import { mountPlaybackBar, type PlaybackBarHandle } from './playback-bar';
import { parseFlame } from './flame-import';
import { load as loadFile } from './loader';
import { type Animation } from './animation';
import { createRenderer, DEFAULT_FILTER_RADIUS, type Renderer } from './renderer';
import { renderAnimationFrame } from './animate-render';
import { DEFAULT_WALKER_JITTER } from './chaos';
import { getCapability } from './capability';
import { exportAnimate, type ExportAnimateProgress } from './animate-export';
import { openAnimateExportModal, type AnimateExportModalHandle } from './animate-export-modal';
import { estimateExport, estimateTimelineExport } from './animate-estimate';
import { buildEasingPanel } from './animate-easing-panel';
import { type EasingCurve } from './easing';
import { type Timeline, timelineDuration, sectionTransitionMidpoint } from './timeline';
import { rescaleGenomeToOutput, type OutputSize } from './output-size';
import { createSizePresetControl, type SizePresetControlHandle } from './size-preset-control';
import { timelineFromJson, timelineToJson } from './timeline-serialize';
import { persistTimeline, restoreTimeline } from './animate-persist';
import { renderTimelineFrame } from './animate-render';
import { renderClipThumbnails } from './timeline-thumbnails';
// #227d — section-model authoring.
import { genomeFromJson } from './serialize';
import {
  createTimeline, appendFlame, appendAnimationAll, setEvolve, setPause, setLinger, setPermutation, removeNode,
  swapClipFlames, insertFlame, replaceClipFlame,
} from './timeline-edit';
import { mountSectionTrack, type SectionTrackHandle, type Selection } from './timeline-sections';
import { mountSectionEditor, type SectionEditorHandle } from './timeline-section-editor';
import { mountContextPanel, type ContextPanelHandle } from './timeline-context-panel';
import { openAddAnimationDialog } from './timeline-add-dialog';

export interface MountAnimateOpts {
  /** Container the page renders into. Cleared on mount. */
  root: HTMLElement;
  /** Pre-acquired WebGPU device + canvas format. */
  device: GPUDevice;
  format: GPUTextureFormat;
}

export interface AnimatePageHandle {
  /** Tear down GPU resources and any in-flight playback rAF. Idempotent. */
  destroy(): void;
}

// Canvas backing store cap — multi-keyframe rendering can stack walker
// work across sub-frames (P5 temporal sampling), so keep the visible
// canvas modest. CSS scales to fill.
const CANVAS_MAX_W = 1280;
const CANVAS_MAX_H = 720;
const CANVAS_DEFAULT_W = 800;
const CANVAS_DEFAULT_H = 600;
// #408 — the output dimensions default to 4K (matches the "4K" SIZE_PRESET) and
// stay there; flame loads never override the user's size pick (per the
// bar-state-independent-of-genome convention, #176).
const ANIMATE_DEFAULT_OUTPUT: OutputSize = { width: 3840, height: 2160 };

/** Preview canvas dims = the chosen output size capped to (maxW, maxH), aspect
 *  preserved, never upscaled. The preview is a scaled-down WYSIWYG of the export:
 *  the genome is rescaled to these dims (long-edge anchored) so framing matches. */
export function computeOutputAwarePreviewDims(
  out: OutputSize,
  maxW: number,
  maxH: number,
): { width: number; height: number } {
  const sw = out.width > maxW ? maxW / out.width : 1;
  const sh = out.height > maxH ? maxH / out.height : 1;
  const s = Math.min(sw, sh);
  return {
    width: Math.max(1, Math.round(out.width * s)),
    height: Math.max(1, Math.round(out.height * s)),
  };
}

// Hard cap on samples-per-pixel for browser-side animate playback. ESF flames
// authored for offline rendering carry `quality=2000` (single offline render
// budget); the browser WebGPU dispatch for that at 800×592 is ~940M samples,
// which saturates the GPU + freezes the system for many seconds (or hangs).
// The CLI / pyr3 serve path remains unrestricted (renders happen on Dawn-
// node, no display compositor contention). Cap is matched to the viewer's
// "Fast" preview tier so playback feels responsive even on weaker GPUs.
const PREVIEW_MAX_SPP = 16;

const PLAYBACK_SPAN_EPS = 1e-9;

/** Wrap an auto-play time into the closed keyframe range [tMin, tMax]. Uses the
 *  REAL span for the modulo so sub-unit keyframe spans wrap correctly, and
 *  clamps the result so pickKeyframes never sees an out-of-range time (which
 *  would endpoint-extrapolate with c0<0). A degenerate span (all keyframes at
 *  one time) pins to tMin. (#248) */
export function wrapPlaybackTime(t: number, tMin: number, tMax: number): number {
  const realSpan = tMax - tMin;
  if (realSpan <= PLAYBACK_SPAN_EPS) return tMin;
  let wrapped = t;
  if (wrapped > tMax) wrapped = tMin + ((wrapped - tMin) % realSpan);
  return Math.min(tMax, Math.max(tMin, wrapped));
}

/** Real-time playback mapping: timeline time after `elapsedMs` of wall-clock at
 *  `speed`× from `startT`, wrapped into [tMin, tMax]. 1× = authored duration, so
 *  a 30 s timeline plays in 30 s (replaces the old fixed 4 s loop). (#276) */
export function playbackTimeAt(
  startT: number, elapsedMs: number, speed: number, tMin: number, tMax: number,
): number {
  return wrapPlaybackTime(startT + (elapsedMs / 1000) * speed, tMin, tMax);
}

/** Quality-capped, single-sub-frame copy of a timeline for the browser preview
 *  path — mirrors the `previewAnim` cap applied to the Animation path so ESF
 *  `quality=2000` clips don't freeze the compositor (#211). */
function previewTimeline(tl: Timeline): Timeline {
  return {
    ...tl,
    ntemporal_samples: 1,
    clips: tl.clips.map((c) => ({
      ...c,
      flame: {
        ...c.flame,
        genome: {
          ...c.flame.genome,
          quality: c.flame.genome.quality !== undefined
            ? Math.min(c.flame.genome.quality, PREVIEW_MAX_SPP)
            : PREVIEW_MAX_SPP,
        },
      },
    })),
  };
}

// #408 — themed styles for the animate action bar + buttons + empty state.
// Reuses the app's design tokens (defined in index.html :root) so the surface
// matches the viewer/editor chrome instead of the old ad-hoc grey-on-black
// inline styles. Injected once.
const ANIMATE_CSS = `
.pyr3-animate-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: var(--bar-bg-1, #15151a);
  border-bottom: 1px solid var(--bar-border, #2a2a30);
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 12px;
  color: var(--text, #ddd);
}
.pyr3-animate-bar-btn {
  background: transparent;
  border: 1px solid var(--bar-border, #2a2a30);
  color: var(--text, #ddd);
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 3px;
  font: inherit;
}
.pyr3-animate-bar-btn:hover:not(:disabled) { background: var(--accent-soft, rgba(255,140,26,0.18)); }
.pyr3-animate-bar-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.pyr3-animate-bar-status { color: var(--text-dim, #888); }
.pyr3-animate-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-dim, #888);
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 13px;
  text-align: center;
  padding: 24px;
  pointer-events: none;
}
.pyr3-animate-empty-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text, #ddd);
  margin-bottom: 2px;
}
.pyr3-animate-empty code {
  background: var(--bar-bg-3, #0f0f13);
  border: 1px solid var(--bar-border, #2a2a30);
  padding: 1px 5px;
  border-radius: 3px;
}
.pyr3-animate-sample-cta {
  pointer-events: auto;
  margin-top: 8px;
  background: var(--accent, #ff8c1a);
  color: #1a1a1a;
  border: none;
  font-weight: 600;
  padding: 8px 16px;
  border-radius: 6px;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 13px;
  cursor: pointer;
}
.pyr3-animate-sample-cta:hover { filter: brightness(1.08); }
`;

function injectAnimateStylesOnce(): void {
  if (document.getElementById('pyr3-animate-styles')) return;
  const style = document.createElement('style');
  style.id = 'pyr3-animate-styles';
  style.textContent = ANIMATE_CSS;
  document.head.appendChild(style);
}

export function mountAnimatePage(opts: MountAnimateOpts): AnimatePageHandle {
  const { root, device, format } = opts;
  root.replaceChildren();
  injectAnimateStylesOnce();
  root.style.display = 'flex';
  root.style.flexDirection = 'column';

  // Layout: a flexible canvas zone on top, a thin "controls" strip
  // (playback bar + status) pinned to the bottom.
  const canvasZone = document.createElement('div');
  Object.assign(canvasZone.style, {
    flex: '1',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#000',
    overflow: 'hidden',
  });
  root.appendChild(canvasZone);

  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    background: '#000',
    display: 'block',
  });
  canvas.width = CANVAS_DEFAULT_W;
  canvas.height = CANVAS_DEFAULT_H;
  canvasZone.appendChild(canvas);

  // Empty-state overlay: a welcoming prompt when no animation is loaded.
  // #408 — themed via .pyr3-animate-empty (sans-serif, design tokens); copy
  // points at the action bar that now sits ABOVE the canvas.
  const empty = document.createElement('div');
  empty.className = 'pyr3-animate-empty';
  const emptyHeader = document.createElement('div');
  emptyHeader.className = 'pyr3-animate-empty-title';
  emptyHeader.textContent = 'Animate your flames';
  const emptyLine = document.createElement('div');
  emptyLine.textContent = 'Build a timeline keyframe by keyframe — and watch one flame morph into the next.';
  const emptyHint = document.createElement('div');
  const hintBefore = document.createTextNode('Hit ');
  const hintAdd = document.createElement('strong');
  hintAdd.textContent = '＋ Add key flame';
  const hintMid = document.createTextNode(' above to begin, or drop a multi-keyframe ');
  const emptyCode = document.createElement('code');
  emptyCode.textContent = '.flam3';
  const hintAfter = document.createTextNode(' here to play it back.');
  emptyHint.append(hintBefore, hintAdd, hintMid, emptyCode, hintAfter);
  // #408 (option C) — a one-click sample-load CTA fills the empty-state void so a
  // new visitor can see the feature immediately. The overlay is pointer-events:none;
  // the CTA re-enables clicks on itself (.pyr3-animate-sample-cta).
  const sampleBtn = document.createElement('button');
  sampleBtn.type = 'button';
  sampleBtn.className = 'pyr3-animate-sample-cta';
  sampleBtn.textContent = '▶ Load a sample animation';
  sampleBtn.title = 'Load a bundled multi-keyframe animation to see one flame morph into the next';
  sampleBtn.addEventListener('click', () => void loadSampleAnimation());
  empty.append(emptyHeader, emptyLine, sampleBtn, emptyHint);
  canvasZone.appendChild(empty);

  // #408 — the action bar now sits at the TOP (directly under the nav, matching
  // every other surface) instead of pinned to the bottom. `topRow` is inserted
  // before the canvas; the timeline + transport dock stays at the bottom in
  // `controls`.
  const topRow = document.createElement('div');
  topRow.className = 'pyr3-animate-bar';
  root.insertBefore(topRow, canvasZone);

  // Bottom dock: the playback bar + section track (mounted into scrubHost when
  // an animation loads).
  const controls = document.createElement('div');
  // #408 — one cohesive dock ground (was rgba black); the transparent transport
  // bar + section track sit on this single surface so they read as one unit.
  Object.assign(controls.style, {
    flex: '0 0 auto',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bar-bg-1, #15151a)',
    borderTop: '1px solid var(--bar-border, #2a2a30)',
  });
  root.appendChild(controls);

  const loadBtn = document.createElement('button');
  loadBtn.type = 'button';
  loadBtn.className = 'pyr3-animate-bar-btn';
  loadBtn.textContent = '📂 Load';
  loadBtn.title = 'Load a multi-keyframe .flam3 animation or a .pyr3.timeline.json timeline';
  topRow.appendChild(loadBtn);

  // #227d — Add a key flame to the timeline. Single flame → one node; a
  // multi-keyframe animation .flam3 opens the import dialog.
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'pyr3-animate-bar-btn';
  addBtn.textContent = '＋ Add key flame';
  addBtn.title = 'Add a flame (.flame/.flam3/.pyr3.json/.png) to the timeline';
  topRow.appendChild(addBtn);

  const addInput = document.createElement('input');
  addInput.type = 'file';
  // #409 — also accept pyr3 PNGs (the `pyr3` tEXt-chunk genome written by Save
  // Render). A PNG carries one genome = one keyframe, so it routes through the
  // single-node Add path, not the multi-keyframe Load path.
  addInput.accept = '.flame,.flam3,.json,.png,image/png';
  addInput.style.display = 'none';
  root.appendChild(addInput);
  // #286 — interior insert AND in-place replace ("swap key flame") route through
  // the same file picker; the pending target is stashed here and consumed (then
  // cleared) by handleAddFlame. `undefined` ⇒ append (the ＋add tile / Add button).
  let pendingTarget: { mode: 'insert' | 'replace'; index: number } | undefined;
  addBtn.addEventListener('click', () => { pendingTarget = undefined; addInput.click(); });
  addInput.addEventListener('change', () => {
    const f = addInput.files?.[0];
    const target = pendingTarget;
    pendingTarget = undefined;
    if (f) void handleAddFlame(f, target);
    addInput.value = '';
  });

  // P7 (#212) — Export sequence button. Capability-gated: enabled only when
  // `pyr3 serve` is hosting the page (can_render_animation === true). On
  // gh-pages the fetch returns the GHPAGES_DEFAULT capability where the flag
  // is false, so the button renders disabled+dim with the install tooltip.
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'pyr3-animate-bar-btn';
  exportBtn.setAttribute('data-export-sequence', '');
  exportBtn.textContent = '📤 Export sequence';
  topRow.appendChild(exportBtn);

  // #227d — Save the authored timeline as a .pyr3.timeline.json (browser
  // download — no backend, works on gh-pages). Hidden until a timeline exists.
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'pyr3-animate-bar-btn';
  saveBtn.textContent = '💾 Save timeline';
  saveBtn.title = 'Download this timeline as a .pyr3.timeline.json';
  // #276 — no-jump: present-but-disabled until a timeline exists (was display:none).
  // The .pyr3-animate-bar-btn:disabled rule dims it.
  saveBtn.disabled = true;
  topRow.appendChild(saveBtn);

  /** #276 — enable/dim Save in place (no appear/disappear). */
  function refreshSaveButton(): void {
    saveBtn.disabled = timeline === null || timeline.clips.length === 0;
  }

  function saveTimeline(): void {
    if (!timeline) return;
    const json = timelineToJson(timeline);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const nick = timeline.clips[0]?.flame.genome.nick;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nick ?? 'timeline'}.pyr3.timeline.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  saveBtn.addEventListener('click', saveTimeline);

  function refreshExportButtonCapability(): void {
    const canExport = getCapability().can_render_animation;
    // Loaded-but-no-export => disabled with capability tooltip
    // Loaded-and-can-export => enabled
    // Nothing-loaded => disabled (no tooltip override)
    // #227 — timeline export rides the same backend route + capability bit.
    const noSource = animation === null && timeline === null;
    // #408 — the .pyr3-animate-bar-btn:disabled rule owns the dim/cursor look;
    // here we only flip `disabled` + the explanatory tooltip.
    if (!canExport) {
      exportBtn.disabled = true;
      exportBtn.title =
        'Animation export needs filesystem access. Install pyr3 locally: '
        + '`npm install -g pyr3` then run `pyr3` — same UI, same flame, with export enabled.';
    } else if (noSource) {
      exportBtn.disabled = true;
      exportBtn.title = 'Load a multi-keyframe .flam3 or build a timeline to enable export.';
    } else {
      exportBtn.disabled = false;
      exportBtn.title = '';
    }
  }

  const status = document.createElement('span');
  status.className = 'pyr3-animate-bar-status';
  status.textContent = 'no animation loaded';
  topRow.appendChild(status);

  // Playback bar host — only populated when an animation loads.
  const scrubHost = document.createElement('div');
  controls.appendChild(scrubHost);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.flam3,.flame,.json';
  fileInput.style.display = 'none';
  root.appendChild(fileInput);
  loadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void handleFile(f);
    fileInput.value = '';
  });

  // Drop zone — the whole canvasZone accepts file drops.
  canvasZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    canvasZone.style.outline = '2px dashed var(--accent, #ff8c1a)';
    canvasZone.style.outlineOffset = '-8px';
  });
  canvasZone.addEventListener('dragleave', () => {
    canvasZone.style.outline = '';
  });
  canvasZone.addEventListener('drop', (e) => {
    e.preventDefault();
    canvasZone.style.outline = '';
    const f = e.dataTransfer?.files?.[0];
    if (f) void handleFile(f);
  });

  exportBtn.addEventListener('click', () => {
    if (exportBtn.disabled) return;
    if (timeline) { openTimelineExportModal(); return; }
    if (!animation || !loadedFlameXml) return;
    openExportModal();
  });

  // Runtime state.
  let animation: Animation | null = null;
  // #227c — timeline mode runs alongside animation mode. At most one of
  // `animation` / `timeline` is non-null at a time.
  let timeline: Timeline | null = null;
  let timelinePreview: Timeline | null = null;
  // #411 — persist the working timeline to localStorage so a refresh restores
  // it. Edits debounce (a linger/evolve slider can fire applyEdit repeatedly);
  // clears (remove-last-node, switch to animation mode) write through
  // immediately AND cancel any pending debounced write so a fast refresh can't
  // resurrect the just-cleared timeline. Both read the live `timeline` closure
  // var, so whatever the latest state is gets written.
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  function schedulePersistTimeline(): void {
    if (persistTimer !== undefined) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { persistTimer = undefined; persistTimeline(timeline); }, 200);
  }
  function persistTimelineNow(): void {
    if (persistTimer !== undefined) { clearTimeout(persistTimer); persistTimer = undefined; }
    persistTimeline(timeline);
  }
  // #274/#408 — output dimensions for preview + export. Defaults to 4K and
  // stays there: flame loads do NOT override it (per the
  // bar-state-independent-of-genome convention, #176). The size control in the
  // chrome drives both the live preview aspect and the export request.
  let outputSize: OutputSize | null = { ...ANIMATE_DEFAULT_OUTPUT };
  let sizeControl: SizePresetControlHandle | null = null;
  // #227d — authoring uses the editable section track + inspector. (The #227c
  // clip-strip `mountTimelineTrack` is retired from this path.)
  let sectionTrack: SectionTrackHandle | null = null;
  let sectionEditor: SectionEditorHandle | null = null;
  let contextPanel: ContextPanelHandle | null = null; // #283
  let selection: Selection = null;
  // P7 (#212) — keep the source XML around so the Export button can POST
  // it verbatim. The /api/animate route re-parses server-side; we don't
  // round-trip through a Genome JSON serializer.
  let loadedFlameXml: string | null = null;
  let renderer: Renderer | null = null;
  let context: GPUCanvasContext | null = null;
  let rafId: number | null = null;
  let playbackBar: PlaybackBarHandle | null = null;
  let renderInFlight = false;
  let pendingRenderTime: number | null = null;
  let exportAbort: AbortController | null = null;
  let exportModal: AnimateExportModalHandle | null = null;
  // #224 — per-segment easing UI, (re)built on each animation load.
  let easingPanel: HTMLElement | null = null;
  // Track the most-recently-rendered time so an easing change re-renders the
  // frame the user is currently looking at.
  let lastRenderedTime = 0;

  // #276 — transport state + helpers. playbackSpeed feeds the real-time loop
  // (Task 8). Step is one frame at STEP_FPS; seek/jump clamp into the span.
  let playbackSpeed = 1;
  const STEP_FPS = 30;
  function playbackTMin(): number {
    return timeline ? 0 : (animation?.keyframes[0]!.time ?? 0);
  }
  function playbackTMax(): number {
    if (timeline) return timelineDuration(timeline);
    if (animation) return animation.keyframes[animation.keyframes.length - 1]!.time ?? 0;
    return 0;
  }
  function seekTo(t: number): void {
    const c = Math.min(playbackTMax(), Math.max(playbackTMin(), t));
    playbackBar?.setTime(c);
    sectionTrack?.setPlayhead(c);
    void renderAtTime(c);
  }
  function stepFrame(dir: -1 | 1): void { seekTo(lastRenderedTime + dir / STEP_FPS); }

  // #276 — node-boundary times: timeline-mode clip starts, animation-mode keyframe times.
  function nodeTimes(): number[] {
    if (timeline) {
      let t = 0;
      const out = [0];
      for (const c of timeline.clips) { t += Math.max(0, c.duration); out.push(t); }
      return out;
    }
    if (animation) return animation.keyframes.map((k) => k.time ?? 0);
    return [0];
  }
  function prevNodeTime(): number {
    return [...nodeTimes()].reverse().find((t) => t < lastRenderedTime - 1e-6) ?? playbackTMin();
  }
  function nextNodeTime(): number {
    return nodeTimes().find((t) => t > lastRenderedTime + 1e-6) ?? playbackTMax();
  }

  // #276 — keyboard transport. Ignored while typing in a field.
  function onKey(e: KeyboardEvent): void {
    const tgt = e.target as HTMLElement | null;
    if (tgt && /^(INPUT|SELECT|TEXTAREA)$/.test(tgt.tagName)) return;
    if (!animation && !timeline) return;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        if (rafId !== null) stopPlayback();
        else { startPlayback(); playbackBar?.setPlaying(true); }
        break;
      case 'ArrowLeft':
        e.preventDefault(); stopPlayback();
        if (e.shiftKey) seekTo(prevNodeTime()); else stepFrame(-1);
        break;
      case 'ArrowRight':
        e.preventDefault(); stopPlayback();
        if (e.shiftKey) seekTo(nextNodeTime()); else stepFrame(1);
        break;
      case 'Home': e.preventDefault(); stopPlayback(); seekTo(playbackTMin()); break;
      case 'End': e.preventDefault(); stopPlayback(); seekTo(playbackTMax()); break;
    }
  }
  window.addEventListener('keydown', onKey);

  // #274 — output-size control in the chrome (before the Export button). Drives
  // both the live preview aspect and the export request. Initialised to defaults;
  // setSize is called to the first flame's native size when a source loads.
  sizeControl = createSizePresetControl({
    initial: { ...ANIMATE_DEFAULT_OUTPUT },
    onChange: (s) => {
      outputSize = s;
      rebuildAndRender();
    },
  });
  topRow.insertBefore(sizeControl.el, exportBtn);

  /** Rebuild the renderer at the current output size + re-render the current
   *  frame. Called when the user changes the output dimensions. */
  function rebuildAndRender(): void {
    if (animation) buildRenderer();
    else if (timeline) buildTimelineRenderer();
    else return;
    void renderAtTime(lastRenderedTime);
  }

  function setStatus(msg: string, tone: 'info' | 'error' = 'info'): void {
    status.textContent = msg;
    status.style.color = tone === 'error' ? '#f99' : '#888';
  }

  function stopPlayback(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    playbackBar?.setPlaying(false);
  }

  function startPlayback(): void {
    if ((!animation && !timeline) || rafId !== null) return;
    // #227c — timeline mode plays over [0, timelineDuration]; animation mode
    // over the keyframe span.
    let tMin: number, tMax: number;
    if (timeline) {
      tMin = 0;
      tMax = timelineDuration(timeline);
    } else {
      tMin = animation!.keyframes[0]!.time ?? 0;
      tMax = animation!.keyframes[animation!.keyframes.length - 1]!.time ?? 0;
    }
    // #276 — real-time playback: `t` is derived from wall-clock elapsed × speed,
    // so 1× plays the timeline at its authored duration. The single-flight render
    // loop (renderAtTime) drops frames when a render can't keep up, so tempo stays
    // locked to the clock — never slow-motion, never faster than real time. (#248
    // wrap keeps sub-unit spans from overshooting tMax → endpoint extrapolation.)
    const startedAt = performance.now();
    const startT = playbackBar?.getTime() ?? tMin;
    const tick = (now: number): void => {
      if ((!animation && !timeline) || !playbackBar) {
        stopPlayback();
        return;
      }
      const t = playbackTimeAt(startT, now - startedAt, playbackSpeed, tMin, tMax);
      playbackBar.setTime(t);
      void renderAtTime(t);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  async function renderAtTime(t: number): Promise<void> {
    lastRenderedTime = t;
    if (!renderer || !context || (!animation && !timeline)) return;
    // Single-flight: drop intermediate frames so seeks during a slow render
    // don't queue up. The last requested time always wins.
    if (renderInFlight) {
      pendingRenderTime = t;
      return;
    }
    renderInFlight = true;
    try {
      // Cap N to 1 AND cap per-keyframe quality to PREVIEW_MAX_SPP in the
      // browser preview path. ESF authors flames with quality=2000 (offline
      // budget); rendering that in-browser at 800×592 dispatches ~940M
      // samples and freezes the GPU + display compositor. CLI / pyr3 serve
      // are the unrestricted paths (see #210, P4). The timeline path applies
      // the same cap via previewTimeline() (built once on load).
      //
      // #274 — rescale genomes to the preview canvas dims (= chosen output size
      // capped uniformly), so the preview is a true WYSIWYG of the export framing.
      const previewTarget: OutputSize = { width: renderer.width, height: renderer.height };
      if (timeline && timelinePreview) {
        const tlScaled: Timeline = {
          ...timelinePreview,
          clips: timelinePreview.clips.map((c) => ({
            ...c,
            flame: { ...c.flame, genome: rescaleGenomeToOutput(c.flame.genome, previewTarget) },
          })),
        };
        renderTimelineFrame(renderer, tlScaled, t, {
          outputView: context.getCurrentTexture().createView(),
          walkerJitter: DEFAULT_WALKER_JITTER,
        });
      } else {
        const previewAnim: Animation = {
          ...animation!,
          ntemporal_samples: 1,
          keyframes: animation!.keyframes.map((g) => rescaleGenomeToOutput({
            ...g,
            quality: g.quality !== undefined
              ? Math.min(g.quality, PREVIEW_MAX_SPP)
              : PREVIEW_MAX_SPP,
          }, previewTarget)),
        };
        renderAnimationFrame(renderer, previewAnim, t, {
          outputView: context.getCurrentTexture().createView(),
          walkerJitter: DEFAULT_WALKER_JITTER,
        });
      }
      // Flush GPU work before the rAF yield below so the just-rendered frame is
      // composited before the next swap-chain texture is acquired (#211).
      await device.queue.onSubmittedWorkDone();
      // #227c — keep the timeline track's playhead in sync with auto-play /
      // scrub (no-op in animation mode where the section track is null).
      sectionTrack?.setPlayhead(t);
      // Yield to rAF so the browser can composite the just-rendered frame
      // before we acquire the next swap-chain texture. Without this, back-to-
      // back scrubs can get the SAME swap-chain texture twice — Chrome
      // composites only the second render, and the first "wins" by
      // invalidation, leaving the canvas displaying the swap chain's spare
      // (magenta-default) texture.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    } finally {
      renderInFlight = false;
      if (pendingRenderTime !== null) {
        const next = pendingRenderTime;
        pendingRenderTime = null;
        void renderAtTime(next);
      }
    }
  }

  function buildRenderer(): void {
    // #274/#408 — the chosen output size (defaults to 4K; never overridden by a
    // flame load) drives the framing; the preview canvas caps it to CANVAS_MAX_*.
    const firstKf = animation!.keyframes[0]!;
    const { width, height } = computeOutputAwarePreviewDims(outputSize!, CANVAS_MAX_W, CANVAS_MAX_H);
    canvas.width = width;
    canvas.height = height;
    // Re-acquire the WebGPU canvas context on (re)build.
    context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) throw new Error('animate-mount: WebGPU canvas context unavailable');
    context.configure({ device, format, alphaMode: 'premultiplied' });
    const filterRadius = firstKf.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;
    renderer?.destroy();
    renderer = createRenderer(device, format, {
      width,
      height,
      oversample: 1,
      filterRadius,
    });
  }

  // #227c — size the renderer from the timeline's first clip and (re)acquire
  // the canvas WebGPU context. Mirrors buildRenderer() for the timeline path.
  function buildTimelineRenderer(): void {
    const firstG = timeline!.clips[0]!.flame.genome;
    const { width, height } = computeOutputAwarePreviewDims(outputSize!, CANVAS_MAX_W, CANVAS_MAX_H);
    canvas.width = width;
    canvas.height = height;
    context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) throw new Error('animate-mount: WebGPU canvas context unavailable');
    context.configure({ device, format, alphaMode: 'premultiplied' });
    const filterRadius = firstG.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;
    renderer?.destroy();
    renderer = createRenderer(device, format, { width, height, oversample: 1, filterRadius });
  }

  // #227d — (re)mount the transport bar over [0, dur]. PlaybackBarHandle has no
  // range setter, so range changes (evolve/pause edits) remount it.
  function mountTimelinePlaybackBar(dur: number, initialT: number): void {
    playbackBar?.destroy();
    playbackBar = mountPlaybackBar(scrubHost, {
      tMin: 0, tMax: dur, initialT: Math.min(initialT, dur),
      onScrub: (t) => { stopPlayback(); void renderAtTime(t); },
      onPlayToggle: (isPlaying) => { if (isPlaying) startPlayback(); else stopPlayback(); },
      onStep: (dir) => { stopPlayback(); stepFrame(dir); },
      onJump: (where) => { stopPlayback(); seekTo(where === 'start' ? playbackTMin() : playbackTMax()); },
      onSpeedChange: (m) => { playbackSpeed = m; },
    });
    playbackBar.setEnabled(true);
  }

  // #276 — no-jump: the section track + transport are present (disabled) from
  // first paint. The empty track shows only the live ＋add tile; the transport
  // is mounted disabled. A real load destroys + replaces both in place, so the
  // bottom region never appears/reflows. Idempotent — destroys any prior pair.
  function mountEmptyScaffold(): void {
    sectionTrack?.destroy();
    sectionTrack = mountSectionTrack(scrubHost, {
      timeline: createTimeline(),
      onSelectNode: () => {},
      onSelectSection: () => {},
      onAdd: () => { pendingTarget = undefined; addInput.click(); },
      onInsert: () => {}, // empty scaffold — nothing to insert between
      onSeek: () => {}, // empty scaffold — nothing to scrub
    });
    playbackBar?.destroy();
    playbackBar = mountPlaybackBar(scrubHost, {
      tMin: 0, tMax: 1, initialT: 0,
      onScrub: (t) => { stopPlayback(); void renderAtTime(t); },
      onPlayToggle: (isPlaying) => { if (isPlaying) startPlayback(); else stopPlayback(); },
    });
    playbackBar.setEnabled(false);
  }

  // #227d — enter section authoring mode for the current `timeline` (built by
  // Add or loaded). Builds the renderer, mounts the section track + inspector +
  // transport, renders the first frame, then fills thumbnails. Replaces the
  // #227c read-only viewer mount; clears any prior animation-mode state.
  async function enterSectionMode(): Promise<void> {
    if (!timeline) return;
    timelinePreview = previewTimeline(timeline);
    animation = null;
    loadedFlameXml = null;
    if (easingPanel) { easingPanel.remove(); easingPanel = null; }
    empty.style.display = 'none';
    refreshSaveButton();
    buildTimelineRenderer();

    selection = null;
    sectionTrack?.destroy();
    sectionTrack = mountSectionTrack(scrubHost, {
      timeline,
      onSelectNode: (i) => {
        selection = { kind: 'node', index: i };
        sectionTrack?.setSelection(selection);
        if (timeline) sectionEditor?.showNode(timeline, i);
        contextPanel?.open(); // #283
      },
      onSelectSection: (i) => {
        selection = { kind: 'section', index: i };
        sectionTrack?.setSelection(selection);
        if (timeline) {
          sectionEditor?.showSection(timeline, i);
          // #410 — seek the preview into the MIDDLE of this section's transition so
          // pairing / easing / evolve edits are immediately visible. At a keyframe
          // those edits are no-ops (the render is order-invariant), which made the
          // pairing reorder look like it did nothing.
          stopPlayback();
          const t = sectionTransitionMidpoint(timeline, i);
          playbackBar?.setTime(t);
          void renderAtTime(t);
        }
        contextPanel?.open(); // #283
      },
      onAdd: () => { pendingTarget = undefined; addInput.click(); },
      onInsert: (i) => { pendingTarget = { mode: 'insert', index: i }; addInput.click(); }, // #286
      onSeek: (t) => { stopPlayback(); playbackBar?.setTime(t); void renderAtTime(t); }, // #276
    });

    // #283 — the selection editor lives in a slide-up panel over the flame, not
    // inline in the bottom strip. Dismissing clears the selection + highlight.
    contextPanel?.destroy();
    contextPanel = mountContextPanel(canvasZone, {
      onDismiss: () => {
        selection = null;
        sectionEditor?.clear();
        sectionTrack?.setSelection(null);
        contextPanel?.close();
      },
    });

    sectionEditor?.destroy();
    sectionEditor = mountSectionEditor(contextPanel.contentHost, {
      onEvolveChange: (i, s) => applyEdit(setEvolve(timeline!, i, s)),
      onLingerChange: (i, l) => applyEdit(setLinger(timeline!, i, l)),
      onPermutationChange: (i, perm) => applyEdit(setPermutation(timeline!, i, perm)),
      onPauseChange: (i, s) => applyEdit(setPause(timeline!, i, s)),
      onMoveNode: (i, dir) => {
        // #286 — swap with the neighbour; follow the flame to its new slot.
        // Structural: flame content moved, so thumbnails must refresh.
        const j = i + dir;
        selection = { kind: 'node', index: j };
        applyEdit(swapClipFlames(timeline!, i, j), { structural: true });
      },
      onReplaceNode: (i) => { pendingTarget = { mode: 'replace', index: i }; addInput.click(); }, // #286
      onRemoveNode: (i) => {
        selection = null;
        sectionEditor?.clear();
        contextPanel?.close(); // #283
        applyEdit(removeNode(timeline!, i), { structural: true });
      },
    });

    mountTimelinePlaybackBar(timelineDuration(timeline), 0);
    refreshExportButtonCapability(); // timeline ⇒ animation===null ⇒ export stays disabled
    await renderAtTime(0);
    setStatus(`${timeline.clips.length} clips, ${timelineDuration(timeline).toFixed(2)} s`);
    await refreshThumbnails();
    schedulePersistTimeline(); // #411 — park the timeline (first add / Load)
  }

  // Apply a pure timeline mutation: swap state, refresh preview/track/bar/editor,
  // re-render. `structural` (add/remove) also re-renders thumbnails.
  function applyEdit(next: Timeline, opts: { structural?: boolean } = {}): void {
    timeline = next;
    timelinePreview = previewTimeline(timeline);
    refreshSaveButton();
    if (timeline.clips.length === 0) {
      // Removed the last node — drop back to the empty state. #276 — restore the
      // disabled scaffold (track + transport stay present) instead of unmounting.
      timeline = null;
      timelinePreview = null;
      sectionEditor?.clear();
      contextPanel?.close(); // #283
      empty.style.display = 'flex';
      setStatus('no timeline');
      refreshSaveButton();
      mountEmptyScaffold();
      refreshExportButtonCapability();
      persistTimelineNow(); // #411 — cleared the last node: drop the saved timeline
      return;
    }
    // Drop a stale selection if a structural edit shrank the chain past it
    // (append never shifts indices, but this guards future insert/reorder).
    if (selection) {
      const maxIdx = selection.kind === 'section' ? timeline.clips.length - 2 : timeline.clips.length - 1;
      if (selection.index > maxIdx) { selection = null; sectionEditor?.clear(); contextPanel?.close(); }
    }
    sectionTrack?.rebuild(timeline);
    if (selection) sectionTrack?.setSelection(selection);
    // Re-show the open editor panel so linger pills / input values stay current.
    if (selection?.kind === 'section') sectionEditor?.showSection(timeline, selection.index);
    else if (selection?.kind === 'node') sectionEditor?.showNode(timeline, selection.index);
    const dur = timelineDuration(timeline);
    mountTimelinePlaybackBar(dur, Math.min(lastRenderedTime, dur));
    void renderAtTime(Math.min(lastRenderedTime, dur));
    setStatus(`${timeline.clips.length} clips, ${dur.toFixed(2)} s`);
    if (opts.structural) void refreshThumbnails();
    schedulePersistTimeline(); // #411 — park the edited timeline (debounced)
  }

  async function refreshThumbnails(): Promise<void> {
    if (!timeline) return;
    try {
      const list = await renderClipThumbnails(device, format, timeline);
      list.forEach((c, i) => sectionTrack?.setThumbnail(i, c));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('pyr3: timeline thumbnails failed', err);
    }
  }

  // #227d — add a key flame to the timeline from a file. Single flame → one
  // node; multi-keyframe animation → import-all / pick-one dialog.
  async function handleAddFlame(file: File, target?: { mode: 'insert' | 'replace'; index: number }): Promise<void> {
    const verb = target === undefined ? 'adding' : target.mode === 'replace' ? 'swapping in' : 'inserting';
    setStatus(`${verb} ${file.name} …`);
    try {
      const base = timeline ?? createTimeline();
      // #286 — one builder: append (no target), insert mid-timeline, or replace
      // a slot's flame in place ("swap key flame").
      const addOne = (genome: Parameters<typeof appendFlame>[1], source: Parameters<typeof appendFlame>[2]): Timeline =>
        target === undefined ? appendFlame(base, genome, source)
          : target.mode === 'replace' ? replaceClipFlame(base, target.index, genome, source)
            : insertFlame(base, target.index, genome, source);
      let next: Timeline;
      if (/\.png$/i.test(file.name)) {
        // #409 — a pyr3 PNG carries one genome (the `pyr3` tEXt chunk) = one
        // keyframe. Route through the shared loader.ts dispatch (reads + decodes
        // the chunk; foreign PNGs throw a clear "no pyr3 metadata" error caught
        // below). It's read as binary, so we MUST NOT call file.text() first.
        const { genome } = await loadFile(file);
        next = addOne(genome, { kind: 'upload', filename: file.name });
      } else {
        const text = await file.text();
        if (/\.json$/i.test(file.name)) {
          const doc = JSON.parse(text) as Record<string, unknown>;
          if (doc.format === 'pyr3-timeline') {
            setStatus('that’s a timeline — use Load, not Add', 'error');
            return;
          }
          next = addOne(genomeFromJson(doc), { kind: 'json' });
        } else {
          const parsed = parseFlame(text);
          if (parsed.animation && parsed.animation.keyframes.length > 1) {
            const choice = await openAddAnimationDialog(root, parsed.animation.keyframes.length);
            if (!choice) { setStatus('add cancelled'); return; }
            // "all" appends the whole sequence; insert/replace of a full sequence
            // isn't supported, so use the first keyframe (single waypoint) there.
            next = choice.kind === 'all'
              ? (target === undefined
                  ? appendAnimationAll(base, parsed.animation)
                  : addOne(parsed.animation.keyframes[0]!, { kind: 'upload', filename: file.name }))
              : addOne(parsed.animation.keyframes[choice.keyframeIndex]!, { kind: 'upload', filename: file.name });
          } else {
            next = addOne(parsed.genome, { kind: 'upload', filename: file.name });
          }
        }
      }
      const wasEmpty = !timeline;
      timeline = next;
      if (wasEmpty) await enterSectionMode();
      else applyEdit(next, { structural: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`failed to add: ${msg}`, 'error');
    }
  }

  // #227c/#227d — load an existing .pyr3.timeline.json into the editable track.
  async function buildTimelineMode(file: File, text: string): Promise<void> {
    timeline = timelineFromJson(text);
    await enterSectionMode();
    setStatus(`${file.name} — ${timeline.clips.length} clips, ${timelineDuration(timeline).toFixed(2)} s`);
  }

  function mountPlaybackForAnimation(): void {
    playbackBar?.destroy();
    const tMin = animation!.keyframes[0]!.time ?? 0;
    const tMax = animation!.keyframes[animation!.keyframes.length - 1]!.time ?? 0;
    playbackBar = mountPlaybackBar(scrubHost, {
      tMin,
      tMax,
      initialT: tMin,
      onScrub: (t) => {
        stopPlayback();
        void renderAtTime(t);
      },
      onPlayToggle: (isPlaying) => {
        if (isPlaying) startPlayback();
        else stopPlayback();
      },
      onStep: (dir) => { stopPlayback(); stepFrame(dir); },
      onJump: (where) => { stopPlayback(); seekTo(where === 'start' ? playbackTMin() : playbackTMax()); },
      onSpeedChange: (m) => { playbackSpeed = m; },
    });
    playbackBar.setEnabled(true);
  }

  async function handleFile(file: File): Promise<void> {
    setStatus(`loading ${file.name} …`);
    stopPlayback();
    // #227c — timeline docs route to timeline mode. Sniff by extension first,
    // then validate via timelineFromJson (which rejects a non-pyr3-timeline body).
    if (/\.json$/i.test(file.name)) {
      try {
        const text = await file.text();
        await buildTimelineMode(file, text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(`not a pyr3 timeline: ${msg}`, 'error');
      }
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseFlame(text);
      if (!parsed.animation) {
        setStatus(
          `"${file.name}" is a single-keyframe flame — open it in the Viewer instead`,
          'error',
        );
        return;
      }
      // #227c — clear any prior timeline-mode state so renderAtTime /
      // startPlayback (which branch on `timeline` first) take the animation
      // path for this freshly loaded .flam3.
      timeline = null;
      timelinePreview = null;
      persistTimelineNow(); // #411 — animation mode is transient: drop the saved timeline
      sectionTrack?.destroy();
      sectionTrack = null;
      sectionEditor?.destroy();
      sectionEditor = null;
      contextPanel?.destroy(); // #283
      contextPanel = null;
      animation = parsed.animation;
      loadedFlameXml = text;
      if (easingPanel) { easingPanel.remove(); easingPanel = null; }
      easingPanel = buildEasingPanel({
        animation,
        onChange: (segmentIndex: number, curve: EasingCurve) => {
          if (!animation) return;
          (animation.segmentEasing ??= [])[segmentIndex] = curve;
          void renderAtTime(lastRenderedTime);
        },
      });
      controls.insertBefore(easingPanel, scrubHost);
      empty.style.display = 'none';
      buildRenderer();
      mountPlaybackForAnimation();
      refreshExportButtonCapability();
      const tMin = animation.keyframes[0]!.time ?? 0;
      await renderAtTime(tMin);
      setStatus(
        `${file.name} — ${animation.keyframes.length} keyframes, ` +
          `t = ${tMin} … ${animation.keyframes[animation.keyframes.length - 1]!.time ?? 0}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`failed to load: ${msg}`, 'error');
    }
  }

  // #408 (option C) — one-click load of the bundled sample. It's a built pyr3
  // timeline (.pyr3.timeline.json) showcasing same-flame → same-flame clips with
  // DIFFERENT per-clip xform pairings (the #412 feature): the .json name routes
  // handleFile to timeline mode (section track + inspector). Swap the showcase by
  // replacing the file at this path — no code change (ship the seam, evolve it).
  const SAMPLE_ANIMATION_URL = '/fixtures/sample-animation.pyr3.timeline.json';
  async function loadSampleAnimation(): Promise<void> {
    setStatus('loading sample animation …');
    try {
      const res = await fetch(SAMPLE_ANIMATION_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      await handleFile(new File([text], 'sample-animation.pyr3.timeline.json'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`couldn't load sample: ${msg}`, 'error');
    }
  }

  function openExportModal(): void {
    if (!animation || !loadedFlameXml) return;
    stopPlayback();
    const firstKfTime = animation.keyframes[0]!.time ?? 0;
    const lastKfTime = animation.keyframes[animation.keyframes.length - 1]!.time ?? 0;
    const begin = Math.floor(firstKfTime);
    const end = Math.max(begin, Math.floor(lastKfTime) - 1);
    const flameXmlAtOpen = loadedFlameXml;

    const exportOut: OutputSize = outputSize ?? { width: CANVAS_DEFAULT_W, height: CANVAS_DEFAULT_H };
    exportAbort = new AbortController();
    exportModal = openAnimateExportModal({
      host: root,
      mode: 'animation',
      outputSize: exportOut,
      defaults: { begin, end, dtime: 1, qs: 1.0, prefix: '' },
      // #226 — live up-front ETA, recomputed as the user edits begin/end/dtime/qs.
      // #274 — fold the chosen output dims into the cost range. #278 — the ETA is
      // a two-term backend cost model (samples + per-pixel); no live anchor needed.
      estimate: (range) =>
        animation
          ? estimateExport(animation, { ...range, outputSize: exportOut })
          : { frames: 0, totalSamples: 0, seconds: null },
      // Only wire the Browse button when running under pyr3 serve —
      // can_write_files is the right capability bit (true on the backend
      // path where /api/pick-dir exists, false on gh-pages where the
      // modal is never reachable anyway).
      ...(getCapability().can_write_files ? { pickDirectory: pickDirectoryViaBackend } : {}),
      onStart: (values) => {
        if (!exportModal) return;
        exportModal.showProgress();
        void runExport(flameXmlAtOpen, values);
      },
      onCancel: () => {
        if (exportAbort) exportAbort.abort();
        // The runExport finally block calls modal.close() once the SSE
        // stream finishes; for an immediate dismiss when the user cancels
        // BEFORE Start, just close here.
        if (exportModal) {
          exportModal.close();
          exportModal = null;
        }
        exportAbort = null;
      },
      onClose: () => {
        if (exportModal) {
          exportModal.close();
          exportModal = null;
        }
        exportAbort = null;
      },
    });
  }

  // #227 — timeline export. Reuses the same backend route + SSE client; the
  // modal swaps begin/end/dtime/qs for fps + absolute quality (whole timeline).
  function openTimelineExportModal(): void {
    if (!timeline) return;
    stopPlayback();
    const tl = timeline;
    const durationSeconds = timelineDuration(tl);
    const exportOut: OutputSize = outputSize ?? { width: CANVAS_DEFAULT_W, height: CANVAS_DEFAULT_H };
    exportAbort = new AbortController();
    exportModal = openAnimateExportModal({
      host: root,
      mode: 'timeline',
      durationSeconds,
      outputSize: exportOut,
      defaults: { fps: 30, quality: 200, prefix: '' },
      estimate: (range) => estimateTimelineExport(tl, { ...range, outputSize: exportOut }),
      ...(getCapability().can_write_files ? { pickDirectory: pickDirectoryViaBackend } : {}),
      onStart: (values) => {
        if (!exportModal) return;
        exportModal.showProgress();
        void runTimelineExport(timelineToJson(tl), values);
      },
      onCancel: () => {
        if (exportAbort) exportAbort.abort();
        if (exportModal) { exportModal.close(); exportModal = null; }
        exportAbort = null;
      },
      onClose: () => {
        if (exportModal) { exportModal.close(); exportModal = null; }
        exportAbort = null;
      },
    });
  }

  async function runTimelineExport(
    timelineJson: string,
    values: { fps: number; quality: number; prefix: string; outDir: string; resume: boolean },
  ): Promise<void> {
    if (!exportAbort || !exportModal) return;
    const signal = exportAbort.signal;
    try {
      const outcome = await exportAnimate({
        params: {
          timelineJson,
          fps: values.fps,
          quality: values.quality,
          prefix: values.prefix,
          outDir: values.outDir,
          resume: values.resume,
          ...(outputSize ? { outWidth: outputSize.width, outHeight: outputSize.height } : {}),
        },
        onProgress: (info: ExportAnimateProgress) => {
          if (exportModal) {
            exportModal.setProgress({
              frame: info.frame, total: info.total, percent: info.percent,
              written: info.written, elapsedSeconds: info.elapsedSeconds, etaSeconds: info.etaSeconds,
              thumb: info.thumb,
            });
          }
        },
        abortSignal: signal,
      });
      if (exportModal) {
        if (outcome.status === 'completed') {
          exportModal.showResult(
            `Wrote ${outcome.written.length} PNG${outcome.written.length === 1 ? '' : 's'} to ${values.outDir}.`,
            'success',
          );
        } else {
          exportModal.showResult(
            `Cancelled — ${outcome.written.length} frame${outcome.written.length === 1 ? '' : 's'} written.`,
            'info',
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (exportModal) exportModal.showResult(`Export failed: ${msg}`, 'error');
    }
  }

  async function pickDirectoryViaBackend(): Promise<string | null> {
    const res = await fetch('/api/pick-dir', { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as { path?: string | null; error?: string };
    if (!res.ok) {
      throw new Error(body.error ?? `pick-dir failed: HTTP ${res.status}`);
    }
    if (body.error) throw new Error(body.error);
    return body.path ?? null;
  }

  async function runExport(
    flameXml: string,
    values: { begin: number; end: number; dtime: number; qs: number; prefix: string; outDir: string; resume: boolean },
  ): Promise<void> {
    if (!exportAbort || !exportModal) return;
    const signal = exportAbort.signal;
    try {
      const outcome = await exportAnimate({
        params: {
          flameXml,
          begin: values.begin,
          end: values.end,
          dtime: values.dtime,
          qs: values.qs,
          prefix: values.prefix,
          outDir: values.outDir,
          resume: values.resume,
          ...(outputSize ? { outWidth: outputSize.width, outHeight: outputSize.height } : {}),
          // #224 — carry the in-memory per-segment easing into the backend
          // export so the rendered sequence matches the scrubber preview.
          ...(animation?.segmentEasing ? { segmentEasing: animation.segmentEasing } : {}),
        },
        onProgress: (info: ExportAnimateProgress) => {
          if (exportModal) {
            exportModal.setProgress({
              frame: info.frame,
              total: info.total,
              percent: info.percent,
              written: info.written,
              elapsedSeconds: info.elapsedSeconds,
              etaSeconds: info.etaSeconds,
              thumb: info.thumb,
            });
          }
        },
        abortSignal: signal,
      });
      if (exportModal) {
        if (outcome.status === 'completed') {
          exportModal.showResult(
            `Wrote ${outcome.written.length} PNG${outcome.written.length === 1 ? '' : 's'} to ${values.outDir}.`,
            'success',
          );
        } else {
          exportModal.showResult(
            `Cancelled — ${outcome.written.length} frame${outcome.written.length === 1 ? '' : 's'} written.`,
            'info',
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (exportModal) exportModal.showResult(`Export failed: ${msg}`, 'error');
    }
  }

  // #276 — no-jump: mount the disabled section track + transport before any
  // source loads, so the bottom region is stable from first paint.
  mountEmptyScaffold();
  refreshExportButtonCapability();

  // #411 — restore a persisted working timeline so a page refresh picks up where
  // the user left off (timeline mode only; a loaded .flam3 animation is
  // transient and was never persisted). Fail-soft: a missing/corrupt payload
  // returns null and leaves the empty state in place.
  const restored = restoreTimeline();
  if (restored && restored.clips.length > 0) {
    timeline = restored;
    void enterSectionMode();
  }

  return {
    destroy(): void {
      stopPlayback();
      if (persistTimer !== undefined) { clearTimeout(persistTimer); persistTimer = undefined; }
      window.removeEventListener('keydown', onKey);
      if (exportAbort) exportAbort.abort();
      exportAbort = null;
      exportModal?.close();
      exportModal = null;
      playbackBar?.destroy();
      playbackBar = null;
      sectionTrack?.destroy();
      sectionTrack = null;
      sectionEditor?.destroy();
      sectionEditor = null;
      contextPanel?.destroy(); // #283
      contextPanel = null;
      renderer?.destroy();
      renderer = null;
      if (easingPanel) { easingPanel.remove(); easingPanel = null; }
      animation = null;
      timeline = null;
      timelinePreview = null;
      loadedFlameXml = null;
      root.replaceChildren();
    },
  };
}
