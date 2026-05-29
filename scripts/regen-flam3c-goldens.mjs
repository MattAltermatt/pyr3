#!/usr/bin/env node
// Regenerate fixture goldens from flam3-C directly (replaces the prior
// reference outputs that served as `golden.png`). Each fixture is
// rendered via the local flam3-C reference binary (FLAM3_BIN)
// at qs=1 (full quality), with a fixed `isaac_seed` per fixture so
// goldens are deterministic across regen runs.
//
// After regen, expectedR for each fixture is re-measured (3-run mean
// of pyr3 vs the new golden) and meta.json is rewritten (v0.19 schema):
//   - expectedR  → mean R across 3 pyr3 renders
//   - thresholdR → expectedR + 1.0 headroom
//   - tier       → 2 if expectedR ≥ 5.0 else 1 (engine-precision-drift band)
//   - notes      → boilerplate present on tier-2 fixtures only
//   - source     → "flam3-render-32bit-isaac qs=1 isaac_seed=<id>"
//   - feBeExpectedR / feBeThresholdR preserved from previous meta if present
//
// Usage:
//   node scripts/regen-flam3c-goldens.mjs            # all 19 fixtures
//   node scripts/regen-flam3c-goldens.mjs --fixtures=A,B,C
//   node scripts/regen-flam3c-goldens.mjs --runs=5   # more pyr3 runs per fixture for tighter baseline
//   node scripts/regen-flam3c-goldens.mjs --dry-run  # render + measure but don't overwrite

import { readFileSync, readdirSync, existsSync, writeFileSync, copyFileSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const GOLDENS = join(REPO, 'fixtures', 'flam3-goldens');
const FLAM3_BIN = process.env.FLAM3_BIN || 'flam3-render-32bit-isaac';
const MEASURE_R = join(REPO, '.remember', 'tmp', 'measure-r.mjs');

function parseArgs(argv) {
  const out = { filter: new Set(), runs: 3, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--fixtures=')) {
      for (const id of a.slice('--fixtures='.length).split(',')) out.filter.add(id);
    } else if (a.startsWith('--runs=')) {
      out.runs = Number(a.slice('--runs='.length));
    } else if (a === '--dry-run') {
      out.dryRun = true;
    }
  }
  return out;
}

function listFixtures(filter) {
  const ids = readdirSync(GOLDENS).filter((d) => existsSync(join(GOLDENS, d, 'meta.json')));
  ids.sort();
  return filter.size === 0 ? ids : ids.filter((id) => filter.has(id));
}

function locateFlame(id) {
  const dir = join(GOLDENS, id);
  const f = readdirSync(dir).find((f) => f.endsWith('.flame') || f.endsWith('.flam3'));
  if (!f) throw new Error(`no .flame in ${dir}`);
  return join(dir, f);
}

function renderFlam3(flamePath, id, outDir) {
  // qs=1 → full quality. isaac_seed=<id> → deterministic across regens.
  // prefix written to /tmp then moved to outDir/golden.png.
  const flameText = readFileSync(flamePath, 'utf8');
  const flameCount = (flameText.match(/<flame /g) || []).length;
  const stdin = flameCount > 1 ? `<flames>\n${flameText}\n</flames>` : flameText;
  const prefix = `/tmp/regen-${id}-`;
  const r = spawnSync(FLAM3_BIN, [], {
    input: stdin,
    cwd: '/tmp',
    env: { ...process.env, qs: '1', prefix, isaac_seed: id },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0 && r.status !== null) {
    throw new Error(`flam3 failed (status=${r.status}) on ${flamePath}\nstderr:\n${r.stderr}`);
  }
  const rendered = `${prefix}00000.png`;
  if (!existsSync(rendered)) throw new Error(`flam3 did not produce ${rendered}`);
  return rendered;
}

function renderPyr3(flamePath, outPath) {
  const r = spawnSync(
    'node',
    [
      '--import', 'tsx/esm',
      '--import', './bin/wgsl-loader-register.mjs',
      'bin/pyr3-render.ts',
      flamePath,
      outPath,
    ],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`pyr3-render failed on ${flamePath}\nstderr:\n${r.stderr}`);
}

function measureR(goldenPath, candidatePath) {
  const r = spawnSync('node', [MEASURE_R, goldenPath, candidatePath], {
    cwd: REPO,
    encoding: 'utf8',
  });
  const m = r.stdout.match(/R=([0-9.]+)/);
  if (!m) throw new Error(`measure-r failed:\n${r.stdout}\n${r.stderr}`);
  return Number(m[1]);
}

async function main() {
  const { filter, runs, dryRun } = parseArgs(process.argv);
  const ids = listFixtures(filter);
  console.error(`[regen] ${ids.length} fixture(s), ${runs} pyr3 runs per fixture, dryRun=${dryRun}`);
  console.error('');

  const summary = [];
  for (const id of ids) {
    const fixDir = join(GOLDENS, id);
    const metaPath = join(fixDir, 'meta.json');
    const goldenPath = join(fixDir, 'golden.png');
    const metaPrev = JSON.parse(readFileSync(metaPath, 'utf8'));
    const flame = locateFlame(id);

    process.stderr.write(`[regen] ${id} `);

    // 1. Render flam3-C golden with deterministic seed.
    const t0 = Date.now();
    const flam3Rendered = renderFlam3(flame, id, fixDir);
    const flam3Elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    // 2. Render pyr3 N times against the new golden, measure R.
    const rs = [];
    const t1 = Date.now();
    for (let i = 0; i < runs; i++) {
      const candidate = `/tmp/regen-${id}-pyr3-${i}.png`;
      renderPyr3(flame, candidate);
      const r = measureR(flam3Rendered, candidate);
      rs.push(r);
    }
    const pyr3Elapsed = ((Date.now() - t1) / 1000).toFixed(1);
    rs.sort((a, b) => a - b);
    const mean = rs.reduce((s, v) => s + v, 0) / rs.length;
    const range = rs[rs.length - 1] - rs[0];
    process.stderr.write(
      `flam3=${flam3Elapsed}s pyr3=${pyr3Elapsed}s  R={${rs.map((r) => r.toFixed(2)).join(',')}}  mean=${mean.toFixed(3)}  range=${range.toFixed(3)}\n`,
    );

    const expectedR = Number(mean.toFixed(4));
    const thresholdR = Number((expectedR + 1.0).toFixed(4));
    const tier = expectedR >= 5.0 ? 2 : 1;

    summary.push({
      id,
      prevExpectedR: metaPrev.expectedR ?? metaPrev.baselineR,
      newExpectedR: expectedR,
      newThresholdR: thresholdR,
      tier,
      runs: rs,
      range,
    });

    if (!dryRun) {
      // Replace golden.png + update meta.json with v0.19 schema.
      copyFileSync(flam3Rendered, goldenPath);
      const TIER2_NOTES =
        'engine-precision-drift, not regression — GPU f32 vs CPU f64 in variation kernels; see PYR3-029 Phase 5/6 closure.';
      const meta = {
        id: metaPrev.id,
        width: metaPrev.width,
        height: metaPrev.height,
        expectedR,
        thresholdR,
        tier,
        ...(tier === 2 ? { notes: TIER2_NOTES } : {}),
        source: `flam3-render-32bit-isaac qs=1 isaac_seed=${id}`,
        calibration: `Mean of ${runs} pyr3 runs vs flam3-C golden, ${new Date().toISOString().slice(0, 10)}. thresholdR = expectedR + 1.0 headroom. tier 2 if expectedR ≥ 5.0.`,
        feBeExpectedR: metaPrev.feBeExpectedR ?? metaPrev.feBeBaselineR,
        feBeThresholdR: metaPrev.feBeThresholdR,
      };
      writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
    }
  }

  // Summary table.
  console.error('');
  console.error('Summary:');
  console.error('fixture                       prev R     new R     ΔR       tier   run range');
  console.error('----------------------------  --------   -------   ------   ----   ---------');
  for (const s of summary) {
    const delta = s.newExpectedR - (s.prevExpectedR ?? 0);
    const sign = delta >= 0 ? '+' : '';
    console.error(
      `${s.id.padEnd(28)}  ${String(s.prevExpectedR ?? '—').padStart(8)}   ${s.newExpectedR.toFixed(3).padStart(7)}   ${sign}${delta.toFixed(3).padStart(6)}    ${s.tier}     ±${(s.range / 2).toFixed(3)}`,
    );
  }
  if (dryRun) console.error('\n[regen] DRY-RUN — no files written.');
  else console.error('\n[regen] golden.png + meta.json rewritten for all listed fixtures.');
}

main().catch((err) => {
  console.error('regen-flam3c-goldens failed:', err);
  process.exit(1);
});
