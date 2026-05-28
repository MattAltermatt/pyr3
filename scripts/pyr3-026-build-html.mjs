#!/usr/bin/env node
// Build .remember/verify/pyr3-026-fe-be.html — eyeball gallery for the
// FE↔BE parity gate. Per pyr3 CLAUDE.md eyeball-verify spec: dark theme,
// 3-column grid per fixture (BE quick / FE quick / diff×8), R + per-
// channel + per-region pills, abs file:/// URLs, distribution summary
// table at top.
//
// R is recomputed from the PNGs on disk (not a JSONL pipeline), so this
// script always reflects the latest test run — just regenerate the PNGs
// via `npm run test:parity-fe-be` and re-run.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { meanAbsDiffRgba, perChannelDrift, perRegionDrift } from '../src/compare.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const FIXTURES_DIR = join(REPO_ROOT, 'fixtures', 'flam3-goldens');
const OUT_PATH = join(REPO_ROOT, '.remember', 'verify', 'pyr3-026-fe-be.html');

function readPngRgba(path) {
  const png = PNG.sync.read(readFileSync(path));
  return {
    width: png.width,
    height: png.height,
    rgba: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength),
  };
}

const rows = [];
for (const entry of readdirSync(FIXTURES_DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue;
  const dir = join(FIXTURES_DIR, entry.name);
  const bePath = join(dir, 'pyr3-fe-be-be.png');
  const fePath = join(dir, 'pyr3-fe-be-fe.png');
  const diffPath = join(dir, 'fe-be-diff.png');
  const metaPath = join(dir, 'meta.json');
  if (!existsSync(bePath) || !existsSync(fePath) || !existsSync(diffPath)) continue;
  const be = readPngRgba(bePath);
  const fe = readPngRgba(fePath);
  if (be.width !== fe.width || be.height !== fe.height) {
    console.warn(`${entry.name}: dim mismatch FE ${fe.width}×${fe.height} vs BE ${be.width}×${be.height}; skipping`);
    continue;
  }
  const R = meanAbsDiffRgba(fe.rgba, be.rgba);
  const channel = perChannelDrift(fe.rgba, be.rgba);
  const region = perRegionDrift(fe.rgba, be.rgba, be.width, be.height);
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
  rows.push({
    fixture: entry.name,
    width: be.width,
    height: be.height,
    R,
    channel,
    region,
    feBeThresholdR: meta.feBeThresholdR ?? null,
    beThresholdR: meta.thresholdR ?? null,
  });
}

// R-pill colour: gauge against the per-fixture FE↔BE threshold if set,
// else use a flat heuristic (< 2 green, < 8 yellow, else red — the
// median single-run R in our 19-fixture set is ~6, so > 8 is outlier).
function rPillClass(R, threshold) {
  if (threshold !== null && threshold !== undefined) {
    if (R <= threshold * 0.5) return 'r-green';
    if (R <= threshold * 0.85) return 'r-yellow';
    if (R <= threshold) return 'r-yellow';
    return 'r-red';
  }
  if (R < 2) return 'r-green';
  if (R < 8) return 'r-yellow';
  return 'r-red';
}

function pill(text, cls = '') {
  return `<span class="pill ${cls}">${text}</span>`;
}

const f = (n) => n.toFixed(4);

const rowHtml = rows.map((r) => {
  const beSrc = `file://${REPO_ROOT}/fixtures/flam3-goldens/${r.fixture}/pyr3-fe-be-be.png`;
  const feSrc = `file://${REPO_ROOT}/fixtures/flam3-goldens/${r.fixture}/pyr3-fe-be-fe.png`;
  const diffSrc = `file://${REPO_ROOT}/fixtures/flam3-goldens/${r.fixture}/fe-be-diff.png`;
  const dims = `${r.width}×${r.height}`;
  const cls = rPillClass(r.R, r.feBeThresholdR);
  const thrPill = r.feBeThresholdR !== null
    ? pill(`thr ${r.feBeThresholdR.toFixed(2)}`)
    : pill('thr —', 'thr-empty');
  return `
<section class="fixture">
  <header>
    <h2>${r.fixture}</h2>
    <div class="meta">
      ${pill(dims)}
      ${pill(`R(FE,BE) ${r.R.toFixed(2)}`, cls)}
      ${thrPill}
    </div>
    <div class="meta">
      ${pill(`r ${r.channel.r.toFixed(2)}`)}
      ${pill(`g ${r.channel.g.toFixed(2)}`)}
      ${pill(`b ${r.channel.b.toFixed(2)}`)}
      ${pill(`tl ${r.region.qTl.toFixed(2)}`)}
      ${pill(`tr ${r.region.qTr.toFixed(2)}`)}
      ${pill(`bl ${r.region.qBl.toFixed(2)}`)}
      ${pill(`br ${r.region.qBr.toFixed(2)}`)}
    </div>
  </header>
  <div class="grid">
    <figure><img src="${beSrc}" alt="BE quick"><figcaption>pyr3 BE (--quick)</figcaption></figure>
    <figure><img src="${feSrc}" alt="FE quick"><figcaption>pyr3 FE (Playwright capture)</figcaption></figure>
    <figure><img src="${diffSrc}" alt="diff ×8"><figcaption>diff ×8 (FE vs BE)</figcaption></figure>
  </div>
</section>
`;
}).join('\n');

// Summary table at top — sorted by R desc so worst offenders surface first.
const sortedByR = [...rows].sort((a, b) => b.R - a.R);
const summaryRows = sortedByR.map((r) => {
  const cls = rPillClass(r.R, r.feBeThresholdR);
  const thr = r.feBeThresholdR !== null ? r.feBeThresholdR.toFixed(2) : '—';
  return `<tr class="${cls}"><td>${r.fixture}</td><td>${r.width}×${r.height}</td><td>${r.R.toFixed(2)}</td><td>${thr}</td><td>r${r.channel.r.toFixed(1)} g${r.channel.g.toFixed(1)} b${r.channel.b.toFixed(1)}</td></tr>`;
}).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>pyr3 PYR3-026 — FE↔BE parity (${rows.length} fixtures)</title>
<style>
  * { box-sizing: border-box; }
  body { background: #111; color: #eee; font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 24px; }
  h1 { margin-top: 0; }
  .preamble { color: #aaa; max-width: 880px; line-height: 1.55; }
  .preamble code { background: #222; padding: 1px 6px; border-radius: 3px; }
  .summary { margin: 32px 0; }
  .summary table { width: 100%; border-collapse: collapse; font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
  .summary th, .summary td { padding: 6px 12px; border-bottom: 1px solid #333; text-align: left; }
  .summary tr.r-green td { color: #8f8; }
  .summary tr.r-yellow td { color: #fc6; }
  .summary tr.r-red td { color: #f88; }
  .fixture { margin-bottom: 48px; border-top: 1px solid #333; padding-top: 16px; }
  .fixture h2 { margin: 0 0 8px 0; font-family: 'SF Mono', Menlo, monospace; font-size: 16px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
  .pill { background: #222; color: #ccc; padding: 2px 8px; border-radius: 4px; font-family: 'SF Mono', Menlo, monospace; font-size: 11px; }
  .pill.r-green  { background: #163; color: #afa; }
  .pill.r-yellow { background: #642; color: #fc8; }
  .pill.r-red    { background: #511; color: #fbb; }
  .pill.thr-empty { color: #666; }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 8px; }
  figure { margin: 0; }
  figure img { width: 100%; height: auto; display: block; image-rendering: pixelated; background: #000; }
  figcaption { font-family: 'SF Mono', Menlo, monospace; font-size: 11px; color: #888; text-align: center; padding: 4px 0; }
</style>
</head>
<body>
<h1>🔥 pyr3 PYR3-026 — FE↔BE parity (${rows.length} fixtures)</h1>
<p class="preamble">
Browser viewer (Playwright + headless Chromium WebGPU via swiftshader) vs CLI (Dawn-node) at matched quick-mode dims (1024 long-edge, quality=16 SPP, oversample=1). R is mean-absolute RGBA difference per pixel; per-channel and per-region drift drilled out for diagnosis. <strong>Both engines use <code>Math.random()</code> seeds by default</strong> — R includes RNG noise plus genuine FE↔BE engine drift; matched-seed calibration is a follow-up. Threshold pills empty = record-only; calibrated thresholds gate the test in CI.
</p>

<div class="summary">
<h2>Distribution (sorted by R desc)</h2>
<table>
<thead><tr><th>fixture</th><th>dims</th><th>R(FE,BE)</th><th>thr</th><th>per-channel</th></tr></thead>
<tbody>
${summaryRows}
</tbody>
</table>
</div>

${rowHtml}

</body>
</html>
`;

writeFileSync(OUT_PATH, html);
console.log(`wrote ${OUT_PATH}`);
console.log(`open ${OUT_PATH}`);
