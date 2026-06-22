#!/usr/bin/env -S node --experimental-strip-types
// pyr3-hist — PYR3-029 Phase 1 diagnostic CLI.
//
// Runs ONLY the chaos pass (no DE, no tonemap, no visualize), reads the
// 4-channel u32 atomic histogram back to CPU, and prints a single-line
// summary in the flam3 `[PYR3-DEBUG] BUCKETS` stderr format so direct
// diff against flam3-render-32bit-isaac output works.
//
// Format (docs/flam3-local-build.md §6):
//   [PYR3-DEBUG] BUCKETS sum_r=<i64> sum_g=<i64> sum_b=<i64> sum_alpha=<i64> sum_count=<i64>
//   [PYR3-DEBUG] BUCKETS nonzero=<int> total_pixels=<int> max_cnt_per_px=<int> mean_cnt_nonzero=<int>
//
// pyr3's histogram is (R, G, B, count) — no separate alpha channel — so
// `sum_alpha` is emitted as 0 for format compat. `sum_count` is the
// pyr3 `count` channel.
//
// Usage:
//   npx tsx bin/pyr3-hist.ts <input.flame> [--quick] [--max-dim N]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createChaosPass, HIST_CHANNELS } from '../src/chaos';
import { type Genome } from '../src/genome';
import { computeDispatch, DEFAULT_SPP, MIN_ITERS_PER_WALKER } from '../src/renderer';
import { installWebGPUHost, acquireDawnDevice, parseGenomeText, parsePositiveInt } from './host';

const FUSE = 200;
// Initial chaos-pass config; dispatch overrides via opts.
const INIT_WALKERS = 4096;
const INIT_ITERS = MIN_ITERS_PER_WALKER;

installWebGPUHost();

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const args: string[] = [];
  let quick = false;
  let maxDim: number | null = null;
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i]!;
    if (a === '--quick') {
      quick = true;
    } else if (a === '--max-dim') {
      maxDim = parsePositiveInt(rawArgs[++i], '--max-dim');
    } else {
      args.push(a);
    }
  }
  if (args.length < 1) {
    console.error('usage: npx tsx bin/pyr3-hist.ts <input.flame> [--quick] [--max-dim N]');
    process.exit(1);
  }
  const inputPath = resolve(args[0]!);

  // Load genome (same path as pyr3-render).
  const text = readFileSync(inputPath, 'utf8');
  let genome: Genome = parseGenomeText(text, inputPath).genome;

  const QUICK_FE_MAX_DIM = 1024;
  const QUICK_FE_MAX_SPP = 16;
  const QUICK_FE_OVERSAMPLE = 1;
  const longEdgeCap = maxDim ?? (quick ? QUICK_FE_MAX_DIM : null);
  if (longEdgeCap !== null) {
    const declW = genome.size?.width ?? 1024;
    const declH = genome.size?.height ?? 1024;
    const maxDecl = Math.max(declW, declH);
    if (maxDecl > longEdgeCap) {
      const sizeScale = longEdgeCap / maxDecl;
      genome = {
        ...genome,
        size: {
          width: Math.max(1, Math.round(declW * sizeScale)),
          height: Math.max(1, Math.round(declH * sizeScale)),
        },
        scale: genome.scale * sizeScale,
      };
    }
  }
  if (quick) {
    genome = {
      ...genome,
      oversample: QUICK_FE_OVERSAMPLE,
      quality: Math.min(genome.quality ?? QUICK_FE_MAX_SPP, QUICK_FE_MAX_SPP),
    };
  }

  const width = genome.size?.width ?? 1024;
  const height = genome.size?.height ?? 1024;
  const oversample = Math.max(1, Math.floor(genome.oversample ?? 1));
  const superW = width * oversample;
  const superH = height * oversample;

  console.error(
    `[pyr3-hist] genome="${genome.name}" ${width}×${height} oversample=${oversample} super=${superW}×${superH}`,
  );

  // Acquire Dawn device.
  const device = await acquireDawnDevice('pyr3-hist');

  // Walker-sizing — identical to renderer.render() so the histogram reflects
  // the same dispatch profile a normal render produces. Diagnostic override
  // (PYR3-034): `--walkers N` pins walker count for sweep-vs-coverage probes.
  const walkersArgIdx = process.argv.indexOf('--walkers');
  const walkersOverride =
    walkersArgIdx >= 0 && process.argv[walkersArgIdx + 1] !== undefined
      ? parsePositiveInt(process.argv[walkersArgIdx + 1], '--walkers')
      : undefined;
  const targetSpp = genome.quality ?? DEFAULT_SPP;
  const { dispatchWalkers, dispatchIters, actualSamples } = computeDispatch(
    targetSpp,
    width,
    height,
    walkersOverride,
  );
  console.error(
    `[pyr3-hist] dispatch walkers=${dispatchWalkers} iters=${dispatchIters} samples=${actualSamples}`,
  );

  // Build chaos pass directly — no DE / no visualize.
  const chaos = createChaosPass(device, {
    width: superW,
    height: superH,
    walkers: INIT_WALKERS,
    itersPerWalker: INIT_ITERS,
    fuse: FUSE,
    oversample, // PYR3-062: was omitted (→ undefined splat scale); match renderer
  });

  // Seed: match renderer.render()'s default (fresh random per invocation).
  // The diagnostic is interested in aggregate sums which are insensitive to
  // seed (LLN convergence at 16M+ samples); per-run variance is < 0.1%.
  const seed = (Math.random() * 0xffffffff) >>> 0;

  chaos.setPalette(genome.palette);
  chaos.reset();
  const t0 = Date.now();
  chaos.dispatch(genome, seed, { walkers: dispatchWalkers, itersPerWalker: dispatchIters });

  // Read histogram back: u32×4 (R, G, B, count) per super-pixel.
  const histBytes = superW * superH * HIST_CHANNELS * 4;
  const readBuf = device.createBuffer({
    label: 'pyr3-hist.readback',
    size: histBytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: 'pyr3-hist.encoder' });
  encoder.copyBufferToBuffer(chaos.histogram, 0, readBuf, 0, histBytes);
  device.queue.submit([encoder.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const u32 = new Uint32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();

  // Reduce. Use BigInt sums so we don't overflow at 4K × 16spp.
  let sumR = 0n;
  let sumG = 0n;
  let sumB = 0n;
  let sumCount = 0n;
  let nonzero = 0;
  let maxCnt = 0;
  const totalPixels = superW * superH;
  for (let i = 0; i < totalPixels; i++) {
    const base = i * HIST_CHANNELS;
    const r = u32[base]!;
    const g = u32[base + 1]!;
    const b = u32[base + 2]!;
    const c = u32[base + 3]!;
    sumR += BigInt(r);
    sumG += BigInt(g);
    sumB += BigInt(b);
    sumCount += BigInt(c);
    if (c > 0) {
      nonzero++;
      if (c > maxCnt) maxCnt = c;
    }
  }
  const meanNonzero = nonzero > 0 ? Number(sumCount) / nonzero : 0;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  console.error(`[pyr3-hist] chaos+readback in ${elapsed}s`);
  // Flam3-compatible two-line BUCKETS format. sum_alpha=0 (pyr3 lacks alpha channel).
  console.log(
    `[PYR3-DEBUG] BUCKETS sum_r=${sumR} sum_g=${sumG} sum_b=${sumB} sum_alpha=0 sum_count=${sumCount}`,
  );
  console.log(
    `[PYR3-DEBUG] BUCKETS nonzero=${nonzero} total_pixels=${totalPixels} max_cnt_per_px=${maxCnt} mean_cnt_nonzero=${meanNonzero.toFixed(2)}`,
  );

  chaos.destroy();
  delete (globalThis as { navigator?: unknown }).navigator;
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('pyr3-hist: failed —', err);
  process.exit(1);
});
