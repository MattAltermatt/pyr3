// @vitest-environment node
//
// #149 V250..V254 — Conformal zoom & named spirals

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
const VAR_DROSTE = extractWgslFn(SHADER_SRC, 'var_droste');
const VAR_LOGSPIRAL = extractWgslFn(SHADER_SRC, 'var_logspiral');
const VAR_FERMAT_SPIRAL = extractWgslFn(SHADER_SRC, 'var_fermat_spiral');
const VAR_LITUUS = extractWgslFn(SHADER_SRC, 'var_lituus');
const VAR_HYPERBOLIC_SPIRAL = extractWgslFn(SHADER_SRC, 'var_hyperbolic_spiral');

const PRELUDE = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const TAU: f32 = 6.28318530717958647692;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
${VAR_DROSTE}
${VAR_LOGSPIRAL}
${VAR_FERMAT_SPIRAL}
${VAR_LITUUS}
${VAR_HYPERBOLIC_SPIRAL}
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
  if (fn === 'var_droste') paramCall = '2.0';
  else if (fn === 'var_logspiral') paramCall = '2.0, 0.5';
  else if (fn === 'var_fermat_spiral') paramCall = '2.0';
  else if (fn === 'var_lituus') paramCall = '2.0';
  else if (fn === 'var_hyperbolic_spiral') paramCall = '2.0';

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

describe.skipIf(!device)('#149 — Spirals & Conformal Zoom', () => {
  it('droste', async () => {
    // p = [1.0, 0.0] -> r=1, theta=0 -> log(z)=0 -> er=1 -> [1.0, 0.0]
    // p = [0.0, 1.0] -> r=1, theta=pi/2 -> re = -ln(2)/4, im = pi/2 -> er = 2^(-0.25) ≈ 0.840896
    const out = await dispatch('var_droste', [[1.0, 0.0], [0.0, 1.0]]);
    expect(out[0]).toBeCloseTo(1.0);
    expect(out[1]).toBeCloseTo(0.0);
    expect(out[2]).toBeCloseTo(0.0); // cos(pi/2) is 0
    expect(out[3]).toBeCloseTo(0.8408964, 5); // 2^(-0.25)
  });

  it('logspiral', async () => {
    // p = [1.0, 1.0], a=2.0, k=0.5 -> theta = pi/4
    // r = 2.0 * exp(0.5 * pi/4) ≈ 2.961946
    // rx = r * cos(pi/4) = r * (1/sqrt(2)) ≈ 2.094411
    const out = await dispatch('var_logspiral', [[1.0, 1.0]]);
    expect(out[0]).toBeCloseTo(2.0944111, 5);
    expect(out[1]).toBeCloseTo(2.0944111, 5);
  });

  it('fermat_spiral', async () => {
    // p = [0.0, 1.0], a=2.0 -> theta = pi/2
    // r = 2.0 * sqrt(pi/2) ≈ 2.506628
    const out = await dispatch('var_fermat_spiral', [[0.0, 1.0]]);
    expect(out[0]).toBeCloseTo(0.0, 5);
    expect(out[1]).toBeCloseTo(2.5066282, 5);
  });

  it('lituus', async () => {
    // p = [0.0, 1.0], a=2.0 -> theta = pi/2
    // r = 2.0 / sqrt(pi/2) ≈ 1.595769
    const out = await dispatch('var_lituus', [[0.0, 1.0]]);
    expect(out[0]).toBeCloseTo(0.0, 5);
    expect(out[1]).toBeCloseTo(1.5957691, 5);
  });

  it('hyperbolic_spiral', async () => {
    // p = [0.0, 1.0], a=2.0 -> theta = pi/2
    // r = 2.0 / (pi/2) = 4/pi ≈ 1.273239
    const out = await dispatch('var_hyperbolic_spiral', [[0.0, 1.0]]);
    expect(out[0]).toBeCloseTo(0.0, 5);
    expect(out[1]).toBeCloseTo(1.2732395, 5);
  });
});
