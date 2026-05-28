#!/usr/bin/env node
// Generate 4K renders of (electricsheep.247.19679, coverage.248.02226) from
// both pyr3 BE and flam3-C at SHOWCASE_4K dims (3840 long-edge), capture
// wall-clock per engine, and build a self-contained eyeball HTML at
// `.remember/verify/v0.18-4k-pyr3-vs-flam3c.html`.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const FLAM3_BIN = '/Users/matt/dev/sheep/flam3/flam3-render-32bit-isaac';
const OUT_DIR = join(REPO, '.remember', 'tmp', 'pyr3-vs-flam3c-4k');
const HTML = join(REPO, '.remember', 'verify', 'v0.18-4k-pyr3-vs-flam3c.html');

const FULL_MAX_DIM = 3840;
const FULL_MAX_SPP = 200;

const FIXTURES = [
  {
    id: 'electricsheep.247.19679',
    label: 'electricsheep.247.19679 — README hero, R≈2.8 vs flam3-C',
    flame: join(REPO, 'fixtures', 'electricsheep.247.19679.flam3'),
  },
  {
    id: 'coverage.248.02226',
    label: 'coverage.248.02226 — PYR3-029 outlier, R≈30 vs flam3-C',
    flame: join(REPO, 'fixtures', 'flam3-goldens', 'coverage.248.02226', 'coverage.248.02226.flam3'),
  },
];

function rewriteFlame4K(input, outPath) {
  const text = readFileSync(input, 'utf8');
  const m = text.match(/<flame\b[^>]*>/);
  if (!m) throw new Error(`no <flame> tag in ${input}`);
  const flameTag = m[0];
  const getAttr = (n) => {
    const r = new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`);
    const mm = flameTag.match(r);
    return mm ? mm[1] : null;
  };
  const setAttr = (tag, n, v) => {
    const r = new RegExp(`\\b${n}\\s*=\\s*"[^"]*"`);
    if (tag.match(r)) return tag.replace(r, `${n}="${v}"`);
    return tag.replace(/>$/, ` ${n}="${v}">`);
  };
  const sizeStr = getAttr('size');
  if (!sizeStr) throw new Error(`flame has no size attr`);
  const [declW, declH] = sizeStr.trim().split(/\s+/).map(Number);
  const declScale = Number(getAttr('scale') ?? '1');
  const declQuality = Number(getAttr('quality') ?? '100');
  const maxDecl = Math.max(declW, declH);
  const sizeScale = FULL_MAX_DIM / maxDecl;
  const targetW = declW === maxDecl ? FULL_MAX_DIM : Math.max(1, Math.floor((FULL_MAX_DIM * declW) / declH));
  const targetH = declH === maxDecl ? FULL_MAX_DIM : Math.max(1, Math.floor((FULL_MAX_DIM * declH) / declW));
  const newScale = declScale * sizeScale;
  const newQuality = Math.min(declQuality, FULL_MAX_SPP);
  let newTag = flameTag;
  newTag = setAttr(newTag, 'size', `${targetW} ${targetH}`);
  newTag = setAttr(newTag, 'scale', String(newScale));
  newTag = setAttr(newTag, 'supersample', '1');
  newTag = setAttr(newTag, 'quality', String(newQuality));
  writeFileSync(outPath, text.replace(flameTag, newTag));
  return { dims: `${targetW}×${targetH}`, quality: newQuality };
}

function renderPyr3(flamePath, outPath) {
  const start = performance.now();
  const r = spawnSync(
    'node',
    [
      '--import', 'tsx/esm',
      '--import', './bin/wgsl-loader-register.mjs',
      'bin/pyr3-render.ts',
      flamePath,
      outPath,
    ],
    { cwd: REPO, encoding: 'utf8' },
  );
  const elapsed = (performance.now() - start) / 1000;
  if (r.status !== 0) throw new Error(`pyr3-render failed: ${r.stderr}`);
  return elapsed;
}

function renderFlam3(flamePath, outPath) {
  const flameText = readFileSync(flamePath, 'utf8');
  const flameCount = (flameText.match(/<flame /g) || []).length;
  const stdin = flameCount > 1 ? `<flames>\n${flameText}\n</flames>` : flameText;
  const prefix = outPath.replace(/\.png$/, '');
  const start = performance.now();
  const r = spawnSync(FLAM3_BIN, [], {
    input: stdin,
    cwd: '/tmp',
    env: { ...process.env, qs: '1', prefix: `${prefix}-` },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const elapsed = (performance.now() - start) / 1000;
  if (r.status !== 0 && r.status !== null) throw new Error(`flam3 failed`);
  // flam3 writes <prefix>-00000.png
  const written = `${prefix}-00000.png`;
  if (!existsSync(written)) throw new Error(`flam3 did not produce ${written}`);
  return { elapsed, path: written };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(dirname(HTML), { recursive: true });

  const rows = [];
  for (const fx of FIXTURES) {
    console.error(`[4k] ${fx.id}`);
    const tweaked = join(OUT_DIR, `${fx.id}.4k.flam3`);
    const meta = rewriteFlame4K(fx.flame, tweaked);
    console.error(`  4K dims: ${meta.dims}  quality: ${meta.quality}`);

    const pyr3Path = join(OUT_DIR, `${fx.id}.pyr3.4k.png`);
    console.error('  rendering pyr3 BE 4K…');
    const pyr3Elapsed = renderPyr3(tweaked, pyr3Path);
    console.error(`    ${pyr3Elapsed.toFixed(1)}s  →  ${pyr3Path}`);

    const flam3Path = join(OUT_DIR, `${fx.id}.flam3c.4k.png`);
    console.error('  rendering flam3-C 4K (qs=1, full quality)…');
    const flam3Result = renderFlam3(tweaked, flam3Path);
    const flam3Bytes = statSync(flam3Result.path).size;
    const pyr3Bytes = statSync(pyr3Path).size;
    console.error(`    ${flam3Result.elapsed.toFixed(1)}s  →  ${flam3Result.path}`);

    rows.push({
      id: fx.id,
      label: fx.label,
      dims: meta.dims,
      quality: meta.quality,
      pyr3: { path: pyr3Path, elapsedSec: pyr3Elapsed, sizeBytes: pyr3Bytes },
      flam3: { path: flam3Result.path, elapsedSec: flam3Result.elapsed, sizeBytes: flam3Bytes },
      speedup: flam3Result.elapsed / pyr3Elapsed,
    });
  }

  // HTML output.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>pyr3 BE 4K vs flam3-C 4K — side-by-side</title>
<style>
  body { background:#0d0d0d; color:#eee; font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 24px 32px; max-width: 1800px; }
  h1 { margin: 0 0 4px 0; font-weight: 600; }
  .subtitle { color: #aaa; margin: 4px 0 24px 0; font-size: 13px; }
  .fx { margin-bottom: 40px; padding-bottom: 32px; border-bottom: 1px solid #2a2a2a; }
  .fx h2 { font-size: 16px; font-weight: 500; margin: 0 0 6px 0; }
  .fxname { font-family: ui-monospace, Menlo, monospace; color: #f0f0f0; }
  .meta { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #999; margin: 0 0 14px 0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  figure { margin: 0; background: #000; border: 1px solid #2a2a2a; }
  figure a { display: block; }
  figure img { width: 100%; display: block; cursor: zoom-in; }
  figcaption { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #ccc; padding: 10px 12px 12px; border-top: 1px solid #2a2a2a; background: #151515; }
  figcaption .label { color: #999; }
  figcaption .timing { color: #f5c460; font-weight: 600; }
  figcaption .speedup { color: #6abf6a; font-size: 11px; }
  figcaption a { color: #6ac9ff; text-decoration: none; }
  figcaption a:hover { text-decoration: underline; }
  .legend { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #999; margin-top: 6px; }
</style>
</head>
<body>
<h1>pyr3 BE 4K vs flam3-C 4K — side-by-side</h1>
<p class="subtitle">
  Generated ${new Date().toISOString()}.
  Both engines rendered at 3840 long-edge (kotlin SHOWCASE_4K preset), oversample=1,
  quality min(genome.quality, 200). Click an image to view the full 4K PNG.
</p>
<p class="legend">flam3-C: <code>/Users/matt/dev/sheep/flam3/flam3-render-32bit-isaac</code> @ qs=1. pyr3 BE: <code>bin/pyr3-render.ts</code> via Dawn-node WebGPU.</p>

${rows
  .map((r) => {
    const fmtMB = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';
    return `
<section class="fx">
  <h2><span class="fxname">${r.id}</span></h2>
  <p class="meta">${r.label} · 4K dims ${r.dims} · quality ${r.quality} SPP · pyr3 is <strong style="color:#6abf6a">${r.speedup.toFixed(1)}×</strong> faster than flam3-C here</p>
  <div class="grid">
    <figure>
      <a href="file://${r.pyr3.path}" target="_blank"><img src="file://${r.pyr3.path}" loading="lazy" /></a>
      <figcaption>
        <span class="label">pyr3 BE (WebGPU)</span> · <span class="timing">${r.pyr3.elapsedSec.toFixed(2)}s</span> · ${fmtMB(r.pyr3.sizeBytes)} ·
        <a href="file://${r.pyr3.path}" target="_blank">open full 4K ↗</a>
      </figcaption>
    </figure>
    <figure>
      <a href="file://${r.flam3.path}" target="_blank"><img src="file://${r.flam3.path}" loading="lazy" /></a>
      <figcaption>
        <span class="label">flam3-C (CPU f64)</span> · <span class="timing">${r.flam3.elapsedSec.toFixed(2)}s</span> · ${fmtMB(r.flam3.sizeBytes)} ·
        <span class="speedup">(${r.speedup.toFixed(1)}× slower than pyr3)</span> ·
        <a href="file://${r.flam3.path}" target="_blank">open full 4K ↗</a>
      </figcaption>
    </figure>
  </div>
</section>`;
  })
  .join('\n')}

<p class="legend" style="margin-top: 32px;">
  Hardware: same machine (M-series). flam3 runs single-threaded on CPU; pyr3 BE runs on Dawn-node WebGPU bound to the integrated/dGPU at f32 precision.
  Render-time gap is the architectural-decision payoff per CLAUDE.md "GPU only; no CPU path."
</p>
</body>
</html>
`;

  writeFileSync(HTML, html);
  console.error(`\n[4k] HTML → ${HTML}`);
  for (const r of rows) {
    console.error(
      `  ${r.id}: pyr3=${r.pyr3.elapsedSec.toFixed(2)}s flam3=${r.flam3.elapsedSec.toFixed(2)}s (${r.speedup.toFixed(1)}×)`,
    );
  }
}

main().catch((err) => {
  console.error('build-4k-side-by-side failed:', err);
  process.exit(1);
});
