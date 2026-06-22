// Shared boilerplate for the `*.gpu.test.ts` finite-output / f64-oracle smokes
// (#428). Dedups three things copy-pasted across ~60 of them:
//   1. the Dawn device-acquisition dance,
//   2. the `chaos.wgsl` source read, and
//   3. the core ISAAC prelude (TAU/PI consts + IsaacState struct + the three
//      isaac fns) that every RNG-consuming extracted-variation smoke shares.
//
// SCOPE / non-goals: this intentionally does NOT provide a universal
// `dispatch()` or a single `PRELUDE` string — those legitimately vary per file
// (different bind-group layouts, buffer counts, and per-family helper sets like
// complex_* / hash01 / SIN_SAFE_MAX). Each file assembles its own PRELUDE from
// the shared pieces here plus its own `extractWgslFn` calls, and keeps its own
// `dispatch()`. The file count and per-file dispatch counts stay unchanged —
// the many small files are split on purpose (Dawn+vitest SIGABRTs past ~47
// cumulative dispatches per worker, #163); this only removes duplicated setup.
//
// GC-PIN (load-bearing, #20 — memory: webgpu-dawn-navigator-gc-pin): the Dawn
// navigator returned by `create([])` segfaults if it's GC'd while the device is
// live. `acquireTestGpu()` returns the `gpu` handle alongside the device; the
// CALLER MUST retain it at module scope (e.g. `const { gpu: _gpu, device } =
// await acquireTestGpu();`). Do not discard `gpu`.

import { create, globals } from 'webgpu';
import { readFileSync } from 'node:fs';
import { extractWgslFn } from './shaders/extract';

// WebGPU globals (GPUBufferUsage, GPUMapMode, …) onto globalThis — runs once
// per worker on first import of this module.
Object.assign(globalThis, globals);

export interface TestGpu {
  /** The Dawn navigator. Retain at module scope in the caller — see GC-PIN. */
  gpu: ReturnType<typeof create> | null;
  device: GPUDevice | null;
}

/** Acquire a fresh Dawn device, or `{ gpu: null, device: null }` when no
 *  adapter is available (keeps the fast suite green on CI without a GPU).
 *  Each test file owns its returned device and destroys it in `afterAll`. */
export async function acquireTestGpu(): Promise<TestGpu> {
  try {
    const gpu = create([]);
    const adapter = await gpu.requestAdapter();
    const device = adapter ? await adapter.requestDevice() : null;
    return { gpu, device };
  } catch {
    return { gpu: null, device: null };
  }
}

/** The full `chaos.wgsl` source, read once. Feed to `extractWgslFn`. */
export const CHAOS_WGSL = readFileSync(
  new URL('./shaders/chaos.wgsl', import.meta.url),
  'utf8',
);

/** The `struct IsaacState { … };` block lifted verbatim from chaos.wgsl. */
export const ISAAC_STRUCT = (() => {
  const m = CHAOS_WGSL.match(/struct IsaacState[\s\S]*?\n\};/);
  if (!m) throw new Error('gpu-test-harness: struct IsaacState not found in chaos.wgsl');
  return m[0];
})();

/** The three ISAAC fns (isaac_round / isaac_irand / rand01), concatenated. */
export const ISAAC_FNS = [
  extractWgslFn(CHAOS_WGSL, 'isaac_round'),
  extractWgslFn(CHAOS_WGSL, 'isaac_irand'),
  extractWgslFn(CHAOS_WGSL, 'rand01'),
].join('\n');

/** TAU + PI consts at the precision chaos.wgsl uses. */
export const CONSTS_PRELUDE =
  `const TAU: f32 = 6.28318530717958647692;\nconst PI: f32 = 3.14159265358979323846;`;
