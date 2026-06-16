#!/usr/bin/env -S node --experimental-strip-types
// pyr3 — one-shot .flam3 → .pyr3.json converter.
//
// Usage:
//   npx tsx bin/flame-to-json.ts <in.flam3> <out.json>
//
// Loads a .flam3 via pyr3's flame-import, runs it through genomeToJson,
// writes the result. Logs droppedVariations + ignoredFields counts so
// the conversion fidelity is auditable.
//
// Used by the reference/ corpus build (see reference/<id>/source.flam3
// → reference/<id>/pyr3.json). Standalone CLI; no browser, no GPU.

import { readFileSync, writeFileSync } from 'node:fs';
import { DOMParser } from 'linkedom';
import { parseFlame } from '../src/flame-import';
import { genomeToJson } from '../src/serialize';

// #320 — linkedom DOMParser shim, matching the production host (bin/host.ts).
(globalThis as { DOMParser: unknown }).DOMParser = DOMParser;

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error('usage: tsx bin/flame-to-json.ts <in.flam3> <out.json>');
  process.exit(1);
}

const xml = readFileSync(inPath, 'utf8');
const { genome, report } = parseFlame(xml);
const json = genomeToJson(genome);
writeFileSync(outPath, JSON.stringify(json, null, 2));

console.log(
  `[flame-to-json] wrote ${outPath} (${report.droppedVariations.length} dropped, ${report.ignoredFields.length} ignored)`,
);
if (report.droppedVariations.length) {
  const groups = new Map<string, number>();
  for (const d of report.droppedVariations) groups.set(d.name, (groups.get(d.name) ?? 0) + 1);
  console.log(`  dropped: ${[...groups].map(([n, c]) => `${n}×${c}`).join(', ')}`);
}
if (report.ignoredFields.length) {
  const groups = new Set(report.ignoredFields.map((i) => i.field));
  console.log(`  ignored: ${[...groups].join(', ')}`);
}
