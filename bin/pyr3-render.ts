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

import { createRenderer, DEFAULT_FILTER_RADIUS, computeDispatch, DEFAULT_SPP, type Renderer } from '../src/renderer';
import { deriveCalibration } from '../src/calibration';
import { type Genome } from '../src/genome';
import { DEFAULT_WALKER_JITTER } from '../src/chaos';
import { type TrapConfig, DEFAULT_TRAP_CONFIG } from '../src/trap-config';
import { genomeToJson } from '../src/serialize';
import { injectPngTextChunk } from '../src/png-text-chunk';
import { encodeExr } from '../src/exr-encode';
import { encodePng16 } from '../src/png16-encode';
import { histogramToLinearRgba } from '../src/export-linear';
import { readTextureTight, displayHalfToLinearExr, displayHalfToPng16 } from '../src/gpu-readback';
import { DEFAULT_TONEMAP } from '../src/tonemap';
import {
  measureProbeLuminance,
  fitBrightnessToTarget,
  computeMeanLuminance,
  computeMeanLuminanceHalf,
} from '../src/auto-exposure';
import { deflateSync } from 'node:zlib';
import {
  applyPreset,
  customSpec,
} from '../src/presets';
import {
  installWebGPUHost,
  acquireDawnDevice,
  parseGenomeText,
  parsePositiveInt,
  MAX_ITERS_PER_SUBMIT,
} from './host';

/**
 * Run the chaos game as one or more TDR-safe submits, accumulating into the
 * renderer's shared histogram. `totalIters` is split so no single GPU dispatch
 * exceeds MAX_ITERS_PER_SUBMIT (Infinity off-win32 → exactly one submit,
 * byte-identical to the historical single-shot). Each chunk is an independent
 * re-seeded batch (seed + chunkIndex), matching the serve / orchestrator
 * pattern; walkers stay fixed per chunk so per-walker trajectory length — the
 * parity-load-bearing knob — is preserved. Returns the actual sample total.
 * See host.ts:MAX_ITERS_PER_SUBMIT for the Windows-TDR-blank rationale.
 */
function chunkedIterate(
  renderer: Renderer,
  genome: Genome,
  seedBase: number,
  walkers: number,
  totalIters: number,
  walkerJitter: number,
  color?: { colorMode: 'palette' | 'flow' | 'trap-distance' | 'phase'; flowStrength: number; flowScale: number; trap?: TrapConfig; phaseStrength: number; phaseFreq: number },
): number {
  const chunks = Math.max(1, Math.ceil(totalIters / MAX_ITERS_PER_SUBMIT));
  const itersPerChunk = Math.ceil(totalIters / chunks);
  let total = 0;
  for (let c = 0; c < chunks; c++) {
    renderer.iterate({
      genome,
      seed: seedBase + c,
      walkers,
      itersPerWalker: itersPerChunk,
      walkerJitter,
      colorMode: color?.colorMode,
      flowStrength: color?.flowStrength,
      flowScale: color?.flowScale,
      trap: color?.trap,
      phaseStrength: color?.phaseStrength,
      phaseFreq: color?.phaseFreq,
    });
    total += walkers * itersPerChunk;
  }
  return total;
}

installWebGPUHost();

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const args: string[] = [];
  let forceDeOff = false;
  let maxDim: number | null = null;
  let customLongEdge: number | null = null;
  let customQuality: number | null = null;
  let customOversample: number | null = null;
  let sampleInflate = 1;
  let seedOverride: number | null = null;
  let walkerJitter: number = DEFAULT_WALKER_JITTER;
  let walkersOverride: number | null = null;
  let outFormat: 'png8' | 'png16' | 'exr' | 'exr-linear' = 'png8';
  let transparent = false;
  // #475 — render-time auto-exposure: match HQ exposure to the genome's
  // preview-resolution appearance (fixes near-black thin-attractor masters).
  // Default ON for display-referred output; `--no-auto-exposure` opts out (the
  // parity rig passes it to stay flam3-C-faithful). Never applies to exr-linear
  // (raw scene-linear histogram, not the display texture).
  let autoExposure = true;
  // #459 — flow-map color mode. Standalone-bundled CLI keeps the flow-scale
  // default as a literal mirroring DEFAULT_FLOW_SCALE in src/chaos.ts.
  let colorMode: 'palette' | 'flow' | 'trap-distance' | 'phase' = 'palette';
  let flowStrength = 1.0;
  let flowScale = 2.0;
  // #460 — trap-distance coloring params (consulted when colorMode === 'trap-distance').
  const trap: TrapConfig = { ...DEFAULT_TRAP_CONFIG };
  // #465 — Phase/Polar coloring params (consulted when colorMode === 'phase').
  let phaseStrength = 1.0;
  let phaseFreq = 1.0;
  // #456 — interpolated xform fields: blend probability λ ∈ [0,1] (0 = off). A
  // genome field — applied onto genome.xformBlend before dispatch (overrides any
  // value the loaded flame carries).
  let xformBlend = 0;
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i]!;
    if (a === '--no-de') {
      forceDeOff = true;
    } else if (a === '--no-auto-exposure') {
      autoExposure = false;
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
    } else if (a === '--oversample') {
      // Supersampling: render the internal histogram at oversample× linear, then
      // box-downsample to the output → spatial antialiasing + sub-pixel detail
      // (flam3 `supersample`). Overrides genome.oversample. 1 = off.
      customOversample = parsePositiveInt(rawArgs[++i], '--oversample');
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
    } else if (a === '--color-mode') {
      // #459 — flow-map ("velocity") color mode. 'palette' (default) = normal
      // palette/DC color; 'flow' = color each splat by its per-iteration
      // displacement (direction → hue, log-saturated magnitude → value).
      const v = rawArgs[++i];
      if (v !== 'palette' && v !== 'flow' && v !== 'trap-distance' && v !== 'phase') {
        console.error('--color-mode requires one of: palette, flow, trap-distance, phase');
        process.exit(1);
      }
      colorMode = v;
    } else if (a === '--flow-strength') {
      // #459 — flow-map blend [0,1]: 0 = palette, 1 = pure flow.
      const v = rawArgs[++i];
      const n = v === undefined ? NaN : Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        console.error('--flow-strength requires a number in [0,1]');
        process.exit(1);
      }
      flowStrength = n;
    } else if (a === '--flow-scale') {
      // #459 — flow-map magnitude log-saturation factor (positive).
      const v = rawArgs[++i];
      const n = v === undefined ? NaN : Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        console.error('--flow-scale requires a positive number');
        process.exit(1);
      }
      flowScale = n;
    } else if (a === '--trap-kind') {
      // #460 — trap shape: point | circle | line.
      const v = rawArgs[++i];
      if (v !== 'point' && v !== 'circle' && v !== 'line') {
        console.error('--trap-kind requires one of: point, circle, line');
        process.exit(1);
      }
      trap.kind = v;
    } else if (a === '--trap-mode') {
      // #460 — falloff mode: glow (single contour) | rings (repeating bands).
      const v = rawArgs[++i];
      if (v !== 'glow' && v !== 'rings') {
        console.error('--trap-mode requires one of: glow, rings');
        process.exit(1);
      }
      trap.mode = v;
    } else if (a === '--trap-center') {
      // #460 — trap center "X,Y" in genome space.
      const v = rawArgs[++i];
      const parts = (v ?? '').split(',').map(Number);
      if (parts.length !== 2 || !parts.every((n) => Number.isFinite(n))) {
        console.error('--trap-center requires X,Y');
        process.exit(1);
      }
      trap.cx = parts[0]!;
      trap.cy = parts[1]!;
    } else if (a === '--trap-radius') {
      // #460 — circle radius (positive).
      const v = rawArgs[++i];
      const n = v === undefined ? NaN : Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        console.error('--trap-radius requires a positive number');
        process.exit(1);
      }
      trap.radius = n;
    } else if (a === '--trap-angle') {
      // #460 — line orientation in degrees.
      const v = rawArgs[++i];
      const n = v === undefined ? NaN : Number(v);
      if (!Number.isFinite(n)) {
        console.error('--trap-angle requires a number (degrees)');
        process.exit(1);
      }
      trap.angle = n;
    } else if (a === '--trap-falloff') {
      // #460 — glow exp falloff (>= 0).
      const v = rawArgs[++i];
      const n = v === undefined ? NaN : Number(v);
      if (!Number.isFinite(n) || n < 0) {
        console.error('--trap-falloff requires a number >= 0');
        process.exit(1);
      }
      trap.falloff = n;
    } else if (a === '--trap-freq') {
      // #460 — rings frequency (positive).
      const v = rawArgs[++i];
      const n = v === undefined ? NaN : Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        console.error('--trap-freq requires a positive number');
        process.exit(1);
      }
      trap.freq = n;
    } else if (a === '--trap-strength') {
      // #460 — blend over palette [0,1].
      const v = rawArgs[++i];
      const n = v === undefined ? NaN : Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        console.error('--trap-strength requires a number in [0,1]');
        process.exit(1);
      }
      trap.strength = n;
    } else if (a === '--phase-strength') {
      // #465 — Phase/Polar blend over palette [0,1]: 0 = palette, 1 = pure phase.
      const v = rawArgs[++i];
      const n = v === undefined ? NaN : Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        console.error('--phase-strength requires a number in [0,1]');
        process.exit(1);
      }
      phaseStrength = n;
    } else if (a === '--phase-freq') {
      // #465 — Phase/Polar log-modulus ring frequency (>= 0; 0 = pure phase field).
      const v = rawArgs[++i];
      const n = v === undefined ? NaN : Number(v);
      if (!Number.isFinite(n) || n < 0) {
        console.error('--phase-freq requires a number >= 0');
        process.exit(1);
      }
      phaseFreq = n;
    } else if (a === '--xform-blend') {
      // #456 — interpolated xform fields: blend probability λ ∈ [0,1] (0 = off).
      const v = rawArgs[++i];
      const n = v === undefined ? NaN : Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        console.error('--xform-blend requires a number in [0,1]');
        process.exit(1);
      }
      xformBlend = n;
    } else {
      args.push(a);
    }
  }
  const custom = customLongEdge !== null || customQuality !== null;
  if ([maxDim !== null, custom].filter(Boolean).length > 1) {
    console.error('--max-dim and --long-edge/--quality are mutually exclusive');
    process.exit(1);
  }
  if (args.length < 1) {
    console.error(
      'usage: npm run render [--no-de] [--no-auto-exposure] ' +
        '[--long-edge N --quality N] [--max-dim N] [--oversample N] [--sample-inflate=F] ' +
        '[--format png8|png16|exr|exr-linear] [--transparent] ' +
        '[--color-mode palette|flow|trap-distance|phase] [--flow-strength F] [--flow-scale F] ' +
        '[--trap-kind point|circle|line] [--trap-center X,Y] [--trap-radius R] [--trap-angle DEG] ' +
        '[--trap-mode glow|rings] [--trap-falloff F] [--trap-freq N] [--trap-strength S] ' +
        '[--phase-strength S] [--phase-freq F] [--xform-blend F] ' +
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

  // #456 — interpolated xform fields: --xform-blend overrides genome.xformBlend.
  if (xformBlend > 0) genome = { ...genome, xformBlend };

  // Explicit-flag render sizing (#436 — the hidden `--preset {quick|4k|…}` alias
  // was removed; everything on the command line is now explicit). `--long-edge`/
  // `--quality` force the output long edge / SPP; `--max-dim N` is a standalone
  // cap (rejected alongside --long-edge/--quality above). Omit both to render at
  // the genome's native dims/quality.
  if (custom) {
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
  const oversample = Math.max(1, Math.floor(customOversample ?? genome.oversample ?? 1));
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
  // Captured for the #475 auto-exposure re-present pass (re-runs only the cheap
  // visualize/tonemap pass against this same accumulated histogram).
  let renderTotalSamples = 0;
  // Chaos work is run host-orchestrated (reset → chunked iterate → present)
  // rather than via the renderer.render() convenience, so the dispatch can be
  // split into TDR-safe submits on Windows (see chunkedIterate). Off-win32 this
  // collapses to a single submit — byte-identical to render()'s single-shot.
  if (sampleInflate === 1 && walkersOverride === null) {
    const seed = seedOverride ?? ((Math.random() * 0xffffffff) >>> 0);
    const targetSpp = genome.quality ?? DEFAULT_SPP;
    const { dispatchWalkers, dispatchIters } = computeDispatch(targetSpp, width, height);
    renderer.reset(genome);
    const totalSamples = chunkedIterate(
      renderer, genome, seed, dispatchWalkers, dispatchIters, walkerJitter,
      { colorMode, flowStrength, flowScale, trap, phaseStrength, phaseFreq },
    );
    renderTotalSamples = totalSamples;
    renderer.present({ genome, outputView: texture.createView(), totalSamples, forceDeOff, transparent });
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
    chunkedIterate(renderer, genome, seed, dispatchWalkers, dispatchIters, walkerJitter, { colorMode, flowStrength, flowScale, trap, phaseStrength, phaseFreq });
    renderTotalSamples = actualSamples * sampleInflate;
    renderer.present({
      genome,
      outputView: texture.createView(),
      totalSamples: renderTotalSamples,
      forceDeOff,
      transparent,
    });
  }

  // 4b. #475 — render-time auto-exposure. Match the HQ exposure to the genome's
  // preview-resolution appearance for display-referred output. The probe target
  // is content-aware (≈1× for well-exposed flames → deadband no-op; large only
  // for thin attractors). Re-presents the same accumulated histogram at the
  // fitted brightness (cheap DE+viz, no re-iterate); the embedded `pyr3` genome
  // stays canonical (auto-exposure is a render-time transform, not a mutation).
  // Skipped for exr-linear (raw histogram path — no display texture to measure).
  if (autoExposure && outFormat !== 'exr-linear') {
    const baseTonemap = genome.tonemap ?? DEFAULT_TONEMAP;
    const baseBrightness = baseTonemap.brightness;
    const isHalf = gpuFormat === 'rgba16float';
    const bpp = isHalf ? 8 : 4;
    const measure = (buf: Uint8Array): number =>
      isHalf ? computeMeanLuminanceHalf(buf) : computeMeanLuminance(buf);

    const targetMean = await measureProbeLuminance(device, genome);
    await device.queue.onSubmittedWorkDone();
    const initialMean = measure(await readTextureTight(device, texture, width, height, bpp));

    const fit = await fitBrightnessToTarget(baseBrightness, targetMean, initialMean, async (b) => {
      const adj: Genome = { ...genome, tonemap: { ...baseTonemap, brightness: b } };
      renderer.present({ genome: adj, outputView: texture.createView(), totalSamples: renderTotalSamples, forceDeOff, transparent });
      await device.queue.onSubmittedWorkDone();
      return measure(await readTextureTight(device, texture, width, height, bpp));
    });

    if (fit.corrected) {
      console.log(
        `[pyr3-render] auto-exposure: brightness ${baseBrightness.toFixed(3)} → ` +
          `${fit.brightness.toFixed(3)} (target ${targetMean.toFixed(2)}, ` +
          `was ${initialMean.toFixed(2)}, now ${fit.finalMean.toFixed(2)}, ${fit.iters} pass${fit.iters === 1 ? '' : 'es'})`,
      );
    }
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
    const tight = await readTextureTight(device, texture, width, height, bytesPerPixel);

    if (outFormat === 'exr') {
      // Default EXR — the LINEAR LIGHT of the display image. The display texels
      // are sRGB-encoded; EXR viewers assume linear + apply sRGB on view, so we
      // store sRGB_to_linear(display) and the viewer round-trips to the editor
      // look. Looks like the flame on open everywhere; no double-gamma. (#334)
      // #388 NaN→0 guard lives inside displayHalfToLinearExr.
      const rgba = displayHalfToLinearExr(tight, width, height);
      outBytes = encodeExr({ width, height, rgba });
    } else if (outFormat === 'png16') {
      // Decode the half-float texels → clamp [0,1] → 16-bit samples.
      const rgba16 = displayHalfToPng16(tight, width, height);
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
