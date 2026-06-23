// Pure-geometry grid solver for the Surprise Wall (#surprise-v2).
//
// Computes a square-tile grid that fills the viewport with NO scroll. No DOM:
// inputs are plain numbers (the caller measures the viewport), outputs are a
// plain `Grid`. Two modes:
//   - "fill": pick a tile size from a density target, derive the count to fill.
//   - "set":  show exactly N tiles, shrink the tile size to fit (never scroll).
//
// The seam stays env-agnostic so the same solver can drive the viewer chrome
// and any headless layout test.

/** Density presets → target square-tile edge in CSS px. */
export const DENSITY_PX = { s: 180, m: 240, l: 340 } as const;
export type Density = keyof typeof DENSITY_PX;

/** Available viewport box the grid must fit inside, plus inter-tile gap. */
export interface Viewport {
  w: number;
  h: number;
  gap: number;
}

export type GridMode =
  | { mode: 'fill'; density: Density }
  | { mode: 'set'; n: number };

export interface Grid {
  cols: number;
  rows: number;
  tile: number;
  count: number;
}

/**
 * Solve the Surprise Wall grid. Deterministic and total — always returns a
 * valid `Grid` (tile ≥ 1, cols ≥ 1, rows ≥ 1) for any finite viewport.
 */
export function computeGrid(vp: Viewport, m: GridMode): Grid {
  const w = Math.max(1, vp.w);
  const h = Math.max(1, vp.h);
  const gap = Math.max(0, vp.gap);

  if (m.mode === 'fill') {
    const target = DENSITY_PX[m.density];
    const cols = Math.max(1, Math.floor((w + gap) / (target + gap)));
    const rows = Math.max(1, Math.floor((h + gap) / (target + gap)));
    // Nudge the tile so the columns fill the width edge-to-edge.
    const tile = Math.max(1, Math.floor((w - (cols - 1) * gap) / cols));
    return { cols, rows, tile, count: cols * rows };
  }

  // set mode — exactly N tiles, largest tile that fits without vertical scroll.
  const n = Math.max(1, Math.floor(m.n));

  // Search downward from the largest size a tile could ever be (capped by the
  // viewport's short edge) for the largest `t` whose ceil-packed grid fits
  // vertically. `fits(t)` is monotone (smaller t → more cols → fewer rows →
  // shorter), so a linear scan finds the optimum; it always terminates at t=1.
  const maxTile = Math.max(1, Math.min(w, h));

  const colsFor = (t: number) => Math.max(1, Math.floor((w + gap) / (t + gap)));
  const rowsFor = (t: number, cols: number) => Math.ceil(n / cols);
  const fits = (t: number, rows: number) => rows * (t + gap) - gap <= h;

  for (let t = maxTile; t >= 1; t--) {
    const cols = colsFor(t);
    const rows = rowsFor(t, cols);
    if (fits(t, rows)) {
      return { cols, rows, tile: t, count: n };
    }
  }

  // Fallback (only reachable for pathological viewports): smallest tile.
  const cols = colsFor(1);
  const rows = rowsFor(1, cols);
  return { cols, rows, tile: 1, count: n };
}
