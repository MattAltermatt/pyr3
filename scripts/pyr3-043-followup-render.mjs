#!/usr/bin/env node
// #43 follow-up — render each candidate (flam3-C golden + pyr3) and compute R.
// Reads `.remember/tmp/issue-43-followup/candidates.jsonl` (from
// pyr3-043-followup-candidates.mjs), produces:
//   - per-candidate PNG pair in `.remember/tmp/issue-43-followup/<gen>.<id>/`
//   - aggregated JSONL of {class, gen, id, R, tier} at `results.jsonl`
//   - human-readable summary table to stdout

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const OUT_DIR = join(REPO, '.remember', 'tmp', 'issue-43-followup');
const ESF_ROOT = '/Users/matt/dev/MattAltermatt/electric-sheep-fold';
const FLAM3_BIN = '/Users/matt/dev/sheep/flam3/flam3-render-32bit-isaac';

function esfPath(gen, id) {
  const bucket = Math.floor(id / 10000) * 10000;
  return join(ESF_ROOT, 'corpus', String(gen), String(bucket), `electricsheep.${gen}.${id}.flam3`);
}

function renderFlam3(flamePath, goldenOut, isaacSeed) {
  if (existsSync(goldenOut)) return { cached: true, ms: 0 };
  const t0 = Date.now();
  const r = spawnSync(FLAM3_BIN, [], {
    env: { ...process.env, in: flamePath, out: goldenOut, isaac_seed: String(isaacSeed), qs: '1' },
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(`flam3-render failed (status ${r.status}) on ${flamePath}:\n${r.stderr}`);
  }
  return { cached: false, ms: Date.now() - t0 };
}

function renderPyr3(flamePath, pyr3Out, seed) {
  if (existsSync(pyr3Out)) return { cached: true, ms: 0 };
  const t0 = Date.now();
  const r = spawnSync(
    'node',
    ['--import', 'tsx/esm', '--import', './bin/wgsl-loader-register.mjs',
     'bin/pyr3-render.ts', '--seed', String(seed), flamePath, pyr3Out],
    { cwd: REPO, encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`pyr3-render failed (status ${r.status}) on ${flamePath}:\n${r.stdout}\n${r.stderr}`);
  }
  return { cached: false, ms: Date.now() - t0 };
}

async function measureR(goldenPath, candidatePath) {
  const { meanAbsDiffRgba } = await import('../src/compare.ts');
  const g = PNG.sync.read(readFileSync(goldenPath)).data;
  const c = PNG.sync.read(readFileSync(candidatePath)).data;
  if (g.length !== c.length) {
    return { R: null, error: `dim mismatch: g=${g.length} c=${c.length}` };
  }
  const gRgba = new Uint8Array(g.buffer, g.byteOffset, g.byteLength);
  const cRgba = new Uint8Array(c.buffer, c.byteOffset, c.byteLength);
  return { R: meanAbsDiffRgba(gRgba, cRgba), error: null };
}

function classifyTier(R) {
  if (R === null) return 'error';
  if (R < 5.0) return 'tier-1';
  if (R < 10.0) return 'tier-2';
  return 'tier-3 (R≥10, real issue)';
}

async function main() {
  const candidatesPath = join(OUT_DIR, 'candidates.jsonl');
  if (!existsSync(candidatesPath)) {
    console.error(`missing ${candidatesPath} — run scripts/pyr3-043-followup-candidates.mjs first`);
    process.exit(1);
  }
  const candidates = readFileSync(candidatesPath, 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));

  console.log(`[render] ${candidates.length} candidates · est. 30-60 min (flam3-C goldens dominate)`);
  console.log('');

  const results = [];
  const overallStart = Date.now();

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const id = `${c.gen}.${c.id}`;
    const flamePath = esfPath(c.gen, c.id);
    if (!existsSync(flamePath)) {
      console.log(`[${i+1}/${candidates.length}] ${id} (class ${c.class}) — MISSING source ${flamePath}`);
      results.push({ ...c, R: null, tier: 'error', note: 'source missing' });
      continue;
    }
    const dir = join(OUT_DIR, id);
    mkdirSync(dir, { recursive: true });
    const goldenPath = join(dir, 'golden.png');
    const pyr3Path = join(dir, 'pyr3.png');

    try {
      const t0 = Date.now();
      const g = renderFlam3(flamePath, goldenPath, c.id);
      const p = renderPyr3(flamePath, pyr3Path, 12345);
      const { R, error } = await measureR(goldenPath, pyr3Path);
      const tier = classifyTier(R);
      const wallMs = Date.now() - t0;
      const elapsed = ((Date.now() - overallStart) / 1000).toFixed(0);
      const cacheNote = g.cached && p.cached ? ' [cached]' : g.cached ? ' [golden cached]' : p.cached ? ' [pyr3 cached]' : '';
      console.log(`[${(i+1).toString().padStart(2)}/${candidates.length} elapsed ${elapsed}s] ${id.padEnd(13)} class=${c.class}  R=${R !== null ? R.toFixed(3).padStart(7) : '   FAIL'}  ${tier.padEnd(22)}  goldenMs=${g.ms} pyr3Ms=${p.ms}${cacheNote}`);
      results.push({ ...c, R, tier, error });
    } catch (e) {
      console.log(`[${(i+1).toString().padStart(2)}/${candidates.length}] ${id} class=${c.class}  ERROR: ${e.message}`);
      results.push({ ...c, R: null, tier: 'error', error: e.message });
    }
  }

  const resultsPath = join(OUT_DIR, 'results.jsonl');
  writeFileSync(resultsPath, results.map((r) => JSON.stringify(r)).join('\n') + '\n');

  console.log('');
  console.log(`=== SUMMARY BY CLASS ===`);
  const byClass = {};
  for (const r of results) {
    byClass[r.class] = byClass[r.class] || { tier1: 0, tier2: 0, tier3: 0, error: 0, Rs: [] };
    const slot = r.tier === 'tier-1' ? 'tier1' : r.tier === 'tier-2' ? 'tier2' : r.tier === 'error' ? 'error' : 'tier3';
    byClass[r.class][slot]++;
    if (r.R !== null) byClass[r.class].Rs.push(r.R);
  }
  console.log('class    tier-1  tier-2  tier-3  error    mean R    median R    range');
  console.log('-----    ------  ------  ------  -----    ------    --------    -----');
  for (const [k, v] of Object.entries(byClass).sort()) {
    const rs = v.Rs.sort((a,b)=>a-b);
    const mean = rs.length ? (rs.reduce((a,b)=>a+b,0)/rs.length).toFixed(2) : '—';
    const median = rs.length ? rs[Math.floor(rs.length/2)].toFixed(2) : '—';
    const range = rs.length ? `[${rs[0].toFixed(2)}, ${rs[rs.length-1].toFixed(2)}]` : '—';
    console.log(`  ${k}     ${String(v.tier1).padStart(6)}  ${String(v.tier2).padStart(6)}  ${String(v.tier3).padStart(6)}  ${String(v.error).padStart(5)}    ${mean.padStart(6)}    ${median.padStart(8)}    ${range}`);
  }

  console.log(`\n[render] wrote ${results.length} results to ${resultsPath}`);
  console.log(`         total wall: ${((Date.now() - overallStart) / 1000).toFixed(0)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
