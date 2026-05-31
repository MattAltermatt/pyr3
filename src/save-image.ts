// #22: filename composition for the viewer's 💾 Save action.
//
// Browsers' right-click "Save image as…" on a WebGPU <canvas> can't accept a
// filename hint the way <a download> does, so the viewer offers an explicit
// Save pill. This module owns the filename format so the bar (composition) and
// main (download wiring) stay decoupled and the format is exhaustively unit-
// testable without spinning a DOM.

/** Minimal quality readout shape the filename depends on. Matches the
 *  ui-bar's QualityReadout but is duplicated here to avoid a circular import. */
export interface SaveQualityHint {
  tierLabel: string;
  width: number;
  height: number;
  spp: number;
}

/** Compose the download filename for the current canvas render.
 *
 * Patterns:
 *  - tier render   → `<flame>-<tier-lowercase>-q<spp>.png`     e.g. `electricsheep.247.19679-preview-q16.png`
 *  - custom render → `<flame>-<longEdge>px-q<spp>.png`         e.g. `electricsheep.247.19679-2048px-q100.png`
 *  - no render yet → `<flame>.png`                             e.g. `electricsheep.247.19679.png`
 *
 * The flame name is sanitized — any character outside `[A-Za-z0-9._-]` is
 * replaced with `_` so filesystem-hostile names (paths, control chars, weird
 * unicode) can't escape into the download attribute. An empty / whitespace-
 * only name falls back to `pyr3-flame`.
 */
export function composeSaveFilename(
  flameName: string | null | undefined,
  quality: SaveQualityHint | null,
): string {
  const raw = (flameName ?? '').trim();
  const base = (raw === '' ? 'pyr3-flame' : raw).replace(/[^A-Za-z0-9._-]/g, '_');
  if (!quality) return `${base}.png`;
  if (quality.tierLabel === 'Custom') {
    const longEdge = Math.max(quality.width, quality.height);
    return `${base}-${longEdge}px-q${quality.spp}.png`;
  }
  return `${base}-${quality.tierLabel.toLowerCase()}-q${quality.spp}.png`;
}
