// flam3 palette-library lookup (PYR3-022). The canonical fallback when a .flame
// carries no inline <palette>/<color>/<colors> block but references a library
// palette by index via `<flame palette="N">` (flam3 parser.c:380 +
// flam3_get_palette). Data lives in the generated flam3-palettes-data.ts.
//
// Seam-clean: `atob` is a global in both Node (16+) and the browser, so this
// works unmodified in both consumers with no env branching and no async.

import { type ColorStop } from './palette';
import { FLAM3_PALETTE_COUNT, FLAM3_PALETTES_B64 } from './flam3-palettes-data';

const STRIDE = 256 * 3; // bytes per palette (256 RGB triples)

// Decode the base64 blob to bytes once, lazily — most renders use inline
// palettes and never touch the library, so we don't pay the ~538KB decode
// unless a fallback actually fires.
let cache: Uint8Array | null = null;
function bytes(): Uint8Array {
  if (cache) return cache;
  const bin = atob(FLAM3_PALETTES_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  cache = out;
  return out;
}

/** flam3 library palette `index` as 256 ColorStops (t = i/255; r/g/b in [0,1]),
 *  matching parsePalette's output shape so it drops straight into a Genome.
 *  Returns null when `index` is not a valid library index. */
export function getLibraryStops(index: number): ColorStop[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= FLAM3_PALETTE_COUNT) {
    return null;
  }
  const data = bytes();
  const base = index * STRIDE;
  const stops: ColorStop[] = new Array(256);
  for (let i = 0; i < 256; i++) {
    const o = base + i * 3;
    stops[i] = { t: i / 255, r: data[o]! / 255, g: data[o + 1]! / 255, b: data[o + 2]! / 255 };
  }
  return stops;
}

export { FLAM3_PALETTE_COUNT };
