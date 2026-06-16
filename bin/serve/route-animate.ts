// POST /api/animate — accept a `.flam3` XML payload + export params, parse
// the multi-keyframe animation, render each frame on the backend GPU, write
// PNGs to a host-filesystem directory, and stream SSE progress events. The
// browser viewer hits this from the "Export sequence" button on
// `/v1/animate` (#212 / P7 of milestone #17).
//
// SSE event shape mirrors /api/render so the FE can share the SSE-parsing
// helper:
//   event: open       → { jobId }
//   event: progress   → { frame, total, percent, written: '<filename>' }
//   event: done       → { written: ['<abs path>', ...] }
//   event: cancelled  → { jobId, written: ['<abs path>', ...] }
//   event: error      → { message }
//
// Partial PNGs that hit disk before a cancel STAY on disk — matches
// flam3-animate's behaviour and the issue's UX spec ("partial PNGs remain
// on disk; user sees a 'cancelled at frame N' toast").

import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve as resolvePath, isAbsolute, sep } from 'node:path';

import { parseFlame } from '../../src/flame-import';
import { type EasingCurve } from '../../src/easing';
import { timelineFromJson } from '../../src/timeline-serialize';
import { timelineDuration } from '../../src/timeline';

import { createJob, clearJob } from './jobs';
import { frameOutPath, shouldSkipFrame, writeFrameAtomic } from './resume-skip';
import { thumbnailDataUri, shouldEmitThumb } from './frame-thumbnail';
import {
  FrameSequenceRenderContext,
  animationFrameSource,
  timelineFrameSource,
  applyExportOverrides,
  applyTimelineExportOverrides,
  applyOutputSizeToAnimation,
  applyOutputSizeToTimeline,
  type FrameSource,
  type AnimationFrameRequest,
  type InFlightFrame,
} from './render-animation-png';

interface AnimateRequestBody {
  /** Raw `.flam3` XML payload — server parses with parseFlame. */
  flame_xml: string;
  /** Inclusive frame range. Defaults derived from keyframe time range when
   *  omitted. flam3-animate uses end = floor(lastKfTime) - 1. */
  begin?: number;
  end?: number;
  /** Frame stride. Default 1. */
  dtime?: number;
  /** Quality scale (multiplies each keyframe's quality). Default 1.0. */
  qs?: number;
  /** Size scale (multiplies each keyframe's scale + size). Default 1.0. */
  ss?: number;
  /** Filename prefix; output is `<prefix><frame:05d>.png`. Default ''. */
  prefix?: string;
  /** Output directory. Absolute or relative to `pyr3 serve`'s cwd. Required. */
  out_dir: string;
  /** #274 — absolute output dimensions (long-edge rescale). Both must be set. */
  out_width?: number;
  out_height?: number;
  /** #275 — skip frames whose PNG already exists (resume a partial export). */
  resume?: boolean;
  /** Override the animation's ntemporal_samples (motion blur sub-frames). */
  nsteps?: number;
  /** Override temporal_filter_width. */
  blur_width?: number;
  /** Per-walker jitter override. Default DEFAULT_WALKER_JITTER. */
  walker_jitter?: number;
  /** Deterministic seed base. */
  seed?: number;
  /** Per-segment easing curves (#224). Stamped onto the parsed animation —
   *  flam3 XML has no easing slot. Index i applies to keyframes[i]→[i+1]. */
  segment_easing?: (EasingCurve | undefined)[];
  /** Serialized .pyr3.timeline.json — alternative to flame_xml (#227). Exactly
   *  one of flame_xml | timeline_json is required. */
  timeline_json?: string;
  /** Frames per second for timeline export. Default 30. */
  fps?: number;
  /** Absolute quality (samples/px) applied to every clip — timeline only. */
  quality?: number;
}

/** Stamp request-provided per-segment easing onto the parsed animation.
 *  No-op unless `segment_easing` is an array — the engine tolerates unknown
 *  curve kinds, so no deep validation is needed here. */
export function applySegmentEasing(
  animation: { segmentEasing?: (EasingCurve | undefined)[] },
  body: { segment_easing?: unknown },
): void {
  if (Array.isArray(body.segment_easing)) {
    animation.segmentEasing = body.segment_easing as (EasingCurve | undefined)[];
  }
}

/** Frame list for a timeline export at `fps`. Mirrors the CLI buildTimelinePlan:
 *  frameCount = max(1, round(duration × fps)), frame i renders at time i/fps and
 *  is named by its index (not its fractional time). Non-positive fps → 30. */
export function computeTimelineFrames(
  durationSeconds: number,
  fps: number,
): { index: number; time: number }[] {
  const f = fps > 0 ? fps : 30;
  const frameCount = Math.max(1, Math.round(Math.max(0, durationSeconds) * f));
  return Array.from({ length: frameCount }, (_, i) => ({ index: i, time: i / f }));
}

function readJsonBody(req: IncomingMessage, limitBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error(`request body too large (> ${limitBytes} bytes)`));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(text));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function writeSseEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function jsonError(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: message }));
}

export function makeAnimateRoute(deviceProvider: () => GPUDevice) {
  return async function handleAnimate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: AnimateRequestBody;
    try {
      // 8 MB body cap — XML payloads top out around a few hundred KB even
      // for long ESF chains; bigger is hostile / runaway.
      body = (await readJsonBody(req, 8 * 1024 * 1024)) as AnimateRequestBody;
    } catch (err) {
      jsonError(res, 400, (err as Error).message);
      return;
    }

    // Exactly one of flame_xml (animation) | timeline_json (#227) is required.
    const hasTimeline = typeof body.timeline_json === 'string' && body.timeline_json.length > 0;
    const hasFlame = typeof body.flame_xml === 'string' && body.flame_xml.length > 0;
    if (hasTimeline === hasFlame) {
      jsonError(res, 400, 'exactly one of flame_xml | timeline_json is required');
      return;
    }
    if (typeof body.out_dir !== 'string' || body.out_dir.length === 0) {
      jsonError(res, 400, 'out_dir is required');
      return;
    }
    // Guard against path traversal up front — the prefix is concatenated
    // with the frame number to form the filename, then resolved against
    // out_dir. Without a check, a prefix like "../" or "/etc/passwd"
    // could escape out_dir and write to arbitrary paths. pyr3 serve only
    // listens on 127.0.0.1 so the attack surface is narrow, but the cost
    // of the check is zero and defense-in-depth is cheap.
    const prefix = body.prefix ?? '';
    if (/[\\/]|\.\./.test(prefix)) {
      jsonError(res, 400, 'prefix must not contain path separators or ".."');
      return;
    }

    // Build a FrameSource + frameJobs ({ label, time }: label is the filename
    // number, time is the render time) for whichever input was provided.
    let source: FrameSource;
    let frameJobs: { label: number; time: number }[];

    // #274 — absolute output dims (both required); applied per-keyframe/clip via
    // the long-edge rescale. Distinct from `ss` (which scales the source).
    // #303 — validate: both-or-neither, and finite > 0. An unvalidated NaN/-100
    // would flow through rescaleGenomeToOutput into device.createTexture and
    // throw on an already-200 SSE stream.
    const hasW = body.out_width !== undefined;
    const hasH = body.out_height !== undefined;
    if (hasW !== hasH) {
      jsonError(res, 400, 'out_width and out_height must both be provided (or neither)');
      return;
    }
    let outputSize: { width: number; height: number } | undefined;
    if (hasW && hasH) {
      const ow = Number(body.out_width);
      const oh = Number(body.out_height);
      if (!Number.isFinite(ow) || !Number.isFinite(oh) || ow <= 0 || oh <= 0) {
        jsonError(res, 400, 'out_width / out_height must be finite numbers > 0');
        return;
      }
      outputSize = { width: Math.round(ow), height: Math.round(oh) };
    }

    if (hasTimeline) {
      let timeline;
      try {
        timeline = timelineFromJson(body.timeline_json!);
      } catch (err) {
        jsonError(res, 400, `failed to parse timeline JSON: ${(err as Error).message}`);
        return;
      }
      // Absolute quality (every clip) + collapse ntemporal_samples to 1 (no
      // per-frame motion blur) unless the caller opts in via `nsteps`. The
      // nsteps default mirrors the animation path: createTimeline() inherits
      // FLAM3_ANIMATION_DEFAULTS.ntemporal_samples=1000, so an authored timeline
      // would otherwise render 1000 sub-frames per frame (minutes each, no
      // mid-frame cancel) — the same ESF trap the animation path guards.
      timeline = applyTimelineExportOverrides(timeline, {
        ...(body.quality !== undefined ? { quality: body.quality } : {}),
        nsteps: body.nsteps ?? 1,
      });
      timeline = applyOutputSizeToTimeline(timeline, outputSize);
      const tlFrames = computeTimelineFrames(timelineDuration(timeline), body.fps ?? 30);
      frameJobs = tlFrames.map((fr) => ({ label: fr.index, time: fr.time }));
      source = timelineFrameSource(timeline);
    } else {
      let parsed: ReturnType<typeof parseFlame>;
      try {
        parsed = parseFlame(body.flame_xml!);
      } catch (err) {
        jsonError(res, 400, `failed to parse flame XML: ${(err as Error).message}`);
        return;
      }
      if (!parsed.animation) {
        jsonError(res, 400, 'flame_xml has no animation surface — single <flame> only');
        return;
      }
      applySegmentEasing(parsed.animation, body);

      // Default ntemporal_samples to 1 (no per-frame motion blur) for the
      // sequence-export path. ESF .flam3 files author ntemporal_samples=1000
      // (offline-quality motion blur budget); without this override each
      // frame would be a 1000-sub-render stack — minutes-to-hours per frame
      // and no cancel hook fires until a frame completes. flam3-render's
      // static-render path already force-collapses ntemporal_samples to 1;
      // we mirror that here. Callers can opt into motion blur explicitly
      // via the `nsteps` body field.
      const animation = applyOutputSizeToAnimation(
        applyExportOverrides(parsed.animation, {
          qs: body.qs,
          ss: body.ss,
          nsteps: body.nsteps ?? 1,
          ...(body.blur_width !== undefined ? { blurWidth: body.blur_width } : {}),
        }),
        outputSize,
      );

      const firstKfTime = animation.keyframes[0]!.time ?? 0;
      const lastKfTime = animation.keyframes[animation.keyframes.length - 1]!.time ?? 0;
      const begin = Math.floor(body.begin ?? firstKfTime);
      const endDefault = Math.max(begin, Math.floor(lastKfTime) - 1);
      const end = Math.floor(body.end ?? endDefault);
      const dtime = Math.max(1, Math.floor(body.dtime ?? 1));

      const labels: number[] = [];
      for (let t = begin; t <= end; t += dtime) labels.push(t);
      if (labels.length === 0) {
        jsonError(res, 400, `empty frame range (begin=${begin} end=${end} dtime=${dtime})`);
        return;
      }
      frameJobs = labels.map((t) => ({ label: t, time: t }));
      source = animationFrameSource(animation);
    }

    // Resolve out_dir against cwd; create if missing. Then realpath-resolve so
    // the per-frame containment check below operates on the symlink-resolved
    // path (#258): if out_dir is/contains a symlink, the lexical prefix check
    // alone would pass while writes followed the link elsewhere. The same-
    // origin guard (#230) already bars cross-origin callers from reaching this
    // route at all; this is filesystem-level defense-in-depth.
    const requestedDir = isAbsolute(body.out_dir) ? body.out_dir : resolvePath(process.cwd(), body.out_dir);
    let outDir: string;
    try {
      if (!existsSync(requestedDir)) mkdirSync(requestedDir, { recursive: true });
      outDir = realpathSync(requestedDir);
    } catch (err) {
      jsonError(res, 400, `failed to create out_dir ${requestedDir}: ${(err as Error).message}`);
      return;
    }

    const job = createJob();

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Job-ID', job.id);
    res.flushHeaders?.();
    writeSseEvent(res, 'open', { jobId: job.id, frames: frameJobs.length, out_dir: outDir });

    req.on('close', () => {
      if (!job.controller.signal.aborted) job.controller.abort();
    });

    const ctx = new FrameSequenceRenderContext(deviceProvider(), source);
    const written: string[] = [];
    // 5-digit zero-pad (matches the ffmpeg %05d convention); auto-widen only if
    // the largest frame label needs more (a >99999-frame timeline ≈ 55min@30fps).
    const padWidth = Math.max(5, String(frameJobs[frameJobs.length - 1]!.label).length);

    // #275 — resume: precompute each frame's final path; skip ones already on
    // disk (don't re-render). Progress is reported against ALL frames (skipped +
    // rendered) so the bar reflects true position; skipped frames tick instantly.
    const resume = body.resume ?? false;
    const total = frameJobs.length;
    const annotated = frameJobs.map((j) => ({
      label: j.label,
      time: j.time,
      outPath: frameOutPath(outDir, prefix, j.label, padWidth),
    }));
    const renderJobs = annotated.filter((j) => !shouldSkipFrame(j.outPath, resume));
    let completed = 0;

    console.log(
      `[pyr3-serve] /api/animate job ${job.id.slice(0, 8)} — ${total} frame(s) → ${outDir}`
      + (resume ? ` (resume: ${total - renderJobs.length} already on disk)` : ''),
    );

    // Tick skipped frames up-front (they cost ~0).
    for (const j of annotated) {
      if (shouldSkipFrame(j.outPath, resume)) {
        completed++;
        written.push(j.outPath);
        writeSseEvent(res, 'progress', {
          frame: completed, total, percent: completed / total, written: j.outPath,
        });
      }
    }

    // #214 — depth-1 pipeline: submit frame N+1's GPU work before encoding
    // frame N on the CPU, so the host PNG encode + writeFileSync overlaps with
    // the next frame's GPU iterate (the GPU was previously idle during encode).
    // Indexes renderJobs (skipped frames never enter the GPU pipeline).
    const reqFor = (i: number): AnimationFrameRequest => {
      const frameSeed = body.seed !== undefined ? body.seed + i : undefined;
      return {
        time: renderJobs[i]!.time,
        ...(body.walker_jitter !== undefined ? { walkerJitter: body.walker_jitter } : {}),
        ...(frameSeed !== undefined ? { seed: frameSeed } : {}),
      };
    };

    // Hoisted so the `finally` can drain whatever frame is still in flight on
    // any exit path (abort, path-traversal, finishFrame throw, normal done).
    let inflight: InFlightFrame | null = null;
    // #279 — throttle preview thumbnails to ≤1 per 500ms (the final frame always
    // gets one). Frame/path/percent still update on every progress event.
    let lastThumbAt: number | null = null;
    try {
      // Prime the pipeline with the first render-job's GPU work already in flight.
      inflight = renderJobs.length > 0 ? ctx.submitFrame(reqFor(0)) : null;

      for (let i = 0; i < renderJobs.length; i++) {
        if (job.controller.signal.aborted) {
          writeSseEvent(res, 'cancelled', { jobId: job.id, written });
          res.end();
          return;
        }
        const label = renderJobs[i]!.label;
        const outPath = renderJobs[i]!.outPath;
        const t0 = Date.now();
        const cur = inflight!;
        // Kick off the next frame's GPU work before we await + encode this one.
        inflight = i + 1 < renderJobs.length ? ctx.submitFrame(reqFor(i + 1)) : null;
        const result = await ctx.finishFrame(cur);

        // Belt-and-suspenders: confirm the resolved path stays under out_dir.
        // The prefix regex above already blocks separators / .., and `outDir`
        // is realpath-resolved (so this is a real containment check, not the
        // purely-lexical one the old comment wrongly claimed defeated symlinks).
        if (!outPath.startsWith(outDir + sep) && outPath !== outDir) {
          writeSseEvent(res, 'error', { message: 'path traversal blocked' });
          res.end();
          return;
        }
        writeFrameAtomic(outPath, result.png);
        written.push(outPath);
        completed++;

        const elapsedMs = Date.now() - t0;
        console.log(
          `[pyr3-serve]   frame ${completed}/${total} label=${label} ${result.width}×${result.height} → ${outPath.slice(outDir.length + 1)} (${(elapsedMs / 1000).toFixed(1)}s)`,
        );

        const isFinalFrame = i === renderJobs.length - 1;
        const nowMs = Date.now();
        let thumb: string | undefined;
        if (isFinalFrame || shouldEmitThumb(lastThumbAt, nowMs)) {
          thumb = thumbnailDataUri(result.rgba, result.width, result.height);
          lastThumbAt = nowMs;
        }
        writeSseEvent(res, 'progress', {
          frame: completed,
          total,
          percent: completed / total,
          written: outPath,
          ...(thumb ? { thumb } : {}),
        });
      }

      console.log(`[pyr3-serve] /api/animate job ${job.id.slice(0, 8)} — done (${written.length} files)`);
      writeSseEvent(res, 'done', { written });
      res.end();
    } catch (err) {
      console.error(`[pyr3-serve] /api/animate job ${job.id.slice(0, 8)} — error:`, err);
      writeSseEvent(res, 'error', { message: (err as Error).message });
      res.end();
    } finally {
      // Drain any frame whose GPU work is still in flight but was never
      // finished (abort / path-traversal / finishFrame throw). destroy()
      // rejects the pending mapAsync — swallow it so it isn't unhandled.
      if (inflight) { inflight.mapped.catch(() => {}); inflight.readBuf.destroy(); }
      ctx.destroy();
      clearJob(job.id);
    }
  };
}
