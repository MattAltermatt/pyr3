// pyr3 — palette dominant-color tagging tests.
//
// computeTags(rgb) reads a 256-color palette LUT and returns the dominant
// color categories present. Used by the palette-picker color-filter chips
// (Task 9.5) to surface palettes matching the user's chip-selection.
//
// Algorithm: sample 16 evenly-spaced colors, convert each to HSL, bucket
// by H/S/L thresholds (the TUNING-FLAG knobs in palette-tags.ts).

import { describe, it, expect } from 'vitest';
import { computeTags, COLOR_TAGS, type ColorTag } from './palette-tags';

// Build a synthetic 256-color palette from a single repeated RGB triple.
function solidPalette(r: number, g: number, b: number): Uint8Array {
  const out = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  return out;
}

describe('palette-tags — COLOR_TAGS catalog', () => {
  it('exposes the 11 canonical chip tags in the spec order', () => {
    expect(COLOR_TAGS).toEqual([
      'red', 'orange', 'yellow', 'green', 'blue', 'purple',
      'pink', 'brown', 'pastel', 'dark', 'gray',
    ]);
  });
});

describe('palette-tags — computeTags HSL classification', () => {
  it('returns "red" for a pure red palette', () => {
    const tags = computeTags(solidPalette(255, 0, 0));
    expect(tags).toContain('red' as ColorTag);
  });

  it('returns "orange" for a pure orange palette', () => {
    const tags = computeTags(solidPalette(255, 140, 0));
    expect(tags).toContain('orange' as ColorTag);
  });

  it('returns "yellow" for a pure yellow palette', () => {
    const tags = computeTags(solidPalette(255, 240, 0));
    expect(tags).toContain('yellow' as ColorTag);
  });

  it('returns "green" for a pure green palette', () => {
    const tags = computeTags(solidPalette(0, 200, 0));
    expect(tags).toContain('green' as ColorTag);
  });

  it('returns "blue" for a pure blue palette', () => {
    const tags = computeTags(solidPalette(0, 0, 200));
    expect(tags).toContain('blue' as ColorTag);
  });

  it('returns "purple" for a pure purple palette', () => {
    const tags = computeTags(solidPalette(140, 0, 200));
    expect(tags).toContain('purple' as ColorTag);
  });

  it('returns "pink" for a light desaturated red', () => {
    const tags = computeTags(solidPalette(255, 180, 200));
    expect(tags).toContain('pink' as ColorTag);
  });

  it('returns "brown" for a dark warm desaturated color', () => {
    const tags = computeTags(solidPalette(110, 60, 30));
    expect(tags).toContain('brown' as ColorTag);
  });

  it('returns "gray" for a neutral mid-gray', () => {
    const tags = computeTags(solidPalette(128, 128, 128));
    expect(tags).toContain('gray' as ColorTag);
  });

  it('returns "dark" for a near-black palette', () => {
    const tags = computeTags(solidPalette(15, 15, 18));
    expect(tags).toContain('dark' as ColorTag);
  });

  it('returns "pastel" for a high-lightness low-saturation color', () => {
    const tags = computeTags(solidPalette(230, 220, 240));
    expect(tags).toContain('pastel' as ColorTag);
  });

  it('is deterministic — same input gives same output across calls', () => {
    const rgb = solidPalette(180, 100, 60);
    const a = computeTags(rgb);
    const b = computeTags(rgb);
    expect(a).toEqual(b);
  });

  it('returns a multi-tag list for a multi-color palette', () => {
    // alternating red / blue
    const rgb = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      if (i % 2 === 0) {
        rgb[i * 3] = 255;
        rgb[i * 3 + 1] = 0;
        rgb[i * 3 + 2] = 0;
      } else {
        rgb[i * 3] = 0;
        rgb[i * 3 + 1] = 0;
        rgb[i * 3 + 2] = 200;
      }
    }
    const tags = computeTags(rgb);
    expect(tags).toContain('red' as ColorTag);
    expect(tags).toContain('blue' as ColorTag);
  });

  it('tags are deduplicated (no repeats)', () => {
    const tags = computeTags(solidPalette(255, 0, 0));
    const set = new Set(tags);
    expect(set.size).toBe(tags.length);
  });
});

describe('palette-tags — getFlam3PaletteTags caching', () => {
  it('returns the tag list for a given flam3 catalog index', async () => {
    const { getFlam3PaletteTags } = await import('./palette-tags');
    const tags = getFlam3PaletteTags(0);
    expect(Array.isArray(tags)).toBe(true);
  });

  it('returns the same array reference on repeat calls (cached)', async () => {
    const { getFlam3PaletteTags } = await import('./palette-tags');
    const a = getFlam3PaletteTags(0);
    const b = getFlam3PaletteTags(0);
    expect(a).toBe(b);
  });
});
