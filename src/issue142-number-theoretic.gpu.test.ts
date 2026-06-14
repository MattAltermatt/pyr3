// @vitest-environment node
//
// #142 — number-theoretic dynamics. collatz (V321) is the smooth complex Collatz
// (3n+1) map; digamma (V322) is ψ(z) via asymptotic series + recurrence shift.
// Both novel (no JWF/flam3-C reference). GPU smoke: finite + closed-form oracle
// checks (collatz even/odd integers, digamma ψ(1)=−γ), runtime args (constant
// args would compiler-fold the trig cliff).
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
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
${extractWgslFn(SHADER_SRC, 'safe_cos')}
${extractWgslFn(SHADER_SRC, 'complex_mul')}
${extractWgslFn(SHADER_SRC, 'complex_sin')}
${extractWgslFn(SHADER_SRC, 'complex_recip')}
${extractWgslFn(SHADER_SRC, 'complex_log')}
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
  const mod = dev.createShaderModule({ code });
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
  [0.5, 0.7], [-1.2, 0.4], [0.3, -2.1], [2.5, 1.1], [-3, 0.5], [1.7, -0.8], [0.05, 0.05], [4, 1.5],
];

describe('V321 collatz', () => {
  it('even integer z=2 → 1 (z/2 branch: cos²(π)=1)', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_collatz');
    const out = await dispatchKernel('var_collatz', fn, [[2, 0]], `1.0, 0.0`);
    expect(out[0]!).toBeCloseTo(1, 3);  // 2/2 = 1
    expect(out[1]!).toBeCloseTo(0, 3);
  });
  it('odd integer z=3 → 5 ((3z+1)/2 branch: sin²(3π/2)=1)', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_collatz');
    const out = await dispatchKernel('var_collatz', fn, [[3, 0]], `1.0, 0.0`);
    expect(out[0]!).toBeCloseTo(5, 3);  // (3·3+1)/2 = 5
    expect(out[1]!).toBeCloseTo(0, 3);
  });
  it('finite on the grid; scale/shift have effect', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_collatz');
    const out = await dispatchKernel('var_collatz', fn, GRID, `1.0, 0.0`);
    for (let i = 0; i < GRID.length; i++) expect(finite(out, i), `point ${i} non-finite`).toBe(true);
    const a = await dispatchKernel('var_collatz', fn, [[0.6, 0.4]], `1.0, 0.0`);
    const b = await dispatchKernel('var_collatz', fn, [[0.6, 0.4]], `1.5, 0.3`);
    expect(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)).toBeGreaterThan(1e-3);
  });
});

describe('V322 digamma', () => {
  it('real-axis oracle: ψ(1) = −γ ≈ −0.5772', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_digamma');
    const out = await dispatchKernel('var_digamma', fn, [[1, 0]], `1.0, 0.0`);
    expect(out[0]!).toBeCloseTo(-0.5772157, 3);
    expect(out[1]!).toBeCloseTo(0, 3);
  });
  it('real-axis oracle: ψ(2) = 1 − γ ≈ 0.4228', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_digamma');
    const out = await dispatchKernel('var_digamma', fn, [[2, 0]], `1.0, 0.0`);
    expect(out[0]!).toBeCloseTo(0.4227843, 3);
    expect(out[1]!).toBeCloseTo(0, 3);
  });
  it('finite on the grid; scale/shift have effect', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_digamma');
    const out = await dispatchKernel('var_digamma', fn, GRID, `1.0, 0.0`);
    for (let i = 0; i < GRID.length; i++) expect(finite(out, i), `point ${i} non-finite`).toBe(true);
    const a = await dispatchKernel('var_digamma', fn, [[0.6, 0.4]], `1.0, 0.0`);
    const b = await dispatchKernel('var_digamma', fn, [[0.6, 0.4]], `1.5, 0.3`);
    expect(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)).toBeGreaterThan(1e-3);
  });
});
