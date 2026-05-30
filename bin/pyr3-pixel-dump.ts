#!/usr/bin/env -S node --experimental-strip-types
// pyr3-pixel-dump — PYR3-029 Phase 3 diagnostic.
//
// Runs ONLY the chaos pass, dumps the raw 4-channel u32 histogram
// buffer to a binary file. Companion to flam3-C's PYR3_DUMP_ACCUMULATOR
// (which dumps flam3's 5-channel double bucket array).
//
// Binary format (mirrors flam3-C `rect.c:1030-1052` layout but with pyr3's
// channel count and dtype):
//   5 × u32 little-endian header:
//     [0] width
//     [1] height
//     [2] channels  = 4   (R, G, B, count — pyr3 lacks separate alpha)
//     [3] bytes_per_channel = 4 (u32)
//     [4] reserved = 0
//   width × height × 4 × 4 bytes raw histogram (row-major)
//
// Usage:
//   npx tsx bin/pyr3-pixel-dump.ts <input.flame> <output.bin> [--quick] [--max-dim N]

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { create, globals } from 'webgpu';

import { sniffKind } from '../src/loader';
import { parseFlame } from '../src/flame-import';
import { genomeFromJson } from '../src/serialize';
import { createChaosPass, HIST_CHANNELS } from '../src/chaos';
import { type Genome } from '../src/genome';

const TARGET_WALKERS = 1024;
const MIN_ITERS_PER_WALKER = 4096;
const MAX_ITERS_PER_WALKER = 1048576;
const MAX_WALKERS = 65535 * 64;
const DEFAULT_SPP = 16;
const FUSE = 200;
const INIT_WALKERS = 4096;
const INIT_ITERS = MIN_ITERS_PER_WALKER;

const win = new Window();
(globalThis as { DOMParser: unknown }).DOMParser = win.DOMParser;
Object.assign(globalThis, globals);

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const args: string[] = [];
  let quick = false;
  let maxDim: number | null = null;
  let walkersOverride: number | null = null;
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i]!;
    if (a === '--quick') quick = true;
    else if (a === '--max-dim') {
      maxDim = Math.max(1, Math.floor(Number(rawArgs[++i])));
    } else if (a.startsWith('--walkers=')) {
      // PYR3-029 Phase 4 probe: override the parallel walker count.
      // Total iter budget is preserved (iters-per-walker grows
      // proportionally), so this isolates the parallelism dimension.
      walkersOverride = Math.max(1, Math.floor(Number(a.slice('--walkers='.length))));
    } else args.push(a);
  }
  if (args.length < 2) {
    console.error('usage: npx tsx bin/pyr3-pixel-dump.ts <input.flame> <output.bin> [--quick] [--max-dim N]');
    process.exit(1);
  }
  const inputPath = resolve(args[0]!);
  const outPath = resolve(args[1]!);

  const text = readFileSync(inputPath, 'utf8');
  const kind = sniffKind(inputPath, text);
  let genome: Genome = kind === 'flame' ? parseFlame(text).genome : genomeFromJson(JSON.parse(text));

  const longEdgeCap = maxDim ?? (quick ? 1024 : null);
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
    genome = { ...genome, oversample: 1, quality: Math.min(genome.quality ?? 16, 16) };
  }

  const width = genome.size?.width ?? 1024;
  const height = genome.size?.height ?? 1024;
  const oversample = Math.max(1, Math.floor(genome.oversample ?? 1));
  const superW = width * oversample;
  const superH = height * oversample;

  console.error(
    `[pyr3-pixel-dump] genome="${genome.name}" ${width}×${height} super=${superW}×${superH}`,
  );

  const navigator = { gpu: create([]) };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('pyr3-pixel-dump: no GPU adapter from Dawn');
  const limits = adapter.limits;
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxBufferSize: limits.maxBufferSize,
    },
  });

  const targetSpp = genome.quality ?? DEFAULT_SPP;
  const targetSamples = Math.round(targetSpp * width * height);
  let dispatchWalkers = walkersOverride ?? TARGET_WALKERS;
  let dispatchIters = Math.ceil(targetSamples / dispatchWalkers);
  if (walkersOverride === null) {
    // Default sizing — respect MIN/MAX bounds.
    if (dispatchIters < MIN_ITERS_PER_WALKER) {
      dispatchIters = MIN_ITERS_PER_WALKER;
      dispatchWalkers = Math.max(1, Math.ceil(targetSamples / dispatchIters));
    } else if (dispatchIters > MAX_ITERS_PER_WALKER) {
      dispatchIters = MAX_ITERS_PER_WALKER;
      dispatchWalkers = Math.min(MAX_WALKERS, Math.ceil(targetSamples / dispatchIters));
    }
  }
  // With override, the user owns the walker count; iters-per-walker scales to keep total
  // budget constant. The override may push iters past MAX_ITERS_PER_WALKER (potential
  // macOS Metal TDR risk at very small walker counts × very high quality) — the probe
  // accepts that risk explicitly.
  console.error(`[pyr3-pixel-dump] dispatch walkers=${dispatchWalkers} iters=${dispatchIters}`);

  const chaos = createChaosPass(device, {
    width: superW,
    height: superH,
    walkers: INIT_WALKERS,
    itersPerWalker: INIT_ITERS,
    fuse: FUSE,
    oversample, // PYR3-062: was omitted (→ undefined splat scale); match renderer
  });

  const seed = (Math.random() * 0xffffffff) >>> 0;
  chaos.setPalette(genome.palette);
  chaos.reset();
  const t0 = Date.now();
  chaos.dispatch(genome, seed, { walkers: dispatchWalkers, itersPerWalker: dispatchIters });

  const histBytes = superW * superH * HIST_CHANNELS * 4;
  const readBuf = device.createBuffer({
    label: 'pyr3-pixel-dump.readback',
    size: histBytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: 'pyr3-pixel-dump.encoder' });
  encoder.copyBufferToBuffer(chaos.histogram, 0, readBuf, 0, histBytes);
  device.queue.submit([encoder.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const histRaw = new Uint8Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();

  // Emit pyr3-pixel-dump format. 5-uint header + raw bytes.
  const header = new Uint32Array([superW, superH, HIST_CHANNELS, 4, 0]);
  const out = new Uint8Array(header.byteLength + histRaw.byteLength);
  out.set(new Uint8Array(header.buffer), 0);
  out.set(histRaw, header.byteLength);
  writeFileSync(outPath, out);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.error(`[pyr3-pixel-dump] wrote ${outPath} (${out.byteLength} bytes) in ${elapsed}s`);

  chaos.destroy();
  delete (globalThis as { navigator?: unknown }).navigator;
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('pyr3-pixel-dump: failed —', err);
  process.exit(1);
});
