#!/usr/bin/env node
// Instrument pyr3's PCG32 RNG to detect xform-pick bias.
// Replicates the chaos.wgsl pick logic in JS, runs N walkers each iterating
// many picks, counts how often each xform is selected.
// For uniform weights (1,1,1) the expected ratio is 1/3 each.

const SEED_BASE = 0xC0FFEE;
const NUM_WALKERS = 4096 * 64; // approximate dispatch
const ITERS_PER_WALKER = 4096;
const FUSE = 200;

// PCG32 — matches chaos.wgsl pcg_next exactly.
function pcgNext(state) {
  const s = state[0];
  // Multiplication wraps at u32 — use Math.imul for u32 mul.
  state[0] = ((Math.imul(s, 747796405) + 2891336453) >>> 0);
  const shift = ((s >>> 28) + 4) >>> 0;
  const word = (Math.imul((((s >>> shift) ^ s) >>> 0), 277803737)) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}
function rand01(state) {
  return pcgNext(state) / 4294967296;
}

// Replicate chaos.wgsl xform-pick logic for 3 equal-weight xforms (no xaos).
function pickXform(rng, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  const r = rand01(rng) * total;
  let acc = 0;
  for (let j = 0; j < weights.length; j++) {
    acc += weights[j];
    if (r < acc) return j;
  }
  return weights.length - 1;
}

const weights = [1, 1, 1];
const counts = [0, 0, 0];
let totalPicks = 0;

const start = Date.now();
for (let w = 0; w < NUM_WALKERS; w++) {
  // Seed per-walker matching chaos.wgsl line 322:
  //   rng = u.seed ^ (walker_id * 2654435761u + 1u);
  //   for (var k = 0u; k < 4u; k = k + 1u) { _ = pcg_next(&rng); }
  let rng = [(SEED_BASE ^ ((Math.imul(w, 2654435761) + 1) >>> 0)) >>> 0];
  for (let k = 0; k < 4; k++) pcgNext(rng);

  // Initial position: 3 rand01 calls (skipped — we just need pick distribution).
  for (let k = 0; k < 3; k++) pcgNext(rng);

  for (let i = 0; i < ITERS_PER_WALKER + FUSE; i++) {
    const fn = pickXform(rng, weights);
    counts[fn]++;
    totalPicks++;
  }
}

const elapsed = (Date.now() - start) / 1000;
console.log(`Sampled ${totalPicks.toLocaleString()} xform picks across ${NUM_WALKERS.toLocaleString()} walkers in ${elapsed.toFixed(2)}s`);
console.log(`Expected per-xform: ${(totalPicks / 3).toLocaleString()} (33.333%)\n`);

const expected = totalPicks / 3;
for (let j = 0; j < 3; j++) {
  const pct = (counts[j] / totalPicks * 100).toFixed(4);
  const dev = (counts[j] - expected) / expected * 100;
  console.log(`  xform[${j}]: ${counts[j].toLocaleString().padStart(15)} (${pct}%)  deviation=${dev.toFixed(4)}%`);
}

// sqrt(N)-noise expectation: relative noise should be ~1/sqrt(N/3).
const expectedNoiseFraction = 1 / Math.sqrt(totalPicks / 3) * 100;
console.log(`\nExpected sqrt-N noise floor: ±${expectedNoiseFraction.toFixed(4)}% per xform`);
