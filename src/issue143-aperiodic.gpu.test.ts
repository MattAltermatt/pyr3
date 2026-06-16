// @vitest-environment node
//
// #143 — aperiodic-tiling warps. quasicrystal (V319) is an n-fold plane-wave
// interference field rendered as gradient ridge-attraction; penrose (V320) is a
// de Bruijn pentagrid cut-and-project that snaps points to Penrose tile vertices.
// Both novel (no JWF/flam3-C reference). GPU smoke: finite + bounded + structural
// oracle checks, runtime args (constant args would compiler-fold the trig cliff).
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';

Object.assign(globalThis, globals);

let _gpu: ReturnType<typeof create> | null = null;
let device: GPUDevice | null = null;
try {
  _gpu = create([]);
  const adapter = await _gpu.requestAdapter();
  device = adapter ? await adapter.requestDevice() : null;
} catch {
  device = null;
}
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = readFileSync(new URL('./shaders/chaos.wgsl', import.meta.url), 'utf8');

// Module consts don't survive extractWgslFn — redeclare them in the prelude.
const PRELUDE = `
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.28318530717958647692;
const SIN_SAFE_MAX: f32 = 1.0e6;
${extractWgslFn(SHADER_SRC, 'hash01')}
${extractWgslFn(SHADER_SRC, 'safe_sin')}
`;

async function dispatchKernel(
  fnName: string, fnBody: string,
  inputs: ReadonlyArray<readonly [number, number]>, paramsCall: string,
): Promise<Float32Array> {
  const dev = device!;
  const N = inputs.length;
  const flat = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) { flat[i * 4] = inputs[i]![0]; flat[i * 4 + 1] = inputs[i]![1]; }
  const inBuf = dev.createBuffer({ size: flat.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  dev.queue.writeBuffer(inBuf, 0, flat);
  const outBuf = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const code = `${PRELUDE}
${fnBody}
@group(0) @binding(0) var<storage, read> ins: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outs: array<vec2f>;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&ins)) { return; }
  let r = ins[i];
  outs[i] = ${fnName}(r.xy, 1.0, ${paramsCall});
}`;
  const mod = await compileChecked(dev, code);
  const info = await mod.getCompilationInfo();
  const errs = info.messages.filter((m) => m.type === 'error');
  if (errs.length) throw new Error('WGSL compile error: ' + errs.map((m) => m.message).join('; '));
  const bgl = dev.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  ] });
  const pl = dev.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const pipeline = dev.createComputePipeline({ layout: pl, compute: { module: mod, entryPoint: 'main' } });
  const bg = dev.createBindGroup({ layout: bgl, entries: [
    { binding: 0, resource: { buffer: inBuf } },
    { binding: 1, resource: { buffer: outBuf } },
  ] });
  const enc = dev.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(N); pass.end();
  const readBuf = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc2 = dev.createCommandEncoder();
  enc2.copyBufferToBuffer(outBuf, 0, readBuf, 0, N * 8);
  dev.queue.submit([enc.finish(), enc2.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const res = new Float32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  inBuf.destroy(); outBuf.destroy(); readBuf.destroy();
  return res;
}

const finite = (out: Float32Array, i: number) =>
  Number.isFinite(out[i * 2]) && Number.isFinite(out[i * 2 + 1]);

const GRID: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.5, 0.7], [-1.2, 0.4], [0.3, -2.1], [3, 3], [-3, -3], [8, -8], [0.001, 0.001],
];

describe('V319 quasicrystal', () => {
  it('origin → origin (∇s = 0 at the center)', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_quasicrystal');
    const out = await dispatchKernel('var_quasicrystal', fn, [[0, 0]], `5.0, 3.0`);
    expect(out[0]!).toBeCloseTo(0, 5);
    expect(out[1]!).toBeCloseTo(0, 5);
  });
  it('finite; displacement bounded by QC_STEP=0.4 (ridge-attraction)', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_quasicrystal');
    const out = await dispatchKernel('var_quasicrystal', fn, GRID, `5.0, 3.0`);
    for (let i = 0; i < GRID.length; i++) {
      expect(finite(out, i), `point ${i} non-finite`).toBe(true);
      // |out - p| ≤ QC_STEP (w=1); the warp is a bounded gradient displacement
      const dx = out[i * 2]! - GRID[i]![0], dy = out[i * 2 + 1]! - GRID[i]![1];
      expect(Math.hypot(dx, dy), `point ${i} displaced too far`).toBeLessThanOrEqual(0.4001);
    }
  });
  it('symmetry parameter has effect: n=5 vs n=7 differ across the grid', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_quasicrystal');
    const a = await dispatchKernel('var_quasicrystal', fn, GRID, `5.0, 3.0`);
    const b = await dispatchKernel('var_quasicrystal', fn, GRID, `7.0, 3.0`);
    let agg = 0;
    for (let i = 0; i < GRID.length; i++) agg += Math.hypot(a[i * 2]! - b[i * 2]!, a[i * 2 + 1]! - b[i * 2 + 1]!);
    expect(agg, 'symmetry should change the field globally').toBeGreaterThan(1e-3);
  });
});

describe('V320 penrose', () => {
  it('finite & bounded by input scale on the grid', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_penrose');
    const out = await dispatchKernel('var_penrose', fn, GRID, `1.0, 0.2`);
    for (let i = 0; i < GRID.length; i++) {
      expect(finite(out, i), `point ${i} non-finite`).toBe(true);
      // pentagrid vertex magnitude tracks input radius (×~5 families / scale)
      const rin = Math.hypot(GRID[i]![0], GRID[i]![1]);
      expect(Math.hypot(out[i * 2]!, out[i * 2 + 1]!)).toBeLessThanOrEqual(rin * 5 + 5);
    }
  });
  it('snaps to a lattice: two near-identical inputs map to the SAME vertex', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_penrose');
    // both points sit inside the same pentagrid cell (all 5 floors agree)
    const out = await dispatchKernel('var_penrose', fn, [[0.30, 0.30], [0.3001, 0.3001]], `1.0, 0.2`);
    expect(out[0]!).toBeCloseTo(out[2]!, 5);
    expect(out[1]!).toBeCloseTo(out[3]!, 5);
  });
  it('scale parameter has effect: scale=1 vs scale=2 differ', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_penrose');
    const p: readonly [number, number] = [1.3, -0.7];
    const a = await dispatchKernel('var_penrose', fn, [p], `1.0, 0.2`);
    const b = await dispatchKernel('var_penrose', fn, [p], `2.0, 0.2`);
    expect(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)).toBeGreaterThan(1e-4);
  });
});
