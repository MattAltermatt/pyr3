// pyr3 — /editor state model + lane dispatcher + per-lane debouncer.
//
// EditState owns the live Genome plus UI bookkeeping (per-section collapse,
// per-xform collapse). The lane categoriser is a pure function of the
// genome path that changed; the scheduler coalesces edits into per-lane
// debounce windows so palette/tonemap drags don't queue-thrash the
// renderer. Both helpers are dependency-injected (clock, debounceMs) so
// tests stay synchronous.
//
// Lane semantics — see docs/superpowers/specs/2026-06-03-flame-editor-v1-design.md.

import { type Genome } from './genome';
import { type PaletteSource } from './flam3-palette-names';
import { type WorkspaceView, IDENTITY_VIEW } from './edit-camera-projection';

export type Lane = 'fast' | 'slow' | 'rebuild';

// Pure path → lane categorisation. Path is dotted: 'xforms.1.variations.0.weight',
// 'palette.hue', 'size.width'. Unknown paths fall through to 'fast' (the cheapest
// lane) — that's the safe default because at worst it costs an extra present(),
// not a chaos re-iterate.
//
// Palette caveat: chaos.wgsl reads the palette LUT *during iteration* and
// scatters already-coloured RGB into the histogram (see chaos.wgsl line 1957+).
// So palette swaps / hue / mode all force a slow-lane re-iterate — re-running
// visualize alone against an old-palette histogram leaves the colours stale.
// If we ever store color-INDEX in the histogram and apply palette at visualize
// time, palette.* can move back to fast lane.
export function pathLane(path: string): Lane {
  if (path === 'size.width' || path === 'size.height') return 'rebuild';
  if (path === 'oversample') return 'rebuild';
  if (path === 'spatialFilter.radius') return 'rebuild';
  if (path === 'palette' || path.startsWith('palette.')) return 'slow';
  // genome.paletteMode (top-level, flam3 spec — scatter-time sampling)
  if (path === 'paletteMode') return 'slow';
  // quality re-iterates because spp = samples-per-pixel — only a fresh
  // chaos run produces denser hits.
  if (path === 'quality') return 'slow';
  if (path.startsWith('xforms') || path.startsWith('finalxform')) return 'slow';
  if (path === 'scale' || path === 'cx' || path === 'cy' || path === 'rotate') return 'slow';
  if (path.startsWith('symmetry')) return 'slow';
  // Issue #116 — channelCurves are visualize-only (no chaos re-iterate
  // needed). Explicit rule documents the contract; would fall through to
  // 'fast' as default anyway, but the explicit form survives a future
  // change of the default.
  if (path === 'channelCurves' || path.startsWith('channelCurves.')) return 'fast';
  if (path === 'hslAdjust' || path.startsWith('hslAdjust.')) return 'fast';
  return 'fast';
}

export interface StateChange {
  lane: Lane;
  path: string;
}

export type SectionKey =
  | 'palette'
  | 'color-mode'
  | 'curves'
  | 'scopes'
  | 'hsl'
  | 'viewport'
  | 'xforms'
  | 'global-symmetry'
  | 'global-tonemap'
  | 'density'
  | 'render';

/** The four top-level editor lenses (4-lens IA, #27). */
export type LensKey = 'xform' | 'scene' | 'color' | 'output';

/** Sub-groups within the Color lens — static DEFINE→GRADE dividers (#358). */
export type SectionGroup = 'palette' | 'grading' | 'xforms';
const LENS_VALUES: readonly LensKey[] = ['xform', 'scene', 'color', 'output'];
export const PANEL_WIDTH_MIN = 280;
export const PANEL_WIDTH_MAX = 560;
export const PANEL_WIDTH_DEFAULT = 360;

/** Sentinel `selectedXformIndex` value meaning "the final xform is selected". */
export const FINAL_SEL = -1;

export interface EditState {
  genome: Genome;
  seed: number;
  /** #357 — true when the live genome arrived from a genuine LOAD (file open ·
   *  viewer→editor transfer · corpus deep-link), false for a generated source
   *  (cold-start reroll · 🎲 Reroll · catalog scaffold · restored WIP). Drives
   *  the editor bar's read-only "📂 loaded from …" provenance chip, which is
   *  hidden when there's no real load to attribute. UI-only; never serialized. */
  loadedSource?: boolean;
  preview: { width: number; height: number };
  sectionCollapse: Record<SectionKey, boolean>;
  /** Active editor lens (4-lens IA, #27). Per-browser pref. UI-only. */
  activeLens: LensKey;
  /** Drag-resizable panel width in px (clamped PANEL_WIDTH_MIN..MAX). Pref. */
  panelWidth: number;
  /** Index of the xform the editor is "working on" — drives the XForm-lens
   *  detail + on-canvas gizmo (#350). Phase 1 stores it; Phase 2 wires the UI.
   *  Session-only, not persisted. Defaults to 0. */
  selectedXformIndex: number;
  /** #350 Phase 2.3 — on-canvas gizmo prefs (UI-only, per-browser; NOT serialized). */
  gizmo: GizmoPrefs;
  /** #376 — active on-canvas gizmo lens: which affine the gizmo edits. 'post' is
   *  only meaningful when the selected xform has a post-transform. Transient,
   *  UI-only; NEVER serialized. Resets to 'pre' on selection change. */
  gizmoLens: 'pre' | 'post';
  /** #364 — compositional overlay prefs (UI-only, per-browser; NOT serialized). */
  compose: ComposePrefs;
  /** #372 — which on-canvas overlay is live. The affine gizmo (XForm lens) and
   *  the gradient bar (Color lens) are mutually exclusive — only one is ever
   *  attached. UI-only, session-scoped; NOT serialized. */
  activeCanvasOverlay: 'none' | 'gizmo' | 'gradient';
  /** #372 — fired by the Color lens' Edit-gradient toggle (and the reciprocal
   *  gizmo toggle) so the editor host (edit-mount) can attach/detach the
   *  matching overlay. Wired at build time; UI-only, never serialized. */
  onCanvasOverlayChange?: () => void;
  /** Editor-only workspace view (pan/zoom) layered on top of the genome
   *  composition camera. NEVER serialized + NEVER persisted — it lets on-canvas
   *  editing frame an xform without disturbing the saved composition. Default
   *  identity; reset to identity on every flame load (#350 follow-up). */
  view: WorkspaceView;
  /** Per-group collapse for the XForm-lens detail sub-accordions (#350 Phase
   *  2.2). Global pref across xforms; persisted per-browser. */
  xformDetailCollapse: Record<XformDetailGroup, boolean>;
  /** Background-mirror bus (#27): the Color + Output background controls both
   *  push a listener here; whoever edits notifies the other to refresh its
   *  swatch. UI-only; never serialized. */
  backgroundListeners?: Array<(rgb: readonly [number, number, number]) => void>;
  /** Transient solo state. Present when an xform / variation is currently
   *  "soloed" via shift-click. Cleared when solo exits or the genome
   *  changes. Not persisted to .pyr3.json. */
  soloXformSnapshot?: SoloSnapshot;
  /** Per-xform-index variation solo snapshot. Keyed by xform index. */
  soloVariationSnapshot?: Record<number, SoloSnapshot>;
  /** Last tonemap preset applied via the Tonemap section's preset strip.
   *  Used by the header chip to display dirty-state (e.g. `vivid*`) when the
   *  user manually nudges a tonemap value off the preset's exact triple.
   *  UI-only; never serialized. (#397 relocated the strip to the Tonemap
   *  section; field name kept to avoid churn.) */
  lastDensityPreset?: string;
  /** #397 — remembered `density.maxRad` while DE is toggled off in the
   *  DENSITY ESTIMATION section. Restored when the toggle is flipped back on.
   *  UI-transient; never serialized. */
  deRestoreMaxRad?: number;
  /** Phase 9 — palette subpanel launcher / ribbon-click both invoke this
   *  to open the docked palette picker. Wired by the editor's mount-fn at
   *  build time; sections never construct the picker themselves. UI-only;
   *  never serialized. */
  openPalettePicker?: () => void;
  /** Phase 9 — set by the editor host to the canonical PaletteSource for
   *  the currently-loaded palette. Drives the launcher button text via
   *  paletteIdentifier(). Defaults to `flame #N` inferred from
   *  state.genome.palette.name when unset. */
  paletteSource?: PaletteSource;
  /** #175 — sections push a listener here in build(); the editor host
   *  (edit-mount) invokes them after each settled render with the post-
   *  tonemap, PRE-curve canvas pixels (true RGBA, channel-swap undone). The
   *  Color Curves histogram overlay is the consumer — it wants the INPUT-
   *  referred (pre-curve) distribution so its backdrop stays still while the
   *  user drags spline points. UI-only; never serialized. */
  settledPixelsListeners?: Array<(pixels: SettledPixels) => void>;
  /** #174 — like settledPixelsListeners, but fed the fully-GRADED canvas
   *  pixels (channelCurves + all adjustments applied) — i.e. exactly what the
   *  user sees on screen. The Scopes panel consumes this: a grading scope must
   *  reflect the graded output, so it responds live to curve/HSL edits. Costs
   *  a second offscreen re-present + readback per settle (settle-only). Only
   *  fired when at least one listener is registered. UI-only; never serialized. */
  gradedPixelsListeners?: Array<(pixels: SettledPixels) => void>;
}

/** Post-tonemap canvas pixels emitted on render-settle (#175). `rgba` is
 *  tightly packed (4 bytes/pixel, no row padding) and in TRUE RGBA order
 *  regardless of the swap-chain's bgra8unorm/rgba8unorm format. Whether the
 *  pixels are PRE-curve (settledPixelsListeners) or fully GRADED
 *  (gradedPixelsListeners) depends on which feed delivered them. */
export interface SettledPixels {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export function createEditState(genome: Genome, seed: number): EditState {
  return {
    genome,
    seed,
    preview: { width: 512, height: 512 },
    sectionCollapse: {
      // #27 — subpanels start EXPANDED on first load (collapse=false); the
      // user's per-section open/closed choices then persist between sessions.
      palette: false,
      'color-mode': false,
      curves: false,
      scopes: false,
      hsl: false,
      viewport: false,
      xforms: false,
      'global-symmetry': false,
      'global-tonemap': false,
      density: false,
      render: false,
    },
    activeLens: restoreActiveLens(),
    panelWidth: restorePanelWidth(),
    selectedXformIndex: 0,
    gizmo: loadGizmoPrefs(),
    gizmoLens: 'pre',
    compose: loadComposePrefs(),
    activeCanvasOverlay: 'none',
    view: { ...IDENTITY_VIEW },
    xformDetailCollapse: restoreXformDetailCollapse(),
  };
}

// Injectable clock for tests. Default = globalThis (setTimeout/clearTimeout).
export interface Clock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export const DEFAULT_DEBOUNCE_MS: Record<Lane, number> = {
  fast: 16,
  // Short debounce so the live (small-canvas) preview keeps up with slider
  // drags & rapid keystrokes — the editor's Apophysis-style live/settled
  // split (in edit-mount.ts) renders each slow-lane fire at downsized dims
  // for snappy feedback. A separate settle timer (default 500ms, see
  // DEFAULT_EDIT_RENDER_SETTINGS.settleMs) kicks the final full-dim/quality
  // render once the user stops fiddling.
  slow: 80,
  rebuild: 80,
};

export interface LaneScheduler {
  /** Add an edit to its lane's pending set; (re)start that lane's debounce timer. */
  schedule(change: StateChange): void;
  /** Fire all pending paths for `lane` (or all lanes if omitted) immediately. */
  flush(lane?: Lane): void;
  /** Drop all pending edits and clear timers. Use at teardown. */
  cancel(): void;
}

export function createLaneScheduler(
  onFire: (lane: Lane, paths: string[]) => void,
  opts: { clock?: Clock; debounceMs?: Record<Lane, number> } = {},
): LaneScheduler {
  const clock: Clock = opts.clock ?? (globalThis as unknown as Clock);
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const pending: Record<Lane, Set<string>> = {
    fast: new Set(),
    slow: new Set(),
    rebuild: new Set(),
  };
  const timers: Record<Lane, unknown> = {
    fast: undefined,
    slow: undefined,
    rebuild: undefined,
  };

  function flushLane(lane: Lane): void {
    const paths = [...pending[lane]];
    if (paths.length === 0) return;
    pending[lane].clear();
    timers[lane] = undefined;
    onFire(lane, paths);
  }

  return {
    schedule(change: StateChange): void {
      pending[change.lane].add(change.path);
      const existing = timers[change.lane];
      if (existing !== undefined) clock.clearTimeout(existing);
      timers[change.lane] = clock.setTimeout(
        () => flushLane(change.lane),
        debounceMs[change.lane],
      );
    },
    flush(lane?: Lane): void {
      if (lane) flushLane(lane);
      else {
        flushLane('fast');
        flushLane('slow');
        flushLane('rebuild');
      }
    },
    cancel(): void {
      for (const k of ['fast', 'slow', 'rebuild'] as const) {
        const t = timers[k];
        if (t !== undefined) clock.clearTimeout(t);
        timers[k] = undefined;
        pending[k].clear();
      }
    },
  };
}

// ── #103 Phase 6 Task 6.3 — WIP genome persistence ────────────────────
// The editor stores its in-progress genome to localStorage on every edit so
// that a tab reload / browser close doesn't drop the user's work. Cold-start
// (mountEditPage) calls restoreWip() and uses the result as the initial
// genome when present; otherwise the existing random-reroll path runs.
// schedulePersist() debounces by 200ms so a rapid slider drag doesn't burn
// 100 setItem calls per second.

export const WIP_KEY = 'pyr3.editor.wip';

/** Write the genome JSON to localStorage immediately. Best-effort —
 *  localStorage may be disabled (private mode, storage-full); failures are
 *  swallowed so the editor stays interactive. */
export function persistWip(genome: Genome): void {
  try {
    globalThis.localStorage?.setItem(WIP_KEY, JSON.stringify(genome));
  } catch {
    // localStorage disabled (private browsing) or quota exceeded — no-op.
  }
}

/** #421 — minimal structural validation for a restored WIP genome. A blob whose
 *  JSON parses but whose *shape* is stale/incompatible (e.g. a pre-migration
 *  schema, or hand-planted junk) must NOT be handed to editor init: the renderer
 *  indexes `xforms[0]` / `palette.stops[0]`, so a missing/empty array crashes the
 *  whole `/editor` mount with no recovery. We check only the invariants the
 *  renderer hard-assumes — the non-optional `Genome` fields — so a genuinely
 *  valid (if old-but-compatible) flame still restores; anything else fails soft
 *  to the reroll path. This is intentionally shallow: it guards structure, not
 *  semantics. (A future `_v` schema-version tag could enable deterministic
 *  migration/upgrade of stale payloads — see #421.) */
function isStructurallyValidGenome(obj: unknown): obj is Genome {
  if (typeof obj !== 'object' || obj === null) return false;
  const g = obj as Record<string, unknown>;
  if (typeof g.name !== 'string') return false;
  if (!Array.isArray(g.xforms) || g.xforms.length === 0) return false;
  if (!Number.isFinite(g.scale) || !Number.isFinite(g.cx) || !Number.isFinite(g.cy)) return false;
  const palette = g.palette as Record<string, unknown> | null | undefined;
  if (typeof palette !== 'object' || palette === null) return false;
  if (!Array.isArray(palette.stops) || palette.stops.length === 0) return false;
  return true;
}

/** Read the persisted genome back. Returns null when:
 *   • the key isn't present (first visit / cleared storage)
 *   • the stored JSON is malformed (corrupted by a partial write)
 *   • the parsed value fails minimal structural validation (#421 — stale schema
 *     / hand-planted junk that would crash editor init)
 *   • localStorage itself throws (private mode).
 *
 *  The caller (mountEditPage cold-start) treats null as "no saved WIP" and
 *  falls back to the random-reroll path. */
export function restoreWip(): Genome | null {
  try {
    const raw = globalThis.localStorage?.getItem(WIP_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStructurallyValidGenome(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ── Editor render settings — sticky workstation pref ──────────────────
// Size / Quality / Settle are the editor's RENDER controls. They used to ride
// on the genome (size/quality) or default per-mount (settle=500ms), which meant
// loading a flame that didn't carry them — e.g. a Surprise Wall flame — reset
// them to defaults. Per the #176 "render config is a workstation pref, not part
// of the flame artifact" principle, persist them per-browser and re-apply on
// every load so the editor keeps the values the user last chose, regardless of
// which flame opens.

export const EDIT_RENDER_SETTINGS_KEY = 'pyr3.edit.render-settings';

export interface EditRenderSettings {
  size: { width: number; height: number };
  quality: number;
  settleMs: number;
}

export const DEFAULT_EDIT_RENDER_SETTINGS: EditRenderSettings = {
  // #360 — match #341's viewer default (4K · q200). The editor keeps its own
  // sticky pref (EDIT_RENDER_SETTINGS_KEY); this is only the fresh-browser /
  // no-stored-pref default, brought in line with the viewer.
  size: { width: 3840, height: 2160 },
  quality: 200,
  settleMs: 500,
};

/** Read the sticky editor render settings, falling back to defaults for any
 *  missing / malformed field. Always returns a usable object. */
export function loadEditRenderSettings(): EditRenderSettings {
  try {
    const raw = globalThis.localStorage?.getItem(EDIT_RENDER_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_EDIT_RENDER_SETTINGS };
    const p = JSON.parse(raw) as Partial<EditRenderSettings> & { _v?: number };
    const sz = p.size;
    const width = sz && Number.isFinite(sz.width) && sz.width > 0 ? Math.round(sz.width) : DEFAULT_EDIT_RENDER_SETTINGS.size.width;
    const height = sz && Number.isFinite(sz.height) && sz.height > 0 ? Math.round(sz.height) : DEFAULT_EDIT_RENDER_SETTINGS.size.height;
    const quality = Number.isFinite(p.quality) && (p.quality as number) > 0 ? (p.quality as number) : DEFAULT_EDIT_RENDER_SETTINGS.quality;
    const settleMs = Number.isFinite(p.settleMs) && (p.settleMs as number) >= 0 ? Math.round(p.settleMs as number) : DEFAULT_EDIT_RENDER_SETTINGS.settleMs;
    return { size: { width, height }, quality, settleMs };
  } catch {
    return { ...DEFAULT_EDIT_RENDER_SETTINGS };
  }
}

/** Persist the sticky editor render settings. Best-effort (private mode/quota). */
export function saveEditRenderSettings(s: EditRenderSettings): void {
  try {
    globalThis.localStorage?.setItem(EDIT_RENDER_SETTINGS_KEY, JSON.stringify({ _v: 1, ...s }));
  } catch {
    // localStorage disabled / full — no-op.
  }
}

// ── Viewer → Editor pending-transfer ──────────────────────────────────
// When the user clicks the editor tab from the viewer with a file-opened (not
// corpus) genome loaded, we need to carry that genome across the navigation.
// The cross-surface in-memory CurrentFlame context doesn't survive a full page
// nav, so we stash the genome in localStorage under a tiny-TTL key. Cold-start
// reads it first (ahead of restoreWip()), uses it as the initial genome, then
// deletes the key so a refresh later doesn't resurrect it.

export const PENDING_TRANSFER_KEY = 'pyr3.editor.pendingTransfer';

/** TTL on the pending-transfer key. The handoff is a single click → page
 *  load round trip — anything older than this is stale (the user backed out
 *  and came back another way; or the cleanup below didn't run). */
export const PENDING_TRANSFER_TTL_MS = 5000;

export interface PendingTransfer {
  genome: Genome;
  /** Optional — preserved when the viewer's flame came from a corpus URL. */
  corpusId: { gen: number; id: number } | null;
  /** Date.now() at write time; consumer checks freshness. */
  timestamp: number;
}

/** Stash a pending-transfer payload. Best-effort (private mode / quota). */
export function writePendingTransfer(payload: PendingTransfer): void {
  try {
    globalThis.localStorage?.setItem(PENDING_TRANSFER_KEY, JSON.stringify(payload));
  } catch {
    // localStorage disabled / full — silently no-op; the editor falls back
    // to the normal WIP/random cold-start path.
  }
}

/** Consume a pending-transfer payload — read it, validate it, delete it,
 *  return the genome (or null when the slot is empty / stale / malformed).
 *  Deleting on read makes the handoff a single-shot, so a subsequent refresh
 *  doesn't keep replaying it. */
export function consumePendingTransfer(): PendingTransfer | null {
  try {
    const raw = globalThis.localStorage?.getItem(PENDING_TRANSFER_KEY);
    if (!raw) return null;
    // Remove first so a malformed / stale slot still clears.
    globalThis.localStorage?.removeItem(PENDING_TRANSFER_KEY);
    const parsed = JSON.parse(raw) as Partial<PendingTransfer>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.timestamp !== 'number') return null;
    if (Date.now() - parsed.timestamp > PENDING_TRANSFER_TTL_MS) return null;
    if (!parsed.genome) return null;
    return {
      genome: parsed.genome as Genome,
      corpusId: parsed.corpusId ?? null,
      timestamp: parsed.timestamp,
    };
  } catch {
    return null;
  }
}

// Debounced persistence — coalesces a rapid edit stream into a single
// localStorage write 200ms after the LAST edit. The timer lives at module
// scope so consecutive schedulePersist() calls share / reset the same timer.
let _persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Queue a debounced persistWip. If another schedulePersist lands within
 *  200ms, the prior pending write is cancelled and the new genome takes
 *  its place — the LAST scheduled value wins. */
export function schedulePersist(genome: Genome): void {
  if (_persistTimer !== null) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    persistWip(genome);
  }, 200);
}

// ── #103 Phase 6 Task 6.4 — Section-collapse persistence ──────────────
// Per-section collapse state survives reloads. Default (no key present /
// malformed JSON) is the existing all-collapsed map preserved from #102.

export const SECTION_COLLAPSE_KEY = 'pyr3.editor.sectionCollapse';

// ── Lens + panel-width prefs (4-lens IA, #27) ──────────────────────────────
export const LENS_KEY = 'pyr3.editor.activeLens';
export const PANEL_WIDTH_KEY = 'pyr3.editor.panelWidth';

/** Persist the active lens. Best-effort; swallows localStorage failures. */
export function persistActiveLens(lens: LensKey): void {
  try { globalThis.localStorage?.setItem(LENS_KEY, lens); } catch { /* no-op */ }
}
/** Read the active lens; falls back to 'xform' on absent/garbage/throw. */
export function restoreActiveLens(): LensKey {
  try {
    const raw = globalThis.localStorage?.getItem(LENS_KEY);
    return LENS_VALUES.includes(raw as LensKey) ? (raw as LensKey) : 'xform';
  } catch { return 'xform'; }
}
/** Persist the panel width (px). Best-effort. */
export function persistPanelWidth(px: number): void {
  try { globalThis.localStorage?.setItem(PANEL_WIDTH_KEY, String(Math.round(px))); } catch { /* no-op */ }
}
/** Read the panel width, clamped to [MIN,MAX]; default when absent/garbage. */
export function restorePanelWidth(): number {
  try {
    const n = Number(globalThis.localStorage?.getItem(PANEL_WIDTH_KEY));
    if (!Number.isFinite(n) || n === 0) return PANEL_WIDTH_DEFAULT;
    return Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, n));
  } catch { return PANEL_WIDTH_DEFAULT; }
}

// #27 — subpanels start EXPANDED (collapse=false) on first load; persisted
// per-section choices win on subsequent sessions (restoreSectionCollapse).
const DEFAULT_SECTION_COLLAPSE: Record<SectionKey, boolean> = {
  palette: false,
  'color-mode': false,
  curves: false,
  scopes: false,
  hsl: false,
  viewport: false,
  xforms: false,
  'global-symmetry': false,
  'global-tonemap': false,
  density: false,
  render: false,
};

/** Persist the per-section collapse map immediately. No debounce — toggle
 *  events are rare (one per section-header click). Best-effort; swallows
 *  any localStorage failure. */
export function persistSectionCollapse(map: Record<SectionKey, boolean>): void {
  try {
    globalThis.localStorage?.setItem(SECTION_COLLAPSE_KEY, JSON.stringify(map));
  } catch {
    // localStorage disabled or full — no-op; the in-memory map continues
    // to drive this session.
  }
}

/** Read the persisted section-collapse map. Returns the default
 *  all-collapsed map when the key is absent, JSON is malformed, or
 *  localStorage throws. Always returns a fresh copy so callers can mutate. */
export function restoreSectionCollapse(): Record<SectionKey, boolean> {
  try {
    const raw = globalThis.localStorage?.getItem(SECTION_COLLAPSE_KEY);
    if (!raw) return { ...DEFAULT_SECTION_COLLAPSE };
    const parsed = JSON.parse(raw) as Record<SectionKey, boolean>;
    // Merge over the default so a partial / older shape still produces all
    // SectionKey keys; persisted values win where present.
    return { ...DEFAULT_SECTION_COLLAPSE, ...parsed };
  } catch {
    return { ...DEFAULT_SECTION_COLLAPSE };
  }
}

// ── XForm-lens detail sub-accordions (#350 Phase 2.2) ──────────────────────
// The selected xform's detail pane groups its controls into four collapsible
// sub-accordions. Collapse is a per-browser PREF (global across xforms, like
// section-collapse — not per-xform-index), so "I always want Xaos folded
// away" sticks. Default mirrors the spec mockup: Affine open, the rest folded.
export type XformDetailGroup = 'affine' | 'variations' | 'color' | 'xaos';

export const XFORM_DETAIL_COLLAPSE_KEY = 'pyr3.editor.xformDetailCollapse';

const DEFAULT_XFORM_DETAIL_COLLAPSE: Record<XformDetailGroup, boolean> = {
  // #438 — all subpanels open on load so a freshly-opened flame shows its own
  // structure. Collapse is remembered only AFTER the user collapses a group:
  // persistXformDetailCollapse fires on each toggle and restoreXformDetailCollapse
  // merges the saved map over this default.
  affine: false,
  variations: false,
  color: false,
  xaos: false,
};

/** Persist the per-group detail-collapse map immediately (toggle events are
 *  rare). Best-effort; swallows any localStorage failure. */
export function persistXformDetailCollapse(map: Record<XformDetailGroup, boolean>): void {
  try {
    globalThis.localStorage?.setItem(XFORM_DETAIL_COLLAPSE_KEY, JSON.stringify(map));
  } catch {
    // localStorage disabled or full — no-op; in-memory map drives this session.
  }
}

/** Read the persisted detail-collapse map, merged over the default so a
 *  partial / older shape still yields all four keys. Fresh copy each call. */
export function restoreXformDetailCollapse(): Record<XformDetailGroup, boolean> {
  try {
    const raw = globalThis.localStorage?.getItem(XFORM_DETAIL_COLLAPSE_KEY);
    if (!raw) return { ...DEFAULT_XFORM_DETAIL_COLLAPSE };
    const parsed = JSON.parse(raw) as Record<XformDetailGroup, boolean>;
    return { ...DEFAULT_XFORM_DETAIL_COLLAPSE, ...parsed };
  } catch {
    return { ...DEFAULT_XFORM_DETAIL_COLLAPSE };
  }
}

// ── #350 Phase 2.3 — on-canvas gizmo prefs (UI-only, per-browser) ─────
export interface GizmoPrefs {
  /** ✏️ edit-affine-on-canvas master toggle. Default OFF. */
  editOnCanvas: boolean;
  /** ▦ world-coordinate reference grid. */
  showWorldGrid: boolean;
  /** ☐ persistent snap (snap without holding Shift). */
  snapEnabled: boolean;
  /** Translate/scale snap step in world units. */
  snapStep: number;
  /** Rotation snap step in degrees. */
  snapAngleStep: number;
}

export const GIZMO_PREFS_DEFAULT: GizmoPrefs = {
  editOnCanvas: false,
  showWorldGrid: false,
  snapEnabled: false,
  snapStep: 0.1,
  snapAngleStep: 15,
};

const GIZMO_PREFS_KEY = 'pyr3.edit.gizmo';

/** Load gizmo prefs from localStorage; defaults on miss/malformed/disabled. */
export function loadGizmoPrefs(): GizmoPrefs {
  try {
    const raw = globalThis.localStorage?.getItem(GIZMO_PREFS_KEY);
    if (!raw) return { ...GIZMO_PREFS_DEFAULT };
    const parsed = JSON.parse(raw) as Partial<GizmoPrefs>;
    return {
      // #350 — the editor always opens in FLAME mode (pannable/zoomable flame);
      // edit-on-canvas is session-only, never restored from storage.
      editOnCanvas: false,
      showWorldGrid: parsed.showWorldGrid ?? GIZMO_PREFS_DEFAULT.showWorldGrid,
      snapEnabled: parsed.snapEnabled ?? GIZMO_PREFS_DEFAULT.snapEnabled,
      snapStep: Number.isFinite(parsed.snapStep) ? (parsed.snapStep as number) : GIZMO_PREFS_DEFAULT.snapStep,
      snapAngleStep: Number.isFinite(parsed.snapAngleStep) ? (parsed.snapAngleStep as number) : GIZMO_PREFS_DEFAULT.snapAngleStep,
    };
  } catch {
    return { ...GIZMO_PREFS_DEFAULT };
  }
}

/** Persist gizmo prefs. Best-effort; swallows localStorage failures. */
export function saveGizmoPrefs(p: GizmoPrefs): void {
  try {
    globalThis.localStorage?.setItem(GIZMO_PREFS_KEY, JSON.stringify(p));
  } catch {
    // localStorage disabled / full — no-op.
  }
}

// ── #364 — compositional overlay prefs (UI-only, per-browser) ─────────
export interface ComposePrefs {
  /** Master on/off. When false, NO guide draws — but the per-guide selections
   *  below are preserved, so flipping back on restores the same set. */
  composeOn: boolean;
  thirds: boolean;
  center: boolean;
  grid: boolean;
  rings: boolean;
  spokes: boolean;
  /** Radial-spokes fold count, clamped 2..12. */
  spokeFold: number;
  /** #402 — golden-ratio / Fibonacci spiral guide. */
  goldenSpiral: boolean;
  /** #402 — spiral orientation, one of 4 quadrant flips (0..3). */
  spiralOrient: number;
  /** #403 — when true, radial spokes auto-match the genome's rotational
   *  symmetry order (falling back to spokeFold when none is present). */
  spokesAuto: boolean;
}

export const COMPOSE_PREFS_DEFAULT: ComposePrefs = {
  composeOn: true, thirds: false, center: false, grid: false, rings: false, spokes: false, spokeFold: 6,
  goldenSpiral: false, spiralOrient: 0, spokesAuto: false,
};

const COMPOSE_PREFS_KEY = 'pyr3.edit.compose';

/** Load compose prefs from localStorage; defaults on miss/malformed. spokeFold clamped 2..12. */
export function loadComposePrefs(): ComposePrefs {
  try {
    const raw = globalThis.localStorage?.getItem(COMPOSE_PREFS_KEY);
    if (!raw) return { ...COMPOSE_PREFS_DEFAULT };
    const p = JSON.parse(raw) as Partial<ComposePrefs>;
    const fold = Number(p.spokeFold);
    const orient = Number(p.spiralOrient);
    return {
      composeOn: p.composeOn !== false, // default ON (absent in legacy prefs)
      thirds: !!p.thirds, center: !!p.center, grid: !!p.grid,
      rings: !!p.rings, spokes: !!p.spokes,
      spokeFold: Number.isFinite(fold) ? Math.min(12, Math.max(2, Math.round(fold))) : 6,
      goldenSpiral: !!p.goldenSpiral,
      spiralOrient: Number.isFinite(orient) ? Math.min(3, Math.max(0, Math.round(orient))) : 0,
      spokesAuto: !!p.spokesAuto,
    };
  } catch {
    return { ...COMPOSE_PREFS_DEFAULT };
  }
}

/** Persist compose prefs. Best-effort; swallows localStorage failures. */
export function saveComposePrefs(p: ComposePrefs): void {
  try {
    globalThis.localStorage?.setItem(COMPOSE_PREFS_KEY, JSON.stringify(p));
  } catch {
    // localStorage disabled / full — no-op.
  }
}

/** #372 — set the live on-canvas overlay. The gizmo and the gradient bar are
 *  mutually exclusive: switching always replaces, never stacks. The editor host
 *  reacts via state.onCanvasOverlayChange to attach/detach the matching overlay. */
export function setActiveCanvasOverlay(
  state: EditState,
  which: 'none' | 'gizmo' | 'gradient',
): void {
  state.activeCanvasOverlay = which;
}

// ── #103 Phase 6 Task 6.5 — Cold-start hydration helpers ──────────────
// mountEditPage's cold-start path needs (a) the starting genome and
// (b) the initial section-collapse map. These wrap restoreWip() /
// restoreSectionCollapse() with the fall-back behaviour the editor wants:
// a missing or malformed WIP triggers a fresh random reroll; a missing or
// malformed collapse map yields the default all-collapsed (#102 preserved).

/** Resolve the starting genome at editor mount. Priority:
 *    1. A fresh viewer→editor pending-transfer (TTL-checked, single-shot)
 *    2. The persisted WIP from a prior editor session
 *    3. `rerollFn()` — caller's fresh-random-genome fallback
 *
 *  The pending-transfer slot is CONSUMED on read so a later refresh doesn't
 *  replay the same handoff. The transfer takes priority over WIP because the
 *  user's action ("open file in viewer → click editor tab") is more explicit
 *  than "fall back to whatever I was last editing". */
export function resolveColdStartGenome(rerollFn: () => Genome): Genome {
  return resolveColdStartGenomeWithSource(rerollFn).genome;
}

/** Source-tagged variant of resolveColdStartGenome. Callers who need to
 *  treat the three paths differently — e.g. only stamp the user's stored
 *  defaultNick on the fresh reroll path, never on a pending transfer or a
 *  restored WIP — branch on the source tag. */
export type ColdStartGenomeSource = 'pending' | 'wip' | 'reroll';

export interface ColdStartGenomeResult {
  genome: Genome;
  source: ColdStartGenomeSource;
}

export function resolveColdStartGenomeWithSource(rerollFn: () => Genome): ColdStartGenomeResult {
  const pending = consumePendingTransfer();
  if (pending) return { genome: pending.genome, source: 'pending' };
  const wip = restoreWip();
  if (wip) return { genome: wip, source: 'wip' };
  return { genome: rerollFn(), source: 'reroll' };
}

/** #344 — persist the cold-start genome to WIP *only* on the `reroll` path.
 *  Without this, the first-visit random reroll is never written to localStorage
 *  (schedulePersist fires only on the next user edit), so a reload re-rerolls a
 *  brand-new flame and the "remember my last flame" contract silently fails.
 *  The `pending` and `wip` sources need no persist here: a restored `wip` is
 *  already in storage, and a `pending` transfer is intentionally single-shot
 *  (it's consumed on read, then the user's first edit persists it as WIP).
 *  Call AFTER the mount has applied defaultNick / editor defaults so the
 *  persisted copy matches what the user sees. */
export function persistColdStartIfReroll(source: ColdStartGenomeSource, genome: Genome): void {
  if (source === 'reroll') persistWip(genome);
}

/** Resolve the initial section-collapse map at editor mount. Wraps
 *  restoreSectionCollapse() — kept as a named cold-start entry point so the
 *  intent at the mountEditPage callsite is obvious. */
export function resolveColdStartCollapse(): Record<SectionKey, boolean> {
  return restoreSectionCollapse();
}

/** Transient UI-only solo state. Captured when shift-click activates solo on
 *  an xform / variation; restored when solo exits. */
export interface SoloSnapshot {
  targetIndex: number;
  others: Record<number, boolean | undefined>;
}

/** Snapshot every item's `active` state EXCEPT the soloed index. Caller is
 *  responsible for setting `targetIndex` items' active values to false
 *  afterward. */
export function snapshotForSolo(items: Array<{ active?: boolean }>, targetIndex: number): SoloSnapshot {
  const others: Record<number, boolean | undefined> = {};
  for (let i = 0; i < items.length; i++) {
    if (i !== targetIndex) others[i] = items[i]!.active;
  }
  return { targetIndex, others };
}

/** Restore the prior `active` state captured in the snapshot. Idempotent. */
export function restoreFromSolo(items: Array<{ active?: boolean }>, snap: SoloSnapshot): void {
  for (const [idxStr, prev] of Object.entries(snap.others)) {
    const i = Number(idxStr);
    if (i >= 0 && i < items.length) items[i]!.active = prev;
  }
}
