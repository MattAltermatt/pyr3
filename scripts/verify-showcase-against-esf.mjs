#!/usr/bin/env node
// verify-showcase-against-esf.mjs — sanity-check that every flame in
// fixtures/showcase-v1.0/_manifest.json still exists in ESF's
// corpus/_index/index.json as kind=="genome".
//
// Run after every ESF Release bump (#55-style tag changes can silently
// cull showcase fixtures via dedup or recategorization). Exits non-zero
// on any missing fixture so this can gate a CI check later if needed.
//
// Usage:
//   node scripts/verify-showcase-against-esf.mjs [--esf-root <path>]
//
// Default ESF root: ../electric-sheep-fold

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

const args = process.argv.slice(2);
const esfIdx = args.indexOf('--esf-root');
const ESF_ROOT = esfIdx >= 0 ? args[esfIdx + 1] : resolve(REPO, '..', 'electric-sheep-fold');

const MANIFEST = join(REPO, 'fixtures', 'showcase-v1.0', '_manifest.json');
const INDEX = join(ESF_ROOT, 'corpus', '_index', 'index.json');

console.log(`verifying showcase fixtures against ESF`);
console.log(`  manifest: ${MANIFEST}`);
console.log(`  index:    ${INDEX}`);

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const want = manifest.fixtures.map((f) => {
  const [, gen, id] = f.id.match(/^electricsheep\.(\d+)\.(\d+)$/) ?? [];
  return { gen: Number(gen), sheep_id: Number(id), source: f.id };
});

const index = JSON.parse(readFileSync(INDEX, 'utf8'));
// Build a Set for O(1) lookups instead of O(N) array scans 55× over a
// 52k-entry index.
const have = new Map();
for (const r of index.genomes) {
  if (r.kind === 'genome') {
    have.set(`${r.gen}/${r.sheep_id}`, r);
  }
}

console.log(`  showcase fixtures: ${want.length}`);
console.log(`  genome-only entries in index: ${have.size}`);
console.log('');

const missing = [];
const HERO_GEN = 247;
const HERO_ID = 19679;
let heroPresent = false;

for (const w of want) {
  const key = `${w.gen}/${w.sheep_id}`;
  if (!have.has(key)) {
    missing.push(w);
  }
  if (w.gen === HERO_GEN && w.sheep_id === HERO_ID) heroPresent = true;
}

if (missing.length === 0) {
  console.log(`✅ all ${want.length} showcase fixtures present in ESF v${index._schema_version} as kind=="genome"`);
  if (heroPresent) {
    console.log(`✅ hero (${HERO_GEN}/${HERO_ID}) present`);
  } else {
    console.log(`⚠️  hero (${HERO_GEN}/${HERO_ID}) NOT in showcase manifest (separate concern — bare-root forward depends on it)`);
  }
  process.exit(0);
}

console.log(`❌ ${missing.length} fixture(s) MISSING from the genome-only set:`);
for (const m of missing) console.log(`     ${m.source}`);
if (!heroPresent) {
  console.log(`❌ hero (${HERO_GEN}/${HERO_ID}) is among the missing — bare-root forward will break`);
}
process.exit(1);
