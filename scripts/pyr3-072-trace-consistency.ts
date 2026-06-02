// #72 — check the GPU walker-0 trace for self-consistency under CPU f64 math.
// The trace logs (pick, pa=affine-out, pv_pre, pv=after-post) per iter.
// Checks per iter:
//   (1) CPU variation+post applied to GPU's pa  ?= GPU's pv         [variation/post math]
//   (2) CPU affine[next pick] applied to GPU's pv ?= GPU's pa[next] [affine + trajectory commit]
// First/worst divergence localizes any GPU-vs-CPU math discrepancy.

import { readFileSync } from 'node:fs';
import { type Genome, type Xform } from '../src/genome';
import { parseGenomeText, installWebGPUHost } from '../bin/host';

installWebGPUHost();
const EPS = 1e-10, PI = Math.PI;

const flame = '/Users/matt/dev/MattAltermatt/electric-sheep-fold/corpus/248/20000/electricsheep.248.25703.flam3';
const g: Genome = parseGenomeText(readFileSync(flame, 'utf8'), flame).genome;

// CPU variation (matches WGSL var_* exactly; f64).
function variation(idx: number, x: number, y: number, w: number): [number, number] {
  switch (idx) {
    case 0: return [w * x, w * y];
    case 2: { const r2 = x * x + y * y + EPS; const inv = w / r2; return [x * inv, y * inv]; }
    case 8: { const phi = Math.atan2(x, y); const r = Math.sqrt(x * x + y * y); const a = w * (phi / PI); return [a * Math.sin(PI * r), a * Math.cos(PI * r)]; }
    case 16: { const cc = 0 * 0 + EPS, ff = 0 * 0 + EPS; const b = 0, e = 2.11373; /* xform6 b=0,e=2.11,c=0,f=0 */ return [w * (x + b * Math.sin(y / cc)), w * (y + e * Math.sin(x / ff))]; }
    default: throw new Error('var ' + idx);
  }
}
// Variation chain + post applied to an ALREADY-affine-transformed point (pa).
function varPost(xf: Xform, ax: number, ay: number): [number, number] {
  let vx = 0, vy = 0;
  for (const v of xf.variations) { const [ox, oy] = variation(v.index, ax, ay, v.weight); vx += ox; vy += oy; }
  if (xf.post) { const p = xf.post; return [p.a * vx + p.b * vy + p.c, p.d * vx + p.e * vy + p.f]; }
  return [vx, vy];
}
function affineOnly(xf: Xform, x: number, y: number): [number, number] {
  return [xf.a * x + xf.b * y + xf.c, xf.d * x + xf.e * y + xf.f];
}

// Parse the trace.
const lines = readFileSync('/tmp/pyr3-trace-25703.txt', 'utf8').trim().split('\n');
const num = (l: string, k: string) => { const m = l.match(new RegExp(k + '=(-?[0-9.eE+]+)')); return m ? +m[1] : NaN; };
const rows = lines.map((l) => ({ pick: num(l, 'pick'), pax: num(l, 'pax'), pay: num(l, 'pay'), pvx: num(l, ' pvx'), pvy: num(l, ' pvy') }));

let worstVar = 0, worstVarIter = -1, worstAff = 0, worstAffIter = -1;
let firstVarBad = -1, firstAffBad = -1;
const TOL = 1e-3; // generous: jitter (~1e-7 rel) + f32 noise are far below this
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const xf = g.xforms[r.pick]!;
  // (1) variation+post check: CPU varPost(pa) vs GPU pv (pa is already affine-transformed).
  const [cvx, cvy] = varPost(xf, r.pax, r.pay);
  const vErr = Math.hypot(cvx - r.pvx, cvy - r.pvy) / Math.max(Math.hypot(r.pvx, r.pvy), 1e-6);
  if (vErr > worstVar) { worstVar = vErr; worstVarIter = i; }
  if (vErr > TOL && firstVarBad < 0) firstVarBad = i;
  // (2) affine-of-next-pick check: CPU affine(pv[i]) vs GPU pa[i+1].
  if (i + 1 < rows.length) {
    const nx = g.xforms[rows[i + 1].pick]!;
    const [cax, cay] = affineOnly(nx, r.pvx, r.pvy);
    const aErr = Math.hypot(cax - rows[i + 1].pax, cay - rows[i + 1].pay) / Math.max(Math.hypot(rows[i + 1].pax, rows[i + 1].pay), 1e-6);
    if (aErr > worstAff) { worstAff = aErr; worstAffIter = i; }
    if (aErr > TOL && firstAffBad < 0) firstAffBad = i;
  }
}

console.log(`[#72 trace-consistency] ${rows.length} GPU walker-0 iters, CPU f64 replay`);
console.log(`  (1) variation+post: CPU(pa) vs GPU pv   worst rel err = ${worstVar.toExponential(3)} @iter ${worstVarIter}   firstBad(>1e-3)=${firstVarBad}`);
console.log(`  (2) affine[next](pv) vs GPU pa[next]    worst rel err = ${worstAff.toExponential(3)} @iter ${worstAffIter}   firstBad(>1e-3)=${firstAffBad}`);
if (firstAffBad >= 0) {
  const i = firstAffBad;
  console.log(`\n  FIRST affine divergence @iter ${i}: pick[i]=${rows[i].pick} pv=(${rows[i].pvx},${rows[i].pvy})  next pick=${rows[i + 1].pick}`);
  const nx = g.xforms[rows[i + 1].pick]!;
  console.log(`    CPU affine(pv) = ${JSON.stringify(affineOnly(nx, rows[i].pvx, rows[i].pvy))}`);
  console.log(`    GPU pa[i+1]    = (${rows[i + 1].pax}, ${rows[i + 1].pay})`);
}
delete (globalThis as { navigator?: unknown }).navigator;
process.exit(0);
