#!/usr/bin/env -S node --import tsx/esm
// Collector for PYR3-018 FE parity sweep.
//
// Input: JSON file produced by chrome-devtools-mcp evaluate_script with
//   { width, height, rgba_b64, png_dataurl }
// Output side-effects:
//   - Saves PNG to fixtures/flam3-goldens/<fixture>/pyr3-fe-render.png
//   - Prints one-line JSON: { fixture, width, height, R, perChannel, perRegion, threshold, BE_baseline }

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { meanAbsDiffRgba, perChannelDrift, perRegionDrift } from '../src/compare';
import { nearestDownscale, renderDiffPng } from './parity-diff-image';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface CapturePayload {
  width: number;
  height: number;
  rgba_b64: string;
  png_dataurl: string;
}

interface FixtureMeta {
  width: number;
  height: number;
  baselineR?: number;
  thresholdR?: number;
}

async function main(): Promise<void> {
  const [fixtureId, capturePath] = process.argv.slice(2);
  if (!fixtureId || !capturePath) {
    console.error('usage: pyr3-018-fe-collect.ts <fixture-id> <capture-json-path>');
    process.exit(1);
  }

  const fixtureDir = resolve(repoRoot, 'fixtures/flam3-goldens', fixtureId);
  const goldenPath = resolve(fixtureDir, 'golden.png');
  const metaPath = resolve(fixtureDir, 'meta.json');
  const fePngOut = resolve(fixtureDir, 'pyr3-fe-render.png');
  const feDiffOut = resolve(fixtureDir, 'pyr3-fe-diff.png');

  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as FixtureMeta;
  const capture = JSON.parse(readFileSync(capturePath, 'utf8')) as CapturePayload;

  const dimsMatch = capture.width === meta.width && capture.height === meta.height;
  if (!dimsMatch) {
    // FE quick-mode QUICK_MAX_DIM=1024 cap downscales >1024 fixtures.
    // Downscale the golden to match FE-capture dims for the R compare.
    // Flag in the output so the HTML can mark this as sub-native FE.
    console.error(`[pyr3-018-fe-collect] note: ${fixtureId} captured at ${capture.width}×${capture.height} (FE cap), golden is ${meta.width}×${meta.height} — golden will be nearest-neighbor downscaled for R-compare`);
  }

  // 1. Decode the FE RGBA bytes for R-compare.
  const feRgba = new Uint8Array(Buffer.from(capture.rgba_b64, 'base64'));
  const expectedBytes = capture.width * capture.height * 4;
  if (feRgba.length !== expectedBytes) {
    throw new Error(`RGBA byte mismatch: got ${feRgba.length}, expected ${expectedBytes}`);
  }

  // 2. Save the PNG (from the data URL) for the verify HTML.
  const dataUrlPrefix = 'data:image/png;base64,';
  if (!capture.png_dataurl.startsWith(dataUrlPrefix)) {
    throw new Error(`png_dataurl missing expected prefix`);
  }
  const pngBuf = Buffer.from(capture.png_dataurl.slice(dataUrlPrefix.length), 'base64');
  writeFileSync(fePngOut, pngBuf);

  // 3. Load golden PNG, downscale if FE captured at sub-native dims, compute R.
  const goldenPng = PNG.sync.read(readFileSync(goldenPath));
  const goldenRgbaNative = new Uint8Array(goldenPng.data.buffer, goldenPng.data.byteOffset, goldenPng.data.byteLength);
  const goldenRgba = dimsMatch
    ? goldenRgbaNative
    : nearestDownscale(goldenRgbaNative, meta.width, meta.height, capture.width, capture.height);

  const R = meanAbsDiffRgba(feRgba, goldenRgba);
  const channel = perChannelDrift(feRgba, goldenRgba);
  const region = perRegionDrift(feRgba, goldenRgba, capture.width, capture.height);

  // Write the FE-vs-golden visibility-scaled diff PNG (×8) for the verify HTML.
  const diffBuf = renderDiffPng(feRgba, goldenRgba, capture.width, capture.height, 8);
  writeFileSync(feDiffOut, diffBuf);

  const result = {
    fixture: fixtureId,
    width: capture.width,
    height: capture.height,
    R: Number(R.toFixed(4)),
    perChannel: { r: Number(channel.r.toFixed(4)), g: Number(channel.g.toFixed(4)), b: Number(channel.b.toFixed(4)) },
    perRegion: {
      tl: Number(region.qTl.toFixed(4)),
      tr: Number(region.qTr.toFixed(4)),
      bl: Number(region.qBl.toFixed(4)),
      br: Number(region.qBr.toFixed(4)),
    },
    BE_baselineR: meta.baselineR ?? null,
    BE_thresholdR: meta.thresholdR ?? null,
    fePngBytes: pngBuf.length,
    fePngPath: fePngOut,
    feDiffPath: feDiffOut,
    feCapDownscaled: !dimsMatch,
    nativeDims: { width: meta.width, height: meta.height },
  };

  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
