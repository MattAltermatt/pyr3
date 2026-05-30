#!/usr/bin/env node
// Calibrate per-fixture `feBeThresholdR` values from one or more parity
// run log files (the filtered `R(FE,BE)=...` lines emitted by
// `src/parity-fe-be.test.ts`). Strategy:
//
//   thr = max(R across runs) * mulHeadroom + addHeadroom
//
// mulHeadroom = 1.5, addHeadroom = 2.0 — accommodates Math.random() seed
// variance + GPU non-associativity drift across FE/BE on the same machine
// (the determinism contract per pyr3/CLAUDE.md is "approximately equal,
// not byte-identical"). Calibration is a one-shot — re-run when the
// engine changes substantively.
//
// Writes the threshold into each fixture's meta.json `feBeThresholdR`
// field. Logs a summary table.
//
// Usage:  node scripts/pyr3-026-calibrate.mjs <run1.log> [run2.log ...]

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const FIXTURES_DIR = join(REPO_ROOT, 'fixtures', 'flam3-goldens');
const MUL_HEADROOM = 1.5;
const ADD_HEADROOM = 2.0;

const logFiles = process.argv.slice(2);
if (logFiles.length === 0) {
  console.error('usage: node scripts/pyr3-026-calibrate.mjs <run1.log> [run2.log ...]');
  process.exit(1);
}

const R_LINE = /^\[(?<fixture>[^\]]+)\] R\(FE,BE\)=(?<R>[0-9.]+)/;

// Map<fixtureId, R[]>
const runs = new Map();
for (const logPath of logFiles) {
  const text = readFileSync(logPath, 'utf8');
  for (const line of text.split('\n')) {
    const m = R_LINE.exec(line);
    if (!m) continue;
    const id = m.groups.fixture;
    const R = Number(m.groups.R);
    if (!runs.has(id)) runs.set(id, []);
    runs.get(id).push(R);
  }
}

if (runs.size === 0) {
  console.error('no R(FE,BE) lines parsed from any log file');
  process.exit(1);
}

const sortedIds = [...runs.keys()].sort();
console.log(`\nfixture                       Rs                            thr   meta.json`);
console.log(`----------------------------  ----------------------------  ----  ----------`);

for (const id of sortedIds) {
  const Rs = runs.get(id);
  const maxR = Math.max(...Rs);
  const thr = +(maxR * MUL_HEADROOM + ADD_HEADROOM).toFixed(2);
  const rsStr = Rs.map((R) => R.toFixed(2)).join(' ').padEnd(28);
  const metaPath = join(FIXTURES_DIR, id, 'meta.json');
  let metaJsonStatus = '';
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    // PYR3-069: the live meta schema uses feBeExpectedR (renamed from the old
    // feBeBaselineR in v0.19); writing the stale name on re-calibration left a
    // dead field and desynced the FE-BE gate.
    meta.feBeExpectedR = +maxR.toFixed(4);
    meta.feBeThresholdR = thr;
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
    metaJsonStatus = '✓ written';
  } catch (err) {
    metaJsonStatus = `✗ ${err.message}`;
  }
  console.log(`${id.padEnd(28)}  ${rsStr}  ${String(thr).padStart(4)}  ${metaJsonStatus}`);
}

console.log(`\nDone. Re-run \`npm run test:parity-fe-be\` to confirm all fixtures pass with the new thresholds.`);
