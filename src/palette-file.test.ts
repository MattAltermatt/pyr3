// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { serializePalette, parsePaletteFile } from './palette-file';
import { PYRE_PALETTE } from './palette';

describe('palette-file', () => {
  it('serialize -> parse round-trips the palette', () => {
    const json = serializePalette(PYRE_PALETTE);
    const back = parsePaletteFile(json);
    expect(back.name).toBe('pyre');
    expect(back.stops).toHaveLength(PYRE_PALETTE.stops.length);
  });
  it('rejects wrong format', () => {
    expect(() => parsePaletteFile('{"format":"nope","version":1,"palette":{}}')).toThrow();
  });
  it('rejects malformed json', () => {
    expect(() => parsePaletteFile('{not json')).toThrow();
  });
  it('rejects a palette with no stops', () => {
    expect(() => parsePaletteFile('{"format":"pyre-palette","version":1,"palette":{"name":"x"}}')).toThrow();
  });

  // #308 — a corrupt import must not let NaN reach the Float32 GPU LUT.
  const wrap = (palette: unknown): string =>
    JSON.stringify({ format: 'pyre-palette', version: 1, palette });

  it('rejects a stop with a non-finite numeric field', () => {
    const bad = wrap({ name: 'x', stops: [
      { t: 0, r: 0, g: 0, b: 0 },
      { t: 1, r: Number.NaN, g: 0, b: 0 },
    ] });
    // NaN serializes to null in JSON — same corruption class.
    expect(() => parsePaletteFile(bad)).toThrow(/finite/);
  });

  it('rejects a stop missing a field', () => {
    const bad = wrap({ name: 'x', stops: [
      { t: 0, r: 0, g: 0, b: 0 },
      { t: 1, r: 1, g: 1 },
    ] });
    expect(() => parsePaletteFile(bad)).toThrow(/finite/);
  });

  it('rejects an invalid palette mode', () => {
    const bad = wrap({ name: 'x', mode: 'rainbow', stops: [
      { t: 0, r: 0, g: 0, b: 0 },
      { t: 1, r: 1, g: 1, b: 1 },
    ] });
    expect(() => parsePaletteFile(bad)).toThrow(/mode/);
  });

  it('accepts a valid mode + finite hue', () => {
    const ok = wrap({ name: 'x', mode: 'smooth', hue: 0.5, stops: [
      { t: 0, r: 0, g: 0, b: 0 },
      { t: 1, r: 1, g: 1, b: 1 },
    ] });
    const p = parsePaletteFile(ok);
    expect(p.mode).toBe('smooth');
    expect(p.hue).toBe(0.5);
  });
});
