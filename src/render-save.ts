import type { Genome } from './genome';
import type { Renderer } from './renderer';
import { startChunkedRender, type ProgressInfo } from './render-orchestrator';
import { injectPngTextChunk } from './png-text-chunk';

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
 *  Task 1 ships the browser path only. Task 7 will add the backend fork
 *  (POST `/api/render` + SSE) inside this same helper, transparently to
 *  the call sites. */
export async function saveRenderToPng(opts: SaveRenderToPngOpts): Promise<SaveRenderResult> {
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
