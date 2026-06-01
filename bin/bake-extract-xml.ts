// Pure XML-derived feature extraction for the feature-index bake pipeline.
// Given a parsed Genome, produce the variation bitset + xform count fields
// that go into one feature-index record. No I/O, no GPU, no DOM — the bake
// CLI calls this once per sheep after flame-import has handed back a Genome.
//
// Why uniformly across all xforms (regular + finalxform): a flame "uses" a
// variation in the perceptual / discoverability sense if any of its xforms
// reference it, and the finalxform is a real on-image lens — its kernels
// shape what the viewer sees. distinctVariationNames in src/genome.ts already
// makes this choice for the info-bar; mirror it here so filter-by-variation
// in the gallery matches the variation list users actually read on a sheep.
//
// xformCount counts only the regular xforms array (genome.xforms.length). The
// finalxform isn't part of the chaos pool — it's a post-pick lens — and the
// stat is meant to surface "this flame's chaos complexity" at a glance.

import { bitsetSet, VARIATION_BITSET_BYTES } from '../src/feature-index';
import type { Genome } from '../src/genome';

export interface ExtractedXmlFeatures {
  variationBitset: Uint8Array;
  xformCount: number;
}

export function extractXmlFeatures(genome: Genome): ExtractedXmlFeatures {
  const variationBitset = new Uint8Array(VARIATION_BITSET_BYTES);
  for (const xform of genome.xforms) {
    for (const v of xform.variations) {
      bitsetSet(variationBitset, v.index);
    }
  }
  if (genome.finalxform) {
    for (const v of genome.finalxform.variations) {
      bitsetSet(variationBitset, v.index);
    }
  }
  return { variationBitset, xformCount: genome.xforms.length };
}
