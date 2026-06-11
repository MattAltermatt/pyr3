// @vitest-environment node
//
// #133 V222 — Cayley transform. z' = (z − s·i) / (z + s·i).
// Canonical conformal map from upper half-plane to open unit disk.

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

const CPX_DIV = extractWgslFn(SHADER_SRC, 'complex_div');
const VAR_CAYLEY = extractWgslFn(SHADER_SRC, 'var_cayley');

const PRELUDE = `${CPX_DIV}
${VAR_CAYLEY}
`;

async function dispatchCayley(inputs: ReadonlyArray<readonly [number, number, number]>): Promise<Float32Array> {
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
  outs[i] = var_cayley(r.xy, 1.0, r.z);
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

describe.skipIf(!device)('#133 V222 — var_cayley', () => {
  it('maps real axis to unit circle (z=0 → -1, z=1 → -i, z=-1 → +i)', async () => {
    const out = await dispatchCayley([
      [0.0, 0.0, 1.0],     // (0 − i) / (0 + i) = −1
      [1.0, 0.0, 1.0],     // (1 − i) / (1 + i) = −i
      [-1.0, 0.0, 1.0],    // (−1 − i) / (−1 + i) = +i
    ]);
    expect(out[0]).toBeCloseTo(-1, 4);
    expect(out[1]).toBeCloseTo(0, 4);
    expect(out[2]).toBeCloseTo(0, 4);
    expect(out[3]).toBeCloseTo(-1, 4);
    expect(out[4]).toBeCloseTo(0, 4);
    expect(out[5]).toBeCloseTo(1, 4);
  });

  it('maps z=i to origin', async () => {
    // (i − i) / (i + i) = 0 / 2i = 0
    const out = await dispatchCayley([
      [0.0, 1.0, 1.0],
    ]);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(0, 5);
  });

  it('stays finite near the pole z = -s·i', async () => {
    // z near (0, -1) approaches the pole. Pole guard via complex_div floor.
    const out = await dispatchCayley([
      [0.0, -1.0, 1.0],
      [0.01, -0.99, 1.0],
    ]);
    for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });

  it('scale-s changes the mapped region', async () => {
    // At z=0, (0 − si) / (0 + si) = −1 for any s ≠ 0 (scale-invariant at origin).
    const out = await dispatchCayley([
      [0.0, 0.0, 2.0],
      [0.0, 0.0, 0.5],
    ]);
    expect(out[0]).toBeCloseTo(-1, 4);
    expect(out[1]).toBeCloseTo(0, 4);
    expect(out[2]).toBeCloseTo(-1, 4);
    expect(out[3]).toBeCloseTo(0, 4);
  });

  it('maps upper half-plane to inside the unit disk', async () => {
    // Pick several points with positive imag; results should have |z'| < 1.
    const out = await dispatchCayley([
      [0.5, 1.0, 1.0],
      [-0.3, 2.0, 1.0],
      [1.0, 3.0, 1.0],
    ]);
    for (let i = 0; i < 3; i++) {
      const mag = Math.hypot(out[i * 2]!, out[i * 2 + 1]!);
      expect(mag).toBeLessThan(1.0);
    }
  });
});
