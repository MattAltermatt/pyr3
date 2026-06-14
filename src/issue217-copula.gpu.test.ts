// @vitest-environment node
//
// #217 — statistical copula warps (cross-axis dependence). copula_gaussian
// (V315) is the exact Gaussian-copula Cholesky shear in normal-score space
// (reuses erfinv_eval); copula_clayton (V316) is the asymmetric lower-tail
// member (Clayton conditional value → logit). Both pass x through and recompute
// y' from BOTH coords — the catalog's first anisotropic statistical warp.
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
const PRELUDE = `
const PI: f32 = 3.141592653589793;
${extractWgslFn(SHADER_SRC, 'erfinv_eval')}
${extractWgslFn(SHADER_SRC, 'cop_sigmoid')}
${extractWgslFn(SHADER_SRC, 'cop_logit')}
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

// Probe grid spanning a sierpinski-ish extent plus a few extremes.
const GRID: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.5, 0.7], [-1.2, 0.4], [0.3, -2.1], [3, 3], [-3, -3], [8, -8], [0.001, 0.001],
];

describe('V315 copula_gaussian', () => {
  it('origin → origin (u=v=½ ⇒ z=0)', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_copula_gaussian');
    const out = await dispatchKernel('var_copula_gaussian', fn, [[0, 0]], `1.0, 0.0`);
    expect(out[0]!).toBeCloseTo(0, 4);   // x passes through (0)
    expect(out[1]!).toBeCloseTo(0, 3);   // zy'=0 at the median
  });
  it('x passes through unchanged; output finite & bounded on the whole grid', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_copula_gaussian');
    const out = await dispatchKernel('var_copula_gaussian', fn, GRID, `1.0, 0.6`);
    for (let i = 0; i < GRID.length; i++) {
      expect(finite(out, i), `point ${i} non-finite`).toBe(true);
      expect(out[i * 2]!).toBeCloseTo(GRID[i]![0], 5);          // x unchanged
      expect(Math.abs(out[i * 2 + 1]!)).toBeLessThan(8);        // |y'| ≲ 3.7/s, well under 8
    }
  });
  it('rho=0 decouples: y′ = √2·erfinv(2σ(y)−1)', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_copula_gaussian');
    const out = await dispatchKernel('var_copula_gaussian', fn, [[2, -1]], `1.0, 0.0`);
    const sig = (t: number) => 1 / (1 + Math.exp(-t));
    const erfinv = (xi: number) => { const xc = Math.max(-0.999999, Math.min(0.999999, xi)); const a = 0.147; const ln1 = Math.log(1 - xc * xc); const t1 = 2 / (Math.PI * a) + 0.5 * ln1; const inner = Math.sqrt(Math.max(t1 * t1 - ln1 / a, 0)) - t1; return Math.sign(xc) * Math.sqrt(Math.max(inner, 0)); };
    const v = Math.max(1e-4, Math.min(1 - 1e-4, sig(-1)));
    const expY = 1.4142135 * erfinv(2 * v - 1);
    expect(out[1]!).toBeCloseTo(expY, 2);
  });
});

describe('V316 copula_clayton', () => {
  it('output finite & bounded on the whole grid (default θ=2)', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_copula_clayton');
    const out = await dispatchKernel('var_copula_clayton', fn, GRID, `1.0, 2.0`);
    for (let i = 0; i < GRID.length; i++) {
      expect(finite(out, i), `point ${i} non-finite`).toBe(true);
      expect(out[i * 2]!).toBeCloseTo(GRID[i]![0], 5);          // x unchanged
      expect(Math.abs(out[i * 2 + 1]!)).toBeLessThanOrEqual(12.001 / 1.0); // logit cap / s
    }
  });
  it('theta cap holds: θ=50 stays finite & bounded (clamped to 8)', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_copula_clayton');
    const out = await dispatchKernel('var_copula_clayton', fn, GRID, `1.0, 50.0`);
    for (let i = 0; i < GRID.length; i++) {
      expect(finite(out, i), `point ${i} non-finite under theta=50`).toBe(true);
      expect(Math.abs(out[i * 2 + 1]!)).toBeLessThanOrEqual(12.001);
    }
  });
});
