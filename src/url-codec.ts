// Encode / decode flame XML to and from a URL-safe string.
//
// Format: `v1:<base64url-of-gzipped-xml>`. The `v1:` prefix is a
// schema-version sentinel so future encoding changes can coexist
// with current share links — the decoder rejects unknown prefixes
// with a descriptive error so the visitor knows what happened.
//
// Implementation uses native CompressionStream / DecompressionStream
// (available in modern Chromium, Safari 18+, and Node 17.5+).
// Round-trip tests live in url-codec.test.ts.

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const PREFIX = 'v1:';

export async function encodeFlame(xml: string): Promise<string> {
  const compressed = await streamCompress(ENCODER.encode(xml));
  return PREFIX + base64urlEncode(compressed);
}

export async function decodeFlame(encoded: string): Promise<string> {
  if (!encoded.startsWith(PREFIX)) {
    throw new Error(
      `Unknown share-link format (expected ${PREFIX} prefix, got "${encoded.slice(0, 6)}…")`,
    );
  }
  const decompressed = await streamDecompress(base64urlDecode(encoded.slice(PREFIX.length)));
  return DECODER.decode(decompressed);
}

async function streamCompress(data: Uint8Array): Promise<Uint8Array> {
  // Blob.stream() → pipeThrough propagates errors cleanly through the
  // awaited Response read — no orphaned writer-side rejections.
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function streamDecompress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function base64urlEncode(buf: Uint8Array): string {
  // btoa needs a binary string. Encode each byte as a Latin-1 char.
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
