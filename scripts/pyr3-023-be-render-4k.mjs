#!/usr/bin/env node
// PYR3-023 BE 4K render — produces a kotlin-v1.1-`SHOWCASE_4K`-matched
// render (3840 long-edge, oversample=1, SPP cap 200). Pre-processes the
// .flame: rewrite size/scale/oversample/quality, then invoke
// bin/pyr3-render.ts via the standard `npm run render` pipeline.
//
// Long-edge was 4096 pre-v0.16, mismatching kotlin's `SHOWCASE_4K`
// preset (`pyr3-kotlin/cli/.../Preset.kt:39-49` = 3840). The 3840
// alignment is a prerequisite for the BE 4K parity rig (PYR3-023) and
// for the 248.22289 BE divergence probe (PYR3-024) — without it, the
// pyr3 PNG vs kotlin JPG comparison needs a nearest-neighbor downscale
// that contributes its own aliasing-induced R.
//
// Usage:
//   node scripts/pyr3-023-be-render-4k.mjs <input.flam3> <output.png>

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const FULL_MAX_DIM = 3840;
const FULL_MAX_SPP = 200;
const FULL_MAX_OVERSAMPLE = 1;

const [, , inputArg, outputArg] = process.argv;
if (!inputArg || !outputArg) {
  console.error('usage: pyr3-023-be-render-4k.mjs <input.flam3> <output.png>');
  process.exit(1);
}
const input = resolve(inputArg);
const output = resolve(outputArg);

const text = readFileSync(input, 'utf8');

// Pull the <flame ... attributes ...> opening tag.
const m = text.match(/<flame\b[^>]*>/);
if (!m) {
  console.error('no <flame> tag in input');
  process.exit(1);
}
const flameTag = m[0];

function getAttr(name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`);
  const m2 = flameTag.match(re);
  return m2 ? m2[1] : null;
}

const sizeStr = getAttr('size');
if (!sizeStr) { console.error('flame has no size attr'); process.exit(1); }
const [declW, declH] = sizeStr.trim().split(/\s+/).map(Number);
if (!Number.isFinite(declW) || !Number.isFinite(declH)) { console.error('bad size'); process.exit(1); }
const declScale = Number(getAttr('scale') ?? '1');
const declQuality = Number(getAttr('quality') ?? '100');

const maxDecl = Math.max(declW, declH);
const sizeScale = FULL_MAX_DIM / maxDecl;
const targetW = Math.max(1, Math.round(declW * sizeScale));
const targetH = Math.max(1, Math.round(declH * sizeScale));
const newScale = declScale * sizeScale;
const newQuality = Math.min(declQuality, FULL_MAX_SPP);

console.error(
  `[pyr3-023-be-4k] ${basename(input)}: ${declW}x${declH}@scale=${declScale} q=${declQuality} ` +
  `→ ${targetW}x${targetH}@scale=${newScale.toFixed(3)} q=${newQuality} oversample=${FULL_MAX_OVERSAMPLE}`,
);

function setAttr(tag, name, value) {
  const re = new RegExp(`\\b${name}\\s*=\\s*"[^"]*"`);
  if (tag.match(re)) {
    return tag.replace(re, `${name}="${value}"`);
  }
  // Insert before the closing > (handles both `>` and `/>`).
  return tag.replace(/>$/, ` ${name}="${value}">`);
}

let newTag = flameTag;
newTag = setAttr(newTag, 'size', `${targetW} ${targetH}`);
newTag = setAttr(newTag, 'scale', String(newScale));
newTag = setAttr(newTag, 'supersample', String(FULL_MAX_OVERSAMPLE));
newTag = setAttr(newTag, 'quality', String(newQuality));

const newText = text.replace(flameTag, newTag);

const td = mkdtempSync(join(tmpdir(), 'pyr3-023-'));
const tweakedPath = join(td, `${basename(input, '.flam3')}.4k.flam3`);
writeFileSync(tweakedPath, newText);
console.error(`[pyr3-023-be-4k] tweaked .flame: ${tweakedPath}`);

const repoRoot = resolve(import.meta.dirname, '..');
const start = performance.now();
const result = spawnSync(
  'node',
  ['--import', 'tsx/esm', '--import', './bin/wgsl-loader-register.mjs', 'bin/pyr3-render.ts', tweakedPath, output],
  { cwd: repoRoot, stdio: 'inherit' },
);
const elapsedSec = (performance.now() - start) / 1000;
console.error(`[pyr3-023-be-4k] BE 4K render of ${basename(input)}: ${elapsedSec.toFixed(2)}s (exit=${result.status})`);
if (result.status !== 0) process.exit(result.status ?? 1);

// Emit one-line JSON for results collection.
const out = {
  fixture: basename(input, '.flam3').replace(/^electricsheep\./, ''),
  beWallClockSec: Number(elapsedSec.toFixed(2)),
  beDims: `${targetW}x${targetH}`,
  beQuality: newQuality,
  bePngPath: output,
};
console.log(JSON.stringify(out));
