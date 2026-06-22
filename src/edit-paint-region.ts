// pyr3 — /editor point-to-paint region layer (#423, extracted from edit-mount.ts).
// SEAM_EXEMPT — touches document + getBoundingClientRect + addEventListener.
//
// #269/#372 — point-to-paint. A 2D region-tint canvas layered over the flame
// plus flame pointer handlers. Created once; inert unless the gradient overlay
// is active and an index map exists. The flame canvas is object-fit:contain
// (letterboxed), so map client coords through the CONTENT rect, not the box.
//
// The GPU index-capture (armIndexCapture / captureIndexMapIfArmed) stays in
// edit-mount; this module reads the captured map only via the getIndexMap getter.

import {
  regionMask, brushHistogram, clientToPixel,
  type IndexMap,
} from './color-index-map';

export interface PaintRegionCallbacks {
  /** Fresh read of the captured index map (null until a capture lands). */
  getIndexMap(): IndexMap | null;
  /** The active canvas overlay — paint/hover/dblclick only act when 'gradient'. */
  getActiveOverlay(): string;
  /** Double-click on the flame → caller inserts a palette stop at index `t`. */
  onInsertStop(t: number): void;
  /** Hover brush → spotlight the gradient bar with this histogram (null clears). */
  onShowHint(hist: Float32Array | null): void;
}

export interface PaintRegionHandle {
  /** Bar→flame: tint pixels whose index sits within ε of stop position `t`
   *  (null clears the tint). */
  paint(stopT: number | null): void;
  /** Re-align the tint canvas over the flame content (after resize). */
  reposition(): void;
  destroy(): void;
}

const REGION_EPSILON = 0.03;
const PAINT_BRUSH_RADIUS = 10; // index-map pixels — the hover brush size
const PAINT_HINT_BINS = 64;    // spotlight resolution along the bar

export function attachPaintRegion(
  canvasHost: HTMLElement,
  flameCanvas: HTMLCanvasElement,
  cb: PaintRegionCallbacks,
): PaintRegionHandle {
  const regionCanvas = document.createElement('canvas');
  regionCanvas.className = 'pyr3-edit-paint-region';
  // Backing dims are (re)sized to the captured index map's dims in paint() —
  // they follow the flame aspect, NOT a fixed square.
  Object.assign(regionCanvas.style, {
    position: 'absolute', pointerEvents: 'none', display: 'block',
    borderRadius: '4px', imageRendering: 'pixelated', zIndex: '5',
  });
  canvasHost.appendChild(regionCanvas);
  const regionCtx = regionCanvas.getContext('2d');

  // The flame's displayed (letterbox-corrected) content rect, in viewport coords.
  // Duplicated here (composeOverlay keeps its own); ~9 lines, not worth a seam.
  function flameContentRect(): { left: number; top: number; width: number; height: number } {
    const rect = flameCanvas.getBoundingClientRect();
    const ar = flameCanvas.width / Math.max(1, flameCanvas.height);
    const boxAr = rect.width / Math.max(1, rect.height);
    let w = rect.width, h = rect.height, ox = 0, oy = 0;
    if (boxAr > ar) { w = rect.height * ar; ox = (rect.width - w) / 2; }
    else { h = rect.width / ar; oy = (rect.height - h) / 2; }
    return { left: rect.left + ox, top: rect.top + oy, width: w, height: h };
  }

  // Align the tint canvas over the flame content (relative to canvasHost).
  function reposition(): void {
    const host = canvasHost.getBoundingClientRect();
    const c = flameContentRect();
    Object.assign(regionCanvas.style, {
      left: `${c.left - host.left}px`, top: `${c.top - host.top}px`,
      width: `${c.width}px`, height: `${c.height}px`,
    });
  }

  // Bar→flame: tint the pixels whose index sits within ε of stop position `t`.
  function paint(stopT: number | null): void {
    if (!regionCtx) return;
    const indexMap = cb.getIndexMap();
    if (stopT === null || indexMap === null || cb.getActiveOverlay() !== 'gradient') {
      regionCtx.clearRect(0, 0, regionCanvas.width, regionCanvas.height);
      return;
    }
    const W = indexMap.width, H = indexMap.height;
    // Match the backing canvas to the index map's aspect (resizing also clears it).
    if (regionCanvas.width !== W || regionCanvas.height !== H) {
      regionCanvas.width = W;
      regionCanvas.height = H;
    } else {
      regionCtx.clearRect(0, 0, W, H);
    }
    reposition();
    const mask = regionMask(indexMap, stopT, REGION_EPSILON);
    const img = regionCtx.createImageData(W, H);
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) {
        img.data[i * 4 + 0] = 80; img.data[i * 4 + 1] = 240; img.data[i * 4 + 2] = 255;
        img.data[i * 4 + 3] = 150;
      }
    }
    regionCtx.putImageData(img, 0, 0);
  }

  // Flame→bar: the avg palette index at the cursor, or null off-flame / empty.
  function indexAtEvent(e: MouseEvent): number | null {
    const indexMap = cb.getIndexMap();
    if (indexMap === null) return null;
    const px = clientToPixel(flameContentRect(), e.clientX, e.clientY, indexMap.width, indexMap.height);
    if (!px) return null;
    const o = px.oy * indexMap.width + px.ox;
    return indexMap.mask[o] ? indexMap.avg[o]! : null;
  }
  // Hovering the flame casts a SPOTLIGHT on the bar: the band of gradient indices
  // that color the brushed region stays bright, the rest dims. (Old /gradient
  // paintHint, restored.)
  function onFlamePaintHover(e: MouseEvent): void {
    const indexMap = cb.getIndexMap();
    if (cb.getActiveOverlay() !== 'gradient' || indexMap === null) return;
    const px = clientToPixel(flameContentRect(), e.clientX, e.clientY, indexMap.width, indexMap.height);
    if (!px) { cb.onShowHint(null); return; }
    cb.onShowHint(brushHistogram(indexMap, px.ox, px.oy, PAINT_BRUSH_RADIUS, PAINT_HINT_BINS));
  }
  function onFlamePaintLeave(): void { cb.onShowHint(null); }
  // Double-click the flame → add a stop at that region's index, colored as the
  // gradient currently is there (same genome identity → reuses the cached map).
  function onFlamePaintDblClick(e: MouseEvent): void {
    const indexMap = cb.getIndexMap();
    if (cb.getActiveOverlay() !== 'gradient' || indexMap === null) return;
    const t = indexAtEvent(e);
    if (t === null) return;
    cb.onInsertStop(t);
  }
  flameCanvas.addEventListener('mousemove', onFlamePaintHover);
  flameCanvas.addEventListener('mouseleave', onFlamePaintLeave);
  flameCanvas.addEventListener('dblclick', onFlamePaintDblClick);

  return {
    paint,
    reposition,
    destroy(): void {
      flameCanvas.removeEventListener('mousemove', onFlamePaintHover);
      flameCanvas.removeEventListener('mouseleave', onFlamePaintLeave);
      flameCanvas.removeEventListener('dblclick', onFlamePaintDblClick);
      regionCanvas.remove();
    },
  };
}
