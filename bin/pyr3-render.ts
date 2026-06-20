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

import { createRenderer, DEFAULT_FILTER_RADIUS, computeDispatch, DEFAULT_SPP } from '../src/renderer';
import { deriveCalibration } from '../src/calibration';
import { type Genome } from '../src/genome';
import { DEFAULT_WALKER_JITTER } from '../src/chaos';
import { genomeToJson } from '../src/serialize';
import { injectPngTextChunk } from '../src/png-text-chunk';
import { encodeExr } from '../src/exr-encode';
import { encodePng16 } from '../src/png16-encode';
import { histogramToLinearRgba } from '../src/export-linear';
import { srgbToLinear } from '../src/srgb';
import { halfToFloat } from '../src/half-float';
import { DEFAULT_TONEMAP } from '../src/tonemap';
import { deflateSync } from 'node:zlib';
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
  let outFormat: 'png8' | 'png16' | 'exr' | 'exr-linear' = 'png8';
  let transparent = false;
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
      // #65 Tier 1 — override walker-jitter (defaults to DEFAULT_WALKER_JITTER;
      // since #43 a scale-relative proportional factor, not an absolute
      // amplitude). 0 disables jitter (f32-collapse cliff returns); see
      // src/shaders/chaos.wgsl for the rationale.
      const v = rawArgs[++i];
      const n = v === undefined ? NaN : Number(v);
      if (!Number.isFinite(n) || n < 0) {
        console.error('--jitter requires a non-negative number (e.g. 1e-7, 0)');
        process.exit(1);
      }
      walkerJitter = n;
    } else if (a === '--walkers') {
      // #43 re-fuse probe — override the auto-computed walker count.
      // Smaller iters_per_walker = re-fuse-like behavior (each walker has a
      // bounded lifetime, can't get trapped on a singular f32 orbit).
      walkersOverride = parsePositiveInt(rawArgs[++i], '--walkers');
    } else if (a === '--format') {
      // #334 — output format. png8 = legacy 8-bit display-referred PNG;
      // png16 = 16-bit display-referred PNG (rgba16float readback); exr =
      // true linear scene-referred 32f EXR (raw histogram, pre-log/gamma).
      const v = rawArgs[++i];
      if (v !== 'png8' && v !== 'png16' && v !== 'exr' && v !== 'exr-linear') {
        console.error('--format requires one of: png8, png16, exr, exr-linear');
        process.exit(1);
      }
      outFormat = v;
    } else if (a === '--transparent') {
      // #334 — transparent background for png8/png16 (no effect on exr, which
      // is inherently background-free linear data).
      transparent = true;
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
  const isExr = outFormat === 'exr' || outFormat === 'exr-linear';
  const defaultExt = isExr ? 'exr' : 'png';
  let outPath = args[1]
    ? resolve(args[1])
    : resolve(`${basename(inputPath, extname(inputPath))}.${defaultExt}`);
  // #334 — honor the chosen format's extension even if a mismatched path is given.
  if (isExr && extname(outPath).toLowerCase() !== '.exr') {
    outPath = outPath.slice(0, outPath.length - extname(outPath).length) + '.exr';
  }

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
  // png8/exr use rgba8unorm (no sRGB conversion — pyr3's fragment shader writes
  // already-encoded values; PNG viewers interpret bytes as sRGB). png16 renders
  // through rgba16float to capture sub-8-bit display-referred precision (#334).
  // exr ignores the presented texture entirely — it reads the linear histogram.
  // png16 + the default (looks-like-editor) exr render the display tonemap to
  // rgba16float; png8 + exr-linear use rgba8unorm (exr-linear reads the
  // histogram, ignoring the presented texture). (#334)
  const gpuFormat: GPUTextureFormat =
    outFormat === 'png16' || outFormat === 'exr' ? 'rgba16float' : 'rgba8unorm';
  const renderer = createRenderer(device, gpuFormat, { width, height, oversample, filterRadius });

  const texture = device.createTexture({
    label: 'pyr3-render.output',
    size: { width, height },
    format: gpuFormat,
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
      transparent,
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
      transparent,
    });
  }

  // 5–7. Read back + encode per format (#334). The source genome rides along
  // as a `pyr3`-keyed PNG tEXt chunk (#123) so PNG output is self-describing.
  const pyr3Json = JSON.stringify(genomeToJson(genome));
  let outBytes: Uint8Array;

  if (outFormat === 'exr-linear') {
    // Advanced: TRUE scene-referred linear EXR — read the raw accumulation
    // histogram (pre-log, pre-gamma), collapse, normalize. Huge dynamic range;
    // needs tonemapping in an HDR tool (the default `exr` is the looks-right one).
    const { rgba: superRgba } = await renderer.readHistogram();
    const tonemap = genome.tonemap ?? DEFAULT_TONEMAP;
    // Calibrate the linear exposure with the SAME sample count renderer.render
    // used (computeDispatch with the genome's quality), so the EXR matches the
    // tone curve's linear regime and is not blown out (#334).
    const calibSamples = computeDispatch(genome.quality ?? DEFAULT_SPP, width, height).actualSamples;
    const { k1, k2 } = deriveCalibration({
      scale: genome.scale,
      sampleCount: calibSamples,
      brightness: tonemap.brightness,
      oversample,
    });
    const linear = histogramToLinearRgba({ superRgba, width, height, oversample, k1, k2 });
    outBytes = encodeExr({ width, height, rgba: linear });
  } else {
    // Display-referred PNG: read the presented texture. Bytes-per-row must be
    // 256-aligned. png16 = rgba16float (8 B/px half), png8 = rgba8unorm (4 B/px).
    const bytesPerPixel = gpuFormat === 'rgba16float' ? 8 : 4;
    const unpaddedBytesPerRow = width * bytesPerPixel;
    const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
    const readBuf = device.createBuffer({
      label: 'pyr3-render.readback',
      size: bytesPerRow * height,
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

    // Strip row padding into a tight buffer.
    const tight = new Uint8Array(width * height * bytesPerPixel);
    for (let y = 0; y < height; y++) {
      tight.set(
        padded.subarray(y * bytesPerRow, y * bytesPerRow + unpaddedBytesPerRow),
        y * unpaddedBytesPerRow,
      );
    }

    if (outFormat === 'exr') {
      // Default EXR — the LINEAR LIGHT of the display image. The display texels
      // are sRGB-encoded; EXR viewers assume linear + apply sRGB on view, so we
      // store sRGB_to_linear(display) and the viewer round-trips to the editor
      // look. Looks like the flame on open everywhere; no double-gamma. (#334)
      const halfView = new Uint16Array(tight.buffer, tight.byteOffset, width * height * 4);
      const rgba = new Float32Array(width * height * 4);
      // #388 — clamp to [0,1] AND coerce non-finite to 0. `Math.max(0, Math.min(1,
      // NaN))` is NaN; the png16 path self-heals (NaN→Uint16 coerces to 0) but the
      // EXR Float32Array writes NaN verbatim → black/magenta holes in many viewers.
      const cl = (f: number) => (Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : 0);
      for (let i = 0; i < width * height; i++) {
        const o = i * 4;
        rgba[o] = srgbToLinear(cl(halfToFloat(halfView[o]!)));
        rgba[o + 1] = srgbToLinear(cl(halfToFloat(halfView[o + 1]!)));
        rgba[o + 2] = srgbToLinear(cl(halfToFloat(halfView[o + 2]!)));
        rgba[o + 3] = cl(halfToFloat(halfView[o + 3]!)); // alpha = coverage
      }
      outBytes = encodeExr({ width, height, rgba });
    } else if (outFormat === 'png16') {
      // Decode the half-float texels → clamp [0,1] → 16-bit samples.
      const halfView = new Uint16Array(tight.buffer, tight.byteOffset, width * height * 4);
      const rgba16 = new Uint16Array(width * height * 4);
      for (let i = 0; i < rgba16.length; i++) {
        const f = halfToFloat(halfView[i]!);
        rgba16[i] = Math.round(Math.max(0, Math.min(1, f)) * 65535);
      }
      const pngBytes = await encodePng16(
        { width, height, rgba16 },
        (b) => new Uint8Array(deflateSync(b)),
      );
      outBytes = injectPngTextChunk(pngBytes, 'pyr3', pyr3Json);
    } else {
      // png8 — pngjs path (genomeFromJson can round-trip the embedded JSON).
      const png = new PNG({ width, height });
      png.data = Buffer.from(tight.buffer, tight.byteOffset, tight.byteLength);
      const pngBuf = PNG.sync.write(png);
      outBytes = injectPngTextChunk(
        new Uint8Array(pngBuf.buffer, pngBuf.byteOffset, pngBuf.byteLength),
        'pyr3',
        pyr3Json,
      );
    }
  }

  writeFileSync(outPath, outBytes);

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
