import { describe, expect, it } from 'vitest';
import { paletteFromStops, bakeLUT, rotateHueRGB, PALETTE_SIZE, PYRE_PALETTE, type ColorStop } from './palette';

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

  it('clamps out-of-range coords to the nearest endpoint (partial-span palette, #240)', () => {
    // Stops span only t=0.2..0.8 — coords below 0.2 and above 0.8 have no
    // enclosing segment and must take the nearest endpoint, never extrapolate.
    const lut = bakeLUT([
      { t: 0.2, r: 0.0, g: 0.0, b: 0.0 },
      { t: 0.5, r: 0.5, g: 0.5, b: 0.5 },
      { t: 0.8, r: 1.0, g: 1.0, b: 1.0 },
    ]);
    // Every baked channel stays inside [0,1] — no negative / >1 extrapolation.
    for (let i = 0; i < PALETTE_SIZE; i++) {
      for (let c = 0; c < 3; c++) {
        const v = lut[i * 4 + c]!;
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    // Entry 0 (t=0) equals the first stop's color (nearest endpoint).
    expect(lut[0]).toBeCloseTo(0.0, 6);
    expect(lut[1]).toBeCloseTo(0.0, 6);
    expect(lut[2]).toBeCloseTo(0.0, 6);
    // Entry 255 (t=1) equals the last stop's color.
    const last = (PALETTE_SIZE - 1) * 4;
    expect(lut[last + 0]).toBeCloseTo(1.0, 6);
    expect(lut[last + 1]).toBeCloseTo(1.0, 6);
    expect(lut[last + 2]).toBeCloseTo(1.0, 6);
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

describe('bakeLUT smooth mode (#115)', () => {
  // PARITY GUARD — linear/step output must never change.
  it('linear output is unchanged by the smooth addition', () => {
    const lut = bakeLUT(PYRE_PALETTE.stops, 0, 'linear');
    expect(lut[0]).toBeCloseTo(0.18, 6); // stop t=0 r
    expect(lut[1]).toBeCloseTo(0.0, 6); // stop t=0 g
    expect(lut[255 * 4 + 0]).toBeCloseTo(1.0, 6); // stop t=1 r
    expect(lut[3]).toBe(0); // alpha always 0
  });

  it('step output is unchanged by the smooth addition', () => {
    const stops: ColorStop[] = [
      { t: 0, r: 0, g: 0, b: 0 },
      { t: 1, r: 1, g: 1, b: 1 },
    ];
    const lut = bakeLUT(stops, 0, 'step');
    expect(lut[0]).toBe(0); // lower stop verbatim
    expect(lut[254 * 4]).toBe(0); // still lower stop just below t=1
  });

  it('smooth passes through the stop colors at the stops', () => {
    const stops: ColorStop[] = [
      { t: 0, r: 0.1, g: 0.2, b: 0.3 },
      { t: 0.5, r: 0.8, g: 0.1, b: 0.4 },
      { t: 1, r: 0.2, g: 0.9, b: 0.7 },
    ];
    const lut = bakeLUT(stops, 0, 'smooth');
    expect(lut[0]).toBeCloseTo(0.1, 5); // t=0 r
    expect(lut[255 * 4 + 1]).toBeCloseTo(0.9, 5); // t=1 g
    expect(lut[128 * 4 + 0]).toBeCloseTo(0.8, 1); // near the middle stop r
  });

  it('smooth clamps overshoot into [0,1]', () => {
    const stops: ColorStop[] = [
      { t: 0, r: 1, g: 0, b: 0 },
      { t: 0.5, r: 0, g: 0, b: 0 },
      { t: 0.5001, r: 1, g: 0, b: 0 },
      { t: 1, r: 0, g: 0, b: 0 },
    ];
    const lut = bakeLUT(stops, 0, 'smooth');
    for (let i = 0; i < PALETTE_SIZE; i++) {
      for (let c = 0; c < 3; c++) {
        expect(lut[i * 4 + c]).toBeGreaterThanOrEqual(0);
        expect(lut[i * 4 + c]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('smooth falls back to linear for <3 stops', () => {
    const stops: ColorStop[] = [
      { t: 0, r: 0, g: 0, b: 0 },
      { t: 1, r: 1, g: 1, b: 1 },
    ];
    const smooth = bakeLUT(stops, 0, 'smooth');
    const linear = bakeLUT(stops, 0, 'linear');
    for (let i = 0; i < smooth.length; i++) expect(smooth[i]).toBeCloseTo(linear[i]!, 6);
  });
});
