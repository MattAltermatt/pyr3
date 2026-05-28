#!/usr/bin/env node
// Build .remember/verify/pyr3-024-divergence.html — 3-col eyeball gallery
// for the 248.22289 BE 4K visual divergence vs kotlin v1.1 reference.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = '/Users/matt/dev/MattAltermatt/pyr3';
const RESULTS = JSON.parse(readFileSync(join(REPO, '.remember/tmp/pyr3-024-results.json'), 'utf8'));
const OUT = join(REPO, '.remember/verify/pyr3-024-divergence.html');

const KOTLIN_SRC = `file://${REPO}/fixtures/kotlin-4k-refs/electricsheep.248.22289.gpu.4k.jpg`;
const PYR3_SRC = `file://${REPO}/.remember/tmp/pyr3-024-render-3840-native.png`;
const DIFF_SRC = `file://${REPO}/.remember/tmp/pyr3-024-diff.png`;

const f = (n) => n.toFixed(4);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>PYR3-024 — 248.22289 BE 4K vs kotlin v1.1</title>
<style>
  * { box-sizing: border-box; }
  body { background: #111; color: #eee; font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 24px; max-width: 1600px; }
  h1, h2 { margin-top: 0; }
  h2 { font-family: 'SF Mono', Menlo, monospace; font-size: 16px; }
  p, ul { color: #aaa; line-height: 1.55; max-width: 880px; }
  code { background: #222; padding: 1px 6px; border-radius: 3px; font-size: 13px; }
  .pill { background: #222; color: #ccc; padding: 2px 8px; border-radius: 4px; font-family: 'SF Mono', Menlo, monospace; font-size: 11px; display: inline-block; margin-right: 6px; }
  .pill.r-red { background: #511; color: #fbb; }
  .pill.r-yellow { background: #642; color: #fc8; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 16px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 8px; margin-bottom: 32px; }
  figure { margin: 0; }
  figure img { width: 100%; height: auto; display: block; image-rendering: pixelated; background: #000; }
  figcaption { font-family: 'SF Mono', Menlo, monospace; font-size: 11px; color: #888; text-align: center; padding: 4px 0; }
  .findings { background: #1a1a1a; padding: 16px 20px; border-left: 3px solid #f88; border-radius: 4px; margin-top: 24px; max-width: 880px; }
  .findings h3 { margin: 0 0 8px 0; color: #f88; }
  table { border-collapse: collapse; font-family: 'SF Mono', Menlo, monospace; font-size: 12px; margin-top: 12px; }
  th, td { padding: 4px 12px; border-bottom: 1px solid #333; text-align: left; color: #ccc; }
</style>
</head>
<body>

<h1>🔴 PYR3-024 — <code>electricsheep.248.22289</code> BE 4K visual divergence vs kotlin v1.1</h1>

<p>
pyr3 BE renders the fixture cleanly (no crash, dims correct, ~19s wall-clock) but the result diverges substantially from the kotlin v1.1 <code>SHOWCASE_4K</code> reference JPG. <strong>R(pyr3-BE, kotlin) = ${f(RESULTS.R)}</strong> — significantly worse than ANY existing 19-fixture parity rig measurement (worst there was <code>coverage.248.02226</code> at R=29.96). pyr3 BE rendered at <strong>3840×2160 native</strong> (post Phase-D-step-1 alignment to kotlin's <code>SHOWCASE_4K</code>), apples-to-apples vs the JPG ref.
</p>

<div class="meta">
  <span class="pill r-red">R(pyr3-BE, kotlin v1.1) ${f(RESULTS.R)}</span>
  <span class="pill r-yellow">r ${f(RESULTS.perChannel.r)}</span>
  <span class="pill">g ${f(RESULTS.perChannel.g)}</span>
  <span class="pill r-yellow">b ${f(RESULTS.perChannel.b)}</span>
  <span class="pill">tl ${f(RESULTS.perRegion.qTl)}</span>
  <span class="pill">tr ${f(RESULTS.perRegion.qTr)}</span>
  <span class="pill">bl ${f(RESULTS.perRegion.qBl)}</span>
  <span class="pill r-red">br ${f(RESULTS.perRegion.qBr)}</span>
</div>

<div class="grid">
  <figure>
    <img src="${KOTLIN_SRC}" alt="kotlin v1.1 ref">
    <figcaption>kotlin v1.1 SHOWCASE_4K reference (3840×2160 JPG)</figcaption>
  </figure>
  <figure>
    <img src="${PYR3_SRC}" alt="pyr3 BE render">
    <figcaption>pyr3 BE render (3840×2160 PNG, q=200)</figcaption>
  </figure>
  <figure>
    <img src="${DIFF_SRC}" alt="diff ×8">
    <figcaption>diff ×8 (pyr3-BE vs kotlin)</figcaption>
  </figure>
</div>

<div class="findings">
<h3>📋 Findings — divergence classification</h3>
<p>
Comparing 248.22289 (this fixture) vs <code>coverage.248.02226</code> (the existing PYR3-021 / PYR3-017 worst-case):
</p>
<table>
<thead><tr><th>fixture</th><th>R</th><th>r</th><th>g</th><th>b</th><th>per-channel skew</th></tr></thead>
<tbody>
<tr><td>248.22289 (this)</td><td>${f(RESULTS.R)}</td><td>${f(RESULTS.perChannel.r)}</td><td>${f(RESULTS.perChannel.g)}</td><td>${f(RESULTS.perChannel.b)}</td><td>red + blue heavy</td></tr>
<tr><td>coverage.248.02226</td><td>29.96</td><td>39.68</td><td>51.40</td><td>39.44</td><td>green heavy</td></tr>
</tbody>
</table>
<p>
<strong>The two fixtures have different per-channel signatures.</strong> 248.22289 is red+blue heavy; 248.02226 is green-heavy. They likely don't share the EXACT palette-baking divergence shape, but both look like upstream-stage divergences (palette/tonemap/density) rather than per-arm chaos-game bugs.
</p>
<p>
<strong>248.22289 genome traits worth probing:</strong>
</p>
<ul>
<li><code>brightness=29.06</code> — very high (typical 15–25); tonemap is doing heavy lifting</li>
<li><code>gamma=3.575</code> — high; palette baking AND tonemap both gamma-sensitive</li>
<li><code>estimator_radius=11</code> — outlier (typical 1–3); shared with 244.36880 (the FE-crash fixture)</li>
<li><code>palette_interpolation=hsv_circular</code> — common (5 other fixtures use it, all pass parity at low R)</li>
<li><code>vibrancy=1</code> — standard</li>
</ul>
<p>
<strong>Decision: fold into PYR3-021 Phase C.</strong> Dispatch <code>flame-fixture-investigator</code> with BOTH 248.02226 AND 248.22289 as evidence targets. The hypothesis-class probes (palette dump diff, tonemap diff, density flatten, spatial-filter ablation) return the same stereotyped report for each fixture, so divergence-shape comparison is mechanical. If they share an upstream-stage cause with different per-channel manifestations, the same fix lands both. If they diverge per probe, file 248.22289 as its own track.
</p>
</div>

</body>
</html>
`;

writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
console.log(`open ${OUT}`);
