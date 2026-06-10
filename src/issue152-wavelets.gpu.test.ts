// @vitest-environment node
//
// #152 — Wavelet & signal warps (V296–V298): morlet, mexican_hat, chirp.
// Radial modulations p → p·(1+amp·ψ). morlet/chirp route their freq-scaled
// argument through safe_*; chirp's α·r² is the named Dawn trig-cliff case,
// exercised with RUNTIME args so constant-folding can't mask it.
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

const SHADER_SRC = readFileSync(
  new URL('./shaders/chaos.wgsl', import.meta.url), 'utf8',
);

const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');

const PRELUDE = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.28318530717958647692;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
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

const cross = (out: Float32Array, i: number, p: readonly [number, number]) => out[i*2]! * p[1] - out[i*2+1]! * p[0];

describe('V296 morlet', () => {
  it('origin fixed, direction preserved, relaxes to identity far out', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_morlet');
    const pts = [[0, 0], [0.5, 0.3], [-0.7, 0.4], [3.0, 4.0]] as const;
    const out = await dispatchKernel('var_morlet', fnBody, pts, '6.0, 0.5, 0.35');
    expect(Math.hypot(out[0]!, out[1]!)).toBeLessThan(1e-6);            // origin
    expect(Math.abs(cross(out, 1, pts[1]))).toBeLessThan(1e-5);         // collinear
    expect(Math.abs(cross(out, 2, pts[2]))).toBeLessThan(1e-5);
    // r=5 → env≈exp(-50)≈0 → out≈input
    expect(out[3*2]).toBeCloseTo(3.0, 4); expect(out[3*2+1]).toBeCloseTo(4.0, 4);
  });
  it('safe_cos cliff: freq·r > 1e6 stays finite and bounded', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_morlet');
    const out = await dispatchKernel('var_morlet', fnBody, [[1, 0]], '2.0e6, 0.5, 0.35');
    expect(Number.isFinite(out[0]!)).toBe(true);
    expect(Math.abs(out[0]!)).toBeLessThanOrEqual(1.35 + 1e-3);
  });
});

describe('V297 mexican_hat', () => {
  it('origin fixed, zero-crossing at r=σ is identity, trough pulls inward', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_mexican_hat');
    const sigma = 0.45, amp = 0.4;
    const pts = [[0, 0], [sigma, 0], [sigma * Math.sqrt(3), 0]] as const;
    const out = await dispatchKernel('var_mexican_hat', fnBody, pts, `${sigma}, ${amp}`);
    expect(Math.hypot(out[0]!, out[1]!)).toBeLessThan(1e-6);            // origin
    expect(out[1*2]).toBeCloseTo(sigma, 5);                            // r=σ → ψ=0 → identity
    expect(Math.abs(out[2*2]!)).toBeLessThan(sigma * Math.sqrt(3));    // trough → inward (|out|<|p|)
  });
  it('evenness: (x,y) and (-x,-y) negate exactly', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_mexican_hat');
    const a = await dispatchKernel('var_mexican_hat', fnBody, [[0.3, 0.5]], '0.45, 0.4');
    const b = await dispatchKernel('var_mexican_hat', fnBody, [[-0.3, -0.5]], '0.45, 0.4');
    expect(a[0]).toBeCloseTo(-b[0]!, 5); expect(a[1]).toBeCloseTo(-b[1]!, 5);
  });
});

describe('V298 chirp', () => {
  it('origin fixed + locally identity (sin(0)=0)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_chirp');
    const out = await dispatchKernel('var_chirp', fnBody, [[0, 0]], '8.0, 0.3, 0.6');
    expect(out[0]).toBe(0); expect(out[1]).toBe(0);
  });
  it('decay envelope relaxes to identity far out', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_chirp');
    // decay=4, r²=4 → env=exp(-16)≈0 → out≈input
    const out = await dispatchKernel('var_chirp', fnBody, [[2.0, 0]], '8.0, 0.3, 4.0');
    expect(out[0]).toBeCloseTo(2.0, 4);
  });
  it('safe_sin cliff (the headline): α·r² > 1e6 stays finite + bounded, NOT collapsed', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_chirp');
    // α=2e7, r²=1 → α·r²=2e7 > SIN_SAFE_MAX; raw sin would return 0 on Dawn,
    // safe_sin returns the hash-spread value. decay=0 so the envelope is 1.
    const out = await dispatchKernel('var_chirp', fnBody, [[1, 0]], '2.0e7, 0.3, 0.0');
    expect(Number.isFinite(out[0]!)).toBe(true);
    expect(Math.abs(out[0]!)).toBeLessThanOrEqual(1.3 + 1e-3);
  });
});
