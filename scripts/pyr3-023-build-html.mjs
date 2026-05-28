#!/usr/bin/env node
// Build .remember/verify/pyr3-023-4k-probe.html — 4-column eyeball-verify:
// meta + category | kotlin v1.1 JPG @3840 | pyr3 FE 4K @4096 | pyr3 BE 4K @4096.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const jsonlPath = resolve(repoRoot, '.remember/tmp/pyr3-023-results.jsonl');
const outPath = resolve(repoRoot, '.remember/verify/pyr3-023-4k-probe.html');

const rows = readFileSync(jsonlPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
mkdirSync(resolve(repoRoot, '.remember/verify'), { recursive: true });

const catColor = {
  OK: '#5fbf7f',
  OK_PROVISIONAL: '#5fbf7f',
  NOISY: '#e6c060',
  GEOMETRY: '#e08040',
  EMPTY: '#c04050',
  ERROR: '#c04050',
  STALL: '#c04050',
  CRASH: '#c04050',
  FE_CRASH_BE_OK: '#c0a040',
};

function fileExists(p) { return existsSync(p); }
function rowHtml(r) {
  const fix = r.fixture;
  const cat = r.category || 'UNKNOWN';
  const color = catColor[cat] || '#888';
  const kotlinAbs = resolve(repoRoot, `fixtures/kotlin-4k-refs/electricsheep.${fix}.gpu.4k.jpg`);
  const feAbs = resolve(repoRoot, `fixtures/pyr3-4k-renders/electricsheep.${fix}.pyr3-4k.png`);
  const beAbs = resolve(repoRoot, `fixtures/pyr3-4k-renders/electricsheep.${fix}.pyr3-be-4k.png`);
  const kotlin = `file://${kotlinAbs}`;
  const fe = `file://${feAbs}`;
  const be = `file://${beAbs}`;
  const feExists = fileExists(feAbs);
  const beExists = fileExists(beAbs);
  return `
  <div class="row">
    <div class="meta">
      <div class="id">${fix}</div>
      <div class="cat" style="background:${color};">${cat}</div>
      <div class="stats">
        <div>kotlin: <span>${r.kotlinDims || '—'}</span></div>
        <div>pyr3: <span>${r.pyr3Dims || '—'}</span></div>
        <div class="sep"></div>
        <div>FE wall-clock: <span>${r.wallClockSec != null ? r.wallClockSec.toFixed(1) + 's' : '—'}</span></div>
        <div>BE wall-clock: <span>${r.beWallClockSec != null ? r.beWallClockSec.toFixed(2) + 's' : '—'}</span></div>
        ${r.wallClockSec != null && r.beWallClockSec != null ? `<div>FE/BE ratio: <span>${(r.wallClockSec / r.beWallClockSec).toFixed(1)}×</span></div>` : ''}
        <div class="sep"></div>
        <div>console new: <span>${r.consoleNew ?? '—'}</span></div>
        <div>console errors: <span>${r.consoleErrors ?? '—'}</span></div>
      </div>
      ${r.notes ? `<div class="notes">${r.notes}</div>` : ''}
    </div>
    <div class="col">
      <a href="${kotlin}" target="_blank"><img src="${kotlin}" alt="kotlin v1.1 ${fix}"></a>
      <div class="label">kotlin v1.1 @ 3840 long-edge · <span>${r.kotlinDims || '—'}</span></div>
    </div>
    <div class="col">
      ${feExists ? `<a href="${fe}" target="_blank"><img src="${fe}" alt="pyr3 FE ${fix}"></a>` : '<div class="missing">FE 4K crashed</div>'}
      <div class="label">pyr3 FE @ 4096 long-edge · <span>${feExists ? r.pyr3Dims || '—' : 'CRASH'}</span></div>
    </div>
    <div class="col">
      ${beExists ? `<a href="${be}" target="_blank"><img src="${be}" alt="pyr3 BE ${fix}"></a>` : '<div class="missing">BE 4K missing</div>'}
      <div class="label">pyr3 BE @ 4096 long-edge · <span>${r.beDims || r.pyr3Dims || '—'}</span></div>
    </div>
  </div>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>pyr3 — PYR3-023 4K probe</title>
<style>
  :root { color-scheme: dark; }
  body {
    background:#0e0e10; color:#e7e7e8;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    margin:0; padding:24px 32px 64px;
  }
  h1 { margin:0 0 6px; font-size:20px; }
  .lead { color:#9c9ca0; font-size:13px; line-height:1.6; max-width:1100px; margin-bottom:24px; }
  .lead code { background:#1a1a20; padding:1px 5px; border-radius:3px; color:#d0d0d4; }
  .lead strong { color:#e7e7e8; }
  .headline {
    background:#1a1a20; border:1px solid #3a3a40; padding:12px 16px; border-radius:4px;
    margin-bottom:24px; font-size:13px; color:#d0d0d4; line-height:1.7;
    max-width:1100px;
  }
  .headline strong { color:#e6c060; }
  .row {
    display:grid;
    grid-template-columns: 260px 1fr 1fr 1fr;
    gap:14px; align-items:start;
    padding:20px 0; border-bottom:1px solid #2a2a30;
  }
  .meta .id { color:#fff; font-weight:bold; font-size:14px; margin-bottom:8px; }
  .meta .cat {
    display:inline-block; padding:4px 10px; border-radius:3px;
    color:#0e0e10; font-weight:bold; font-size:11px; letter-spacing:0.05em;
    margin-bottom:12px;
  }
  .meta .stats { font-size:11px; color:#9c9ca0; line-height:1.7; }
  .meta .stats span { color:#d0d0d4; }
  .meta .sep { height:6px; }
  .meta .notes { font-size:11px; color:#e6c060; margin-top:10px; padding:6px 8px; background:#1a1a20; border-left:3px solid #e6c060; line-height:1.5; }
  .col img { display:block; width:100%; background:#000; border-radius:3px; }
  .col .label { font-size:11px; color:#8a8a92; margin-top:4px; }
  .col .label span { color:#c7c7cb; }
  .missing { padding:60px 20px; text-align:center; color:#c04050; background:#181010; border:1px dashed #503030; border-radius:3px; font-weight:bold; }
</style>
</head>
<body>
<h1>🟪 pyr3 — <code>[PYR3-023]</code> 4K render failure probe</h1>
<p class="lead">
  Empirical probe of pyr3's <code>🎯 Render 4K</code> path vs the same engine driven via the BE CLI (<code>bin/pyr3-render.ts</code>) and kotlin v1.1's showcase 4K references. Apples-to-apples baseline: kotlin's <code>SHOWCASE_4K</code> preset uses <strong>3840 long-edge</strong> + <strong>200 SPP</strong>; pyr3 uses <strong>4096 long-edge</strong> (<code>FULL_MAX_DIM</code> in <code>src/main.ts:43</code>) + same SPP + same oversample=1. Pyr3 renders 13.78% more pixels per fixture than kotlin.
</p>
<div class="headline">
  <strong>Headline finding:</strong> 5/5 fixtures render successfully on the <strong>BE</strong> (same engine, Dawn-node) at 12-19s wall-clock. 3/5 render successfully on the <strong>FE</strong> at 79-164s wall-clock (13× slower than BE). <strong>2/5 fixtures (244.36880, 248.22289) crash the Chrome renderer tab during FE 4K render</strong> (page resets to about:blank within ~30-45s of clicking Render 4K). Same genome + same engine — the crash is browser-environment-specific, not a fundamental engine bug. Distinguishing fixture traits: <code>brightness="24.7609"</code> (3-5× typical) + <code>estimator_radius="11"</code> (typical 1-3) + huge <code>scale</code> × 3.2 sizeScale on 244.36880; 248.22289 not yet inspected for similar outliers.
</div>
<p class="lead">
  Categories: <strong>OK_PROVISIONAL</strong> = render completed cleanly, visual comparison pending;
  <strong>FE_CRASH_BE_OK</strong> = FE killed the renderer tab but BE rendered the same fixture fine;
  <strong>CRASH</strong> = both FE and BE failed (none observed in this probe).
</p>
${rows.map(rowHtml).join('\n')}
</body>
</html>
`;

writeFileSync(outPath, html);
console.log('Wrote', outPath);
console.log('Open: file://' + outPath);
