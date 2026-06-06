// #119 — URL contract: catalog → editor deep-link.
//
// The catalog's "Open in editor" link encodes the current live state of a
// section (variation idx + slider weight + positional params) into a URL
// the editor's cold-start path consumes verbatim, so opening from the
// catalog visually mirrors what the user was tweaking.

import { V } from './variations';

export interface CatalogEntry {
  idx: number;
  weight: number;
  params: number[];
}

const VALID_INDICES: ReadonlySet<number> = new Set(Object.values(V));

export function linkToEditor(e: CatalogEntry): string {
  const parts = [`from=catalog`, `v=${e.idx}`, `w=${e.weight}`];
  if (e.params.length > 0) parts.push(`p=${e.params.join(',')}`);
  return `/v1/edit?${parts.join('&')}`;
}

/** Parse a catalog-entry deep-link from a /v1/edit URL's search params.
 *  Returns null when the URL isn't a catalog handoff or any value is
 *  malformed — callers fall back to the normal editor cold-start. */
export function parseCatalogEntry(q: URLSearchParams): CatalogEntry | null {
  if (q.get('from') !== 'catalog') return null;

  const vStr = q.get('v');
  if (vStr === null) return null;
  const v = Number(vStr);
  if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) return null;
  // Reject crafted URLs with an out-of-range variation index. Without this
  // the URL deep-link would feed an unknown idx into buildCatalogGenome
  // and silently fall through to the WGSL switch's default (identity), so
  // the editor would open a junk genome named `catalog · V9999`.
  if (!VALID_INDICES.has(v)) return null;

  const wStr = q.get('w');
  const w = wStr !== null ? Number(wStr) : 1;
  if (!Number.isFinite(w)) return null;

  const pStr = q.get('p');
  let params: number[] = [];
  if (pStr !== null && pStr.length > 0) {
    params = pStr.split(',').map(Number);
    if (params.some(n => !Number.isFinite(n))) return null;
  }

  return { idx: v, weight: w, params };
}
