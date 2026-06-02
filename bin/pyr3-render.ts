#!/usr/bin/env -S node --experimental-strip-types
// pyr3-render — Phase B1 CLI prototype.
//
// Usage:
//   npm run render <input.flam3 | input.pyr3.json> [output.png]
//
// Loads the genome, acquires a Dawn-node WebGPU device, drives one
// chaos+DE+visualize cycle into an offscreen RGBA texture, copies the
// output back to host memory, and writes a PNG. No browser required.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { PNG } from 'pngjs';

import { createRenderer, DEFAULT_FILTER_RADIUS, computeDispatch } from '../src/renderer';
import { type Genome } from '../src/genome';
import { DEFAULT_WALKER_JITTER } from '../src/chaos';
import {
  applyPreset,
  customSpec,
  specForQualityName,
  QUALITY_NAMES,
  type PresetSpec,
} from '../src/presets';
import { installWebGPUHost, acquireDawnDevice, parseGenomeText, parsePositiveInt } from './host';

installWebGPUHost();

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const args: string[] = [];
  let forceDeOff = false;
  let presetSpec: PresetSpec | null = null;
  let maxDim: number | null = null;
  let customLongEdge: number | null = null;
  let customQuality: number | null = null;
  let sampleInflate = 1;
  let seedOverride: number | null = null;
  let walkerJitter: number = DEFAULT_WALKER_JITTER;
  let walkersOverride: number | null = null;
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i]!;
    if (a === '--no-de') {
      forceDeOff = true;
    } else if (a === '--preset') {
      const v = rawArgs[++i];
      const spec = v === undefined ? null : specForQualityName(v);
      if (spec === null) {
        console.error(`--preset requires one of: ${QUALITY_NAMES.join(', ')}`);
        process.exit(1);
      }
      presetSpec = spec;
    } else if (a === '--long-edge') {
      customLongEdge = parsePositiveInt(rawArgs[++i], '--long-edge');
    } else if (a === '--quality') {
      const v = rawArgs[++i];
      const n = v === undefined ? NaN : Number(v);
      if (!Number.isFinite(n) || n < 1) {
        console.error('--quality requires a positive number argument');
        process.exit(1);
      }
      customQuality = n;
    } else if (a === '--max-dim') {
      maxDim = parsePositiveInt(rawArgs[++i], '--max-dim');
    } else if (a === '--seed') {
      // #35: deterministic seed for FE↔BE parity (test rig pins both sides to
      // the same seed so R(FE,BE) measures only systematic engine drift).
      // Accepts decimal or 0x-prefixed hex; truncates to u32.
      const v = rawArgs[++i];
      const n = v === undefined ? NaN : Number(v);
      if (!Number.isFinite(n) || n < 0) {
        console.error('--seed requires a non-negative integer (decimal or 0xHEX)');
        process.exit(1);
      }
      seedOverride = (n >>> 0);
    } else if (a === '--jitter') {
      // #65 Tier 1 — override walker-jitter amplitude (default 1e-10, the
      // shipped #6 value). 0 disables jitter (f32-collapse cliff returns);
      // see src/shaders/chaos.wgsl for the rationale.
      const v = rawArgs[++i];
      const n = v === undefined ? NaN : Number(v);
      if (!Number.isFinite(n) || n < 0) {
        console.error('--jitter requires a non-negative number (e.g. 1e-10, 0)');
        process.exit(1);
      }
      walkerJitter = n;
    } else if (a === '--walkers') {
      // #43 re-fuse probe — override the auto-computed walker count.
      // Smaller iters_per_walker = re-fuse-like behavior (each walker has a
      // bounded lifetime, can't get trapped on a singular f32 orbit).
      walkersOverride = parsePositiveInt(rawArgs[++i], '--walkers');
    } else if (a.startsWith('--sample-inflate=')) {
      // PYR3-029 probe: multiplies the `totalSamples` passed to
      // deriveCalibration, shrinking k2 by the same factor. Use to
      // compensate when pyr3 produces more in-bounds splats per nominal
      // iter than flam3.
      const n = Number(a.slice('--sample-inflate='.length));
      if (!Number.isFinite(n) || n <= 0) {
        console.error('--sample-inflate=N requires a positive number');
        process.exit(1);
      }
      sampleInflate = n;
    } else {
      args.push(a);
    }
  }
  const custom = customLongEdge !== null || customQuality !== null;
  if ([presetSpec !== null, maxDim !== null, custom].filter(Boolean).length > 1) {
    console.error('--preset, --max-dim, and --long-edge/--quality are mutually exclusive');
    process.exit(1);
  }
  if (args.length < 1) {
    console.error(
      `usage: npm run render [--no-de] [--preset {${QUALITY_NAMES.join('|')}}] ` +
        '[--long-edge N --quality N] [--max-dim N] [--sample-inflate=F] ' +
        '<input.flam3 | input.pyr3.json> [output.png]',
    );
    process.exit(1);
  }
  const inputPath = resolve(args[0]!);
  const outPath = args[1]
    ? resolve(args[1])
    : resolve(`${basename(inputPath, extname(inputPath))}.png`);

  // 1. Load genome.
  const text = readFileSync(inputPath, 'utf8');
  const parsed = parseGenomeText(text, inputPath);
  let genome: Genome = parsed.genome;
  const { kind, dropped, ignored } = parsed;

  // Preset application (v0.20+). `--preset quick` mirrors src/main.ts
  // rerender() (FE QUICK_MAX_DIM / QUICK_MAX_SPP / QUICK_OVERSAMPLE) for
  // the FE↔BE parity gate (PYR3-026). `--preset 4k` mirrors the predecessor's
  // Preset.SHOWCASE_4K for BE 4K showcase rendering. `--max-dim N` is a
  // standalone cap (rejected alongside --preset above).
  if (presetSpec !== null) {
    genome = applyPreset(genome, presetSpec);
  } else if (custom) {
    // #25: custom render — explicit long edge and/or SPP. Override quality so it
    // is SET (not merely capped); fall back to the genome's native long edge /
    // quality for whichever flag is omitted.
    const nativeLong = genome.size ? Math.max(genome.size.width, genome.size.height) : 1024;
    const longEdge = customLongEdge ?? nativeLong;
    const spp = customQuality ?? genome.quality ?? 16;
    if (customQuality !== null) genome = { ...genome, quality: customQuality };
    genome = applyPreset(genome, customSpec(longEdge, spp));
  }
  if (maxDim !== null) {
    const declW = genome.size?.width ?? 1024;
    const declH = genome.size?.height ?? 1024;
    const maxDecl = Math.max(declW, declH);
    if (maxDecl > maxDim) {
      const sizeScale = maxDim / maxDecl;
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

  const width = genome.size?.width ?? 1024;
  const height = genome.size?.height ?? 1024;
  const oversample = Math.max(1, Math.floor(genome.oversample ?? 1));
  const filterRadius = genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;
  console.log(
    `[pyr3-render] genome="${genome.name}" ${width}×${height} oversample=${oversample} ` +
      `(${kind}${dropped + ignored > 0 ? `, ${dropped} dropped, ${ignored} ignored` : ''})`,
  );

  // 2. Acquire Dawn device.
  const device = await acquireDawnDevice('pyr3-render');

  // 3. Build renderer + offscreen texture.
  // Use rgba8unorm (no sRGB conversion in the pipeline — pyr3's fragment
  // shader writes already-encoded values, so we want the bytes to land in
  // the buffer unchanged. PNG viewers interpret bytes as sRGB by default.)
  const format = 'rgba8unorm' as const;
  const renderer = createRenderer(device, format, { width, height, oversample, filterRadius });

  const texture = device.createTexture({
    label: 'pyr3-render.output',
    size: { width, height },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });

  // 4. Render.
  const t0 = Date.now();
  if (sampleInflate === 1 && walkersOverride === null) {
    renderer.render({
      genome,
      outputView: texture.createView(),
      forceDeOff,
      seed: seedOverride ?? undefined,
      walkerJitter,
    });
  } else {
    // Probe path: manual walker-sizing for #43 re-fuse probe (--walkers) and/or
    // PYR3-029 sample-inflate. Walker count from --walkers or auto-computed.
    const seed = seedOverride ?? ((Math.random() * 0xffffffff) >>> 0);
    const targetSpp = genome.quality ?? 16;
    const { dispatchWalkers, dispatchIters, actualSamples } = computeDispatch(
      targetSpp, width, height, walkersOverride ?? undefined,
    );
    if (sampleInflate !== 1) {
      console.log(`[pyr3-render] probe: sample-inflate=${sampleInflate} → totalSamples ${actualSamples} → ${actualSamples * sampleInflate}`);
    }
    if (walkersOverride !== null) {
      console.log(`[pyr3-render] probe: walkers=${dispatchWalkers} iters=${dispatchIters} (--walkers override)`);
    }
    renderer.reset(genome);
    renderer.iterate({ genome, seed, walkers: dispatchWalkers, itersPerWalker: dispatchIters, walkerJitter });
    renderer.present({
      genome,
      outputView: texture.createView(),
      totalSamples: actualSamples * sampleInflate,
      forceDeOff,
    });
  }

  // 5. Copy texture → buffer. Bytes-per-row must be 256-aligned.
  const bytesPerPixel = 4;
  const unpaddedBytesPerRow = width * bytesPerPixel;
  const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
  const readBufSize = bytesPerRow * height;
  const readBuf = device.createBuffer({
    label: 'pyr3-render.readback',
    size: readBufSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: 'pyr3-render.encoder' });
  encoder.copyTextureToBuffer(
    { texture },
    { buffer: readBuf, bytesPerRow, rowsPerImage: height },
    { width, height },
  );
  device.queue.submit([encoder.finish()]);

  await readBuf.mapAsync(GPUMapMode.READ);
  const padded = new Uint8Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();

  // 6. Strip row padding into a tight RGBA buffer for PNG.
  const tight = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcOff = y * bytesPerRow;
    const dstOff = y * unpaddedBytesPerRow;
    tight.set(padded.subarray(srcOff, srcOff + unpaddedBytesPerRow), dstOff);
  }

  // 7. Encode PNG.
  const png = new PNG({ width, height });
  png.data = Buffer.from(tight.buffer, tight.byteOffset, tight.byteLength);
  const pngBuf = PNG.sync.write(png);
  writeFileSync(outPath, pngBuf);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[pyr3-render] wrote ${outPath} in ${elapsed}s`);

  // Per the `webgpu` package README: drop the navigator reference so node exits.
  delete (globalThis as { navigator?: unknown }).navigator;
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('pyr3-render: failed —', err);
  process.exit(1);
});
