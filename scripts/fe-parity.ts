#!/usr/bin/env -S node --experimental-strip-types
// FE parity helper — lead-driven, NOT a Vitest test.
//
// Pairs with src/parity.test.ts: BE path runs in CI via vitest; FE path is
// driven manually with chrome-devtools-mcp because Vitest can't host a real
// WebGPU browser. This script prints the share URL + step-by-step the lead
// follows in their chrome-devtools-mcp session, then computes R when the
// captured canvas bytes come back on stdin.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { encodeFlame } from '../src/url-codec';
import { meanAbsDiffRgba, perChannelDrift, perRegionDrift } from '../src/compare';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const [fixtureId, mode] = process.argv.slice(2);
  if (!fixtureId) {
    console.error('usage: node scripts/fe-parity.ts <fixture-id> [url | compare]');
    console.error('  url       (default) print the share URL + drive-from-MCP steps');
    console.error('  compare   read captured RGBA bytes on stdin, compute R vs golden');
    console.error('');
    console.error(`fixtures available: ${listFixtures().join(', ')}`);
    process.exit(1);
  }
  const fixtureDir = resolve(repoRoot, 'fixtures/flam3-goldens', fixtureId);
  const sourcePath = resolve(fixtureDir, `${fixtureId}.flam3`);
  const flameXml = readFileSync(sourcePath, 'utf8');
  const metaPath = resolve(fixtureDir, 'meta.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { width: number; height: number };
  const goldenBytes = decodePng(resolve(fixtureDir, 'golden.png'));

  if ((mode ?? 'url') === 'url') {
    const encoded = await encodeFlame(flameXml);
    const url = `http://localhost:5173/?flame=${encoded}`;
    console.log('# pyr3 FE parity — drive-from-MCP steps');
    console.log('');
    console.log(`## 1. Confirm dev server`);
    console.log('   npm run dev   # in a separate shell');
    console.log('');
    console.log(`## 2. Open the fixture URL in Chrome via chrome-devtools-mcp`);
    console.log('');
    console.log(`   ${url}`);
    console.log('');
    console.log(`## 3. Wait for render to complete (evaluate_script)`);
    console.log('');
    console.log("   await window.__pyr3LastHandle?.promise;");
    console.log('');
    console.log(`## 4. Capture canvas RGBA via evaluate_script`);
    console.log('');
    console.log('   const c = document.querySelector("canvas");');
    console.log(`   const ctx2d = new OffscreenCanvas(${meta.width}, ${meta.height}).getContext("2d");`);
    console.log('   ctx2d.drawImage(c, 0, 0);');
    console.log(`   const d = ctx2d.getImageData(0, 0, ${meta.width}, ${meta.height}).data;`);
    console.log('   // chunked base64 — spreading 1.9M bytes into String.fromCharCode(...) RangeErrors');
    console.log('   let s = "";');
    console.log('   for (let i = 0; i < d.length; i += 8192) s += String.fromCharCode(...d.subarray(i, i + 8192));');
    console.log('   btoa(s);');
    console.log('');
    console.log(`## 5. Pipe the base64 back into this script to compute R`);
    console.log('');
    console.log(`   echo '<base64-from-step-4>' | node scripts/fe-parity.ts ${fixtureId} compare`);
    console.log('');
    return;
  }

  if (mode === 'compare') {
    const b64 = readFileSync(0, 'utf8').trim();
    const fbytes = new Uint8Array(Buffer.from(b64, 'base64'));
    if (fbytes.length !== goldenBytes.length) {
      console.error(`fe-parity: byte-count mismatch (fe=${fbytes.length}, golden=${goldenBytes.length})`);
      console.error('did the captured canvas match the golden dimensions?');
      process.exit(1);
    }
    const R = meanAbsDiffRgba(fbytes, goldenBytes);
    const channel = perChannelDrift(fbytes, goldenBytes);
    const region = perRegionDrift(fbytes, goldenBytes, meta.width, meta.height);
    console.log(`[${fixtureId}] FE-R=${R.toFixed(2)}  perChannel(r=${channel.r.toFixed(2)} g=${channel.g.toFixed(2)} b=${channel.b.toFixed(2)})  perRegion(tl=${region.qTl.toFixed(2)} tr=${region.qTr.toFixed(2)} bl=${region.qBl.toFixed(2)} br=${region.qBr.toFixed(2)})`);
    return;
  }

  console.error(`unknown mode: ${mode}`);
  process.exit(1);
}

function listFixtures(): string[] {
  try {
    return readdirSync(resolve(repoRoot, 'fixtures/flam3-goldens'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function decodePng(path: string): Uint8Array {
  const png = PNG.sync.read(readFileSync(path));
  return new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
