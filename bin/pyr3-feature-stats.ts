#!/usr/bin/env node
// One-off feature-index inspector. Loads features.flam3idx (brotli-compressed
// binary) from a path argument and prints summary stats — total record count,
// xform-count histogram, mean/median xforms, p95/p99 tail. Used to scope the
// gallery filter UI's xform bucketing (#49).

import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import {
  decodeHeader,
  decodeRecord,
  FEATURE_INDEX_HEADER_BYTES,
  FEATURE_INDEX_RECORD_BYTES,
} from '../src/feature-index.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: pyr3-feature-stats <features.flam3idx>');
  process.exit(1);
}

const compressed = readFileSync(path);
const bytes = brotliDecompressSync(compressed);

const header = decodeHeader(bytes);
console.log(`schema    : v${header.schemaVersion}`);
console.log(`corpus    : ${header.corpusTag}`);
console.log(`records   : ${header.recordCount.toLocaleString()}`);
console.log();

const recordsStart = FEATURE_INDEX_HEADER_BYTES;
const recordsBytes = bytes.subarray(
  recordsStart,
  recordsStart + header.recordCount * FEATURE_INDEX_RECORD_BYTES,
);

const xformCounts = new Map<number, number>();
const xformsAll: number[] = [];
for (let i = 0; i < header.recordCount; i++) {
  const rec = decodeRecord(recordsBytes, i * FEATURE_INDEX_RECORD_BYTES);
  xformCounts.set(rec.xforms, (xformCounts.get(rec.xforms) ?? 0) + 1);
  xformsAll.push(rec.xforms);
}

const total = header.recordCount;
const maxX = Math.max(...xformCounts.keys());
const minX = Math.min(...xformCounts.keys());

console.log('xform count distribution:');
console.log('  N   count    pct       cum%   bar');
let cum = 0;
for (let n = minX; n <= maxX; n++) {
  const c = xformCounts.get(n) ?? 0;
  if (c === 0) continue;
  cum += c;
  const pct = (c / total) * 100;
  const cumPct = (cum / total) * 100;
  const barW = Math.max(1, Math.round((c / total) * 60));
  console.log(
    `  ${String(n).padStart(2)}  ${String(c).padStart(6)}  ${pct.toFixed(2).padStart(5)}%   ${cumPct.toFixed(1).padStart(5)}%  ${'█'.repeat(barW)}`,
  );
}
console.log();

xformsAll.sort((a, b) => a - b);
const median = xformsAll[Math.floor(total / 2)];
const p90 = xformsAll[Math.floor(total * 0.9)];
const p95 = xformsAll[Math.floor(total * 0.95)];
const p99 = xformsAll[Math.floor(total * 0.99)];
const p999 = xformsAll[Math.floor(total * 0.999)];
const mean = xformsAll.reduce((a, b) => a + b, 0) / total;

console.log(`min       : ${minX}`);
console.log(`max       : ${maxX}`);
console.log(`mean      : ${mean.toFixed(2)}`);
console.log(`median    : ${median}`);
console.log(`p90       : ${p90}`);
console.log(`p95       : ${p95}`);
console.log(`p99       : ${p99}`);
console.log(`p99.9     : ${p999}`);
