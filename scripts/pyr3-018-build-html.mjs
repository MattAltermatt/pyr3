#!/usr/bin/env node
// Build .remember/verify/pyr3-018-fe-sweep.html from results.jsonl.
// Layout per pyr3/CLAUDE.md eyeball-verify spec: dark theme, 3-column
// grid per fixture (golden / FE-render / FE-diff), R+per-channel+per-region
// pills, abs file:/// URLs.

import { readFileSync, writeFileSync } from 'node:fs';

const RESULTS_PATH = '.remember/tmp/pyr3-018-results.jsonl';
const OUT_PATH = '.remember/verify/pyr3-018-fe-sweep.html';
const REPO = '/Users/matt/dev/MattAltermatt/pyr3';

const lines = readFileSync(RESULTS_PATH, 'utf8').split('\n').filter(Boolean);
const rows = lines.map((l) => JSON.parse(l));

// R pill colour: gauge FE-R against BE-derived threshold + the inherent
// FE noise floor (quick-mode SPP=16 vs BE ~q=2000 → ~11× noise).
// "Healthy" FE: FE-R within ~+5 of BE-baseline. "Watch": +5..+10. "Outlier": >+10.
function rPillClass(feR, beBaseline) {
  const delta = feR - beBaseline;
  if (delta < 5) return 'r-green';
  if (delta < 10) return 'r-yellow';
  return 'r-red';
}

function pill(text, cls = '') {
  return `<span class="pill ${cls}">${text}</span>`;
}

const rowHtml = rows.map((r) => {
  const goldenSrc = `file://${REPO}/fixtures/flam3-goldens/${r.fixture}/golden.png`;
  const feSrc = `file://${REPO}/fixtures/flam3-goldens/${r.fixture}/pyr3-fe-render.png`;
  const diffSrc = `file://${REPO}/fixtures/flam3-goldens/${r.fixture}/pyr3-fe-diff.png`;
  const dims = `${r.width}×${r.height}`;
  const downscaleNote = r.feCapDownscaled
    ? `<span class="downscale-note">⚠ FE capped at ${r.width}×${r.height}; golden downscaled from ${r.nativeDims.width}×${r.nativeDims.height} for R-compare</span>`
    : '';
  return `
<section class="fixture">
  <header>
    <h2>${r.fixture}</h2>
    <div class="meta">
      ${pill(`${dims}`)}
      ${pill(`FE-R ${r.R.toFixed(2)}`, rPillClass(r.R, r.BE_baselineR))}
      ${pill(`Δ ${(r.R - r.BE_baselineR).toFixed(2)} vs BE-baseline ${r.BE_baselineR.toFixed(2)}`)}
      ${pill(`BE thr ${r.BE_thresholdR.toFixed(2)}`)}
    </div>
    <div class="meta">
      ${pill(`r ${r.perChannel.r.toFixed(2)}`)}
      ${pill(`g ${r.perChannel.g.toFixed(2)}`)}
      ${pill(`b ${r.perChannel.b.toFixed(2)}`)}
      ${pill(`tl ${r.perRegion.tl.toFixed(2)}`)}
      ${pill(`tr ${r.perRegion.tr.toFixed(2)}`)}
      ${pill(`bl ${r.perRegion.bl.toFixed(2)}`)}
      ${pill(`br ${r.perRegion.br.toFixed(2)}`)}
    </div>
    ${downscaleNote}
  </header>
  <div class="grid">
    <figure><img src="${goldenSrc}" alt="golden"><figcaption>golden (flam3-C)</figcaption></figure>
    <figure><img src="${feSrc}" alt="FE render"><figcaption>pyr3 FE render</figcaption></figure>
    <figure><img src="${diffSrc}" alt="diff ×8"><figcaption>diff ×8 (FE vs golden)</figcaption></figure>
  </div>
</section>
`;
}).join('\n');

// Distribution summary at the top.
const sortedByDelta = [...rows].sort((a, b) => (b.R - b.BE_baselineR) - (a.R - a.BE_baselineR));
const summaryRows = sortedByDelta.map((r) => {
  const delta = r.R - r.BE_baselineR;
  const cls = rPillClass(r.R, r.BE_baselineR);
  return `<tr class="${cls}"><td>${r.fixture}</td><td>${r.width}×${r.height}</td><td>${r.R.toFixed(2)}</td><td>${r.BE_baselineR.toFixed(2)}</td><td>${delta >= 0 ? '+' : ''}${delta.toFixed(2)}</td><td>${r.feCapDownscaled ? 'subnative' : ''}</td></tr>`;
}).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>pyr3 PYR3-018 FE sweep — ${rows.length} fixtures</title>
<style>
  * { box-sizing: border-box; }
  body { background: #111; color: #eee; font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 24px; }
  h1 { margin-top: 0; }
  .summary { margin-bottom: 32px; }
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
  .downscale-note { display: block; margin-top: 4px; color: #fa6; font-family: 'SF Mono', Menlo, monospace; font-size: 11px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 8px; }
  figure { margin: 0; }
  figure img { width: 100%; height: auto; display: block; image-rendering: pixelated; background: #000; }
  figcaption { font-family: 'SF Mono', Menlo, monospace; font-size: 11px; color: #888; text-align: center; padding: 4px 0; }
</style>
</head>
<body>
<h1>🔥 pyr3 PYR3-018 — FE parity sweep (${rows.length} fixtures)</h1>
<p>FE renders captured via <code>window.__pyr3CapturePixels</code> (dev hook on <code>main</code>). R-compare = FE-vs-flam3-C-golden. BE-baseline (printed alongside) is the pre-calibrated BE-vs-golden R from <code>meta.json</code>. The Δ column shows the FE excess over BE, attributable to FE quick-mode SPP cap (16) vs BE native quality (~q=2000) = ~11× noise floor — plus any FE-specific bug.</p>

<div class="summary">
<h2>Distribution (sorted by Δ desc)</h2>
<table>
<thead><tr><th>fixture</th><th>dims</th><th>FE-R</th><th>BE-baseline</th><th>Δ FE−BE</th><th>note</th></tr></thead>
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
console.log(`open ${REPO}/${OUT_PATH}`);
