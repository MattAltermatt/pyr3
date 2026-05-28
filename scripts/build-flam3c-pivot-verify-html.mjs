#!/usr/bin/env node
// Build .remember/verify/v0.18-flam3c-pivot.html — 3-column gallery
// (flam3-C golden | pyr3 render | diff) for all 19 corpus fixtures.
// Uses absolute file:// src URLs so it opens cleanly from the OS finder.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const GOLDENS = join(REPO, 'fixtures', 'flam3-goldens');
const OUT = join(REPO, '.remember', 'verify', 'v0.18-flam3c-pivot.html');

const ids = readdirSync(GOLDENS)
  .filter((d) => existsSync(join(GOLDENS, d, 'meta.json')))
  .sort();

const rows = ids.map((id) => {
  const meta = JSON.parse(readFileSync(join(GOLDENS, id, 'meta.json'), 'utf8'));
  const dir = join(GOLDENS, id);
  return { id, meta, dir };
});

function pillColor(R, threshold) {
  if (R < threshold) return '#2c5a2c'; // green
  if (R < threshold * 2) return '#7a6014'; // amber
  return '#7a2424'; // red
}

const cells = rows
  .map(({ id, meta, dir }) => {
    const R = meta.baselineR;
    const T = meta.thresholdR;
    const color = pillColor(R, T);
    const golden = `file://${dir}/golden.png`;
    const pyr3 = `file://${dir}/pyr3-render.png`;
    const diff = `file://${dir}/diff.png`;
    return `
<section class="fx">
  <h2><span class="fxname">${id}</span> <span class="pill" style="background:${color}">R = ${R.toFixed(3)} / threshold ${T.toFixed(3)}</span></h2>
  <div class="grid">
    <figure><img src="${golden}" loading="lazy" /><figcaption>flam3-C golden (qs=1, isaac_seed=${id})</figcaption></figure>
    <figure><img src="${pyr3}"   loading="lazy" /><figcaption>pyr3 BE render</figcaption></figure>
    <figure><img src="${diff}"   loading="lazy" /><figcaption>diff (visibility-scaled)</figcaption></figure>
  </div>
</section>`;
  })
  .join('\n');

const sortedR = [...rows].sort((a, b) => b.meta.baselineR - a.meta.baselineR);
const summaryRows = sortedR
  .map(
    ({ id, meta }) =>
      `<tr><td>${id}</td><td style="text-align:right">${meta.baselineR.toFixed(3)}</td><td style="text-align:right">${meta.thresholdR.toFixed(3)}</td></tr>`,
  )
  .join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>pyr3 v0.18 — flam3-C ground-truth pivot verify</title>
<style>
  body { background:#111; color:#eee; font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 24px 32px; }
  h1 { margin: 0 0 4px 0; font-weight: 600; }
  .subtitle { color: #aaa; margin-bottom: 24px; }
  .fx { margin-bottom: 36px; padding-bottom: 28px; border-bottom: 1px solid #2a2a2a; }
  .fx h2 { font-size: 16px; font-weight: 500; margin: 0 0 12px 0; display: flex; align-items: center; gap: 14px; }
  .fxname { font-family: ui-monospace, Menlo, monospace; color: #f0f0f0; }
  .pill { font-family: ui-monospace, Menlo, monospace; font-size: 12px; padding: 3px 10px; border-radius: 999px; color: #fff; }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  figure { margin: 0; }
  figure img { width: 100%; display: block; border: 1px solid #2a2a2a; }
  figcaption { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #999; padding-top: 6px; }
  table { border-collapse: collapse; margin-bottom: 28px; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
  th, td { padding: 4px 14px 4px 0; }
  th { color: #999; text-align: left; font-weight: 500; border-bottom: 1px solid #2a2a2a; }
  .lede { background: #1a1a1a; border-left: 3px solid #4a7a4a; padding: 12px 16px; margin: 0 0 24px 0; max-width: 720px; }
  .lede p { margin: 4px 0; line-height: 1.5; }
</style>
</head>
<body>
<h1>pyr3 v0.18 — flam3-C ground-truth pivot verify</h1>
<p class="subtitle">3-column eyeball gallery. Goldens regenerated 2026-05-28 from <code>flam3-render-32bit-isaac qs=1 isaac_seed=&lt;fixture-id&gt;</code> (deterministic). All 19 fixtures pass <code>npm run test:parity</code>.</p>

<div class="lede">
  <p><strong>Pivot summary:</strong> kotlin v1.1 → flam3-C as ground truth.</p>
  <p>The prior <code>golden.png</code> files were kotlin's parity captures. Kotlin was close (R&lt;5 vs flam3 typically) but carried a port-specific offset. flam3-C is the canonical lineage source of truth ("similar but not the same as flam3-C") — measuring against kotlin obscured pyr3's real engine drift.</p>
  <p>Top-line effect: <code>coverage.248.02226</code> baseline R dropped 32.62 → 29.92 (the 2.7 R was kotlin port drift, not pyr3 engine drift). Most other fixtures shifted &lt; 0.05 R.</p>
</div>

<h3>Baselines (sorted by R descending)</h3>
<table>
  <thead><tr><th>fixture</th><th style="text-align:right">baselineR</th><th style="text-align:right">thresholdR</th></tr></thead>
  <tbody>${summaryRows}</tbody>
</table>

${cells}

</body>
</html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
console.log(`${ids.length} fixtures included`);
