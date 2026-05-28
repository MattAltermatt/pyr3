#!/usr/bin/env node
// PYR3-029 Phase 3 — per-pixel chromatic diff between pyr3 and flam3-C
// chaos histograms. Reads dump artifacts produced by:
//   - bin/pyr3-pixel-dump.ts   (4-channel u32 raw histogram)
//   - flam3-render-32bit-isaac with PYR3_DUMP_ACCUMULATOR=<path>
//     (5-channel double bucket array; channel 4 = count)
//
// Both formats share the same 5×u32 header layout. Per-pixel normalized
// ratio = (channel_sum / count_channel). We compute:
//   - Heatmap PNG: per-pixel chromatic-shift magnitude
//   - Per-quadrant chromatic-drift stats
//   - Histogram of per-pixel drift magnitudes
//   - Localized vs broad-spread classification
//
// Usage:
//   node scripts/pyr3-029-pixel-diff.mjs <fixture-id> [--out <dir>]

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const GOLDENS = join(REPO, 'fixtures', 'flam3-goldens');
const FLAM3_BIN = '/Users/matt/dev/sheep/flam3/flam3-render-32bit-isaac';

function parseArgs(argv) {
  const out = { fixture: null, outDir: join(REPO, '.remember', 'tmp', 'pyr3-029-pixel') };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out.outDir = resolve(argv[++i]);
    else out.fixture = a;
  }
  return out;
}

function locateFlame(id) {
  const dir = join(GOLDENS, id);
  const f = readdirSync(dir).find((f) => f.endsWith('.flame') || f.endsWith('.flam3'));
  if (!f) throw new Error(`no .flame in ${dir}`);
  return join(dir, f);
}

function runPyr3Dump(flamePath, outBin) {
  const r = spawnSync(
    'node',
    [
      '--import', 'tsx/esm',
      '--import', './bin/wgsl-loader-register.mjs',
      'bin/pyr3-pixel-dump.ts',
      flamePath,
      outBin,
    ],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    throw new Error(`pyr3-pixel-dump failed\nstderr:\n${r.stderr}`);
  }
}

function runFlam3Dump(flamePath, outBin) {
  const flameText = readFileSync(flamePath, 'utf8');
  const flameCount = (flameText.match(/<flame /g) || []).length;
  const stdin = flameCount > 1 ? `<flames>\n${flameText}\n</flames>` : flameText;
  const r = spawnSync(FLAM3_BIN, [], {
    input: stdin,
    cwd: '/tmp',
    env: { ...process.env, qs: '1', prefix: '/tmp/pixel-diff-flam3-', PYR3_DUMP_ACCUMULATOR: outBin },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0 && r.status !== null) {
    throw new Error(`flam3 failed (status=${r.status})`);
  }
}

function parsePyr3Dump(buf) {
  // 5×u32 header + width*height*4*u32 raw
  const hdr = new Uint32Array(buf.buffer, buf.byteOffset, 5);
  const width = hdr[0], height = hdr[1], channels = hdr[2], bpc = hdr[3];
  if (channels !== 4 || bpc !== 4) throw new Error(`unexpected pyr3 dump shape: ch=${channels} bpc=${bpc}`);
  const data = new Uint32Array(buf.buffer, buf.byteOffset + 20, width * height * 4);
  return { width, height, channels: 4, data };
}

function parseFlam3Dump(buf) {
  const hdr = new Uint32Array(buf.buffer, buf.byteOffset, 5);
  const width = hdr[0], height = hdr[1], channels = hdr[2], bpc = hdr[3];
  if (channels !== 5) throw new Error(`unexpected flam3 dump channels: ${channels}`);
  let data;
  if (bpc === 8) {
    data = new Float64Array(buf.buffer, buf.byteOffset + 20, width * height * 5);
  } else if (bpc === 4) {
    // flam3-32bit-isaac binary uses `bucket_int` (5 × u32). Convert to f64
    // for the rest of the pipeline so flam3 and pyr3 share a numeric path.
    const raw = new Uint32Array(buf.buffer, buf.byteOffset + 20, width * height * 5);
    data = new Float64Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = raw[i];
  } else {
    throw new Error(`unexpected flam3 bpc: ${bpc}`);
  }
  return { width, height, channels: 5, data };
}

// Per-pixel chromatic ratio = (channel / count) for each of R, G, B.
// Returns array of {r, g, b, count} per pixel.
function normalizePyr3(pyr3) {
  const out = new Float32Array(pyr3.width * pyr3.height * 4);
  const total = pyr3.width * pyr3.height;
  for (let i = 0; i < total; i++) {
    const base = i * 4;
    const c = pyr3.data[base + 3];
    if (c > 0) {
      out[base] = pyr3.data[base] / c;
      out[base + 1] = pyr3.data[base + 1] / c;
      out[base + 2] = pyr3.data[base + 2] / c;
      out[base + 3] = c;
    }
  }
  return out;
}

function normalizeFlam3(flam3) {
  // channels: [r, g, b, a, count]
  const out = new Float32Array(flam3.width * flam3.height * 4);
  const total = flam3.width * flam3.height;
  for (let i = 0; i < total; i++) {
    const sb = i * 5;
    const tb = i * 4;
    const c = flam3.data[sb + 4];
    if (c > 0) {
      out[tb] = flam3.data[sb] / c;
      out[tb + 1] = flam3.data[sb + 1] / c;
      out[tb + 2] = flam3.data[sb + 2] / c;
      out[tb + 3] = c;
    }
  }
  return out;
}

// Compute per-pixel drift heatmap. Output PNG channels:
//   R = positive drift (pyr3 over flam3, magnitude across 3 channels)
//   B = negative drift (pyr3 under flam3, magnitude across 3 channels)
//   G = 0 (visually clean red-vs-blue contrast)
//   A = alpha-blended by per-pixel mass (heavier hit pixels are brighter)
function buildHeatmap(pyr3Norm, flam3Norm, width, height) {
  const png = new PNG({ width, height });
  let bothHit = 0;
  let pyr3Only = 0;
  let flam3Only = 0;
  let neither = 0;
  const drifts = [];
  for (let i = 0; i < width * height; i++) {
    const b = i * 4;
    const pc = pyr3Norm[b + 3];
    const fc = flam3Norm[b + 3];
    const dstBase = i * 4;
    if (pc > 0 && fc > 0) {
      bothHit++;
      const dr = pyr3Norm[b] - flam3Norm[b];
      const dg = pyr3Norm[b + 1] - flam3Norm[b + 1];
      const db = pyr3Norm[b + 2] - flam3Norm[b + 2];
      // Magnitude as Euclidean norm in normalized-channel space.
      // Per-channel values are in [0, 255] (pyr3) or [0, pal_double_max] (flam3),
      // so we use the normalized fraction-of-count (∈ ~[0, 1]) directly.
      const mag = Math.sqrt(dr * dr + dg * dg + db * db);
      drifts.push({ x: i % width, y: Math.floor(i / width), mag, dr, dg, db, pc, fc });
      // Encode: positive driftR (pyr3 over) → red, negative → blue.
      // Tone-shape by combining signed direction: use sign of (dr+dg+db) as direction proxy.
      const dirSum = dr + dg + db;
      const intensity = Math.min(255, Math.round(mag * 1500));
      if (dirSum >= 0) {
        png.data[dstBase] = intensity;
        png.data[dstBase + 2] = 0;
      } else {
        png.data[dstBase] = 0;
        png.data[dstBase + 2] = intensity;
      }
      png.data[dstBase + 1] = 0;
      // Alpha: log-density of hits (so we see structure even in dim regions).
      png.data[dstBase + 3] = Math.min(255, Math.round(50 + Math.log(1 + Math.min(pc, fc)) * 12));
    } else if (pc > 0 && fc === 0) {
      pyr3Only++;
      png.data[dstBase] = 80;     // dim magenta = pyr3-only coverage
      png.data[dstBase + 1] = 40;
      png.data[dstBase + 2] = 80;
      png.data[dstBase + 3] = 200;
    } else if (pc === 0 && fc > 0) {
      flam3Only++;
      png.data[dstBase] = 40;     // dim cyan = flam3-only coverage
      png.data[dstBase + 1] = 80;
      png.data[dstBase + 2] = 80;
      png.data[dstBase + 3] = 200;
    } else {
      neither++;
      png.data[dstBase] = 12;     // very dark grey background
      png.data[dstBase + 1] = 12;
      png.data[dstBase + 2] = 12;
      png.data[dstBase + 3] = 255;
    }
  }
  return { png, stats: { bothHit, pyr3Only, flam3Only, neither, total: width * height }, drifts };
}

function quadrantStats(drifts, width, height) {
  const halfW = Math.floor(width / 2);
  const halfH = Math.floor(height / 2);
  const quads = { TL: [], TR: [], BL: [], BR: [] };
  for (const d of drifts) {
    const right = d.x >= halfW;
    const bottom = d.y >= halfH;
    const key = (bottom ? 'B' : 'T') + (right ? 'R' : 'L');
    quads[key].push(d.mag);
  }
  const summary = {};
  for (const [k, arr] of Object.entries(quads)) {
    if (arr.length === 0) {
      summary[k] = { n: 0, mean: 0, p50: 0, p95: 0 };
      continue;
    }
    arr.sort((a, b) => a - b);
    summary[k] = {
      n: arr.length,
      mean: arr.reduce((s, v) => s + v, 0) / arr.length,
      p50: arr[Math.floor(arr.length * 0.5)],
      p95: arr[Math.floor(arr.length * 0.95)],
    };
  }
  return summary;
}

function magHistogram(drifts) {
  if (drifts.length === 0) return [];
  const mags = drifts.map((d) => d.mag).sort((a, b) => a - b);
  const max = mags[mags.length - 1];
  const buckets = 20;
  const hist = new Array(buckets).fill(0);
  for (const m of mags) {
    const idx = Math.min(buckets - 1, Math.floor((m / max) * buckets));
    hist[idx]++;
  }
  return { max, buckets: hist };
}

async function main() {
  const { fixture, outDir } = parseArgs(process.argv);
  if (!fixture) {
    console.error('usage: node scripts/pyr3-029-pixel-diff.mjs <fixture-id> [--out <dir>]');
    process.exit(1);
  }
  if (!existsSync(join(GOLDENS, fixture))) {
    console.error(`fixture not found: ${fixture}`);
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  const flame = locateFlame(fixture);
  const pyr3Bin = join(outDir, `${fixture}-pyr3.bin`);
  const flam3Bin = join(outDir, `${fixture}-flam3.bin`);

  console.error(`[pixel-diff] ${fixture}`);
  console.error('[pixel-diff]   running pyr3-pixel-dump…');
  const t0 = Date.now();
  runPyr3Dump(flame, pyr3Bin);
  console.error(`[pixel-diff]   running flam3 PYR3_DUMP_ACCUMULATOR…`);
  runFlam3Dump(flame, flam3Bin);
  const tRender = ((Date.now() - t0) / 1000).toFixed(1);

  console.error('[pixel-diff]   parsing dumps…');
  const pyr3 = parsePyr3Dump(readFileSync(pyr3Bin));
  const flam3 = parseFlam3Dump(readFileSync(flam3Bin));
  // flam3 buckets carry a gutter on each side (oversample*W + 2*gutter, same H).
  // Trim flam3 to pyr3's window, centered.
  const W = pyr3.width, H = pyr3.height;
  if (flam3.width < W || flam3.height < H) {
    throw new Error(`flam3 smaller than pyr3: ${flam3.width}×${flam3.height} < ${W}×${H}`);
  }
  const gx = Math.floor((flam3.width - W) / 2);
  const gy = Math.floor((flam3.height - H) / 2);
  if (gx !== 0 || gy !== 0) {
    console.error(`[pixel-diff]   trimming flam3 ${flam3.width}×${flam3.height} → ${W}×${H} (gutter ${gx}, ${gy})`);
    const trimmed = new Float64Array(W * H * 5);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const src = ((y + gy) * flam3.width + (x + gx)) * 5;
        const dst = (y * W + x) * 5;
        for (let c = 0; c < 5; c++) trimmed[dst + c] = flam3.data[src + c];
      }
    }
    flam3.data = trimmed;
    flam3.width = W;
    flam3.height = H;
  }
  const pyr3Norm = normalizePyr3(pyr3);
  const flam3Norm = normalizeFlam3(flam3);

  console.error('[pixel-diff]   building heatmap + stats…');
  const { png, stats, drifts } = buildHeatmap(pyr3Norm, flam3Norm, W, H);
  const heatmapPath = join(outDir, `${fixture}-heatmap.png`);
  writeFileSync(heatmapPath, PNG.sync.write(png));

  const quads = quadrantStats(drifts, W, H);
  const hist = magHistogram(drifts);
  const tTotal = ((Date.now() - t0) / 1000).toFixed(1);

  // Summary stats.
  const driftMags = drifts.map((d) => d.mag).sort((a, b) => a - b);
  const overallMean = driftMags.reduce((s, v) => s + v, 0) / driftMags.length;
  const overallP50 = driftMags[Math.floor(driftMags.length * 0.5)];
  const overallP95 = driftMags[Math.floor(driftMags.length * 0.95)];
  const overallMax = driftMags[driftMags.length - 1];

  const summary = {
    fixture,
    dims: { width: W, height: H },
    coverage: stats,
    overall: { mean: overallMean, p50: overallP50, p95: overallP95, max: overallMax, n: drifts.length },
    quadrants: quads,
    histogram: hist,
    timing: { totalSec: Number(tTotal), renderSec: Number(tRender) },
    artifacts: {
      heatmap: heatmapPath,
      pyr3Bin,
      flam3Bin,
    },
  };
  const summaryPath = join(outDir, `${fixture}-summary.json`);
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.error('');
  console.error(`[pixel-diff] ${fixture} — done in ${tTotal}s`);
  console.error(`  coverage: bothHit=${stats.bothHit}  pyr3Only=${stats.pyr3Only}  flam3Only=${stats.flam3Only}  neither=${stats.neither}`);
  console.error(`  drift mag (per-pixel chromatic ratio, both-hit pixels only):`);
  console.error(`    mean=${overallMean.toFixed(4)}  p50=${overallP50.toFixed(4)}  p95=${overallP95.toFixed(4)}  max=${overallMax.toFixed(4)}`);
  console.error(`  per-quadrant mean:`);
  for (const k of ['TL', 'TR', 'BL', 'BR']) {
    console.error(`    ${k}: n=${quads[k].n}  mean=${quads[k].mean.toFixed(4)}  p95=${quads[k].p95.toFixed(4)}`);
  }
  console.error(`  artifacts:`);
  console.error(`    heatmap: ${heatmapPath}`);
  console.error(`    summary: ${summaryPath}`);
}

main().catch((err) => {
  console.error('pyr3-029-pixel-diff failed:', err);
  process.exit(1);
});
