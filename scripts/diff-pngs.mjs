#!/usr/bin/env node
// Per-pixel + per-region PNG diff. Quantifies pyr3-vs-flam3 parity gap.
//   node scripts/diff-pngs.mjs <ref.png> <test.png>

import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [, , refPath, testPath] = process.argv;
if (!refPath || !testPath) {
  console.error('usage: node scripts/diff-pngs.mjs <ref.png> <test.png>');
  process.exit(1);
}

const ref = PNG.sync.read(readFileSync(refPath));
const test = PNG.sync.read(readFileSync(testPath));
if (ref.width !== test.width || ref.height !== test.height) {
  console.error(`size mismatch: ${ref.width}x${ref.height} vs ${test.width}x${test.height}`);
  process.exit(1);
}

const W = ref.width, H = ref.height;
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function stats(label, png) {
  const d = png.data;
  // Per-quadrant accumulators: [TL, TR, BL, BR]
  const sums = [0, 0, 0, 0], counts = [0, 0, 0, 0], blacks = [0, 0, 0, 0];
  const histo = new Array(16).fill(0);
  let total = 0, totalBlack = 0;
  for (let y = 0; y < H; y++) {
    const isTop = y < H / 2;
    for (let x = 0; x < W; x++) {
      const isLeft = x < W / 2;
      const q = (isTop ? 0 : 2) + (isLeft ? 0 : 1);
      const i = (y * W + x) * 4;
      const L = lum(d[i], d[i + 1], d[i + 2]);
      sums[q] += L; counts[q]++;
      total += L;
      if (L < 1) { blacks[q]++; totalBlack++; }
      histo[Math.min(15, Math.floor(L / 16))]++;
    }
  }
  const N = W * H;
  console.log(`\n=== ${label} ===`);
  console.log(`mean lum: ${(total / N).toFixed(2)} | %black: ${(100 * totalBlack / N).toFixed(2)}`);
  const qNames = ['TL', 'TR', 'BL', 'BR'];
  for (let q = 0; q < 4; q++) {
    console.log(`  ${qNames[q]}: mean=${(sums[q] / counts[q]).toFixed(2)} %black=${(100 * blacks[q] / counts[q]).toFixed(2)}`);
  }
  console.log(`  histo (lum buckets, 16-wide each):`);
  console.log('    ' + histo.map((n, i) => `[${i * 16}-${(i + 1) * 16 - 1}]:${n}`).join(' '));
}

stats('REF  ' + refPath, ref);
stats('TEST ' + testPath, test);

// Per-pixel diff
let maxDiff = 0, maxAt = [0, 0], sumDiff = 0;
for (let i = 0; i < ref.data.length; i += 4) {
  const dR = Math.abs(ref.data[i] - test.data[i]);
  const dG = Math.abs(ref.data[i + 1] - test.data[i + 1]);
  const dB = Math.abs(ref.data[i + 2] - test.data[i + 2]);
  const d = Math.max(dR, dG, dB);
  sumDiff += dR + dG + dB;
  if (d > maxDiff) {
    maxDiff = d;
    const px = i / 4;
    maxAt = [px % W, Math.floor(px / W)];
  }
}
console.log(`\n=== diff ===`);
console.log(`max channel diff: ${maxDiff} at (${maxAt[0]},${maxAt[1]})`);
console.log(`mean abs diff per channel: ${(sumDiff / (W * H * 3)).toFixed(2)}`);
