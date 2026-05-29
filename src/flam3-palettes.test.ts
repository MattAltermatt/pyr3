import { describe, expect, it } from 'vitest';
import { getLibraryStops, FLAM3_PALETTE_COUNT } from './flam3-palettes';

describe('PYR3-022 — flam3 palette library lookup', () => {
  it('ships the full flam3 library (701 palettes)', () => {
    expect(FLAM3_PALETTE_COUNT).toBe(701);
  });

  it('decodes palette 0 ("south-sea-bather") losslessly — first color 00b9eaeb → (185,234,235)', () => {
    const stops = getLibraryStops(0);
    expect(stops).not.toBeNull();
    expect(stops!).toHaveLength(256);
    expect(stops![0]!.t).toBe(0);
    expect(stops![0]!.r).toBeCloseTo(185 / 255, 10);
    expect(stops![0]!.g).toBeCloseTo(234 / 255, 10);
    expect(stops![0]!.b).toBeCloseTo(235 / 255, 10);
    expect(stops![255]!.t).toBe(1);
  });

  it('decodes palette 42 ("indian-coast") first color 0044382f → (68,56,47)', () => {
    const stops = getLibraryStops(42);
    expect(stops![0]!.r).toBeCloseTo(68 / 255, 10);
    expect(stops![0]!.g).toBeCloseTo(56 / 255, 10);
    expect(stops![0]!.b).toBeCloseTo(47 / 255, 10);
  });

  it('returns null for out-of-range / non-integer indices', () => {
    expect(getLibraryStops(-1)).toBeNull();
    expect(getLibraryStops(FLAM3_PALETTE_COUNT)).toBeNull();
    expect(getLibraryStops(99999)).toBeNull();
    expect(getLibraryStops(1.5)).toBeNull();
  });

  it('every library palette decodes to 256 in-range stops', () => {
    for (let i = 0; i < FLAM3_PALETTE_COUNT; i++) {
      const stops = getLibraryStops(i);
      expect(stops, `palette ${i}`).not.toBeNull();
      expect(stops!).toHaveLength(256);
      for (const s of stops!) {
        expect(s.r).toBeGreaterThanOrEqual(0);
        expect(s.r).toBeLessThanOrEqual(1);
      }
    }
  });
});
