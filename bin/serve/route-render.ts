// POST /api/render — accept genome JSON + render spec, run the GPU
// chunked-iterate loop, stream SSE progress events, send the final PNG
// bytes as a base64 `done` event. Cancel via POST /api/cancel/:id.

import type { IncomingMessage, ServerResponse } from 'node:http';

import { genomeFromJson } from '../../src/serialize';
import { type Genome } from '../../src/genome';

import { createJob, clearJob } from './jobs';
import { AbortedError, renderGenomeToPng, type RenderProgress, type RenderFormat } from './render-png';

interface RenderRequestBody {
  genome: unknown;
  /** Output dimensions. Renderer resizes to these. */
  dim: { width: number; height: number };
  /** Samples per pixel — same semantic as `genome.quality`. */
  quality: number;
  oversample?: number;
  walkerJitter?: number;
  seed?: number;
  /** #334 — output format (default png8). */
  format?: string;
  /** #334 — transparent background for png8/png16. */
  transparent?: boolean;
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

export function makeRenderRoute(deviceProvider: () => GPUDevice) {
  return async function handleRender(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: RenderRequestBody;
    try {
      // 64 MB body cap — a 4K genome JSON is well under 1 MB; anything
      // bigger is likely a runaway / hostile payload.
      body = (await readJsonBody(req, 64 * 1024 * 1024)) as RenderRequestBody;
    } catch (err) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: (err as Error).message }));
      return;
    }

    let genome: Genome;
    try {
      genome = genomeFromJson(body.genome);
    } catch (err) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: `invalid genome JSON: ${(err as Error).message}` }));
      return;
    }

    const width = Math.max(1, Math.floor(body.dim?.width ?? 1024));
    const height = Math.max(1, Math.floor(body.dim?.height ?? 1024));
    const quality = Math.max(1, Math.round(body.quality ?? genome.quality ?? 50));
    // #334 — validate format; unknown values fall back to png8.
    const format: RenderFormat =
      body.format === 'png16' || body.format === 'exr' ? body.format : 'png8';
    const transparent = body.transparent === true;
    const ext = format === 'exr' ? 'exr' : 'png';
    const mime = format === 'exr' ? 'image/x-exr' : 'image/png';

    const job = createJob();

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Job-ID', job.id);
    res.flushHeaders?.();
    writeSseEvent(res, 'open', { jobId: job.id });

    // Client disconnect → abort.
    req.on('close', () => {
      if (!job.controller.signal.aborted) job.controller.abort();
    });

    try {
      const png = await renderGenomeToPng(
        deviceProvider(),
        {
          genome,
          width,
          height,
          quality,
          oversample: body.oversample,
          walkerJitter: body.walkerJitter,
          seed: body.seed,
          format,
          transparent,
        },
        (p: RenderProgress) => {
          writeSseEvent(res, 'progress', p);
        },
        job.controller.signal,
      );
      // `png_base64` carries the raw bytes for any format (kept for back-compat);
      // `ext`/`mime` let the client name + type the download (#334).
      writeSseEvent(res, 'done', {
        png_base64: Buffer.from(png).toString('base64'),
        ext,
        mime,
      });
      res.end();
    } catch (err) {
      if (err instanceof AbortedError) {
        writeSseEvent(res, 'cancelled', { jobId: job.id });
      } else {
        writeSseEvent(res, 'error', { message: (err as Error).message });
      }
      res.end();
    } finally {
      clearJob(job.id);
    }
  };
}
