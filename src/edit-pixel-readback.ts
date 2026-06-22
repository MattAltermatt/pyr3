// Settled-pixel unpack for the editor's live scopes (#423 — extracted from the
// edit-mount god-module). Pure CPU: strips 256-aligned row padding from a mapped
// GPU readback buffer into tight TRUE-RGBA bytes, undoing the B/R channel swap
// when the source texture is bgra8unorm (macOS Chrome's common swap-chain format)
// so downstream scope binning stays format-agnostic. No GPU, no DOM — unit-testable.

/** Unpack a mapped readback buffer (256-row-aligned, `width×height` rgba/bgra8) into
 *  a tight `Uint8ClampedArray` of TRUE-RGBA pixels. When `swapBR`, channels 0 and 2
 *  are swapped (bgra→rgba); alpha is copied straight through. */
export function unpackSettledRgba(
  padded: Uint8Array,
  width: number,
  height: number,
  swapBR: boolean,
): Uint8ClampedArray {
  const bytesPerPixel = 4;
  const unpaddedBytesPerRow = width * bytesPerPixel;
  // copyTextureToBuffer pads each row to a 256-byte boundary.
  const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = y * bytesPerRow;
    const dstRow = y * unpaddedBytesPerRow;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 4;
      if (swapBR) {
        rgba[d] = padded[s + 2]!;
        rgba[d + 1] = padded[s + 1]!;
        rgba[d + 2] = padded[s]!;
      } else {
        rgba[d] = padded[s]!;
        rgba[d + 1] = padded[s + 1]!;
        rgba[d + 2] = padded[s + 2]!;
      }
      rgba[d + 3] = padded[s + 3]!;
    }
  }
  return rgba;
}
