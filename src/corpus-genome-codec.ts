// Corpus chunk values are EITHER flam3 XML (ESF gens) or pyr3-JSON (the
// pyr3-native gen 1, #435). pyr3's novel variations + params can't round-trip
// through flam3 XML, so natives stay pyr3-JSON in-chunk. Sniff the first
// non-space char to pick the codec — gen-agnostic, future-proof.
import type { Genome } from './genome';
import { genomeFromJson } from './serialize';
import { parseFlame } from './flame-import';

/** True when a corpus chunk value is a pyr3-JSON genome (vs flam3 XML). */
export function corpusStringIsJson(s: string): boolean {
  return s.trimStart().startsWith('{');
}

/** Parse a corpus chunk value (flam3 XML or pyr3-JSON) into a Genome. */
export function genomeFromCorpusString(s: string): Genome {
  return corpusStringIsJson(s) ? genomeFromJson(JSON.parse(s)) : parseFlame(s).genome;
}
