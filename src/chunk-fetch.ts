// Chunk fetch + flame extraction for corpus delivery.
//
// Corpus chunks are brotli-compressed JSON blobs served same-origin at
// `${import.meta.env.BASE_URL}chunks/{gen}/{lo:05d}.flam3chunk` (base-aware —
// the deploy is a project-Pages site under /pyr3/). Each chunk maps decimal sheep ids to
// their raw flam3 XML strings, plus a `_v` metadata key. Chunks are fetched
// as raw ArrayBuffers (opaque extension — no HTTP Content-Encoding) and
// decoded via `inflateBrotli`.

import { inflateBrotli } from './brotli';

/** Number of ids packed into one chunk file. Matches ESF `CHUNK_SIZE`. */
const CHUNK_SIZE = 256;

/**
 * Return the lowest id in the chunk that contains `id`.
 * Mirrors ESF Python `chunk_lo(id)` exactly.
 *
 * @example chunkLo(12345) === 12288
 * @example chunkLo(5) === 0
 */
export function chunkLo(id: number): number {
  return Math.floor(id / CHUNK_SIZE) * CHUNK_SIZE;
}

/**
 * Construct the same-origin URL for the chunk that contains `(gen, id)`,
 * prefixed with the Vite base (import.meta.env.BASE_URL) so it resolves on a
 * project-Pages site under /pyr3/ as well as an apex domain (base '/').
 * The window is zero-padded to a minimum of 5 digits (ids >= 100000 grow
 * naturally), matching ESF's `f"{lo:05d}"`.
 *
 * @example // base '/pyr3/':  chunkUrl(247, 12345) === '/pyr3/chunks/247/12288.flam3chunk'
 * @example // base '/':       chunkUrl(247, 12345) === '/chunks/247/12288.flam3chunk'
 */
export function chunkUrl(gen: number, id: number): string {
  const lo = chunkLo(id);
  const padded = String(lo).padStart(5, '0');
  return `${import.meta.env.BASE_URL}chunks/${gen}/${padded}.flam3chunk`;
}

/**
 * Thrown when a corpus chunk loads successfully but does not contain the
 * requested flame id.
 */
export class FlameNotFound extends Error {
  constructor(
    public readonly gen: number,
    public readonly id: number,
  ) {
    super(`FlameNotFound: gen=${gen} id=${id} absent from chunk`);
    this.name = 'FlameNotFound';
  }
}

/**
 * Fetch the corpus chunk for `(gen, id)`, brotli-decode it, and return the
 * flam3 XML string for that sheep.
 *
 * Throws `FlameNotFound` if the id is absent from the decoded chunk map.
 * Throws `Error` if the HTTP response is not OK.
 *
 * @param gen       Generation number (e.g. 247, 248).
 * @param id        Sheep id within that generation.
 * @param fetchImpl Injected fetch — defaults to the global `fetch`. Allows
 *                  test fakes without network access.
 */
export async function fetchFlameXml(
  gen: number,
  id: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = chunkUrl(gen, id);
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`chunk fetch failed: ${url} → HTTP ${res.status}`);
  }
  // Fetch raw bytes — never assume Content-Encoding (opaque .flam3chunk).
  const bytes = await res.arrayBuffer();
  const text = await inflateBrotli(bytes);
  const map = JSON.parse(text) as Record<string, string>;
  const xml = map[String(id)];
  if (xml === undefined) {
    throw new FlameNotFound(gen, id);
  }
  return xml;
}
