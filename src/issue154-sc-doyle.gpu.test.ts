// @vitest-environment node
//
// #154 — conformal-geometry warps. schwarz_christoffel (V317) maps the unit
// disk onto a regular n-gon interior via a 10-term SC binomial series; doyle
// (V318) is a (p,q) log-spiral hex warp in log space. Both novel (no JWF/flam3-C
// reference). GPU smoke: finite + bounded + structural oracle checks, runtime
// args (constant args would compiler-fold and mask the Dawn trig cliff).
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
${extractWgslFn(SHADER_SRC, 'safe_cos')}
${extractWgslFn(SHADER_SRC, 'complex_mul')}
${extractWgslFn(SHADER_SRC, 'complex_sqr')}
${extractWgslFn(SHADER_SRC, 'complex_pow_int')}
${extractWgslFn(SHADER_SRC, 'complex_log')}
${extractWgslFn(SHADER_SRC, 'complex_exp')}
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

// SC probe grid: inside-disk points + on/near the boundary + far-outside extremes.
const GRID: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.3, 0.4], [-0.6, 0.2], [0.5, -0.5], [0.99, 0], [1.5, 1.5], [8, -8], [0.001, 0.001],
];

describe('V317 schwarz_christoffel', () => {
  it('origin → origin (empty series tail, z=0)', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_schwarz_christoffel');
    const out = await dispatchKernel('var_schwarz_christoffel', fn, [[0, 0]], `5.0`);
    expect(out[0]!).toBeCloseTo(0, 5);
    expect(out[1]!).toBeCloseTo(0, 5);
  });
  it('finite & bounded on the whole grid (pentagon, n=5)', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_schwarz_christoffel');
    const out = await dispatchKernel('var_schwarz_christoffel', fn, GRID, `5.0`);
    for (let i = 0; i < GRID.length; i++) {
      expect(finite(out, i), `point ${i} non-finite`).toBe(true);
      // disk → bounded polygon; |w(z)| stays O(1) for the soft-clamped disk
      expect(Math.hypot(out[i * 2]!, out[i * 2 + 1]!), `point ${i} unbounded`).toBeLessThan(4);
    }
  });
  it('small-z linearizes (w(z) ≈ z): leading term is z¹', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_schwarz_christoffel');
    const z: readonly [number, number] = [0.01, 0.02];
    const out = await dispatchKernel('var_schwarz_christoffel', fn, [z], `5.0`);
    // for |z|≪1 the nk+1 powers k≥1 are O(z⁶); w(z) ≈ z to high precision
    expect(out[0]!).toBeCloseTo(z[0], 4);
    expect(out[1]!).toBeCloseTo(z[1], 4);
  });
});

const DGRID: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.7], [-1.2, 0.4], [0.3, -2.1], [3, 3], [-3, -3], [8, -8], [0.05, 0.05], [1, 0],
];

describe('V318 doyle', () => {
  it('finite on the whole grid (default p=2, q=1)', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_doyle');
    const out = await dispatchKernel('var_doyle', fn, DGRID, `2.0, 1.0`);
    for (let i = 0; i < DGRID.length; i++) {
      expect(finite(out, i), `point ${i} non-finite`).toBe(true);
    }
  });
  it('q=0 collapses the shear (pitch 0): r=1 input stays on the +x axis', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_doyle');
    // pitch=0 ⇒ vs = θ + 0; at r=1,θ=0 ⇒ vs=0 ⇒ imaginary part 0.
    const out = await dispatchKernel('var_doyle', fn, [[1.0, 0.0]], `2.0, 0.0`);
    expect(finite(out, 0)).toBe(true);
    expect(out[1]!).toBeCloseTo(0, 4);
  });
  it('continuity in p: p=2.0 and p=2.001 give near-equal output (animatable)', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_doyle');
    const a = await dispatchKernel('var_doyle', fn, [[0.6, 0.8]], `2.0, 1.0`);
    const b = await dispatchKernel('var_doyle', fn, [[0.6, 0.8]], `2.001, 1.0`);
    expect(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)).toBeLessThan(0.05);
  });
});
