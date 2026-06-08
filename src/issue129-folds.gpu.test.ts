// @vitest-environment node
//
// #129 V233..V236 — Fold-family variations.

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
const VAR_BOX_FOLD = extractWgslFn(SHADER_SRC, 'var_box_fold');
const VAR_SPHERE_FOLD = extractWgslFn(SHADER_SRC, 'var_sphere_fold');
const VAR_MANDELBOX_STEP = extractWgslFn(SHADER_SRC, 'var_mandelbox_step');
const VAR_KIFS_FOLD = extractWgslFn(SHADER_SRC, 'var_kifs_fold');

const PRELUDE = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const TAU: f32 = 6.28318530717958647692;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
${VAR_BOX_FOLD}
${VAR_SPHERE_FOLD}
${VAR_MANDELBOX_STEP}
${VAR_KIFS_FOLD}
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
  if (fn === 'var_box_fold') paramCall = '1.0';
  else if (fn === 'var_sphere_fold') paramCall = '0.5, 1.0';
  else if (fn === 'var_mandelbox_step') paramCall = '2.0, 0.5, 1.0, 0.0, 0.0';
  else if (fn === 'var_kifs_fold') paramCall = '3.0, 0.0';

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

describe.skipIf(!device)('#129 — Fold-family variations', () => {
  it('box_fold works and reflects outside limit', async () => {
    const out = await dispatch('var_box_fold', [[0.5, 0.5], [1.5, -1.5]]);
    expect(out[0]).toBeCloseTo(0.5);
    expect(out[1]).toBeCloseTo(0.5);
    expect(out[2]).toBeCloseTo(0.5); // 2*1 - 1.5 = 0.5
    expect(out[3]).toBeCloseTo(-0.5); // -2*1 - (-1.5) = -0.5
  });

  it('sphere_fold works', async () => {
    const out = await dispatch('var_sphere_fold', [[0, 0], [0.75, 0], [2.0, 0]]);
    // [0,0] is inside rmin=0.5 -> scales by rmax2/rmin2 = 1.0/0.25 = 4.0
    expect(out[0]).toBeCloseTo(0.0);
    // [0.75,0] is inside rmax=1.0 -> scales by rmax2/r2 = 1.0/0.5625 = 1.777...
    expect(out[2]).toBeCloseTo(0.75 * 1.777777, 4);
    // [2.0,0] is outside -> no scale
    expect(out[4]).toBeCloseTo(2.0);
  });

  it('mandelbox_step is finite', async () => {
    const out = await dispatch('var_mandelbox_step', [[0, 0], [2, 2], [-0.5, -0.5]]);
    expect(Number.isFinite(out[0])).toBe(true);
  });

  it('kifs_fold is finite', async () => {
    const out = await dispatch('var_kifs_fold', [[0, 0], [1, 1], [-0.5, -0.5]]);
    expect(Number.isFinite(out[0])).toBe(true);
  });
});
