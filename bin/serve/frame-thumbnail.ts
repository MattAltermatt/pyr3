// Cheap CPU-only preview thumbnails for the export progress modal (#279).
// Downsamples the already-in-RAM frame RGBA (nearest-neighbor) and PNG-encodes
// a small image — no PNG decode, no GPU work.
import { PNG } from 'pngjs';

export function thumbnailDims(w: number, h: number, maxEdge: number): { tw: number; th: number } {
  const long = Math.max(w, h);
  if (long <= maxEdge) return { tw: w, th: h };
  const scale = maxEdge / long;
  return { tw: Math.max(1, Math.round(w * scale)), th: Math.max(1, Math.round(h * scale)) };
}

/** Nearest-neighbor downscale of a tight RGBA buffer → small PNG bytes. */
export function rgbaThumbnailPng(
  rgba: Uint8Array, width: number, height: number, maxEdge = 192,
): Uint8Array {
  const { tw, th } = thumbnailDims(width, height, maxEdge);
  const out = new Uint8Array(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(height - 1, Math.floor((y * height) / th));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / tw));
      const srcOff = (sy * width + sx) * 4;
      const dstOff = (y * tw + x) * 4;
      out[dstOff] = rgba[srcOff]!;
      out[dstOff + 1] = rgba[srcOff + 1]!;
      out[dstOff + 2] = rgba[srcOff + 2]!;
      out[dstOff + 3] = rgba[srcOff + 3]!;
    }
  }
  const png = new PNG({ width: tw, height: th });
  png.data = Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  const buf = PNG.sync.write(png);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function thumbnailDataUri(
  rgba: Uint8Array, width: number, height: number, maxEdge = 192,
): string {
  const png = rgbaThumbnailPng(rgba, width, height, maxEdge);
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
}

/** Throttle predicate: emit when never emitted or the interval has elapsed. */
export function shouldEmitThumb(lastEmitMs: number | null, nowMs: number, intervalMs = 500): boolean {
  return lastEmitMs === null || nowMs - lastEmitMs >= intervalMs;
}
