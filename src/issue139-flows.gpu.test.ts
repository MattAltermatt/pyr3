// @vitest-environment node
//
// #139 Continuous Flows tests

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
const VAR_TINKERBELL = extractWgslFn(SHADER_SRC, 'var_tinkerbell');
const VAR_DUFFING = extractWgslFn(SHADER_SRC, 'var_duffing');
const VAR_VANDERPOL = extractWgslFn(SHADER_SRC, 'var_vanderpol');
const VAR_ROSSLER = extractWgslFn(SHADER_SRC, 'var_rossler');

const PRELUDE = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const TAU: f32 = 6.28318530717958647692;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
${VAR_TINKERBELL}
${VAR_DUFFING}
${VAR_VANDERPOL}
${VAR_ROSSLER}
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
  if (fn === 'var_tinkerbell') paramCall = '0.9, -0.6, 2.0, 0.5';
  else if (fn === 'var_duffing') paramCall = '0.1, 0.1, 0.1, 1.0';
  else if (fn === 'var_vanderpol') paramCall = '0.1, 1.0';
  else if (fn === 'var_rossler') paramCall = '0.1, 0.2';

  const code = `${PRELUDE}
@group(0) @binding(0) var<storage, read> ins: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outs: array<vec2f>;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&ins)) { return; }
  let r = ins[i];
  outs[i] = ${fn}(r.xy, 1.0, ${paramCall});
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

describe('Issue #139 Continuous Flows', () => {
  it('tinkerbell warp (V246)', async () => {
    if (!device) return;
    const res = await dispatch('var_tinkerbell', [[0.5, 0.5]]);
    // a=0.9, b=-0.6, c=2.0, d=0.5
    // x = x^2 - y^2 + a*x + b*y = 0.25 - 0.25 + 0.45 - 0.3 = 0.15
    // y = 2*x*y + c*x + d*y = 0.5 + 1.0 + 0.25 = 1.75
    expect(res[0]).toBeCloseTo(0.15, 4);
    expect(res[1]).toBeCloseTo(1.75, 4);
  });

  it('duffing warp (V247)', async () => {
    if (!device) return;
    const res = await dispatch('var_duffing', [[1.0, 1.0]]);
    // h=0.1, delta=0.1, gamma=0.1, omega=1.0
    // x = 1.0 + 0.1 * 1.0 = 1.1
    // y = 1.0 + 0.1 * (1.0 - 1.0 - 0.1 * 1.0 + 0.1 * cos(1.0))
    const expectedY = 1.0 + 0.1 * (-0.1 + 0.1 * Math.cos(1.0));
    expect(res[0]).toBeCloseTo(1.1, 4);
    expect(res[1]).toBeCloseTo(expectedY, 4);
  });

  it('vanderpol warp (V248)', async () => {
    if (!device) return;
    const res = await dispatch('var_vanderpol', [[0.5, 0.5]]);
    // h=0.1, mu=1.0
    // x = 0.5 + 0.1 * 0.5 = 0.55
    // y = 0.5 + 0.1 * (1.0 * (1.0 - 0.25) * 0.5 - 0.5) = 0.5 + 0.1 * (0.375 - 0.5) = 0.4875
    expect(res[0]).toBeCloseTo(0.55, 4);
    expect(res[1]).toBeCloseTo(0.4875, 4);
  });

  it('rossler warp (V249)', async () => {
    if (!device) return;
    const res = await dispatch('var_rossler', [[1.0, 0.0]]);
    // h=0.1, a=0.2
    // z = sqrt(1^2 + 0^2) = 1.0
    // x = 1.0 + 0.1 * (-0.0 - 1.0) = 0.9
    // y = 0.0 + 0.1 * (1.0 + 0.2 * 0.0) = 0.1
    expect(res[0]).toBeCloseTo(0.9, 4);
    expect(res[1]).toBeCloseTo(0.1, 4);
  });
});
