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
  return 'fast';
}

export interface StateChange {
  lane: Lane;
  path: string;
}

export type SectionKey =
  | 'palette'
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
}

export function createEditState(genome: Genome, seed: number): EditState {
  return {
    genome,
    seed,
    preview: { width: 512, height: 512 },
    sectionCollapse: {
      palette: true,
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

/** Resolve the starting genome at editor mount. Returns the persisted WIP if
 *  one is available, otherwise the result of `rerollFn()`. `rerollFn` is the
 *  caller's fresh-random-genome generator — kept as a parameter so this
 *  helper stays free of edit-seed coupling and so tests can spy on whether
 *  the fallback ran. */
export function resolveColdStartGenome(rerollFn: () => Genome): Genome {
  const wip = restoreWip();
  return wip ?? rerollFn();
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
