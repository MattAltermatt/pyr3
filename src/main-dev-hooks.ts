// pyr3 — DEV-only `window.__pyr3*` debug hooks (#423).
//
// These console hooks exist purely for local investigations + the FE↔BE
// parity rig; they are ALL gated on `import.meta.env.DEV`, so they never
// run in a production build. They were extracted out of `main.ts`'s render
// flow (pure code movement, zero behavior change) — `installDevHooks` is
// called once, late, from `main()` after every dependency exists.
//
// Mutable `let` bindings in `main()` that the hooks read/write
// (`currentWalkerJitter`, `seed`, `lastRenderInfo`, `runHandle`) are bridged
// via getter/setter pairs so production read paths (rerender / renderQuality /
// the render orchestrator) keep seeing fresh values from the real bindings.

import type { Genome } from './genome';
import type { QualityRequest } from './presets';
import type { RunHandle } from './render-orchestrator';
import { startChunkedRender, startDecoupledRender } from './render-orchestrator';
import type { Renderer } from './renderer';
import type { LoadSequencer } from './load-sequencer';

export interface DevHookDeps {
  renderer: Renderer;
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  sequencer: LoadSequencer;
  renderQuality: (req: QualityRequest) => Promise<void>;
  // Mutable-let bridges — these mutate the real `main()` bindings.
  getJitter: () => number;
  setJitter: (v: number) => number;
  getSeed: () => number;
  setSeed: (v: number) => void;
  getLastRenderInfo: () => { genome: Genome; totalSamples: number } | null;
  getRunHandle: () => RunHandle | null;
  setRunHandle: (v: RunHandle | null) => void;
}

/**
 * Install the DEV-only `window.__pyr3*` debug hooks. No-op unless
 * `import.meta.env.DEV` — safe to call unconditionally, but `main()` also
 * guards the call so the whole module tree-shakes out of production builds.
 */
export function installDevHooks(deps: DevHookDeps): void {
  if (!import.meta.env.DEV) return;

  const {
    renderer,
    device,
    context,
    format,
    sequencer,
    renderQuality,
    getJitter,
    setJitter,
    getSeed,
    setSeed,
    getLastRenderInfo,
    getRunHandle,
    setRunHandle,
  } = deps;

  // #65 Tier 1 — walker-jitter knob. Hot-swap the per-iter jitter amplitude
  // without a page reload (handy for ad-hoc sweeps). Returns the resolved
  // (or unchanged, on invalid input) amplitude.
  (window as unknown as {
    __pyr3SetJitter?: (amp: number) => number;
  }).__pyr3SetJitter = (amp: number): number => {
    if (!Number.isFinite(amp) || amp < 0) {
      console.warn(`__pyr3SetJitter: ignoring invalid amplitude ${amp}`);
      return getJitter();
    }
    setJitter(amp);
    return amp;
  };

  // PYR3-018 FE parity sweep: pixel-readback hook.
  // The canvas swap-chain texture is single-frame-presented and not
  // readable via drawImage / toDataURL post-render. This hook mirrors
  // the CLI readback (bin/pyr3-render.ts §5): allocate an offscreen
  // texture with COPY_SRC, re-present the existing accumulated
  // histogram into it (renderer.present is cheap; iteration state is
  // preserved), copyTextureToBuffer → mapAsync → return RGBA bytes.
  (window as unknown as {
    __pyr3CapturePixels?: () => Promise<{ width: number; height: number; rgba: Uint8ClampedArray; format: GPUTextureFormat }>;
  }).__pyr3CapturePixels = async () => {
    const lastRenderInfo = getLastRenderInfo();
    if (!lastRenderInfo) {
      throw new Error('__pyr3CapturePixels: no render to capture (load a flame first)');
    }
    const { genome, totalSamples } = lastRenderInfo;
    const W = renderer.width;
    const H = renderer.height;
    const tex = device.createTexture({
      label: 'pyr3.capture.output',
      size: { width: W, height: H },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    renderer.present({ genome, outputView: tex.createView(), totalSamples, forceDeOff: false });
    const bytesPerPixel = 4;
    const unpaddedBytesPerRow = W * bytesPerPixel;
    const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
    const readBuf = device.createBuffer({
      label: 'pyr3.capture.readback',
      size: bytesPerRow * H,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder({ label: 'pyr3.capture.encoder' });
    encoder.copyTextureToBuffer(
      { texture: tex },
      { buffer: readBuf, bytesPerRow, rowsPerImage: H },
      { width: W, height: H },
    );
    device.queue.submit([encoder.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();
    tex.destroy();
    readBuf.destroy();
    // Strip row padding to tight RGBA, swap channels if needed (Chrome's
    // preferred canvas format is bgra8unorm on macOS — our pipeline target
    // matches, but parity comparison + PNG encoding expects RGBA).
    const tight = new Uint8ClampedArray(W * H * 4);
    const swapBR = format === 'bgra8unorm';
    for (let y = 0; y < H; y++) {
      const srcOff = y * bytesPerRow;
      const dstOff = y * unpaddedBytesPerRow;
      if (swapBR) {
        for (let x = 0; x < W; x++) {
          const s = srcOff + x * 4;
          const d = dstOff + x * 4;
          tight[d] = padded[s + 2]!;   // R ← B
          tight[d + 1] = padded[s + 1]!; // G
          tight[d + 2] = padded[s]!;     // B ← R
          tight[d + 3] = padded[s + 3]!; // A
        }
      } else {
        tight.set(padded.subarray(srcOff, srcOff + unpaddedBytesPerRow), dstOff);
      }
    }
    return { width: W, height: H, rgba: tight, format };
  };

  // PYR3-027 perf A/B: drive the orchestrator with explicit knob
  // overrides on the last-rendered genome, holding total GPU samples
  // constant so only orchestration overhead varies. Awaits a full GPU
  // queue drain so wallMs is GPU-finished wall-clock, not JS-queue time.
  // Load a flame before calling.
  (window as unknown as {
    __pyr3Bench?: (cfg: {
      targetSamples?: number;
      samplesPerChunk?: number;
      presentEach?: boolean;
      yieldEveryNChunks?: number;
    }) => Promise<{ result: string; chunks: number; targetSamples: number; wallMs: number }>;
  }).__pyr3Bench = async (cfg) => {
    const lastRenderInfo = getLastRenderInfo();
    if (!lastRenderInfo) {
      throw new Error('__pyr3Bench: no render to bench (load a flame first)');
    }
    // Cancel any in-flight production render so it doesn't contend.
    const inFlight = getRunHandle();
    if (inFlight) {
      inFlight.cancel();
      await inFlight.promise;
      setRunHandle(null);
    }
    await device.queue.onSubmittedWorkDone();
    const genome = lastRenderInfo.genome;
    const targetSamples = cfg.targetSamples ?? lastRenderInfo.totalSamples;
    const spc = cfg.samplesPerChunk ?? 1_000_000;
    const chunks = Math.max(1, Math.ceil(targetSamples / spc));
    const t0 = performance.now();
    const handle = startChunkedRender({
      renderer,
      genome,
      outputViewProvider: () => context.getCurrentTexture().createView(),
      targetSamples,
      seedBase: getSeed(),
      onProgress: () => {},
      presentAfterEachChunk: cfg.presentEach,
      samplesPerChunk: cfg.samplesPerChunk,
      yieldEveryNChunks: cfg.yieldEveryNChunks,
      walkerJitter: getJitter(),
    });
    const result = await handle.promise;
    await device.queue.onSubmittedWorkDone();
    const wallMs = performance.now() - t0;
    return { result, chunks, targetSamples, wallMs };
  };

  // PYR3-027 Option 1 prototype: decoupled display/dispatch render driven
  // against the REAL canvas so the refinement is watchable in Chrome.
  // Counts display presents so we can confirm refinement frames land at
  // the display cadence rather than per-dispatch.
  (window as unknown as {
    __pyr3Decoupled?: (cfg?: {
      targetSamples?: number;
      samplesPerDispatch?: number;
      displayIntervalMs?: number;
      cheapPreview?: boolean;
    }) => Promise<{ result: string; targetSamples: number; wallMs: number }>;
  }).__pyr3Decoupled = async (cfg = {}) => {
    const lastRenderInfo = getLastRenderInfo();
    if (!lastRenderInfo) {
      throw new Error('__pyr3Decoupled: no render to drive (load a flame first)');
    }
    const inFlight = getRunHandle();
    if (inFlight) {
      inFlight.cancel();
      await inFlight.promise;
      setRunHandle(null);
    }
    await device.queue.onSubmittedWorkDone();
    const genome = lastRenderInfo.genome;
    const targetSamples = cfg.targetSamples ?? lastRenderInfo.totalSamples;
    const t0 = performance.now();
    const handle = startDecoupledRender({
      renderer,
      genome,
      outputViewProvider: () => context.getCurrentTexture().createView(),
      targetSamples,
      seedBase: getSeed(),
      onProgress: () => {},
      samplesPerDispatch: cfg.samplesPerDispatch,
      displayIntervalMs: cfg.displayIntervalMs,
      cheapPreview: cfg.cheapPreview,
      walkerJitter: getJitter(),
    });
    const result = await handle.promise;
    await device.queue.onSubmittedWorkDone();
    const wallMs = performance.now() - t0;
    return { result, targetSamples, wallMs };
  };

  // Dev console hook onto the quality ladder.
  (window as unknown as { __pyr3RenderQuality?: (req: QualityRequest) => Promise<void> }).__pyr3RenderQuality = renderQuality;

  // PYR3-026 FE↔BE parity rig: programmatic flame-load + seed-pin hooks.
  // Delegates to the load sequencer (#70) so the test rig's
  // `__pyr3LoadFlame(A); __pyr3LoadFlame(B)` sequence serializes through
  // the same chain as the file-picker path.
  //
  // #35: pin the session seed for deterministic FE↔BE parity. Call BEFORE
  // __pyr3LoadFlame on each fixture so both engines render the same RNG
  // sequence. Truncates to u32 and is sticky until the next call.
  (window as unknown as {
    __pyr3SetSeed?: (n: number) => void;
  }).__pyr3SetSeed = (n: number) => {
    setSeed(n >>> 0);
  };

  (window as unknown as {
    __pyr3LoadFlame?: (text: string, label?: string) => Promise<void>;
  }).__pyr3LoadFlame = (text, label) => sequencer.enqueueHook(text, label);
}
