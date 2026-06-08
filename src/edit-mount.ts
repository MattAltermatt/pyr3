// pyr3 — /v1/edit page mount.
//
// Owns WebGPU canvas wiring, creates EditState, wires the lane scheduler to
// the EditRenderer, and composes section modules into the left panel via
// mountEditUi. The renderer's histogram lives across edits — fast-lane edits
// re-present without touching it; slow-lane edits reset + re-iterate.
//
// Top-bar action callbacks: 🎲 reroll / 📂 open / 💾 save wired here in Task 4.1;
// 🖼️ render PNG wired in Task 4.2 (resizes editor canvas to configured dims,
// renders at full quality, toBlobs + downloads, restores preview dims).

import {
  createEditState,
  createLaneScheduler,
  pathLane,
  resolveColdStartCollapse,
  resolveColdStartGenomeWithSource,
  schedulePersist,
  type EditState,
  type LaneScheduler,
} from './edit-state';
import { generateRandomGenome } from './edit-seed';
import { createRenderer, type Renderer, DEFAULT_FILTER_RADIUS } from './renderer';
import { createEditRenderer, type EditRenderer } from './edit-render';
import { mountEditUi, type SectionMount, type EditUiHandle } from './edit-ui';
import {
  type PreviewRenderConfig,
  computePreviewDims,
  loadPreviewConfig,
  savePreviewConfig,
} from './render-mode-config';
import { mountRenderModeBar, type RenderModeBarHandle } from './render-mode-bar';
import { openRenderProgressModal } from './render-progress-modal';
import { parsePreviewOverride } from './load-intent';
import { genomeToJson, genomeFromJson } from './serialize';
import { injectPngTextChunk } from './png-text-chunk';
import { type Genome } from './genome';
import { attachPanZoom, type PanZoomHandle } from './edit-canvas-nav';
import { createSlowRenderNudge, type SlowRenderNudgeHandle } from './edit-slow-render-nudge';
import { setCurrentFlame } from './app-state';
import { createHistory, type History } from './edit-history';
import { hasTemplate, resolveTemplate } from './flame-name-template';
import { peekIndex, bumpIndex } from './flame-name-counter';

export interface MountEditPageOpts {
  /** Root container the editor takes over (replaceChildren). The caller
   *  sizes the root (typically fill the viewport body). */
  root: HTMLElement;
  /** Pre-acquired WebGPU device. The caller (main.ts) already runs
   *  checkWebGPU + initDevice; we accept the device rather than re-acquiring
   *  it so the editor stays composable in any host. */
  device: GPUDevice;
  /** Canvas format. Same value passed to createRenderer. */
  format: GPUTextureFormat;
  /** Section modules to compose into the left panel. Empty list = shell only
   *  (useful while sections are being written in later tasks). */
  sections: SectionMount[];
  /** Preview size for the editor's canvas. Defaults to 512×512. */
  previewSize?: { width: number; height: number };
  /** Author nick to seed into any fresh genome (random seed / reroll). Read
   *  by the host from localStorage so the user's nick persists across
   *  sessions. Files opened with their own nick keep that nick — defaultNick
   *  only fills in when genome.nick is undefined. */
  defaultNick?: string;
  /** #119 — caller-supplied initial genome. When present, overrides the
   *  normal cold-start chain (pending / wip / reroll) — the editor mounts
   *  this genome verbatim. The catalog page uses this to hand off a
   *  sierpinski + variation built from URL params; treated as a non-reroll
   *  source so the user's stored defaultNick is NOT stamped over the
   *  catalog identity. */
  initialGenome?: Genome;
  /** Fires on init + after every genome change (lane fire / reroll / open) so
   *  the host can sync external chrome (e.g. /v1/edit's top bar) with the
   *  current name + dimensions. */
  onStateChange?: (state: EditState) => void;
  /** Fires when a render is in flight — host typically wires this to the
   *  edit bar's tier3 progress panel (same one the viewer uses). label is a
   *  pre-formatted readable string like "rendering 1920×1080 · q50". */
  onProgressShow?: (label: string) => void;
  /** Fires when the in-flight render completes. */
  onProgressHide?: () => void;
  /** Fires when the panel's `settle` scrubby changes the settle-delay value,
   *  so the host can echo it onto the editor bar's SETTLE button highlight.
   *  NOT fired when setSettleDelayMs is called externally (the host already
   *  knows about that change). */
  onSettleDelayChange?: (ms: number) => void;
  /** #108 — fires after every history mutation (push, undo, redo, reset) so
   *  the host can refresh the bar's ⟲ ⟳ button enabled state. */
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
}

export interface EditPageHandle {
  destroy(): void;
  /** Test/inspection hook — exposes the live EditState so a host can grab
   *  the current genome. */
  readonly state: EditState;
  /** #104 — resolve a template string against the editor's live state
   *  (genome / seed / counter peek) and return the slugified filename
   *  preview. Returns `null` when the input has no `{placeholder}`. The
   *  bar wires this to its `computePreview` so the `→ ...` tail next to
   *  the name input ticks live. */
  computeFilenamePreview(template: string): string | null;
  /** #108 — step the editor back one history entry. No-op when the stack
   *  pointer is at the oldest entry. */
  undo(): void;
  /** #108 — step forward one history entry. No-op at the tip. */
  redo(): void;
  /** #108 — true when there's a prior history entry to undo into. */
  canUndo(): boolean;
  /** #108 — true when there's a future history entry to redo into. */
  canRedo(): boolean;
  /** Programmatic state mutators — let a host wire the top bar's editable
   *  flame name / nick back into the editor state. */
  setName(name: string): void;
  setNick(nick: string): void;
  /** #103 Phase 6 Task 6.2 — top-bar action callbacks. The editor's chrome
   *  action row mirrors the viewer's pattern (📂 Open · 🎲 Reroll · 📐 Size ▾ ·
   *  QUALITY · 🧬 Save Flame · 💾 Save Render); these methods give the host
   *  (main.ts) a way to invoke the editor's existing state mutators
   *  (handleReroll / handleOpenFile / handleSaveFile / handleRenderPng) and
   *  the size/quality mutators that previously only the in-panel Render
   *  section could drive. */
  reroll(): void;
  openFile(): void;
  saveFlame(): void;
  saveRender(): Promise<void>;
  setSize(width: number, height: number): void;
  setQuality(quality: number): void;
  /** Top-bar SETTLE ladder writes here. Updates the live settleDelayMs +
   *  syncs the panel's `settle` scrubby. Does NOT fire onSettleDelayChange
   *  (the host invoked this mutator and already knows the new value). */
  setSettleDelayMs(ms: number): void;
}

const DEFAULT_PREVIEW = { width: 512, height: 512 };

export function mountEditPage(opts: MountEditPageOpts): EditPageHandle {
  const preview = opts.previewSize ?? DEFAULT_PREVIEW;

  // Build root layout: panel left, canvas right. Render-in-flight signal is
  // the page-level bar's tier3 progress panel (same one the viewer uses);
  // wired below via `opts.onProgressShow` / `onProgressHide` callbacks.
  opts.root.replaceChildren();
  opts.root.classList.add('pyr3-edit-root');
  // #176 — render-mode-bar mounts at the TOP of opts.root spanning the
  // full editor width. The panelHost + canvasHost row sits below it. This
  // gives the bar a guaranteed position above all the editor's working area
  // (the prior approach of mounting inside canvasHost competed with the
  // canvas's pixel-driven CSS-size and produced a mid-canvas overlay).
  const renderModeBarHost = document.createElement('div');
  renderModeBarHost.className = 'pyr3-edit-render-mode-bar-host';
  document.body.classList.add('pyr3-has-render-mode-bar');
  const editBody = document.createElement('div');
  editBody.className = 'pyr3-edit-body';
  const panelHost = document.createElement('div');
  const canvasHost = document.createElement('div');
  canvasHost.className = 'pyr3-edit-canvas-host';
  // #118 — slow-render nudge needs an absolutely-positioned parent.
  canvasHost.style.position = 'relative';
  const canvas = document.createElement('canvas');
  canvas.width = preview.width;
  canvas.height = preview.height;
  canvasHost.appendChild(canvas);
  editBody.append(panelHost, canvasHost);
  opts.root.append(renderModeBarHost, editBody);

  // WebGPU context on the editor canvas. Assigned to a non-null local so
  // closures (lane scheduler, applyNewGenome) can read it without re-narrowing.
  const ctxOrNull = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!ctxOrNull) {
    throw new Error('pyr3-edit: getContext("webgpu") returned null');
  }
  const ctx: GPUCanvasContext = ctxOrNull;
  ctx.configure({ device: opts.device, format: opts.format, alphaMode: 'opaque' });

  // Stamp the user's stored defaultNick onto a freshly-rerolled genome only.
  // 2026-06-05 policy: opens (file / viewer→editor transfer) PRESERVE the
  // original nick (or leave blank when truly absent) — never inject the
  // user's stored value. The viewer side now also extracts ESF chain-nick
  // into genome.nick, so transferred ESF flames arrive with their lineage
  // authorship intact and this stamp wouldn't fire anyway.
  function applyDefaultNick(genome: Genome): void {
    if (genome.nick === undefined && opts.defaultNick) {
      genome.nick = opts.defaultNick;
    }
  }

  // Apply editor defaults to fields the user hasn't set yet. Files opened
  // with their own values keep them.
  function applyEditorDefaults(genome: Genome): void {
    if (genome.size === undefined) genome.size = { width: 1920, height: 1080 };
    if (genome.quality === undefined) genome.quality = 50;
  }

  // Initial genome + state.
  // #103 Phase 6 Task 6.5 — cold-start hydration. Three possible sources:
  //   pending — viewer→editor transfer (user's explicit handoff)
  //   wip     — restored from localStorage of a prior editor session
  //   reroll  — fresh random when neither of the above is present
  // The defaultNick stamp only fires on `reroll` so opens preserve the
  // original author (or stay blank). applyEditorDefaults is harmless on
  // all three paths (fills only undefined size/quality).
  //
  // #119 — caller-supplied initialGenome (catalog handoff) wins over all
  // three normal sources. Treated like a pending transfer for nick
  // semantics: don't stamp defaultNick, keep what the catalog provided.
  const initial = opts.initialGenome
    ? { genome: opts.initialGenome, source: 'pending' as const }
    : resolveColdStartGenomeWithSource(() => generateRandomGenome());
  const initialGenome = initial.genome;
  if (initial.source === 'reroll') applyDefaultNick(initialGenome);
  applyEditorDefaults(initialGenome);
  const initialSeed = (Math.random() * 0xffffffff) >>> 0;
  const state = createEditState(initialGenome, initialSeed);

  // #108 — undo/redo stack, seeded with the cold-start genome. push happens
  // on every commit gesture (onPathChange), debounced via the same window
  // as the settle timer so a slider drag is one entry, not sixty. reset on
  // file-open + reroll (whole-genome replacement, not an edit). undo/redo
  // restore via the no-history-reset branch of applyNewGenome.
  const history: History = createHistory(initialGenome);
  function notifyHistoryChange(): void {
    opts.onHistoryChange?.(history.canUndo(), history.canRedo());
  }
  // Hydrate the section-collapse map from localStorage too — falls back to
  // the all-collapsed default (#102 preserved) when nothing is persisted or
  // the stored JSON is malformed.
  state.sectionCollapse = resolveColdStartCollapse();
  state.preview = preview;
  // #103 Phase 2 Task 2.3 — editor writes the cross-surface currentFlame
  // context so an editor→viewer tab click can carry the WIP genome over.
  // corpusId is omitted: the editor doesn't track its load source today
  // (a future enhancement could preserve corpusId across the open/load
  // path; this initial seam writes bare {genome} per the design spec).
  setCurrentFlame({ genome: initialGenome });

  // #176 — preview render config. Workstation pref (per-browser localStorage),
  // not part of the flame artifact. Drives the editor's live preview canvas
  // dims (via tier) + iteration density (via quality, in applyLane opts).
  // genome.size + genome.quality stay as the RENDER output config — only fire
  // at Save Render time.
  let previewCfg: PreviewRenderConfig = loadPreviewConfig();
  // #176 — URL params (?preview / ?previewQ / ?quick=1) override the
  // persisted config for this session only. NOT written back to
  // localStorage so a refresh without the param falls back to the user's
  // persisted choice.
  {
    const override = parsePreviewOverride(typeof window !== 'undefined' ? window.location.search : '');
    if (override?.tier) previewCfg = { ...previewCfg, tier: override.tier };
    if (override?.quality !== undefined) previewCfg = { ...previewCfg, quality: override.quality };
  }

  // Resolve preview canvas dims from PreviewRenderConfig + render-side aspect.
  // The render-side genome.size is authoritative for ASPECT RATIO; the preview
  // tier (Fast/Balanced/Sharp) picks the longest-edge cap. WYSIWYG: preview
  // is just a downscaled-fidelity version of what Save Render will produce.
  // Oversample is capped at 1 for the live preview (oversample > 1 at full
  // preset dims often blows past WebGPU storage-buffer limits; the
  // 🖼️ render-PNG path uses the genome's actual oversample at save time).
  function effectiveDims(): { width: number; height: number; oversample: number; filterRadius: number } {
    const size = state.genome.size;
    const renderW = (size?.width ?? 0) > 0 ? size!.width : preview.width;
    const renderH = (size?.height ?? 0) > 0 ? size!.height : preview.height;
    const dims = computePreviewDims(previewCfg.tier, { width: renderW, height: renderH });
    return {
      width: dims.width,
      height: dims.height,
      oversample: 1,
      filterRadius: state.genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS,
    };
  }

  // Renderer + wrapper, sized to whatever the genome currently asks for.
  const initialDims = effectiveDims();
  canvas.width = initialDims.width;
  canvas.height = initialDims.height;
  const renderer: Renderer = createRenderer(opts.device, opts.format, initialDims);
  // editRenderer's own resize callback is intentionally omitted — the lane
  // scheduler below handles resize externally so we can grab the swapchain
  // texture view AFTER the canvas dimensions change (the view is bound to
  // the texture at the time getCurrentTexture() is called; grabbing it
  // before a resize writes into the OLD texture).
  const editRenderer: EditRenderer = createEditRenderer(renderer, {
    // #116 — hold-to-preview-off button (👁) in the Color Curves section
    // sets `state.colorCurvesPreviewOff`; the renderer strips channelCurves
    // for that frame so the user sees the un-graded "before" image.
    getPreviewOff: () => !!state.colorCurvesPreviewOff,
  });

  // Apophysis-style live/settled split. While the user is actively editing
  // (slider drag, keystrokes, rapid clicks) we render at a downsized "live"
  // canvas so feedback is snappy. After SETTLE_DELAY_MS of quiet, a single
  // full-dims render replaces it. Fast-lane edits (tonemap/density) stay on
  // whatever canvas is currently mounted.
  const LIVE_MAX_LONG_EDGE = 384;
  // Quiet time after the user's last edit before the full-dim/quality render
  // kicks off. 150ms is on the snappy end of typical editor norms (Lightroom
  // / Affinity sit around 200-300ms, Photoshop preview around 100ms).
  // Quiet time after the last edit before the full-quality render fires.
  // Exposed in the top-bar as a settable input — see EditUiCallbacks.
  // Default 200 ms — longer than the original 150 because on single clicks
  // the live frame needs time to be VISIBLE before the settled render
  // resizes the canvas to full dims and starts encoding (the resize blanks
  // the canvas briefly). With 200 ms, single clicks reliably show their
  // live frame; user can tune lower for a snappier settled, higher for a
  // longer-lived live preview.
  let settleDelayMs = 500;
  const BAR_DELAY_MS = 500;

  function liveDimsFor(full: { width: number; height: number }): { width: number; height: number } {
    const longEdge = Math.max(full.width, full.height);
    if (longEdge <= LIVE_MAX_LONG_EDGE) return { width: full.width, height: full.height };
    const ratio = LIVE_MAX_LONG_EDGE / longEdge;
    return {
      width: Math.max(1, Math.round(full.width * ratio)),
      height: Math.max(1, Math.round(full.height * ratio)),
    };
  }

  let isLive = false;
  function ensureLiveDims(): boolean {
    const full = effectiveDims();
    const live = liveDimsFor(full);
    if (live.width === canvas.width && live.height === canvas.height) {
      isLive = full.width !== canvas.width || full.height !== canvas.height;
      return false; // no resize needed
    }
    canvas.width = live.width;
    canvas.height = live.height;
    renderer.resize({
      width: live.width, height: live.height,
      oversample: 1, filterRadius: full.filterRadius,
    });
    isLive = true;
    return true;
  }

  /** Return a copy of the live genome with scale divided proportionally so the
   *  flame fills the same fraction of the canvas in live mode as in settled
   *  mode. `genome.scale` is pixels-per-world-unit, so dropping canvas width
   *  from 1920→384 without also dropping scale by 5× would make the flame
   *  visually 5× bigger (overflow). filter radius is also in output px so it
   *  benefits from the same proportional drop. */
  function liveAdjustedGenome(): Genome {
    const full = effectiveDims();
    const live = liveDimsFor(full);
    if (live.width === full.width) return state.genome; // no shrink needed
    const ratio = full.width / live.width;
    const adjusted: Genome = { ...state.genome, scale: state.genome.scale / ratio };
    if (state.genome.spatialFilter) {
      adjusted.spatialFilter = {
        ...state.genome.spatialFilter,
        radius: state.genome.spatialFilter.radius / ratio,
      };
    }
    return adjusted;
  }

  function ensureSettledDims(): boolean {
    const d = effectiveDims();
    if (d.width === canvas.width && d.height === canvas.height && !isLive) return false;
    canvas.width = d.width;
    canvas.height = d.height;
    renderer.resize({
      width: d.width, height: d.height,
      oversample: d.oversample, filterRadius: d.filterRadius,
    });
    isLive = false;
    return true;
  }

  // Progress-bar gating: only appears for renders that actually take >500ms.
  // setTimeout schedules the show; render completion cancels it. Quick
  // renders never trigger the bar — no flicker on fast tweaks.
  let inflightTicket = 0;
  let barShowTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleBarShow(label: string): void {
    if (barShowTimer !== null) clearTimeout(barShowTimer);
    barShowTimer = setTimeout(() => {
      barShowTimer = null;
      opts.onProgressShow?.(label);
    }, BAR_DELAY_MS);
  }
  function cancelBarShowAndHide(): void {
    if (barShowTimer !== null) {
      clearTimeout(barShowTimer);
      barShowTimer = null;
    }
    opts.onProgressHide?.();
  }
  async function awaitGpuThenMaybeHide(myTicket: number): Promise<void> {
    await opts.device.queue.onSubmittedWorkDone();
    if (inflightTicket === myTicket) cancelBarShowAndHide();
  }

  // Settle timer — fires SETTLE_DELAY_MS after the last slow/rebuild edit
  // with a full-dims render. Cleared on every new edit.
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSettle(): void {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      void runSettledRender();
    }, settleDelayMs);
  }
  async function runSettledRender(): Promise<void> {
    inflightTicket++;
    const myTicket = inflightTicket;
    ensureSettledDims();
    const d = effectiveDims();
    // #176 — live preview iterates at previewCfg.quality (10..50), NOT
    // genome.quality (which is now render-side output quality, 50..500).
    const spp = previewCfg.quality;
    scheduleBarShow(`rendering ${d.width}×${d.height} · q${spp}`);
    const view = ctx.getCurrentTexture().createView();
    editRenderer.applyLane('slow', state.genome, state.seed, view, d.width, d.height, { targetSpp: spp });
    opts.onStateChange?.(state);
    // #118 — measure settle-render wall-clock so the slow-render nudge
    // can detect a pattern of slow renders during active editing.
    const renderStart = performance.now();
    await awaitGpuThenMaybeHide(myTicket);
    nudge?.recordRender(performance.now() - renderStart);
  }

  // Lane scheduler. Slow + rebuild lanes now render at LIVE dims (fast). The
  // settle timer (separate) handles the full-quality render at full dims.
  const scheduler: LaneScheduler = createLaneScheduler(async (lane, _paths) => {
    inflightTicket++;
    const myTicket = inflightTicket;
    if (lane === 'slow' || lane === 'rebuild') {
      ensureLiveDims();
    }
    const view = ctx.getCurrentTexture().createView();
    const w = canvas.width;
    const h = canvas.height;
    // Slow + rebuild both reseed at current (live) dims with a scale-adjusted
    // genome so the framing matches what the settled render will show.
    // Fast lane re-presents the existing histogram, no scale adjustment.
    const genome = (lane === 'slow' || lane === 'rebuild') ? liveAdjustedGenome() : state.genome;
    editRenderer.applyLane(lane === 'rebuild' ? 'slow' : lane, genome, state.seed, view, w, h, { targetSpp: previewCfg.quality });
    opts.onStateChange?.(state);
    await awaitGpuThenMaybeHide(myTicket);
  });

  // Common path-change handler — used by both UI sections and the canvas
  // pan/zoom listener. SLOW + REBUILD lanes bypass the lane scheduler
  // entirely and go through requestLiveRender (the same continuous-render
  // loop pan/zoom uses), so every edit — number-input scrub, slider drag,
  // spinner click, preset apply, picker preview — gets immediate live
  // feedback instead of waiting 80ms for the scheduler debounce to flush.
  // requestLiveRender is self-throttling: max one render in flight, edits
  // during a render set the dirty bit and chain another after the GPU
  // finishes. The settle timer still fires 150ms after the last edit and
  // drives the full-quality render at settled dims.
  //
  // FAST lane (tonemap / density / background) stays on the scheduler —
  // it's present-only against the existing histogram, so the 16ms debounce
  // is the right batching cadence and there's no heavy re-iterate to
  // bypass.
  // #108 — debounce a single history.push to fire HISTORY_DEBOUNCE_MS after
  // the user's last edit, so a slider drag (60 onPathChange calls/sec)
  // commits one entry. Name/nick + bar settings (size/quality/SETTLE) skip
  // this — they don't route through onPathChange in a way that's part of
  // the visual-edit gesture history (name/nick are metadata; size/quality
  // are render preferences, not genome shape).
  const HISTORY_DEBOUNCE_MS = 250;
  let historyCommitTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleHistoryCommit(): void {
    if (historyCommitTimer !== null) clearTimeout(historyCommitTimer);
    historyCommitTimer = setTimeout(() => {
      historyCommitTimer = null;
      history.push(state.genome);
      notifyHistoryChange();
    }, HISTORY_DEBOUNCE_MS);
  }

  // #118 — slow-render nudge handle. Created once at mount and torn
  // down with destroy() below. Hosts in the canvas wrapper so it sits
  // over the render canvas, not the side panel.
  const nudge: SlowRenderNudgeHandle = createSlowRenderNudge({
    host: canvasHost,
    getQuality: () => state.genome.quality ?? 50,
    setQuality: (q) => {
      state.genome.quality = q;
      onPathChange('quality');
      // The bar's QUALITY ladder re-reads from state.genome via
      // onStateChange (already called inside onPathChange's downstream
      // render path), so no separate echo is needed here.
    },
  });

  function onPathChange(path: string): void {
    // #118 — record this as user-edit activity for the slow-render nudge
    // (pan/zoom does NOT route through onPathChange and so does NOT
    // count as "actively editing").
    nudge.recordEdit();
    // #103 Phase 6 Task 6.3 — persist the WIP genome to localStorage on every
    // edit. Debounced inside schedulePersist so a slider drag doesn't burn
    // a setItem call per frame; cold-start (below) reads the result back via
    // restoreWip().
    schedulePersist(state.genome);
    // #108 — only genome-shape edits land in the undo stack. Bar-driven
    // render preferences (canvas size, render quality) flow through
    // onPathChange to trigger a settle, but undo unwinds *visual edits*,
    // not "what dimensions am I previewing at." name + nick bypass
    // onPathChange entirely via their dedicated mutators.
    if (path !== 'quality' && !path.startsWith('size.')) {
      scheduleHistoryCommit();
    }
    const lane = pathLane(path);
    if (lane === 'slow' || lane === 'rebuild') {
      void requestLiveRender();
      scheduleSettle();
    } else {
      scheduler.schedule({ lane, path });
    }
  }

  // Replace the whole panel + force a slow-lane reseed. Used by reroll + open.
  let ui: EditUiHandle;
  function rebuildPanel(): void {
    ui?.destroy();
    ui = mountEditUi(panelHost, state, opts.sections, {
      onChange: onPathChange,
      onReroll: handleReroll,
      onOpenFile: handleOpenFile,
      onSaveFile: handleSaveFile,
      onRenderPng: handleRenderPng,
      settleDelayMs,
      onSettleDelayChange: (ms) => {
        settleDelayMs = ms;
        // Echo to the host so the editor bar's SETTLE ladder highlight
        // can re-sync when the user types an off-ladder value in the panel.
        opts.onSettleDelayChange?.(ms);
      },
    });
  }

  // Live render loop for continuous interactions (pan / zoom). The lane
  // scheduler debounces by 80ms — fine for keystrokes (natural pauses), but
  // a continuous mouse drag fires every 16ms and would reset the debounce
  // indefinitely, so the user sees no live feedback until they let go. The
  // loop below renders one frame at a time (max one in-flight) and chains
  // the next one only after the GPU finishes — so pan/zoom feels smooth at
  // whatever fps the GPU can sustain for live dims.
  let liveInFlight = false;
  let liveDirty = false;
  async function requestLiveRender(): Promise<void> {
    if (liveInFlight) {
      liveDirty = true; // mark for re-render after current frame finishes
      return;
    }
    liveInFlight = true;
    do {
      liveDirty = false;
      inflightTicket++;
      ensureLiveDims();
      const view = ctx.getCurrentTexture().createView();
      const w = canvas.width;
      const h = canvas.height;
      const genome = liveAdjustedGenome();
      editRenderer.applyLane('slow', genome, state.seed, view, w, h, { targetSpp: previewCfg.quality });
      opts.onStateChange?.(state);
      await opts.device.queue.onSubmittedWorkDone();
      // Yield to the browser's paint pipeline BEFORE starting the next
      // render. Without this, a fast click stream chains GPU renders so
      // tightly that each one overwrites the swapchain texture before the
      // browser ever composites it — user sees no updates until the loop
      // exits and the final frame paints. The rAF wait gives the
      // compositor a slot per render, so each click produces a visible
      // frame.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    } while (liveDirty);
    liveInFlight = false;
  }

  // Canvas pan + zoom — left-drag = cx/cy, wheel = scale. The viewport-
  // section inputs sync via the 'pyr3:viewport-changed' event below so the
  // displayed cx/cy/scale stay current as the user drags. Live render fires
  // continuously while the user interacts; the settle timer kicks the final
  // full-quality render 150ms after the last input.
  const panZoom: PanZoomHandle = attachPanZoom(canvas, state, {
    onViewportChange: () => {
      // Notify any DOM listeners (the viewport section's inputs) that the
      // viewport mutated externally so they can re-sync their .value. The
      // viewport section listens at document level + self-removes when its
      // host detaches (next rebuildPanel) so this stays leak-free.
      document.dispatchEvent(new CustomEvent('pyr3:viewport-changed'));
      void requestLiveRender();
      scheduleSettle();
    },
  });

  async function applyNewGenome(
    genome: Genome,
    seed?: number,
    historyAction: 'reset' | 'preserve' = 'reset',
  ): Promise<void> {
    state.genome = genome;
    // #103 Phase 2 Task 2.3 — re-publish the editor's WIP genome whenever
    // a fresh genome lands (reroll / open file). In-place mutations of
    // existing fields don't need a re-publish: app-state stores the
    // reference and observers re-read on tab click.
    setCurrentFlame({ genome });
    // #103 Phase 6 Task 6.3 — reroll / open replaces the whole genome; persist
    // the new one so a reload doesn't drop back to the prior WIP. Debounced
    // alongside any inline edits the user does next.
    schedulePersist(genome);
    if (seed !== undefined) state.seed = seed;
    // #108 — reroll + file open wipe history (whole-genome replacement, not
    // an edit). Undo/redo themselves call this with 'preserve' since the
    // pointer move IS the history operation.
    if (historyAction === 'reset') {
      // Cancel any pending edit-commit timer so a debounce in flight when
      // the user hits Reroll doesn't fire AFTER the reset and add a stale
      // entry.
      if (historyCommitTimer !== null) {
        clearTimeout(historyCommitTimer);
        historyCommitTimer = null;
      }
      history.reset(genome);
      notifyHistoryChange();
    }
    rebuildPanel();
    inflightTicket++;
    const myTicket = inflightTicket;
    // Open / reroll always renders at SETTLED dims with the bar gated by
    // BAR_DELAY_MS — these are "intentional, full" renders, not drags.
    ensureSettledDims();
    const d = effectiveDims();
    // #176 — settled preview uses preview-side quality.
    const spp = previewCfg.quality;
    scheduleBarShow(`rendering ${d.width}×${d.height} · q${spp}`);
    const view = ctx.getCurrentTexture().createView();
    editRenderer.applyLane('slow', state.genome, state.seed, view, d.width, d.height, { targetSpp: spp });
    opts.onStateChange?.(state);
    await awaitGpuThenMaybeHide(myTicket);
  }

  function handleReroll(): void {
    const fresh = generateRandomGenome();
    applyDefaultNick(fresh);
    applyEditorDefaults(fresh);
    const freshSeed = (Math.random() * 0xffffffff) >>> 0;
    applyNewGenome(fresh, freshSeed);
  }

  function handleOpenFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pyr3.json,.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const genome = genomeFromJson(parsed);
        // Open-file PRESERVES the file's nick (or leaves blank when absent).
        // Only the Reroll path stamps defaultNick (matches the cold-start
        // policy above).
        applyEditorDefaults(genome);
        applyNewGenome(genome);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`pyr3-edit: open failed — ${msg}`);
        showToast(panelHost, `Open failed: ${msg}`);
      } finally {
        input.remove();
      }
    });
    document.body.appendChild(input);
    input.click();
  }

  // #104 — resolve `state.genome.name` against live state if it contains a
  // {placeholder}. Returns the slugified filename (no extension); falls back
  // to slugify(state.genome.name) when the name is a plain literal. The
  // genome.name field itself stays untouched (we want re-opens to show the
  // editable template, not a frozen resolved string).
  function resolveCurrentFilename(): string {
    const template = state.genome.name;
    if (!hasTemplate(template)) return slugify(template);
    const resolved = resolveTemplate(template, {
      genome: state.genome,
      seed: state.seed,
      now: new Date(),
      index: peekIndex(template),
      random: Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0'),
    });
    return slugify(resolved);
  }

  // #104 — preview helper for the bar. Returns the slugified resolved name
  // (no extension) when the user's input contains a template; null when
  // it's a plain literal so the bar can hide the `→ ...` tail.
  function computeFilenamePreview(template: string): string | null {
    if (!hasTemplate(template)) return null;
    const resolved = resolveTemplate(template, {
      genome: state.genome,
      seed: state.seed,
      now: new Date(),
      index: peekIndex(template),
      random: Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0'),
    });
    return slugify(resolved);
  }

  // #176 — gates the Save Render button + lane-conflict assertions in tests.
  let renderInFlight = false;

  async function handleRenderPng(): Promise<void> {
    if (renderInFlight) return;
    renderInFlight = true;
    const targetW = state.genome.size?.width ?? 1024;
    const targetH = state.genome.size?.height ?? 1024;
    const oversample = state.genome.oversample ?? 1;
    const filterRadius = state.genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;

    // Snapshot pre-call canvas dims. Restoring to these — instead of
    // forcing preview.width × preview.height (~384px) — keeps the editor
    // canvas at the same size the user was looking at before clicking
    // render-PNG, avoiding the "everything turned sparse / pixelated"
    // after-effect (#106). The settled-render path uses effectiveDims()
    // on each lane fire so it'll re-render at the right quality next edit.
    const restoreDims = effectiveDims();

    // #176 — progress modal mounts BEFORE the render dispatch. One rAF yield
    // guarantees the modal's first paint lands before the GPU saturates with
    // the render dispatch (otherwise the modal "doesn't appear" until the
    // render finishes — exactly the bad UX this issue called out).
    panelHost.setAttribute('data-busy', 'true');
    const sizeLabel = `${targetW}×${targetH}`;
    const qualityLabel = String(state.genome.quality ?? 100);
    const abortCtrl = new AbortController();
    const modal = openRenderProgressModal({
      host: opts.root,
      sizeLabel,
      qualityLabel,
      onCancel: () => abortCtrl.abort(),
    });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    let cancelled = false;
    try {
      canvas.width = targetW;
      canvas.height = targetH;
      renderer.resize({ width: targetW, height: targetH, oversample, filterRadius });
      const view = ctx.getCurrentTexture().createView();
      await editRenderer.fullRenderAt(state.genome, state.seed, targetW, targetH, view, {
        signal: abortCtrl.signal,
        onProgress: (frac) => modal.setProgress(frac),
        // #176 — fresh swap-chain view at present time (the chunked path's
        // setTimeout(0) yields expire the view captured before iteration).
        outputViewProvider: () => ctx.getCurrentTexture().createView(),
      });

      const filename = resolveCurrentFilename();
      const template = state.genome.name;
      await new Promise<void>((resolve, reject) => {
        canvas.toBlob(async (blob) => {
          if (!blob) {
            reject(new Error('toBlob returned null — canvas was not snapshottable'));
            return;
          }
          // #123 — embed the source genome as a `pyr3`-keyed tEXt chunk so
          // the saved PNG is self-describing and round-trips via a future
          // PNG-import reader.
          let finalBlob: Blob = blob;
          try {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const pyr3Json = JSON.stringify(genomeToJson(state.genome));
            const withMetadata = injectPngTextChunk(bytes, 'pyr3', pyr3Json);
            // Cast to BlobPart: TS strict-mode types Uint8Array<ArrayBufferLike>
            // (the runtime union includes SharedArrayBuffer) which Blob's
            // constructor signature rejects. At runtime the array is always
            // ArrayBuffer-backed.
            finalBlob = new Blob([withMetadata as BlobPart], { type: 'image/png' });
          } catch (err) {
            // Metadata injection should never fail in practice (we just
            // produced the PNG from a working canvas), but if it does,
            // fall back to the unannotated blob — the image still saves.
            console.warn('pyr3-edit: PNG metadata injection failed; saving without metadata', err);
          }
          const url = URL.createObjectURL(finalBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${filename}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          // #104 — only bump the counter on a confirmed successful save (the
          // anchor click fired without throwing). A toBlob failure would
          // have rejected above so we'd never reach this point. Echo
          // onStateChange so the bar's preview tail re-ticks to the
          // bumped index.
          if (hasTemplate(template)) {
            bumpIndex(template);
            opts.onStateChange?.(state);
          }
          resolve();
        }, 'image/png');
      });
      // #176 — post-save toast confirms filename + Downloads landing.
      showToast(panelHost, `💾 Saved ${filename}.pyr3.png to Downloads`);
    } catch (err) {
      const errName = (err as Error)?.name;
      const msg = err instanceof Error ? err.message : String(err);
      if (errName === 'AbortError') {
        // User-cancelled — silent (modal close + restore is enough signal).
        cancelled = true;
      } else {
        console.error(`pyr3-edit: render-PNG failed — ${msg}`);
        showToast(panelHost, `Render failed: ${msg}`);
      }
    } finally {
      // Restore the canvas to whatever it was before the render-PNG so the
      // user keeps the same on-screen view they had. applyLane('slow') re-
      // iterates at preview-side density so the histogram fills these dims
      // — no CSS-upscaling from a tiny texture.
      canvas.width = restoreDims.width;
      canvas.height = restoreDims.height;
      renderer.resize({
        width: restoreDims.width,
        height: restoreDims.height,
        oversample: restoreDims.oversample,
        filterRadius: restoreDims.filterRadius,
      });
      const view2 = ctx.getCurrentTexture().createView();
      editRenderer.applyLane('slow', state.genome, state.seed, view2, restoreDims.width, restoreDims.height, { targetSpp: previewCfg.quality });
      panelHost.removeAttribute('data-busy');
      modal.close();
      renderInFlight = false;
      // Suppress unused-variable diagnostic; cancelled is documented above.
      void cancelled;
    }
  }

  function handleSaveFile(): void {
    try {
      // #104 — note: genomeToJson writes state.genome.name unchanged (the
      // literal template), so re-opens preserve editability. The filename
      // uses the resolved form.
      const json = JSON.stringify(genomeToJson(state.genome), null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const template = state.genome.name;
      a.download = `${resolveCurrentFilename()}.pyr3.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after a tick so the browser has time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      // #104 — anchor.click() succeeded; bump the per-template counter so
      // the next save lands at the next index. Echo onStateChange so the
      // bar's preview tail re-ticks to the bumped index (the bar's preview
      // is recomputed inside setMeta).
      if (hasTemplate(template)) {
        bumpIndex(template);
        opts.onStateChange?.(state);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`pyr3-edit: save failed — ${msg}`);
      showToast(panelHost, `Save failed: ${msg}`);
    }
  }

  // Initial mount + first paint. Same "settled" path as open/reroll.
  rebuildPanel();
  inflightTicket++;
  {
    // #176 — initial paint uses preview-side quality.
    scheduleBarShow(`rendering ${initialDims.width}×${initialDims.height} · q${previewCfg.quality}`);
  }
  const view0 = ctx.getCurrentTexture().createView();
  editRenderer.applyLane('slow', state.genome, state.seed, view0, initialDims.width, initialDims.height, { targetSpp: previewCfg.quality });
  opts.onStateChange?.(state);
  void awaitGpuThenMaybeHide(inflightTicket);

  // #176 — mount the render-mode-bar. Wires preview side to the editor's
  // PreviewRenderConfig (persisted to localStorage); render side to
  // genome.size / genome.quality (round-trips with .pyr3.json). Save Render
  // fires handleRenderPng — same path the (now-deprecated) top-bar 🖼️ button
  // uses, so both entry points reach the new progress modal.
  let renderModeBarHandle: RenderModeBarHandle | null = null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  renderModeBarHandle = mountRenderModeBar({
    host: renderModeBarHost,
    getPreviewConfig: () => previewCfg,
    setPreviewConfig: (cfg) => {
      previewCfg = cfg;
      savePreviewConfig(cfg);
      // Tier or quality change → re-iterate the preview at the new dims/
      // density. Schedule a 'rebuild' lane so the canvas resizes too.
      scheduler.schedule({ lane: 'rebuild', path: 'preview-config' });
    },
    getRenderSize: () => state.genome.size ?? { width: 1920, height: 1080 },
    setRenderSize: (size) => {
      state.genome.size = size;
      schedulePersist(state.genome);
      // Aspect may have changed — preview canvas reshapes via rebuild lane.
      scheduler.schedule({ lane: 'rebuild', path: 'size' });
    },
    // #176 — clamp at 200 (bar's hard cap, matching the viewer). ESF imports
    // frequently carry q=2000 which would otherwise display as 2000 in the
    // text input + run forever on Save Render. Editor owns the genome, so
    // first click on a Q button writes the clamped value back to state.
    getRenderQuality: () => Math.max(1, Math.min(200, state.genome.quality ?? 50)),
    setRenderQuality: (q) => {
      state.genome.quality = Math.max(1, Math.min(200, q));
      schedulePersist(state.genome);
      // Render-side quality only matters at Save Render time; no re-iterate
      // needed for the live preview (it uses previewCfg.quality, not this).
    },
    onSaveRender: () => handleRenderPng(),
    canSave: () => !renderInFlight,
    showToast: (msg) => showToast(panelHost, msg),
  });

  return {
    state,
    setName(name: string): void {
      state.genome.name = name;
      // #103 Phase 6 Task 6.3 — programmatic mutators bypass onPathChange (they
      // talk to the scheduler directly), so also schedule the WIP persist here.
      schedulePersist(state.genome);
      scheduler.schedule({ lane: pathLane('name'), path: 'name' });
    },
    setNick(nick: string): void {
      state.genome.nick = nick || undefined;
      schedulePersist(state.genome);
      scheduler.schedule({ lane: pathLane('nick'), path: 'nick' });
    },
    // #103 Phase 6 Task 6.2 — top-bar action callbacks. These reuse the
    // editor's existing internal handlers / scheduling shapes; the bar is
    // just a second entry point alongside the in-panel section UI.
    reroll(): void {
      handleReroll();
    },
    openFile(): void {
      handleOpenFile();
    },
    saveFlame(): void {
      handleSaveFile();
    },
    async saveRender(): Promise<void> {
      await handleRenderPng();
    },
    setSize(width: number, height: number): void {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      const w = Math.round(width);
      const h = Math.round(height);
      state.genome.size = { width: w, height: h };
      // Re-render the panel UI so the Render section's W×H inputs + preset
      // dropdown re-sync to the new dims. The rebuild lane covers the
      // re-iterate at the new dims; opts.onStateChange echo then updates the
      // bar's setDimensions readout.
      rebuildPanel();
      onPathChange('size.width');
      onPathChange('size.height');
      opts.onStateChange?.(state);
    },
    setQuality(quality: number): void {
      if (!Number.isFinite(quality) || quality <= 0) return;
      state.genome.quality = quality;
      rebuildPanel();
      onPathChange('quality');
      opts.onStateChange?.(state);
    },
    setSettleDelayMs(ms: number): void {
      // 2026-06-05: bar SETTLE ladder writes here. Mutate the live value
      // + sync the panel's scrubby without firing onSettleDelayChange —
      // the caller (main.ts) already initiated this and will echo to the
      // bar's setSettle highlight itself.
      if (!Number.isFinite(ms) || ms < 0) return;
      settleDelayMs = Math.round(ms);
      ui?.setSettleDelayMs(settleDelayMs);
    },
    computeFilenamePreview(template: string): string | null {
      return computeFilenamePreview(template);
    },
    undo(): void {
      // Flush any pending debounce so an in-flight slider drag commits
      // BEFORE we pop — otherwise the unflushed entry is silently lost when
      // the user hits Cmd-Z mid-drag.
      if (historyCommitTimer !== null) {
        clearTimeout(historyCommitTimer);
        historyCommitTimer = null;
        history.push(state.genome);
      }
      const restored = history.undo();
      if (!restored) return;
      void applyNewGenome(restored, undefined, 'preserve');
      notifyHistoryChange();
    },
    redo(): void {
      const restored = history.redo();
      if (!restored) return;
      void applyNewGenome(restored, undefined, 'preserve');
      notifyHistoryChange();
    },
    canUndo(): boolean {
      return history.canUndo();
    },
    canRedo(): boolean {
      return history.canRedo();
    },
    destroy(): void {
      if (historyCommitTimer !== null) clearTimeout(historyCommitTimer);
      panZoom.destroy();
      scheduler.cancel();
      ui?.destroy();
      nudge.destroy();
      renderer.destroy();
    },
  };
}

export function slugify(name: string): string {
  const cleaned = (name || 'flame').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'flame';
}

function showToast(host: HTMLElement, message: string): void {
  const t = document.createElement('div');
  t.textContent = message;
  t.style.cssText = `
    position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
    background: #2a1c1c; color: #ff9090; border: 1px solid #8a4a4a;
    border-radius: 4px; padding: 6px 12px; font-size: 12px; z-index: 100;
    pointer-events: none;
  `;
  host.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function showModal(host: HTMLElement, message: string): HTMLElement {
  const m = document.createElement('div');
  m.textContent = message;
  m.style.cssText = `
    position: absolute; inset: 0; display: flex;
    align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.6); color: #ddd;
    font-size: 14px; z-index: 200; pointer-events: all;
  `;
  host.appendChild(m);
  return m;
}
