import { describe, it, expect } from 'vitest';
import { brotliCompressSync } from 'node:zlib';
import { chunkLo, chunkUrl, fetchFlameXml, FlameNotFound } from './chunk-fetch';

// Helper: brotli-compress a JSON object into a Response (matches the ESF wire format).
const blob = (obj: object): Response => {
  const b = brotliCompressSync(Buffer.from(JSON.stringify(obj)));
  return new Response(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe('chunk-fetch', () => {
  // --- chunkLo ---

  it('maps id -> window + url', () => {
    expect(chunkLo(12345)).toBe(12288);
    expect(chunkUrl(247, 12345)).toBe('/chunks/247/12288.flam3chunk');
    expect(chunkUrl(247, 5)).toBe('/chunks/247/00000.flam3chunk');
  });

  it('chunkLo for id=0 returns 0', () => {
    expect(chunkLo(0)).toBe(0);
  });

  it('chunkLo for id=255 returns 0 (last in first window)', () => {
    expect(chunkLo(255)).toBe(0);
  });

  it('chunkLo for id=256 returns 256 (first of next window)', () => {
    expect(chunkLo(256)).toBe(256);
  });

  it('chunkLo for id=100000 gives chunk aligned >= 100000', () => {
    const lo = chunkLo(100000);
    expect(lo).toBeLessThanOrEqual(100000);
    expect(100000 - lo).toBeLessThan(256);
  });

  // --- chunkUrl zero-padding ---

  it('zero-pads chunk lo to at least 5 digits', () => {
    expect(chunkUrl(247, 0)).toBe('/chunks/247/00000.flam3chunk');
    expect(chunkUrl(247, 255)).toBe('/chunks/247/00000.flam3chunk');
    expect(chunkUrl(248, 256)).toBe('/chunks/248/00256.flam3chunk');
  });

  it('does not truncate lo >= 100000 (natural width wins)', () => {
    // chunkLo(100000) = floor(100000/256)*256 = 99840 (5 digits stays 5)
    // chunkLo(1000000) would be a large number — ensure no truncation
    expect(chunkUrl(247, 100000)).toMatch(/^\/chunks\/247\/\d{5,}\.flam3chunk$/);
  });

  // --- fetchFlameXml ---

  it('fetches + extracts the requested flame', async () => {
    const fetchImpl = async () => blob({ _v: 1, '12345': '<flame>hi</flame>' });
    expect(await fetchFlameXml(247, 12345, fetchImpl as any)).toBe('<flame>hi</flame>');
  });

  it('throws FlameNotFound for an absent id', async () => {
    const fetchImpl = async () => blob({ _v: 1, '12345': '<flame>hi</flame>' });
    await expect(fetchFlameXml(247, 12300, fetchImpl as any)).rejects.toBeInstanceOf(FlameNotFound);
  });

  it('extracts the correct flame from a multi-id chunk', async () => {
    const fetchImpl = async () =>
      blob({
        _v: 1,
        '100': '<flame>alpha</flame>',
        '101': '<flame>beta</flame>',
        '200': '<flame>gamma</flame>',
      });
    expect(await fetchFlameXml(247, 101, fetchImpl as any)).toBe('<flame>beta</flame>');
    expect(await fetchFlameXml(247, 200, fetchImpl as any)).toBe('<flame>gamma</flame>');
  });

  it('never returns _v as a flame id — throws FlameNotFound for numeric 1 if absent', async () => {
    // _v is metadata, not a flame entry. Even if someone asked for id=1 from a
    // chunk whose only real entry is _v=1, it must throw — not return 1.
    const fetchImpl = async () => blob({ _v: 1 });
    await expect(fetchFlameXml(247, 1, fetchImpl as any)).rejects.toBeInstanceOf(FlameNotFound);
  });

  it('FlameNotFound carries gen and id', async () => {
    const fetchImpl = async () => blob({ _v: 1 });
    const err = await fetchFlameXml(247, 99, fetchImpl as any).catch((e) => e);
    expect(err).toBeInstanceOf(FlameNotFound);
    expect((err as FlameNotFound).gen).toBe(247);
    expect((err as FlameNotFound).id).toBe(99);
  });

  it('throws a clear Error on non-OK HTTP response', async () => {
    const fetchImpl = async () => new Response('Not Found', { status: 404 });
    await expect(fetchFlameXml(247, 5, fetchImpl as any)).rejects.toThrow(/404/);
  });
});
