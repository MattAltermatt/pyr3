#!/usr/bin/env node
// Render the v1.0 showcase set via pyr3 BE at 4K (--long-edge 3840 --quality 200,
// #436 — was the removed `--preset 4k` alias). One-shot script;
// output lands in fixtures/showcase-v1.0/ as `<id>.pyr3-4k.png`. Skips renders
// that already exist (re-run safe).
//
// Fixture list + source paths come from the committed
// fixtures/showcase-v1.0/_manifest.json. Each `source` is a path relative to
// the electric-sheep-fold corpus root (a sibling checkout by default; override
// with the ESF_ROOT env var).

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const OUT_DIR = join(REPO, 'fixtures', 'showcase-v1.0');
const MANIFEST = join(OUT_DIR, '_manifest.json');
const ESF_ROOT = process.env.ESF_ROOT || resolve(REPO, '..');

if (!existsSync(MANIFEST)) {
  console.error(`manifest not found: ${MANIFEST}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const fixtures = [];
for (const fx of manifest.fixtures ?? []) {
  if (!fx.source) continue;
  const sourcePath = resolve(ESF_ROOT, fx.source);
  if (!existsSync(sourcePath)) {
    console.error(`MISSING: ${fx.source} (resolved: ${sourcePath})`);
    continue;
  }
  fixtures.push({
    id: fx.id,
    source: fx.source,
    sourcePath,
    outPath: join(OUT_DIR, `${fx.id}.pyr3-4k.png`),
  });
}

console.error(`[showcase-v1.0] ${fixtures.length} fixtures from manifest`);
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
      // #436 — explicit flags replace the removed `--preset 4k` alias. These
      // reproduce the 4K tier byte-for-byte: customSpec(3840, 200) === the old
      // 4k preset spec {3840, 200, oversample 1, force, floor}.
      '--long-edge', '3840',
      '--quality', '200',
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
    failures.push({ id: fx.id, source: fx.source, stderr: r.stderr });
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
  MANIFEST,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      count: fixtures.length,
      rendered, skipped, failed,
      totalSec: Number(totalSec),
      failures,
      fixtures: fixtures.map((f) => ({
        id: f.id,
        source: f.source,
        renderSec: f.renderSec ?? null,
      })),
    },
    null,
    2,
  ) + '\n',
);
console.error(`manifest: ${MANIFEST}`);
