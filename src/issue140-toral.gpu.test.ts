// @vitest-environment node
//
// #140 V237..V240 — Toral chaos maps.

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

const VAR_ARNOLD_CAT = extractWgslFn(SHADER_SRC, 'var_arnold_cat');
const VAR_BAKERS_MAP = extractWgslFn(SHADER_SRC, 'var_bakers_map');
const VAR_TENT_MAP = extractWgslFn(SHADER_SRC, 'var_tent_map');
const VAR_LOGISTIC_MAP = extractWgslFn(SHADER_SRC, 'var_logistic_map');

const PRELUDE = `
${VAR_ARNOLD_CAT}
${VAR_BAKERS_MAP}
${VAR_TENT_MAP}
${VAR_LOGISTIC_MAP}
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
  if (fn === 'var_logistic_map') paramCall = '3.9';

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

describe.skipIf(!device)('#140 — Area-preserving / toral chaos maps', () => {
  it('arnold_cat is bounded [-0.5, 0.5]', async () => {
    const out = await dispatch('var_arnold_cat', [[10.5, -2.1], [0.1, 0.1]]);
    expect(out[0]).toBeGreaterThanOrEqual(-0.5);
    expect(out[0]).toBeLessThanOrEqual(0.5);
    expect(out[1]).toBeGreaterThanOrEqual(-0.5);
    expect(out[1]).toBeLessThanOrEqual(0.5);
  });

  it('bakers_map behaves properly', async () => {
    // p=(0.25, 0.25) -> x=0.75, y=0.75 -> x>0.5
    // Actually fract(p+0.5) is fract(0.75) = 0.75.
    // 2*0.75 - 1.0 = 0.5, y*0.5+0.5 = 0.875.
    // mapped to [-0.5, 0.5] -> 0.0, 0.375
    const out = await dispatch('var_bakers_map', [[0.25, 0.25]]);
    expect(out[0]).toBeCloseTo(0.0);
    expect(out[1]).toBeCloseTo(0.375);
  });

  it('tent_map produces linear folding', async () => {
    const out = await dispatch('var_tent_map', [[0.0, 0.0]]);
    // p=0.0 -> x=0.5. 1 - abs(1 - 2*0.5) = 1.0 -> minus 0.5 = 0.5
    expect(out[0]).toBeCloseTo(0.5);
    expect(out[1]).toBeCloseTo(0.5);
  });

  it('logistic_map applies parabola', async () => {
    const out = await dispatch('var_logistic_map', [[0.0, 0.0]]);
    // fract(0.5) = 0.5
    // 3.9 * 0.5 * 0.5 = 0.975 -> minus 0.5 = 0.475
    expect(out[0]).toBeCloseTo(0.475);
    expect(out[1]).toBeCloseTo(0.475);
  });
});
