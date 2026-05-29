import { describe, it, expect } from 'vitest';
import { brotliCompressSync } from 'node:zlib';
import { inflateBrotli, inflateBrotliBytes, nativeBrotliSupported } from './brotli';

// Helper: produce an ArrayBuffer of brotli-compressed UTF-8 for `text`.
function brotli(text: string): ArrayBuffer {
  const b = brotliCompressSync(Buffer.from(text, 'utf-8'));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

describe('inflateBrotli', () => {
  it('round-trips a brotli payload (native path)', async () => {
    // This Node ships native DecompressionStream("brotli"); assert we use it.
    expect(nativeBrotliSupported()).toBe(true);
    const text = JSON.stringify({ _v: 1, '5': "<flame name='a'>x</flame>" });
    expect(await inflateBrotli(brotli(text))).toBe(text);
  });

  it('preserves non-ASCII bytes', async () => {
    const text = "<flame name='café ☕'>—</flame>";
    expect(await inflateBrotli(brotli(text))).toBe(text);
  });

  it('handles an empty payload', async () => {
    expect(await inflateBrotli(brotli(''))).toBe('');
  });
});

describe('inflateBrotliBytes', () => {
  it('round-trips raw binary bytes (not UTF-8 text)', async () => {
    // bytes that are NOT valid UTF-8 — must survive without text mangling
    const raw = Uint8Array.from([0x8b, 0x01, 0x80, 0x00, 0xff, 0xa7, 0x02]);
    const c = brotliCompressSync(Buffer.from(raw));
    const ab = c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength);
    const out = await inflateBrotliBytes(ab);
    expect(Array.from(out)).toEqual(Array.from(raw));
  });

  it('handles an empty payload', async () => {
    const c = brotliCompressSync(Buffer.alloc(0));
    const ab = c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength);
    expect((await inflateBrotliBytes(ab)).length).toBe(0);
  });
});
