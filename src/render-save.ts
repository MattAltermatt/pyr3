import type { Genome } from './genome';
import { createRenderer, type Renderer } from './renderer';
import { startChunkedRender, type ProgressInfo } from './render-orchestrator';
import { injectPngTextChunk } from './png-text-chunk';
import { getCapability } from './capability';
import { genomeToJson } from './serialize';
import { encodePng, type Deflate } from './png16-encode';
import { encodeExr } from './exr-encode';
import { readTextureTight, displayHalfToLinearExr, displayHalfToPng16 } from './gpu-readback';

/** Output format for Save Render (#334). */
export type ExportFormat = 'png8' | 'png16' | 'exr';

export interface SaveRenderToPngOpts {
  renderer: Renderer;
  genome: Genome;
  canvas: HTMLCanvasElement;
  ctx: GPUCanvasContext;
  device: GPUDevice;
  abortSignal: AbortSignal;
  onProgress: (info: ProgressInfo) => void;
  /** Full filename including extension (e.g. `electricsheep.247.19679.pyr3.png`). */
  filename: string;
  /** UTF-8 string embedded as the value of a `pyr3`-keyed PNG tEXt chunk. */
  metadataJson: string;
  /** Total samples to accumulate. Typically `genome.quality * canvas.w * canvas.h`. */
  targetSamples: number;
  /** Base seed passed through to the orchestrator. */
  seedBase: number;
  /** Optional walker-jitter override; defaults inside the orchestrator. */
  walkerJitter?: number;
  /** #334 — output format (default 'png8'). png8/png16 are display-referred;
   *  exr is true linear scene-referred 32f. */
  format?: ExportFormat;
  /** #334 — transparent background for png8/png16 (no effect on exr). */
  transparent?: boolean;
}

export type SaveRenderResult = 'completed' | 'cancelled';

/** P0 of `pyr3 serve` (#201) — single Save Render fork point shared by the
 *  viewer (`src/main.ts`) and editor (`src/edit-mount.ts`). Folds in #191.
 *
 *  Forks on `getCapability().backend`:
 *  - `'dawn-node'`: POST genome JSON to `/api/render`, consume SSE
 *    progress + base64 PNG, inject metadata client-side, download.
 *  - `'webgpu-browser'` (gh-pages default): existing in-browser
 *    `startChunkedRender` → toBlob path. */
export async function saveRenderToPng(opts: SaveRenderToPngOpts): Promise<SaveRenderResult> {
  if (getCapability().backend === 'dawn-node') {
    return saveRenderViaBackend(opts);
  }
  return saveRenderInBrowser(opts);
}

/** Run a chunked-render handle under the abort signal; returns its outcome. */
async function runWithAbort(
  handle: { promise: Promise<SaveRenderResult>; cancel: () => void },
  abortSignal: AbortSignal,
): Promise<SaveRenderResult> {
  const onAbort = () => handle.cancel();
  abortSignal.addEventListener('abort', onAbort, { once: true });
  try {
    return await handle.promise;
  } finally {
    abortSignal.removeEventListener('abort', onAbort);
  }
}

/** Trigger a browser download of raw bytes. */
function triggerDownload(bytes: Uint8Array, filename: string, mime: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Swap (or append) a file extension. `electricsheep.pyr3.png` + `exr`
 *  → `electricsheep.pyr3.exr`. */
function withExt(filename: string, ext: string): string {
  return filename.replace(/\.[^.]+$/, '') + '.' + ext;
}

/** zlib (RFC1950) deflate via the browser's CompressionStream — the format
 *  PNG IDAT requires. Async; the pure-TS PNG encoder awaits it. */
const browserDeflate: Deflate = async (raw: Uint8Array): Promise<Uint8Array> => {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  void writer.write(raw as BufferSource);
  void writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
};

async function saveRenderInBrowser(opts: SaveRenderToPngOpts): Promise<SaveRenderResult> {
  const format = opts.format ?? 'png8';
  const transparent = opts.transparent ?? false;

  // png8 opaque → the fast live-canvas path (watch it refine, toBlob).
  if (format === 'png8' && !transparent) {
    return saveViaCanvas(opts);
  }
  // png16 / exr / png8+transparent → offscreen render at the right format.
  return saveViaOffscreen(opts, format, transparent);
}

/** png8 opaque — the original live-canvas → toBlob path. */
async function saveViaCanvas(opts: SaveRenderToPngOpts): Promise<SaveRenderResult> {
  const handle = startChunkedRender({
    renderer: opts.renderer,
    genome: opts.genome,
    outputViewProvider: () => opts.ctx.getCurrentTexture().createView(),
    targetSamples: opts.targetSamples,
    seedBase: opts.seedBase,
    onProgress: opts.onProgress,
    walkerJitter: opts.walkerJitter,
    samplesPerChunk: 4_000_000,
    yieldEveryNChunks: 4,
  });
  const outcome = await runWithAbort(handle, opts.abortSignal);
  if (outcome === 'cancelled') return 'cancelled';
  await opts.device.queue.onSubmittedWorkDone();

  await new Promise<void>((resolve, reject) => {
    opts.canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('toBlob returned null — canvas was not snapshottable'));
        return;
      }
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const withMetadata = injectPngTextChunk(bytes, 'pyr3', opts.metadataJson);
        triggerDownload(withMetadata, opts.filename, 'image/png');
      } catch (err) {
        console.warn('pyr3: PNG metadata injection failed; saving without metadata', err);
        triggerDownload(new Uint8Array(await blob.arrayBuffer()), opts.filename, 'image/png');
      }
      resolve();
    }, 'image/png');
  });
  return 'completed';
}

/** png16 / exr / png8-transparent — render to an offscreen texture at the
 *  needed format (the canvas renderer's format can't be retargeted), then
 *  encode. exr stores the linear light of the display image (#334). */
async function saveViaOffscreen(
  opts: SaveRenderToPngOpts,
  format: ExportFormat,
  transparent: boolean,
): Promise<SaveRenderResult> {
  const width = opts.canvas.width;
  const height = opts.canvas.height;
  const gpuFormat: GPUTextureFormat =
    format === 'png16' || format === 'exr' ? 'rgba16float' : 'rgba8unorm';
  const offRenderer = createRenderer(opts.device, gpuFormat, {
    width, height, oversample: opts.renderer.oversample, filterRadius: opts.renderer.filterRadius,
  });
  const offTex = opts.device.createTexture({
    label: 'pyr3.export.offscreen',
    size: { width, height },
    format: gpuFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  try {
    const handle = startChunkedRender({
      renderer: offRenderer,
      genome: opts.genome,
      outputViewProvider: () => offTex.createView(),
      targetSamples: opts.targetSamples,
      seedBase: opts.seedBase,
      onProgress: opts.onProgress,
      walkerJitter: opts.walkerJitter,
      presentAfterEachChunk: false,
      transparent,
      samplesPerChunk: 4_000_000,
      yieldEveryNChunks: 4,
    });
    const outcome = await runWithAbort(handle, opts.abortSignal);
    if (outcome === 'cancelled') return 'cancelled';
    await opts.device.queue.onSubmittedWorkDone();

    const bytesPerPixel = gpuFormat === 'rgba16float' ? 8 : 4;
    const tight = await readTextureTight(opts.device, offTex, width, height, bytesPerPixel);

    if (format === 'exr') {
      // Store the LINEAR LIGHT of the display image so EXR viewers (which apply
      // sRGB on view) reproduce the editor look on open. See src/srgb.ts. (#334)
      const rgba = displayHalfToLinearExr(tight, width, height);
      triggerDownload(encodeExr({ width, height, rgba }), withExt(opts.filename, 'exr'), 'image/x-exr');
      return 'completed';
    }

    let png: Uint8Array;
    if (format === 'png16') {
      const rgba16 = displayHalfToPng16(tight, width, height);
      png = await encodePng({ width, height, bitDepth: 16, data: rgba16 }, browserDeflate);
    } else {
      // png8 + transparent — tight is already 8-bit RGBA.
      png = await encodePng({ width, height, bitDepth: 8, data: tight }, browserDeflate);
    }
    const withMetadata = injectPngTextChunk(png, 'pyr3', opts.metadataJson);
    triggerDownload(withMetadata, opts.filename, 'image/png');
    return 'completed';
  } finally {
    offRenderer.destroy();
    offTex.destroy();
  }
}

interface BackendProgress {
  chunk: number;
  total: number;
  percent: number;
  samples: number;
}

interface BackendDone {
  png_base64: string;
  /** #334 — file extension + MIME for the chosen format ('png' | 'exr'). */
  ext?: string;
  mime?: string;
}

/** POST genome + render spec to `pyr3 serve`'s `/api/render`. Consumes the
 *  SSE stream incrementally; `onProgress` fires per `progress` event;
 *  resolves with PNG bytes on `done`, `'cancelled'` on `cancelled`, or
 *  throws on `error`. Abort signal is bridged to a `/api/cancel/:id` POST. */
async function saveRenderViaBackend(opts: SaveRenderToPngOpts): Promise<SaveRenderResult> {
  const elapsedStart = performance.now();
  const projectEta = makeEtaProjector();
  const body = {
    genome: genomeToJson(opts.genome),
    dim: { width: opts.canvas.width, height: opts.canvas.height },
    quality: opts.genome.quality ?? 50,
    oversample: opts.genome.oversample ?? 1,
    walkerJitter: opts.walkerJitter,
    seed: opts.seedBase,
    format: opts.format ?? 'png8',
    transparent: opts.transparent ?? false,
  };

  let jobId: string | null = null;
  const cancelByJobId = () => {
    if (!jobId) return;
    void fetch(`/api/cancel/${jobId}`, { method: 'POST' }).catch(() => {});
  };
  const onAbort = () => cancelByJobId();
  opts.abortSignal.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.abortSignal,
    });
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new Error(`pyr3 serve render failed: ${res.status} ${errText}`);
    }
    jobId = res.headers.get('X-Job-ID');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let pngBytes: Uint8Array | null = null;
    let outcome: SaveRenderResult | null = null;
    let outExt = 'png';
    let outMime = 'image/png';

    while (outcome === null && pngBytes === null) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE event boundary = blank line.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        const dataStr = dataLines.join('\n');
        if (event === 'progress') {
          try {
            const p = JSON.parse(dataStr) as BackendProgress;
            opts.onProgress({
              chunk: p.chunk,
              total: p.total,
              percent: p.percent,
              samples: p.samples,
              elapsedSeconds: (performance.now() - elapsedStart) / 1000,
              etaSeconds: projectEta(p.percent, performance.now()),
            });
          } catch {
            // ignore malformed event — server is the authority
          }
        } else if (event === 'done') {
          // #324 — a malformed `done` payload must surface a clean error, not a
          // raw SyntaxError from JSON.parse.
          let d: BackendDone;
          try {
            d = JSON.parse(dataStr) as BackendDone;
          } catch {
            throw new Error('pyr3 serve render failed: malformed "done" server event');
          }
          pngBytes = base64ToBytes(d.png_base64);
          if (d.ext) outExt = d.ext;
          if (d.mime) outMime = d.mime;
          outcome = 'completed';
        } else if (event === 'cancelled') {
          outcome = 'cancelled';
        } else if (event === 'error') {
          // #324 — same guard on the error payload itself.
          let e: { message?: string };
          try {
            e = JSON.parse(dataStr) as { message?: string };
          } catch {
            throw new Error('pyr3 serve render failed: malformed "error" server event');
          }
          throw new Error(`pyr3 serve render failed: ${e.message ?? 'unknown error'}`);
        } else if (event === 'open') {
          // jobId already in the X-Job-ID header; nothing to do.
        }
      }
    }

    if (outcome === 'cancelled' || pngBytes === null) {
      return outcome ?? 'cancelled';
    }

    // Inject metadata client-side for PNG (server returns just pixels). EXR
    // is not a PNG container, so the `pyr3` tEXt chunk doesn't apply (#334).
    let finalBytes: Uint8Array = pngBytes;
    if (outExt !== 'exr') {
      try {
        finalBytes = injectPngTextChunk(pngBytes, 'pyr3', opts.metadataJson);
      } catch (err) {
        console.warn('pyr3: PNG metadata injection failed; saving without metadata', err);
      }
    }
    triggerDownload(finalBytes, outExt === 'exr' ? withExt(opts.filename, 'exr') : opts.filename, outMime);
    return 'completed';
  } catch (err) {
    if (opts.abortSignal.aborted) return 'cancelled';
    throw err;
  } finally {
    opts.abortSignal.removeEventListener('abort', onAbort);
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * ETA projector for the backend render SSE stream (#204).
 *
 * The naïve cumulative estimate (`elapsed / percent − elapsed`) over-projects
 * badly off the FIRST progress event: that event lands only after the cold
 * Dawn-warmup chunk (~8M samples, first dispatch) at ~1% complete, so its
 * wall-time is wildly unrepresentative of the amortized per-chunk rate. From a
 * cold ~14 s first chunk at 1%, the cumulative formula projects ~23 min; by the
 * 3rd–4th event it settles to a realistic ~30 s.
 *
 * Fix: anchor the projection at that first event and project from the rate
 * accrued *after* it — the cold chunk's time never pollutes the rate. Until a
 * second event with forward progress arrives there is no rate yet, so we return
 * NaN (the progress modal renders a blank ETA rather than a bogus one).
 *
 * `percent` is a fraction in [0, 1] (the server emits `(i+1)/totalChunks`).
 */
export function makeEtaProjector(): (percent: number, nowMs: number) => number {
  let anchor: { ms: number; percent: number } | null = null;
  return (percent, nowMs) => {
    if (anchor === null) {
      anchor = { ms: nowMs, percent };
      return NaN; // first (cold-warmup) event — no representative rate yet
    }
    const dPercent = percent - anchor.percent;
    const dt = (nowMs - anchor.ms) / 1000;
    if (dPercent <= 0 || dt <= 0) return NaN; // no forward progress yet
    const rate = dPercent / dt; // fraction per second
    return Math.max(0, (1 - percent) / rate);
  };
}
