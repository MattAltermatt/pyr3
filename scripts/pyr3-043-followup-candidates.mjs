#!/usr/bin/env node
// #43 follow-up — find ~20 corpus flames matching the predictor classes of
// the 4 known tier-2 residuals (post-#43 scale-relative jitter). No rendering;
// just XML scan + filter.
//
// Predictor classes (each modeled on one of the 4 known tier-2 cases):
//   A — 25703 class:    disc-variation + non-unity xaos + supersample >= 4
//                       + low scale (< 150)
//   B — 244.82986:      very high brightness (>= 80) + gamma >= 3
//   C — 244.42746:      brightness >= 20 + gamma >= 4  (high-bri × high-γ)
//   D — coverage.248.02226: brightness 20-30 + gamma 3.0-3.5 + highlight_power = 1
//   E — wildcard:       gamma >= 5  OR  brightness >= 100 (outliers)
//
// Output: top N per class (default 5) as a JSONL list, plus a human-readable
// summary table.
//
// Usage:
//   node scripts/pyr3-043-followup-candidates.mjs                 # default N=5/class
//   node scripts/pyr3-043-followup-candidates.mjs --per-class=10
//   node scripts/pyr3-043-followup-candidates.mjs --esf-root=/path/to/electric-sheep-fold

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const OUT_DIR = join(REPO, '.remember', 'tmp', 'issue-43-followup');
const OUT_JSONL = join(OUT_DIR, 'candidates.jsonl');

function parseArgs(argv) {
  let perClass = 5;
  let esfRoot = '/Users/matt/dev/MattAltermatt/electric-sheep-fold';
  for (const a of argv.slice(2)) {
    if (a.startsWith('--per-class=')) perClass = parseInt(a.slice('--per-class='.length), 10);
    else if (a.startsWith('--esf-root=')) esfRoot = a.slice('--esf-root='.length);
  }
  return { perClass, esfRoot };
}

function attr(xml, name) {
  const m = xml.match(new RegExp(`${name}="([^"]+)"`));
  return m ? m[1] : null;
}

function attrFloat(xml, name) {
  const v = attr(xml, name);
  return v === null ? null : parseFloat(v);
}

function flameFeatures(xmlText) {
  // Top-level <flame ...> attributes
  const flameOpen = xmlText.match(/<flame\s[^>]*>/);
  if (!flameOpen) return null;
  const flame = flameOpen[0];

  const brightness = attrFloat(flame, 'brightness') ?? 4.0;
  const gamma = attrFloat(flame, 'gamma') ?? 4.0;
  const highlightPower = attrFloat(flame, 'highlight_power') ?? -1;
  const supersample = attrFloat(flame, 'supersample') ?? 1;
  const scale = attrFloat(flame, 'scale') ?? 100;
  const quality = attrFloat(flame, 'quality') ?? 16;
  const sizeAttr = attr(flame, 'size') ?? '1024 1024';
  const [w, h] = sizeAttr.split(/\s+/).map(parseFloat);

  // Walk <xform .../> attrs for variation usage + non-unity xaos
  let hasDisc = false;
  let hasXaos = false;
  let xformCount = 0;
  const xformOpens = xmlText.match(/<xform\s[^>]*\/?>/g) ?? [];
  for (const x of xformOpens) {
    xformCount++;
    if (/\bdisc="([^"]+)"/.test(x)) {
      const v = parseFloat(x.match(/\bdisc="([^"]+)"/)[1]);
      if (v > 0) hasDisc = true;
    }
    // xaos = "a b c ..." — non-unity if any entry differs from 1
    const xm = x.match(/\bchaos="([^"]+)"/) ?? x.match(/\bxaos="([^"]+)"/);
    if (xm) {
      const vals = xm[1].split(/\s+/).map(parseFloat);
      if (vals.some((v) => Math.abs(v - 1) > 1e-6)) hasXaos = true;
    }
  }

  return { brightness, gamma, highlightPower, supersample, scale, quality, w, h, hasDisc, hasXaos, xformCount };
}

function parseSheep(path) {
  // file name: electricsheep.<gen>.<id>.flam3
  const m = path.match(/electricsheep\.(\d+)\.(\d+)\.flam3$/);
  if (!m) return null;
  const gen = parseInt(m[1], 10);
  const id = parseInt(m[2], 10);
  let xml;
  try { xml = readFileSync(path, 'utf8'); } catch { return null; }
  const feat = flameFeatures(xml);
  if (!feat) return null;
  return { gen, id, ...feat };
}

function walkCorpus(esfRoot) {
  const corpusDir = join(esfRoot, 'corpus');
  if (!statSync(corpusDir, { throwIfNoEntry: false })) {
    throw new Error(`no corpus dir at ${corpusDir}`);
  }
  const all = [];
  const gens = readdirSync(corpusDir).filter((n) => /^\d+$/.test(n)).sort();
  for (const gen of gens) {
    const genDir = join(corpusDir, gen);
    const buckets = readdirSync(genDir).filter((n) => /^\d+$/.test(n));
    for (const bucket of buckets) {
      const bDir = join(genDir, bucket);
      const sheep = readdirSync(bDir).filter((n) => n.endsWith('.flam3'));
      for (const s of sheep) {
        const item = parseSheep(join(bDir, s));
        if (item) all.push(item);
      }
    }
  }
  return all;
}

const CLASSES = {
  A: { label: '25703-class:  disc + xaos + ss≥4 + scale<150',  filter: (f) => f.hasDisc && f.hasXaos && f.supersample >= 4 && f.scale < 150 },
  B: { label: '244.82986:    very high brightness (≥80) + γ≥3', filter: (f) => f.brightness >= 80 && f.gamma >= 3 },
  C: { label: '244.42746:    brightness ≥20 + γ≥4',             filter: (f) => f.brightness >= 20 && f.gamma >= 4 },
  D: { label: 'cov.248.02226: bri 20-30 + γ 3.0-3.5 + hlp=1',   filter: (f) => f.brightness >= 20 && f.brightness <= 30 && f.gamma >= 3.0 && f.gamma <= 3.5 && f.highlightPower === 1 },
  E: { label: 'WILDCARD:     γ≥5  OR  brightness ≥100',         filter: (f) => f.gamma >= 5 || f.brightness >= 100 },
};

function selectTopN(all, n) {
  const selected = {};
  for (const [klass, def] of Object.entries(CLASSES)) {
    const matches = all.filter(def.filter);
    matches.sort((a, b) => (b.gen * 1e6 + b.id) - (a.gen * 1e6 + a.id));
    selected[klass] = { label: def.label, totalMatches: matches.length, top: matches.slice(0, n) };
  }
  return selected;
}

function main() {
  const { perClass, esfRoot } = parseArgs(process.argv);
  console.log(`[candidates] walking corpus at ${esfRoot} (this scans ~52K XML files, ~30-60s)…`);
  const t0 = Date.now();
  const all = walkCorpus(esfRoot);
  console.log(`[candidates] scanned ${all.length} flames in ${((Date.now()-t0)/1000).toFixed(1)}s`);
  console.log('');

  const selected = selectTopN(all, perClass);

  mkdirSync(OUT_DIR, { recursive: true });
  const lines = [];
  for (const [k, def] of Object.entries(selected)) {
    console.log(`\n### class ${k} — ${def.label}   (${def.totalMatches} total matches in corpus, showing top ${perClass})`);
    console.log('  gen.id           bri    γ     hlp   ss   scale     w×h         hasDisc  hasXaos  xforms');
    console.log('  ----------       -----  ----  ----  ---  ------    ----------  -------  -------  ------');
    for (const f of def.top) {
      const id = `${f.gen}.${String(f.id).padStart(5, '0')}`;
      const row = `  ${id.padEnd(15)}  ${String(f.brightness).padEnd(5)}  ${String(f.gamma).padEnd(4)}  ${String(f.highlightPower).padEnd(4)}  ${String(f.supersample).padEnd(3)}  ${String(f.scale).padEnd(7)}   ${(f.w+'×'+f.h).padEnd(10)}  ${String(f.hasDisc).padEnd(6)}   ${String(f.hasXaos).padEnd(6)}   ${f.xformCount}`;
      console.log(row);
      lines.push(JSON.stringify({ class: k, ...f }));
    }
  }

  writeFileSync(OUT_JSONL, lines.join('\n') + '\n');
  console.log(`\n[candidates] wrote ${lines.length} candidate records to ${OUT_JSONL}`);
}

main();
