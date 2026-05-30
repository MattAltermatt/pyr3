#!/usr/bin/env -S node --experimental-strip-types
// PYR3-027 BE perf bench — mirror of the FE __pyr3Bench A/B.
//
// Runs the SAME constant-total-samples chunk-count sweep that the
// browser bench runs (via the shared render-orchestrator), but on the
// Dawn-node WebGPU device with no Chrome process boundary. The delta in
// per-dispatch overhead between this and the FE result is the answer to
// PYR3-027 ("why is FE ~13× slower than BE").
//
// Usage: node --experimental-strip-types scripts/pyr3-027-be-bench.ts [flame]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { create, globals } from 'webgpu';

import { parseFlame } from '../src/flame-import.ts';
import { createRenderer, DEFAULT_FILTER_RADIUS } from '../src/renderer.ts';
import { startChunkedRender } from '../src/render-orchestrator.ts';
import type { Genome } from '../src/genome.ts';

const win = new Window();
(globalThis as { DOMParser: unknown }).DOMParser = win.DOMParser;
Object.assign(globalThis, globals);

// The shared orchestrator yields via requestAnimationFrame (browser-only).
// BE has no compositor — model the yield as a near-instant macrotask so
// the BE per-dispatch overhead is pure engine + Dawn, no frame pacing.
(globalThis as { requestAnimationFrame?: (cb: (t: number) => void) => void }).requestAnimationFrame =
  (cb) => { setImmediate(() => cb(performance.now())); };

const flamePath = resolve(process.argv[2] ?? 'fixtures/electricsheep.247.19679.flam3');

async function bench(
  renderer: ReturnType<typeof createRenderer>,
  genome: Genome,
  outputView: GPUTextureView,
  device: GPUDevice,
  cfg: { targetSamples: number; samplesPerChunk: number; presentEach: boolean; yieldEveryNChunks: number },
): Promise<{ chunks: number; wallMs: number }> {
  const chunks = Math.max(1, Math.ceil(cfg.targetSamples / cfg.samplesPerChunk));
  const t0 = performance.now();
  const handle = startChunkedRender({
    renderer,
    genome,
    outputViewProvider: () => outputView,
    targetSamples: cfg.targetSamples,
    seedBase: 12345,
    onProgress: () => {},
    presentAfterEachChunk: cfg.presentEach,
    samplesPerChunk: cfg.samplesPerChunk,
    yieldEveryNChunks: cfg.yieldEveryNChunks,
  });
  await handle.promise;
  await device.queue.onSubmittedWorkDone();
  return { chunks, wallMs: performance.now() - t0 };
}

async function main(): Promise<void> {
  const text = readFileSync(flamePath, 'utf8');
  const genome = parseFlame(text).genome;
  // Match the FE quick-mode pipeline: oversample=1 so the offscreen
  // target + chaos scale line up with the browser bench.
  const width = genome.size?.width ?? 1024;
  const height = genome.size?.height ?? 1024;
  const filterRadius = genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;
  const renderGenome: Genome = { ...genome, oversample: 1 };

  const navigator = { gpu: create([]) };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('no Dawn adapter');
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });

  const format = 'rgba8unorm' as const;
  const renderer = createRenderer(device, format, { width, height, oversample: 1, filterRadius });
  const texture = device.createTexture({
    label: 'pyr3-027-be-bench.output',
    size: { width, height },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const outputView = texture.createView();

  console.log(`[be-bench] genome="${genome.name}" ${width}×${height} oversample=1`);

  const T = 100_000_000;
  const spcs = [1_000_000, 2_000_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000];

  // warmup
  await bench(renderer, renderGenome, outputView, device, { targetSamples: 20_000_000, samplesPerChunk: 1_000_000, presentEach: true, yieldEveryNChunks: 1 });

  const rows: { spc: string; chunks: number; wallMs: number; msPerChunk: number }[] = [];
  for (const spc of spcs) {
    const r = await bench(renderer, renderGenome, outputView, device, {
      targetSamples: T, samplesPerChunk: spc, presentEach: true, yieldEveryNChunks: 1,
    });
    rows.push({ spc: spc / 1e6 + 'M', chunks: r.chunks, wallMs: Math.round(r.wallMs), msPerChunk: +(r.wallMs / r.chunks).toFixed(1) });
  }

  // linear fit wallMs = a + b*chunks
  const n = rows.length;
  const sx = rows.reduce((s, r) => s + r.chunks, 0);
  const sy = rows.reduce((s, r) => s + r.wallMs, 0);
  const sxx = rows.reduce((s, r) => s + r.chunks * r.chunks, 0);
  const sxy = rows.reduce((s, r) => s + r.chunks * r.wallMs, 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const a = (sy - b * sx) / n;

  console.log(JSON.stringify({ targetSamples: T, rows, fit: { perDispatchMs: +b.toFixed(2), baseMs: +a.toFixed(1) } }, null, 2));

  delete (globalThis as { navigator?: unknown }).navigator;
  process.exit(0);
}

main().catch((e: unknown) => { console.error('be-bench failed:', e); process.exit(1); });
