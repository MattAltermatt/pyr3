#!/usr/bin/env node
// One-time feature-index transcoder CLI: schema v1 → v2 (#405 / #393-D).
//
// Reads a Brotli-compressed v1 `features.flam3idx`, widens each record's
// variation bitset 128→512 bits (zero-extended — see feature-index-transcode.ts
// for why this is lossless for the deployed corpus), and writes a
// Brotli-compressed v2 file. No GPU, no re-bake — milliseconds vs ~5.2 hours.
//
//   usage: pyr3-convert-feature-index <in-v1.flam3idx> <out-v2.flam3idx>
//
// Both paths are the Brotli-compressed on-disk form (the chunk delivery format
// the client fetches + `inflateBrotliBytes`-decodes). Quality-11 compression
// matches the deploy pipeline.

import { readFileSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { decodeHeader, FEATURE_INDEX_RECORD_BYTES } from '../src/feature-index.js';
import { transcodeFeatureIndexV1ToV2 } from '../src/feature-index-transcode.js';

const inPath = process.argv[2];
const outPath = process.argv[3];
if (!inPath || !outPath) {
  console.error('usage: pyr3-convert-feature-index <in-v1.flam3idx> <out-v2.flam3idx>');
  process.exit(1);
}

const compressedV1 = readFileSync(inPath);
const rawV1 = new Uint8Array(brotliDecompressSync(compressedV1));
const v1Header = decodeHeader(rawV1);
console.log(
  `[convert] in:  ${inPath} — schema v${v1Header.schemaVersion}, ` +
    `${v1Header.recordCount} records, tag "${v1Header.corpusTag}" ` +
    `(${compressedV1.length} B compressed → ${rawV1.length} B raw)`,
);

const rawV2 = transcodeFeatureIndexV1ToV2(rawV1);
const v2Header = decodeHeader(rawV2);
const compressedV2 = brotliCompressSync(Buffer.from(rawV2), {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
});
writeFileSync(outPath, compressedV2);

console.log(
  `[convert] out: ${outPath} — schema v${v2Header.schemaVersion}, ` +
    `${v2Header.recordCount} records × ${FEATURE_INDEX_RECORD_BYTES} B ` +
    `(${rawV2.length} B raw → ${compressedV2.length} B compressed)`,
);
console.log('[convert] done.');
