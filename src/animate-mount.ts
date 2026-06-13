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
import { type Animation } from './animation';
import { createRenderer, DEFAULT_FILTER_RADIUS, type Renderer } from './renderer';
import { renderAnimationFrame } from './animate-render';
import { DEFAULT_WALKER_JITTER } from './chaos';
import { getCapability } from './capability';
import { exportAnimate, type ExportAnimateProgress } from './animate-export';
import { openAnimateExportModal, type AnimateExportModalHandle } from './animate-export-modal';
import { estimateExport } from './animate-estimate';
import { buildEasingPanel } from './animate-easing-panel';
import { type EasingCurve } from './easing';
import { type Timeline, timelineDuration } from './timeline';
import { timelineFromJson } from './timeline-serialize';
import { renderTimelineFrame } from './animate-render';
import { mountTimelineTrack, type TimelineTrackHandle } from './timeline-track';
import { renderClipThumbnails } from './timeline-thumbnails';

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

// Hard cap on samples-per-pixel for browser-side animate playback. ESF flames
// authored for offline rendering carry `quality=2000` (single offline render
// budget); the browser WebGPU dispatch for that at 800×592 is ~940M samples,
// which saturates the GPU + freezes the system for many seconds (or hangs).
// The CLI / pyr3 serve path remains unrestricted (renders happen on Dawn-
// node, no display compositor contention). Cap is matched to the viewer's
// "Fast" preview tier so playback feels responsive even on weaker GPUs.
const PREVIEW_MAX_SPP = 16;

// Playback duration: how long an end-to-end scrub takes during auto-play.
// Tunable later via a speed selector; locked to a casual 4 s default for MVP.
const PLAYBACK_DURATION_MS = 4000;

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

export function mountAnimatePage(opts: MountAnimateOpts): AnimatePageHandle {
  const { root, device, format } = opts;
  root.replaceChildren();
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

  // Empty-state overlay: load instructions when no animation is loaded.
  const empty = document.createElement('div');
  Object.assign(empty.style, {
    position: 'absolute',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '14px',
    color: '#aaa',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '13px',
    textAlign: 'center',
    padding: '24px',
    pointerEvents: 'none',
  });
  const emptyHeader = document.createElement('div');
  emptyHeader.textContent = 'Animation surface';
  emptyHeader.style.fontSize = '15px';
  emptyHeader.style.color = '#ccc';
  const emptyLine = document.createElement('div');
  const emptyBefore = document.createTextNode('Drop a multi-keyframe ');
  const emptyCode = document.createElement('code');
  emptyCode.textContent = '.flam3';
  emptyCode.style.background = '#222';
  emptyCode.style.padding = '2px 6px';
  emptyCode.style.borderRadius = '3px';
  const emptyAfter = document.createTextNode(' file here');
  emptyLine.append(emptyBefore, emptyCode, emptyAfter);
  const emptyHint = document.createElement('div');
  emptyHint.textContent = 'or use the load button below';
  emptyHint.style.opacity = '0.7';
  empty.append(emptyHeader, emptyLine, emptyHint);
  // #227c — timeline docs are also loadable here.
  const emptyTimelineHint = document.createElement('div');
  emptyTimelineHint.textContent = '…or a .pyr3.timeline.json timeline';
  emptyTimelineHint.style.opacity = '0.7';
  empty.append(emptyTimelineHint);
  canvasZone.appendChild(empty);

  // Bottom controls strip: load button + playback bar (mounted into scrubHost
  // when an animation loads) + status text.
  const controls = document.createElement('div');
  Object.assign(controls.style, {
    flex: '0 0 auto',
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(0,0,0,0.4)',
    borderTop: '1px solid #2a2a2a',
  });
  root.appendChild(controls);

  const topRow = document.createElement('div');
  Object.assign(topRow.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 16px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    color: '#ccc',
  });
  controls.appendChild(topRow);

  const loadBtn = document.createElement('button');
  loadBtn.type = 'button';
  loadBtn.textContent = '📂 Load';
  loadBtn.title = 'Load a multi-keyframe .flam3 animation or a .pyr3.timeline.json timeline';
  Object.assign(loadBtn.style, {
    background: 'transparent',
    border: '1px solid #444',
    color: '#eee',
    cursor: 'pointer',
    padding: '4px 10px',
    borderRadius: '3px',
    fontSize: '12px',
  });
  topRow.appendChild(loadBtn);

  // P7 (#212) — Export sequence button. Capability-gated: enabled only when
  // `pyr3 serve` is hosting the page (can_render_animation === true). On
  // gh-pages the fetch returns the GHPAGES_DEFAULT capability where the flag
  // is false, so the button renders disabled+dim with the install tooltip.
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.setAttribute('data-export-sequence', '');
  exportBtn.textContent = '📤 Export sequence';
  Object.assign(exportBtn.style, {
    background: 'transparent',
    border: '1px solid #444',
    color: '#eee',
    cursor: 'pointer',
    padding: '4px 10px',
    borderRadius: '3px',
    fontSize: '12px',
  });
  topRow.appendChild(exportBtn);

  function refreshExportButtonCapability(): void {
    const canExport = getCapability().can_render_animation;
    // Loaded-but-no-export => disabled with capability tooltip
    // Loaded-and-can-export => enabled
    // Nothing-loaded => disabled (no tooltip override)
    const noAnimation = animation === null;
    if (!canExport) {
      exportBtn.disabled = true;
      exportBtn.style.opacity = '0.45';
      exportBtn.style.cursor = 'not-allowed';
      exportBtn.title =
        'Animation export needs filesystem access. Install pyr3 locally: '
        + '`npm install -g pyr3` then run `pyr3` — same UI, same flame, with export enabled.';
    } else if (noAnimation) {
      exportBtn.disabled = true;
      exportBtn.style.opacity = '0.45';
      exportBtn.style.cursor = 'not-allowed';
      exportBtn.title = 'Load a multi-keyframe .flam3 to enable export.';
    } else {
      exportBtn.disabled = false;
      exportBtn.style.opacity = '1';
      exportBtn.style.cursor = 'pointer';
      exportBtn.title = '';
    }
  }

  const status = document.createElement('span');
  status.textContent = 'no animation loaded';
  status.style.color = '#888';
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
    canvasZone.style.outline = '2px dashed #9cd';
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
    if (!animation || !loadedFlameXml) return;
    openExportModal();
  });

  // Runtime state.
  let animation: Animation | null = null;
  // #227c — timeline mode runs alongside animation mode. At most one of
  // `animation` / `timeline` is non-null at a time.
  let timeline: Timeline | null = null;
  let timelinePreview: Timeline | null = null;
  let track: TimelineTrackHandle | null = null;
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
  // #226 — throughput anchor for the up-front export ETA: this machine's
  // measured chaos samples/sec, smoothed (EMA) from the preview renders that
  // already run on load / scrub. null until the first preview frame times out.
  // The browser-GPU preview is a rough proxy for the backend Dawn-node export
  // path (same silicon, different driver), and the during-render ETA re-anchors
  // it per frame — so a cold approximation is fine.
  let previewSamplesPerSec: number | null = null;

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
    // #248 — playback advances over the REAL span (tMax - tMin) so the whole
    // animation plays once per PLAYBACK_DURATION_MS regardless of span. The old
    // `Math.max(1, …)` clamp made sub-unit spans both play too fast AND wrap
    // past tMax (→ pickKeyframes endpoint extrapolation + slider desync).
    const realSpan = tMax - tMin;
    const startedAt = performance.now();
    const startT = playbackBar?.getTime() ?? tMin;
    const tick = (now: number): void => {
      if ((!animation && !timeline) || !playbackBar) {
        stopPlayback();
        return;
      }
      const elapsed = (now - startedAt) / PLAYBACK_DURATION_MS;
      const t = wrapPlaybackTime(startT + elapsed * realSpan, tMin, tMax);
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
      const gpuStart = performance.now();
      let previewResult;
      if (timeline && timelinePreview) {
        previewResult = renderTimelineFrame(renderer, timelinePreview, t, {
          outputView: context.getCurrentTexture().createView(),
          walkerJitter: DEFAULT_WALKER_JITTER,
        });
      } else {
        const previewAnim: Animation = {
          ...animation!,
          ntemporal_samples: 1,
          keyframes: animation!.keyframes.map((g) => ({
            ...g,
            quality: g.quality !== undefined
              ? Math.min(g.quality, PREVIEW_MAX_SPP)
              : PREVIEW_MAX_SPP,
          })),
        };
        previewResult = renderAnimationFrame(renderer, previewAnim, t, {
          outputView: context.getCurrentTexture().createView(),
          walkerJitter: DEFAULT_WALKER_JITTER,
        });
      }
      await device.queue.onSubmittedWorkDone();
      // #226 — sample this machine's throughput from the preview render so the
      // export modal can show a real up-front ETA. EMA-smooth so the first
      // (pipeline-warmup-inflated) frame doesn't dominate.
      const gpuMs = performance.now() - gpuStart;
      if (gpuMs > 0 && previewResult.totalSamples > 0) {
        const sps = previewResult.totalSamples / (gpuMs / 1000);
        previewSamplesPerSec = previewSamplesPerSec === null
          ? sps
          : previewSamplesPerSec * 0.6 + sps * 0.4;
      }
      // #227c — keep the timeline track's playhead in sync with auto-play /
      // scrub (no-op in animation mode where track is null).
      track?.setPlayhead(t);
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
    // Use first keyframe's dims as the source of truth; cap to CANVAS_MAX_*.
    const firstKf = animation!.keyframes[0]!;
    const declW = firstKf.size?.width ?? CANVAS_DEFAULT_W;
    const declH = firstKf.size?.height ?? CANVAS_DEFAULT_H;
    const scaleW = declW > CANVAS_MAX_W ? CANVAS_MAX_W / declW : 1;
    const scaleH = declH > CANVAS_MAX_H ? CANVAS_MAX_H / declH : 1;
    const scale = Math.min(scaleW, scaleH);
    const width = Math.max(1, Math.round(declW * scale));
    const height = Math.max(1, Math.round(declH * scale));
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
    const declW = firstG.size?.width ?? CANVAS_DEFAULT_W;
    const declH = firstG.size?.height ?? CANVAS_DEFAULT_H;
    const scaleW = declW > CANVAS_MAX_W ? CANVAS_MAX_W / declW : 1;
    const scaleH = declH > CANVAS_MAX_H ? CANVAS_MAX_H / declH : 1;
    const scale = Math.min(scaleW, scaleH);
    const width = Math.max(1, Math.round(declW * scale));
    const height = Math.max(1, Math.round(declH * scale));
    canvas.width = width;
    canvas.height = height;
    context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) throw new Error('animate-mount: WebGPU canvas context unavailable');
    context.configure({ device, format, alphaMode: 'premultiplied' });
    const filterRadius = firstG.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;
    renderer?.destroy();
    renderer = createRenderer(device, format, { width, height, oversample: 1, filterRadius });
  }

  // #227c — enter timeline mode: parse the doc, build the renderer, mount the
  // NLE track + transport over [0, timelineDuration], render the first frame,
  // then fill in GPU thumbnails. Clears any prior animation-mode state.
  async function buildTimelineMode(file: File, text: string): Promise<void> {
    timeline = timelineFromJson(text);
    timelinePreview = previewTimeline(timeline);
    animation = null;
    loadedFlameXml = null;
    if (easingPanel) { easingPanel.remove(); easingPanel = null; }
    empty.style.display = 'none';
    buildTimelineRenderer();

    // Mount the NLE track + transport bar into scrubHost.
    track?.destroy();
    track = mountTimelineTrack(scrubHost, {
      timeline,
      // Keep the transport bar's slider + time readout in lockstep with a
      // track-playhead drag (playbackBar is assigned just below; the closure
      // reads it at interaction time).
      onSeek: (t) => { stopPlayback(); playbackBar?.setTime(t); void renderAtTime(t); },
    });
    playbackBar?.destroy();
    const dur = timelineDuration(timeline);
    playbackBar = mountPlaybackBar(scrubHost, {
      tMin: 0,
      tMax: dur,
      initialT: 0,
      onScrub: (t) => { stopPlayback(); void renderAtTime(t); },
      onPlayToggle: (isPlaying) => { if (isPlaying) startPlayback(); else stopPlayback(); },
    });

    refreshExportButtonCapability(); // timeline ⇒ animation===null ⇒ export stays disabled
    await renderAtTime(0);
    setStatus(`${file.name} — ${timeline.clips.length} clips, ${dur.toFixed(2)} s`);

    // Thumbnails after the first preview paints. Best-effort: a thumbnail
    // failure must not break load or playback.
    try {
      const thumbs = await renderClipThumbnails(device, format, timeline);
      thumbs.forEach((c, i) => track?.setThumbnail(i, c));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('pyr3: timeline thumbnails failed', err);
    }
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
    });
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
      track?.destroy();
      track = null;
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

  function openExportModal(): void {
    if (!animation || !loadedFlameXml) return;
    stopPlayback();
    const firstKfTime = animation.keyframes[0]!.time ?? 0;
    const lastKfTime = animation.keyframes[animation.keyframes.length - 1]!.time ?? 0;
    const begin = Math.floor(firstKfTime);
    const end = Math.max(begin, Math.floor(lastKfTime) - 1);
    const flameXmlAtOpen = loadedFlameXml;

    exportAbort = new AbortController();
    exportModal = openAnimateExportModal({
      host: root,
      defaults: { begin, end, dtime: 1, qs: 1.0, prefix: '' },
      // #226 — live up-front ETA, recomputed as the user edits begin/end/dtime/qs.
      // Closes over the loaded animation + this machine's measured throughput.
      estimate: (range) =>
        animation
          ? estimateExport(animation, range, previewSamplesPerSec)
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
    values: { begin: number; end: number; dtime: number; qs: number; prefix: string; outDir: string },
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

  refreshExportButtonCapability();

  return {
    destroy(): void {
      stopPlayback();
      if (exportAbort) exportAbort.abort();
      exportAbort = null;
      exportModal?.close();
      exportModal = null;
      playbackBar?.destroy();
      playbackBar = null;
      track?.destroy();
      track = null;
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
