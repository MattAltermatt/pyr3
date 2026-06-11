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
import { existsSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve as resolvePath, isAbsolute, sep } from 'node:path';

import { parseFlame } from '../../src/flame-import';

import { createJob, clearJob } from './jobs';
import { AnimationRenderContext, applyExportOverrides } from './render-animation-png';

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
  /** Override the animation's ntemporal_samples (motion blur sub-frames). */
  nsteps?: number;
  /** Override temporal_filter_width. */
  blur_width?: number;
  /** Per-walker jitter override. Default DEFAULT_WALKER_JITTER. */
  walker_jitter?: number;
  /** Deterministic seed base. */
  seed?: number;
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

    if (typeof body.flame_xml !== 'string' || body.flame_xml.length === 0) {
      jsonError(res, 400, 'flame_xml is required (raw .flam3 XML)');
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

    let parsed: ReturnType<typeof parseFlame>;
    try {
      parsed = parseFlame(body.flame_xml);
    } catch (err) {
      jsonError(res, 400, `failed to parse flame XML: ${(err as Error).message}`);
      return;
    }
    if (!parsed.animation) {
      jsonError(res, 400, 'flame_xml has no animation surface — single <flame> only');
      return;
    }

    // Default ntemporal_samples to 1 (no per-frame motion blur) for the
    // sequence-export path. ESF .flam3 files author ntemporal_samples=1000
    // (offline-quality motion blur budget); without this override each
    // frame would be a 1000-sub-render stack — minutes-to-hours per frame
    // and no cancel hook fires until a frame completes. flam3-render's
    // static-render path already force-collapses ntemporal_samples to 1;
    // we mirror that here. Callers can opt into motion blur explicitly
    // via the `nsteps` body field.
    const animation = applyExportOverrides(parsed.animation, {
      qs: body.qs,
      ss: body.ss,
      nsteps: body.nsteps ?? 1,
      ...(body.blur_width !== undefined ? { blurWidth: body.blur_width } : {}),
    });

    const firstKfTime = animation.keyframes[0]!.time ?? 0;
    const lastKfTime = animation.keyframes[animation.keyframes.length - 1]!.time ?? 0;
    const begin = Math.floor(body.begin ?? firstKfTime);
    const endDefault = Math.max(begin, Math.floor(lastKfTime) - 1);
    const end = Math.floor(body.end ?? endDefault);
    const dtime = Math.max(1, Math.floor(body.dtime ?? 1));

    const frames: number[] = [];
    for (let t = begin; t <= end; t += dtime) frames.push(t);
    if (frames.length === 0) {
      jsonError(res, 400, `empty frame range (begin=${begin} end=${end} dtime=${dtime})`);
      return;
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
    writeSseEvent(res, 'open', { jobId: job.id, frames: frames.length, out_dir: outDir });

    req.on('close', () => {
      if (!job.controller.signal.aborted) job.controller.abort();
    });

    const ctx = new AnimationRenderContext(deviceProvider(), animation);
    const written: string[] = [];

    console.log(`[pyr3-serve] /api/animate job ${job.id.slice(0, 8)} — ${frames.length} frame(s) → ${outDir}`);

    try {
      for (let i = 0; i < frames.length; i++) {
        if (job.controller.signal.aborted) {
          writeSseEvent(res, 'cancelled', { jobId: job.id, written });
          res.end();
          return;
        }
        const t = frames[i]!;
        const frameSeed = body.seed !== undefined ? body.seed + i : undefined;
        const t0 = Date.now();
        const result = await ctx.renderFrame({
          time: t,
          ...(body.walker_jitter !== undefined ? { walkerJitter: body.walker_jitter } : {}),
          ...(frameSeed !== undefined ? { seed: frameSeed } : {}),
        });

        const frameStr = String(t).padStart(5, '0');
        const filename = `${prefix}${frameStr}.png`;
        const outPath = resolvePath(outDir, filename);
        // Belt-and-suspenders: confirm the resolved path stays under out_dir.
        // The prefix regex above already blocks separators / .., and `outDir`
        // is realpath-resolved (so this is a real containment check, not the
        // purely-lexical one the old comment wrongly claimed defeated symlinks).
        if (!outPath.startsWith(outDir + sep) && outPath !== outDir) {
          writeSseEvent(res, 'error', { message: 'path traversal blocked' });
          res.end();
          return;
        }
        writeFileSync(outPath, result.png);
        written.push(outPath);

        const elapsedMs = Date.now() - t0;
        console.log(
          `[pyr3-serve]   frame ${i + 1}/${frames.length} t=${t} ${result.width}×${result.height} → ${filename} (${(elapsedMs / 1000).toFixed(1)}s)`,
        );

        writeSseEvent(res, 'progress', {
          frame: i + 1,
          total: frames.length,
          percent: (i + 1) / frames.length,
          written: outPath,
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
      ctx.destroy();
      clearJob(job.id);
    }
  };
}
