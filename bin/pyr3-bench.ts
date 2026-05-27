#!/usr/bin/env -S node --experimental-strip-types
// pyr3-bench — Phase 9-perf-audit baseline benchmark.
//
// Usage:
//   npm run bench [--warmup N] [--iters M] [--csv]
//
// Runs the canonical Spiral Galaxy flame through the full chaos + DE + filter +
// visualize pipeline under a matrix of feature toggles (baseline / DE on /
// filter on / supersample=2 / supersample=4 / finalxform / post-affine / xaos /
// symmetry / everything-on), records median ms/frame + M samples/sec, and
// prints a results table.
//
// Each scenario: N warmup renders (default 2) + M timed renders (default 5).
// Median of the M timed runs is the canonical scenario figure. ~10 scenarios
// × ~7 dispatches ≈ 2-3 minute total wall clock on a typical M-series Mac.
//
// Why this exists (Phase 9-perf-audit per ROADMAP):
//   Every Phase 9 sub-phase added cost to the chaos / DE / filter / visualize
//   passes. None measured before/after. This bench establishes the post-v1.0
//   baseline so future regressions show up against committed numbers.
//
// Comparing against v0.1 historically isn't feasible: the CLI render path
// (Phase B1) shipped 2026-05-09, AFTER v0.1 (tag at commit c04a3b5). The
// "baseline" row is Spiral Galaxy with every opted-in v1.0 feature OFF — the
// closest analog to v0.1's render path.

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { create, globals } from 'webgpu';

import { genomeFromJson } from '../src/serialize';
import { createRenderer, DEFAULT_FILTER_RADIUS } from '../src/renderer';
import { type Genome } from '../src/genome';

// happy-dom + WebGPU globals shim, same as pyr3-render.ts.
const win = new Window();
(globalThis as { DOMParser: unknown }).DOMParser = win.DOMParser;
Object.assign(globalThis, globals);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SPIRAL_PATH = join(REPO_ROOT, 'examples', 'spiral-galaxy.pyr3.json');

interface Scenario {
  name: string;
  shortKey: string;
  mutate(g: Genome): void;
  /** Human-readable note for the perf table commentary column. */
  note: string;
}

// All scenarios start from a fresh deep-clone of Spiral Galaxy and apply
// one feature toggle (or all of them for the 'everything' scenario). Keep
// the matrix small + meaningful: each row should answer one "what does
// feature X cost?" question.
const SCENARIOS: Scenario[] = [
  {
    name: 'baseline (v0.1-equivalent path)',
    shortKey: 'baseline',
    mutate: () => {
      // Spiral Galaxy as-shipped at v0.1: no DE / filter / oversample / xaos
      // / post / finalxform / symmetry. Matches the canonical .pyr3.json on
      // disk. No mutation needed.
    },
    note: 'Closest analog to v0.1 — all v1.0 opt-in features off.',
  },
  {
    name: 'DE on (Phase 6)',
    shortKey: 'de',
    mutate: (g) => {
      g.density = { maxRad: 9, minRad: 0, curve: 0.4 };
    },
    note: 'Single-pass 2D adaptive Gaussian gather. Apophysis defaults.',
  },
  {
    name: 'spatial filter on (Phase 9-filter)',
    shortKey: 'filter',
    mutate: (g) => {
      g.density = { maxRad: 9, minRad: 0, curve: 0.4 };
      g.spatialFilter = { radius: 0.5, shape: 'gaussian' };
    },
    note: 'Separable Gaussian AA. Requires DE on (v1 simplification).',
  },
  {
    name: 'supersample = 2 (Phase 9-supersample-real)',
    shortKey: 'ss2',
    mutate: (g) => {
      g.oversample = 2;
    },
    note: 'True super-res. Chaos histogram quadruples; visualize N²-collapses.',
  },
  {
    name: 'supersample = 4 (Phase 9-supersample-real)',
    shortKey: 'ss4',
    mutate: (g) => {
      g.oversample = 4;
    },
    note: '16× super-pixels. Storage-buffer + dispatch costs scale 16×.',
  },
  {
    name: 'finalxform (Phase 5b)',
    shortKey: 'final',
    mutate: (g) => {
      // Identity-affine julia finalxform. Matches examples/spiral-galaxy-julia-final.pyr3.json shape.
      g.finalxform = {
        color: 0.5,
        colorSpeed: 0.5,
        affine: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        variations: [{ index: 13, weight: 1 }], // V.julia = 13
      };
    },
    note: 'Lens-on-splat applied to every stored point. Branch cost in chaos.wgsl.',
  },
  {
    name: 'post-affine (Phase 9c)',
    shortKey: 'post',
    mutate: (g) => {
      // Non-identity post on the first xform. Realistic enough to trigger
      // the has_post path without breaking the visual.
      if (g.xforms[0]) {
        g.xforms[0].post = { a: 1.2, b: 0.05, c: 0, d: 1.1, e: 0.02, f: 0 };
      }
    },
    note: 'Per-xform post matrix multiply, gated by has_post flag.',
  },
  {
    name: 'xaos (Phase 9d)',
    shortKey: 'xaos',
    mutate: (g) => {
      // 3 xforms in Spiral Galaxy; bias the transition matrix asymmetrically.
      for (const xf of g.xforms) {
        xf.xaos = [0.5, 1.0, 1.5];
      }
    },
    note: 'Per-source weight multiplier on next-xform pick. Per-iter table lookup.',
  },
  {
    name: 'opacity (Phase 9d, partial)',
    shortKey: 'opacity',
    mutate: (g) => {
      if (g.xforms[0]) g.xforms[0].opacity = 0.5;
    },
    note: 'Probabilistic splat skip on one xform.',
  },
  {
    name: 'symmetry D5 (Phase 5c)',
    shortKey: 'symD5',
    mutate: (g) => {
      g.symmetry = { kind: 'dihedral', n: 5 };
    },
    note: 'Dihedral pre-pack expansion. 3 user xforms × (2·5) symmetry → 30 xforms.',
  },
  {
    name: 'everything on (v1.0 full surface)',
    shortKey: 'all',
    mutate: (g) => {
      g.density = { maxRad: 9, minRad: 0, curve: 0.4 };
      g.spatialFilter = { radius: 0.5, shape: 'gaussian' };
      g.oversample = 2;
      g.finalxform = {
        color: 0.5,
        colorSpeed: 0.5,
        affine: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        variations: [{ index: 13, weight: 1 }],
      };
      if (g.xforms[0]) {
        g.xforms[0].post = { a: 1.2, b: 0.05, c: 0, d: 1.1, e: 0.02, f: 0 };
        g.xforms[0].opacity = 0.5;
      }
      for (const xf of g.xforms) xf.xaos = [0.5, 1.0, 1.5];
    },
    note: 'All v1.0 opt-in features simultaneously (no symmetry — affects walker count too dramatically).',
  },
];

interface ScenarioResult {
  name: string;
  shortKey: string;
  median_ms: number;
  min_ms: number;
  max_ms: number;
  samples_per_sec: number;
  note: string;
  iters: number;
}

async function runScenario(
  scenario: Scenario,
  base: Genome,
  device: GPUDevice,
  warmup: number,
  iters: number,
): Promise<ScenarioResult> {
  // Deep-clone via JSON so each scenario gets a fresh mutable genome.
  const g: Genome = JSON.parse(JSON.stringify(base));
  scenario.mutate(g);

  const width = g.size?.width ?? 1024;
  const height = g.size?.height ?? 1024;
  const oversample = Math.max(1, Math.floor(g.oversample ?? 1));
  const filterRadius = g.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;

  const format = 'rgba8unorm' as const;
  const renderer = createRenderer(device, format, { width, height, oversample, filterRadius });

  const texture = device.createTexture({
    label: `pyr3-bench.${scenario.shortKey}.output`,
    size: { width, height },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const view = texture.createView();

  // Warmup — discard timing. Lets the GPU spin up pipelines, JIT-compile
  // shaders, settle caches.
  for (let i = 0; i < warmup; i++) {
    renderer.render({ genome: g, outputView: view });
    // queue.onSubmittedWorkDone() guarantees CPU-side timing reflects GPU
    // completion (not just submission).
    await device.queue.onSubmittedWorkDone();
  }

  // Timed runs.
  const samples: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    renderer.render({ genome: g, outputView: view });
    await device.queue.onSubmittedWorkDone();
    samples.push(performance.now() - t0);
  }

  // Compute median (more robust to GC pauses than mean).
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median_ms = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;

  // Samples per second using the median frame time. The renderer dispatches
  // walkers × itersPerWalker samples per render; default quality = 16 spp
  // gives ~16 × W × H samples per render.
  const samplesPerRender = 16 * width * height; // default DEFAULT_SPP × W × H from renderer.ts
  const samples_per_sec = (samplesPerRender / median_ms) * 1000;

  texture.destroy();
  renderer.destroy();

  return {
    name: scenario.name,
    shortKey: scenario.shortKey,
    median_ms,
    min_ms: sorted[0]!,
    max_ms: sorted[sorted.length - 1]!,
    samples_per_sec,
    note: scenario.note,
    iters,
  };
}

function fmtMs(ms: number): string {
  if (ms < 100) return ms.toFixed(2);
  if (ms < 10000) return ms.toFixed(1);
  return ms.toFixed(0);
}

function fmtSpsMillions(sps: number): string {
  return (sps / 1e6).toFixed(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const warmup = parseInt(args.find((a) => a.startsWith('--warmup='))?.split('=')[1] ?? '2', 10);
  const iters = parseInt(args.find((a) => a.startsWith('--iters='))?.split('=')[1] ?? '5', 10);
  const csv = flags.has('--csv');

  console.log(
    `[pyr3-bench] warmup=${warmup} iters=${iters} scenarios=${SCENARIOS.length}`,
  );

  // Load base Spiral Galaxy.
  const baseText = readFileSync(SPIRAL_PATH, 'utf8');
  const base = genomeFromJson(JSON.parse(baseText));

  // Acquire Dawn device once. Re-build the renderer per scenario (since
  // canvas size / oversample / filter radius can vary).
  const navigator = { gpu: create([]) };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('pyr3-bench: no GPU adapter from Dawn');
  const limits = adapter.limits;
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxBufferSize: limits.maxBufferSize,
    },
  });

  const results: ScenarioResult[] = [];
  for (const scenario of SCENARIOS) {
    console.log(`[pyr3-bench] running: ${scenario.name}`);
    const r = await runScenario(scenario, base, device, warmup, iters);
    results.push(r);
    console.log(
      `[pyr3-bench]   median=${fmtMs(r.median_ms)}ms  range=[${fmtMs(r.min_ms)}..${fmtMs(r.max_ms)}]  ${fmtSpsMillions(r.samples_per_sec)}M sps`,
    );
  }

  // Output the results table.
  console.log('');
  if (csv) {
    console.log('scenario,short_key,median_ms,min_ms,max_ms,samples_per_sec_millions,iters,note');
    for (const r of results) {
      console.log(
        [
          `"${r.name}"`,
          r.shortKey,
          r.median_ms.toFixed(3),
          r.min_ms.toFixed(3),
          r.max_ms.toFixed(3),
          fmtSpsMillions(r.samples_per_sec),
          r.iters,
          `"${r.note}"`,
        ].join(','),
      );
    }
  } else {
    const baseline = results.find((r) => r.shortKey === 'baseline');
    const baselineMs = baseline?.median_ms ?? 1;
    console.log('| Scenario | Median ms | vs baseline | M samples/sec | Note |');
    console.log('|---|---:|---:|---:|---|');
    for (const r of results) {
      const ratio = r.shortKey === 'baseline' ? '1.00×' : `${(r.median_ms / baselineMs).toFixed(2)}×`;
      console.log(
        `| ${r.name} | ${fmtMs(r.median_ms)} | ${ratio} | ${fmtSpsMillions(r.samples_per_sec)} | ${r.note} |`,
      );
    }
  }

  // Per the webgpu README — drop navigator to let node exit cleanly.
  delete (globalThis as { navigator?: unknown }).navigator;
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('pyr3-bench: failed —', err);
  process.exit(1);
});
