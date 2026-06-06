// #123 — round-trip test for the PNG tEXt chunk injector.

import { describe, expect, it } from 'vitest';
import { injectPngTextChunk, readPngTextChunks } from './png-text-chunk';

// A minimal valid 1x1 PNG (IHDR + IDAT + IEND). Built once; we only need a
// well-formed PNG, not specific pixel data.
function makeMinimalPng(): Uint8Array {
  // Signature + IHDR (1x1, 8-bit, RGBA) + IDAT (trivial) + IEND.
  // Generated via `pngjs` once and hardcoded so tests don't need pngjs.
  // 1x1 transparent RGBA PNG, ~70 bytes.
  const hex = (
    '89504e470d0a1a0a' +
    '0000000d49484452000000010000000108060000001f15c4890000000d4944415478' +
    'da636060606000000005000160a18d9b0000000049454e44ae426082'
  );
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

describe('#123 PNG tEXt chunk', () => {
  it('round-trips a simple ASCII value', () => {
    const png = makeMinimalPng();
    const injected = injectPngTextChunk(png, 'pyr3', '{"format":1,"hello":"world"}');
    const chunks = readPngTextChunks(injected);
    expect(chunks).toEqual({ pyr3: '{"format":1,"hello":"world"}' });
  });

  it('preserves the PNG signature + IHDR + IDAT bytes', () => {
    const png = makeMinimalPng();
    const injected = injectPngTextChunk(png, 'pyr3', '{}');
    // Signature
    expect(Array.from(injected.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // First non-signature chunk type is still IHDR
    expect(Array.from(injected.subarray(12, 16))).toEqual([0x49, 0x48, 0x44, 0x52]);
    // Result is longer than the input (tEXt chunk added)
    expect(injected.length).toBeGreaterThan(png.length);
  });

  it('inserts the chunk before IEND', () => {
    const png = makeMinimalPng();
    const injected = injectPngTextChunk(png, 'pyr3', '{"k":1}');
    // IEND must still be the last chunk
    const last4 = Array.from(injected.subarray(injected.length - 8, injected.length - 4));
    expect(last4).toEqual([0x49, 0x45, 0x4e, 0x44]);
  });

  it('round-trips Unicode via \\uXXXX escape (ASCII-safe encoding)', () => {
    const png = makeMinimalPng();
    // Palette names / nicks can carry non-Latin1 chars; the encoder escapes
    // them to \uXXXX, the decoder unescapes them. JSON parses both.
    const value = JSON.stringify({ name: '日本' });
    const injected = injectPngTextChunk(png, 'pyr3', value);
    const chunks = readPngTextChunks(injected);
    expect(chunks.pyr3).toBeDefined();
    const parsed = JSON.parse(chunks.pyr3!);
    expect(parsed.name).toBe('日本');
  });

  it('rejects empty or too-long keys', () => {
    const png = makeMinimalPng();
    expect(() => injectPngTextChunk(png, '', 'x')).toThrow();
    expect(() => injectPngTextChunk(png, 'a'.repeat(80), 'x')).toThrow();
  });

  it('rejects non-PNG input', () => {
    const notPng = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(() => injectPngTextChunk(notPng, 'pyr3', '{}')).toThrow();
  });

  it('readPngTextChunks returns empty on non-PNG', () => {
    const notPng = new Uint8Array([1, 2, 3, 4]);
    expect(readPngTextChunks(notPng)).toEqual({});
  });

  it('round-trips a real-shaped pyr3 JSON payload', () => {
    const png = makeMinimalPng();
    const sample = JSON.stringify({
      format: 'pyr3.v1',
      name: 'test-flame',
      xforms: [{ weight: 1, color: 0, vars: [{ kind: 0, weight: 1 }] }],
      palette: { name: 'default', stops: [{ t: 0, r: 255, g: 100, b: 50 }] },
    });
    const injected = injectPngTextChunk(png, 'pyr3', sample);
    const chunks = readPngTextChunks(injected);
    expect(chunks.pyr3).toBe(sample);
    const parsed = JSON.parse(chunks.pyr3!);
    expect(parsed.format).toBe('pyr3.v1');
    expect(parsed.xforms[0].vars[0].kind).toBe(0);
  });
});
