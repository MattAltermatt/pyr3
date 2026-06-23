#!/usr/bin/env node
// scripts/smoke-bundled-cli.mjs — end-to-end smoke for build/.tmp/pyr3-render.cjs.
//
// Usage:
//   npm run bundle:cli render       # produce the bundle
//   npm run smoke:cli               # smoke it
//
// Two renders through the bundled CJS, both exercising the linkedom-backed
// .flame XML parse path (the load-bearing swap from #125 T2):
//   1. --long-edge 512 --quality 50   (fast, minimal-render budget)
//   2. --long-edge 1024 --quality 16  (1024 long-edge — the explicit flags that
//      replaced the removed `--preset quick` alias, #436; hero 1280×720 → 1024×576)
//
// Asserts each output is a valid PNG of the expected pixel dimensions. Not
// bit-exact — every invocation picks a fresh ISAAC seed and #123 stamps a
// per-render genome chunk into PNG metadata, so consecutive renders never
// match byte-for-byte. The smoke checks shape, not identity.
//
// The .pyr3.json load path uses src/serialize.ts (no linkedom dependency)
// and is covered by src/serialize.test.ts in the unit suite; #31's binary
// smoke will exercise it end-to-end with a real saved fixture.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');
const BUNDLE = join(REPO_ROOT, 'build', '.tmp', 'pyr3-render.cjs');
const FLAME_HERO = join(REPO_ROOT, 'public', 'fixtures', 'electricsheep.247.19679.flam3');
const TMP = join(REPO_ROOT, '.remember', 'tmp', 'smoke-bundled-cli');

function fail(msg) {
  console.error(`smoke FAIL: ${msg}`);
  process.exit(1);
}

function assertPng(path, expectedW, expectedH) {
  if (!existsSync(path)) fail(`expected output PNG missing: ${path}`);
  const size = statSync(path).size;
  if (size < 1000) fail(`PNG too small (${size} bytes): ${path}`);
  const png = PNG.sync.read(readFileSync(path));
  if (png.width !== expectedW || png.height !== expectedH) {
    fail(`PNG dims ${png.width}×${png.height} != expected ${expectedW}×${expectedH}: ${path}`);
  }
  return { size, w: png.width, h: png.height };
}

function runBundle(args) {
  execFileSync('node', [BUNDLE, ...args], { stdio: 'inherit' });
}

if (!existsSync(BUNDLE)) {
  fail(`bundle missing: ${BUNDLE}\n  run \`npm run bundle:cli render\` first`);
}
mkdirSync(TMP, { recursive: true });

console.log('1/2 .flame → PNG (long-edge 512)');
const out1 = join(TMP, 'flame-small.png');
runBundle(['--long-edge', '512', '--quality', '50', FLAME_HERO, out1]);
const r1 = assertPng(out1, 512, 288);
console.log(`    ✓ ${r1.w}×${r1.h}, ${r1.size} bytes`);

console.log('2/2 .flame → PNG (long-edge 1024)');
const out2 = join(TMP, 'flame-longedge-1024.png');
runBundle(['--long-edge', '1024', '--quality', '16', FLAME_HERO, out2]);
const r2 = assertPng(out2, 1024, 576);
console.log(`    ✓ ${r2.w}×${r2.h}, ${r2.size} bytes`);

console.log('\n✅ bundled CLI smoke green');
