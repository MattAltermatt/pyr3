// #72 — CPU chaos coverage oracle: f64 vs f32, SAME RNG sequence.
// Isolates arithmetic precision as the lever for the 248.25703 coverage deficit.
//
// Parses the genome with pyr3's own parser (exact), then replicates the chaos
// iteration + projection in JS. Runs twice — f64 (Number) and f32 (Math.fround
// after each op) — driven by an IDENTICAL RNG stream, so the only difference is
// precision. Reports distinct-bucket coverage for each.
//
//   f64 >> f32  ⇒ precision IS the lever → engine-precision-drift wall (unfixable on GPU f32)
//   f64 ≈ f32   ⇒ precision is NOT the lever → a real pyr3 bug remains (fixable)
//
// Usage: node --import tsx/esm --import ./bin/wgsl-loader-register.mjs \
//          scripts/pyr3-072-precision-oracle.ts <flamePath> [walkers] [itersPerWalker]

import { readFileSync } from 'node:fs';
import { type Genome, type Xform } from '../src/genome';
import { packXformDistrib, CHOOSE_XFORM_GRAIN, CHOOSE_XFORM_GRAIN_M1, MAX_XFORMS } from '../src/genome';
import { newIsaacState, irandinit, isaacIrand, RANDSIZ } from '../src/isaac';
import { parseGenomeText, installWebGPUHost } from '../bin/host';

installWebGPUHost();

const u32 = (x: number) => x >>> 0;
// pyr3's exact per-walker ISAAC seeding (packIsaacStates: PCG32 → randrsl → irandinit).
function makeIsaacRng(w: number, globalSeed: number): () => number {
  const st = newIsaacState();
  let pcg = u32(globalSeed ^ u32(w * 2654435761 + 1));
  for (let k = 0; k < 4; k++) pcg = u32(Math.imul(pcg, 747796405) + 2891336453);
  for (let i = 0; i < RANDSIZ; i++) {
    const s = pcg;
    pcg = u32(Math.imul(pcg, 747796405) + 2891336453);
    const shift = u32((s >>> 28) + 4);
    const word = u32(Math.imul(u32((s >>> shift) ^ s), 277803737));
    st.randrsl[i] = u32((word >>> 22) ^ word);
  }
  irandinit(st, true);
  return () => isaacIrand(st) / 4294967296; // [0,1)
}

const EPS = 1e-10, PI = Math.PI, TAU = 2 * Math.PI, FUSE = 200, WJIT = 1e-7;

// mulberry32 — deterministic, mode-independent RNG (same stream for f64 & f32).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RFn = (x: number) => number;

// Build flam3-canonical per-prev-xform cumulative pick rows (weight × xaos).
function buildPickRows(g: Genome): number[][] {
  const n = g.xforms.length;
  const rows: number[][] = [];
  const mk = (xi: number): number[] => {
    const cum: number[] = []; let s = 0;
    for (let j = 0; j < n; j++) {
      const m = xi >= 0 ? (g.xforms[xi]!.xaos?.[j] ?? 1.0) : 1.0;
      s += g.xforms[j]!.weight * m;
      cum.push(s);
    }
    return cum;
  };
  for (let i = 0; i < n; i++) rows.push(mk(i));
  rows.push(mk(-1)); // fallback row (prev = -1)
  return rows;
}
function pick(cum: number[], u: number): number {
  const target = u * cum[cum.length - 1]!;
  for (let j = 0; j < cum.length; j++) if (target < cum[j]!) return j;
  return cum.length - 1;
}

// Apply one xform (affine → variation sum → post). R = precision rounding.
function applyXform(x: Xform, px: number, py: number, R: RFn, rng: () => number): [number, number] {
  const ax = R(R(R(x.a * px) + R(x.b * py)) + x.c);
  const ay = R(R(R(x.d * px) + R(x.e * py)) + x.f);
  let vx = 0, vy = 0;
  for (const v of x.variations) {
    const w = v.weight;
    let ox = 0, oy = 0;
    switch (v.index) {
      case 0: ox = R(w * ax); oy = R(w * ay); break;                       // linear
      case 2: {                                                             // spherical
        const r2 = R(R(R(ax * ax) + R(ay * ay)) + EPS);
        const inv = R(w / r2);
        ox = R(ax * inv); oy = R(ay * inv); break;
      }
      case 8: {                                                            // disc
        const phi = R(Math.atan2(ax, ay));
        const r = R(Math.sqrt(R(R(ax * ax) + R(ay * ay))));
        const amp = R(w * R(phi / PI));
        const pr = R(PI * r);
        ox = R(amp * R(Math.sin(pr))); oy = R(amp * R(Math.cos(pr))); break;
      }
      case 13: {                                                           // julia
        const phi = R(Math.atan2(ax, ay));
        const theta = R(R(phi * 0.5) + (rng() < 0.5 ? 0 : PI));
        const r = R(Math.sqrt(R(Math.sqrt(R(R(ax * ax) + R(ay * ay))))));
        const wr = R(w * r);
        ox = R(wr * R(Math.cos(theta))); oy = R(wr * R(Math.sin(theta))); break;
      }
      case 16: {                                                           // waves
        const cc = R(R(x.c * x.c) + EPS), ff = R(R(x.f * x.f) + EPS);
        const wx = R(ax + R(x.b * R(Math.sin(R(ay / cc)))));
        const wy = R(ay + R(x.e * R(Math.sin(R(ax / ff)))));
        ox = R(w * wx); oy = R(w * wy); break;
      }
      default: throw new Error(`oracle: variation index ${v.index} not implemented`);
    }
    vx = R(vx + ox); vy = R(vy + oy);
  }
  if (x.post) {
    const p = x.post;
    const nx = R(R(R(p.a * vx) + R(p.b * vy)) + p.c);
    const ny = R(R(R(p.d * vx) + R(p.e * vy)) + p.f);
    vx = nx; vy = ny;
  }
  return [vx, vy];
}

// Dawn flushes f32 subnormals to zero; smallest effective magnitude ≈ 1e-30
// (reference-dawn-f32-ftz-cliff). f32ftz mode simulates that.
const FTZ = 1e-30;
function froundFtz(x: number): number {
  const v = Math.fround(x);
  return Math.abs(v) < FTZ ? 0 : v;
}

function runChaos(g: Genome, mode: 'f64' | 'f32' | 'f32ftz', nWalkers: number, nIters: number, seed: number, pickMode: 'scan' | 'grain' = 'scan', retry: 'none' | 'pyr3' | 'flam3' = 'none', rngKind: 'mulberry' | 'isaac' = 'mulberry'): { nonzero: number; samples: number } {
  const R: RFn = mode === 'f32' ? Math.fround : mode === 'f32ftz' ? froundFtz : (x) => x;
  // pyr3's real GPU pick path: 14-bit GRAIN table from packXformDistrib.
  const grain = pickMode === 'grain' ? new Uint32Array(packXformDistrib(g)) : null;
  const grainPick = (prev: number, u: number): number => {
    const row = prev >= 0 ? prev : MAX_XFORMS;
    return grain![row * CHOOSE_XFORM_GRAIN + (Math.floor(u * CHOOSE_XFORM_GRAIN) & CHOOSE_XFORM_GRAIN_M1)]!;
  };
  const oversample = Math.max(1, Math.floor(g.oversample ?? 1));
  const W = (g.size?.width ?? 1024) * oversample;
  const H = (g.size?.height ?? 1024) * oversample;
  const scale = R(g.scale * oversample);
  const rot = R(((g.rotate ?? 0) * PI) / 180);
  const cosR = R(Math.cos(rot)), sinR = R(Math.sin(rot));
  const cx = g.cx ?? 0, cy = g.cy ?? 0;
  const rows = buildPickRows(g);
  const fxf = process.env.NOFINAL === '1' ? undefined : (g as unknown as { finalxform?: Xform }).finalxform;

  const grid = new Uint8Array(W * H);
  let nonzero = 0, samples = 0;
  const shared = mulberry32(seed);

  for (let wkr = 0; wkr < nWalkers; wkr++) {
    // isaac: pyr3's per-walker independent stream; mulberry: one shared stream.
    const rng = rngKind === 'isaac' ? makeIsaacRng(wkr, seed) : shared;
    let px = R(rng() * 2 - 1), py = R(rng() * 2 - 1);
    let prev = -1;
    let consec = 0;
    const total = nIters + FUSE;
    for (let it = 0; it < total; it++) {
      const fn = grain ? grainPick(prev, rng()) : pick(prev >= 0 ? rows[prev]! : rows[rows.length - 1]!, rng());
      const [vx, vy] = applyXform(g.xforms[fn]!, px, py, R, rng);

      // Bad-value handling (flam3 badvalue: NaN or |x|>1e10).
      if (retry !== 'none') {
        const bad = !Number.isFinite(vx) || !Number.isFinite(vy) || Math.abs(vx) > 1e10 || Math.abs(vy) > 1e10;
        if (bad) {
          const rx = R(rng() * 2 - 1), ry = R(rng() * 2 - 1); // reseed [-1,1]
          consec++;
          if (consec < 5) {
            if (retry === 'pyr3') { px = rx; py = ry; }       // pyr3: teleport to reseed every bad value
            // flam3: KEEP px,py (retry from last good with a fresh xform); reseed discarded
          } else { consec = 0; px = rx; py = ry; }             // give up → both jump to reseed
          continue; // skip splat / finalxform / jitter / prev update
        }
        consec = 0;
      }
      prev = fn;

      // splat position = post-lens (finalxform) if present.
      let sx = vx, sy = vy;
      if (fxf) {
        const op = fxf.opacity ?? 1.0;
        const applyFx = op === 1.0 ? true : rng() < op;
        if (applyFx) {
          const [fx, fy] = applyXform(fxf as unknown as Xform, vx, vy, R, rng);
          if (Number.isFinite(fx) && Number.isFinite(fy) && Math.abs(fx) <= 1e10 && Math.abs(fy) <= 1e10) { sx = fx; sy = fy; }
        }
      }

      // trajectory commit + scale-relative jitter.
      const mag = Math.max(Math.abs(vx), Math.abs(vy), 1e-30);
      const amp = R(mag * WJIT);
      px = R(vx + R((rng() - 0.5) * amp));
      py = R(vy + R((rng() - 0.5) * amp));

      // Deposit is gated by the picked xform's opacity (opacity=0 → trajectory
      // continues but NO histogram deposit). Matches pyr3 (xf.color_params.z)
      // + flam3. xforms 1/2/3/6 of 25703 are opacity=0 — only spherical (4,5)
      // and the finalxform-lensed points deposit.
      const op = g.xforms[fn]!.opacity ?? 1.0;
      if (it >= FUSE && op > 0 && Number.isFinite(sx) && Number.isFinite(sy)) {
        const dx = R(sx - cx), dy = R(sy - cy);
        const rx = R(R(dx * cosR) - R(dy * sinR)), ry = R(R(dx * sinR) + R(dy * cosR));
        const pxl = R(R(rx * scale) + W * 0.5), pyl = R(R(ry * scale) + H * 0.5);
        const xi = Math.floor(pxl), yi = Math.floor(pyl);
        samples++;
        if (xi >= 0 && xi < W && yi >= 0 && yi < H) {
          const idx = yi * W + xi;
          if (grid[idx] === 0) { grid[idx] = 1; nonzero++; }
        }
      }
    }
  }
  return { nonzero, samples };
}

function main(): void {
  const flamePath = process.argv[2]!;
  const nWalkers = Number(process.argv[3] ?? 256);
  const nIters = Number(process.argv[4] ?? 200000);
  const g: Genome = parseGenomeText(readFileSync(flamePath, 'utf8'), flamePath).genome;
  const W = (g.size?.width ?? 1024) * (g.oversample ?? 1), H = (g.size?.height ?? 1024) * (g.oversample ?? 1);
  console.log(`[#72 precision-oracle] ${flamePath.split('/').pop()}  super ${W}x${H}=${W * H}`);
  console.log(`  ${nWalkers} walkers × ${nIters} iters = ${(nWalkers * nIters).toExponential(2)} samples (SAME RNG both modes)\n`);

  const t0 = Date.now();
  const f64 = runChaos(g, 'f64', nWalkers, nIters, 0x12345, 'grain', 'pyr3', 'isaac');
  const f32 = runChaos(g, 'f32', nWalkers, nIters, 0x12345, 'grain', 'pyr3', 'isaac');
  const ftz = runChaos(g, 'f32ftz', nWalkers, nIters, 0x12345, 'grain', 'pyr3', 'isaac');
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  const pct = (n: number) => (100 * n / (W * H)).toFixed(1);
  console.log(`  WITH finalxform, opacity-gated, ISAAC, GRAIN pick:`);
  console.log(`  f64      nonzero = ${f64.nonzero.toString().padStart(9)}  (${pct(f64.nonzero)}%)`);
  console.log(`  f32      nonzero = ${f32.nonzero.toString().padStart(9)}  (${pct(f32.nonzero)}%)`);
  console.log(`  f32+FTZ  nonzero = ${ftz.nonzero.toString().padStart(9)}  (${pct(ftz.nonzero)}%)`);
  console.log(`  ratio f64/f32 = ${(f64.nonzero / f32.nonzero).toFixed(3)}×  f64/ftz = ${(f64.nonzero / ftz.nonzero).toFixed(3)}×   (${dt}s)`);
  console.log(`\n  target: pyr3-GPU(real)=1.26e6/16.6%   flam3-C=4.01e6/49%`);
  console.log(`\n  reference: flam3(f64)=4.01e6/49%   pyr3-GPU(f32)=1.26e6/16.6%   → real ratio ≈ 3.2×`);
}

main();
