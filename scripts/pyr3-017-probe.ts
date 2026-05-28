// PYR3-017 probe: bisect variation-arm impact on coverage.248.02226's
// dominant xform (weight=6.651: swirl+cell+curve+polar2+scry). For each
// variation, swap its weight with that of `linear` (added with same value),
// effectively replacing the variation with an affine pass-through.
//
// Interpretation: a SMALL-weight variation that drops R dramatically when
// removed implicates its pyr3 impl as the divergence source — composition
// change can't explain a large R move when the variation contributed little
// to the rendered shape.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';
import { meanAbsDiffRgba } from '../src/compare';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, '..');
const FIXTURE = join(REPO, 'fixtures/flam3-goldens/coverage.248.02226');
const PROBE_DIR = join(REPO, '.remember/tmp/pyr3-017-probe');
const FLAME_SRC = readFileSync(join(FIXTURE, 'coverage.248.02226.flam3'), 'utf8');
const GOLDEN_BUF = readFileSync(join(FIXTURE, 'golden.png'));
const GOLDEN_PNG = PNG.sync.read(GOLDEN_BUF);
const GOLDEN_RGBA = new Uint8Array(GOLDEN_PNG.data.buffer, GOLDEN_PNG.data.byteOffset, GOLDEN_PNG.data.byteLength);

// Swap a variation in the DOMINANT xform (the only one with weight="6.651").
// Replaces `<varName>="<value>"` with `<varName>="0"` and adds `linear="<value>"`
// (or bumps existing linear weight by value if linear is already present).
function swapVarToLinear(src: string, varName: string): string {
  // Locate the dominant xform line.
  const xformRe = /<xform weight="6\.651"[^/]*\/>/;
  const match = src.match(xformRe);
  if (!match) throw new Error('dominant xform (weight=6.651) not found');
  let xline = match[0];
  // Extract the variation weight.
  const varRe = new RegExp(`(\\s${varName})="([^"]+)"`);
  const vm = xline.match(varRe);
  if (!vm) throw new Error(`variation ${varName} not found in dominant xform`);
  const value = parseFloat(vm[2]!);
  // Set the variation to 0, append linear="<value>" (or fold into existing linear).
  xline = xline.replace(varRe, `$1="0"`);
  const linearRe = /(\slinear)="([^"]+)"/;
  if (linearRe.test(xline)) {
    xline = xline.replace(linearRe, (_m, p1, p2) => `${p1}="${(parseFloat(p2) + value).toFixed(6)}"`);
  } else {
    // Insert linear="<value>" right after `weight="6.651"`.
    xline = xline.replace(/(weight="6\.651")/, `$1 linear="${value.toFixed(6)}"`);
  }
  return src.replace(xformRe, xline);
}

function renderAndScore(label: string, patcher: (s: string) => string): { label: string; R: number } {
  const flame = patcher(FLAME_SRC);
  const flamePath = join(PROBE_DIR, `${label}.flam3`);
  const renderPath = join(PROBE_DIR, `${label}.png`);
  writeFileSync(flamePath, flame);
  const t0 = Date.now();
  const res = spawnSync('node', [
    '--import', 'tsx/esm',
    '--import', './bin/wgsl-loader-register.mjs',
    'bin/pyr3-render.ts',
    flamePath,
    renderPath,
  ], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`render failed for ${label}: ${res.stderr ?? ''}`);
  const renderPng = PNG.sync.read(readFileSync(renderPath));
  const renderRgba = new Uint8Array(renderPng.data.buffer, renderPng.data.byteOffset, renderPng.data.byteLength);
  const R = meanAbsDiffRgba(renderRgba, GOLDEN_RGBA);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  [${label.padEnd(20)}] R=${R.toFixed(4)}  (${elapsed}s)`);
  return { label, R };
}

console.log(`PYR3-017 dominant-xform variation bisection on coverage.248.02226`);
console.log(`xform: weight=6.651, variations swirl(0.295) + cell(0.00338) + curve(0.196) + polar2(0.187) + scry(0.318)\n`);

const results: ReturnType<typeof renderAndScore>[] = [];
results.push(renderAndScore('baseline', (s) => s));
for (const v of ['swirl', 'cell', 'curve', 'polar2', 'scry']) {
  results.push(renderAndScore(`remove-${v}`, (s) => swapVarToLinear(s, v)));
}

console.log(`\n=== summary (sorted by R, lower = closer to golden) ===`);
const baseline = results.find((r) => r.label === 'baseline')!.R;
results.sort((a, b) => a.R - b.R);
for (const r of results) {
  const delta = r.R - baseline;
  const tag = delta < -1 ? '🟢 dropped' : delta > 1 ? '🔴 rose' : '⚪ flat';
  console.log(`  ${r.label.padEnd(20)} R=${r.R.toFixed(4)}  Δ=${delta >= 0 ? '+' : ''}${delta.toFixed(4)}  ${tag}`);
}
