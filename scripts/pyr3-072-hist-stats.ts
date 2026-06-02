// #72 — dump pyr3's raw chaos histogram stats for direct comparison against
// flam3's instrumented BUCKETS line. Global-vs-structural divergence check.
//
// pyr3 count units: hist[+3] = 255 × hits per super-bucket (calibration.ts).
// flam3 (instrumented): sum_count=6.2e10, nonzero=4.0M, mean=15471, max=2.36e9,
//   sum_r/g/b = 27.1/24.3/35.8 e9 (for electricsheep.248.25703).
//
// Usage: node --import tsx/esm --import ./bin/wgsl-loader-register.mjs \
//          scripts/pyr3-072-hist-stats.ts <fixtureDir>

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createChaosPass } from '../src/chaos';
import { type Genome } from '../src/genome';
import { computeDispatch, DEFAULT_SPP } from '../src/renderer';
import { installWebGPUHost, acquireDawnDevice, parseGenomeText } from '../bin/host';

installWebGPUHost();

async function readBufU32(device: GPUDevice, src: GPUBuffer, byteLength: number): Promise<Uint32Array> {
  const rb = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(src, 0, rb, 0, byteLength);
  device.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const out = new Uint32Array(rb.getMappedRange().slice(0));
  rb.unmap(); rb.destroy();
  return out;
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  const name = basename(dir);
  const flamePath = join(dir, `${name}.flam3`);
  const text = readFileSync(flamePath, 'utf8');
  const genome: Genome = parseGenomeText(text, flamePath).genome;
  const width = genome.size?.width ?? 1024;
  const height = genome.size?.height ?? 1024;
  const oversample = Math.max(1, Math.floor(genome.oversample ?? 1));
  const superW = width * oversample, superH = height * oversample;

  const device = await acquireDawnDevice('pyr3-072-hist');
  const targetSpp = genome.quality ?? DEFAULT_SPP;
  const def = computeDispatch(targetSpp, width, height);
  // Optional overrides: argv[3]=walkers, argv[4]=itersPerWalker (walker-count sweep).
  const wOv = process.argv[3] ? Number(process.argv[3]) : undefined;
  const iOv = process.argv[4] ? Number(process.argv[4]) : undefined;
  const dispatchWalkers = wOv ?? def.dispatchWalkers;
  const dispatchIters = iOv ?? def.dispatchIters;
  const actualSamples = dispatchWalkers * dispatchIters;
  const chaos = createChaosPass(device, { width: superW, height: superH, walkers: dispatchWalkers, itersPerWalker: dispatchIters, fuse: 200, oversample });
  chaos.setPalette(genome.palette);
  chaos.reset();
  chaos.dispatch(genome, 0x12345 >>> 0, { walkers: dispatchWalkers, itersPerWalker: dispatchIters });
  console.log(`  [dispatch] walkers=${dispatchWalkers} iters=${dispatchIters}`);

  const hist = await readBufU32(device, chaos.histogram, superW * superH * 4 * 4);

  let nonzero = 0, sumR = 0, sumG = 0, sumB = 0, sumC = 0, maxC = 0;
  const n = superW * superH;
  for (let i = 0; i < n; i++) {
    const c = hist[i * 4 + 3];
    if (c > 0) {
      nonzero++;
      sumR += hist[i * 4]; sumG += hist[i * 4 + 1]; sumB += hist[i * 4 + 2]; sumC += c;
      if (c > maxC) maxC = c;
    }
  }
  const e = (x: number) => x.toExponential(3);
  console.log(`[#72 hist] ${name}  super ${superW}x${superH}=${n}  OS=${oversample}  actualSamples=${actualSamples}  (target spp=${targetSpp})`);
  console.log(`  nonzero buckets   = ${nonzero}  (${(100 * nonzero / n).toFixed(1)}% of super-grid)`);
  console.log(`  sum_count (×255)  = ${e(sumC)}   → total hits ≈ ${e(sumC / 255)}`);
  console.log(`  mean_cnt_nonzero  = ${(sumC / nonzero).toFixed(0)}  (×255 units)  → hits/bucket ≈ ${(sumC / nonzero / 255).toFixed(1)}`);
  console.log(`  max_cnt_per_px    = ${e(maxC)}  → hits ≈ ${e(maxC / 255)}`);
  console.log(`  sum_r/g/b (×255)  = ${e(sumR)} / ${e(sumG)} / ${e(sumB)}`);
  console.log('');
  console.log('  flam3 reference   : nonzero=4.01e6  sum_count=6.20e10  mean=15471  max=2.36e9  rgb=2.71e10/2.43e10/3.58e10');

  chaos.destroy();
  delete (globalThis as { navigator?: unknown }).navigator;
  process.exit(0);
}

main().catch((e: unknown) => { console.error('pyr3-072-hist failed:', e); process.exit(1); });
