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
import { Window } from 'happy-dom';
import { create, globals } from 'webgpu';
import { PNG } from 'pngjs';

import { sniffKind } from '../src/loader';
import { parseFlame } from '../src/flame-import';
import { genomeFromJson } from '../src/serialize';
import { createRenderer, DEFAULT_FILTER_RADIUS } from '../src/renderer';
import { type Genome } from '../src/genome';

// happy-dom shim — pyr3's flame-import.ts uses DOMParser which is
// browser-only. Borrow happy-dom's instance and stamp it onto globalThis.
const win = new Window();
(globalThis as { DOMParser: unknown }).DOMParser = win.DOMParser;

// Stamp WebGPU constants (GPUBufferUsage etc.) onto globalThis. The pyr3
// shaders + buffer creation reference these globals — same as the browser.
Object.assign(globalThis, globals);

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const flags = new Set(rawArgs.filter((a) => a.startsWith('--')));
  const args = rawArgs.filter((a) => !a.startsWith('--'));
  if (args.length < 1) {
    console.error('usage: npm run render [--no-de] <input.flam3 | input.pyr3.json> [output.png]');
    process.exit(1);
  }
  const forceDeOff = flags.has('--no-de');
  const inputPath = resolve(args[0]!);
  const outPath = args[1]
    ? resolve(args[1])
    : resolve(`${basename(inputPath, extname(inputPath))}.png`);

  // 1. Load genome.
  const text = readFileSync(inputPath, 'utf8');
  const kind = sniffKind(inputPath, text);
  let genome: Genome;
  let dropped = 0, ignored = 0;
  if (kind === 'flame') {
    const result = parseFlame(text);
    genome = result.genome;
    dropped = result.report.droppedVariations.length;
    ignored = result.report.ignoredFields.length;
  } else {
    genome = genomeFromJson(JSON.parse(text));
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
  const navigator = { gpu: create([]) };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('pyr3-render: no GPU adapter from Dawn');
  // Match the browser's required-limits path so flames using huge histograms
  // (supersample=4 on 800×592 → 121MB) don't blow past defaults.
  const limits = adapter.limits;
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxBufferSize: limits.maxBufferSize,
    },
  });

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
  renderer.render({ genome, outputView: texture.createView(), forceDeOff });

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
