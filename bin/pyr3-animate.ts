#!/usr/bin/env -S node --experimental-strip-types
// pyr3-animate — P4 of Animation milestone (#17 / #209).
//
// Renders a sequence of PNG frames from a multi-keyframe `.flam3` file.
// Mirrors flam3-animate env-var conventions (begin/end/time/dtime/qs/ss/prefix).
//
// Usage:
//   pyr3-animate <input.flam3> [out-dir]
//   env: begin end time dtime qs ss prefix verbose
//
// Frame N is rendered at time T=N (matches flam3-animate.c:225-228 — f.time =
// (double) ftime); the interp module bridges T to a derived Genome via
// `interpolate(animation, T)`. Output filename: `<prefix><frame-zero-padded>.png`.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';

import { createRenderer, DEFAULT_FILTER_RADIUS } from '../src/renderer';
import { type Genome } from '../src/genome';
import { DEFAULT_WALKER_JITTER } from '../src/chaos';
import { genomeToJson } from '../src/serialize';
import { injectPngTextChunk } from '../src/png-text-chunk';
import { interpolate } from '../src/interpolate';
import { type Animation } from '../src/animation';
import { renderAnimationFrame } from '../src/animate-render';
import { installWebGPUHost, acquireDawnDevice, parseGenomeText } from './host';

installWebGPUHost();

function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined) return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
function envFloat(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function envStr(name: string, def: string): string {
  return process.env[name] ?? def;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('usage: pyr3-animate <input.flam3> [out-dir]');
    console.error('  env: begin end time dtime qs ss prefix verbose');
    process.exit(1);
  }
  const inputPath = resolve(args[0]!);
  const outDir = args[1] ? resolve(args[1]) : process.cwd();
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const prefix = envStr('prefix', '');
  const dtime = envInt('dtime', 1);
  const qs = envFloat('qs', 1.0);
  const ss = envFloat('ss', 1.0);
  const verbose = envInt('verbose', 1);
  // pyr3-specific overrides for motion-blur tuning. flam3-animate has no
  // equivalents; pyr3 adds them so smoke tests don't burn 1000× per frame:
  //   nsteps=N    — override Animation.ntemporal_samples (default = imported).
  //   blur=W      — override Animation.temporal_filter_width. Bigger W spans
  //                 more inter-frame time → more visible motion blur on
  //                 sparse animations.
  const nstepsOverride = process.env['nsteps'] !== undefined
    ? envInt('nsteps', 1)
    : null;
  const blurWidthOverride = process.env['blur'] !== undefined
    ? envFloat('blur', 1.0)
    : null;

  if (dtime < 1) {
    console.error('pyr3-animate: dtime must be positive');
    process.exit(1);
  }

  // Load + parse the .flam3.
  const text = readFileSync(inputPath, 'utf8');
  const parsed = parseGenomeText(text, inputPath);
  if (!parsed.animation) {
    console.error(
      'pyr3-animate: input has no animation surface — single <flame> only.\n' +
        '             Use pyr3-render for single-frame .flam3 / .pyr3.json input.',
    );
    process.exit(1);
  }
  // Apply ss/qs/nsteps to the animation by scaling each keyframe up-front.
  // Same semantics as flam3-animate (scales sample_density, width/height,
  // ppu by qs/ss). Scaling each keyframe once is correct because
  // interpolation is linear in the scaled fields — scaling commutes with
  // the linear blend.
  const animation: Animation = (
    ss === 1.0 && qs === 1.0 &&
    nstepsOverride === null && blurWidthOverride === null
  )
    ? parsed.animation
    : {
        ...parsed.animation,
        ...(nstepsOverride !== null ? { ntemporal_samples: nstepsOverride } : {}),
        ...(blurWidthOverride !== null ? { temporal_filter_width: blurWidthOverride } : {}),
        keyframes: parsed.animation.keyframes.map((k) => {
          let g: Genome = k;
          if (ss !== 1.0) {
            g = {
              ...g,
              scale: g.scale * ss,
              ...(g.size
                ? {
                    size: {
                      width: Math.max(1, Math.round(g.size.width * ss)),
                      height: Math.max(1, Math.round(g.size.height * ss)),
                    },
                  }
                : {}),
            };
          }
          if (qs !== 1.0 && g.quality !== undefined) {
            g = { ...g, quality: g.quality * qs };
          }
          return g;
        }),
      };

  // Default begin/end from keyframe times (flam3-animate.c:181-185 behavior).
  const firstKfTime = animation.keyframes[0]!.time ?? 0;
  const lastKfTime = animation.keyframes[animation.keyframes.length - 1]!.time ?? 0;
  const begin = envInt('begin', Math.floor(firstKfTime));
  // flam3 default for `end` is `last_keyframe.time - 1`, but we add a guard so
  // a single-time-zero pair (rare) still renders at least one frame.
  const endDefault = Math.max(begin, Math.floor(lastKfTime) - 1);
  const end = envInt('end', endDefault);

  // Single-frame override.
  const singleTime = process.env['time'];

  const frames: number[] = [];
  if (singleTime !== undefined) {
    const n = parseInt(singleTime, 10);
    if (Number.isFinite(n)) frames.push(n);
  } else {
    for (let t = begin; t <= end; t += dtime) frames.push(t);
  }

  if (frames.length === 0) {
    console.error(`pyr3-animate: empty frame range (begin=${begin} end=${end} dtime=${dtime})`);
    process.exit(1);
  }

  if (verbose) {
    console.log(
      `[pyr3-animate] ${animation.keyframes.length}-keyframe sequence ` +
        `(times ${animation.keyframes.map((k) => k.time ?? 0).join(', ')})`,
    );
    console.log(
      `[pyr3-animate] rendering ${frames.length} frame(s): ` +
        `t=${frames[0]}..${frames[frames.length - 1]} stride ${dtime}`,
    );
  }

  // Acquire GPU device + texture/renderer (rebuilt per-frame only if dims change).
  const device = await acquireDawnDevice('pyr3-animate');

  let renderer: ReturnType<typeof createRenderer> | null = null;
  let texture: GPUTexture | null = null;
  let cached: { width: number; height: number; oversample: number; filterRadius: number } | null = null;

  for (const t of frames) {
    // ss/qs already baked into `animation` upfront; interpolate just picks
    // dims off the scaled keyframes.
    const centerGenome: Genome = interpolate(animation, t);

    const width = centerGenome.size?.width ?? 1024;
    const height = centerGenome.size?.height ?? 1024;
    const oversample = Math.max(1, Math.floor(centerGenome.oversample ?? 1));
    const filterRadius = centerGenome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;

    if (
      !cached ||
      cached.width !== width ||
      cached.height !== height ||
      cached.oversample !== oversample ||
      cached.filterRadius !== filterRadius
    ) {
      cached = { width, height, oversample, filterRadius };
      renderer = createRenderer(device, 'rgba8unorm', { width, height, oversample, filterRadius });
      texture = device.createTexture({
        label: 'pyr3-animate.output',
        size: { width, height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
    }

    const t0 = Date.now();
    // P5 #210 — when animation.ntemporal_samples > 1, this routes through the
    // temporal-sampled path (N sub-renders at t + delta[i], walkers
    // proportional to filter[i]/sumfilt). When ==1, it's a single interp+render.
    const frameResult = renderAnimationFrame(renderer!, animation, t, {
      outputView: texture!.createView(),
      walkerJitter: DEFAULT_WALKER_JITTER,
    });
    // genome used for PNG metadata = the center-time genome (matches the
    // visual midpoint of any motion-blur smear).
    const genome = frameResult.centerGenome;

    // Read back texture → PNG.
    const bytesPerPixel = 4;
    const unpaddedBytesPerRow = width * bytesPerPixel;
    const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
    const readBuf = device.createBuffer({
      label: 'pyr3-animate.readback',
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder({ label: 'pyr3-animate.encoder' });
    encoder.copyTextureToBuffer(
      { texture: texture! },
      { buffer: readBuf, bytesPerRow, rowsPerImage: height },
      { width, height },
    );
    device.queue.submit([encoder.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();
    readBuf.destroy();

    const tight = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const srcOff = y * bytesPerRow;
      const dstOff = y * unpaddedBytesPerRow;
      tight.set(padded.subarray(srcOff, srcOff + unpaddedBytesPerRow), dstOff);
    }

    const png = new PNG({ width, height });
    png.data = Buffer.from(tight.buffer, tight.byteOffset, tight.byteLength);
    const pngBuf = PNG.sync.write(png);
    const pyr3Json = JSON.stringify(genomeToJson(genome));
    const withMetadata = injectPngTextChunk(
      new Uint8Array(pngBuf.buffer, pngBuf.byteOffset, pngBuf.byteLength),
      'pyr3',
      pyr3Json,
    );

    const frameStr = String(t).padStart(5, '0');
    const outName = `${prefix}${frameStr}.png`;
    const outPath = resolve(outDir, outName);
    writeFileSync(outPath, withMetadata);

    if (verbose) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
      console.log(`[pyr3-animate] wrote ${outName} (${width}×${height}) in ${elapsed}s`);
    }
  }

  // Drop navigator so node exits (Dawn-node README guidance).
  delete (globalThis as { navigator?: unknown }).navigator;
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('pyr3-animate: failed —', err);
  process.exit(1);
});
