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
}

export function createEditState(genome: Genome, seed: number): EditState {
  return {
    genome,
    seed,
    preview: { width: 512, height: 512 },
    sectionCollapse: {
      palette: false,
      viewport: false,
      xforms: false,
      final: false,
      global: false,
      density: false,
      render: false,
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
  // 500ms gives the user a beat to keep typing / clicking arrows without
  // queuing a separate render per keystroke. The render-busy badge on the
  // canvas covers the silence so the wait is visible (mounted by edit-mount).
  slow: 500,
  rebuild: 500,
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
