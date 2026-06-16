#!/usr/bin/env -S node --experimental-strip-types
// pyr3-animate — P4 of Animation milestone (#17 / #209).
//
// Renders a sequence of PNG frames from either:
//   • a multi-keyframe `.flam3` file (mirrors flam3-animate env-var conventions
//     begin/end/time/dtime/qs/ss/prefix), or
//   • a `.pyr3.timeline.json` timeline doc (#227) — clips of standalone flames;
//     frame N is rendered at T = N / fps (default fps=30).
//
// For the .flam3 path, frame N is rendered at time T=N (matches
// flam3-animate.c:225-228); the interp module bridges T to a derived Genome via
// `interpolate(animation, T)`. For the timeline path the bridge is
// `timelineGenomeAt(timeline, T)` (reuses interpolate per clip pair).
// Output filename: `<prefix><frame-zero-padded>.png`.

import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';

import { createRenderer, DEFAULT_FILTER_RADIUS } from '../src/renderer';
import { type Genome } from '../src/genome';
import { DEFAULT_WALKER_JITTER } from '../src/chaos';
import { genomeToJson } from '../src/serialize';
import { injectPngTextChunk } from '../src/png-text-chunk';
import { interpolate } from '../src/interpolate';
import { type Animation } from '../src/animation';
import {
  renderAnimationFrame,
  renderTimelineFrame,
  type AnimationFrameRenderOpts,
  type AnimationFrameRenderResult,
} from '../src/animate-render';
import { type Timeline, timelineDuration, timelineGenomeAt } from '../src/timeline';
import { timelineFromJson, TIMELINE_FORMAT } from '../src/timeline-serialize';
import { totalSampleBudget, formatCount, formatEstTime } from '../src/animate-estimate';
import { installWebGPUHost, acquireDawnDevice, parseGenomeText } from './host';
import { parseEasingFlag, parseOutputSizeEnv, parseResumeEnv } from './pyr3-animate-args';
import { rescaleGenomeToOutput, type OutputSize } from '../src/output-size';
import { frameOutPath, shouldSkipFrame, writeFrameAtomic } from './serve/resume-skip';

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

/** Scale a genome's size/quality by ss/qs (flam3-animate semantics). Linear in
 *  the scaled fields, so applying it per keyframe/clip commutes with interp. */
function scaleGenome(g: Genome, ss: number, qs: number): Genome {
  let out = g;
  if (ss !== 1.0) {
    out = {
      ...out,
      scale: out.scale * ss,
      ...(out.size
        ? {
            size: {
              width: Math.max(1, Math.round(out.size.width * ss)),
              height: Math.max(1, Math.round(out.size.height * ss)),
            },
          }
        : {}),
    };
  }
  if (qs !== 1.0 && out.quality !== undefined) {
    out = { ...out, quality: out.quality * qs };
  }
  return out;
}

/** One frame to render: a filename label + the global time to sample at. */
interface FrameJob {
  label: number;
  time: number;
}

/** Path-agnostic render plan — both the .flam3 and timeline inputs reduce to this. */
interface FramePlan {
  describeLines: string[];
  jobs: FrameJob[];
  /** Optional up-front sample-budget estimate (printed when present). */
  upFrontBudget: number | null;
  centerGenomeAt: (time: number) => Genome;
  renderFrame: (
    renderer: ReturnType<typeof createRenderer>,
    time: number,
    opts: AnimationFrameRenderOpts,
  ) => AnimationFrameRenderResult;
}

function isTimelineInput(inputPath: string, text: string): boolean {
  if (inputPath.endsWith('.timeline.json')) return true;
  try {
    return (JSON.parse(text) as { format?: string })?.format === TIMELINE_FORMAT;
  } catch {
    return false;
  }
}

/** Build the timeline render plan (#227). */
function buildTimelinePlan(
  text: string,
  ss: number,
  qs: number,
  nstepsOverride: number | null,
  blurWidthOverride: number | null,
  outputSize: OutputSize | undefined,
): FramePlan {
  let timeline: Timeline = timelineFromJson(text);
  // Per-clip genome prep: ss/qs source-scale first, THEN the #274 absolute
  // output-dims rescale (long-edge anchored). Applying it to the clips up-front
  // — instead of only to the per-frame `centerGenome` used for sizing — keeps
  // `centerGenomeAt` and `renderFrame` on the SAME rescaled timeline. Without
  // this, renderTimelineFrame rendered the native-scale genome into a renderer
  // sized for the rescaled dims → attractor projected off-frame → black (#290).
  // Mirrors the FE preview's `tlScaled` (animate-mount.ts).
  const remapClips = ss !== 1.0 || qs !== 1.0 || outputSize !== undefined;
  const prepGenome = (g: Genome): Genome => {
    let x = ss !== 1.0 || qs !== 1.0 ? scaleGenome(g, ss, qs) : g;
    if (outputSize) x = rescaleGenomeToOutput(x, outputSize);
    return x;
  };
  if (remapClips || nstepsOverride !== null || blurWidthOverride !== null) {
    timeline = {
      ...timeline,
      ...(nstepsOverride !== null ? { ntemporal_samples: nstepsOverride } : {}),
      ...(blurWidthOverride !== null ? { temporal_filter_width: blurWidthOverride } : {}),
      clips: remapClips
        ? timeline.clips.map((c) => ({
            ...c,
            flame: { ...c.flame, genome: prepGenome(c.flame.genome) },
          }))
        : timeline.clips,
    };
  }

  const fps = envInt('fps', 30);
  const total = timelineDuration(timeline);
  const frameCount = Math.max(1, Math.round(total * fps));
  const jobs: FrameJob[] = Array.from({ length: frameCount }, (_, i) => ({
    label: i,
    time: i / fps,
  }));
  return {
    describeLines: [
      `[pyr3-animate] timeline: ${timeline.clips.length} clips, ${total.toFixed(2)}s, ` +
        `${frameCount} frames @ ${fps}fps`,
    ],
    jobs,
    upFrontBudget: null,
    centerGenomeAt: (time) => timelineGenomeAt(timeline, time),
    renderFrame: (renderer, time, opts) => renderTimelineFrame(renderer, timeline, time, opts),
  };
}

/** Build the .flam3 multi-keyframe render plan (pre-#227 behavior, unchanged). */
function buildFlamePlan(
  text: string,
  inputPath: string,
  argv: string[],
  ss: number,
  qs: number,
  nstepsOverride: number | null,
  blurWidthOverride: number | null,
  dtime: number,
  outputSize: OutputSize | undefined,
): FramePlan {
  const parsed = parseGenomeText(text, inputPath);
  if (!parsed.animation) {
    console.error(
      'pyr3-animate: input has no animation surface — single <flame> only.\n' +
        '             Use pyr3-render for single-frame .flam3 / .pyr3.json input.',
    );
    process.exit(1);
  }
  // Apply ss/qs/nsteps to the animation by scaling each keyframe up-front, then
  // the #274 absolute output-dims rescale — keeping `centerGenomeAt` and
  // `renderFrame` on the same rescaled keyframes (see #290 note in
  // buildTimelinePlan).
  const remapKfs = ss !== 1.0 || qs !== 1.0 || outputSize !== undefined;
  const prepGenome = (g: Genome): Genome => {
    let x = ss !== 1.0 || qs !== 1.0 ? scaleGenome(g, ss, qs) : g;
    if (outputSize) x = rescaleGenomeToOutput(x, outputSize);
    return x;
  };
  const animation: Animation =
    !remapKfs && nstepsOverride === null && blurWidthOverride === null
      ? parsed.animation
      : {
          ...parsed.animation,
          ...(nstepsOverride !== null ? { ntemporal_samples: nstepsOverride } : {}),
          ...(blurWidthOverride !== null ? { temporal_filter_width: blurWidthOverride } : {}),
          keyframes: remapKfs
            ? parsed.animation.keyframes.map((k) => prepGenome(k))
            : parsed.animation.keyframes,
        };

  // #224 — optional per-segment easing override (`--easing <json EasingCurve[]>`).
  const easing = parseEasingFlag(argv);
  if (easing) animation.segmentEasing = easing;

  // Default begin/end from keyframe times (flam3-animate.c:181-185 behavior).
  const firstKfTime = animation.keyframes[0]!.time ?? 0;
  const lastKfTime = animation.keyframes[animation.keyframes.length - 1]!.time ?? 0;
  const begin = envInt('begin', Math.floor(firstKfTime));
  const endDefault = Math.max(begin, Math.floor(lastKfTime) - 1);
  const end = envInt('end', endDefault);

  const singleTime = process.env['time'];
  const times: number[] = [];
  if (singleTime !== undefined) {
    const n = parseInt(singleTime, 10);
    if (Number.isFinite(n)) times.push(n);
  } else {
    for (let t = begin; t <= end; t += dtime) times.push(t);
  }
  if (times.length === 0) {
    console.error(`pyr3-animate: empty frame range (begin=${begin} end=${end} dtime=${dtime})`);
    process.exit(1);
  }

  const upFrontBudget = totalSampleBudget(animation, {
    begin: times[0]!,
    end: times[times.length - 1]!,
    dtime,
    qs: 1,
  });
  return {
    describeLines: [
      `[pyr3-animate] ${animation.keyframes.length}-keyframe sequence ` +
        `(times ${animation.keyframes.map((k) => k.time ?? 0).join(', ')})`,
      `[pyr3-animate] rendering ${times.length} frame(s): ` +
        `t=${times[0]}..${times[times.length - 1]} stride ${dtime}`,
    ],
    jobs: times.map((t) => ({ label: t, time: t })),
    upFrontBudget,
    centerGenomeAt: (time) => interpolate(animation, time),
    renderFrame: (renderer, time, opts) => renderAnimationFrame(renderer, animation, time, opts),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('usage: pyr3-animate <input.flam3 | input.timeline.json> [out-dir]');
    console.error('  env: begin end time dtime qs ss width height resume prefix verbose fps nsteps blur');
    process.exit(1);
  }
  const inputPath = resolve(args[0]!);
  const outDir = args[1] ? resolve(args[1]) : process.cwd();
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const prefix = envStr('prefix', '');
  const dtime = envInt('dtime', 1);
  const qs = envFloat('qs', 1.0);
  const ss = envFloat('ss', 1.0);
  // #274 — absolute output dims (width=/height=, both required). Distinct from
  // ss (which scales the source); applied per-frame via the long-edge rescale.
  const outputSize = parseOutputSizeEnv(process.env);
  // #275 — resume=1 skips frames already on disk (default off for scripted runs).
  const resume = parseResumeEnv(process.env);
  const verbose = envInt('verbose', 1);
  // pyr3-specific motion-blur overrides (flam3-animate has no equivalents):
  //   nsteps=N — override ntemporal_samples (default = imported).
  //   blur=W   — override temporal_filter_width.
  const nstepsOverride = process.env['nsteps'] !== undefined ? envInt('nsteps', 1) : null;
  const blurWidthOverride = process.env['blur'] !== undefined ? envFloat('blur', 1.0) : null;

  if (dtime < 1) {
    console.error('pyr3-animate: dtime must be positive');
    process.exit(1);
  }

  const text = readFileSync(inputPath, 'utf8');
  const plan = isTimelineInput(inputPath, text)
    ? buildTimelinePlan(text, ss, qs, nstepsOverride, blurWidthOverride, outputSize)
    : buildFlamePlan(text, inputPath, args, ss, qs, nstepsOverride, blurWidthOverride, dtime, outputSize);

  if (verbose) {
    for (const line of plan.describeLines) console.log(line);
    if (plan.upFrontBudget !== null) {
      console.log(
        `[pyr3-animate] est. work: ${plan.jobs.length} frames · ` +
          `${formatCount(plan.upFrontBudget)} samples total`,
      );
    }
  }

  // Acquire GPU device + texture/renderer (rebuilt per-frame only if dims change).
  const device = await acquireDawnDevice('pyr3-animate');

  let renderer: ReturnType<typeof createRenderer> | null = null;
  let texture: GPUTexture | null = null;
  let cached: { width: number; height: number; oversample: number; filterRadius: number } | null = null;

  // #226 — running ETA accumulator (wall-clock per-frame average drives the ETA).
  let doneSeconds = 0;
  let frameNum = 0;

  // 5-digit zero-pad (ffmpeg %05d convention), widened to fit the largest label.
  const padWidth = Math.max(5, String(plan.jobs[plan.jobs.length - 1]?.label ?? 0).length);

  for (const job of plan.jobs) {
    const outPath = frameOutPath(outDir, prefix, job.label, padWidth);
    // #275 — resume: skip frames already on disk before any GPU work.
    if (shouldSkipFrame(outPath, resume)) {
      if (verbose) console.log(`[pyr3-animate] skip ${outPath.slice(outDir.length + 1)} (exists)`);
      continue;
    }
    // #290 — the output-dims rescale is applied to the plan's clips/keyframes
    // up-front (see buildTimelinePlan), so `centerGenome` here is ALREADY at the
    // target dims and matches what `renderFrame` renders. (Previously the rescale
    // happened only here, sizing the renderer for output dims while renderFrame
    // drew the native-scale genome → off-frame → black.)
    const centerGenome: Genome = plan.centerGenomeAt(job.time);

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
    const frameResult = plan.renderFrame(renderer!, job.time, {
      outputView: texture!.createView(),
      walkerJitter: DEFAULT_WALKER_JITTER,
    });
    // genome used for PNG metadata = the center-time genome.
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

    const outName = outPath.slice(outDir.length + 1);
    writeFrameAtomic(outPath, withMetadata);

    const frameSeconds = (Date.now() - t0) / 1000;
    frameNum++;
    doneSeconds += frameSeconds;

    if (verbose) {
      const elapsed = frameSeconds.toFixed(2);
      const framesLeft = plan.jobs.length - frameNum;
      let etaSuffix = '';
      if (framesLeft > 0) {
        // Wall-clock per-frame average × frames remaining — a self-correcting
        // measured ETA, independent of the up-front cost model (#278). The
        // model is for the FE's BEFORE-render gauge; here we have real timings.
        const remSec = (doneSeconds / frameNum) * framesLeft;
        etaSuffix = ` · est. time remaining ${formatEstTime(remSec)} (${framesLeft} left)`;
      }
      console.log(
        `[pyr3-animate] wrote ${outName} (${width}×${height}) in ${elapsed}s${etaSuffix}`,
      );
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
