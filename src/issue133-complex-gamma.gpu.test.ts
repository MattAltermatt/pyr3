// @vitest-environment node
//
// #133 V223 — complex Γ via Lanczos g=7 + reflection branch.
// Tolerances are loose (~1e-2 absolute) because f32 Lanczos suffers from
// catastrophic cancellation across alternating-sign coefficients
// (676.5, -1259.1, 771.3, -176.6, ...). The f64 oracle would give ~1e-15;
// f32 typically lands within ~1% relative error for |z| ~ O(1).
//
// Defer-if-gnarly clause: if these tests cannot reach the listed
// tolerances even after a single round of helper tuning, file a fresh
// issue and ship the other 4 variations without V223.

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
const CPX_MUL = extractWgslFn(SHADER_SRC, 'complex_mul');
const CPX_DIV = extractWgslFn(SHADER_SRC, 'complex_div');
const CPX_LOG = extractWgslFn(SHADER_SRC, 'complex_log');
const CPX_EXP = extractWgslFn(SHADER_SRC, 'complex_exp');
const CPX_POW = extractWgslFn(SHADER_SRC, 'complex_pow');
const CPX_SIN = extractWgslFn(SHADER_SRC, 'complex_sin');
const VAR_GAMMA = extractWgslFn(SHADER_SRC, 'var_complex_gamma');

const PRELUDE = `const TAU: f32 = 6.28318530717958647692;
const SIN_SAFE_MAX: f32 = 1.0e6;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
${CPX_MUL}
${CPX_DIV}
${CPX_LOG}
${CPX_EXP}
${CPX_POW}
${CPX_SIN}
${VAR_GAMMA}
`;

async function dispatchGamma(inputs: ReadonlyArray<readonly [number, number, number]>): Promise<Float32Array> {
  const dev = device!;
  const N = inputs.length;
  const flat = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    flat[i * 4]     = inputs[i]![0];
    flat[i * 4 + 1] = inputs[i]![1];
    flat[i * 4 + 2] = inputs[i]![2];
    flat[i * 4 + 3] = 0;
  }
  const inBuf = dev.createBuffer({
    size: flat.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  dev.queue.writeBuffer(inBuf, 0, flat);
  const outBuf = dev.createBuffer({
    size: N * 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const code = `${PRELUDE}
@group(0) @binding(0) var<storage, read> ins: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outs: array<vec2f>;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&ins)) { return; }
  let r = ins[i];
  outs[i] = var_complex_gamma(r.xy, 1.0, r.z);
}`;
  const mod = dev.createShaderModule({ code });
  const pipeline = dev.createComputePipeline({
    layout: 'auto',
    compute: { module: mod, entryPoint: 'main' },
  });
  const bg = dev.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: inBuf } },
      { binding: 1, resource: { buffer: outBuf } },
    ],
  });
  const enc = dev.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(N);
  pass.end();
  const readback = dev.createBuffer({
    size: N * 8,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  enc.copyBufferToBuffer(outBuf, 0, readback, 0, N * 8);
  dev.queue.submit([enc.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();
  inBuf.destroy(); outBuf.destroy(); readback.destroy();
  return out;
}

describe.skipIf(!device)('#133 V223 — var_complex_gamma', () => {
  it('Γ(1) = 1, Γ(2) = 1 (positive integers, no reflection)', async () => {
    const out = await dispatchGamma([
      [1.0, 0.0, 1.0],
      [2.0, 0.0, 1.0],
    ]);
    expect(out[0]).toBeCloseTo(1, 2);
    expect(out[1]).toBeCloseTo(0, 2);
    expect(out[2]).toBeCloseTo(1, 2);
    expect(out[3]).toBeCloseTo(0, 2);
  });

  it('Γ(3) = 2, Γ(4) = 6 (factorial check)', async () => {
    const out = await dispatchGamma([
      [3.0, 0.0, 1.0],
      [4.0, 0.0, 1.0],
    ]);
    expect(out[0]).toBeCloseTo(2, 2);
    expect(out[1]).toBeCloseTo(0, 2);
    expect(out[2]).toBeCloseTo(6, 1);
    expect(out[3]).toBeCloseTo(0, 1);
  });

  it('Γ(0.5) = √π ≈ 1.7725 (half-integer)', async () => {
    const out = await dispatchGamma([
      [0.5, 0.0, 1.0],
    ]);
    expect(out[0]).toBeCloseTo(Math.sqrt(Math.PI), 1);
    expect(out[1]).toBeCloseTo(0, 2);
  });

  it('Γ(1+i) ≈ (0.498, -0.155) (complex input)', async () => {
    const out = await dispatchGamma([
      [1.0, 1.0, 1.0],
    ]);
    expect(out[0]).toBeCloseTo(0.4980, 2);
    expect(out[1]).toBeCloseTo(-0.1549, 2);
  });

  it('Γ(-0.5) ≈ -2√π (reflection branch on negative half-axis)', async () => {
    const out = await dispatchGamma([
      [-0.5, 0.0, 1.0],
    ]);
    // -2√π ≈ -3.5449. f32 + reflection sin(πz) gives looser tolerance.
    expect(out[0]).toBeCloseTo(-2 * Math.sqrt(Math.PI), 0);
    expect(out[1]).toBeCloseTo(0, 0);
  });

  it('scale parameter divides output', async () => {
    // Γ(1) with scale=0.3 → 0.3
    const out = await dispatchGamma([
      [1.0, 0.0, 0.3],
    ]);
    expect(out[0]).toBeCloseTo(0.3, 2);
  });

  it('finite output for chaos-game inputs', async () => {
    const out = await dispatchGamma([
      [0.5, 0.5, 0.3],
      [-0.3, 0.7, 0.3],
      [1.2, -0.4, 0.3],
      [0.1, 0.05, 0.3],
    ]);
    for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});
