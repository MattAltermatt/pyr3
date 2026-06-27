#!/usr/bin/env node
// Build the public /showcase gallery into public/showcase/.
//
// Reads fixtures/showcase-v1.0/_manifest.json + the gitignored 4K PNGs,
// derives two JPEG tiers per fixture (full 4K ~q90 + 600px thumb ~q90),
// copies each source .flame, extracts the artist nick + render dims, and
// emits a complete static index.html (masonry gallery, pyr3 dark theme).
//
// Output lives in public/showcase/ — Vite serves it at /showcase/ in dev
// and copies it into dist/showcase/ on build. The whole dir is gitignored;
// the heavy JPEGs/.flames never touch `main` (they ride to gh-pages via the
// build artifact).
//
// Usage:
//   node scripts/build-showcase.mjs [--hw "Apple M-series"]
//
// Run scripts/render-showcase-v1.0.mjs first to populate the 4K PNGs.

import { readFileSync, existsSync, writeFileSync, mkdirSync, statSync, rmSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import jpeg from 'jpeg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const RENDERS_DIR = join(REPO, 'fixtures', 'showcase-v1.0');
const MANIFEST = join(RENDERS_DIR, '_manifest.json');
// Showcase source .flames live in the public electric-sheep-fold corpus, a sibling
// checkout by default; override with ESF_ROOT. Manifest `source` paths are relative to it.
const ESF_ROOT = process.env.ESF_ROOT || resolve(REPO, '..');
const OUT_DIR = join(REPO, 'public', 'showcase');

// --- args ---
const args = process.argv.slice(2);
const hwIdx = args.indexOf('--hw');
const HARDWARE = hwIdx >= 0 ? args[hwIdx + 1] : 'Apple M-series';
const verIdx = args.indexOf('--ver');

// Version comes from package.json (the canonical source after the 2026-05-30
// GitHub-issues pivot — ship history now lives in GitHub Releases, pre-1.0
// history in HISTORY.md). Override with --ver if needed.
function packageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
    return pkg.version ? `v${pkg.version}` : null;
  } catch {
    return null;
  }
}
const VERSION = verIdx >= 0 ? args[verIdx + 1] : (packageVersion() ?? 'v1.0');

if (!existsSync(MANIFEST)) {
  console.error(`manifest missing — run scripts/render-showcase-v1.0.mjs first: ${MANIFEST}`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const renderedDate = (manifest.generatedAt ?? '').slice(0, 10) || 'unknown';
const totalMin = manifest.totalSec ? `~${Math.round(manifest.totalSec / 60)} min` : '—';

// --- helpers ---
function htmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Parse PNG width/height straight from the IHDR chunk (offset 16/20,
// big-endian u32) — avoids decoding a 25MB image just for dimensions.
function pngDims(path) {
  const fd = readFileSync(path, { flag: 'r' }).subarray(0, 24);
  if (fd.length < 24) return null;
  return { width: fd.readUInt32BE(16), height: fd.readUInt32BE(20) };
}

function extractNick(flamePath) {
  try {
    const xml = readFileSync(flamePath, 'utf8');
    const m = xml.match(/<flame\b[^>]*\bnick="([^"]*)"/i);
    const nick = m && m[1] ? m[1].trim() : '';
    return nick || null;
  } catch {
    return null;
  }
}

function sips(srcPng, outJpg, extraArgs) {
  execFileSync('sips', [...extraArgs, '-s', 'format', 'jpeg', '-s', 'formatOptions', '90', srcPng, '--out', outJpg], { stdio: 'ignore' });
}

// Mean luminance (0–255) of a JPEG. Used to skip degenerate pure-black
// renders that the chaos game can produce (e.g. 242.01373) — a showcase
// shouldn't display an empty card. Computed off the small 600px thumb so
// it's cheap. Pure-black ≈ 0.05; the sparsest legitimate flame measured
// ≈ 0.68; normal flames are double-digit. Threshold sits in the gap.
const BLACK_MEAN_LUM = 0.25;
function meanLuminance(jpgPath) {
  const { data } = jpeg.decode(readFileSync(jpgPath), { useTArray: true });
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
  return sum / (data.length / 4);
}

// --- fresh output dir ---
if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const fixtures = [...manifest.fixtures].sort((a, b) => a.id.localeCompare(b.id));
const cards = [];
let ready = 0;
let skipped = 0;

for (const fx of fixtures) {
  const { id, source, renderSec } = fx;
  const png = join(RENDERS_DIR, `${id}.pyr3-4k.png`);
  if (!existsSync(png) || statSync(png).size === 0) {
    console.warn(`skip ${id} — 4K PNG missing`);
    skipped++;
    continue;
  }

  const fullJpg = join(OUT_DIR, `${id}.4k.jpg`);
  const thumbJpg = join(OUT_DIR, `${id}.thumb.jpg`);
  // Thumb first — it's the luminance probe. Skip degenerate pure-black
  // renders (don't waste the 4K pass, leave no orphan files in the card).
  sips(png, thumbJpg, ['-Z', '600']);     // 600px long-edge, q90
  const lum = meanLuminance(thumbJpg);
  if (lum < BLACK_MEAN_LUM) {
    console.warn(`skip ${id} — render is effectively black (mean lum ${lum.toFixed(2)})`);
    rmSync(thumbJpg, { force: true });
    skipped++;
    continue;
  }
  sips(png, fullJpg, []);                 // native res, q90

  const dims = pngDims(png);
  const dimStr = dims ? `${dims.width}×${dims.height}` : '4K';
  const secs = renderSec != null ? `${Number(renderSec).toFixed(1)}s` : '';
  const renderedLine = dims
    ? `Rendered at ${dimStr} by pyr3 GPU${secs ? ` in ${secs}` : ''}`
    : `Rendered by pyr3 GPU${secs ? ` in ${secs}` : ''}`;
  const srcPath = source ? resolve(ESF_ROOT, source) : null;
  const nick = srcPath && existsSync(srcPath) ? extractNick(srcPath) : null;
  const byHtml = nick ? `By <b>${htmlEscape(nick)}</b>` : `<span class="anon">artist unknown</span>`;

  // #44 — the flame NAME is the link to the live viewer for this exact sheep,
  // via the corpus share-URL (/browse/gen/{gen}/id/{id} since #449 flattened
  // the old /esf/* prefix; both /esf/* and /v1/gen/* still redirect at boot
  // via src/route-redirects.ts). Supersedes the
  // PYR3-045 separate "▶ Open in viewer" pill + the "#" permalink bookmark:
  // the name itself now carries the affordance. The fixture id is
  // "electricsheep.{gen}.{id}"; the route is relative to the showcase dir
  // (../) to survive both the apex domain and a project-Pages base prefix.
  // Normalize the padded fixture segments (e.g. "00866") to the canonical
  // non-padded route ids (e.g. 866) — the chunk map is keyed by the numeric
  // string, and parseLoadIntent runs Number() on the path segment anyway.
  // All v1.0 showcase fixtures are canonical genomes, so corpusMatch always
  // hits; the plain-text fallback covers any future non-corpus fixture.
  const corpusMatch = id.match(/\.(\d+)\.(\d+)$/);
  const viewerHref = corpusMatch
    ? `../browse/gen/${Number(corpusMatch[1])}/id/${Number(corpusMatch[2])}`
    : null;
  const idHtml = viewerHref
    ? `<a class="idlink" href="${viewerHref}" title="Open this flame in the live pyr3 viewer">${id}</a>`
    : id;

  cards.push(`    <div class="card" id="${id}">
      <a class="thumb" href="./${id}.4k.jpg" target="_blank" rel="noopener" title="Open full 4K image in a new tab"><img src="./${id}.thumb.jpg" loading="lazy" alt="${id}"></a>
      <div class="cap">
        <div class="id"><span class="idtext">${idHtml}</span><a class="open" href="./${id}.4k.jpg" target="_blank" rel="noopener">⤢ Open 4K</a></div>
        <div class="by">${byHtml}</div>
        <div class="rendered">${renderedLine}</div>
      </div>
    </div>`);
  ready++;
}

const GH = 'https://github.com/MattAltermatt/pyr3';
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0' stop-color='%23ffbe3e'/%3E%3Cstop offset='1' stop-color='%23bf2408'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M16 2c4 7 8 9.5 6.5 17C21.4 25.8 11 26.5 9.6 19 8.5 13 13 10 16 2Z' fill='url(%23g)'/%3E%3Cpath d='M16 9.5c3.4 0 4 4 .8 5.2 M16 22c-3.4 0-4-4-.8-5.2' fill='none' stroke='%230a0a0c' stroke-width='2.3' stroke-linecap='round'/%3E%3C/svg%3E">
<title>pyr3 — showcase</title>
<style>
  :root{--bg:#0a0a0c;--panel:#15151a;--border:#2a2a30;--accent:#ff8c1a;--accent-soft:rgba(255,140,26,.15);--text:#ddd;--dim:#888;--muted:#aaa}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;line-height:1.5}
  .wrap{max-width:1080px;margin:0 auto;padding:24px}
  a{color:#ffb56e}
  .hero{text-align:center;padding:18px 0 8px}
  .hero .mark{font-size:34px;font-weight:800;letter-spacing:.5px}
  .hero .mark .heromark{width:.92em;height:.92em;vertical-align:-.1em}
  .hero .tagline{color:var(--muted);font-size:14px;margin-top:2px}
  .hero .lede{max-width:600px;margin:14px auto 0;font-size:13px;color:var(--dim);line-height:1.65}
  .nav{text-align:center;margin:14px 0 0;font-size:13px;color:var(--dim)}
  .nav a{text-decoration:none;margin:0 4px}
  .banner{display:flex;gap:16px;justify-content:center;flex-wrap:wrap;font-size:11.5px;color:var(--dim);border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:9px 0;margin:16px 0 26px}
  .banner b{color:var(--muted)}
  .grid{column-count:3;column-gap:14px}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin:0 0 14px;break-inside:avoid;position:relative}
  .card .thumb{display:block;position:relative;cursor:zoom-in;line-height:0}
  .card .thumb img{width:100%;height:auto;display:block;background:#000}
  .card .cap{padding:9px 11px}
  .card .id{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .card .idtext{font-family:ui-monospace,monospace;font-size:12px;color:var(--text);word-break:break-all;min-width:0}
  .card .idlink{color:#ffb56e;text-decoration:none;font-weight:600}
  .card .idlink:hover{color:var(--accent);text-decoration:underline}
  .card .open{flex:0 0 auto;font-size:11px;font-weight:600;color:#ffb56e;text-decoration:none;border:1px solid var(--accent);background:var(--accent-soft);border-radius:999px;padding:2px 11px;white-space:nowrap}
  .card .open:hover{background:var(--accent);color:#0a0a0c}
  .card .by{font-size:11.5px;color:var(--dim);margin-top:4px}
  .card .by b{color:var(--muted)}
  .card .by .anon{color:#666}
  .card .rendered{font-size:11px;color:var(--dim);margin-top:5px}
  :target{scroll-margin-top:16px}
  .card:target{outline:2px solid var(--accent);outline-offset:2px}
  @media(max-width:760px){.grid{column-count:1}.wrap{padding:16px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <div class="mark"><svg class="heromark" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="heroMark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffbe3e"/><stop offset="1" stop-color="#bf2408"/></linearGradient></defs><path d="M16 2c4 7 8 9.5 6.5 17C21.4 25.8 11 26.5 9.6 19 8.5 13 13 10 16 2Z" fill="url(#heroMark)"/><path d="M16 9.5c3.4 0 4 4 .8 5.2 M16 22c-3.4 0-4-4-.8-5.2" fill="none" stroke="#0a0a0c" stroke-width="2.3" stroke-linecap="round"/></svg> pyr3</div>
    <div class="tagline">A modern fractal-flame renderer in TypeScript + WebGPU</div>
    <div class="lede">${ready} hand-picked electric sheep, rendered at 4K by pyr3's WebGPU backend. pyr3 is a fractal-flame renderer in the lineage of <a href="https://flam3.com/" rel="noopener">flam3</a>, the original C engine. The renderer that made these is the same one running the <a href="../">live viewer</a> — drop in your own <code>.flame</code> and watch it draw.</div>
    <div class="nav"><a href="${GH}">github</a> · <a href="${GH}/releases">releases</a> · <a href="${GH}/blob/main/VISION.md">VISION</a> · <a href="../">live viewer →</a></div>
    <div class="banner"><span><b>pyr3 ${htmlEscape(VERSION)}</b></span><span>rendered ${renderedDate}</span><span>${htmlEscape(HARDWARE)}</span><span><b>${ready}</b> flames in <b>${totalMin}</b></span></div>
  </div>
  <div class="grid">
${cards.join('\n')}
  </div>
</div>
</body>
</html>
`;

writeFileSync(join(OUT_DIR, 'index.html'), html);

// Footprint summary
let bytes = 0;
for (const f of readdirSync(OUT_DIR)) bytes += statSync(join(OUT_DIR, f)).size;
console.log(`wrote ${OUT_DIR}`);
console.log(`${ready} cards · ${skipped} skipped · ${(bytes / 1048576).toFixed(0)} MB total`);
