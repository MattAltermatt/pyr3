// Pure chunk-emit helpers for bake:natives (#435). Kept separate from the
// GPU-heavy CLI so they're unit-testable without importing the renderer/host.
import { chunkLo } from '../../src/chunk-fetch';

/** Group sorted ids into their `chunkLo`-keyed 256-wide windows (the same
 *  windowing chunk-fetch reads back). */
export function groupIdsByChunk(ids: number[]): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const id of [...ids].sort((a, b) => a - b)) {
    const lo = chunkLo(id);
    let arr = m.get(lo);
    if (!arr) {
      arr = [];
      m.set(lo, arr);
    }
    arr.push(id);
  }
  return m;
}

/** Build the `{ "<id>": "<json-string>" }` map a `.flam3chunk` stores. */
export function buildChunkObject(items: { id: number; json: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const it of items) out[String(it.id)] = it.json;
  return out;
}
