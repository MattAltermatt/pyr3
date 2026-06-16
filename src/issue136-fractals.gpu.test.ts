// @vitest-environment node
//
// #136 V255..V257 — Fractal real-function warps.

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

const SHADER_SRC = readFileSync(
  new URL('./shaders/chaos.wgsl', import.meta.url), 'utf8',
);

const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');
const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
const VAR_WEIERSTRASS = extractWgslFn(SHADER_SRC, 'var_weierstrass');
const VAR_TAKAGI = extractWgslFn(SHADER_SRC, 'var_takagi');
const VAR_CANTOR_STAIRS = extractWgslFn(SHADER_SRC, 'var_cantor_stairs');

const PRELUDE = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const TAU: f32 = 6.28318530717958647692;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
${VAR_WEIERSTRASS}
${VAR_TAKAGI}
${VAR_CANTOR_STAIRS}
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
  if (fn === 'var_weierstrass') paramCall = '0.5, 3.0, 4.0, 0.5'; // a, b, terms, amp
  else if (fn === 'var_takagi') paramCall = '4.0, 0.5'; // terms, amp
  else if (fn === 'var_cantor_stairs') paramCall = '4.0, 0.5'; // terms, amp

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

  const readBuf = dev.createBuffer({
    size: N * 8,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const enc2 = dev.createCommandEncoder();
  enc2.copyBufferToBuffer(outBuf, 0, readBuf, 0, N * 8);
  dev.queue.submit([enc.finish(), enc2.finish()]);

  await readBuf.mapAsync(GPUMapMode.READ);
  const res = new Float32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  return res;
}

describe('V255 weierstrass', () => {
  it('matches expected math', async () => {
    if (!device) return;
    const pts = [
      [0.0, 0.0],
      [1.0, -1.0],
      [0.5, 0.25],
    ] as const;
    const out = await dispatch('var_weierstrass', pts);

    const a = 0.5;
    const b = 3.0;
    const terms = 4;
    const amp = 0.5;

    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i]!;
      let Wx = 0;
      let Wy = 0;
      let ap = 1.0;
      let bp = 1.0;
      for (let j = 0; j < terms; j++) {
        Wx += ap * Math.cos(bp * Math.PI * px);
        Wy += ap * Math.cos(bp * Math.PI * py);
        ap *= a;
        bp *= b;
      }
      expect(out[i * 2]).toBeCloseTo(px + amp * Wx, 4);
      expect(out[i * 2 + 1]).toBeCloseTo(py + amp * Wy, 4);
    }
  });
});

describe('V256 takagi', () => {
  it('matches expected math', async () => {
    if (!device) return;
    const pts = [
      [0.0, 0.0],
      [0.25, -0.75],
      [0.123, 0.876],
    ] as const;
    const out = await dispatch('var_takagi', pts);

    const terms = 4;
    const amp = 0.5;

    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i]!;
      let Tx = 0;
      let Ty = 0;
      let pow2 = 1.0;
      for (let j = 0; j < terms; j++) {
        const x_scaled = pow2 * px;
        const y_scaled = pow2 * py;
        Tx += Math.abs(x_scaled - Math.floor(x_scaled + 0.5)) / pow2;
        Ty += Math.abs(y_scaled - Math.floor(y_scaled + 0.5)) / pow2;
        pow2 *= 2.0;
      }
      expect(out[i * 2]).toBeCloseTo(px + amp * Tx, 4);
      expect(out[i * 2 + 1]).toBeCloseTo(py + amp * Ty, 4);
    }
  });
});

describe('V257 cantor_stairs', () => {
  it('matches expected math', async () => {
    if (!device) return;
    const pts = [
      [0.0, 0.0],
      [0.3, -0.7],
      [1.5, 0.8],
    ] as const;
    const out = await dispatch('var_cantor_stairs', pts);

    const terms = 4;
    const amp = 0.5;

    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i]!;
      let Cx = px;
      let Cy = py;
      for (let j = 0; j < terms; j++) {
        Cx = (Cx + Math.sin(Cx * 2 * Math.PI)) * 0.5;
        Cy = (Cy + Math.sin(Cy * 2 * Math.PI)) * 0.5;
      }
      expect(out[i * 2]).toBeCloseTo(px + amp * Cx, 4);
      expect(out[i * 2 + 1]).toBeCloseTo(py + amp * Cy, 4);
    }
  });
});
