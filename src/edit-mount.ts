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
  persistColdStartIfReroll,
  schedulePersist,
  loadEditRenderSettings,
  saveEditRenderSettings,
  persistPanelWidth,
  saveGizmoPrefs,
  saveComposePrefs,
  PANEL_WIDTH_MIN,
  PANEL_WIDTH_MAX,
  FINAL_SEL,
  type EditState,
  type LaneScheduler,
  type Lane,
  type SettledPixels,
} from './edit-state';
import { generateRandomGenome } from './edit-seed';
import { unpackSettledRgba } from './edit-pixel-readback';
import { createRenderer, type Renderer, DEFAULT_FILTER_RADIUS } from './renderer';
import { createEditRenderer, type EditRenderer } from './edit-render';
import { saveRenderToPng, type ExportFormat } from './render-save';
import { mountEditUi, type SectionMount, type EditUiHandle } from './edit-ui';
import {
  type PreviewRenderConfig,
  computePreviewDims,
  loadPreviewConfig,
  savePreviewConfig,
} from './render-mode-config';
import { mountRenderModeBar, type RenderModeBarHandle } from './render-mode-bar';
import { openRenderProgressModal } from './render-progress-modal';
import { openNamingDialog } from './naming-dialog';
import { parsePreviewOverride } from './load-intent';
import { genomeToJson } from './serialize';
import { load } from './loader';
import { type Genome } from './genome';
import { attachPanZoom, type PanZoomHandle } from './edit-canvas-nav';
import { attachXformGizmo, type GizmoHandle } from './edit-xform-gizmo';
import { attachComposeOverlay, composeShows, type ComposeOverlayHandle } from './edit-compose-overlay';
import { attachComposeMenu, type ComposeMenuHandle } from './edit-compose-menu';
import { attachGradientOverlay, type GradientOverlayHandle } from './edit-gradient-overlay';
import {
  downsampleIndexMap, paintMapDims, colorAtIndex, insertStopAtIndex,
  type IndexMap,
} from './color-index-map';
import { attachPaintRegion, type PaintRegionHandle } from './edit-paint-region';
import { attachCanvasOverlays, type CanvasOverlaysHandle } from './edit-canvas-overlays';
import { applyViewToCamera, type Camera, type Viewport, IDENTITY_VIEW } from './edit-camera-projection';
import { computeFitView } from './edit-fit-handles';
import { pickLensAffine, type RawAffine } from './edit-xform-gizmo-math';
import { createSlowRenderNudge, type SlowRenderNudgeHandle } from './edit-slow-render-nudge';
import { setCurrentFlame } from './app-state';
import { createHistory, type History } from './edit-history';

/** #352 — produce a downsized PREVIEW copy of `genome` for the editor's live
 *  lane, scaling every OUTPUT-PIXEL quantity by `ratio` (= previewLongEdge /
 *  fullLongEdge) so the 384px live preview is representative of the settled
 *  full-resolution render.
 *
 *  `scale` (px-per-world-unit), the spatial-filter radius, AND the density-
 *  estimator radii (`maxRad`/`minRad`) are ALL in output-pixel units, so they
 *  must shrink together — otherwise a radius-11 DE kernel that covers ~0.6% of a
 *  1920px render covers ~3% of a 384px preview, over-blurring it into "one
 *  color" until the settled render snaps it crisp (the #352 symptom). The DE
 *  `curve` is a dimensionless falloff exponent (not px) and is deliberately
 *  left untouched — scaling it would distort the adaptive falloff.
 *
 *  Pure + side-effect-free: returns a shallow copy and never mutates `genome`.
 *  Caller owns the `ratio === 1` identity short-circuit (so the settled lane
 *  keeps returning the same genome reference its GPU caches key on). */
export function scalePreviewGenome(genome: Genome, ratio: number): Genome {
  const adjusted: Genome = { ...genome, scale: genome.scale * ratio };
  if (genome.spatialFilter) {
    adjusted.spatialFilter = {
      ...genome.spatialFilter,
      radius: genome.spatialFilter.radius * ratio,
    };
  }
  if (genome.density) {
    adjusted.density = {
      ...genome.density,
      maxRad: genome.density.maxRad * ratio,
      minRad: genome.density.minRad * ratio,
      // curve stays as-is — dimensionless exponent, not an output-px length.
    };
  }
  return adjusted;
}

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
   *  flame name / nick into the editor's save-only metadata defaults.
   *  #192 + #194 — these write to per-browser save defaults (sticky across
   *  reroll / open / transfer) and NEVER mutate state.genome.{name,nick}
   *  (which carries the LOADED flame's identity). */
  setName(name: string): void;
  setNick(nick: string): void;
  /** #192 — current save-only metadata defaults. Read once at bar-mount time
   *  to seed the bar's name/by input values; never changes from outside this
   *  module after that. */
  getSaveDefaults(): { flameName: string; flameNick: string };
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
  // #27 — drag-resize grip between the panel and the canvas (middle grid track).
  const resizeGrip = document.createElement('div');
  resizeGrip.className = 'pyr3-edit-resize-grip';
  resizeGrip.setAttribute('role', 'separator');
  resizeGrip.setAttribute('aria-orientation', 'vertical');
  const canvasHost = document.createElement('div');
  canvasHost.className = 'pyr3-edit-canvas-host';
  // #118 — slow-render nudge needs an absolutely-positioned parent.
  canvasHost.style.position = 'relative';
  const canvas = document.createElement('canvas');
  canvas.width = preview.width;
  canvas.height = preview.height;
  canvasHost.appendChild(canvas);
  editBody.append(panelHost, resizeGrip, canvasHost);
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

  // Sticky editor render settings (Size / Quality / Settle) — a per-browser
  // workstation pref, NOT part of the flame. Loaded here so a flame that doesn't
  // carry its own size/quality (Surprise Wall flame, reroll) opens at the values
  // the user last chose instead of a hardcoded default. See edit-state.ts.
  let renderSettings = loadEditRenderSettings();

  // Apply editor defaults to fields the user hasn't set yet. Files opened
  // with their own values keep them; flames without size/quality inherit the
  // user's sticky render settings (so the editor "remembers" them across loads).
  function applyEditorDefaults(genome: Genome): void {
    if (genome.size === undefined) genome.size = { ...renderSettings.size };
    if (genome.quality === undefined) genome.quality = renderSettings.quality;
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
  // #344 — persist a fresh reroll immediately (after nick + defaults are applied)
  // so a reload restores THIS flame instead of generating a brand-new one. The
  // wip/pending sources don't need it (wip is already stored; pending is
  // single-shot and persists on the first edit).
  persistColdStartIfReroll(initial.source, initialGenome);
  const initialSeed = (Math.random() * 0xffffffff) >>> 0;
  const state = createEditState(initialGenome, initialSeed);
  // #27 — drag-resize the editor panel. The grid's panel column is the
  // --pyr3-panel-w custom property on the editor root; the grip updates it
  // live, clamps to [MIN,MAX], and persists the chosen width on release.
  opts.root.style.setProperty('--pyr3-panel-w', `${state.panelWidth}px`);
  const detachResize = ((): (() => void) => {
    let dragging = false;
    const onDown = (e: MouseEvent): void => {
      dragging = true;
      e.preventDefault();
      document.body.style.cursor = 'col-resize';
    };
    const onMove = (e: MouseEvent): void => {
      if (!dragging) return;
      const left = editBody.getBoundingClientRect().left;
      const w = Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, e.clientX - left));
      state.panelWidth = w;
      opts.root.style.setProperty('--pyr3-panel-w', `${w}px`);
    };
    const onUp = (): void => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = '';
      persistPanelWidth(state.panelWidth);
    };
    resizeGrip.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return (): void => {
      resizeGrip.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  })();
  // #357 — provenance for the bar's "📂 loaded from …" chip. Only a genuine
  // viewer→editor transfer (pending) counts as a load at cold-start; the
  // catalog scaffold (opts.initialGenome) is generated, and wip/reroll are
  // cold-start sources with no flame to attribute. handleOpenFile flips this
  // to true; handleReroll flips it back to false.
  state.loadedSource = !opts.initialGenome && initial.source === 'pending';

  // #108 — undo/redo stack, seeded with the cold-start genome. push happens
  // on every commit gesture (onPathChange), debounced via the same window
  // as the settle timer so a slider drag is one entry, not sixty. reset on
  // file-open + reroll (whole-genome replacement, not an edit). undo/redo
  // restore via the no-history-reset branch of applyNewGenome.
  const history: History<Genome> = createHistory(initialGenome);
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
  let renderModeBarHandle: RenderModeBarHandle | null = null;

  // #192 + #194 — save-only metadata overrides. Sticky across reroll / file
  // open / viewer transfer; ONLY mutated by user typing in the bar's name/by
  // inputs. Decoupled from state.genome.{name,nick} (which now carry the
  // LOADED flame's metadata exclusively, never touched by typing). On save,
  // these override the saved genome's name/nick fields. Persisted per-browser
  // via localStorage so a session-fresh open inherits the user's last typed
  // save defaults.
  const SAVE_DEFAULTS_KEY = 'pyr3.edit.save-defaults';
  function loadSaveDefaults(): { flameName: string; flameNick: string } {
    try {
      const raw = globalThis.localStorage?.getItem(SAVE_DEFAULTS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p === 'object' && p._v === 1) {
          return {
            flameName: typeof p.flameName === 'string' ? p.flameName : '',
            flameNick: typeof p.flameNick === 'string' ? p.flameNick : '',
          };
        }
      }
    } catch { /* fall through to default */ }
    // Migration: pre-#192 stored the nick under `pyr3.edit.nick`. Honor it
    // when the new key is empty so users don't lose their stored author.
    let migratedNick = '';
    try { migratedNick = globalThis.localStorage?.getItem('pyr3.edit.nick') ?? ''; }
    catch { migratedNick = ''; }
    return { flameName: '', flameNick: migratedNick };
  }
  function persistSaveDefaults(): void {
    try {
      globalThis.localStorage?.setItem(
        SAVE_DEFAULTS_KEY,
        JSON.stringify({ ...saveDefaults, _v: 1 }),
      );
    } catch (err) {
      console.warn('pyr3-edit: persistSaveDefaults failed', err);
    }
  }
  const saveDefaults = loadSaveDefaults();

  function notifyStateChange(): void {
    opts.onStateChange?.(state);
    renderModeBarHandle?.refresh();
  }
  // #176 — URL params (?preview / ?previewQ / ?quick=1) override the
  // persisted config for this session only. NOT written back to
  // localStorage so a refresh without the param falls back to the user's
  // persisted choice.
  {
    const override = parsePreviewOverride(typeof window !== 'undefined' ? window.location.search : '');
    if (override?.tier) previewCfg = { ...previewCfg, tier: override.tier };
    if (override?.quality !== undefined) previewCfg = { ...previewCfg, quality: override.quality };
  }

  function getFullDims(): { width: number; height: number } {
    const size = state.genome.size;
    const renderW = (size?.width ?? 0) > 0 ? size!.width : preview.width;
    const renderH = (size?.height ?? 0) > 0 ? size!.height : preview.height;
    return { width: renderW, height: renderH };
  }

  // #205 — when the render dim changes, scale + spatialFilter.radius are
  // anchored to the AUTHORED dim; without proportional adjustment the flame
  // collapses on the new canvas (e.g. 1280→3840 leaves it at 1/3 size). Mirror
  // the viewer's WYSIWYG: keep world-span constant by scaling proportionally
  // to the new long-edge. No-ops when size matches or no prior size existed.
  function applyRenderSizeWithScale(next: { width: number; height: number }): void {
    const prev = state.genome.size;
    if (prev && prev.width > 0 && prev.height > 0) {
      const prevMaxEdge = Math.max(prev.width, prev.height);
      const nextMaxEdge = Math.max(next.width, next.height);
      if (prevMaxEdge !== nextMaxEdge) {
        const ratio = nextMaxEdge / prevMaxEdge;
        state.genome.scale *= ratio;
        if (state.genome.spatialFilter) {
          state.genome.spatialFilter = {
            ...state.genome.spatialFilter,
            radius: state.genome.spatialFilter.radius * ratio,
          };
        }
      }
    }
    state.genome.size = next;
  }

  // #350 two-layer model: the FLAME renders at the composition (state.genome)
  // ALWAYS — the workspace view is gizmo-only and never touches the flame, so
  // the composition can never move while editing. (Only gizmoCamera() composes
  // the view; see below.)
  function adjustedGenomeFor(w: number, _h: number): Genome {
    const full = getFullDims();
    if (w === full.width) return state.genome;
    return scalePreviewGenome(state.genome, w / full.width);
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
  // fires. Exposed in the top-bar as a settable input (see EditUiCallbacks)
  // and persisted; the default is 500ms (DEFAULT_EDIT_RENDER_SETTINGS.settleMs).
  // It needs to be long enough that on single clicks the live frame is VISIBLE
  // before the settled render resizes the canvas to full dims and starts
  // encoding (the resize blanks the canvas briefly). User can tune lower for a
  // snappier settled render, higher for a longer-lived live preview.
  let settleDelayMs = renderSettings.settleMs;
  const BAR_DELAY_MS = 500;

  // Persist the sticky render settings (Size / Quality / Settle) from the
  // current genome + live settle value. Called whenever the user changes any of
  // them via the bar or the panel's Render section.
  function persistRenderSettings(): void {
    const sz = state.genome.size ?? renderSettings.size;
    renderSettings = {
      size: { width: sz.width, height: sz.height },
      quality: state.genome.quality ?? renderSettings.quality,
      settleMs: settleDelayMs,
    };
    saveEditRenderSettings(renderSettings);
  }

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
    return adjustedGenomeFor(live.width, live.height);
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
    const indexArmed = armIndexCapture();   // #269/#372 — capture idx_sum this render?
    editRenderer.applyLane('slow', adjustedGenomeFor(d.width, d.height), state.seed, view, d.width, d.height, { targetSpp: spp });
    notifyStateChange();
    // #118 — measure settle-render wall-clock so the slow-render nudge
    // can detect a pattern of slow renders during active editing.
    const renderStart = performance.now();
    await awaitGpuThenMaybeHide(myTicket);
    nudge?.recordRender(performance.now() - renderStart);
    // #269/#372 — read back the palette-index map for point-to-paint (if armed).
    await captureIndexMapIfArmed(indexArmed, myTicket);
    // #175 — emit the settled, PRE-curve canvas pixels to any subscribed
    // section (Color Curves histogram overlay; future Scopes #174). Best-
    // effort: failures must never break the render path.
    void captureSettledPixels(myTicket, spp);
  }

  // #175/#174 — re-present the just-settled image into an offscreen COPY_SRC
  // texture, read it back, and hand TRUE-RGBA bytes to listeners. Two feeds:
  //  • settledPixelsListeners — PRE-curve (channelCurves stripped). The Color
  //    Curves histogram wants the INPUT-referred image so its backdrop stays
  //    still while the user drags spline points (curves are a present-pass op).
  //  • gradedPixelsListeners — fully GRADED (the genome as displayed). The
  //    Scopes panel wants exactly what's on screen, so it responds to grading.
  //
  // The swap-chain texture isn't readable (WebGPU), so an offscreen re-present
  // is mandatory for ANY readback; applyLane('fast') reuses the existing
  // histogram (no chaos re-iterate). Each feed is only read back when it has a
  // listener, so the second readback is skipped when nothing consumes it.
  async function captureSettledPixels(myTicket: number, spp: number): Promise<void> {
    const preListeners = state.settledPixelsListeners;
    const gradedListeners = state.gradedPixelsListeners;
    const W = canvas.width;
    const H = canvas.height;
    if (W <= 0 || H <= 0) return;

    const base = adjustedGenomeFor(W, H);
    if (preListeners && preListeners.length > 0) {
      const preCurve = base.channelCurves ? { ...base, channelCurves: undefined } : base;
      await readbackAndNotify(preCurve, W, H, myTicket, spp, preListeners);
    }
    if (gradedListeners && gradedListeners.length > 0) {
      await readbackAndNotify(base, W, H, myTicket, spp, gradedListeners);
    }
  }

  // Re-present `genome` into an offscreen texture at W×H, copy it back to the
  // CPU as tight TRUE-RGBA, and fan it out to `listeners`. Best-effort: any
  // GPU/mapping failure is swallowed (this is a non-critical overlay feed).
  async function readbackAndNotify(
    genome: Genome,
    W: number,
    H: number,
    myTicket: number,
    spp: number,
    listeners: Array<(pixels: SettledPixels) => void>,
  ): Promise<void> {
    let tex: GPUTexture | undefined;
    let buf: GPUBuffer | undefined;
    try {
      tex = opts.device.createTexture({
        label: 'pyr3.edit.settled-readback',
        size: { width: W, height: H },
        format: opts.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      editRenderer.applyLane('fast', genome, state.seed, tex.createView(), W, H, { targetSpp: spp });

      const bytesPerPixel = 4;
      const unpaddedBytesPerRow = W * bytesPerPixel;
      // copyTextureToBuffer requires bytesPerRow aligned to 256.
      const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
      buf = opts.device.createBuffer({
        label: 'pyr3.edit.settled-readback.buf',
        size: bytesPerRow * H,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const enc = opts.device.createCommandEncoder();
      enc.copyTextureToBuffer(
        { texture: tex },
        { buffer: buf, bytesPerRow, rowsPerImage: H },
        { width: W, height: H },
      );
      opts.device.queue.submit([enc.finish()]);

      await buf.mapAsync(GPUMapMode.READ);
      // A newer render superseded us while we awaited — drop this frame; the
      // newer settle will emit its own pixels.
      if (inflightTicket !== myTicket) {
        buf.unmap();
        return;
      }
      const padded = new Uint8Array(buf.getMappedRange());
      // Strip row padding into tight TRUE-RGBA (undo the bgra swap on macOS
      // Chrome's bgra8unorm swap chain) so downstream scope binning is
      // format-agnostic. (#423 — extracted to a unit-tested pure helper.)
      const rgba = unpackSettledRgba(padded, W, H, opts.format === 'bgra8unorm');
      buf.unmap();

      const payload: SettledPixels = { width: W, height: H, rgba };
      for (const fn of listeners) {
        try {
          fn(payload);
        } catch {
          // A misbehaving listener must not break the render path.
        }
      }
    } catch {
      // Readback is a non-critical overlay feed; swallow GPU/mapping errors.
    } finally {
      buf?.destroy();
      tex?.destroy();
    }
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
    notifyStateChange();
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
    // #369 — the nudge observes the PREVIEW settle render (timed at line ~626,
    // which iterates at previewCfg.quality, the 10..50 ladder), so it must read
    // and drop the PREVIEW quality — NOT the 50..500 render-side genome.quality
    // (which only affects Save Render and would leave editor iteration just as
    // slow). Mirror the bar's setPreviewConfig path: update + persist + rebuild +
    // refresh the PREVIEW ladder UI. (renderModeBarHandle is assigned below; this
    // closure only runs on a user click, well after mount.)
    getQuality: () => previewCfg.quality,
    setQuality: (q) => {
      previewCfg = { ...previewCfg, quality: q };
      savePreviewConfig(previewCfg);
      scheduler.schedule({ lane: 'rebuild', path: 'preview-config' });
      renderModeBarHandle?.refresh();
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
    } else {
      // Size / Quality are sticky render prefs — persist so the next flame load
      // (incl. a Surprise Wall handoff) opens at these values, not defaults.
      persistRenderSettings();
    }
    // #350 Phase 2.3 — keep the on-canvas gizmo square locked to the affine
    // when it's edited from the panel fields (gizmo declared below; this runs
    // at edit time, well after assignment).
    if (path.startsWith('xforms') || path === 'cx' || path === 'cy' || path === 'scale' || path === 'rotate' || path === 'finalxform' || path.startsWith('finalxform.')) {
      gizmo?.draw();
    }
    // #376 — a panel post-toggle (add/remove the post-transform) changes which
    // lenses exist: snap back to 'pre' if the post was removed, and refresh the
    // PRE|POST pill visibility + the ghost.
    if (path.endsWith('.post')) {
      const xf = state.selectedXformIndex === FINAL_SEL ? state.genome.finalxform : state.genome.xforms[state.selectedXformIndex];
      if (!xf?.post) state.gizmoLens = 'pre';
      overlays.sync();
      gizmo?.draw();
    }
    const lane = pathLane(path);
    if (lane === 'slow' || lane === 'rebuild' || lane === 'fast') {
      void requestLiveRender(lane);
      scheduleSettle();
    } else {
      scheduler.schedule({ lane, path });
    }
  }

  // #372 — on-canvas gradient bar overlay. Declared early (before rebuildPanel)
  // so the panel-rebuild re-attach can run safely. Mutually exclusive with the
  // affine gizmo via state.activeCanvasOverlay.
  let gradientOverlay: GradientOverlayHandle | null = null;

  // #269/#372 — palette-index map for point-to-paint. Captured from the settled
  // render's idx_sum channel ONCE per genome identity (the index is geometry,
  // not color — recoloring never moves it). null until a capture lands.
  let indexMap: IndexMap | null = null;
  let indexMapGenome: Genome | null = null;
  const PAINT_LONG_EDGE = 256; // index-map long-edge target; short edge follows the flame aspect

  // Arm the GPU index-capture channel for the upcoming slow render when the
  // overlay is active and the cached map is stale. The channel costs per-iter,
  // so it stays OFF whenever we don't need a fresh capture. Returns whether this
  // render should read the map back afterwards.
  function armIndexCapture(): boolean {
    const need = state.activeCanvasOverlay === 'gradient'
      && (state.genome !== indexMapGenome || indexMap === null);
    renderer.setCaptureIndex(need);
    return need;
  }

  // Read back + downsample the index map after a slow render that was armed.
  // Best-effort: GPU/mapping failures are swallowed (non-critical overlay feed).
  async function captureIndexMapIfArmed(armed: boolean, myTicket: number): Promise<void> {
    if (!armed || inflightTicket !== myTicket) return;
    try {
      const { idxSum, count, width, height } = await renderer.readIndexMap();
      if (inflightTicket !== myTicket) return;
      // Aspect-true, in-bounds out-dims (see paintMapDims) — a forced square
      // distorts + reads OOB on a non-square render, leaving the canvas
      // under-covered. (#372)
      const { outW, outH } = paintMapDims(width, height, PAINT_LONG_EDGE);
      indexMap = downsampleIndexMap(idxSum, count, width, height, outW, outH);
      indexMapGenome = state.genome;
    } catch { /* non-critical — point-to-paint just stays unavailable this frame */ }
  }

  /** Build a short #rrggbb for the selected-stop readout. */
  function rgbHex(s: { r: number; g: number; b: number }): string {
    const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
    return `#${h(s.r)}${h(s.g)}${h(s.b)}`;
  }

  // Tear down any live gradient overlay, then re-attach if gradient-edit mode is
  // active. Called by the Color-lens toggle (via state.onCanvasOverlayChange) and
  // after every rebuildPanel (undo/redo/reroll rebuild the controls host away).
  function refreshGradientOverlay(): void {
    gradientOverlay?.destroy();
    gradientOverlay = null;
    if (state.activeCanvasOverlay !== 'gradient') return;
    const controlsHost = panelHost.querySelector('[data-role="gradient-controls-host"]') as HTMLElement | null;
    const readout = panelHost.querySelector('[data-role="gradient-readout"]') as HTMLElement | null;
    if (!controlsHost) return;
    gradientOverlay = attachGradientOverlay(canvasHost, {
      getPalette: () => state.genome.palette,
      onChange: (p) => { state.genome.palette = p; onPathChange('palette'); },
      controlsHost,
      onSelect: (idx) => {
        if (!readout) return;
        const s = state.genome.palette.stops[idx];
        readout.textContent = s ? `stop #${idx} · ${rgbHex(s)} · pos ${s.t.toFixed(2)}` : '';
      },
      // #269 — bar hover → tint the flame regions at that gradient position
      // (continuous t across the WHOLE bar, not snapped to stoppers).
      onHoverT: (t) => paintRegionHandle.paint(t),
    });
  }

  // Forced-off path: the affine gizmo turning on must close the gradient overlay
  // (mutual exclusion). Also resets the Color-lens toggle's label/aria so the UI
  // doesn't read "Editing gradient" while the overlay is gone.
  function deactivateGradientOverlay(): void {
    state.activeCanvasOverlay = 'none';
    gradientOverlay?.destroy();
    gradientOverlay = null;
    renderer.setCaptureIndex(false);   // #269/#372 — disarm the index channel
    indexMap = null;
    indexMapGenome = null;
    paintRegionHandle.paint(null);
    const t = panelHost.querySelector('[data-role="edit-gradient-toggle"]') as HTMLElement | null;
    if (t) { t.setAttribute('aria-pressed', 'false'); t.textContent = '🎨 Edit gradient'; }
  }

  // Replace the whole panel + force a slow-lane reseed. Used by reroll + open.
  let ui: EditUiHandle;
  function rebuildPanel(): void {
    // Preserve transient subpanel open-state (<details data-subpanel="…">) across
    // the destroy+remount, so undo/redo/reroll don't collapse fold-ups the user
    // opened. Top-level sections already survive via state.sectionCollapse; this
    // covers the per-section <details> expanders that aren't persisted there.
    const openSubpanels = new Set<string>();
    for (const el of panelHost.querySelectorAll<HTMLDetailsElement>('details[data-subpanel]')) {
      if (el.open && el.dataset.subpanel) openSubpanels.add(el.dataset.subpanel);
    }
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
        persistRenderSettings();
        // Echo to the host so the editor bar's SETTLE ladder highlight
        // can re-sync when the user types an off-ladder value in the panel.
        opts.onSettleDelayChange?.(ms);
      },
    });
    // Restore the open subpanels captured above. For a lazily-built expander
    // (e.g. the palette generator) setting `.open` fires its toggle → it mounts.
    for (const el of panelHost.querySelectorAll<HTMLDetailsElement>('details[data-subpanel]')) {
      if (el.dataset.subpanel && openSubpanels.has(el.dataset.subpanel)) el.open = true;
    }
    // #372 — the rebuilt panel has a fresh gradient-controls host; re-attach the
    // overlay (if active) so its controls + readout bind to the new nodes and the
    // bar reflects the restored palette (undo/redo/reroll).
    refreshGradientOverlay();
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
  let liveLane: Lane = 'fast';
  async function requestLiveRender(lane: Lane = 'slow'): Promise<void> {
    if (lane === 'rebuild' || liveLane === 'rebuild') liveLane = 'rebuild';
    else if (lane === 'slow' || liveLane === 'slow') liveLane = 'slow';

    if (liveInFlight) {
      liveDirty = true; // mark for re-render after current frame finishes
      return;
    }
    liveInFlight = true;
    do {
      liveDirty = false;
      const currentLane = liveLane;
      liveLane = 'fast'; // reset for next request
      
      inflightTicket++;
      if (currentLane === 'slow' || currentLane === 'rebuild') {
        ensureLiveDims();
      }
      const view = ctx.getCurrentTexture().createView();
      const w = canvas.width;
      const h = canvas.height;
      const genome = (currentLane === 'slow' || currentLane === 'rebuild') ? liveAdjustedGenome() : state.genome;
      editRenderer.applyLane(currentLane === 'rebuild' ? 'slow' : currentLane, genome, state.seed, view, w, h, { targetSpp: previewCfg.quality });
      notifyStateChange();
      await opts.device.queue.onSubmittedWorkDone();
      // Yield to the browser's paint pipeline BEFORE starting the next
      // render. Without this, a fast click stream chains GPU renders so
      // tightly that each one overwrites the swapchain texture before the
      // browser ever composites it — user sees no updates until the loop
      // exits and the final frame paints. The rAF wait gives the
      // compositor a slot per render, so each click produces a visible
      // frame.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      // #174 — keep the Scopes panel real-time. Read back THIS live frame for
      // the graded feed so scopes track during interaction, not just after the
      // settle render fires (settleDelayMs later). Gated on !liveDirty so a
      // continuous drag (which keeps liveDirty true) doesn't pay a readback per
      // frame — it refreshes whenever the live loop drains (i.e. the moment the
      // user pauses). The settle render still feeds BOTH the graded + pre-curve
      // (histogram) feeds at full quality. Pre-curve histogram stays settle-only
      // (curve-invariant — a curve drag doesn't move it).
      const gradedListeners = state.gradedPixelsListeners;
      if (!liveDirty && gradedListeners && gradedListeners.length > 0) {
        await readbackAndNotify(genome, w, h, inflightTicket, previewCfg.quality, gradedListeners);
      }
    } while (liveDirty);
    liveInFlight = false;
  }

  // Canvas pan + zoom — left-drag = cx/cy, wheel = scale. The viewport-
  // section inputs sync via the 'pyr3:viewport-changed' event below so the
  // displayed cx/cy/scale stay current as the user drags. Live render fires
  // continuously while the user interacts; the settle timer kicks the final
  // full-quality render 150ms after the last input.
  // #350 Phase 2.3 — on-canvas affine gizmo. Declared before panZoom so the
  // viewport callback can redraw it; assigned just below.
  let gizmo: GizmoHandle | null = null;
  let composeOverlay: ComposeOverlayHandle | null = null;
  let composeMenu: ComposeMenuHandle | null = null;
  const panZoom: PanZoomHandle = attachPanZoom(canvas, state, {
    onViewportChange: () => {
      // Notify any DOM listeners (the viewport section's inputs) that the
      // viewport mutated externally so they can re-sync their .value. The
      // viewport section listens at document level + self-removes when its
      // host detaches (next rebuildPanel) so this stays leak-free.
      document.dispatchEvent(new CustomEvent('pyr3:viewport-changed'));
      gizmo?.draw(); // keep the world-space gizmo locked to the camera
      // #350 — in xform mode pan/zoom drives the gizmo VIEW only; the flame
      // renders the (unchanged) composition, so re-iterating it is wasted work
      // + a settle flicker. Only re-render when flame mode moved the camera.
      if (!state.gizmo.editOnCanvas) {
        void requestLiveRender();
        scheduleSettle();
        // #358 — flame-mode pan/zoom mutates the genome (cx/cy/scale), so make
        // each gesture its own undo step (debounced → one entry per gesture).
        // In xform mode the genome is untouched, so this no-ops (sameContent).
        scheduleHistoryCommit();
      }
    },
  });

  // #350 Phase 2.3 — screen-fixed canvas-chrome overlays menu (edit/grid/snap)
  // + the world-space affine gizmo. Both host in canvasHost (position:relative).
  const overlays: CanvasOverlaysHandle = attachCanvasOverlays(canvasHost, {
    getPrefs: () => state.gizmo,
    onChange: (next) => {
      const wasEditing = state.gizmo.editOnCanvas;
      state.gizmo = next;
      saveGizmoPrefs(next);
      if (!wasEditing && next.editOnCanvas) {
        // #372 — affine-edit and gradient-edit are mutually exclusive: turning
        // the gizmo on closes any live gradient overlay first.
        if (state.activeCanvasOverlay === 'gradient') deactivateGradientOverlay();
        // Enabling edit: the numbered grid is the gizmo's reference frame, so
        // auto-show it (user can still toggle off), then auto-frame the gizmo
        // LAYER (never the flame — two-layer model, #350).
        if (!next.showWorldGrid) {
          next.showWorldGrid = true;
          state.gizmo = next;
          saveGizmoPrefs(next);
          overlays.sync();
        }
        fitViewToSelectedXform();
      } else if (wasEditing && !next.editOnCanvas) {
        // Disabling restores the exact composition (view → identity).
        resetWorkspaceView();
      } else {
        gizmo?.draw(); // reflect grid/snap toggles immediately
      }
    },
    onFit: () => fitViewToSelectedXform(),
    onCenter: () => centerViewOnSelectedXform(),
    // #376 — PRE|POST lens pill. getLens is defensive (stale 'post' with no post → 'pre').
    getLens: (): 'pre' | 'post' => {
      const xf = state.selectedXformIndex === FINAL_SEL ? state.genome.finalxform : state.genome.xforms[state.selectedXformIndex];
      return state.gizmoLens === 'post' && xf?.post ? 'post' : 'pre';
    },
    setLens: (lens): void => { state.gizmoLens = lens; gizmo?.draw(); },
    hasPost: (): boolean => {
      const xf = state.selectedXformIndex === FINAL_SEL ? state.genome.finalxform : state.genome.xforms[state.selectedXformIndex];
      return !!xf?.post;
    },
    // #364 — composition guides split control.
    onComposeToggle: () => {
      const next = { ...state.compose, composeOn: !state.compose.composeOn };
      state.compose = next; saveComposePrefs(next); composeOverlay?.draw(); overlays.sync();
    },
    onCompose: (anchor) => composeMenu?.toggle(anchor),
    composeActive: () => composeShows(state.compose),
  });
  // #350 — set the transient workspace view to frame the selected xform's
  // handles (or identity if no regular xform is selected). NOT routed through
  // onPathChange: this is editor navigation, not a genome edit (no history /
  // persist). The saved composition (genome.cx/cy/scale) is never touched.
  // These only move the gizmo VIEW layer; the flame renders the unchanged
  // composition, so they redraw the gizmo overlay ONLY — no flame re-iterate.
  function fitViewToSelectedXform(): void {
    const xf = state.selectedXformIndex === FINAL_SEL
      ? state.genome.finalxform
      : state.genome.xforms[state.selectedXformIndex];
    if (!xf) { resetWorkspaceView(); return; }
    const affine: RawAffine = pickLensAffine(xf, state.gizmoLens); // #376 — frame the active lens
    const cam: Camera = { cx: state.genome.cx, cy: state.genome.cy, scale: state.genome.scale, rotateDeg: state.genome.rotate ?? 0 };
    state.view = computeFitView(affine, cam, gizmoViewport());
    gizmo?.draw();
  }
  function resetWorkspaceView(): void {
    state.view = { ...IDENTITY_VIEW };
    gizmo?.draw();
  }
  // ⊕ center — pan the gizmo layer to the selected xform at the CURRENT zoom
  // (distinct from ⊡ fit, which also re-zooms). Composition is never touched.
  function centerViewOnSelectedXform(): void {
    const xf = state.selectedXformIndex === FINAL_SEL
      ? state.genome.finalxform
      : state.genome.xforms[state.selectedXformIndex];
    if (!xf) return;
    // Handle-box center in world: midpoint of the xform's image of the unit
    // square plus the rotate stalk — averaging the affine corners + rotate
    // anchor is overkill; the affine center apply(0.5,0.5) is a good target.
    const src = pickLensAffine(xf, state.gizmoLens); // #376 — center the active lens
    const cx = src.a * 0.5 + src.b * 0.5 + src.c;
    const cy = src.d * 0.5 + src.e * 0.5 + src.f;
    const z = state.view.zoom;
    state.view = { zoom: z, panX: (cx - state.genome.cx) * z, panY: (cy - state.genome.cy) * z };
    gizmo?.draw();
  }
  function gizmoCamera(): Camera {
    // Project handles through the COMPOSED camera so they stay locked to the
    // xform under any workspace-view pan/zoom (#350 decoupled view).
    return applyViewToCamera({ cx: state.genome.cx, cy: state.genome.cy, scale: state.genome.scale, rotateDeg: state.genome.rotate ?? 0 }, state.view);
  }
  function gizmoViewport(): Viewport {
    const rect = canvas.getBoundingClientRect();
    const size = state.genome.size;
    const iw = size && size.width > 0 ? size.width : Math.max(1, canvas.width);
    const ih = size && size.height > 0 ? size.height : Math.max(1, canvas.height);
    return { rectWidth: rect.width, rectHeight: rect.height, intrinsicWidth: iw, intrinsicHeight: ih };
  }
  gizmo = attachXformGizmo(canvasHost, canvas, {
    getSelectedIndex: () => state.selectedXformIndex,
    getAffine: (i): RawAffine | null => {
      const xf = i === FINAL_SEL ? state.genome.finalxform : state.genome.xforms[i];
      return xf ? { a: xf.a, b: xf.b, c: xf.c, d: xf.d, e: xf.e, f: xf.f } : null;
    },
    setAffine: (i, r: RawAffine): void => {
      const xf = i === FINAL_SEL ? state.genome.finalxform : state.genome.xforms[i];
      if (!xf) return;
      xf.a = r.a; xf.b = r.b; xf.c = r.c; xf.d = r.d; xf.e = r.e; xf.f = r.f;
    },
    // #376 — post-transform lens. getActiveLens is defensive: a stale 'post' lens
    // on an xform without a post reads as 'pre'.
    getActiveLens: (): 'pre' | 'post' => {
      const xf = state.selectedXformIndex === FINAL_SEL ? state.genome.finalxform : state.genome.xforms[state.selectedXformIndex];
      return state.gizmoLens === 'post' && xf?.post ? 'post' : 'pre';
    },
    getPostAffine: (i): RawAffine | null => {
      const xf = i === FINAL_SEL ? state.genome.finalxform : state.genome.xforms[i];
      return xf?.post ? { a: xf.post.a, b: xf.post.b, c: xf.post.c, d: xf.post.d, e: xf.post.e, f: xf.post.f } : null;
    },
    setPostAffine: (i, r: RawAffine): void => {
      const xf = i === FINAL_SEL ? state.genome.finalxform : state.genome.xforms[i];
      if (!xf || !xf.post) return;
      xf.post.a = r.a; xf.post.b = r.b; xf.post.c = r.c; xf.post.d = r.d; xf.post.e = r.e; xf.post.f = r.f;
    },
    getCamera: gizmoCamera,
    getViewport: gizmoViewport,
    getPrefs: () => state.gizmo,
    // onPathChange routes the slow-lane re-iterate + the debounced (250ms)
    // history commit, so a whole drag coalesces into one undo entry — no extra
    // commit needed at drag end.
    onLiveEdit: (i) => {
      // #376 — route the slow-lane re-iterate + debounced history to the
      // lens-correct path so a post drag lands on the `.post` sub-path.
      const base = i === FINAL_SEL ? 'finalxform' : 'xforms.' + i;
      const xf = i === FINAL_SEL ? state.genome.finalxform : state.genome.xforms[i];
      onPathChange(state.gizmoLens === 'post' && xf?.post ? base + '.post' : base);
      // #350 #1 — refresh the XForm panel's affine fields + mini-viz live so
      // they track the gizmo drag (panel edits self-update; this is gizmo→panel).
      document.dispatchEvent(new CustomEvent('pyr3:xform-affine-changed'));
    },
    onCommit: () => { /* history rides onLiveEdit's debounce */ },
    onReadout: (text) => overlays.setReadout(text),
  });
  // Redraw the gizmo when the selected xform (or the xform list) changes via
  // the XForm-lens selectors (#350 rebuildAll emits this). While editing, also
  // re-frame the workspace view to the newly-selected xform.
  const onGizmoSelectionChange = (): void => {
    state.gizmoLens = 'pre'; // #376 — the newly-selected xform may have no post
    overlays.sync();         // refresh the PRE|POST pill visibility
    if (state.gizmo.editOnCanvas) fitViewToSelectedXform();
    else gizmo?.draw();
  };
  document.addEventListener('pyr3:xform-selection-changed', onGizmoSelectionChange);
  // Keep the overlay sized to the canvas host across panel-drag + window resize.
  const gizmoResizeObs = new ResizeObserver(() => { gizmo?.resize(); composeOverlay?.resize(); paintRegionHandle.reposition(); });
  gizmoResizeObs.observe(canvasHost);

  // #364 — screen-fixed compositional guides (thirds/center/grid/rings/spokes).
  // Always present + mode-independent (composing happens in flame mode). Drawn
  // relative to the letterbox-corrected content rect, host-relative coords.
  // The flame's displayed (letterbox-corrected) content rect, in viewport coords.
  // (edit-paint-region.ts keeps its own copy of this ~9-line helper; #423.)
  const flameContentRect = (): { left: number; top: number; width: number; height: number } => {
    const rect = canvas.getBoundingClientRect();
    const ar = canvas.width / Math.max(1, canvas.height);
    const boxAr = rect.width / Math.max(1, rect.height);
    let w = rect.width, h = rect.height, ox = 0, oy = 0;
    if (boxAr > ar) { w = rect.height * ar; ox = (rect.width - w) / 2; }
    else { h = rect.width / ar; oy = (rect.height - h) / 2; }
    return { left: rect.left + ox, top: rect.top + oy, width: w, height: h };
  };
  composeOverlay = attachComposeOverlay(canvasHost, {
    getPrefs: () => state.compose,
    getContentRect: () => {
      const hostRect = canvasHost.getBoundingClientRect();
      const c = flameContentRect();
      return { x: c.left - hostRect.left, y: c.top - hostRect.top, w: c.width, h: c.height };
    },
  });
  composeMenu = attachComposeMenu({
    getPrefs: () => state.compose,
    onChange: (next) => {
      // #364 — enabling a guide via the picker auto-arms the master, so a check
      // always has a visible effect (no dead picker when master was off).
      const anyGuide = next.thirds || next.center || next.grid || next.rings || next.spokes;
      const merged = anyGuide && !next.composeOn ? { ...next, composeOn: true } : next;
      state.compose = merged; saveComposePrefs(merged); composeOverlay?.draw(); overlays.sync();
    },
  });

  // #372 — the Color-lens Edit-gradient toggle flips state.activeCanvasOverlay and
  // calls this. Gradient turning ON forces the affine gizmo OFF (mutual
  // exclusion; leaving affine-edit restores the composition view), then attaches
  // the bar overlay.
  function syncCanvasOverlay(): void {
    if (state.activeCanvasOverlay === 'gradient' && state.gizmo.editOnCanvas) {
      const next = { ...state.gizmo, editOnCanvas: false };
      state.gizmo = next;
      saveGizmoPrefs(next);
      overlays.sync();
      resetWorkspaceView();
      gizmo?.draw();
    }
    refreshGradientOverlay();
    // #269/#372 — (in)validate point-to-paint capture. Turning ON drops any
    // stale map + kicks a settle so idx_sum is captured; turning OFF disarms the
    // GPU channel so subsequent renders don't pay the per-iter index cost.
    indexMap = null;
    indexMapGenome = null;
    if (state.activeCanvasOverlay === 'gradient') scheduleSettle();
    else { renderer.setCaptureIndex(false); paintRegionHandle.paint(null); }
  }
  state.onCanvasOverlayChange = syncCanvasOverlay;

  // #269/#372 — point-to-paint. The region-tint canvas + flame pointer handlers
  // live in edit-paint-region.ts (#423); the GPU index-capture stays here and the
  // module reads the captured map via getIndexMap. The dblclick body (insert a
  // stop, colored as the gradient currently is at that index) stays here too,
  // since it touches the live palette + gradientOverlay + onPathChange.
  const paintRegionHandle: PaintRegionHandle = attachPaintRegion(canvasHost, canvas, {
    getIndexMap: () => indexMap,
    getActiveOverlay: () => state.activeCanvasOverlay,
    onShowHint: (h) => gradientOverlay?.showHint(h),
    onInsertStop: (t) => {
      if (!gradientOverlay) return;
      const pal = state.genome.palette;
      const rgb = colorAtIndex(pal.stops, pal.hue ?? 0, pal.mode ?? 'linear', t);
      const res = insertStopAtIndex(pal.stops, t, rgb, 0.02);
      if (res.selectedExisting) return;
      state.genome.palette = { ...pal, stops: res.stops };
      gradientOverlay.setPalette(state.genome.palette);
      onPathChange('palette');
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
      // #350 — a fresh flame (reroll / open) appears at its authored composition,
      // not offset by whatever workspace view the user left active on the prior
      // flame. Undo/redo ('preserve') keep the view: it's transient navigation of
      // the SAME flame, so an unrelated edit's undo must not reset the zoom (#358).
      state.view = { ...IDENTITY_VIEW };
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
    // #394/#395 — the on-canvas gizmo overlay reads the live affine but is NOT
    // rebuilt by rebuildPanel, and undo/redo/reset don't change the SELECTION
    // (which is what otherwise triggers a gizmo redraw). Redraw it here so the
    // handles track the restored/new genome. (draw() no-ops when edit-on-canvas
    // is off.) View is already set: 'preserve' keeps it, 'reset' zeroed it above.
    gizmo?.draw();
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
    const indexArmed = armIndexCapture();   // #269/#372 — new genome → recapture idx_sum
    editRenderer.applyLane('slow', adjustedGenomeFor(d.width, d.height), state.seed, view, d.width, d.height, { targetSpp: spp });
    notifyStateChange();
    await awaitGpuThenMaybeHide(myTicket);
    // #269/#372 — read back the palette-index map for point-to-paint (if armed).
    await captureIndexMapIfArmed(indexArmed, myTicket);
    // #175 — refresh the curves histogram for the new flame (reroll / open).
    void captureSettledPixels(myTicket, spp);
  }

  function handleReroll(): void {
    const prevSize = state.genome.size;
    const prevQuality = state.genome.quality;
    const fresh = generateRandomGenome();
    applyDefaultNick(fresh);
    applyEditorDefaults(fresh);
    if (prevSize) {
      fresh.size = { ...prevSize };
    }
    if (prevQuality !== undefined) {
      fresh.quality = prevQuality;
    }
    const freshSeed = (Math.random() * 0xffffffff) >>> 0;
    // #357 — a fresh reroll has no source flame to attribute; hide the chip.
    state.loadedSource = false;
    applyNewGenome(fresh, freshSeed);
  }

  function handleOpenFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    // #196 — accept .png so a saved pyr3 PNG (carrying the genome as a tEXt
    // chunk written in #123) can round-trip back into the editor. #201
    // P0 — also accept .flam3 / .flame XML so users can edit any flame
    // they have on disk; the shared loader (src/loader.ts) already sniffs
    // and dispatches all three formats.
    input.accept = '.pyr3.json,.json,application/json,.png,image/png,.flam3,.flame,text/xml,application/xml';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const result = await load(file);
        const genome = result.genome;
        // Open-file PRESERVES the file's nick (or leaves blank when absent).
        // Only the Reroll path stamps defaultNick (matches the cold-start
        // policy above).
        const prevSize = state.genome.size;
        const prevQuality = state.genome.quality;
        applyEditorDefaults(genome);
        // If the loaded genome doesn't define size / quality, preserve the
        // active ones. (PNG-embedded genomes always carry both; only legacy
        // hand-written JSON fragments might omit them.)
        if (genome.size === undefined && prevSize) {
          genome.size = { ...prevSize };
        }
        if (genome.quality === undefined && prevQuality !== undefined) {
          genome.quality = prevQuality;
        }
        // #357 — a file open IS a genuine load; show the provenance chip.
        state.loadedSource = true;
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

  /** #192 — the effective save name: the user's typed save default (sticky)
   *  takes precedence; the loaded flame's name is the fallback when the user
   *  hasn't overridden. */
  function effectiveSaveName(): string {
    return saveDefaults.flameName.trim() !== ''
      ? saveDefaults.flameName
      : (state.genome.name ?? '');
  }
  function effectiveSaveNick(): string | undefined {
    if (saveDefaults.flameNick.trim() !== '') return saveDefaults.flameNick;
    return state.genome.nick;
  }

  /** #357 — the nick that seeds the naming dialog. The LOADED flame's nick
   *  wins (attribution preserved by default), falling back to the user's
   *  sticky save-default when the flame carries no nick. Editable in the
   *  dialog; overriding is allowed (it's a local save). */
  function seedNick(): string {
    const loaded = state.genome.nick?.trim() ?? '';
    if (loaded !== '') return state.genome.nick!;
    return saveDefaults.flameNick;
  }

  // #357 — templates were dropped from the naming flow; the filename is just
  // the slugified effective save name. The dialog itself live-follows
  // slug(name) until the user edits the filename field manually.
  function resolveCurrentFilename(): string {
    return slugify(effectiveSaveName());
  }

  // #176 — gates the Save Render button + lane-conflict assertions in tests.
  let renderInFlight = false;

  /** #346 — extension shown in the naming dialog's filename preview, derived
   *  from the chosen export format. png8/png16 → png; exr → exr. */
  function extForFormat(format: ExportFormat): string {
    return format === 'exr' ? 'exr' : 'png';
  }

  async function handleRenderPng(
    exportOpts: { format: ExportFormat; transparent: boolean } = { format: 'png8', transparent: false },
  ): Promise<void> {
    if (renderInFlight) return;
    // #346 — save-time naming dialog. Seeds name/nick from the sticky save
    // defaults (+ loaded-flame fallback), filename from the resolved template;
    // computePreview drives the live `→ resolved.ext` tail. Cancel/Escape bails
    // with no render. On commit the chosen name/nick are written back to the
    // sticky save defaults so genomeForSerialize() embeds them.
    const naming = await openNamingDialog({
      kind: 'render',
      seed: {
        name: effectiveSaveName(),
        nick: seedNick(),
        filename: resolveCurrentFilename(),
      },
      ext: extForFormat(exportOpts.format),
    });
    if (!naming) return;
    saveDefaults.flameName = naming.name;
    saveDefaults.flameNick = naming.nick;
    persistSaveDefaults();
    notifyStateChange();
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
    // #195 — compute targetSamples up-front so the modal can show the
    // `<samples> / <target>` readout from the first paint.
    const targetSamples = (state.genome.quality ?? 50) * targetW * targetH;
    const abortCtrl = new AbortController();
    const modal = openRenderProgressModal({
      host: opts.root,
      sizeLabel,
      qualityLabel,
      targetSamples,
      onCancel: () => abortCtrl.abort(),
    });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    try {
      canvas.width = targetW;
      canvas.height = targetH;
      renderer.resize({ width: targetW, height: targetH, oversample, filterRadius });
      // #346 — the user-chosen filename from the naming dialog (no extension).
      const filename = naming.filename;
      // #201 P0 Task 2 — single Save Render fork point shared with the
      // viewer. Helper handles startChunkedRender + AbortSignal bridge +
      // GPU drain + toBlob + injectPngTextChunk + anchor download. Task 7
      // will add the backend fork inside the helper itself.
      const outcome = await saveRenderToPng({
        renderer,
        genome: state.genome,
        canvas,
        ctx,
        device: opts.device,
        abortSignal: abortCtrl.signal,
        // #195 — pass the full per-chunk info to the modal (was just percent).
        onProgress: (info) => modal.setProgress(info),
        filename: `${filename}.png`,
        // #123 — embed the source genome as a `pyr3`-keyed tEXt chunk so
        // the saved PNG is self-describing. #192 — apply save-only name/nick
        // overrides before serialize so the embedded JSON carries the user's
        // typed save defaults, not the loaded flame's identity.
        metadataJson: JSON.stringify(genomeToJson(genomeForSerialize())),
        targetSamples,
        seedBase: state.seed,
        format: exportOpts.format,
        transparent: exportOpts.transparent,
      });
      // outcome === 'cancelled' is silent (modal close + restore is signal enough).
      if (outcome !== 'cancelled') {
        // #176 — post-save toast confirms filename + Downloads landing.
        // #334 — reflect the chosen format's extension.
        const savedExt = exportOpts.format === 'exr' ? 'exr' : 'png';
        showToast(panelHost, `💾 Saved ${filename}.pyr3.${savedExt} to Downloads`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`pyr3-edit: render-PNG failed — ${msg}`);
      showToast(panelHost, `Render failed: ${msg}`);
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
      editRenderer.applyLane('slow', adjustedGenomeFor(restoreDims.width, restoreDims.height), state.seed, view2, restoreDims.width, restoreDims.height, { targetSpp: previewCfg.quality });
      panelHost.removeAttribute('data-busy');
      modal.close();
      renderInFlight = false;
    }
  }

  /** #192 — return a clone of the live genome with name/nick overridden by
   *  the user's save-only typed defaults when they're set. Used at every
   *  serialize-time boundary (Save Flame, Save Render PNG metadata) so the
   *  saved artifact carries the save defaults, not the loaded flame's
   *  identity. The live state.genome is NEVER mutated by this — typing only
   *  affects saveDefaults. */
  function genomeForSerialize(): Genome {
    const overrideNick = effectiveSaveNick();
    return {
      ...state.genome,
      name: effectiveSaveName(),
      nick: overrideNick,
    };
  }

  async function handleSaveFile(): Promise<void> {
    // #346 — save-time naming dialog (Save Flame). Same seed shape as the
    // render path; commits the chosen name/nick to the sticky save defaults
    // before serialize so genomeForSerialize() embeds them. Cancel bails.
    const naming = await openNamingDialog({
      kind: 'flame',
      seed: {
        name: effectiveSaveName(),
        nick: seedNick(),
        filename: resolveCurrentFilename(),
      },
      ext: 'pyr3.json',
    });
    if (!naming) return;
    saveDefaults.flameName = naming.name;
    saveDefaults.flameNick = naming.nick;
    persistSaveDefaults();
    notifyStateChange();
    try {
      // genomeToJson writes the effective save name verbatim; the filename
      // uses the user-chosen form from the dialog.
      const json = JSON.stringify(genomeToJson(genomeForSerialize()), null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${naming.filename}.pyr3.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after a tick so the browser has time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  editRenderer.applyLane('slow', adjustedGenomeFor(initialDims.width, initialDims.height), state.seed, view0, initialDims.width, initialDims.height, { targetSpp: previewCfg.quality });
  notifyStateChange();
  // Sync the bar's SETTLE ladder to the remembered settle value on mount
  // (size/quality already echoed via notifyStateChange → onStateChange).
  opts.onSettleDelayChange?.(settleDelayMs);
  // #175 — fire the curves histogram readback after the first paint settles
  // (cold start never routes through runSettledRender, so wire it here too).
  const coldTicket = inflightTicket;
  void awaitGpuThenMaybeHide(coldTicket).then(() => captureSettledPixels(coldTicket, previewCfg.quality));

  // #176 — mount the render-mode-bar. Wires preview side to the editor's
  // PreviewRenderConfig (persisted to localStorage); render side to
  // genome.size / genome.quality (round-trips with .pyr3.json). Save Render
  // fires handleRenderPng — same path the (now-deprecated) top-bar 🖼️ button
  // uses, so both entry points reach the new progress modal.
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
      applyRenderSizeWithScale(size);
      schedulePersist(state.genome);
      // Size is a sticky render pref — persist so the next flame load (incl. a
      // Surprise Wall handoff) opens at this size, not defaults. The ui-bar 📐
      // dropdown persists via onPathChange('size.*'); the RENDER-section preset
      // dropdown lands here and must do the same (#186 follow-up).
      persistRenderSettings();
      // Aspect may have changed — preview canvas reshapes via rebuild lane.
      scheduler.schedule({ lane: 'rebuild', path: 'size' });
    },
    // #201 P0 — the bar's clampRenderQuality is capability-aware
    // (gh-pages hard-caps at 200; pyr3 serve unlimited). Don't double-
    // clamp here, and don't lie to the user by showing 200 when the
    // genome actually carries q=2000 — Save Render dispatches the raw
    // genome.quality and would otherwise render at 2000 while the bar
    // display said 200. Show the real value; let the bar enforce the cap.
    getRenderQuality: () => Math.max(1, state.genome.quality ?? 50),
    setRenderQuality: (q) => {
      state.genome.quality = Math.max(1, q);
      schedulePersist(state.genome);
      // Quality is a sticky render pref — persist so the next flame load (incl.
      // a Surprise Wall handoff) opens at this quality, not defaults. The ui-bar
      // QUALITY ladder persists via onPathChange('quality'); the RENDER-section
      // ladder + custom input land here and must do the same (#186 follow-up).
      persistRenderSettings();
      // Render-side quality only matters at Save Render time; no re-iterate
      // needed for the live preview (it uses previewCfg.quality, not this).
    },
    onSaveRender: (exp) => handleRenderPng(exp),
    canSave: () => !renderInFlight,
    showToast: (msg) => showToast(panelHost, msg),
  });

  return {
    state,
    setName(name: string): void {
      // #192 + #194 — name is save-only metadata. Write to the sticky
      // saveDefaults (persisted per-browser), NOT to state.genome.name (which
      // carries the LOADED flame's name and is shown in the read-only chip).
      // We do NOT schedule a re-iterate: name has zero render effect — the
      // scheduler.schedule path used to fire here and was the root of the
      // typing-brightens-render bug (#194).
      saveDefaults.flameName = name;
      persistSaveDefaults();
      // Echo the state change so the bar's filename-preview tail re-ticks to
      // the new effective save name.
      notifyStateChange();
    },
    setNick(nick: string): void {
      // #192 + #194 — same save-only semantics as setName above. The author
      // nick is now sticky and never triggers a re-iterate.
      saveDefaults.flameNick = nick;
      persistSaveDefaults();
      notifyStateChange();
    },
    getSaveDefaults(): { flameName: string; flameNick: string } {
      return { flameName: saveDefaults.flameName, flameNick: saveDefaults.flameNick };
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
      void handleSaveFile();
    },
    async saveRender(): Promise<void> {
      await handleRenderPng();
    },
    setSize(width: number, height: number): void {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      const w = Math.round(width);
      const h = Math.round(height);
      applyRenderSizeWithScale({ width: w, height: h });
      // Re-render the panel UI so the Render section's W×H inputs + preset
      // dropdown re-sync to the new dims. The rebuild lane covers the
      // re-iterate at the new dims; opts.onStateChange echo then updates the
      // bar's setDimensions readout.
      rebuildPanel();
      onPathChange('size.width');
      onPathChange('size.height');
      notifyStateChange();
    },
    setQuality(quality: number): void {
      if (!Number.isFinite(quality) || quality <= 0) return;
      state.genome.quality = quality;
      rebuildPanel();
      onPathChange('quality');
      notifyStateChange();
    },
    setSettleDelayMs(ms: number): void {
      // 2026-06-05: bar SETTLE ladder writes here. Mutate the live value
      // + sync the panel's scrubby without firing onSettleDelayChange —
      // the caller (main.ts) already initiated this and will echo to the
      // bar's setSettle highlight itself.
      if (!Number.isFinite(ms) || ms < 0) return;
      settleDelayMs = Math.round(ms);
      persistRenderSettings();
      ui?.setSettleDelayMs(settleDelayMs);
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
      // Mirror undo()'s flush: a fresh edit made after an undo schedules a
      // debounced commit; clicking Redo within that window must commit it
      // BEFORE stepping forward, else applyNewGenome('preserve') replaces
      // state.genome with the redo-tail entry, the surviving timer fires,
      // sees the redone entry (sameContent → no-op) and the user's
      // intervening edit is silently dropped from history. The post-undo
      // push also truncates the redo tail, so canRedo() correctly clears. (#250)
      if (historyCommitTimer !== null) {
        clearTimeout(historyCommitTimer);
        historyCommitTimer = null;
        history.push(state.genome);
      }
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
      detachResize();
      panZoom.destroy();
      document.removeEventListener('pyr3:xform-selection-changed', onGizmoSelectionChange);
      gizmoResizeObs.disconnect();
      gizmo?.destroy();
      composeOverlay?.destroy();
      composeMenu?.destroy();
      gradientOverlay?.destroy();
      paintRegionHandle.destroy();
      overlays.destroy();
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
