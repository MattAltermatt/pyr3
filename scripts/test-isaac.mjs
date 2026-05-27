#!/usr/bin/env node
// Sanity check ISAAC TS port: distribution + uniformity over 1M samples.

import { newIsaacState, irandinit, isaacIrand, RANDSIZ } from '../src/isaac.ts';

const state = newIsaacState();
// Seed with a known pattern (matches what flam3 would do with a fixed seed).
for (let i = 0; i < RANDSIZ; i++) state.randrsl[i] = 0xC0FFEE00 + i;
irandinit(state, true);

console.log('First 32 ISAAC outputs (hex):');
for (let i = 0; i < 32; i++) {
  process.stdout.write(isaacIrand(state).toString(16).padStart(8, '0') + ' ');
  if ((i + 1) % 8 === 0) process.stdout.write('\n');
}

// Uniformity test: 10M samples, distribution across 256 buckets.
const N = 10_000_000;
const buckets = new Uint32Array(256);
for (let i = 0; i < N; i++) {
  const x = isaacIrand(state);
  buckets[x >>> 24]++;
}

const expected = N / 256;
let maxDev = 0, maxIdx = 0;
for (let i = 0; i < 256; i++) {
  const dev = Math.abs(buckets[i] - expected) / expected;
  if (dev > maxDev) { maxDev = dev; maxIdx = i; }
}
console.log(`\nUniformity over ${N} samples (256 buckets):`);
console.log(`  expected per bucket: ${expected}`);
console.log(`  max deviation: ${(maxDev * 100).toFixed(4)}% (bucket ${maxIdx})`);
console.log(`  expected sqrt-N noise floor: ${(100 / Math.sqrt(expected)).toFixed(4)}%`);
