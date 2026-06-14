import { describe, it, expect } from 'vitest';
import { thumbnailDims, rgbaThumbnailPng, thumbnailDataUri, shouldEmitThumb } from './frame-thumbnail';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

describe('frame thumbnail (#279)', () => {
  it('thumbnailDims preserves aspect and caps the long edge', () => {
    expect(thumbnailDims(1920, 1080, 192)).toEqual({ tw: 192, th: 108 });
    expect(thumbnailDims(1080, 1920, 192)).toEqual({ tw: 108, th: 192 });
    // already small → unchanged
    expect(thumbnailDims(100, 50, 192)).toEqual({ tw: 100, th: 50 });
  });
  it('rgbaThumbnailPng emits a valid PNG at the downscaled size', () => {
    const w = 64, h = 32;
    const rgba = new Uint8Array(w * h * 4).fill(200);
    const png = rgbaThumbnailPng(rgba, w, h, 16);
    expect([...png.subarray(0, 4)]).toEqual(PNG_MAGIC);
    expect(png.length).toBeGreaterThan(8);
  });
  it('thumbnailDataUri prefixes a base64 PNG data URI', () => {
    const rgba = new Uint8Array(8 * 8 * 4).fill(255);
    const uri = thumbnailDataUri(rgba, 8, 8, 8);
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
  });
  it('shouldEmitThumb gates on the interval, first call always emits', () => {
    expect(shouldEmitThumb(null, 1000, 500)).toBe(true);
    expect(shouldEmitThumb(1000, 1400, 500)).toBe(false);
    expect(shouldEmitThumb(1000, 1500, 500)).toBe(true);
  });
});
