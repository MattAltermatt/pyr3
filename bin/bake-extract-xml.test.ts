// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { extractXmlFeatures } from './bake-extract-xml';
import { parseFlame } from '../src/flame-import';
import { bitsetGet, VARIATION_BITSET_BYTES } from '../src/feature-index';
import { V } from '../src/variations';

const minPalette =
  '<color index="0" rgb="0 0 0"/><color index="255" rgb="255 255 255"/>';

const wrapFlame = (children: string): string =>
  `<flame name="t" size="64 64" center="0 0" scale="100">${minPalette}${children}</flame>`;

describe('extractXmlFeatures', () => {
  it('single-variation single-xform flame: only the used bit is set', () => {
    const xml = wrapFlame(
      '<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1"/>',
    );
    const { genome } = parseFlame(xml);
    const { variationBitset, xformCount } = extractXmlFeatures(genome);

    expect(xformCount).toBe(1);
    expect(variationBitset).toBeInstanceOf(Uint8Array);
    expect(variationBitset.length).toBe(VARIATION_BITSET_BYTES);
    expect(bitsetGet(variationBitset, V.linear)).toBe(true);
    // Nothing else set: byte 0 carries only bit `V.linear` (= 0), every other
    // byte stays zero.
    expect(variationBitset[0]).toBe(1 << V.linear);
    for (let i = 1; i < VARIATION_BITSET_BYTES; i++) {
      expect(variationBitset[i]).toBe(0);
    }
  });

  it('multi-xform multi-variation flame: OR-union across xforms (no double-count)', () => {
    const xml = wrapFlame(
      '<xform weight="0.5" color="0" coefs="1 0 0 1 0 0" linear="0.5" julia="0.5"/>' +
        '<xform weight="0.5" color="1" coefs="1 0 0 1 0 0" julia="0.7" radial_blur="0.3"/>',
    );
    const { genome } = parseFlame(xml);
    const { variationBitset, xformCount } = extractXmlFeatures(genome);

    expect(xformCount).toBe(2);
    // Union: linear (xform 0), julia (both xforms — proves OR semantics, not
    // a count), radial_blur (xform 1).
    expect(bitsetGet(variationBitset, V.linear)).toBe(true);
    expect(bitsetGet(variationBitset, V.julia)).toBe(true);
    expect(bitsetGet(variationBitset, V.radial_blur)).toBe(true);
    // Spot-check an unused variation.
    expect(bitsetGet(variationBitset, V.spherical)).toBe(false);

    // Sanity on bit count: exactly 3 variations across the union.
    let setBits = 0;
    for (const byte of variationBitset) {
      let b = byte;
      while (b !== 0) {
        setBits++;
        b &= b - 1;
      }
    }
    expect(setBits).toBe(3);
  });

  it('zero-weight variations are kept by the importer (#17 fix f — flam3-canonical)', () => {
    // #17 fix (f): flame-import.ts now treats `weight === 0` as a real
    // variation that contributes nothing per-iter (flam3 semantics),
    // NOT as "absent". Previously, an xform declared with only weight=0
    // variations would get a `linear(1)` fallback substituted — turning
    // the intended degenerate point into an identity passthrough.
    // Both variations land in the genome; the chaos kernel naturally
    // multiplies a zero-weight contribution by 0.
    const xml = wrapFlame(
      '<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1" julia="0"/>',
    );
    const { genome } = parseFlame(xml);
    expect(genome.xforms[0]!.variations).toHaveLength(2);
    expect(genome.xforms[0]!.variations[0]!.index).toBe(V.linear);
    expect(genome.xforms[0]!.variations[0]!.weight).toBe(1);
    expect(genome.xforms[0]!.variations[1]!.index).toBe(V.julia);
    expect(genome.xforms[0]!.variations[1]!.weight).toBe(0);

    // The bitset reflects REGISTERED variations — both `linear` and
    // `julia` appear since the xform formally lists both.
    const { variationBitset } = extractXmlFeatures(genome);
    expect(bitsetGet(variationBitset, V.linear)).toBe(true);
    expect(bitsetGet(variationBitset, V.julia)).toBe(true);
  });

  it('high-index variation (mobius, index 98) sets byte 12 bit 2', () => {
    const xml = wrapFlame(
      '<xform weight="1" color="0" coefs="1 0 0 1 0 0" mobius="1"' +
        ' Re_A="1" Im_A="0" Re_B="0" Im_B="0" Re_C="0" Im_C="0" Re_D="1" Im_D="0"/>',
    );
    const { genome } = parseFlame(xml);
    const { variationBitset } = extractXmlFeatures(genome);

    expect(V.mobius).toBe(98);
    expect(bitsetGet(variationBitset, 98)).toBe(true);
    // 98 = 12 * 8 + 2 → byte 12, bit 2 (mask 0b100 = 4).
    expect(variationBitset[12]).toBe(1 << 2);
  });

  it('finalxform variations fold into the union (uniform across all xforms)', () => {
    const xml = wrapFlame(
      '<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1"/>' +
        '<finalxform color="0" coefs="1 0 0 1 0 0" spherical="1"/>',
    );
    const { genome } = parseFlame(xml);
    expect(genome.finalxform).toBeDefined();

    const { variationBitset, xformCount } = extractXmlFeatures(genome);
    // xformCount excludes the finalxform — it's a post-pick lens, not in the
    // chaos pool.
    expect(xformCount).toBe(1);
    // But its variations still contribute to the union (matches
    // distinctVariationNames semantics in src/genome.ts).
    expect(bitsetGet(variationBitset, V.linear)).toBe(true);
    expect(bitsetGet(variationBitset, V.spherical)).toBe(true);
  });

  it('returns a fresh Uint8Array each call (no shared mutable state)', () => {
    const xml = wrapFlame(
      '<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1"/>',
    );
    const { genome } = parseFlame(xml);
    const a = extractXmlFeatures(genome);
    const b = extractXmlFeatures(genome);
    expect(a.variationBitset).not.toBe(b.variationBitset);
    // Mutating one must not leak into the other.
    a.variationBitset[5] = 0xff;
    expect(b.variationBitset[5]).toBe(0);
  });
});
