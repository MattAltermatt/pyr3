// Brotli inflate for corpus chunk delivery. Chunks are served as raw,
// pre-compressed bytes with an opaque extension (.flam3chunk), so we fetch
// ArrayBuffers and decode them HERE — never relying on HTTP Content-Encoding.
//
// Decode path is feature-detected:
//   - Safari 18.4+ / Firefox 147+ ship native DecompressionStream("brotli")
//     → ~0 bundle cost.
//   - Chromium (incl. very recent Chrome 148, verified) does NOT — it only
//     supports gzip/deflate. So Chrome/Edge fall back to a lazily-imported
//     wasm decoder (brotli-dec-wasm, ~200 KB, code-split + fetched only on
//     that path). For the dominant engine this fallback is the real path,
//     not an edge case — hence it is bundled, not stubbed.
// gzip IS native everywhere; brotli is kept for its ~5x size win (172 KB vs
// 832 KB per 256-flame chunk), which more than pays back the one-time wasm.

// TS's lib `CompressionFormat` is stale — it lists only gzip/deflate/deflate-raw,
// not "brotli", though the runtime accepts it (Node 24+, 2026 browsers). Cast.
const BROTLI = 'brotli' as CompressionFormat;

// PYR3-065: hard ceiling on decompressed output to bound a decompression-bomb
// DoS. The largest legitimate payload is a ~832 KB corpus chunk; 64 MB is a
// generous ~77× headroom that still caps a malicious chunk well before it can
// exhaust memory. Applied on both decode paths (native stream + wasm).
const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;

let _nativeBrotli: boolean | undefined;

/** Whether this runtime has native DecompressionStream("brotli"). Cached. */
export function nativeBrotliSupported(): boolean {
  if (_nativeBrotli === undefined) {
    try {
      // Constructing throws on runtimes that don't support the format.
      new DecompressionStream(BROTLI);
      _nativeBrotli = true;
    } catch {
      _nativeBrotli = false;
    }
  }
  return _nativeBrotli;
}

/**
 * Inflate brotli-compressed bytes to a UTF-8 string.
 *
 * Used for corpus chunks (`brotli(JSON {id:xml})`) and per-gen availability
 * manifests. Decodes via the native DecompressionStream where available,
 * falling back to a lazily-loaded wasm decoder otherwise.
 */
export async function inflateBrotli(bytes: ArrayBuffer): Promise<string> {
  return new TextDecoder().decode(await inflateBrotliBytes(bytes));
}

/**
 * Inflate brotli-compressed bytes to raw bytes (no text decoding).
 *
 * Needed for the per-gen availability manifest, whose payload is binary
 * LEB128 varints — NOT UTF-8 — so it must not pass through TextDecoder.
 * (`inflateBrotli` is just this + a TextDecoder for the JSON chunk case.)
 */
export async function inflateBrotliBytes(bytes: ArrayBuffer): Promise<Uint8Array> {
  if (nativeBrotliSupported()) {
    const stream = new Response(bytes).body!.pipeThrough(
      new DecompressionStream(BROTLI),
    );
    // Read incrementally so a decompression bomb is aborted as soon as the
    // running total exceeds the cap — never buffering the whole bomb.
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DECOMPRESSED_BYTES) {
        await reader.cancel();
        throw new Error(
          `pyr3: brotli output exceeds ${MAX_DECOMPRESSED_BYTES} byte cap (decompression bomb?)`,
        );
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }
  const inflate = await loadWasmBrotli();
  const out = inflate(new Uint8Array(bytes));
  // The wasm decoder returns the full buffer in one call, so the cap is a
  // post-hoc guard here (still bounds what we hand downstream).
  if (out.byteLength > MAX_DECOMPRESSED_BYTES) {
    throw new Error(
      `pyr3: brotli output exceeds ${MAX_DECOMPRESSED_BYTES} byte cap (decompression bomb?)`,
    );
  }
  return out;
}

// Cached promise for the wasm decoder — initialized at most once, on the
// first fallback decode (Chromium). Subsequent chunk fetches reuse it.
let _wasmBrotli: Promise<(input: Uint8Array) => Uint8Array> | null = null;

/**
 * Lazily import + initialize the wasm brotli decoder (brotli-dec-wasm).
 * Code-split, so it's only fetched on runtimes without native brotli.
 */
function loadWasmBrotli(): Promise<(input: Uint8Array) => Uint8Array> {
  if (!_wasmBrotli) {
    // brotli-dec-wasm's default export is a Promise that resolves to the
    // initialized wasm module exposing `decompress(Uint8Array): Uint8Array`.
    _wasmBrotli = import('brotli-dec-wasm').then(async (mod) => {
      const brotli = await mod.default;
      return (input: Uint8Array) => brotli.decompress(input);
    });
  }
  return _wasmBrotli;
}
