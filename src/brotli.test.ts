import { describe, it, expect } from 'vitest';
import { brotliCompressSync } from 'node:zlib';
import { inflateBrotli, inflateBrotliBytes, nativeBrotliSupported } from './brotli';

// Helper: produce an ArrayBuffer of brotli-compressed UTF-8 for `text`.
function brotli(text: string): ArrayBuffer {
  const b = brotliCompressSync(Buffer.from(text, 'utf-8'));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

describe('inflateBrotli', () => {
  it('round-trips a brotli payload', async () => {
    const text = JSON.stringify({ _v: 1, '5': "<flame name='a'>x</flame>" });
    expect(await inflateBrotli(brotli(text))).toBe(text);
  });

  it('uses native DecompressionStream when the runtime supports it', () => {
    // Native brotli landed in Node 24.7; CI pins Node 24 (see ci.yml). On an
    // older runtime this capability check is simply absent — the wasm fallback
    // covers it — so we don't hard-fail, we document the expectation.
    if (!nativeBrotliSupported()) return;
    expect(nativeBrotliSupported()).toBe(true);
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

  it('throws when decompressed output exceeds the 64 MB cap (PYR3-065 bomb guard)', async () => {
    // 64 MB + 1 KB of zeros compresses to a few KB but decompresses past the
    // cap — the inflate must abort rather than buffer the whole bomb.
    // Wall-clock here: brotliCompressSync of 64MB of zeros + the streaming
    // inflate that races the abort. ~2s locally but flakes past vitest's
    // default 5s timeout on under-spec'd CI runners — bump explicitly.
    const oversize = brotliCompressSync(Buffer.alloc(64 * 1024 * 1024 + 1024));
    const ab = oversize.buffer.slice(
      oversize.byteOffset,
      oversize.byteOffset + oversize.byteLength,
    );
    await expect(inflateBrotliBytes(ab)).rejects.toThrow(/cap|decompression bomb/i);
  }, 30_000);
});
