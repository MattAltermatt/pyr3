// @vitest-environment node
//
// #135 V241..V245 — Plane & roulette-curve warps.

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
const SAFE_TANH = extractWgslFn(SHADER_SRC, 'safe_tanh'); // var_tractrix routes tanh through it (#262)
const VAR_SUPERELLIPSE = extractWgslFn(SHADER_SRC, 'var_superellipse');
const VAR_LIMACON = extractWgslFn(SHADER_SRC, 'var_limacon');
const VAR_EPICYCLOID = extractWgslFn(SHADER_SRC, 'var_epicycloid');
const VAR_CATENARY = extractWgslFn(SHADER_SRC, 'var_catenary');
const VAR_TRACTRIX = extractWgslFn(SHADER_SRC, 'var_tractrix');

const PRELUDE = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const TANH_SAFE_MAX: f32 = 20.0;
const TAU: f32 = 6.28318530717958647692;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
${SAFE_TANH}
${VAR_SUPERELLIPSE}
${VAR_LIMACON}
${VAR_EPICYCLOID}
${VAR_CATENARY}
${VAR_TRACTRIX}
`;

async function dispatch(fn: string, inputs: ReadonlyArray<readonly [number, number]>): Promise<Float32Array> {
  const dev = device!;
  const N = inputs.length;
  const flat = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    flat[i * 4]     = inputs[i]![0];
    flat[i * 4 + 1] = inputs[i]![1];
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
  
  let paramCall = '';
  if (fn === 'var_superellipse') paramCall = '1.0, 1.0, 2.0';
  else if (fn === 'var_limacon') paramCall = '1.0, 0.5';
  else if (fn === 'var_epicycloid') paramCall = '3.0';
  else if (fn === 'var_catenary') paramCall = '1.0';

  const code = `${PRELUDE}
@group(0) @binding(0) var<storage, read> ins: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outs: array<vec2f>;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&ins)) { return; }
  let r = ins[i];
  ${paramCall === '' ? `outs[i] = ${fn}(r.xy, 1.0);` : `outs[i] = ${fn}(r.xy, 1.0, ${paramCall});`}
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

describe.skipIf(!device)('#135 — Plane & roulette-curve warps', () => {
  it('superellipse maps to ellipse with n=2', async () => {
    const out = await dispatch('var_superellipse', [[1, 0], [0, 1]]);
    expect(out[0]).toBeCloseTo(1.0);
    expect(out[1]).toBeCloseTo(0.0);
    expect(out[2]).toBeCloseTo(0.0);
    expect(out[3]).toBeCloseTo(1.0);
  });

  it('limacon generates expected values', async () => {
    const out = await dispatch('var_limacon', [[1, 0]]); // theta = 0
    // r = 0.5 + 1.0 * cos(0) = 1.5
    expect(out[0]).toBeCloseTo(1.5);
    expect(out[1]).toBeCloseTo(0.0);
  });

  it('epicycloid generates expected values', async () => {
    const out = await dispatch('var_epicycloid', [[1, 0]]); // theta = 0
    // xp = 4*1 - 1 = 3, yp = 4*0 - 0 = 0
    expect(out[0]).toBeCloseTo(3.0);
    expect(out[1]).toBeCloseTo(0.0);
  });

  it('catenary works correctly', async () => {
    const out = await dispatch('var_catenary', [[0, 0]]);
    // xp = 0
    // yp = 1 * cosh(0) = 1
    expect(out[0]).toBeCloseTo(0.0);
    expect(out[1]).toBeCloseTo(1.0);
  });

  it('tractrix is finite', async () => {
    const out = await dispatch('var_tractrix', [[1, 1]]);
    expect(Number.isFinite(out[0])).toBe(true);
    expect(Number.isFinite(out[1])).toBe(true);
  });
});
