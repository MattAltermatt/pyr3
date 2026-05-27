import { describe, expect, it } from 'vitest';
import {
  paletteFromStops,
  bakeLUT,
  rotateHueRGB,
  PALETTE_SIZE,
  PALETTE_LIBRARY,
  PYRE_PALETTE,
  DEEPSEA,
  BONE,
  VIRIDIS,
  MAGMA,
} from './palette';

describe('bakeLUT', () => {
  it('matches first stop exactly at LUT entry 0', () => {
    const lut = bakeLUT([
      { t: 0.0, r: 0.1, g: 0.2, b: 0.3 },
      { t: 1.0, r: 0.9, g: 0.8, b: 0.7 },
    ]);
    expect(lut[0]).toBeCloseTo(0.1, 6);
    expect(lut[1]).toBeCloseTo(0.2, 6);
    expect(lut[2]).toBeCloseTo(0.3, 6);
  });

  it('matches last stop exactly at LUT entry 255', () => {
    const lut = bakeLUT([
      { t: 0.0, r: 0.1, g: 0.2, b: 0.3 },
      { t: 1.0, r: 0.9, g: 0.8, b: 0.7 },
    ]);
    const last = (PALETTE_SIZE - 1) * 4;
    expect(lut[last + 0]).toBeCloseTo(0.9, 6);
    expect(lut[last + 1]).toBeCloseTo(0.8, 6);
    expect(lut[last + 2]).toBeCloseTo(0.7, 6);
  });

  it('linearly interpolates each channel between stops', () => {
    const lut = bakeLUT([
      { t: 0.0, r: 0.0, g: 0.0, b: 0.0 },
      { t: 1.0, r: 1.0, g: 1.0, b: 1.0 },
    ]);
    const mid = 127 * 4;
    const tMid = 127 / (PALETTE_SIZE - 1);
    expect(lut[mid + 0]).toBeCloseTo(tMid, 5);
    expect(lut[mid + 1]).toBeCloseTo(tMid, 5);
    expect(lut[mid + 2]).toBeCloseTo(tMid, 5);
  });

  it('hue=120 rotates a pure-red stop to pure green at LUT entry 0', () => {
    const lut = bakeLUT(
      [
        { t: 0.0, r: 1.0, g: 0.0, b: 0.0 },
        { t: 1.0, r: 1.0, g: 0.0, b: 0.0 },
      ],
      120,
    );
    expect(lut[0]).toBeCloseTo(0, 5);
    expect(lut[1]).toBeCloseTo(1, 5);
    expect(lut[2]).toBeCloseTo(0, 5);
  });

  it("mode='step' uses the lower stop's color verbatim within each segment", () => {
    const lut = bakeLUT(
      [
        { t: 0.0, r: 1.0, g: 0.0, b: 0.0 },
        { t: 0.5, r: 0.0, g: 1.0, b: 0.0 },
        { t: 1.0, r: 0.0, g: 0.0, b: 1.0 },
      ],
      0,
      'step',
    );
    const i = 64 * 4;
    expect(lut[i + 0]).toBeCloseTo(1, 6);
    expect(lut[i + 1]).toBeCloseTo(0, 6);
    expect(lut[i + 2]).toBeCloseTo(0, 6);
    const j = 191 * 4;
    expect(lut[j + 0]).toBeCloseTo(0, 6);
    expect(lut[j + 1]).toBeCloseTo(1, 6);
    expect(lut[j + 2]).toBeCloseTo(0, 6);
  });
});

describe('paletteFromStops', () => {
  it('stores name and stops verbatim (no derived data field)', () => {
    const stops = [
      { t: 0.0, r: 0.1, g: 0.2, b: 0.3 },
      { t: 1.0, r: 0.9, g: 0.8, b: 0.7 },
    ];
    const p = paletteFromStops('test', stops);
    expect(p.name).toBe('test');
    expect(p.stops).toEqual(stops);
  });

  it('round-trips losslessly through JSON.stringify / JSON.parse', () => {
    const original = paletteFromStops('jsontest', [
      { t: 0.0, r: 0.1, g: 0.2, b: 0.3 },
      { t: 0.5, r: 0.4, g: 0.5, b: 0.6 },
      { t: 1.0, r: 0.7, g: 0.8, b: 0.9 },
    ]);
    const reparsed = JSON.parse(JSON.stringify(original)) as typeof original;
    expect(reparsed.name).toBe(original.name);
    expect(reparsed.stops).toEqual(original.stops);
  });
});

describe('PALETTE_LIBRARY', () => {
  it('orders PYRE first so initial render matches v0.1 baseline', () => {
    expect(PALETTE_LIBRARY[0]).toBe(PYRE_PALETTE);
  });

  it('contains exactly the 5 light-slice palettes in the agreed order', () => {
    expect(PALETTE_LIBRARY.length).toBe(5);
    expect(PALETTE_LIBRARY[0]).toBe(PYRE_PALETTE);
    expect(PALETTE_LIBRARY[1]).toBe(DEEPSEA);
    expect(PALETTE_LIBRARY[2]).toBe(BONE);
    expect(PALETTE_LIBRARY[3]).toBe(VIRIDIS);
    expect(PALETTE_LIBRARY[4]).toBe(MAGMA);
  });

  it('every entry has a unique name', () => {
    const names = PALETTE_LIBRARY.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('rotateHueRGB', () => {
  it('returns input unchanged when deg=0', () => {
    const out = rotateHueRGB(0.8, 0.2, 0.1, 0);
    expect(out.r).toBeCloseTo(0.8, 6);
    expect(out.g).toBeCloseTo(0.2, 6);
    expect(out.b).toBeCloseTo(0.1, 6);
  });

  it('rotates pure red (1,0,0) by 120° to pure green', () => {
    const out = rotateHueRGB(1, 0, 0, 120);
    expect(out.r).toBeCloseTo(0, 5);
    expect(out.g).toBeCloseTo(1, 5);
    expect(out.b).toBeCloseTo(0, 5);
  });

  it('rotates pure red (1,0,0) by 240° to pure blue', () => {
    const out = rotateHueRGB(1, 0, 0, 240);
    expect(out.r).toBeCloseTo(0, 5);
    expect(out.g).toBeCloseTo(0, 5);
    expect(out.b).toBeCloseTo(1, 5);
  });

  it('returns a grey input unchanged regardless of rotation (saturation = 0)', () => {
    const out = rotateHueRGB(0.5, 0.5, 0.5, 90);
    expect(out.r).toBeCloseTo(0.5, 6);
    expect(out.g).toBeCloseTo(0.5, 6);
    expect(out.b).toBeCloseTo(0.5, 6);
  });
});
