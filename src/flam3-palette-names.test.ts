// pyr3 — paletteIdentifier helper tests.
//
// The launcher button on the editor's palette subpanel shows where the current
// palette came from. paletteIdentifier(source) returns the formatted parts
// the button DOM uses: optional `prefix` (e.g., 'flam3'), `name` (the body
// text, quoted for named entries / hash-prefixed for unnamed), and a
// `monospace` flag the button uses to pick its font.

import { describe, it, expect } from 'vitest';
import { paletteIdentifier, FLAM3_PALETTE_NAMES } from './flam3-palette-names';

describe('paletteIdentifier', () => {
  it('corpus-source: { kind: "corpus", gen, id } → "<gen>/<5-digit-id>"', () => {
    expect(paletteIdentifier({ kind: 'corpus', gen: 198, id: 7372 })).toEqual({
      prefix: null,
      name: '198/07372',
      monospace: true,
    });
  });

  it('corpus-source zero-pads the id to 5 digits', () => {
    expect(paletteIdentifier({ kind: 'corpus', gen: 247, id: 23 })).toEqual({
      prefix: null,
      name: '247/00023',
      monospace: true,
    });
  });

  it('flam3 named entry: { kind: "flam3", number: 1 } → flam3 "<name>"', () => {
    // idx 1 = "sky-flesh" in the auto-generated table
    const expectedName = FLAM3_PALETTE_NAMES[1];
    expect(paletteIdentifier({ kind: 'flam3', number: 1 })).toEqual({
      prefix: 'flam3',
      name: `"${expectedName}"`,
      monospace: false,
    });
  });

  it('flam3 unnamed entry (idx 3 = "no-name" in source) → flam3 #<N> fallback', () => {
    expect(paletteIdentifier({ kind: 'flam3', number: 3 })).toEqual({
      prefix: 'flam3',
      name: '#3',
      monospace: true,
    });
  });

  it('flam3 out-of-range number → flam3 #<N> fallback (never empty)', () => {
    expect(paletteIdentifier({ kind: 'flam3', number: 999999 })).toEqual({
      prefix: 'flam3',
      name: '#999999',
      monospace: true,
    });
  });

  it('user-saved (future): { kind: "mine", name } → mine "<name>"', () => {
    expect(paletteIdentifier({ kind: 'mine', name: 'twilight' })).toEqual({
      prefix: 'mine',
      name: '"twilight"',
      monospace: false,
    });
  });
});
