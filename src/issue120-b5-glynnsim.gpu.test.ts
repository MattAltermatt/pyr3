// @vitest-environment node
//
// #120 batch B5 — GPU smoke tests for Glynn-set family. All three are
// RNG-driven (multiple rand01 calls per invocation) — finite-output
// smoke is the correctness signal.
//
// Skips when no GPU adapter — fast suite stays green on CI.

import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
import { extractWgslFn } from './shaders/extract';
import { ISAAC_STATE_U32, packIsaacStates } from './isaac';

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

const STRUCT_MATCH = SHADER_SRC.match(/struct IsaacState[\s\S]*?\n\};/);
if (!STRUCT_MATCH) throw new Error('chaos.wgsl: struct IsaacState not found');
const ISAAC_STRUCT = STRUCT_MATCH[0];
const ISAAC_ROUND = extractWgslFn(SHADER_SRC, 'isaac_round');
const ISAAC_IRAND = extractWgslFn(SHADER_SRC, 'isaac_irand');
const RAND01 = extractWgslFn(SHADER_SRC, 'rand01');
const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');

const PRELUDE = `const TAU: f32 = 6.28318530717958647692;
const PI: f32 = 3.14159265358979323846;
const SIN_SAFE_MAX: f32 = 1e6;
${ISAAC_STRUCT}
@group(0) @binding(0) var<storage, read_write> isaac_states: array<IsaacState>;
@group(0) @binding(1) var<storage, read> pts: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> out: array<vec2f>;
${ISAAC_ROUND}
${ISAAC_IRAND}
${RAND01}
${HASH01}
${SAFE_SIN}
${SAFE_COS}
`;

const TEST_POINTS: ReadonlyArray<readonly [number, number]> = [
  [ 0.5,  0.3],   // inside-radius case (r ≈ 0.58 < 1.0 default radius)
  [-0.5,  0.7],   // inside
  [ 1.2, -0.4],   // outside-radius (r ≈ 1.26)
  [-1.0, -1.0],   // outside (r ≈ 1.41)
  [ 0.1,  0.05],  // very inside
  [ 2.0,  0.0],   // far outside (r = 2.0)
  [ 0.0,  2.0],
  [-2.5,  1.7],
];
const N = TEST_POINTS.length;

async function dispatch(code: string, seed: number): Promise<Float32Array> {
  const dev = device!;
  const ptsFlat = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    ptsFlat[i * 2] = TEST_POINTS[i]![0];
    ptsFlat[i * 2 + 1] = TEST_POINTS[i]![1];
  }
  const ptsBuf = dev.createBuffer({
    size: ptsFlat.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  dev.queue.writeBuffer(ptsBuf, 0, ptsFlat);
  const stateBuf = dev.createBuffer({
    size: N * ISAAC_STATE_U32 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  dev.queue.writeBuffer(stateBuf, 0, packIsaacStates(N, seed));
  const outBuf = dev.createBuffer({
    size: N * 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const mod = dev.createShaderModule({ code });
  const pipeline = dev.createComputePipeline({
    layout: 'auto',
    compute: { module: mod, entryPoint: 'main' },
  });
  const bg = dev.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: stateBuf } },
      { binding: 1, resource: { buffer: ptsBuf } },
      { binding: 2, resource: { buffer: outBuf } },
    ],
  });
  const encoder = dev.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(N);
  pass.end();
  const readback = dev.createBuffer({
    size: N * 8,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  encoder.copyBufferToBuffer(outBuf, 0, readback, 0, N * 8);
  dev.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();
  ptsBuf.destroy(); stateBuf.destroy(); outBuf.destroy(); readback.destroy();
  return out;
}

function makeKernel(varBody: string, varCall: string): string {
  return `${PRELUDE}
${varBody}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = ${varCall};
}`;
}

describe.skipIf(!device)('#120 B5 — Glynn-set family (smoke)', () => {
  it('var_glynnSim1 produces finite output across inside + outside radius', async () => {
    const fn = extractWgslFn(SHADER_SRC, 'var_glynnSim1');
    // Defaults: radius=1, radius1=0.1, phi1=110°, thickness=0.1, pow=1.5, contrast=0.5
    const code = makeKernel(fn, 'var_glynnSim1(pts[i], 1.0, 1.0, 0.1, 110.0, 0.1, 1.5, 0.5, i)');
    const out = await dispatch(code, 0xc0ffee);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });

  it('var_glynnSim2 produces finite output', async () => {
    const fn = extractWgslFn(SHADER_SRC, 'var_glynnSim2');
    // Defaults: radius=1, thickness=0.1, contrast=0.5, pow=1.5, phi1=110°, phi2=150°
    const code = makeKernel(fn, 'var_glynnSim2(pts[i], 1.0, 1.0, 0.1, 0.5, 1.5, 110.0, 150.0, i)');
    const out = await dispatch(code, 0xfacade);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });

  it('var_glynnSim3 produces finite output', async () => {
    const fn = extractWgslFn(SHADER_SRC, 'var_glynnSim3');
    // Defaults: radius=1, thickness=0.1, contrast=0.5, pow=1.5
    const code = makeKernel(fn, 'var_glynnSim3(pts[i], 1.0, 1.0, 0.1, 0.5, 1.5, i)');
    const out = await dispatch(code, 0xdeadbeef);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});
