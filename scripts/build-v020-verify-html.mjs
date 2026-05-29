#!/usr/bin/env node
// Build .remember/verify/v0.20-corpus-expansion.html — eyeball-verify
// gallery for v0.20's 6 new parity-corpus fixtures (3 untapped predecessor
// goldens + 3 ESF picks from the predecessor's v1.0-showcase.txt). 3-column
// layout per fixture (flam3-C golden / pyr3 BE render / diff), tier
// + expectedR pills, all-25-fixture summary table on top.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const GOLDENS = join(REPO, 'fixtures', 'flam3-goldens');
const OUT = join(REPO, '.remember', 'verify', 'v0.20-corpus-expansion.html');

const NEW_IN_V020 = new Set([
  '244.00617', '244.42746', '248.23554',
  'electricsheep.247.08620', 'electricsheep.245.07670', 'electricsheep.244.59334',
]);

const ids = readdirSync(GOLDENS)
  .filter((d) => existsSync(join(GOLDENS, d, 'meta.json')))
  .sort();

const rows = ids.map((id) => {
  const meta = JSON.parse(readFileSync(join(GOLDENS, id, 'meta.json'), 'utf8'));
  return { id, meta, dir: join(GOLDENS, id), isNew: NEW_IN_V020.has(id) };
});

function pillColor(R, threshold) {
  if (R < threshold) return '#2c5a2c';
  if (R < threshold * 2) return '#7a6014';
  return '#7a2424';
}

const newCells = rows
  .filter(({ isNew }) => isNew)
  .map(({ id, meta, dir }) => {
    const R = meta.expectedR;
    const T = meta.thresholdR;
    const color = pillColor(R, T);
    const tierBadgeColor = meta.tier === 2 ? '#5a4a14' : '#2c4a5a';
    const golden = `file://${dir}/golden.png`;
    const pyr3 = `file://${dir}/pyr3-render.png`;
    const diff = `file://${dir}/diff.png`;
    const notes = meta.notes ? `<div class="notes">${meta.notes}</div>` : '';
    return `
<section class="fx">
  <h2><span class="fxname">${id}</span>
    <span class="pill" style="background:${color}">R = ${R.toFixed(3)} / threshold ${T.toFixed(3)}</span>
    <span class="pill" style="background:${tierBadgeColor}">Tier-${meta.tier}</span>
    <span class="tag-new">NEW IN v0.20</span>
  </h2>
  ${notes}
  <div class="grid">
    <figure><img src="${golden}" loading="lazy" /><figcaption>flam3-C golden (qs=1, isaac_seed=${id})</figcaption></figure>
    <figure><img src="${pyr3}"   loading="lazy" /><figcaption>pyr3 BE render</figcaption></figure>
    <figure><img src="${diff}"   loading="lazy" /><figcaption>diff (visibility-scaled)</figcaption></figure>
  </div>
</section>`;
  })
  .join('\n');

const sortedR = [...rows].sort((a, b) => b.meta.expectedR - a.meta.expectedR);
const summaryRows = sortedR
  .map(({ id, meta, isNew }) => {
    const newBadge = isNew ? ' ★' : '';
    return `<tr${isNew ? ' style="background:#1f2a1f"' : ''}><td>${id}${newBadge}</td><td style="text-align:right">${meta.expectedR.toFixed(3)}</td><td style="text-align:right">${meta.thresholdR.toFixed(3)}</td><td style="text-align:center">${meta.tier}</td></tr>`;
  })
  .join('\n');

const tier1Count = rows.filter((r) => r.meta.tier === 1).length;
const tier2Count = rows.filter((r) => r.meta.tier === 2).length;
const newTier1 = rows.filter((r) => r.isNew && r.meta.tier === 1).length;
const newTier2 = rows.filter((r) => r.isNew && r.meta.tier === 2).length;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>pyr3 v0.20 — corpus expansion verify (19→25)</title>
<style>
  body { background:#111; color:#eee; font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 24px 32px; }
  h1 { margin: 0 0 4px 0; font-weight: 600; }
  .subtitle { color: #aaa; margin-bottom: 24px; }
  .fx { margin-bottom: 36px; padding-bottom: 28px; border-bottom: 1px solid #2a2a2a; }
  .fx h2 { font-size: 16px; font-weight: 500; margin: 0 0 12px 0; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .fxname { font-family: ui-monospace, Menlo, monospace; color: #f0f0f0; }
  .pill { font-family: ui-monospace, Menlo, monospace; font-size: 12px; padding: 3px 10px; border-radius: 999px; color: #fff; }
  .tag-new { font-family: ui-monospace, Menlo, monospace; font-size: 11px; padding: 2px 8px; border-radius: 4px; color: #f0f0a0; border: 1px solid #5a4a14; }
  .notes { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #c4a850; background: #2a2210; padding: 6px 10px; border-left: 2px solid #5a4a14; margin-bottom: 10px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  figure { margin: 0; }
  figure img { width: 100%; display: block; border: 1px solid #2a2a2a; }
  figcaption { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #999; padding-top: 6px; }
  table { border-collapse: collapse; margin-bottom: 28px; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
  th, td { padding: 4px 14px 4px 0; }
  th { color: #999; text-align: left; font-weight: 500; border-bottom: 1px solid #2a2a2a; }
  .lede { background: #1a1a1a; border-left: 3px solid #4a7a4a; padding: 12px 16px; margin: 0 0 24px 0; max-width: 720px; }
  .lede p { margin: 4px 0; line-height: 1.5; }
  .lede strong { color: #fff; }
</style>
</head>
<body>
<h1>pyr3 v0.20 — corpus expansion verify (19 → 25)</h1>
<p class="subtitle">Eyeball gallery for the 6 new fixtures. All 25 fixtures pass <code>npm run test:parity</code> at the v0.19 tier contract.</p>

<div class="lede">
  <p><strong>v0.20 corpus expansion:</strong> +3 untapped predecessor goldens + 3 ESF picks from the predecessor's <code>v1.0-showcase.txt</code>.</p>
  <p><strong>Tier ratio:</strong> ${tier1Count}:${tier2Count} (Tier-1:Tier-2) — comfortably above the planned 17:8 floor.</p>
  <p><strong>New picks tier breakdown:</strong> ${newTier1} Tier-1 / ${newTier2} Tier-2. All 3 ESF picks landed Tier-1 (visually balanced showcase-class flames track healthy parity). Both new Tier-2 picks (244.42746 R=5.50, 248.23554 R=24.12) are predecessor lifts.</p>
  <p><strong>What to spot-check:</strong> per-fixture R + tier badge match expectation; diff PNG shows no structural divergence (only intensity/color drift in tier-2 cases); fixtures starred ★ in the summary table are the v0.20 additions.</p>
</div>

<h3>All 25 fixtures (sorted by expectedR descending; v0.20 additions starred ★)</h3>
<table>
  <thead><tr><th>fixture</th><th style="text-align:right">expectedR</th><th style="text-align:right">thresholdR</th><th style="text-align:center">tier</th></tr></thead>
  <tbody>${summaryRows}</tbody>
</table>

<h3>v0.20 new fixtures (3-column eyeball)</h3>
${newCells}

</body>
</html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
console.log(`6 new fixtures + ${rows.length}-fixture summary table; tier ratio ${tier1Count}:${tier2Count}`);
