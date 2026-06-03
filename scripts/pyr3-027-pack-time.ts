import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
const win = new Window();
(globalThis as { DOMParser: unknown }).DOMParser = win.DOMParser;
import { parseFlame } from '../src/flame-import.ts';
import { packXforms, packXformDistrib } from '../src/genome.ts';
const g = parseFlame(readFileSync('fixtures/electricsheep.247.19679.flam3','utf8')).genome;
function time(label: string, fn: () => void, n = 200) {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) fn();
  console.log(`${label}: ${((performance.now() - t0) / n).toFixed(3)} ms/call`);
}
time('packXformDistrib', () => packXformDistrib(g));
time('packXforms      ', () => packXforms(g));
