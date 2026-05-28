#!/usr/bin/env node
// Build .remember/verify/pyr3-023-4k-parity.html — eyeball gallery for
// the BE 4K parity rig (`src/parity-4k.test.ts`, run via
// `npm run test:parity-4k`). 3-column per fixture (kotlin JPG / pyr3 BE
// PNG / diff×8) + sortable summary table at top. Distinct from the
// pre-existing v0.14 probe HTML at `pyr3-023-probe-build-html.mjs`
// which built a 4-col FE+BE+kotlin probe gallery prior to the FE 4K
// removal pivot.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO = '/Users/matt/dev/MattAltermatt/pyr3';
const RESULTS_PATH = join(REPO, '.remember', 'tmp', 'pyr3-023-4k-results.jsonl');
const META_PATH = join(REPO, 'fixtures', 'kotlin-4k-refs', 'meta.json');
const OUT_PATH = join(REPO, '.remember', 'verify', 'pyr3-023-4k-parity.html');

if (!existsSync(RESULTS_PATH)) {
  console.error(`missing ${RESULTS_PATH} — run \`npm run test:parity-4k\` first`);
  process.exit(1);
}

const rows = readFileSync(RESULTS_PATH, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const meta = existsSync(META_PATH) ? JSON.parse(readFileSync(META_PATH, 'utf8')) : { fixtures: {} };

const f = (n) => n.toFixed(2);
function rPillClass(R, thr) {
  if (thr != null) {
    if (R <= thr * 0.5) return 'r-green';
    if (R <= thr * 0.85) return 'r-yellow';
    if (R <= thr) return 'r-yellow';
    return 'r-red';
  }
  if (R < 5) return 'r-green';
  if (R < 15) return 'r-yellow';
  return 'r-red';
}
function pill(text, cls = '') {
  return `<span class="pill ${cls}">${text}</span>`;
}

const rowHtml = rows.sort((a, b) => a.fixture.localeCompare(b.fixture)).map((r) => {
  const m = meta.fixtures?.[r.fixture] ?? {};
  const thr = m.thresholdR ?? r.kotlin4kThresholdR;
  const kotlinSrc = `file://${REPO}/fixtures/kotlin-4k-refs/electricsheep.${r.fixture}.gpu.4k.jpg`;
  const pyr3Src = `file://${REPO}/fixtures/kotlin-4k-refs/electricsheep.${r.fixture}.pyr3-be-4k.png`;
  const diffSrc = `file://${REPO}/fixtures/kotlin-4k-refs/electricsheep.${r.fixture}.fe-be-diff.png`;
  const cls = rPillClass(r.R, thr);
  return `
<section class="fixture">
  <header>
    <h2>${r.fixture}</h2>
    <div class="meta">
      ${pill(`${r.width}×${r.height}`)}
      ${pill(`R ${r.R.toFixed(2)}`, cls)}
      ${pill(thr != null ? `thr ${thr}` : 'thr —', thr == null ? 'thr-empty' : '')}
    </div>
    <div class="meta">
      ${pill(`r ${f(r.perChannel.r)}`)}
      ${pill(`g ${f(r.perChannel.g)}`)}
      ${pill(`b ${f(r.perChannel.b)}`)}
      ${pill(`tl ${f(r.perRegion.qTl)}`)}
      ${pill(`tr ${f(r.perRegion.qTr)}`)}
      ${pill(`bl ${f(r.perRegion.qBl)}`)}
      ${pill(`br ${f(r.perRegion.qBr)}`)}
    </div>
  </header>
  <div class="grid">
    <figure><img src="${kotlinSrc}" alt="kotlin v1.1 ref"><figcaption>kotlin v1.1 SHOWCASE_4K (JPG)</figcaption></figure>
    <figure><img src="${pyr3Src}" alt="pyr3 BE 4K"><figcaption>pyr3 BE 4K (PNG, q=200)</figcaption></figure>
    <figure><img src="${diffSrc}" alt="diff ×8"><figcaption>diff ×8 (pyr3 vs kotlin)</figcaption></figure>
  </div>
</section>
`;
}).join('\n');

const sorted = [...rows].sort((a, b) => b.R - a.R);
const summaryRows = sorted.map((r) => {
  const m = meta.fixtures?.[r.fixture] ?? {};
  const thr = m.thresholdR ?? r.kotlin4kThresholdR;
  const cls = rPillClass(r.R, thr);
  return `<tr class="${cls}"><td>${r.fixture}</td><td>${r.width}×${r.height}</td><td>${r.R.toFixed(2)}</td><td>${thr != null ? thr : '—'}</td><td>r${f(r.perChannel.r)} g${f(r.perChannel.g)} b${f(r.perChannel.b)}</td></tr>`;
}).join('\n');

const median = sorted[Math.floor(sorted.length / 2)]?.R ?? 0;
const min = Math.min(...rows.map((r) => r.R));
const max = Math.max(...rows.map((r) => r.R));

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>pyr3 PYR3-023 — BE 4K parity vs kotlin v1.1 (${rows.length} fixtures)</title>
<style>
  * { box-sizing: border-box; }
  body { background: #111; color: #eee; font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 24px; max-width: 1700px; }
  h1, h2 { margin-top: 0; }
  h2 { font-family: 'SF Mono', Menlo, monospace; font-size: 16px; }
  .preamble { color: #aaa; max-width: 880px; line-height: 1.55; }
  .preamble code { background: #222; padding: 1px 6px; border-radius: 3px; font-size: 13px; }
  .summary { margin: 32px 0; }
  .summary table { width: 100%; border-collapse: collapse; font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
  .summary th, .summary td { padding: 6px 12px; border-bottom: 1px solid #333; text-align: left; }
  .summary tr.r-green td { color: #8f8; }
  .summary tr.r-yellow td { color: #fc6; }
  .summary tr.r-red td { color: #f88; }
  .fixture { margin-bottom: 48px; border-top: 1px solid #333; padding-top: 16px; }
  .fixture h2 { margin: 0 0 8px 0; }
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
  .findings { background: #1a1a1a; padding: 16px 20px; border-left: 3px solid #8f8; border-radius: 4px; margin-top: 24px; max-width: 880px; }
  .findings h3 { margin: 0 0 8px 0; color: #8f8; }
</style>
</head>
<body>
<h1>🔥 pyr3 PYR3-023 — BE 4K parity vs kotlin v1.1 SHOWCASE_4K (${rows.length} fixtures)</h1>

<p class="preamble">
The other v1.0 ship gate. pyr3 BE renders at 3840 long-edge (matched to kotlin's <code>SHOWCASE_4K</code> preset), q=200 SPP, oversample=1. R compared directly against the kotlin v1.1 4K JPG reference (no downscale — v0.16 aligned BE long-edge 4096 → 3840). 5 showcase fixtures probed; <strong>4/5 render cleanly</strong> at R ≤ 7.4 (BE-vs-flam3 19-fixture median is ~6). One outlier (248.22289) at R=44.96 — known PYR3-029 chaos-game divergence; threshold is intentionally loose pending the chaos-walker-coverage audit fix.
</p>

<div class="findings">
<h3>📋 Phase D shipping notes</h3>
<p>
<strong>The README hero (<code>electricsheep.247.19679</code>) renders at R=2.78</strong> — well within the BE-vs-flam3 noise floor. This is the canonical "this is what pyr3 renders" fixture per project memory (the welcome flame, the v0.2 zoom-fix story, the kotlin v1.1 4K-clean reference). Phase D's <code>test:parity-4k</code> rig confirms it.
</p>
<p>
The ship-gate scope for v1.0 is: (a) PYR3-029 chaos-game fix → tightens 248.22289 and any other PYR3-029-class fixtures from the broader 54-fixture kotlin v1.1 showcase set; (b) expand from 5 → ~20-50 fixtures (curate the rest of <code>fixtures/kotlin-4k-refs/</code>). Today's 5-fixture rig is the regression-gate INFRASTRUCTURE; PYR3-029 supplies the engine fix.
</p>
</div>

<div class="summary">
<h2>Distribution (sorted by R desc)</h2>
<table>
<thead><tr><th>fixture</th><th>dims</th><th>R</th><th>thr</th><th>per-channel</th></tr></thead>
<tbody>
${summaryRows}
</tbody>
</table>
<p style="color:#888;font-family:'SF Mono',monospace;font-size:12px;">
min ${min.toFixed(2)} · median ${median.toFixed(2)} · max ${max.toFixed(2)}
</p>
</div>

${rowHtml}

</body>
</html>
`;

writeFileSync(OUT_PATH, html);
console.log(`wrote ${OUT_PATH}`);
console.log(`open ${OUT_PATH}`);
