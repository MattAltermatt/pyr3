// pyr3 — /v1/edit state model + lane dispatcher + per-lane debouncer.
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
import { type Palette } from './palette';

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
  | 'curves'
  | 'hsl'
  | 'viewport'
  | 'xforms'
  | 'final'
  | 'global'
  | 'density'
  | 'render';

export interface EditState {
  genome: Genome;
  seed: number;
  preview: { width: number; height: number };
  sectionCollapse: Record<SectionKey, boolean>;
  xformCollapse: Record<number, boolean>;
  /** Transient solo state. Present when an xform / variation is currently
   *  "soloed" via shift-click. Cleared when solo exits or the genome
   *  changes. Not persisted to .pyr3.json. */
  soloXformSnapshot?: SoloSnapshot;
  /** Per-xform-index variation solo snapshot. Keyed by xform index. */
  soloVariationSnapshot?: Record<number, SoloSnapshot>;
  /** Last tonemap preset applied via the Density section's preset strip
   *  (Phase 7 task 7.10). Used by the header chip to display dirty-state
   *  (e.g. `vivid*`) when the user manually nudges a tonemap value off
   *  the preset's exact triple. UI-only; never serialized. */
  lastDensityPreset?: string;
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
   *  Color Curves histogram overlay is the first consumer; the Scopes panel
   *  (#174) and targeted Color Curves (#173) reuse the same readback. UI-only;
   *  never serialized. */
  settledPixelsListeners?: Array<(pixels: SettledPixels) => void>;
}

/** Post-tonemap, PRE-curve canvas pixels emitted on render-settle (#175).
 *  `rgba` is tightly packed (4 bytes/pixel, no row padding) and in TRUE RGBA
 *  order regardless of the swap-chain's bgra8unorm/rgba8unorm format. */
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
      palette: true,
      curves: true,
      hsl: true,
      viewport: true,
      xforms: true,
      final: true,
      global: true,
      density: true,
      render: true,
    },
    xformCollapse: {},
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
  // for snappy feedback. A separate 1500ms settle timer kicks the final
  // full-dim/quality render once the user stops fiddling.
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
    localStorage.setItem(WIP_KEY, JSON.stringify(genome));
  } catch {
    // localStorage disabled (private browsing) or quota exceeded — no-op.
  }
}

/** Read the persisted genome back. Returns null when:
 *   • the key isn't present (first visit / cleared storage)
 *   • the stored JSON is malformed (corrupted by a partial write)
 *   • localStorage itself throws (private mode).
 *
 *  The caller (mountEditPage cold-start) treats null as "no saved WIP" and
 *  falls back to the random-reroll path. */
export function restoreWip(): Genome | null {
  try {
    const raw = localStorage.getItem(WIP_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Genome;
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
  size: { width: 1920, height: 1080 },
  quality: 50,
  settleMs: 500,
};

/** Read the sticky editor render settings, falling back to defaults for any
 *  missing / malformed field. Always returns a usable object. */
export function loadEditRenderSettings(): EditRenderSettings {
  try {
    const raw = localStorage.getItem(EDIT_RENDER_SETTINGS_KEY);
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
    localStorage.setItem(EDIT_RENDER_SETTINGS_KEY, JSON.stringify({ _v: 1, ...s }));
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
    localStorage.setItem(PENDING_TRANSFER_KEY, JSON.stringify(payload));
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
    const raw = localStorage.getItem(PENDING_TRANSFER_KEY);
    if (!raw) return null;
    // Remove first so a malformed / stale slot still clears.
    localStorage.removeItem(PENDING_TRANSFER_KEY);
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

// ── Editor ↔ Gradient-editor round-trip (#266) ────────────────────────
// Single-shot, TTL-guarded localStorage handoffs mirroring PENDING_TRANSFER.
//   handoff: /v1/edit → /v1/gradient  (carries the flame's palette to seed)
//   return:  /v1/gradient → /v1/edit  (carries the edited palette to apply)
// Consume-on-read makes each a single click→nav round trip; a later refresh
// can't replay it.

export const GRADIENT_HANDOFF_KEY = 'pyr3.gradient.handoff';
export const GRADIENT_RETURN_KEY = 'pyr3.gradient.return';
// Freshness window for the single click→page-load round trip. Generous enough
// to cover a slow editor cold-start (cold GPU cache / large genome) so an
// "Apply to flame" never reads as stale, while still refusing to resurrect a
// long-abandoned palette on some unrelated later visit.
export const GRADIENT_HANDOFF_TTL_MS = 15000;

interface GradientSlot {
  /** Handoff direction (edit→gradient) carries the full genome so /v1/gradient
   *  can RENDER the flame (and seed the bar from genome.palette). (#269) */
  genome?: Genome;
  /** Return direction (gradient→edit) carries only the edited palette to apply
   *  back — /v1/edit stays the flame's source of truth. */
  palette?: Palette;
  /** Handoff direction only: the palette is already the user's own custom
   *  gradient (paletteSource === 'custom'), so /v1/gradient should open it
   *  directly editable instead of behind the read-only Modify gate. */
  editable?: boolean;
  timestamp: number;
}

/** What `consumeGradientHandoff` hands back: the seed genome plus whether it is
 *  the user's own custom gradient (open-editable) vs a dense flame palette. */
export interface GradientHandoff {
  genome: Genome;
  editable: boolean;
}

function writeSlot(key: string, payload: Omit<GradientSlot, 'timestamp'>): void {
  try {
    localStorage.setItem(key, JSON.stringify({ ...payload, timestamp: Date.now() }));
  } catch {
    // localStorage disabled / full — silently no-op.
  }
}

function readSlot(key: string): GradientSlot | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    localStorage.removeItem(key); // remove first so a stale/bad slot still clears
    const parsed = JSON.parse(raw) as Partial<GradientSlot>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.timestamp !== 'number') return null;
    if (Date.now() - parsed.timestamp > GRADIENT_HANDOFF_TTL_MS) return null;
    return parsed as GradientSlot;
  } catch {
    return null;
  }
}

/** Stash the flame's genome for /v1/gradient to render + seed from. `editable`
 *  marks it as the user's own custom gradient (open it directly, not behind the
 *  gate). Best-effort. */
export function writeGradientHandoff(genome: Genome, editable = false): void {
  writeSlot(GRADIENT_HANDOFF_KEY, { genome, editable });
}
/** Consume the edit→gradient handoff (single-shot). null when empty/stale/bad. */
export function consumeGradientHandoff(): GradientHandoff | null {
  const slot = readSlot(GRADIENT_HANDOFF_KEY);
  if (!slot || !slot.genome || !Array.isArray(slot.genome.palette?.stops)) return null;
  return { genome: slot.genome, editable: slot.editable === true };
}
/** Stash the edited palette for /v1/edit to apply on return. Best-effort. */
export function writeGradientReturn(palette: Palette): void {
  writeSlot(GRADIENT_RETURN_KEY, { palette });
}
/** Consume the gradient→edit return (single-shot). null when empty/stale/bad. */
export function consumeGradientReturn(): Palette | null {
  const slot = readSlot(GRADIENT_RETURN_KEY);
  if (!slot || !slot.palette || !Array.isArray(slot.palette.stops)) return null;
  return slot.palette;
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

const DEFAULT_SECTION_COLLAPSE: Record<SectionKey, boolean> = {
  palette: true,
  curves: true,
  hsl: true,
  viewport: true,
  xforms: true,
  final: true,
  global: true,
  density: true,
  render: true,
};

/** Persist the per-section collapse map immediately. No debounce — toggle
 *  events are rare (one per section-header click). Best-effort; swallows
 *  any localStorage failure. */
export function persistSectionCollapse(map: Record<SectionKey, boolean>): void {
  try {
    localStorage.setItem(SECTION_COLLAPSE_KEY, JSON.stringify(map));
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
    const raw = localStorage.getItem(SECTION_COLLAPSE_KEY);
    if (!raw) return { ...DEFAULT_SECTION_COLLAPSE };
    const parsed = JSON.parse(raw) as Record<SectionKey, boolean>;
    // Merge over the default so a partial / older shape still produces all
    // seven keys; persisted values win where present.
    return { ...DEFAULT_SECTION_COLLAPSE, ...parsed };
  } catch {
    return { ...DEFAULT_SECTION_COLLAPSE };
  }
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
