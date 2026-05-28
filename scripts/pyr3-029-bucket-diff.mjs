#!/usr/bin/env node
// PYR3-029 Phase 1 driver — cross-fixture pyr3 vs flam3 histogram-bucket
// ratio table. Runs pyr3-hist + flam3-render-32bit-isaac per corpus fixture,
// parses the [PYR3-DEBUG] BUCKETS stderr lines from both, normalizes by
// sum_count (since pyr3 and flam3 use different total sample budgets), and
// emits a markdown table at `.remember/tmp/pyr3-029-ratio-table.md`.
//
// Per-channel ratio = (pyr3 sum_c / pyr3 sum_count) / (flam3 sum_c / flam3 sum_count)
// — i.e. fraction of chromatic mass per channel after the chaos game, made
// directly comparable across different sample-count totals.
//
// Usage:
//   node scripts/pyr3-029-bucket-diff.mjs                  # all fixtures
//   node scripts/pyr3-029-bucket-diff.mjs --fixtures=A,B   # subset

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const GOLDENS = join(REPO, 'fixtures', 'flam3-goldens');
const FLAM3_BIN = '/Users/matt/dev/sheep/flam3/flam3-render-32bit-isaac';
const OUT = join(REPO, '.remember', 'tmp', 'pyr3-029-ratio-table.md');

function parseArgs(argv) {
  const filter = new Set();
  for (const a of argv.slice(2)) {
    if (a.startsWith('--fixtures=')) {
      for (const id of a.slice('--fixtures='.length).split(',')) filter.add(id);
    }
  }
  return filter;
}

function listFixtures(filter) {
  const ids = readdirSync(GOLDENS).filter((d) => {
    const meta = join(GOLDENS, d, 'meta.json');
    return existsSync(meta);
  });
  ids.sort();
  if (filter.size === 0) return ids;
  return ids.filter((id) => filter.has(id));
}

function loadMeta(id) {
  const meta = JSON.parse(readFileSync(join(GOLDENS, id, 'meta.json'), 'utf8'));
  return { baselineR: meta.baselineR ?? null };
}

function locateFlame(id) {
  const dir = join(GOLDENS, id);
  const candidates = readdirSync(dir).filter((f) => f.endsWith('.flame') || f.endsWith('.flam3'));
  if (candidates.length === 0) throw new Error(`no .flame in ${dir}`);
  return join(dir, candidates[0]);
}

function parseBuckets(stderrText) {
  // Format:
  //   [PYR3-DEBUG] BUCKETS sum_r=<i> sum_g=<i> sum_b=<i> sum_alpha=<i> sum_count=<i>
  //   [PYR3-DEBUG] BUCKETS nonzero=<i> total_pixels=<i> max_cnt_per_px=<i> mean_cnt_nonzero=<i|f>
  // Both engines emit identical leading tag. pyr3 emits on stdout, flam3 on stderr.
  const out = { sum_r: null, sum_g: null, sum_b: null, sum_count: null, nonzero: null, total_pixels: null };
  for (const line of stderrText.split('\n')) {
    if (!line.includes('BUCKETS')) continue;
    const m1 = line.match(/sum_r=(\d+) sum_g=(\d+) sum_b=(\d+) sum_alpha=(\d+) sum_count=(\d+)/);
    if (m1) {
      out.sum_r = BigInt(m1[1]);
      out.sum_g = BigInt(m1[2]);
      out.sum_b = BigInt(m1[3]);
      out.sum_count = BigInt(m1[5]);
    }
    const m2 = line.match(/nonzero=(\d+) total_pixels=(\d+)/);
    if (m2) {
      out.nonzero = Number(m2[1]);
      out.total_pixels = Number(m2[2]);
    }
  }
  return out;
}

function runPyr3(flamePath) {
  const r = spawnSync(
    'node',
    [
      '--import', 'tsx/esm',
      '--import', './bin/wgsl-loader-register.mjs',
      'bin/pyr3-hist.ts',
      flamePath,
    ],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    console.error(`pyr3-hist failed (status=${r.status}) on ${flamePath}\nstderr:\n${r.stderr}`);
    return null;
  }
  // pyr3-hist emits BUCKETS lines on stdout.
  return parseBuckets(r.stdout);
}

function runFlam3(flamePath) {
  const flameText = readFileSync(flamePath, 'utf8');
  const flameCount = (flameText.match(/<flame /g) || []).length;
  // Multi-genome flames need a <flames> wrapper.
  const stdin = flameCount > 1 ? `<flames>\n${flameText}\n</flames>` : flameText;
  // qs=1 (default quality), nstrips=1, render to /tmp out to avoid pollution.
  const r = spawnSync(
    FLAM3_BIN,
    [],
    {
      input: stdin,
      cwd: '/tmp',
      env: { ...process.env, qs: '1', prefix: 'pyr3-029-flam3-' },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (r.status !== 0 && r.status !== null) {
    console.error(`flam3 failed (status=${r.status}) on ${flamePath}`);
    return null;
  }
  return parseBuckets(r.stderr);
}

function fmtRatio(pyr3, flam3) {
  // Per-channel normalized: (pyr3 sum_c / pyr3 sum_count) / (flam3 sum_c / flam3 sum_count)
  // Use Number — sums are ≤ 1e12 ish so well within f64 mantissa.
  if (pyr3 === 0n || flam3 === 0n) return 'n/a';
  return (Number(pyr3) / Number(flam3)).toFixed(3);
}

function normalize(b) {
  if (!b.sum_count || b.sum_count === 0n) return null;
  const total = Number(b.sum_count);
  return {
    r: Number(b.sum_r) / total,
    g: Number(b.sum_g) / total,
    b: Number(b.sum_b) / total,
  };
}

async function main() {
  const filter = parseArgs(process.argv);
  const ids = listFixtures(filter);
  console.error(`[pyr3-029] running ${ids.length} fixture(s)`);

  const rows = [];
  for (const id of ids) {
    process.stderr.write(`[pyr3-029] ${id} … `);
    const t0 = Date.now();
    const flame = locateFlame(id);
    const pyr3 = runPyr3(flame);
    const flam3 = runFlam3(flame);
    const meta = loadMeta(id);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (!pyr3 || !flam3 || pyr3.sum_count === null || flam3.sum_count === null) {
      console.error(`FAIL (${elapsed}s)`);
      rows.push({ id, status: 'fail', baselineR: meta.baselineR });
      continue;
    }
    const np = normalize(pyr3);
    const nf = normalize(flam3);
    const ratioR = np.r / nf.r;
    const ratioG = np.g / nf.g;
    const ratioB = np.b / nf.b;
    const maxDrift = Math.max(Math.abs(ratioR - 1), Math.abs(ratioG - 1), Math.abs(ratioB - 1));
    console.error(
      `R/G/B ratios ${ratioR.toFixed(3)}/${ratioG.toFixed(3)}/${ratioB.toFixed(3)}  maxDrift=${(maxDrift * 100).toFixed(1)}%  (${elapsed}s)`,
    );
    const sampleRatio = Number(pyr3.sum_count) / Number(flam3.sum_count);
    rows.push({
      id,
      status: 'ok',
      baselineR: meta.baselineR,
      ratioR,
      ratioG,
      ratioB,
      maxDrift,
      sampleRatio,
      pyr3Sum: pyr3.sum_count,
      flam3Sum: flam3.sum_count,
    });
  }

  // Markdown output.
  mkdirSync(dirname(OUT), { recursive: true });
  const lines = [];
  lines.push('# PYR3-029 Phase 1 — chaos-game histogram-bucket ratio table');
  lines.push('');
  lines.push(`Generated ${new Date().toISOString()} via \`scripts/pyr3-029-bucket-diff.mjs\`.`);
  lines.push('');
  lines.push('Per-channel ratio = `(pyr3 sum_c / pyr3 sum_count) / (flam3 sum_c / flam3 sum_count)`');
  lines.push('— fraction of chromatic mass in channel C after the chaos game, normalized to');
  lines.push('total sample budget. 1.000 = identical distribution; deviation = chaos-game drift.');
  lines.push('');
  lines.push('```text');
  lines.push('fixture                       baselineR   ratio_r   ratio_g   ratio_b   maxDrift%   sampleRatio   pyr3/flam3 sum_count');
  lines.push('----------------------------  ---------   -------   -------   -------   ---------   -----------   --------------------');
  for (const r of rows) {
    if (r.status !== 'ok') {
      lines.push(`${r.id.padEnd(28)}  ${String(r.baselineR ?? '—').padEnd(9)}   FAILED`);
      continue;
    }
    const pyr3GB = (Number(r.pyr3Sum) / 1e9).toFixed(1) + 'B';
    const flam3GB = (Number(r.flam3Sum) / 1e9).toFixed(1) + 'B';
    lines.push(
      `${r.id.padEnd(28)}  ${String(r.baselineR ?? '—').padEnd(9)}   ` +
        `${r.ratioR.toFixed(3).padStart(7)}   ` +
        `${r.ratioG.toFixed(3).padStart(7)}   ` +
        `${r.ratioB.toFixed(3).padStart(7)}   ` +
        `${(r.maxDrift * 100).toFixed(1).padStart(8)}%   ` +
        `${r.sampleRatio.toFixed(3).padStart(11)}   ` +
        `${pyr3GB}/${flam3GB}`.padStart(20),
    );
  }
  lines.push('```');
  lines.push('');
  // Correlation summary: simple Pearson on maxDrift% vs baselineR for non-failed rows with R.
  const okRows = rows.filter((r) => r.status === 'ok' && r.baselineR !== null);
  if (okRows.length >= 3) {
    const xs = okRows.map((r) => r.maxDrift * 100);
    const ys = okRows.map((r) => r.baselineR);
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const mx = mean(xs), my = mean(ys);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    const pearson = num / Math.sqrt(dx * dy);
    lines.push(`**Pearson(maxDrift% vs baselineR, n=${okRows.length}):** ${pearson.toFixed(3)}  (chaos-game chromatic-distribution drift hypothesis)`);

    // Second correlation: |sampleRatio - 1| vs baselineR. Tests the
    // sample-budget-mismatch hypothesis.
    const xs2 = okRows.map((r) => Math.abs(r.sampleRatio - 1) * 100);
    const mx2 = mean(xs2);
    let num2 = 0, dx2 = 0;
    for (let i = 0; i < xs2.length; i++) {
      num2 += (xs2[i] - mx2) * (ys[i] - my);
      dx2 += (xs2[i] - mx2) ** 2;
    }
    const pearson2 = num2 / Math.sqrt(dx2 * dy);
    lines.push(`**Pearson(|sampleRatio-1|% vs baselineR, n=${okRows.length}):** ${pearson2.toFixed(3)}  (sample-budget-mismatch hypothesis)`);
    lines.push('');
    lines.push('Interpretation:');
    lines.push('- `> 0.7` → strong positive correlation → the named hypothesis IS the dominant R driver.');
    lines.push('- `0.3–0.7` → moderate contributor.');
    lines.push('- `< 0.3` → weak/uncorrelated → not the driver; pivot.');
  }
  writeFileSync(OUT, lines.join('\n') + '\n');
  console.error(`[pyr3-029] wrote ${OUT}`);
}

main().catch((err) => {
  console.error('pyr3-029 driver failed:', err);
  process.exit(1);
});
