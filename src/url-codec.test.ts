import { describe, expect, it } from 'vitest';
import { decodeFlame, encodeFlame } from './url-codec';

const SAMPLE = `<flame name="Test" version="pyr3-test">
  <xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1"/>
  <palette count="256" format="RGB">000000FFFFFF</palette>
</flame>`;

describe('url-codec', () => {
  it('encodes then decodes back to the exact original XML', async () => {
    const encoded = await encodeFlame(SAMPLE);
    const decoded = await decodeFlame(encoded);
    expect(decoded).toBe(SAMPLE);
  });

  it('produces URL-safe characters only (RFC 4648 §5 alphabet)', async () => {
    const encoded = await encodeFlame(SAMPLE);
    expect(encoded).toMatch(/^v1:[A-Za-z0-9_-]+$/);
  });

  it('compresses a realistic ~5 KB sample to comfortably under Discord\'s 4 KB URL limit', async () => {
    // Tiny inputs don't compress well (gzip overhead dominates); the
    // contract is that *realistic* flame sizes (~5–20 KB XML) compress
    // to share-able URL lengths. 4 KB is Discord's URL message ceiling.
    const big = SAMPLE.repeat(40); // ~5 KB raw
    const encoded = await encodeFlame(big);
    expect(encoded.length).toBeLessThan(4000);
    expect(encoded.length).toBeLessThan(big.length / 2);
  });

  it('rejects unknown format prefix with a descriptive error', async () => {
    await expect(decodeFlame('v9:abcd')).rejects.toThrow(/Unknown share-link format/);
    await expect(decodeFlame('plain-no-prefix')).rejects.toThrow(/Unknown share-link format/);
  });

  it('roundtrips a realistic ~5 KB flame (concatenated SAMPLE × 40)', async () => {
    const big = SAMPLE.repeat(40);
    const encoded = await encodeFlame(big);
    expect(await decodeFlame(encoded)).toBe(big);
  });

  it('handles XML containing non-ASCII characters (UTF-8 round-trip)', async () => {
    const utf8 = `<flame name="Étoile · 流れ星" notes="palette test"></flame>`;
    const encoded = await encodeFlame(utf8);
    expect(await decodeFlame(encoded)).toBe(utf8);
  });

  it('rejects garbage payload (valid prefix, undecodable bytes) with an error', async () => {
    // v1: with random non-gzip bytes — decompression should fail.
    await expect(decodeFlame('v1:abc-def-ghi')).rejects.toThrow();
  });
});
