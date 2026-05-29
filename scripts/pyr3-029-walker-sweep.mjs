#!/usr/bin/env node
// PYR3-029 Phase 4 — walker-count sweep.
//
// Runs pyr3-pixel-dump + flam3 PYR3_DUMP_ACCUMULATOR at multiple walker
// counts and prints a coverage table. Looking for the walker-count
// sweet spot where pyr3 bothHit% approaches flam3-level coverage on the
// broken outliers WITHOUT regressing the healthy fixtures.

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const GOLDENS = join(REPO, 'fixtures', 'flam3-goldens');
const FLAM3_BIN = process.env.FLAM3_BIN || 'flam3-render-32bit-isaac';
const OUT_DIR = join(REPO, '.remember', 'tmp', 'pyr3-029-walker-sweep');

const FIXTURES = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const WALKER_COUNTS = [1024, 256, 64, 16, 4];

function locateFlame(id) {
  const dir = join(GOLDENS, id);
  const f = readdirSync(dir).find((f) => f.endsWith('.flame') || f.endsWith('.flam3'));
  if (!f) throw new Error(`no .flame in ${dir}`);
  return join(dir, f);
}

function runPyr3(flamePath, outBin, walkers) {
  const r = spawnSync(
    'node',
    [
      '--import', 'tsx/esm',
      '--import', './bin/wgsl-loader-register.mjs',
      'bin/pyr3-pixel-dump.ts',
      flamePath,
      outBin,
      `--walkers=${walkers}`,
    ],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`pyr3-pixel-dump failed (walkers=${walkers})\n${r.stderr}`);
}

function runFlam3(flamePath, outBin) {
  const flameText = readFileSync(flamePath, 'utf8');
  const flameCount = (flameText.match(/<flame /g) || []).length;
  const stdin = flameCount > 1 ? `<flames>\n${flameText}\n</flames>` : flameText;
  const r = spawnSync(FLAM3_BIN, [], {
    input: stdin,
    cwd: '/tmp',
    env: { ...process.env, qs: '1', prefix: '/tmp/sweep-flam3-', PYR3_DUMP_ACCUMULATOR: outBin, isaac_seed: 'sweep' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0 && r.status !== null) throw new Error(`flam3 failed`);
}

function parsePyr3(buf) {
  const hdr = new Uint32Array(buf.buffer, buf.byteOffset, 5);
  const w = hdr[0], h = hdr[1];
  const data = new Uint32Array(buf.buffer, buf.byteOffset + 20, w * h * 4);
  return { w, h, data, ch: 4 };
}

function parseFlam3(buf) {
  const hdr = new Uint32Array(buf.buffer, buf.byteOffset, 5);
  const w = hdr[0], h = hdr[1], bpc = hdr[3];
  if (bpc !== 4) throw new Error(`expected u32 flam3 bucket dtype`);
  const data = new Uint32Array(buf.buffer, buf.byteOffset + 20, w * h * 5);
  return { w, h, data, ch: 5 };
}

function trimFlam3(flam3, targetW, targetH) {
  const gx = Math.floor((flam3.w - targetW) / 2);
  const gy = Math.floor((flam3.h - targetH) / 2);
  if (gx === 0 && gy === 0) return flam3;
  const trimmed = new Uint32Array(targetW * targetH * 5);
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const src = ((y + gy) * flam3.w + (x + gx)) * 5;
      const dst = (y * targetW + x) * 5;
      for (let c = 0; c < 5; c++) trimmed[dst + c] = flam3.data[src + c];
    }
  }
  return { w: targetW, h: targetH, data: trimmed, ch: 5 };
}

function coverageStats(pyr3, flam3) {
  const W = pyr3.w, H = pyr3.h;
  let bothHit = 0, pyr3Only = 0, flam3Only = 0, neither = 0;
  let driftSqSum = 0;
  for (let i = 0; i < W * H; i++) {
    const pc = pyr3.data[i * 4 + 3];
    const fc = flam3.data[i * 5 + 4];
    if (pc > 0 && fc > 0) {
      bothHit++;
      const pr = pyr3.data[i * 4] / pc;
      const pg = pyr3.data[i * 4 + 1] / pc;
      const pb = pyr3.data[i * 4 + 2] / pc;
      const fr = flam3.data[i * 5] / fc;
      const fg = flam3.data[i * 5 + 1] / fc;
      const fb = flam3.data[i * 5 + 2] / fc;
      const dr = pr - fr, dg = pg - fg, db = pb - fb;
      driftSqSum += dr * dr + dg * dg + db * db;
    } else if (pc > 0) pyr3Only++;
    else if (fc > 0) flam3Only++;
    else neither++;
  }
  return {
    bothHit, pyr3Only, flam3Only, neither,
    total: W * H,
    driftMean: bothHit > 0 ? Math.sqrt(driftSqSum / bothHit) : 0,
  };
}

async function main() {
  if (FIXTURES.length === 0) {
    console.error('usage: node scripts/pyr3-029-walker-sweep.mjs <fixture1> [fixture2] ...');
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const rows = [];
  for (const id of FIXTURES) {
    console.error(`\n[sweep] ${id}`);
    const flame = locateFlame(id);
    const flam3Bin = join(OUT_DIR, `${id}-flam3.bin`);
    runFlam3(flame, flam3Bin);
    const flam3Raw = parseFlam3(readFileSync(flam3Bin));

    for (const w of WALKER_COUNTS) {
      const pyr3Bin = join(OUT_DIR, `${id}-pyr3-w${w}.bin`);
      const t0 = Date.now();
      try {
        runPyr3(flame, pyr3Bin, w);
      } catch (e) {
        console.error(`  walkers=${String(w).padStart(4)}  FAILED: ${e.message.split('\n')[0]}`);
        rows.push({ id, walkers: w, failed: true });
        continue;
      }
      const pyr3 = parsePyr3(readFileSync(pyr3Bin));
      const flam3Trim = trimFlam3(flam3Raw, pyr3.w, pyr3.h);
      const s = coverageStats(pyr3, flam3Trim);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const pct = (n) => ((n / s.total) * 100).toFixed(1) + '%';
      console.error(
        `  walkers=${String(w).padStart(4)}  bothHit=${pct(s.bothHit).padStart(6)}  pyr3Only=${pct(s.pyr3Only).padStart(6)}  flam3Only=${pct(s.flam3Only).padStart(6)}  driftMean=${s.driftMean.toFixed(4)}  (${elapsed}s)`,
      );
      rows.push({ id, walkers: w, bothHit: s.bothHit, pyr3Only: s.pyr3Only, flam3Only: s.flam3Only, total: s.total, driftMean: s.driftMean, elapsed: Number(elapsed) });
    }
  }

  const outPath = join(OUT_DIR, 'sweep-summary.json');
  writeFileSync(outPath, JSON.stringify(rows, null, 2));
  console.error(`\n[sweep] summary → ${outPath}`);
}

main().catch((err) => {
  console.error('walker-sweep failed:', err);
  process.exit(1);
});
