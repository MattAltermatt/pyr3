#!/usr/bin/env node
// #43 follow-up — build an eyeball-verify HTML page from results.jsonl produced
// by pyr3-043-followup-render.mjs. Per-class section with side-by-side
// golden / pyr3 / R for each candidate.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const OUT_DIR = join(REPO, '.remember', 'tmp', 'issue-43-followup');
const HTML_OUT = join(REPO, '.remember', 'verify', 'issue43-followup-corpus-sweep.html');

const CLASS_DESCRIPTIONS = {
  A: 'class A — 25703-class: disc-variation + non-unity xaos + supersample ≥ 4 + scale < 150',
  B: 'class B — 244.82986: very high brightness (≥80) + γ ≥ 3',
  C: 'class C — 244.42746: brightness ≥ 20 + γ ≥ 4',
  D: 'class D — coverage.248.02226: brightness 20-30 + γ 3.0-3.5 + highlight_power = 1',
  E: 'class E — WILDCARD: γ ≥ 5 OR brightness ≥ 100',
};

function tierPill(tier, R) {
  if (tier === 'tier-1') return `<span class="pill good">tier-1 · R ${R.toFixed(2)}</span>`;
  if (tier === 'tier-2') return `<span class="pill tier2">tier-2 · R ${R.toFixed(2)}</span>`;
  if (tier === 'tier-3 (R≥10, real issue)') return `<span class="pill tier3">tier-3 · R ${R.toFixed(2)}</span>`;
  return `<span class="pill error">ERROR</span>`;
}

function summaryBlock(byClass) {
  let total = { t1: 0, t2: 0, t3: 0, err: 0 };
  let rows = '';
  for (const [k, v] of Object.entries(byClass).sort()) {
    total.t1 += v.tier1; total.t2 += v.tier2; total.t3 += v.tier3; total.err += v.error;
    const rs = v.Rs.sort((a,b)=>a-b);
    const mean = rs.length ? (rs.reduce((a,b)=>a+b,0)/rs.length).toFixed(2) : '—';
    const range = rs.length ? `[${rs[0].toFixed(2)}, ${rs[rs.length-1].toFixed(2)}]` : '—';
    rows += `<tr><td class="cls">${k}</td><td>${v.tier1}</td><td>${v.tier2}</td><td>${v.tier3}</td><td>${v.error}</td><td>${mean}</td><td>${range}</td></tr>\n`;
  }
  return `<table class="summary"><thead><tr><th>class</th><th>tier-1</th><th>tier-2</th><th>tier-3 (R≥10)</th><th>err</th><th>mean R</th><th>R range</th></tr></thead><tbody>${rows}<tr class="total"><td>TOTAL</td><td>${total.t1}</td><td>${total.t2}</td><td>${total.t3}</td><td>${total.err}</td><td>—</td><td>—</td></tr></tbody></table>`;
}

function classSection(classKey, items) {
  if (items.length === 0) return '';
  const desc = CLASS_DESCRIPTIONS[classKey] || `class ${classKey}`;
  const cells = items.map((r) => {
    const id = `${r.gen}.${r.id}`;
    const dir = `file:///Users/matt/dev/MattAltermatt/pyr3/.remember/tmp/issue-43-followup/${id}`;
    const sourceUrl = `https://pyr3.app/v1/gen/${r.gen}/id/${r.id}`;
    const params = `bri=${r.brightness} γ=${r.gamma} hlp=${r.highlightPower} ss=${r.supersample} scale=${r.scale.toFixed(0)} ${r.w}×${r.h} disc=${r.hasDisc} xaos=${r.hasXaos} xforms=${r.xformCount}`;
    if (r.R === null) {
      return `<div class="row"><div class="meta"><b>${id}</b><br><span class="params">${params}</span><br>${tierPill(r.tier, 0)} ${r.error || ''}</div></div>`;
    }
    return `<div class="row">
      <div class="meta">
        <b><a href="${sourceUrl}">${id}</a></b><br>
        <span class="params">${params}</span><br>
        ${tierPill(r.tier, r.R)}
      </div>
      <div class="cell"><div class="label">flam3-C golden</div><img src="${dir}/golden.png"></div>
      <div class="cell"><div class="label">pyr3 (post-#43)</div><img src="${dir}/pyr3.png"></div>
    </div>`;
  }).join('\n');
  return `<section class="cls"><h2>${desc}</h2>${cells}</section>`;
}

function main() {
  const resultsPath = join(OUT_DIR, 'results.jsonl');
  if (!existsSync(resultsPath)) {
    console.error(`missing ${resultsPath} — run scripts/pyr3-043-followup-render.mjs first`);
    process.exit(1);
  }
  const results = readFileSync(resultsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

  // Aggregate by class
  const byClass = {};
  const perClassItems = {};
  for (const r of results) {
    byClass[r.class] = byClass[r.class] || { tier1: 0, tier2: 0, tier3: 0, error: 0, Rs: [] };
    perClassItems[r.class] = perClassItems[r.class] || [];
    perClassItems[r.class].push(r);
    const slot = r.tier === 'tier-1' ? 'tier1' : r.tier === 'tier-2' ? 'tier2' : r.tier === 'error' ? 'error' : 'tier3';
    byClass[r.class][slot]++;
    if (r.R !== null) byClass[r.class].Rs.push(r.R);
  }

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>#43 follow-up — targeted corpus sweep</title><style>
:root { --bg:#0f0f12; --panel:#1a1a20; --txt:#e8e8ee; --txt-dim:#999; --good:#6ee082; --warn:#ff9870; --bad:#ff7070; --accent:#88aaff; }
*{box-sizing:border-box;}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--txt);margin:0;padding:32px 40px;}
h1{margin:0 0 6px;font-size:24px;}
.lead{color:var(--txt-dim);font-size:13px;margin-bottom:28px;max-width:1080px;line-height:1.55;}
.lead code{background:var(--panel);padding:2px 6px;border-radius:3px;color:#ddd;}
table.summary{border-collapse:collapse;margin:0 0 28px;font:13px/1.5 ui-monospace,SF Mono,monospace;}
table.summary th,table.summary td{padding:7px 14px;border:1px solid #303040;text-align:right;}
table.summary th{background:var(--panel);color:var(--accent);text-align:center;}
table.summary td.cls{text-align:left;font-weight:600;color:#bbd;}
table.summary tr.total td{background:#202028;font-weight:600;}
section.cls{margin:0 0 56px;}
section.cls h2{margin:0 0 16px;font-size:17px;color:#eef;border-bottom:1px solid #2a2a3a;padding-bottom:8px;}
.row{display:grid;grid-template-columns:280px 1fr 1fr;gap:12px;margin-bottom:16px;align-items:center;}
.meta{font:12px ui-monospace,monospace;color:#ccc;line-height:1.6;}
.meta a{color:var(--accent);text-decoration:none;}
.meta a:hover{text-decoration:underline;}
.meta .params{color:var(--txt-dim);font-size:11px;}
.cell{background:var(--panel);border-radius:6px;padding:8px;}
.cell .label{font:11px ui-monospace,monospace;color:var(--accent);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.4px;}
.cell img{width:100%;height:auto;display:block;border-radius:3px;background:#000;}
.pill{display:inline-block;padding:2px 9px;border-radius:11px;font:11px ui-monospace,monospace;}
.pill.good{background:#1c3a24;color:var(--good);}
.pill.tier2{background:#3a2a1a;color:var(--warn);}
.pill.tier3{background:#3a1a1a;color:var(--bad);}
.pill.error{background:#2a2a3a;color:#999;}
</style></head><body>

<h1>#43 follow-up — targeted corpus sweep</h1>
<p class="lead">
  25 corpus candidates rendered against flam3-C goldens using pyr3 post-#43 (scale-relative walker jitter @ k=1e-7). Each candidate was selected by a predictor designed to match the structure of one of the 4 known tier-2 fixtures. The question this sweep answers: <strong>do the predictors actually correlate with tier-2 R, or are the 4 known tier-2s isolated anomalies?</strong>
</p>

<h2 style="margin-top:0">Summary by class</h2>
${summaryBlock(byClass)}

${classSection('A', perClassItems.A || [])}
${classSection('B', perClassItems.B || [])}
${classSection('C', perClassItems.C || [])}
${classSection('D', perClassItems.D || [])}
${classSection('E', perClassItems.E || [])}

</body></html>`;

  writeFileSync(HTML_OUT, html);
  console.log(`[html] wrote ${HTML_OUT}`);
  console.log(`        ${results.length} candidates, ${Object.keys(byClass).length} classes`);
}

main();
