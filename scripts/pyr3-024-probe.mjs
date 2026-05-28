#!/usr/bin/env node
// PYR3-024 248.22289 BE 4K divergence probe — re-render produced by
// `scripts/pyr3-023-be-render-4k.mjs`, compared against the kotlin v1.1
// `SHOWCASE_4K` reference JPG. Downscales pyr3's 4096-long-edge output
// to kotlin's 3840 long-edge via nearest-neighbor (matches PYR3-018
// downscale pattern; box-filter would be more honest but introduces
// its own bias; pyr3 is the side getting resized so noise floor is
// pyr3-side).
//
// Usage: node scripts/pyr3-024-probe.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import jpegJs from 'jpeg-js';
import { meanAbsDiffRgba, perChannelDrift, perRegionDrift } from '../src/compare.ts';
import { renderDiffPng } from '../src/diff-image.ts';

const REPO = '/Users/matt/dev/MattAltermatt/pyr3';
// Native 3840-long-edge BE render (post Phase-D-step-1 alignment); falls
// back to the 4096 render with explicit downscale if 3840 missing.
const PYR3_PATH_3840 = join(REPO, '.remember/tmp/pyr3-024-render-3840-native.png');
const PYR3_PATH_4096 = join(REPO, '.remember/tmp/pyr3-024-render.png');
const PYR3_PATH = existsSync(PYR3_PATH_3840) ? PYR3_PATH_3840 : PYR3_PATH_4096;
const KOTLIN_PATH = join(REPO, 'fixtures/kotlin-4k-refs/electricsheep.248.22289.gpu.4k.jpg');
const DIFF_PATH = join(REPO, '.remember/tmp/pyr3-024-diff.png');
const PYR3_DOWNSCALED_PATH = join(REPO, '.remember/tmp/pyr3-024-render-3840.png');

function readPngRgba(path) {
  const png = PNG.sync.read(readFileSync(path));
  return {
    width: png.width,
    height: png.height,
    rgba: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength),
  };
}

function readJpegRgba(path) {
  const decoded = jpegJs.decode(readFileSync(path), { useTArray: true });
  return {
    width: decoded.width,
    height: decoded.height,
    rgba: new Uint8Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
  };
}

function nearestNeighborDownscale(src, srcW, srcH, dstW, dstH) {
  const dst = new Uint8Array(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy = Math.floor(y * yRatio);
    for (let x = 0; x < dstW; x++) {
      const sx = Math.floor(x * xRatio);
      const sOff = (sy * srcW + sx) * 4;
      const dOff = (y * dstW + x) * 4;
      dst[dOff] = src[sOff];
      dst[dOff + 1] = src[sOff + 1];
      dst[dOff + 2] = src[sOff + 2];
      dst[dOff + 3] = src[sOff + 3];
    }
  }
  return dst;
}

console.log('[pyr3-024] loading pyr3 PNG:', PYR3_PATH);
const pyr3 = readPngRgba(PYR3_PATH);
console.log(`[pyr3-024] pyr3 dims: ${pyr3.width}×${pyr3.height}`);

console.log('[pyr3-024] loading kotlin v1.1 JPG ref:', KOTLIN_PATH);
const kotlin = readJpegRgba(KOTLIN_PATH);
console.log(`[pyr3-024] kotlin dims: ${kotlin.width}×${kotlin.height}`);

// JPEG decode produces RGBA with alpha=255 always; pyr3 PNG also RGBA;
// good to go. Downscale pyr3 if dims don't match.
let pyr3Rgba = pyr3.rgba;
let pyr3W = pyr3.width;
let pyr3H = pyr3.height;
if (pyr3W !== kotlin.width || pyr3H !== kotlin.height) {
  console.log(`[pyr3-024] downscaling pyr3 ${pyr3W}×${pyr3H} → ${kotlin.width}×${kotlin.height} (nearest-neighbor)`);
  pyr3Rgba = nearestNeighborDownscale(pyr3.rgba, pyr3W, pyr3H, kotlin.width, kotlin.height);
  pyr3W = kotlin.width;
  pyr3H = kotlin.height;
  // Persist downscaled pyr3 PNG for the eyeball gallery (apples-to-apples
  // alongside the kotlin JPG at native 3840).
  const downscaledPng = new PNG({ width: pyr3W, height: pyr3H });
  downscaledPng.data = Buffer.from(pyr3Rgba.buffer, pyr3Rgba.byteOffset, pyr3Rgba.byteLength);
  writeFileSync(PYR3_DOWNSCALED_PATH, PNG.sync.write(downscaledPng));
  console.log(`[pyr3-024] wrote downscaled pyr3 to ${PYR3_DOWNSCALED_PATH}`);
}

const R = meanAbsDiffRgba(pyr3Rgba, kotlin.rgba);
const channel = perChannelDrift(pyr3Rgba, kotlin.rgba);
const region = perRegionDrift(pyr3Rgba, kotlin.rgba, pyr3W, pyr3H);

console.log(`[pyr3-024] R(pyr3-BE, kotlin v1.1)=${R.toFixed(4)}`);
console.log(`[pyr3-024] perChannel r=${channel.r.toFixed(4)} g=${channel.g.toFixed(4)} b=${channel.b.toFixed(4)}`);
console.log(`[pyr3-024] perRegion  tl=${region.qTl.toFixed(4)} tr=${region.qTr.toFixed(4)} bl=${region.qBl.toFixed(4)} br=${region.qBr.toFixed(4)}`);

writeFileSync(DIFF_PATH, renderDiffPng(pyr3Rgba, kotlin.rgba, pyr3W, pyr3H));
console.log(`[pyr3-024] wrote diff×8 PNG to ${DIFF_PATH}`);

// Compare against the 19-fixture parity baselines for context.
console.log('\n[pyr3-024] context — parity rig R distribution (BE vs flam3-C, 19 fixtures):');
console.log('  best:    244.57686                  R = 0.45');
console.log('  median:  ≈ 6');
console.log('  worst:   coverage.248.02226         R = 29.96 (residual after v0.13)');

const out = {
  fixture: '248.22289',
  pyr3Dims: `${pyr3.width}×${pyr3.height}`,
  kotlinDims: `${kotlin.width}×${kotlin.height}`,
  comparedAt: `${pyr3W}×${pyr3H}`,
  R,
  perChannel: channel,
  perRegion: region,
};
const resultsPath = join(REPO, '.remember/tmp/pyr3-024-results.json');
writeFileSync(resultsPath, JSON.stringify(out, null, 2) + '\n');
console.log(`\n[pyr3-024] wrote ${resultsPath}`);
