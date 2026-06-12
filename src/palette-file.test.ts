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
});
