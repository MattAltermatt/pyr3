#!/usr/bin/env node
// One-shot migration: v0.18 → v0.19 meta.json schema.
//   baselineR     → expectedR
//   feBeBaselineR → feBeExpectedR
//   + tier: 1 | 2   (rule: expectedR >= 5 → tier 2)
//   + notes (tier-2 only)
//   + calibration string bump
// Idempotent: re-running on already-migrated files is a no-op.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const GOLDENS_DIR = 'fixtures/flam3-goldens';
const TIER_CUTOFF = 5.0;
const TIER2_NOTES =
  'engine-precision-drift, not regression — GPU f32 vs CPU f64 in variation kernels; see PYR3-029 Phase 5/6 closure.';
const V019_CAL =
  'v0.19 (2026-05-28): tier-aware schema. expectedR = mean of 3 pyr3 runs vs flam3-C golden. thresholdR = expectedR + 1.0 headroom. tier 2 if expectedR ≥ 5.0.';

const dirs = readdirSync(GOLDENS_DIR).filter(
  (d) => !d.startsWith('.') && d !== 'README.md',
);

let migrated = 0;
let alreadyV019 = 0;
const summary = [];

for (const id of dirs) {
  const path = join(GOLDENS_DIR, id, 'meta.json');
  const raw = readFileSync(path, 'utf8');
  const m = JSON.parse(raw);

  const expectedR = m.expectedR ?? m.baselineR;
  if (expectedR === undefined) {
    console.error(`skip ${id}: no baselineR/expectedR`);
    continue;
  }

  const feBeExpectedR = m.feBeExpectedR ?? m.feBeBaselineR;
  const tier = expectedR >= TIER_CUTOFF ? 2 : 1;

  const next = {
    id: m.id,
    width: m.width,
    height: m.height,
    expectedR,
    thresholdR: m.thresholdR ?? expectedR + 1.0,
    tier,
    ...(tier === 2 ? { notes: TIER2_NOTES } : {}),
    source: m.source,
    calibration: V019_CAL,
    feBeExpectedR,
    feBeThresholdR: m.feBeThresholdR,
  };

  const before = JSON.stringify(m);
  const after = JSON.stringify(next);
  if (before === after) {
    alreadyV019++;
    continue;
  }

  writeFileSync(path, JSON.stringify(next, null, 2) + '\n');
  migrated++;
  summary.push(`  ${id.padEnd(28)}  expectedR=${expectedR.toFixed(2).padStart(6)}  tier=${tier}`);
}

console.log(`migrated ${migrated} files (${alreadyV019} already at v0.19)`);
for (const line of summary) console.log(line);
