import type { Genome } from './genome';
import type { Renderer } from './renderer';
import { startChunkedRender, type ProgressInfo } from './render-orchestrator';
import { injectPngTextChunk } from './png-text-chunk';
import { getCapability } from './capability';
import { genomeToJson } from './serialize';

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

async function saveRenderInBrowser(opts: SaveRenderToPngOpts): Promise<SaveRenderResult> {
  const renderHandle = startChunkedRender({
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

  const onAbort = () => renderHandle.cancel();
  opts.abortSignal.addEventListener('abort', onAbort, { once: true });

  try {
    const outcome = await renderHandle.promise;
    if (outcome === 'cancelled') return 'cancelled';

    await opts.device.queue.onSubmittedWorkDone();

    await new Promise<void>((resolve, reject) => {
      opts.canvas.toBlob(async (blob) => {
        if (!blob) {
          reject(new Error('toBlob returned null — canvas was not snapshottable'));
          return;
        }
        let finalBlob: Blob = blob;
        try {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const withMetadata = injectPngTextChunk(bytes, 'pyr3', opts.metadataJson);
          finalBlob = new Blob([withMetadata as BlobPart], { type: 'image/png' });
        } catch (err) {
          console.warn('pyr3: PNG metadata injection failed; saving without metadata', err);
        }
        const url = URL.createObjectURL(finalBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = opts.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        resolve();
      }, 'image/png');
    });

    return 'completed';
  } finally {
    opts.abortSignal.removeEventListener('abort', onAbort);
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
          const d = JSON.parse(dataStr) as BackendDone;
          pngBytes = base64ToBytes(d.png_base64);
          outcome = 'completed';
        } else if (event === 'cancelled') {
          outcome = 'cancelled';
        } else if (event === 'error') {
          const e = JSON.parse(dataStr) as { message?: string };
          throw new Error(`pyr3 serve render failed: ${e.message ?? 'unknown error'}`);
        } else if (event === 'open') {
          // jobId already in the X-Job-ID header; nothing to do.
        }
      }
    }

    if (outcome === 'cancelled' || pngBytes === null) {
      return outcome ?? 'cancelled';
    }

    // Inject metadata client-side (server returns just pixels).
    let finalBytes: Uint8Array = pngBytes;
    try {
      finalBytes = injectPngTextChunk(pngBytes, 'pyr3', opts.metadataJson);
    } catch (err) {
      console.warn('pyr3: PNG metadata injection failed; saving without metadata', err);
    }
    const blob = new Blob([finalBytes as BlobPart], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = opts.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
