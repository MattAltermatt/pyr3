#!/usr/bin/env node
// Render the v1.0 showcase set (55 fixtures from kotlin's
// `pyr3-kotlin/parity/showcase/v1.0-showcase.txt`) via pyr3 BE at
// --preset 4k. One-shot script; output lands in fixtures/showcase-v1.0/
// as `<id>.pyr3-4k.png`. Skips renders that already exist (re-run safe).
//
// Notes on the input list:
//  • Paths starting `/Users/matt/dev/MattAltermatt/pyr3/parity/...` are
//    stale (pre-kotlin-rename); rewrite to `pyr3-kotlin/parity/...`.
//  • Some lines carry a trailing `# comment` (e.g. "⚠ logged divergence").
//  • Empty lines + `#`-only lines are header comments.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const LIST = '/Users/matt/dev/MattAltermatt/pyr3-kotlin/parity/showcase/v1.0-showcase.txt';
const OUT_DIR = join(REPO, 'fixtures', 'showcase-v1.0');
const STALE_PREFIX = '/Users/matt/dev/MattAltermatt/pyr3/parity/';
const FIXED_PREFIX = '/Users/matt/dev/MattAltermatt/pyr3-kotlin/parity/';

if (!existsSync(LIST)) {
  console.error(`showcase list not found: ${LIST}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const lines = readFileSync(LIST, 'utf8').split('\n');
const fixtures = [];
for (const raw of lines) {
  const noComment = raw.split('#')[0].trim();
  if (!noComment) continue;
  let path = noComment;
  if (path.startsWith(STALE_PREFIX)) path = FIXED_PREFIX + path.slice(STALE_PREFIX.length);
  if (!path.endsWith('.flam3')) continue;
  if (!existsSync(path)) {
    console.error(`MISSING: ${path}`);
    continue;
  }
  const id = basename(path, '.flam3');
  fixtures.push({ id, sourcePath: path, outPath: join(OUT_DIR, `${id}.pyr3-4k.png`) });
}

console.error(`[showcase-v1.0] ${fixtures.length} fixtures from showcase list`);
const t0 = performance.now();
let rendered = 0, skipped = 0, failed = 0;
const failures = [];

for (let i = 0; i < fixtures.length; i++) {
  const fx = fixtures[i];
  const tag = `[${i + 1}/${fixtures.length}] ${fx.id}`;

  if (existsSync(fx.outPath) && statSync(fx.outPath).size > 0) {
    console.error(`${tag}  SKIP (exists)`);
    skipped++;
    continue;
  }

  const fxStart = performance.now();
  const r = spawnSync(
    'node',
    [
      '--import', 'tsx/esm',
      '--import', './bin/wgsl-loader-register.mjs',
      'bin/pyr3-render.ts',
      '--preset', '4k',
      fx.sourcePath,
      fx.outPath,
    ],
    { cwd: REPO, encoding: 'utf8', timeout: 180_000 },
  );
  const elapsed = Number(((performance.now() - fxStart) / 1000).toFixed(1));
  fx.renderSec = elapsed;

  if (r.status !== 0) {
    console.error(`${tag}  FAIL (${elapsed}s, exit=${r.status})`);
    if (r.stderr) console.error('  stderr:', r.stderr.trim().slice(0, 500));
    failures.push({ id: fx.id, source: fx.sourcePath, stderr: r.stderr });
    failed++;
    continue;
  }

  console.error(`${tag}  ${elapsed}s`);
  rendered++;
}

const totalSec = ((performance.now() - t0) / 1000).toFixed(1);
console.error('');
console.error(`Done: ${rendered} rendered, ${skipped} skipped, ${failed} failed, ${totalSec}s total`);

writeFileSync(
  join(OUT_DIR, '_manifest.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      count: fixtures.length,
      rendered, skipped, failed,
      totalSec: Number(totalSec),
      failures,
      fixtures: fixtures.map((f) => ({
        id: f.id,
        source: f.sourcePath,
        renderSec: f.renderSec ?? null,
      })),
    },
    null,
    2,
  ) + '\n',
);
console.error(`manifest: ${join(OUT_DIR, '_manifest.json')}`);
