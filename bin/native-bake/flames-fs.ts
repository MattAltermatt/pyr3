// Shared fs/genome helpers for the curate + publish pipeline (incoming/ → json/).
// IDENTITY RULE: callers write the RAW parsed pyr3-JSON returned here, never a
// genomeToJson re-derivation — so canonicalFlameHash stays stable and the gallery
// id of a json/<id>.pyr3.json file never drifts. See the pipeline design spec.
import { readFileSync } from 'node:fs';
import { readPngTextChunks } from '../../src/png-text-chunk';
import { genomeFromJson, type Pyr3JsonV1 } from '../../src/serialize';

export function pad5(n: number): string {
  return String(n).padStart(5, '0');
}

export function jsonName(id: number): string {
  return `${pad5(id)}.pyr3.json`;
}

export function pngName(id: number): string {
  return `${pad5(id)}.png`;
}

/** Parse a flame id out of a `<id>.pyr3.json` filename, or null if it doesn't match. */
export function idFromJsonName(name: string): number | null {
  const m = /^(\d+)\.pyr3\.json$/.exec(name);
  return m ? Number(m[1]) : null;
}

/** Load the raw pyr3-JSON from a png (embedded `pyr3` tEXt chunk) or a `.pyr3.json`
 *  file. Returns the parsed object UNCHANGED (validated via genomeFromJson), or null
 *  if it is not a valid pyr3 flame (bad file, missing chunk, parse/validate error). */
export function loadIncomingGenomeJson(absPath: string): Pyr3JsonV1 | null {
  const lower = absPath.toLowerCase();
  try {
    let raw: string;
    if (lower.endsWith('.png')) {
      const embedded = readPngTextChunks(new Uint8Array(readFileSync(absPath)))['pyr3'];
      if (!embedded) return null;
      raw = embedded;
    } else if (lower.endsWith('.json')) {
      raw = readFileSync(absPath, 'utf8');
    } else {
      return null;
    }
    const parsed = JSON.parse(raw) as Pyr3JsonV1;
    genomeFromJson(parsed); // throws if not a real flame → caught below
    return parsed;
  } catch {
    return null;
  }
}
