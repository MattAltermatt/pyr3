#!/usr/bin/env node
// #43 re-baseline — re-measure pyr3 expectedR per fixture under the new
// scale-relative jitter default (1e-7 proportional factor), and rewrite each
// `meta.json` to reflect the new baseline. Goldens are unchanged (the
// flam3-C reference doesn't move).
//
// For each fixture: render pyr3 3 times (different seeds) → mean R vs the
// existing flam3-C golden → write expectedR + thresholdR = expectedR + 1.0
// + tier = (expectedR >= 5.0 ? 2 : 1).
//
// Usage:
//   node scripts/pyr3-043-rebaseline.mjs           # all 25 fixtures
//   node scripts/pyr3-043-rebaseline.mjs --dry-run # measure but don't write
//   node scripts/pyr3-043-rebaseline.mjs --fixtures=248.23554,244.42746

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const GOLDENS = join(REPO, 'fixtures', 'flam3-goldens');
const RUNS = 3;

const TIER1_NOTE = 'tier-1 healthy band (R<5) on the scale-relative-jitter engine (#43, k=1e-7 proportional factor). See issue #43 (2026-06-02 re-baseline).';
const TIER2_NOTE = 'tier-2 residual on the scale-relative-jitter engine (#43, k=1e-7). NOT a static-amplitude basin issue — jitter mechanism is auto-tuning per walker. See issue #43 (2026-06-02 re-baseline) + #64 (counter-example).';

function parseArgs(argv) {
  let dryRun = false;
  let filter = null;
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--fixtures=')) filter = new Set(a.slice('--fixtures='.length).split(',').filter(Boolean));
  }
  return { dryRun, filter };
}

function listFixtures(filter) {
  const all = readdirSync(GOLDENS)
    .filter((n) => existsSync(join(GOLDENS, n, 'meta.json')) && existsSync(join(GOLDENS, n, 'golden.png')))
    .sort();
  return filter ? all.filter((id) => filter.has(id)) : all;
}

function findFlamePath(fixtureDir, id) {
  // Naming convention: <id>.flam3 with the coverage. prefix preserved
  const cand = join(fixtureDir, `${id}.flam3`);
  if (existsSync(cand)) return cand;
  // Fallback: any .flam3 in the dir
  const matches = readdirSync(fixtureDir).filter((n) => n.endsWith('.flam3'));
  if (matches.length === 1) return join(fixtureDir, matches[0]);
  throw new Error(`could not find .flam3 source in ${fixtureDir}`);
}

function renderPyr3(flamePath, outPath, seed) {
  // Uses the BE CLI at native dims (no --preset; native quality from genome).
  const r = spawnSync(
    'node',
    [
      '--import', 'tsx/esm',
      '--import', './bin/wgsl-loader-register.mjs',
      'bin/pyr3-render.ts',
      '--seed', String(seed),
      flamePath,
      outPath,
    ],
    { cwd: REPO, encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`pyr3-render failed (status ${r.status}):\n${r.stdout}\n${r.stderr}`);
  }
}

async function measureR(goldenPath, candidatePath) {
  const { PNG } = await import('pngjs');
  const { meanAbsDiffRgba } = await import('../src/compare.ts');
  const g = PNG.sync.read(readFileSync(goldenPath)).data;
  const c = PNG.sync.read(readFileSync(candidatePath)).data;
  if (g.length !== c.length) {
    throw new Error(`dim mismatch: golden ${g.length} vs render ${c.length}`);
  }
  const gRgba = new Uint8Array(g.buffer, g.byteOffset, g.byteLength);
  const cRgba = new Uint8Array(c.buffer, c.byteOffset, c.byteLength);
  return meanAbsDiffRgba(gRgba, cRgba);
}

async function main() {
  const { dryRun, filter } = parseArgs(process.argv);
  const fixtures = listFixtures(filter);

  console.log(`[rebaseline] ${fixtures.length} fixtures × ${RUNS} runs (DEFAULT_WALKER_JITTER = 1e-7 scale-relative)`);
  if (dryRun) console.log(`[rebaseline] DRY-RUN — meta.json files will NOT be written`);
  console.log('');

  const results = [];
  for (const id of fixtures) {
    const fixtureDir = join(GOLDENS, id);
    const flamePath = findFlamePath(fixtureDir, id);
    const goldenPath = join(fixtureDir, 'golden.png');
    const metaPath = join(fixtureDir, 'meta.json');
    const oldMeta = JSON.parse(readFileSync(metaPath, 'utf8'));

    const rs = [];
    for (let run = 0; run < RUNS; run++) {
      const seed = ((parseInt(id.replace(/\D/g, '').slice(-6), 10) || 1) * 100003 + run) >>> 0;
      const outPath = join(REPO, '.remember', 'tmp', `rebaseline-${id}-r${run}.png`);
      renderPyr3(flamePath, outPath, seed);
      const R = await measureR(goldenPath, outPath);
      rs.push(R);
    }
    const expectedR = rs.reduce((a, b) => a + b, 0) / rs.length;
    const thresholdR = expectedR + 1.0;
    const tier = expectedR >= 5.0 ? 2 : 1;

    const delta = oldMeta.expectedR ? ((expectedR - oldMeta.expectedR) / oldMeta.expectedR * 100).toFixed(1) : 'n/a';
    const tierChange = oldMeta.tier && oldMeta.tier !== tier ? ` (tier ${oldMeta.tier}→${tier})` : '';
    console.log(`  ${id.padEnd(28)}  runs=[${rs.map((x) => x.toFixed(3)).join(', ')}]  expectedR ${oldMeta.expectedR?.toFixed(3) ?? '—'} → ${expectedR.toFixed(3)} (${delta}%)${tierChange}`);

    results.push({ id, oldExpectedR: oldMeta.expectedR, expectedR, thresholdR, tier });

    if (!dryRun) {
      const newMeta = {
        ...oldMeta,
        expectedR: +expectedR.toFixed(3),
        thresholdR: +thresholdR.toFixed(3),
        tier,
        notes: tier === 2 ? TIER2_NOTE : TIER1_NOTE,
      };
      writeFileSync(metaPath, JSON.stringify(newMeta, null, 2) + '\n');
    }
  }

  console.log('');
  const t1 = results.filter((r) => r.tier === 1).length;
  const t2 = results.filter((r) => r.tier === 2).length;
  console.log(`[rebaseline] result: ${t1} tier-1 / ${t2} tier-2 / ${results.length} total`);
}

main().catch((e) => { console.error(e); process.exit(1); });
