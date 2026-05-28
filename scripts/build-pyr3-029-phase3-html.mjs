#!/usr/bin/env node
// Build a verify HTML showing the per-pixel chromatic-drift heatmaps for
// the two PYR3-029 outlier fixtures alongside a healthy-fixture control.
// Surfaces the walker-pool spatial-coverage finding visually.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const PIXEL_DIR = join(REPO, '.remember', 'tmp', 'pyr3-029-pixel');
const OUT = join(REPO, '.remember', 'verify', 'pyr3-029-phase3-pixel-diff.html');

const FIXTURES = ['coverage.248.02226', 'coverage.245.06687', 'coverage.248.11405'];

const rows = FIXTURES.map((id) => {
  const summary = JSON.parse(readFileSync(join(PIXEL_DIR, `${id}-summary.json`), 'utf8'));
  const heatmap = `file://${join(PIXEL_DIR, `${id}-heatmap.png`)}`;
  const golden = `file://${join(REPO, 'fixtures', 'flam3-goldens', id, 'golden.png')}`;
  const pyr3 = `file://${join(REPO, 'fixtures', 'flam3-goldens', id, 'pyr3-render.png')}`;
  const meta = JSON.parse(readFileSync(join(REPO, 'fixtures', 'flam3-goldens', id, 'meta.json'), 'utf8'));
  return { id, summary, heatmap, golden, pyr3, R: meta.baselineR };
});

function pct(n, total) {
  return ((n / total) * 100).toFixed(1) + '%';
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>PYR3-029 Phase 3 — per-pixel chromatic-drift heatmaps</title>
<style>
  body { background:#0d0d0d; color:#eee; font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 24px 32px; max-width: 1600px; }
  h1 { margin: 0 0 4px 0; font-weight: 600; }
  .subtitle { color: #aaa; margin: 4px 0 24px 0; }
  .finding { background: #1a1a1a; border-left: 3px solid #b85; padding: 14px 18px; margin: 0 0 32px 0; }
  .finding p { margin: 4px 0; line-height: 1.55; }
  .finding strong { color: #f5c460; }
  .fx { margin-bottom: 36px; padding-bottom: 28px; border-bottom: 1px solid #2a2a2a; }
  .fx h2 { font-size: 16px; font-weight: 500; margin: 0 0 12px 0; display: flex; gap: 14px; align-items: baseline; }
  .fxname { font-family: ui-monospace, Menlo, monospace; color: #f0f0f0; }
  .pill { font-family: ui-monospace, Menlo, monospace; font-size: 12px; padding: 3px 10px; border-radius: 999px; color: #fff; }
  .verdict-bad { background: #7a2424; }
  .verdict-ok { background: #2c5a2c; }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  figure { margin: 0; }
  figure img { width: 100%; display: block; border: 1px solid #2a2a2a; image-rendering: pixelated; background: #000; }
  figcaption { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #999; padding-top: 6px; }
  table { border-collapse: collapse; font-family: ui-monospace, Menlo, monospace; font-size: 12px; margin: 8px 0 0 0; }
  th, td { padding: 3px 14px 3px 0; text-align: right; }
  th { color: #888; text-align: left; font-weight: 500; border-bottom: 1px solid #2a2a2a; padding-bottom: 4px; }
  th:first-child, td:first-child { text-align: left; }
  .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 10px; }
  .legend { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #999; margin-top: 6px; }
  code { color: #f5c460; }
</style>
</head>
<body>
<h1>PYR3-029 Phase 3 — per-pixel chromatic-drift heatmaps</h1>
<p class="subtitle">Generated ${new Date().toISOString()} via <code>scripts/pyr3-029-pixel-diff.mjs</code>. Compares the chaos-game histogram per-pixel between pyr3 and flam3-C (with PYR3_DUMP_ACCUMULATOR), normalized by per-pixel count, magnitude as Euclidean distance in normalized channel space.</p>

<div class="finding">
  <p><strong>🚨 Root cause located: walker-pool spatial coverage.</strong></p>
  <p>The 2 outlier fixtures (<code>02226</code>, <code>245.06687</code>) share a structural defect that the 17 healthy fixtures don't: <strong>flam3-C hits 1.83×–4.48× more pixels than pyr3</strong>. pyr3's 1024 parallel walkers cluster into a tight subset of the attractor; flam3-C's single chain wanders broadly. pyr3 then over-deposits on the pixels it does hit (sum_count matches or exceeds flam3 despite fewer hit pixels) — concentrated mass over a smaller spatial set.</p>
  <p>Aggregate chromatic sums "match within 3%" (Phase 1 finding) only because spatial averaging hides per-pixel chromatic drifts up to <strong>27× higher on broken fixtures than healthy ones</strong>. The high-brightness/low-gamma tonemap config on these two fixtures then amplifies the per-pixel divergence into visible R via <code>k1 = brightness × PREFILTER × 268/256</code> (= 5873 for 02226, 8009 for 245.06687).</p>
  <p>This is sub-hypothesis #1 from the original BACKLOG (walker-pool seed dispersion) — deprioritized in Phase 1 based on incorrect aggregate evidence, now confirmed as the dominant lever.</p>
</div>

<p style="color:#888;font-family:monospace;font-size:11px;margin-bottom:8px;">Heatmap legend:</p>
<p class="legend" style="margin-top:0">🔴 red = pyr3 over-bright vs flam3 in this pixel · 🔵 blue = pyr3 under · 🟣 dim magenta = pyr3-only coverage · 🟢 dim cyan = flam3-only coverage · dark grey = neither engine hits this pixel. Alpha encoded by per-pixel hit density (log-scaled), so structure shows up even in dim regions.</p>

${rows
  .map((r) => {
    const cov = r.summary.coverage;
    const ov = r.summary.overall;
    const quads = r.summary.quadrants;
    const verdict = r.R > 5 ? 'verdict-bad' : 'verdict-ok';
    return `
<section class="fx">
  <h2>
    <span class="fxname">${r.id}</span>
    <span class="pill ${verdict}">R = ${r.R.toFixed(2)}</span>
    <span class="pill" style="background:#333">bothHit ${pct(cov.bothHit, cov.total)}</span>
    <span class="pill" style="background:#333">flam3Only ${pct(cov.flam3Only, cov.total)}</span>
    <span class="pill" style="background:#333">drift mean ${ov.mean.toFixed(3)}</span>
  </h2>
  <div class="grid">
    <figure>
      <img src="${r.golden}" loading="lazy" />
      <figcaption>flam3-C golden (final image)</figcaption>
    </figure>
    <figure>
      <img src="${r.pyr3}" loading="lazy" />
      <figcaption>pyr3 BE render (final image)</figcaption>
    </figure>
    <figure>
      <img src="${r.heatmap}" loading="lazy" />
      <figcaption>per-pixel chaos-histogram drift heatmap</figcaption>
    </figure>
  </div>
  <div class="stats">
    <div>
      <table>
        <thead><tr><th>coverage</th><th>n</th><th>%</th></tr></thead>
        <tbody>
          <tr><td>bothHit</td><td>${cov.bothHit.toLocaleString()}</td><td>${pct(cov.bothHit, cov.total)}</td></tr>
          <tr><td>pyr3 only</td><td>${cov.pyr3Only.toLocaleString()}</td><td>${pct(cov.pyr3Only, cov.total)}</td></tr>
          <tr><td>flam3 only</td><td>${cov.flam3Only.toLocaleString()}</td><td>${pct(cov.flam3Only, cov.total)}</td></tr>
          <tr><td>neither</td><td>${cov.neither.toLocaleString()}</td><td>${pct(cov.neither, cov.total)}</td></tr>
        </tbody>
      </table>
    </div>
    <div>
      <table>
        <thead><tr><th>per-pixel drift (both-hit)</th><th>mean</th><th>p95</th><th>n</th></tr></thead>
        <tbody>
          <tr><td>overall</td><td>${ov.mean.toFixed(4)}</td><td>${ov.p95.toFixed(4)}</td><td>${ov.n.toLocaleString()}</td></tr>
          ${['TL', 'TR', 'BL', 'BR']
            .map(
              (k) =>
                `<tr><td>${k}</td><td>${quads[k].mean.toFixed(4)}</td><td>${quads[k].p95.toFixed(4)}</td><td>${quads[k].n.toLocaleString()}</td></tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>
  </div>
</section>`;
  })
  .join('\n')}

<h3>Next: fix direction</h3>
<p style="color:#ccc;line-height:1.55;max-width: 900px">
The pyr3 walker pool needs <em>wider initial dispersion</em> across the attractor before fuse converges. Three candidate fix paths:
</p>
<ol style="color:#ccc;line-height:1.55;max-width: 900px">
  <li><strong>Widen walker init spread.</strong> Currently 1024 walkers start at independent random points in <code>[-1, 1]²</code>. The attractor's basin of convergence may be small relative to the unit square; many walkers converge to the same dense cluster. Try seeding walker init points from a different distribution (e.g., a sparse Sobol sequence) or pre-running a longer per-walker fuse so each walker reaches the full attractor before splatting.</li>
  <li><strong>Reduce parallelism, lengthen per-walker iters.</strong> Move toward flam3's single-chain pattern: fewer walkers (e.g., 64) × longer iters per walker (16M each). Trades GPU occupancy for wider attractor coverage.</li>
  <li><strong>Mid-trajectory walker re-randomization.</strong> Periodically re-seed walker positions during the dispatch so trajectories explore disjoint attractor regions. Less invasive than (1) or (2).</li>
</ol>
</body>
</html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
