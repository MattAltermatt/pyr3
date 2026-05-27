#!/usr/bin/env node
// Generate a diff image: red = pyr3-too-bright, blue = pyr3-too-dim, gray = match.
// Usage: node scripts/diff-image.mjs <ref.png> <test.png> <out.png>

import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [, , refPath, testPath, outPath] = process.argv;
if (!refPath || !testPath || !outPath) {
  console.error('usage: node scripts/diff-image.mjs <ref.png> <test.png> <out.png>');
  process.exit(1);
}

const ref = PNG.sync.read(readFileSync(refPath));
const test = PNG.sync.read(readFileSync(testPath));
if (ref.width !== test.width || ref.height !== test.height) {
  console.error(`size mismatch: ${ref.width}x${ref.height} vs ${test.width}x${test.height}`);
  process.exit(1);
}

const W = ref.width, H = ref.height;
const out = new PNG({ width: W, height: H });
out.data = Buffer.alloc(W * H * 4);

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
let maxBrighter = 0, maxDimmer = 0;

for (let i = 0; i < ref.data.length; i += 4) {
  const lr = lum(ref.data[i], ref.data[i + 1], ref.data[i + 2]);
  const lt = lum(test.data[i], test.data[i + 1], test.data[i + 2]);
  const d = lt - lr;
  // Red channel: pyr3 brighter than ref. Blue: pyr3 dimmer. Green: agreement.
  if (d > 0) {
    out.data[i] = Math.min(255, d * 1.5);     // R - pyr3 too bright
    out.data[i + 1] = 0;
    out.data[i + 2] = 0;
    if (d > maxBrighter) maxBrighter = d;
  } else if (d < 0) {
    out.data[i] = 0;
    out.data[i + 1] = 0;
    out.data[i + 2] = Math.min(255, -d * 1.5); // B - pyr3 too dim
    if (-d > maxDimmer) maxDimmer = -d;
  } else {
    out.data[i] = 32;
    out.data[i + 1] = 32;
    out.data[i + 2] = 32;
  }
  out.data[i + 3] = 255;
}

writeFileSync(outPath, PNG.sync.write(out));
console.log(`wrote ${outPath} (red=pyr3 too bright max ${maxBrighter.toFixed(1)}, blue=pyr3 too dim max ${maxDimmer.toFixed(1)})`);
