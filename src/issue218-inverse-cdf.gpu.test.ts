// @vitest-environment node
//
// #218 — inverse-CDF distribution warps via a shared erfinv helper (V307
// gaussian_cdf, V308 levy_cdf). Radial inverse-CDF remaps (#151 idiom):
// u = r²/(1+r²) endpoint-clamped → quantile → re-emit along the direction.
// gaussian_cdf is the bell-shaped member (unit circle → radius μ); levy_cdf is
// the heaviest-tailed member and MUST hard-clamp (erfinv(1−u)→0 at the rim
// blows it up). erfinv uses PI + log → prelude stamps PI + erfinv_eval.
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
const ERFINV = extractWgslFn(SHADER_SRC, 'erfinv_eval');
const PRELUDE = `
const PI: f32 = 3.141592653589793;
${ERFINV}
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

const mag = (out: Float32Array, i: number) => Math.hypot(out[i*2]!, out[i*2+1]!);
const uMap = (r2: number) => Math.min(Math.max(r2 / (1 + r2), 1e-4), 1 - 1e-4);
function jsErfinv(x: number): number {
  const xc = Math.max(-0.999999, Math.min(0.999999, x));
  const a = 0.147; const ln1 = Math.log(1 - xc*xc);
  const t1 = 2/(Math.PI*a) + 0.5*ln1;
  const inner = Math.sqrt(Math.max(t1*t1 - ln1/a, 0)) - t1;
  return Math.sign(xc) * Math.sqrt(Math.max(inner, 0));
}

describe('erfinv helper', () => {
  it('erfinv(0)=0; odd symmetry; erf(erfinv(x))≈x roundtrip-ish', () => {
    expect(jsErfinv(0)).toBeCloseTo(0, 6);
    expect(jsErfinv(0.5)).toBeCloseTo(-jsErfinv(-0.5), 6);
    // Winitzki is a ~1e-3 approximation; erfinv(0.8427)≈1.0 (erf(1)=0.8427).
    expect(jsErfinv(0.8427008)).toBeCloseTo(1.0, 2);
  });
});

describe('V307 gaussian_cdf', () => {
  it('unit circle → radius μ (median, erfinv(0)=0); origin → origin', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_gaussian_cdf');
    const mu = 0.9, sigma = 0.5;
    const out = await dispatchKernel('var_gaussian_cdf', fnBody, [[1, 0], [0, 0]], `${mu}, ${sigma}`);
    expect(mag(out, 0)).toBeCloseTo(mu, 3);                  // u=0.5 → r'=μ
    expect(mag(out, 1)).toBeLessThan(1e-6);                  // origin
  });
  it('closed-form match in the interior', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_gaussian_cdf');
    const mu = 0.9, sigma = 0.5;
    const out = await dispatchKernel('var_gaussian_cdf', fnBody, [[0.5, 0]], `${mu}, ${sigma}`);
    const u = uMap(0.25); const rp = Math.max(mu + sigma*1.4142135*jsErfinv(2*u-1), 0);
    expect(out[0]!).toBeCloseTo(rp, 3);
  });
});

describe('V308 levy_cdf', () => {
  it('origin → origin; HARD tail clamp pins the rim to exactly tail_clamp', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_levy_cdf');
    const out = await dispatchKernel('var_levy_cdf', fnBody, [[0, 0], [40, 0]], `0.35, 3.0`);
    expect(mag(out, 0)).toBe(0);                             // dir zeroed at origin
    expect(mag(out, 1)).toBeCloseTo(3.0, 4);                 // heavy tail → capped
  });
});
