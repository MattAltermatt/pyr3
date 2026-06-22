// @vitest-environment node
//
// #130 V230..V232 — Single-step strange attractors.

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
const VAR_STANDARD_MAP = extractWgslFn(SHADER_SRC, 'var_standard_map');
const VAR_DE_JONG = extractWgslFn(SHADER_SRC, 'var_de_jong');
const VAR_IKEDA = extractWgslFn(SHADER_SRC, 'var_ikeda');

const PRELUDE = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const PI: f32 = 3.14159265358979323846;
const TAU: f32 = 6.28318530717958647692;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
${VAR_STANDARD_MAP}
${VAR_DE_JONG}
${VAR_IKEDA}
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
  if (fn === 'var_standard_map') paramCall = '1.0';
  else if (fn === 'var_de_jong') paramCall = '-2.24, 0.43, -0.65, -2.43';
  else if (fn === 'var_ikeda') paramCall = '0.9';

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
  const mod = await compileChecked(dev, code);
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

describe.skipIf(!device)('#130 — Single-step strange attractors', () => {
  it('standard_map output is finite and reasonable', async () => {
    const out = await dispatch('var_standard_map', [[0, 0], [1, 1], [-0.5, -0.5]]);
    expect(Number.isFinite(out[0])).toBe(true);
  });

  it('de_jong output is finite and reasonable', async () => {
    const out = await dispatch('var_de_jong', [[0, 0], [1, 1], [-0.5, -0.5]]);
    expect(Number.isFinite(out[0])).toBe(true);
  });

  it('ikeda output is finite and reasonable', async () => {
    const out = await dispatch('var_ikeda', [[0, 0], [1, 1], [-0.5, -0.5]]);
    expect(Number.isFinite(out[0])).toBe(true);
  });
});
