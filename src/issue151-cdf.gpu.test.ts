// @vitest-environment node
//
// #151 — Statistical-distribution warps (V292–V295): weibull_cdf, logistic_cdf,
// cauchy_cdf, pareto_cdf. Radial inverse-CDF remaps; cauchy uses safe_tan. The
// load-bearing property is the two-layer tail clamp on the heavy-tailed members
// (cauchy, pareto) — a far input must clamp to exactly tail_clamp, never fling.
import { afterAll, describe, expect, it } from 'vitest';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import { acquireTestGpu, CHAOS_WGSL } from './gpu-test-harness';

const { gpu: _gpu, device } = await acquireTestGpu();
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = CHAOS_WGSL;

const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');
const SAFE_TAN = extractWgslFn(SHADER_SRC, 'safe_tan');

const PRELUDE = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.28318530717958647692;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
${SAFE_TAN}
`;

async function dispatchKernel(
  fnName: string,
  fnBody: string,
  inputs: ReadonlyArray<readonly [number, number]>,
  paramsCall: string,
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

const uMap = (r2: number) => Math.min(Math.max(r2 / (1 + r2), 1e-4), 1 - 1e-4);
const mag = (out: Float32Array, i: number) => Math.hypot(out[i*2]!, out[i*2+1]!);

describe('V292 weibull_cdf', () => {
  it('origin → origin, radial purity, closed-form match, monotone', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_weibull_cdf');
    const lambda = 0.6, k = 1.5;
    const pts = [[0, 0], [0.5, 0], [0, 0.7], [0.3, 0], [0.9, 0]] as const;
    const out = await dispatchKernel('var_weibull_cdf', fnBody, pts, `${lambda}, ${k}`);
    expect(mag(out, 0)).toBeLessThan(1e-6);                    // origin
    expect(Math.abs(out[1*2+1]!)).toBeLessThan(1e-5);          // (0.5,0) → out.y≈0
    expect(Math.abs(out[2*2]!)).toBeLessThan(1e-5);            // (0,0.7) → out.x≈0
    // closed form at (0.5,0)
    const u = uMap(0.25); const rp = lambda * Math.pow(-Math.log(1 - u), 1 / k);
    expect(mag(out, 1)).toBeCloseTo(rp, 4);
    expect(mag(out, 4)).toBeGreaterThan(mag(out, 3));          // monotone r
  });
});

describe('V293 logistic_cdf', () => {
  it('unit circle collapses to origin (logit=0 at μ=0)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_logistic_cdf');
    const out = await dispatchKernel('var_logistic_cdf', fnBody, [[1, 0], [0.3, 0]], '0.0, 0.35');
    expect(mag(out, 0)).toBeLessThan(1e-4);                    // r=1 → origin
  });
  it('bounded tail: u-map endpoint guard caps the logit (never flings)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_logistic_cdf');
    const out = await dispatchKernel('var_logistic_cdf', fnBody, [[50, 0]], '0.0, 0.35');
    // closed-form at r=50: the u-map clamp (1e-4), not the ±12 logit clamp, is
    // the binding bound — asymptotic max is s·log((1-1e-4)/1e-4) ≈ 0.35·9.21.
    const u = uMap(2500); const rp = Math.max(0.35 * Math.log(u / (1 - u)), 0);
    expect(mag(out, 0)).toBeCloseTo(rp, 3);
    expect(mag(out, 0)).toBeLessThan(0.35 * Math.log(9999) + 1e-3);   // hard asymptotic cap ≈ 3.22
  });
});

describe('V294 cauchy_cdf', () => {
  it('unit circle → origin (median), closed-form in linear regime', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_cauchy_cdf');
    const gamma = 0.25;
    const out = await dispatchKernel('var_cauchy_cdf', fnBody, [[1, 0], [0.5, 0]], `${gamma}, 4.0`);
    expect(mag(out, 0)).toBeLessThan(1e-4);                    // median
    const u = uMap(0.25); const rp = gamma * Math.tan(Math.PI * (u - 0.5));
    expect(out[1*2]!).toBeCloseTo(rp, 4);                      // closed form (well below cap)
  });
  it('HARD tail clamp: far input pins to exactly tail_clamp', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_cauchy_cdf');
    const out = await dispatchKernel('var_cauchy_cdf', fnBody, [[30, 0]], '0.25, 4.0');
    expect(mag(out, 0)).toBeCloseTo(4.0, 4);
  });
});

describe('V295 pareto_cdf', () => {
  it('origin → origin, minimum-radius floor ≥ x_m', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_pareto_cdf');
    const out = await dispatchKernel('var_pareto_cdf', fnBody, [[0, 0], [0.2, 0]], '0.3, 1.6, 4.0');
    expect(mag(out, 0)).toBe(0);                               // dir zeroed at origin
    expect(mag(out, 1)).toBeGreaterThanOrEqual(0.3 - 1e-4);    // floor at x_m
  });
  it('HARD tail clamp: far input pins to exactly tail_clamp', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_pareto_cdf');
    const out = await dispatchKernel('var_pareto_cdf', fnBody, [[50, 0]], '0.3, 1.6, 4.0');
    expect(mag(out, 0)).toBeCloseTo(4.0, 4);
  });
});
